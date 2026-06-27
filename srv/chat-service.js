/**
 * Implementacja usługi ChatService (handlery do chat-service.cds).
 *
 * Najważniejsze: akcja `sendMessage` streamuje odpowiedź doradcy przez SSE.
 * Plan A — piszemy bezpośrednio do surowej odpowiedzi HTTP (`req.http.res`),
 * a po `res.end()` robimy `return`, żeby CAP nie próbował już serializować
 * własnej odpowiedzi OData. Warstwa AI jest pod interfejsem `advisor`
 * (teraz mock, w Fazie 3 realny Anthropic) — handler się nie zmienia.
 */
const cds = require('@sap/cds');
const advisor = require('./advisor/advisor');
const { costUsd } = require('./advisor/pricing');
const { activeModel, decideModel, generateModel } = require('./advisor/models');
const CONFIG = require('./advisor/config');
const { checkAndRecord } = require('./rate-limit');
const { sanitizeAdvisor } = require('./sanitize');

/**
 * RATE LIMIT (in-memory): ostatni znacznik czasu wiadomości per konwersacja.
 * Wystarcza dla pojedynczej instancji (MVP). Przy skalowaniu na wiele instancji
 * trzeba przenieść do współdzielonego magazynu (Redis itp.).
 */
const lastMessageAt = new Map();
// Znaczniki czasu utworzeń konwersacji per IP (lista, anty-spam startConversation). In-memory (MVP).
const lastNewConvAt = new Map();

/** Najlepszy dostępny adres IP klienta (za proxy: X-Forwarded-For). */
function clientIp(req) {
  const xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (xff) return String(xff).split(',')[0].trim();
  const r = req.http && req.http.req;
  return (r && (r.ip || (r.socket && r.socket.remoteAddress))) || 'unknown';
}

/** Zapis pojedynczego zdarzenia SSE do surowej odpowiedzi HTTP. */
function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Ciepłe pożegnanie doradcy przy wejściu w pauzę (krok 4). Szablon — 0 tokenów. */
const SENDOFF_TEXT =
  'Zostawiam Was z tym we dwoje — porozmawiajcie między sobą, choćby na spokojnie poza aplikacją. Gdy zechcecie, żebym znów się włączył, przełączcie mnie na „rozmawia" i po prostu napiszcie, jak Wam poszło.';

/**
 * Łagodne wejście w read-only po osiągnięciu progu kosztu. Ten SAM komunikat dla
 * obu progów: budżetu per-sesja ($0,50) i globalnego dziennego limitu aplikacji ($20/24h).
 * Prosty język, bez technikaliów. Szablon — 0 tokenów.
 */
const BUDGET_TEXT =
  'Na dziś musimy zrobić tu pauzę — skończyła nam się pula, którą cała aplikacja ma na rozmowy na dziś. To, co sobie powiedzieliście, zostaje z Wami. Wróćcie proszę później, najlepiej jutro — chętnie znów Wam wtedy potowarzyszę.';

/** Wiersz DB → kształt ChatMessage z kontraktu (shared/chat-contract.ts). */
const toContract = (m) => ({
  id: m.ID,
  conversationId: m.conversation_ID,
  seq: m.seq,
  author: m.author,
  text: m.text,
  createdAt: m.createdAt,
  // tylko dymki ADVISOR niosą kind/decisionType (dla pary są puste)
  ...(m.kind ? { kind: m.kind } : {}),
  ...(m.decisionType ? { decisionType: m.decisionType } : {}),
});

/** Wiersz ParkedTopics → kształt ParkedTopic z kontraktu. */
const parkedToContract = (p) => ({
  id: p.ID,
  text: p.text,
  status: p.status,
  parkedAtSeq: p.parkedAtSeq,
});

const LOG = cds.log('tokens');

/** Zdarzenie 'end' z warstwy AI → kolumny tokenów do zapisu (z domyślnymi zerami). */
const usageColumns = (u) => ({
  inputTokens: (u && u.inputTokens) || 0,
  outputTokens: (u && u.outputTokens) || 0,
  cacheReadTokens: (u && u.cacheReadTokens) || 0,
  cacheCreationTokens: (u && u.cacheCreationTokens) || 0,
});

