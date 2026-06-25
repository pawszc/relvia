/**
 * Integration: ANTY-SPAM tworzenia konwersacji (rate-limit startConversation per IP). 0 TOKENÓW.
 *
 * Limit nowych rozmów WŁĄCZONY (domyślnie). W cds.test IP to 'unknown' dla wszystkich
 * wywołań, więc drugie szybkie startConversation jest odbite (429). Reszta limitów off.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-newconv-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_NEWCONV_RATELIMIT = 'true'; // TEN plik testuje limit nowych rozmów
process.env.ADVISOR_NEWCONV_MIN_MS = '100000';  // duży odstęp → drugie pewnie odbite
process.env.ADVISOR_ACCESS_CONTROL = 'false';
process.env.ADVISOR_BUDGET_ENABLED = 'false';
process.env.ADVISOR_GLOBAL_BUDGET_ENABLED = 'false';
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');

let srv;
before(async () => {
  rmDb();
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${DB_FILE}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  await cds.test(PROJECT);
  srv = await cds.connect.to('ChatService');
});
after(rmDb);

test('startConversation: pierwsza przechodzi, druga szybka z tego samego IP → 429', async () => {
  const r = await srv.send('startConversation', {});
  assert.ok(r.conversationId, 'pierwsza rozmowa utworzona');
  await assert.rejects(() => srv.send('startConversation', {}), /RATE_LIMIT/i, 'druga w oknie odstępu odbita');
});
