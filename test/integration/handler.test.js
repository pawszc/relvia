/**
 * Integration handlera ChatService — pełna orkiestracja (decide → persystencja →
 * generateReply → sanitize → INSERT → liczniki/tokeny), z MOCKIEM warstwy AI.
 *
 * 0 TOKENÓW, deterministycznie: wymuszamy ADVISOR=mock i bazę IN-MEMORY PRZED require('@sap/cds')
 * (dotenv w server.js nie nadpisuje już ustawionych zmiennych → relvia.env z ADVISOR=anthropic
 * NIE wygrywa). `:memory:` → cds.test świeżo deployuje schemat z ŹRÓDŁA (zawsze aktualny namespace),
 * izolowany od dev-owej db.sqlite (której nie dotykamy) i bez potrzeby pliku w CI.
 *
 * Rozdział: TU sprawdzamy, czy ORKIESTRACJA działa (stan, persystencja, pauza=0 modelu,
 * koszt, kolejność SSE). Czy AI dobrze się ZACHOWUJE — mierzy eval (test/eval).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

// Izolowana baza testowa: wspólny PLIK tymczasowy. NIE `:memory:` — pod `node --test`
// cds.test i handler trafiają w RÓŻNE połączenia in-memory (better-sqlite3 daje osobną
// bazę per połączenie → split → „no such table"). Plik widzą wszystkie połączenia.
// Schemat deployujemy JAWNIE (cds.test nie auto-deployuje do pliku). Dev db.sqlite nietknięta;
// w CI nie trzeba żadnego pliku. ADVISOR=mock + url PRZED require('@sap/cds').
const DB_FILE = path.join(os.tmpdir(), `relvia-itest-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'false'; // ten plik testuje ORKIESTRACJĘ, nie dostęp (osobny: access.test.js)
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false'; // tworzymy wiele rozmów szybko (osobny test: newconv.test.js)
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji każdego dnia.';
const MESSAGES = 'relvia.Messages';

// ten sam singleton warstwy AI co handler (require('./advisor/advisor')) → da się zaślepić
const advisorImpl = require(path.join(PROJECT, 'srv/advisor/advisor'));

/** Podmienia decide/generateReply na czas fn (przywraca w finally). */
async function withAdvisorStub(stub, fn) {
  const orig = { decide: advisorImpl.decide, generateReply: advisorImpl.generateReply };
  if (stub.decide) advisorImpl.decide = stub.decide;
  if (stub.generateReply) advisorImpl.generateReply = stub.generateReply;
  try {
    return await fn();
  } finally {
    advisorImpl.decide = orig.decide;
    advisorImpl.generateReply = orig.generateReply;
  }
}

let srv, server;
before(async () => {
  rmDb(); // świeża baza na start
  // Deploy schematu do pliku przez CLI (sprawdzone; cds.test pod node:test nie deployuje
  // niezawodnie, a programowy cds.deploy bywa kapryśny). Potem cds.test łączy się z tym plikiem.
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${DB_FILE}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  server = cds.test(PROJECT);
  await server;
  srv = await cds.connect.to('ChatService');
});
after(rmDb);

// czytamy z cds.db (ta SAMA baza, do której pisze handler). W trybie :memory: osobne
// cds.connect.to('db') otwierałoby NOWĄ, pustą bazę (split → „no such table").
const messagesOf = (cid) => cds.db.read(MESSAGES).where({ conversation_ID: cid }).orderBy('seq');

test('startConversation: zwraca id + domyślne imiona Ona/On', async () => {
  const r = await srv.send('startConversation', { title: 'test' });
  assert.ok(r.conversationId);
  assert.equal(r.herName, 'Ona');
  assert.equal(r.hisName, 'On');
});

test('zwykła tura: zapis wiadomości pary + dymki doradcy z poprawnym kind/decisionType', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  assert.ok(r.advisorMessageId, 'doradca odpowiedział');

  const msgs = await messagesOf(conversationId);
  assert.equal(msgs.length, 2, 'wiadomość pary + dymka doradcy');
  const user = msgs.find((m) => m.author === 'HER');
  const adv = msgs.find((m) => m.author === 'ADVISOR');
  assert.equal(user.text, LONG);
  assert.equal(adv.kind, 'FULL'); // DEEPEN = pełna dymka
  assert.equal(adv.decisionType, 'DEEPEN'); // pojedyncza treściwa wypowiedź (reguły mocka)
  assert.equal(adv.seq, user.seq + 1, 'dymka doradcy zaraz po wiadomości pary');
  assert.equal(adv.inputTokens, 0, 'mock = zero tokenów');
});

