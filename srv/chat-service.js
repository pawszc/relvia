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

/** Zapis pojedynczego zdarzenia SSE do surowej odpowiedzi HTTP. */
function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

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
  const { Conversations, Messages, ParkedTopics } = srv.entities;

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
    await UPDATE(Conversations).set(patch).where({ ID: conversationId });
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
    LOG.info(
      `wiadomość ${advisorId} (konw. ${conversationId}): in=${c.inputTokens} out=${c.outputTokens} cacheRead=${c.cacheReadTokens} cacheCreate=${c.cacheCreationTokens} ~$${costUsd(c).toFixed(6)}`,
    );
    const agg = await SELECT.one
      .from(Messages)
      .columns(
        'sum(inputTokens) as inputTokens',
        'sum(outputTokens) as outputTokens',
        'sum(cacheReadTokens) as cacheReadTokens',
        'sum(cacheCreationTokens) as cacheCreationTokens',
      )
      .where({ conversation_ID: conversationId });
    LOG.info(
      `konwersacja ${conversationId} łącznie: in=${(agg && agg.inputTokens) || 0} out=${(agg && agg.outputTokens) || 0} cacheRead=${(agg && agg.cacheReadTokens) || 0} cacheCreate=${(agg && agg.cacheCreationTokens) || 0} ~$${costUsd(agg).toFixed(6)}`,
    );
  }

  // --- utworzenie konwersacji ------------------------------------------------
  srv.on('startConversation', async (req) => {
    const ID = cds.utils.uuid();
    await INSERT.into(Conversations).entries({ ID, title: req.data.title });
    // odczytujemy imiona (domyślne Ola/Tomek z schema.cds) i zwracamy je do UI
    const conv = await SELECT.one.from(Conversations).where({ ID });
    return { conversationId: ID, herName: conv.herName, hisName: conv.hisName };
  });

  // --- wysłanie wiadomości + streaming odpowiedzi doradcy (SSE) --------------
  srv.on('sendMessage', async (req) => {
    const { conversationId, author, text } = req.data;

    if (author === 'ADVISOR') return req.reject(400, 'INVALID_AUTHOR: para nie pisze jako doradca');
    if (!text || !text.trim()) return req.reject(400, 'EMPTY_TEXT');

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
      });
      if (phaseChanged) sse(res, 'phase.change', { phase: decision.phase, topic: decision.topic });
      if (decision.parkAdd) sse(res, 'parked.update', { topics: parkedTopics });

      // Advisor MILCZY — analizuje, ale nie dodaje dymki.
      if (!decision.shouldSpeak) {
        sse(res, 'advisor.wait', { uiHint: decision.uiHint || 'Advisor słucha…' });
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

      let acc = '';
      let usage = null;
      try {
        for await (const ev of advisor.generateReply(history, advisorCtx, decision)) {
          if (ev.type === 'delta') {
            acc += ev.text;
            sse(res, 'advisor.delta', { text: ev.text });
          } else if (ev.type === 'end') {
            acc = ev.text;
            usage = ev.usage || null;
          }
        }
      } catch (e) {
        sse(res, 'error', { code: 'ADVISOR_ERROR', message: String((e && e.message) || e) });
        res.end();
        return;
      }

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
    return { advisorMessageId: advisorId };
  });

  // --- stan reżysera (odtworzenie UI po odświeżeniu) ------------------------
  srv.on('conversationState', async (req) => {
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
    const { conversationId, topicId, action } = req.data;
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

  // --- zagregowane zużycie tokenów dla całej konwersacji --------------------
  srv.on('conversationUsage', async (req) => {
    const cid = req.data.conversationId;
    const agg = await SELECT.one
      .from(Messages)
      .columns(
        'sum(inputTokens) as inputTokens',
        'sum(outputTokens) as outputTokens',
        'sum(cacheReadTokens) as cacheReadTokens',
        'sum(cacheCreationTokens) as cacheCreationTokens',
        'count(*) as messages',
      )
      .where({ conversation_ID: cid, author: 'ADVISOR' });
    return {
      inputTokens: (agg && agg.inputTokens) || 0,
      outputTokens: (agg && agg.outputTokens) || 0,
      cacheReadTokens: (agg && agg.cacheReadTokens) || 0,
      cacheCreationTokens: (agg && agg.cacheCreationTokens) || 0,
      messages: (agg && agg.messages) || 0,
      costUsd: costUsd(agg),
    };
  });
};
