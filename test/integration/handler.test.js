/**
 * Integration handlera ChatService — pełna orkiestracja (decide → persystencja →
 * generateReply → sanitize → INSERT → liczniki/tokeny), z MOCKIEM warstwy AI.
 *
 * 0 TOKENÓW, deterministycznie: wymuszamy ADVISOR=mock PRZED require('@sap/cds')
 * (dotenv w server.js nie nadpisuje już ustawionych zmiennych → couple-adviser.env
 * z ADVISOR=anthropic NIE wygrywa). Bazy nie konfigurujemy — cds.test dla sqlite sam
 * wymusza izolowaną bazę IN-MEMORY (nie dotyka dev-owej db.sqlite).
 *
 * Rozdział: TU sprawdzamy, czy ORKIESTRACJA działa (stan, persystencja, pauza=0 modelu,
 * koszt, kolejność SSE). Czy AI dobrze się ZACHOWUJE — mierzy eval (test/eval).
 */
process.env.ADVISOR = 'mock';

const path = require('path');
const cds = require('@sap/cds');
const { before, test } = require('node:test');
const assert = require('node:assert/strict');

const PROJECT = path.join(__dirname, '..', '..');
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji każdego dnia.';
const MESSAGES = 'couple.adviser.Messages';

let srv, db, server;
before(async () => {
  server = cds.test(PROJECT);
  await server;
  srv = await cds.connect.to('ChatService');
  db = await cds.connect.to('db');
});

const messagesOf = (cid) => db.read(MESSAGES).where({ conversation_ID: cid }).orderBy('seq');

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

// UWAGA: kolejność zdarzeń SSE na drucie (message.user → advisor.decision → advisor.start →
// advisor.delta* → advisor.end) nie jest tu testowana — cds.test w tym środowisku nie wystawia
// osiągalnego po HTTP socketu w procesie (ECONNREFUSED nawet z własnego helpera axios). To liniowa
// sekwencja wywołań sse() bez logiki warunkowej poza shouldSpeak (pokryte testami WAIT/zwykła tura);
// format drutu pozostaje pod kontraktem (CONTRACT.md) i ręcznym demem na żywym Haiku.