test('stan reżysera persystowany: faza rusza z OPENING po treściwej turze', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  let st = await srv.send('conversationState', { conversationId });
  assert.equal(st.phase, 'OPENING');
  assert.equal(st.advisorMode, 'LEADING');

  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  st = await srv.send('conversationState', { conversationId });
  assert.equal(st.phase, 'PERSPECTIVE_A', 'DEEPEN do HER przesuwa fazę');
  assert.ok(st.topic, 'kotwica tematu ustalona z pierwszej treściwej wypowiedzi');
});

test('tryb „tylko słucha" (PAUSED): ZERO wywołań modelu — doradca milczy', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  // setAdvisorMode(PAUSED) dopisuje szablonowe pożegnanie (dymka ADVISOR, 0 tokenów) — to OK.
  await srv.send('setAdvisorMode', { conversationId, mode: 'PAUSED' });
  const before = await messagesOf(conversationId);
  const advBefore = before.filter((m) => m.author === 'ADVISOR').length;

  const r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  assert.equal(r.advisorMessageId, undefined, 'zwraca echo wiadomości, nie advisorMessageId');

  const after = await messagesOf(conversationId);
  const advAfter = after.filter((m) => m.author === 'ADVISOR').length;
  assert.equal(after.length, before.length + 1, 'doszła TYLKO wiadomość pary');
  assert.equal(advAfter, advBefore, 'doradca NIE dodał nowej dymki (zero reakcji modelu)');
  assert.equal(after.at(-1).author, 'HER', 'ostatnia wiadomość to para, nie doradca');

  const st = await srv.send('conversationState', { conversationId });
  assert.equal(st.advisorMode, 'PAUSED');
});

test('conversationUsage: mock = zero tokenów i zero kosztu', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  const u = await srv.send('conversationUsage', { conversationId });
  assert.equal(u.inputTokens, 0);
  assert.equal(u.outputTokens, 0);
  assert.equal(Number(u.costUsd), 0);
  assert.ok(typeof u.model === 'string' && u.model.length > 0, 'model zapisany');
});

test('parking dygresji: REFRAME przy dygresji tworzy zaparkowany temat', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  // pierwsza treściwa tura ustala kotwicę
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  // dygresja (reguły mocka: DIGRESSION przy ustalonej kotwicy → REFRAME + parkAdd)
  await srv.send('sendMessage', {
    conversationId,
    author: 'HIM',
    text: 'A tak w ogóle to musimy kiedyś pogadać o wakacjach nad morzem, zupełnie inny temat.',
  });
  const st = await srv.send('conversationState', { conversationId });
  assert.ok(st.parkedTopics.length >= 1, 'wątek zaparkowany');
  assert.equal(st.parkedTopics[0].status, 'OPEN');
});

test('WAIT: kontynuacja własnej myśli → doradca milczy (brak NOWEJ dymki)', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  // obie strony muszą najpierw się wypowiedzieć (inaczej reguły mocka forsują ASK_OTHER)
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  await srv.send('sendMessage', { conversationId, author: 'HIM', text: LONG });
  const advBefore = (await messagesOf(conversationId)).filter((m) => m.author === 'ADVISOR').length;

  // krótka kontynuacja TEJ SAMEJ osoby (nie-treść, nie-negacja, ten sam autor → WAIT)
  const r = await srv.send('sendMessage', { conversationId, author: 'HIM', text: 'no właśnie' });
  assert.equal(r.advisorMessageId, null, 'WAIT → advisorMessageId=null (doradca nie mówi)');

  const advAfter = (await messagesOf(conversationId)).filter((m) => m.author === 'ADVISOR').length;
  assert.equal(advAfter, advBefore, 'WAIT nie dodaje nowej dymki doradcy');
});

