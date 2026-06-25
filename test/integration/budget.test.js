/**
 * Integration: BUDŻET KONWERSACJI → łagodny read-only. 0 TOKENÓW (mock + stub usage).
 *
 * Mechanika: ustawiamy malutki budżet ($0.0005) i zaślepiamy warstwę AI tak, by tura 1
 * naliczyła realny (mockowy) koszt > progu. Wtedy tura 2 ma wejść w read-only: notka
 * (BUDGET_TEXT, 0 tokenów) + ZERO wołań modelu; tura 3 to już samo echo. Rate limit
 * wyłączony, by nie kolidował. Wzorzec bazy/izolacji jak w handler.test.js.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-budget-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'false'; // testujemy budżet, nie dostęp
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false'; // wiele rozmów w teście
process.env.ADVISOR_BUDGET_USD = '0.0005'; // próg poniżej kosztu jednej stubowanej tury
process.env.ADVISOR_RATELIMIT_ENABLED = 'false'; // nie mieszać z testem rate limitu
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji każdego dnia.';
const MESSAGES = 'relvia.Messages';
const CONVERSATIONS = 'relvia.Conversations';

const advisorImpl = require(path.join(PROJECT, 'srv/advisor/advisor'));

// stub: decide MÓWI i zgłasza usage; generateReply zgłasza usage → realny koszt > progu
const STUB = {
  decide: async () => ({
    shouldSpeak: true, type: 'SUMMARIZE', kind: 'FULL', phase: 'PARAPHRASE',
    turnsSinceProgress: 0, escalationStreak: 0,
    usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 },
  }),
  generateReply: async function* () {
    yield { type: 'delta', text: 'ok' };
    yield { type: 'end', text: 'ok', finishReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 } };
  },
};
async function withStub(fn) {
  const orig = { decide: advisorImpl.decide, generateReply: advisorImpl.generateReply };
  advisorImpl.decide = STUB.decide;
  advisorImpl.generateReply = STUB.generateReply;
  try { return await fn(); } finally { Object.assign(advisorImpl, orig); }
}

let srv;
before(async () => {
  rmDb();
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${DB_FILE}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  await cds.test(PROJECT);
  srv = await cds.connect.to('ChatService');
});
after(rmDb);

const messagesOf = (cid) => cds.db.read(MESSAGES).where({ conversation_ID: cid }).orderBy('seq');
const convOf = (cid) => cds.db.read(CONVERSATIONS).where({ ID: cid }).then((r) => r[0]);

test('budżet: tura w granicy budżetu działa normalnie (doradca mówi)', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  const r = await withStub(() => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG }));
  assert.ok(r.advisorMessageId, 'tura 1 normalna: doradca odpowiedział');
  const conv = await convOf(conversationId);
  assert.ok(!conv.budgetReached, 'budżet jeszcze nieosiągnięty po turze 1');
});

test('budżet: po przekroczeniu progu → read-only z notką (BUDGET_TEXT), zero wołań modelu', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  // tura 1 nalicza koszt > progu
  await withStub(() => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG }));

  // tura 2 — gate musi zadziałać PRZED jakimkolwiek wołaniem modelu; gdyby stub był
  // potrzebny, oznaczałoby to, że model został wywołany. Dlatego BEZ stuba.
  const r2 = await srv.send('sendMessage', { conversationId, author: 'HIM', text: LONG });
  assert.ok(r2.advisorMessageId, 'tura 2 zwraca id notki budżetowej');

  const msgs = await messagesOf(conversationId);
  const lastAdv = msgs.filter((x) => x.author === 'ADVISOR').at(-1);
  assert.match(lastAdv.text, /pula/i, 'doradca zostawił notkę budżetową');
  assert.equal(lastAdv.inputTokens, 0, 'notka to szablon — 0 tokenów');
  assert.equal(lastAdv.decisionType, null, 'notka nie jest decyzją reżysera');

  const conv = await convOf(conversationId);
  assert.equal(conv.budgetReached, true, 'flaga read-only ustawiona');
});

test('budżet: kolejna tura po wyczerpaniu = SAMO echo wiadomości pary (bez nowej dymki)', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await withStub(() => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG })); // przekracza próg
  await srv.send('sendMessage', { conversationId, author: 'HIM', text: LONG }); // tura 2 → notka
  const advAfterNotice = (await messagesOf(conversationId)).filter((x) => x.author === 'ADVISOR').length;

  // tura 3 — już tylko echo
  const r3 = await srv.send('sendMessage', { conversationId, author: 'HER', text: 'jeszcze coś dopiszę' });
  assert.equal(r3.advisorMessageId, undefined, 'tura 3: brak nowej dymki (sama wiadomość pary)');
  const advAfter3 = (await messagesOf(conversationId)).filter((x) => x.author === 'ADVISOR').length;
  assert.equal(advAfter3, advAfterNotice, 'doradca nie dodał kolejnej dymki po wyczerpaniu');
  assert.equal((await messagesOf(conversationId)).at(-1).author, 'HER', 'ostatnia wiadomość to para');
});
