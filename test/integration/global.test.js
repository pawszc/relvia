/**
 * Integration: GLOBALNY DZIENNY LIMIT (cała aplikacja, ostatnie 24h). 0 TOKENÓW (mock + stub).
 *
 * Mały próg globalny ($0.0005) + budżet per-sesja WYŁĄCZONY → izolujemy bezpiecznik
 * globalny. Tura w konwersacji A nalicza koszt (ledger UsageEvents); potem PIERWSZA
 * wiadomość w INNEJ konwersacji B jest już blokowana — to dowód, że limit jest
 * APP-WIDE (między konwersacjami), a nie per-sesja. Wzorzec bazy jak w handler.test.js.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-global-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'false';        // testujemy globalny limit, nie dostęp
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false';     // tworzymy wiele rozmów (A, B, C)
process.env.ADVISOR_BUDGET_ENABLED = 'false';        // izoluj globalny od per-sesja
process.env.ADVISOR_GLOBAL_BUDGET_USD = '0.0005';    // próg poniżej kosztu jednej stubowanej tury
process.env.ADVISOR_RATELIMIT_ENABLED = 'false';
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji każdego dnia.';
const MESSAGES = 'relvia.Messages';

const advisorImpl = require(path.join(PROJECT, 'srv/advisor/advisor'));
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

test('globalny limit jest APP-WIDE: koszt z konwersacji A blokuje INNĄ konwersację B', async () => {
  // konwersacja A — tura nalicza koszt do globalnego okna (ledger)
  const a = await srv.send('startConversation', {});
  const ra = await withStub(() => srv.send('sendMessage', { conversationId: a.conversationId, author: 'HER', text: LONG }));
  assert.ok(ra.advisorMessageId, 'pierwsza tura (gdy globalnie jeszcze pusto) przechodzi normalnie');

  // konwersacja B — świeża, ale globalny próg już przekroczony przez A → read-only z notką
  const b = await srv.send('startConversation', {});
  const rb = await srv.send('sendMessage', { conversationId: b.conversationId, author: 'HIM', text: LONG });
  const msgsB = await messagesOf(b.conversationId);
  const advB = msgsB.find((m) => m.author === 'ADVISOR');
  assert.ok(advB, 'konwersacja B dostała notkę mimo że to jej pierwsza wiadomość');
  assert.match(advB.text, /pula/i, 'ten sam komunikat co przy budżecie per-sesja');
  assert.equal(advB.inputTokens, 0, 'notka to szablon — 0 tokenów');
  assert.ok(rb.advisorMessageId, 'zwraca id notki');
});

test('globalny limit: notka NIE jest dublowana przy kolejnych wiadomościach (dedup)', async () => {
  const a = await srv.send('startConversation', {});
  await withStub(() => srv.send('sendMessage', { conversationId: a.conversationId, author: 'HER', text: LONG })); // przekracza próg
  const c = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId: c.conversationId, author: 'HER', text: LONG }); // 1. wiadomość → notka
  const advAfter1 = (await messagesOf(c.conversationId)).filter((m) => m.author === 'ADVISOR').length;

  await srv.send('sendMessage', { conversationId: c.conversationId, author: 'HIM', text: 'dopiszę jeszcze' }); // 2. → już bez nowej notki
  const advAfter2 = (await messagesOf(c.conversationId)).filter((m) => m.author === 'ADVISOR').length;
  assert.equal(advAfter2, advAfter1, 'druga wiadomość w stanie globalnego limitu nie dokłada kolejnej notki');
  assert.equal((await messagesOf(c.conversationId)).at(-1).author, 'HIM', 'ostatnia wiadomość to para (samo echo)');
});