test('fallback: gdy decide rzuca błąd → handler używa REGUŁ (nie twardego SUMMARIZE); tura nie pada', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await withAdvisorStub({ decide: async () => { throw new Error('boom'); } }, async () => {
    const r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
    assert.ok(r.advisorMessageId, 'mimo błędu decide doradca odpowiedział');
  });
  const adv = (await messagesOf(conversationId)).find((m) => m.author === 'ADVISOR');
  // rulesDecide dla pojedynczej treściwej wypowiedzi = DEEPEN (te same reguły co mock),
  // a nie dawny twardy default SUMMARIZE oderwany od treści tury
  assert.equal(adv.decisionType, 'DEEPEN', 'regułowy fallback zamiast twardego SUMMARIZE');
});

test('fallback awarii + sygnał kryzysu (PL) → rule-based SAFETY_STOP, nie twardy SUMMARIZE', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await withAdvisorStub({ decide: async () => { throw new Error('model down'); } }, async () => {
    const r = await srv.send('sendMessage', {
      conversationId,
      author: 'HER',
      text: 'Boję się o siebie, wczoraj mnie uderzył i nie wiem, co robić.',
    });
    assert.ok(r.advisorMessageId, 'doradca odpowiedział mimo awarii decide');
  });
  const adv = (await messagesOf(conversationId)).find((m) => m.author === 'ADVISOR');
  assert.equal(adv.decisionType, 'SAFETY_STOP', 'regex CRISIS fallbacku klasyfikuje kryzys');
  assert.equal(adv.kind, 'FULL', 'dymka kryzysowa = pełna (inwariant kind)');
});

// ── inwarianty decyzji na granicy handlera (decisionNormalizer) ─────────────
// Stub decide symuluje PRZYSZŁEGO/zepsutego providera zwracającego decyzję
// semantycznie sprzeczną — normalizacja w handlerze musi ją wyprostować
// niezależnie od tego, co robi warstwa advisor.

test('inwarianty: SAFETY_STOP z shouldSpeak=false → doradca MÓWI (kind=FULL), nie milczy', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const contradictory = async () => ({
    type: 'SAFETY_STOP',
    shouldSpeak: false, // luka: model rozpoznał zagrożenie, ale „kazał" milczeć
    kind: 'INTERVENTION',
    phase: 'AGREEMENT',
  });
  let r;
  await withAdvisorStub({ decide: contradictory }, async () => {
    r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  });
  assert.ok(r.advisorMessageId, 'handler NIE wybrał ścieżki milczenia (advisor.wait)');

  const adv = (await messagesOf(conversationId)).find((m) => m.author === 'ADVISOR');
  assert.ok(adv, 'powstała wiadomość ADVISOR');
  assert.equal(adv.decisionType, 'SAFETY_STOP');
  assert.equal(adv.kind, 'FULL', 'kind wyznaczony z typu, nie z decyzji modelu');
});

test('inwarianty: WAIT z shouldSpeak=true + composerHint/parkAdd → milczenie bez skutków ubocznych', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const noisyWait = async () => ({
    type: 'WAIT',
    shouldSpeak: true, // sprzeczność: WAIT nie może generować dymki
    kind: 'INTERVENTION',
    phase: 'OPENING',
    composerHint: 'Nie powinno przejść',
    parkAdd: 'Nie powinno zostać zaparkowane',
  });
  let r;
  await withAdvisorStub({ decide: noisyWait }, async () => {
    r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  });
  assert.equal(r.advisorMessageId, null, 'WAIT → doradca milczy');

  const msgs = await messagesOf(conversationId);
  assert.equal(msgs.filter((m) => m.author === 'ADVISOR').length, 0, 'brak nowej dymki ADVISOR');

  const st = await srv.send('conversationState', { conversationId });
  assert.equal(st.parkedTopics.length, 0, 'parkAdd usunięty przez normalizator → nic nie zaparkowano');

  const conv = await cds.db.read('relvia.Conversations').where({ ID: conversationId });
  assert.ok(!conv[0].lastComposerHint, 'composerHint usunięty → nie utrwalony na konwersacji');
});

