/**
 * Integration: KONTROLA DOSTĘPU (capability token per konwersacja). 0 TOKENÓW (mock).
 *
 * Kontrola WŁĄCZONA (domyślnie). Sprawdzamy, że bez/ze złym `accessToken` akcje
 * dają 403, a z poprawnym działają — oraz że token jednej konwersacji NIE otwiera
 * innej (brak IDOR). Budżety/rate limit wyłączone, by nie kolidowały.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-access-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'true'; // TEN plik testuje dostęp → kontrola ON
process.env.ADVISOR_BUDGET_ENABLED = 'false';
process.env.ADVISOR_GLOBAL_BUDGET_ENABLED = 'false';
process.env.ADVISOR_RATELIMIT_ENABLED = 'false';
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false'; // tworzymy wiele rozmów (A, B…)
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji każdego dnia.';

let srv;
before(async () => {
  rmDb();
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${DB_FILE}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  await cds.test(PROJECT);
  srv = await cds.connect.to('ChatService');
});
after(rmDb);

test('startConversation zwraca niepusty accessToken', async () => {
  const r = await srv.send('startConversation', {});
  assert.ok(r.conversationId);
  assert.ok(typeof r.accessToken === 'string' && r.accessToken.length > 0, 'token wydany');
});

test('sendMessage BEZ tokenu → 403', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG }),
    /FORBIDDEN/i,
  );
});

test('sendMessage ze ZŁYM tokenem → 403', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG, accessToken: 'zły-token' }),
    /FORBIDDEN/i,
  );
});

test('sendMessage z POPRAWNYM tokenem → działa', async () => {
  const { conversationId, accessToken } = await srv.send('startConversation', {});
  const r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG, accessToken });
  assert.ok(r.advisorMessageId, 'tura przeszła');
});

test('getHistory wymaga tokenu (bez → 403, z → lista)', async () => {
  const { conversationId, accessToken } = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG, accessToken });
  await assert.rejects(() => srv.send('getHistory', { conversationId }), /FORBIDDEN/i);
  const hist = await srv.send('getHistory', { conversationId, accessToken });
  assert.ok(Array.isArray(hist) && hist.length >= 1, 'historia z poprawnym tokenem');
});

test('conversationState / setAdvisorMode też wymagają tokenu', async () => {
  const { conversationId, accessToken } = await srv.send('startConversation', {});
  await assert.rejects(() => srv.send('conversationState', { conversationId }), /FORBIDDEN/i);
  const st = await srv.send('conversationState', { conversationId, accessToken });
  assert.equal(st.advisorMode, 'LEADING');
  await assert.rejects(() => srv.send('setAdvisorMode', { conversationId, mode: 'PAUSED' }), /FORBIDDEN/i);
});

test('IDOR: token konwersacji A NIE otwiera konwersacji B', async () => {
  const a = await srv.send('startConversation', {});
  const b = await srv.send('startConversation', {});
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId: b.conversationId, author: 'HER', text: LONG, accessToken: a.accessToken }),
    /FORBIDDEN/i,
    'token A nie działa na B',
  );
});

test('nieistniejąca konwersacja → 403 (brak enumeracji)', async () => {
  await assert.rejects(
    () => srv.send('conversationState', { conversationId: cds.utils.uuid(), accessToken: 'cokolwiek' }),
    /FORBIDDEN/i,
  );
});
