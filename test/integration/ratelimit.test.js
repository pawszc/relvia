/**
 * Integration: RATE LIMIT per konwersacja. 0 TOKENÓW (mock).
 *
 * Duży odstęp minimalny (100 s) → druga wiadomość w tej samej konwersacji od razu
 * odbita (429). Osobna konwersacja ma własny licznik. Budżet wyłączony, by nie mieszał.
 * Wzorzec bazy/izolacji jak w handler.test.js.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-ratelimit-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'false'; // testujemy rate limit wiadomości, nie dostęp
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false'; // i nie limit nowych rozmów (tworzymy 2)
process.env.ADVISOR_RATELIMIT_ENABLED = 'true';
process.env.ADVISOR_RATELIMIT_MIN_MS = '100000'; // 100 s — druga wiadomość pewnie odbita
process.env.ADVISOR_BUDGET_ENABLED = 'false';
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

test('rate limit: druga szybka wiadomość w tej samej konwersacji → odrzucona (429)', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG }); // pierwsza OK, ustawia stempel
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId, author: 'HIM', text: LONG }),
    /RATE_LIMIT/i,
    'druga w oknie odstępu = 429 RATE_LIMIT',
  );
});

test('rate limit: licznik jest PER konwersacja (świeża rozmowa nie jest blokowana)', async () => {
  const a = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId: a.conversationId, author: 'HER', text: LONG });
  // inna konwersacja — własny licznik, pierwsza wiadomość musi przejść
  const b = await srv.send('startConversation', {});
  const r = await srv.send('sendMessage', { conversationId: b.conversationId, author: 'HER', text: LONG });
  assert.ok('advisorMessageId' in r, 'pierwsza wiadomość w nowej konwersacji przechodzi');
});