test('inwarianty: PROTECT bez nextSpeaker przy historii TOGETHER → ochrona AKTYWNA, bez degradacji', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const protectNoAddressee = async () => ({
    type: 'PROTECT',
    shouldSpeak: false, // sprzeczność: PROTECT nie może milczeć
    kind: 'INTERVENTION',
    phase: 'AGREEMENT', // tor ochronny nie przesuwa mediacji
    // brak nextSpeaker — DECIDE_SCHEMA na to pozwala (pole niewymagane)
  });
  let r;
  await withAdvisorStub({ decide: protectNoAddressee }, async () => {
    r = await srv.send('sendMessage', { conversationId, author: 'TOGETHER', text: LONG });
  });
  assert.ok(r.advisorMessageId, 'powstała odpowiedź ochronna (PROTECT nie zdegradowany do milczenia)');

  const adv = (await messagesOf(conversationId)).find((m) => m.author === 'ADVISOR');
  assert.ok(adv, 'powstała wiadomość ADVISOR');
  assert.equal(adv.decisionType, 'PROTECT', 'decyzja NIE zdegradowana do SUMMARIZE/DEEPEN/INTERVENE');
  assert.equal(adv.kind, 'FULL', 'kind wyznaczony z typu');

  const st = await srv.send('conversationState', { conversationId });
  assert.equal(st.phase, 'OPENING', 'faza rozmowy zachowana (AGREEMENT z decyzji odrzucone)');
});

test('resolveParkedTopic: PROMOTE ustawia kotwicę na temat i zamyka go (OPEN→RESOLVED)', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG }); // kotwica
  await srv.send('sendMessage', {
    conversationId, author: 'HIM',
    text: 'A tak w ogóle to pogadajmy kiedyś o wakacjach nad morzem, inny temat.',
  }); // dygresja → park
  let st = await srv.send('conversationState', { conversationId });
  const parked = st.parkedTopics.find((p) => p.status === 'OPEN');
  assert.ok(parked, 'jest zaparkowany temat OPEN');

  const r = await srv.send('resolveParkedTopic', { conversationId, topicId: parked.id, action: 'PROMOTE' });
  assert.equal(r.ok, true);
  st = await srv.send('conversationState', { conversationId });
  assert.equal(st.topic, parked.text, 'PROMOTE ustawił kotwicę na temat');
  assert.ok(!st.parkedTopics.some((p) => p.id === parked.id && p.status === 'OPEN'), 'temat już nie OPEN');
});

test('conversationUsage: niezerowe tokeny → rozbicie generacja vs decyzja + suma kosztu', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const fakeDecide = async () => ({
    shouldSpeak: true, type: 'SUMMARIZE', kind: 'FULL', phase: 'PARAPHRASE',
    turnsSinceProgress: 0, escalationStreak: 0,
    usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 },
  });
  async function* fakeReply() {
    yield { type: 'delta', text: 'ok' };
    yield { type: 'end', text: 'ok', finishReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 } };
  }
  await withAdvisorStub({ decide: fakeDecide, generateReply: fakeReply }, async () => {
    await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG });
  });

  const u = await srv.send('conversationUsage', { conversationId });
  assert.equal(u.inputTokens, 100, 'generacja in');
  assert.equal(u.outputTokens, 50, 'generacja out');
  assert.equal(u.decideInputTokens, 200, 'decyzja in (narastające)');
  assert.equal(u.decideOutputTokens, 30, 'decyzja out');
  assert.ok(u.generationCostUsd > 0 && u.decideCostUsd > 0, 'oba koszty niezerowe');
  assert.ok(Math.abs(Number(u.costUsd) - (u.generationCostUsd + u.decideCostUsd)) < 1e-9, 'suma = generacja + decyzja');
});

test('walidacja: za długa wiadomość → 413 (cap długości, anty-nadużycie kosztu)', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const tooLong = 'a'.repeat(5000); // > domyślny cap 4000
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId, author: 'HER', text: tooLong }),
    /MESSAGE_TOO_LONG/i,
  );
});

// UWAGA: kolejność zdarzeń SSE na drucie (message.user → advisor.decision → advisor.start →
// advisor.delta* → advisor.end) nie jest tu testowana — cds.test w tym środowisku nie wystawia
// osiągalnego po HTTP socketu w procesie (ECONNREFUSED nawet z własnego helpera axios). To liniowa
// sekwencja wywołań sse() bez logiki warunkowej poza shouldSpeak (pokryte testami WAIT/zwykła tura);
// format drutu pozostaje pod kontraktem (CONTRACT.md) i ręcznym demem na żywym Haiku.