module.exports = function (srv) {
  // ChatService NIE wystawia już encji przez OData (bezpieczeństwo) → w handlerze
  // adresujemy encje DB bezpośrednio po FQN (operacje idą na bazę, nie przez serwis).
  const Conversations = 'relvia.Conversations';
  const Messages = 'relvia.Messages';
  const ParkedTopics = 'relvia.ParkedTopics';
  const USAGE_EVENTS = 'relvia.UsageEvents';

  /** Otwarte zaparkowane tematy (kontraktowy kształt), wg kolejności odłożenia. */
  async function loadParked(conversationId) {
    const rows = await SELECT.from(ParkedTopics)
      .where({ conversation_ID: conversationId, status: 'OPEN' })
      .orderBy('parkedAtSeq');
    return rows.map(parkedToContract);
  }

  /** Pełny stan reżysera z DB → ConversationState (wejście do decide). */
  async function loadState(conversationId) {
    const c = await SELECT.one.from(Conversations).where({ ID: conversationId });
    return {
      phase: (c && c.phase) || 'OPENING',
      topic: c && c.topic,
      advisorMode: (c && c.advisorMode) || 'LEADING',
      turnsSinceProgress: (c && c.turnsSinceProgress) || 0,
      escalationStreak: (c && c.escalationStreak) || 0,
      lastComposerHint: c && c.lastComposerHint, // by decide nie powtarzał podpowiedzi
      parkedTopics: await loadParked(conversationId),
    };
  }

  /** Zapis zmian stanu po decyzji reżysera (faza, kotwica, licznik, aktywność). */
  async function persistState(conversationId, decision) {
    const patch = { lastActivityAt: new Date().toISOString() };
    if (decision.phase) patch.phase = decision.phase;
    if (decision.topic) patch.topic = decision.topic;
    if (typeof decision.turnsSinceProgress === 'number')
      patch.turnsSinceProgress = decision.turnsSinceProgress;
    if (typeof decision.escalationStreak === 'number')
      patch.escalationStreak = decision.escalationStreak; // rozpęd kłótni (krok 3)
    patch.model = activeModel(); // zapis modelu na poziomie konwersacji
    if (decision.composerHint) patch.lastComposerHint = decision.composerHint; // pamięć podpowiedzi

    // krok 5: koszt warstwy DECYZJI (decide modelem). Narasta co turę (też WAIT).
    if (decision.usage) {
      const u = decision.usage;
      patch.decideInputTokens = { '+=': u.inputTokens || 0 };
      patch.decideOutputTokens = { '+=': u.outputTokens || 0 };
      patch.decideCacheReadTokens = { '+=': u.cacheReadTokens || 0 };
      patch.decideCacheCreationTokens = { '+=': u.cacheCreationTokens || 0 };
      LOG.info(
        `decyzja (konw. ${conversationId}) [${decideModel()}]: in=${u.inputTokens || 0} out=${u.outputTokens || 0} ~$${costUsd(u, decideModel()).toFixed(6)}`,
      );
    }

    await UPDATE(Conversations).set(patch).where({ ID: conversationId });

    // utrwal łączny koszt także po turach WAIT (sam decide, bez logUsage); po
    // UPDATE liczniki decide są już aktualne. Speaking-tury domkną to w logUsage.
    if (decision.usage) {
      const total = await conversationCostUsd(conversationId);
      await UPDATE(Conversations).set({ costUsd: total }).where({ ID: conversationId });
    }
  }

  async function nextSeq(conversationId) {
    const row = await SELECT.one
      .from(Messages)
      .columns('max(seq) as m')
      .where({ conversation_ID: conversationId });
    return ((row && row.m) || 0) + 1;
  }

  async function loadHistory(conversationId) {
    const rows = await SELECT.from(Messages).where({ conversation_ID: conversationId }).orderBy('seq');
    return rows.map(toContract);
  }

  /** Loguje zużycie tokenów: tej wiadomości + zagregowane dla całej konwersacji. */
  async function logUsage(conversationId, advisorId, usage) {
    const c = usageColumns(usage);
    const model = generateModel(); // wiadomość doradcy = warstwa generacji
    LOG.info(
      `wiadomość ${advisorId} (konw. ${conversationId}) [${model}]: in=${c.inputTokens} out=${c.outputTokens} cacheRead=${c.cacheReadTokens} cacheCreate=${c.cacheCreationTokens} ~$${costUsd(c, model).toFixed(6)}`,
    );
    // „łącznie" = generacja + DECYZJA, każda swoim modelem (wcześniej sumowało tylko
    // generację → zaniżenie o ~połowę). Utrwalamy też koszt na konwersacji.
    const total = await conversationCostUsd(conversationId);
    LOG.info(`konwersacja ${conversationId} łącznie (decide ${decideModel()} + generate ${generateModel()}) ~$${total.toFixed(6)}`);
    await UPDATE(Conversations).set({ costUsd: total }).where({ ID: conversationId });
  }

  /**
   * Łączny koszt konwersacji (USD): generacja (dymki ADVISOR) + decyzja (liczniki
   * decide na konwersacji). To samo rozbicie co w `conversationUsage`. Używane do
   * egzekwowania budżetu PRZED kolejną turą — liczy koszt JUŻ poniesiony, więc
   * tura przekraczająca próg dokańcza się, a blokada działa od następnej.
   */
  async function conversationCostUsd(conversationId) {
    const c = await SELECT.one
      .from(Conversations)
      .columns(
        'decideInputTokens',
        'decideOutputTokens',
        'decideCacheReadTokens',
        'decideCacheCreationTokens',
      )
      .where({ ID: conversationId });
    const g = await SELECT.one
      .from(Messages)
      .columns(
        'sum(inputTokens) as inputTokens',
        'sum(outputTokens) as outputTokens',
        'sum(cacheReadTokens) as cacheReadTokens',
        'sum(cacheCreationTokens) as cacheCreationTokens',
      )
      .where({ conversation_ID: conversationId, author: 'ADVISOR' });
    const gen = {
      inputTokens: (g && g.inputTokens) || 0,
      outputTokens: (g && g.outputTokens) || 0,
      cacheReadTokens: (g && g.cacheReadTokens) || 0,
      cacheCreationTokens: (g && g.cacheCreationTokens) || 0,
    };
    const dec = {
      inputTokens: (c && c.decideInputTokens) || 0,
      outputTokens: (c && c.decideOutputTokens) || 0,
      cacheReadTokens: (c && c.decideCacheReadTokens) || 0,
      cacheCreationTokens: (c && c.decideCacheCreationTokens) || 0,
    };
    // wycena PER WARSTWA: generacja modelem generate (np. Sonnet), decyzja modelem
    // decide (np. Haiku). Inaczej pod model-splitem budżet niedoszacowałby Sonneta.
    return costUsd(gen, generateModel()) + costUsd(dec, decideModel());
  }

  /** Dopisuje zdarzenie zużycia do ledgera (zasila globalny limit 24h). 0 = pomijamy szum? nie — i tak sumujemy. */
  async function recordUsage(conversationId, layer, usage) {
    if (!usage) return;
    await INSERT.into(USAGE_EVENTS).entries({
      ID: cds.utils.uuid(),
      conversation_ID: conversationId,
      layer,
      // model warstwy: globalCostLast24hUsd grupuje po `model` i wycenia per model,
      // więc generate (Sonnet) musi być zapisany jako Sonnet, nie jako activeModel.
      model: layer === 'decide' ? decideModel() : generateModel(),
      ...usageColumns(usage),
    });
  }

  /** Łączny koszt (USD) CAŁEJ aplikacji z ostatnich CONFIG.globalWindowMs (ledger UsageEvents). */
  async function globalCostLast24hUsd() {
    const cutoff = new Date(Date.now() - CONFIG.globalWindowMs).toISOString();
    const rows = await SELECT.from(USAGE_EVENTS)
      .columns(
        'model',
        'sum(inputTokens) as inputTokens',
        'sum(outputTokens) as outputTokens',
        'sum(cacheReadTokens) as cacheReadTokens',
        'sum(cacheCreationTokens) as cacheCreationTokens',
      )
      .where`createdAt >= ${cutoff}`
      .groupBy('model');
    let total = 0;
    for (const r of rows) {
      total += costUsd(
        {
          inputTokens: r.inputTokens || 0,
          outputTokens: r.outputTokens || 0,
          cacheReadTokens: r.cacheReadTokens || 0,
          cacheCreationTokens: r.cacheCreationTokens || 0,
        },
        r.model || activeModel(),
      );
    }
    return total;
  }

  /**
   * Łagodny read-only (budżet per-sesja LUB globalny limit): echo wiadomości pary
   * + opcjonalna notka doradcy (BUDGET_TEXT, 0 tokenów). ZERO wywołań modelu.
   * Zwraca wynik handlera (SSE: kończy res i zwraca undefined; bez SSE: JSON).
   */
  async function readOnlyReply(req, userRow, conversationId, seq, insertNotice) {
    let notice = null;
    if (insertNotice) {
      const noticeId = cds.utils.uuid();
      const noticeSeq = seq + 1;
      await INSERT.into(Messages).entries({
        ID: noticeId,
        conversation_ID: conversationId,
        seq: noticeSeq,
        author: 'ADVISOR',
        text: BUDGET_TEXT,
        kind: 'FULL',
      });
      notice = { id: noticeId, seq: noticeSeq };
    }
    const res = req.http && req.http.res;
    if (String(req.headers.accept || '').includes('text/event-stream') && res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      sse(res, 'message.user', { message: toContract(userRow) });
      if (notice) {
        sse(res, 'advisor.start', {
          message: {
            id: notice.id,
            conversationId,
            seq: notice.seq,
            author: 'ADVISOR',
            createdAt: new Date().toISOString(),
          },
        });
        sse(res, 'advisor.end', { text: BUDGET_TEXT, finishReason: 'end_turn', kind: 'FULL' });
      }
      res.end();
      return;
    }
    return { message: toContract(userRow), ...(notice ? { advisorMessageId: notice.id } : {}) };
  }

  /**
   * CAPABILITY CHECK: konwersacja jest dostępna WYŁĄCZNIE dla tego, kto zna jej
   * `accessToken` (sekret zwrócony przy startConversation). Brak konwersacji albo
   * zły/brak tokenu → 403 (ten sam błąd w obu przypadkach — nie ujawniamy, czy dane
   * id istnieje → brak enumeracji). Zwraca wiersz konwersacji do dalszego użycia.
   */
  async function assertAccess(req, conversationId, accessToken) {
    if (!CONFIG.accessControlEnabled) return; // wyłączone (np. testy innych warstw)
    const conv = conversationId
      ? await SELECT.one.from(Conversations).where({ ID: conversationId })
      : null;
    if (!conv || !conv.accessToken || !accessToken || conv.accessToken !== accessToken) {
      return req.reject(403, 'FORBIDDEN: brak dostępu do tej konwersacji');
    }
    return conv;
  }

  // --- utworzenie konwersacji ------------------------------------------------
  srv.on('startConversation', async (req) => {
    // ANTY-SPAM: dławik tworzenia konwersacji z jednego IP (publiczny endpoint).
    // Dwa progi: ODSTĘP (tempo) + TWARDY LIMIT na godzinę. Logika w rate-limit.js.
    if (CONFIG.newConvRateLimitEnabled) {
      const ip = clientIp(req);
      const r = checkAndRecord(lastNewConvAt.get(ip) || [], Date.now(), {
        minIntervalMs: CONFIG.newConversationMinIntervalMs,
        maxPerWindow: CONFIG.newConversationMaxPerHour,
        windowMs: CONFIG.newConversationWindowMs,
      });
      // utrzymuj w pamięci tylko aktualne wpisy (puste → usuń klucz, by mapa nie rosła)
      if (r.timestamps.length) lastNewConvAt.set(ip, r.timestamps);
      else lastNewConvAt.delete(ip);
      if (!r.allowed) {
        return req.reject(
          429,
          r.reason === 'WINDOW_CAP'
            ? 'RATE_LIMIT: zbyt wiele nowych rozmów w tej godzinie'
            : 'RATE_LIMIT: zbyt wiele nowych rozmów — chwila przerwy',
        );
      }
    }
    const ID = cds.utils.uuid();
    // sekret-token dostępu do tej konwersacji (capability) — zwracany klientowi,
    // wymagany przy każdej kolejnej akcji. Niezgadywalny (UUID v4).
    const accessToken = cds.utils.uuid();
    await INSERT.into(Conversations).entries({ ID, title: req.data.title, accessToken });
    // odczytujemy imiona (domyślne Ona/On z schema.cds) i zwracamy je do UI
    const conv = await SELECT.one.from(Conversations).where({ ID });
    return { conversationId: ID, herName: conv.herName, hisName: conv.hisName, accessToken };
  });

  // --- historia jednej konwersacji (zastępuje dawny odczyt OData) ------------
  srv.on('getHistory', async (req) => {
    const { conversationId, accessToken } = req.data;
    await assertAccess(req, conversationId, accessToken);
    const rows = await SELECT.from(Messages)
      .where({ conversation_ID: conversationId })
      .orderBy('seq');
    return rows.map(toContract);
  });

  // --- wysłanie wiadomości + streaming odpowiedzi doradcy (SSE) --------------
  srv.on('sendMessage', async (req) => {
    const { conversationId, author, text, accessToken } = req.data;

    if (author === 'ADVISOR') return req.reject(400, 'INVALID_AUTHOR: para nie pisze jako doradca');
    if (!text || !text.trim()) return req.reject(400, 'EMPTY_TEXT');
    // WALIDACJA: twardy limit długości (anty-nadużycie kosztu tokenów).
    if (text.length > CONFIG.maxMessageChars) {
      return req.reject(413, `MESSAGE_TOO_LONG: maksymalnie ${CONFIG.maxMessageChars} znaków`);
    }

    // CAPABILITY: tylko właściciel tokenu może pisać do tej konwersacji (przed zapisem).
    await assertAccess(req, conversationId, accessToken);

    // RATE LIMIT: minimalny odstęp między wiadomościami w obrębie konwersacji.
    // Para „z rąk do rąk" tego nie dotknie; chroni przed zalewaniem endpointu.
    if (CONFIG.rateLimitEnabled && conversationId) {
      const now = Date.now();
      const prev = lastMessageAt.get(conversationId) || 0;
      if (now - prev < CONFIG.rateLimitMinIntervalMs) {
        return req.reject(429, 'RATE_LIMIT: zbyt szybko — daj chwilę przerwy');
      }
      lastMessageAt.set(conversationId, now);
    }

    // 1. zapis wiadomości pary
    const seq = await nextSeq(conversationId);
    const userId = cds.utils.uuid();
    await INSERT.into(Messages).entries({
      ID: userId,
      conversation_ID: conversationId,
      seq,
      author,
      text: text.trim(),
    });
    const userRow = await SELECT.one.from(Messages).where({ ID: userId });

    // imiona pary z konwersacji → kontekst dla warstwy AI (prefiksy mówców)
    const conv = await SELECT.one.from(Conversations).where({ ID: conversationId });
    const advisorCtx = { herName: conv && conv.herName, hisName: conv && conv.hisName };

    // „TYLKO SŁUCHA" (PAUSED): doradca CAŁKOWICIE wyłączony — ZERO wywołań modelu.
    // Para pisze między sobą; zapisujemy wiadomość i kończymy. Powrót = przełącznik na
    // „rozmawia" (wtedy decide znów dostaje pełną historię, łącznie z tym, co tu padło).
    if (conv && conv.advisorMode === 'PAUSED') {
      const resP = req.http && req.http.res;
      if (String(req.headers.accept || '').includes('text/event-stream') && resP) {
        resP.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        sse(resP, 'message.user', { message: toContract(userRow) });
        resP.end();
        return;
      }
      return { message: toContract(userRow) };
    }

    // OCHRONA KOSZTU — dwa progi, oba prowadzą do tego samego łagodnego read-only
    // (notka 0-tok + ZERO dalszych wołań modelu, tylko echo wiadomości pary):
    //   • GLOBALNY — bezpiecznik całej aplikacji: koszt wszystkich konwersacji z
    //     ostatnich 24h ≥ $20. Stan przejściowy (bez flagi) — odżywa, gdy stare
    //     zużycie wypadnie z okna. Notkę dokładamy raz na konwersację (dedup po ostatniej).
    //   • PER-SESJA — ta rozmowa ≥ $0,50: utrwalamy flagę `budgetReached` (raz notka, potem echo).
    {
      const globalOver =
        CONFIG.globalBudgetEnabled && (await globalCostLast24hUsd()) >= CONFIG.globalDailyBudgetUsd;
      const sessionAlready = !!(conv && conv.budgetReached);
      const sessionOver =
        CONFIG.budgetEnabled &&
        conv &&
        (sessionAlready || (await conversationCostUsd(conversationId)) >= CONFIG.conversationBudgetUsd);

      if (globalOver || sessionOver) {
        let insertNotice;
        if (sessionOver && !sessionAlready) {
          await UPDATE(Conversations).set({ budgetReached: true }).where({ ID: conversationId });
          insertNotice = true; // per-sesja, pierwsze przekroczenie
        } else if (sessionAlready) {
          insertNotice = false; // ta konwersacja już dostała notkę
        } else {
          // tylko globalny (bez flagi) → notka raz na konwersację: dokładamy, gdy
          // ostatnia DYMKA DORADCY nie jest już tą notką (dedup, żeby nie spamować).
          // Uwaga: wiadomość pary z tej tury jest już zapisana, więc filtrujemy po ADVISOR.
          const lastAdv = (
            await SELECT.from(Messages)
              .where({ conversation_ID: conversationId, author: 'ADVISOR' })
              .orderBy('seq desc')
              .limit(1)
          )[0];
          insertNotice = !(lastAdv && lastAdv.text === BUDGET_TEXT);
        }
        return readOnlyReply(req, userRow, conversationId, seq, insertNotice);
      }
    }

    const advisorId = cds.utils.uuid();
    const advisorSeq = seq + 1;

    // KROK SILNIKA: decyzja reżysera PRZED generacją. Historia zawiera już
    // właśnie zapisaną wiadomość pary. Stan czytamy z DB (faza/kotwica/liczniki).
    const history = await loadHistory(conversationId);
    const state = await loadState(conversationId);

    let decision;
    try {
      decision = await advisor.decide(history, state, advisorCtx);
    } catch (e) {
      decision = { shouldSpeak: true, type: 'SUMMARIZE', kind: 'FULL', phase: state.phase };
    }

    // persystencja stanu + ewentualne zaparkowanie dygresji
    await persistState(conversationId, decision);
    await recordUsage(conversationId, 'decide', decision.usage); // ledger globalnego limitu
    const phaseChanged = decision.phase && decision.phase !== state.phase;
    let parkedTopics = state.parkedTopics;
    if (decision.parkAdd) {
      await INSERT.into(ParkedTopics).entries({
        ID: cds.utils.uuid(),
        conversation_ID: conversationId,
        text: decision.parkAdd,
        status: 'OPEN',
        parkedAtSeq: seq,
      });
      parkedTopics = await loadParked(conversationId);
    }

    const res = req.http && req.http.res;
    const wantsSSE = String(req.headers.accept || '').includes('text/event-stream');

    // 2a. ścieżka SSE (domyślna)
    if (wantsSSE && res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // wyłącz buforowanie na ewentualnym proxy
      });

      sse(res, 'message.user', { message: toContract(userRow) });
      sse(res, 'advisor.decision', {
        decision: decision.type,
        phase: decision.phase,
        uiHint: decision.uiHint,
        nextSpeaker: decision.nextSpeaker,
        composerHint: decision.composerHint,
      });
      if (phaseChanged) sse(res, 'phase.change', { phase: decision.phase, topic: decision.topic });
      if (decision.parkAdd) sse(res, 'parked.update', { topics: parkedTopics });

      // Advisor MILCZY — analizuje, ale nie dodaje dymki.
      if (!decision.shouldSpeak) {
        sse(res, 'advisor.wait', { uiHint: decision.uiHint || 'Doradca słucha w milczeniu…' });
        res.end();
        return;
      }

      sse(res, 'advisor.start', {
        message: {
          id: advisorId,
          conversationId,
          seq: advisorSeq,
          author: 'ADVISOR',
          createdAt: new Date().toISOString(),
        },
      });

      // ABORT przy rozłączeniu klienta: gdy user zamknie kartę w trakcie generacji,
      // przerywamy stream modelu — nie palimy tokenów na odpowiedź, której nikt nie zobaczy.
      const ac = new AbortController();
      let clientGone = false;
      res.on('close', () => {
        clientGone = true;
        ac.abort();
      });

      let acc = '';
      let usage = null;
      try {
        for await (const ev of advisor.generateReply(history, advisorCtx, decision, { signal: ac.signal })) {
          if (ev.type === 'delta') {
            acc += ev.text;
            sse(res, 'advisor.delta', { text: ev.text });
          } else if (ev.type === 'end') {
            acc = ev.text;
            usage = ev.usage || null;
          }
        }
      } catch (e) {
        if (clientGone) return; // rozłączenie → generację przerwano, nic nie piszemy/zapisujemy
        sse(res, 'error', { code: 'ADVISOR_ERROR', message: String((e && e.message) || e) });
        res.end();
        return;
      }
      if (clientGone) return; // rozłączenie tuż po zakończeniu — nie zapisuj dymki ani nie odpowiadaj

      acc = sanitizeAdvisor(acc); // Markdown B
      await INSERT.into(Messages).entries({
        ID: advisorId,
        conversation_ID: conversationId,
        seq: advisorSeq,
        author: 'ADVISOR',
        text: acc,
        kind: decision.kind,
        decisionType: decision.type,
        ...usageColumns(usage),
      });
      await logUsage(conversationId, advisorId, usage);
      await recordUsage(conversationId, 'generate', usage); // ledger globalnego limitu
      sse(res, 'advisor.end', { text: acc, finishReason: 'end_turn', kind: decision.kind });
      res.end();
      return; // odpowiedź obsłużona ręcznie — CAP nie serializuje już niczego
    }

    // 2b. degradacja bez SSE — zwykły JSON
    if (!decision.shouldSpeak) {
      return { advisorMessageId: null };
    }
    let acc = '';
    let usage = null;
    for await (const ev of advisor.generateReply(history, advisorCtx, decision)) {
      if (ev.type === 'delta') acc += ev.text;
      else if (ev.type === 'end') {
        acc = ev.text;
        usage = ev.usage || null;
      }
    }
    acc = sanitizeAdvisor(acc); // Markdown B
    await INSERT.into(Messages).entries({
      ID: advisorId,
      conversation_ID: conversationId,
      seq: advisorSeq,
      author: 'ADVISOR',
      text: acc,
      kind: decision.kind,
      decisionType: decision.type,
      ...usageColumns(usage),
    });
    await logUsage(conversationId, advisorId, usage);
    await recordUsage(conversationId, 'generate', usage); // ledger globalnego limitu
    return { advisorMessageId: advisorId };
  });

  // --- stan reżysera (odtworzenie UI po odświeżeniu) ------------------------
  srv.on('conversationState', async (req) => {
    await assertAccess(req, req.data.conversationId, req.data.accessToken);
    const s = await loadState(req.data.conversationId);
    return {
      phase: s.phase,
      topic: s.topic,
      advisorMode: s.advisorMode,
      parkedTopics: s.parkedTopics,
    };
  });

  // --- zmiana stanu zaparkowanego tematu ------------------------------------
  // PROMOTE: "wróćmy teraz" → ustawia kotwicę na ten temat i zamyka go.
  // RESOLVED / DISMISSED: oznacza jako załatwiony / odrzucony.
  srv.on('resolveParkedTopic', async (req) => {
    const { conversationId, topicId, action, accessToken } = req.data;
    await assertAccess(req, conversationId, accessToken);
    const topic = await SELECT.one.from(ParkedTopics).where({ ID: topicId });
    if (!topic) return { ok: false };

    if (action === 'PROMOTE') {
      await UPDATE(Conversations).set({ topic: topic.text }).where({ ID: conversationId });
      await UPDATE(ParkedTopics).set({ status: 'RESOLVED' }).where({ ID: topicId });
    } else if (action === 'RESOLVED' || action === 'DISMISSED') {
      await UPDATE(ParkedTopics).set({ status: action }).where({ ID: topicId });
    } else {
      return { ok: false };
    }
    return { ok: true };
  });

  // --- pauza/wznowienie doradcy (krok 4) ------------------------------------
  srv.on('setAdvisorMode', async (req) => {
    const { conversationId, mode, accessToken } = req.data;
    if (!['LEADING', 'LISTENING', 'PAUSED'].includes(mode)) return req.reject(400, 'INVALID_MODE');
    await assertAccess(req, conversationId, accessToken);
    await UPDATE(Conversations)
      .set({ advisorMode: mode, lastActivityAt: new Date().toISOString() })
      .where({ ID: conversationId });
    // wejście w pauzę → doradca dopisuje ciepłe pożegnanie (widoczny skutek kliknięcia)
    if (mode === 'PAUSED') {
      await INSERT.into(Messages).entries({
        ID: cds.utils.uuid(),
        conversation_ID: conversationId,
        seq: await nextSeq(conversationId),
        author: 'ADVISOR',
        text: SENDOFF_TEXT,
        kind: 'FULL',
      });
    }
    return { ok: true };
  });

  // --- zagregowane zużycie tokenów dla całej konwersacji --------------------
  srv.on('conversationUsage', async (req) => {
    const cid = req.data.conversationId;
    await assertAccess(req, cid, req.data.accessToken);
    // model + narastające liczniki decyzji zapisane na konwersacji
    const conv = await SELECT.one
      .from(Conversations)
      .columns(
        'decideInputTokens',
        'decideOutputTokens',
        'decideCacheReadTokens',
        'decideCacheCreationTokens',
      )
      .where({ ID: cid });

    // GENERACJA (dymki doradcy) — suma po wiadomościach ADVISOR
    const g = await SELECT.one
      .from(Messages)
      .columns(
        'sum(inputTokens) as inputTokens',
        'sum(outputTokens) as outputTokens',
        'sum(cacheReadTokens) as cacheReadTokens',
        'sum(cacheCreationTokens) as cacheCreationTokens',
        'count(*) as messages',
      )
      .where({ conversation_ID: cid, author: 'ADVISOR' });

    const gen = {
      inputTokens: (g && g.inputTokens) || 0,
      outputTokens: (g && g.outputTokens) || 0,
      cacheReadTokens: (g && g.cacheReadTokens) || 0,
      cacheCreationTokens: (g && g.cacheCreationTokens) || 0,
    };
    // DECYZJA (decide modelem) — z liczników na konwersacji
    const dec = {
      inputTokens: (conv && conv.decideInputTokens) || 0,
      outputTokens: (conv && conv.decideOutputTokens) || 0,
      cacheReadTokens: (conv && conv.decideCacheReadTokens) || 0,
      cacheCreationTokens: (conv && conv.decideCacheCreationTokens) || 0,
    };
    const generationCostUsd = costUsd(gen, generateModel());
    const decideCostUsd = costUsd(dec, decideModel());

    return {
      // generacja
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      cacheReadTokens: gen.cacheReadTokens,
      cacheCreationTokens: gen.cacheCreationTokens,
      messages: (g && g.messages) || 0,
      // decyzja
      decideInputTokens: dec.inputTokens,
      decideOutputTokens: dec.outputTokens,
      decideCacheReadTokens: dec.cacheReadTokens,
      decideCacheCreationTokens: dec.cacheCreationTokens,
      // modele per warstwa + koszty (rozbicie + suma)
      model: generateModel(), // headline = model generacji (zgodność wstecz)
      decideModel: decideModel(),
      generateModel: generateModel(),
      generationCostUsd,
      decideCostUsd,
      costUsd: generationCostUsd + decideCostUsd,
    };
  });
};
