/**
 * Integration: STARTUPOWA migracja capability tokenów (legacy raw → v1:HMAC).
 * 0 tokenów, 0 sieci — osobna tymczasowa baza SQLite, mock.
 *
 * Testuje RZECZYWISTY kod migracji (srv/capability-token-migration.js) na realnej
 * bazie oraz CLI entrypoint (child_process) w przypadku braku peppera.
 * Komunikaty asercji celowo NIE wypisują wartości tokenów.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-tokmig-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'false'; // testujemy migrację, nie handler dostępu
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false';
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync, spawnSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateCapabilityTokens, CapabilityTokenMigrationError } = require('../../srv/capability-token-migration');
// require CLI NIE uruchamia migracji (guard require.main) — eksporty są testowalne
const { safeMigrationErrorMessage } = require('../../srv/migrate-capability-tokens');
const { hashCapabilityToken, verifyCapabilityToken, CapabilityTokenConfigError } = require('../../srv/capability-token');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');
const CONVERSATIONS = 'relvia.Conversations';
const PEPPER = 'itest-migration-pepper-0123456789abcdef-0123456789';
const DIGEST_RE = /^v1:[0-9a-f]{64}$/;

before(async () => {
  rmDb();
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${DB_FILE}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  await cds.test(PROJECT);
});
after(rmDb);

const readStored = async (ID) =>
  (await cds.db.read(CONVERSATIONS).columns('accessToken').where({ ID }))[0].accessToken;

test('migracja: legacy→HMAC, digest nietknięty, brak zostaje brakiem; drugi przebieg = 0', async () => {
  const idLegacy = cds.utils.uuid();
  const idHashed = cds.utils.uuid();
  const idMissing = cds.utils.uuid();
  const legacyRaw = cds.utils.uuid();
  const preHashed = hashCapabilityToken(cds.utils.uuid(), PEPPER);
  await cds.db.run(INSERT.into(CONVERSATIONS).entries([
    { ID: idLegacy, accessToken: legacyRaw },
    { ID: idHashed, accessToken: preHashed },
    { ID: idMissing, accessToken: null },
  ]));

  const c1 = await migrateCapabilityTokens(cds.db, PEPPER);
  assert.equal(c1.migrated, 1, 'jeden legacy zmigrowany');
  assert.equal(c1.alreadyHashed, 1, 'istniejący digest policzony jako alreadyHashed');
  assert.equal(c1.missing, 1, 'brak credentialu policzony jako missing');

  const migrated = await readStored(idLegacy);
  assert.match(migrated, DIGEST_RE, 'legacy zastąpiony digestem v1');
  assert.notEqual(migrated, legacyRaw, 'digest ≠ surowy token');
  assert.equal(migrated, hashCapabilityToken(legacyRaw, PEPPER), 'digest = HMAC dokładnie tego surowego tokenu');
  assert.equal(await readStored(idHashed), preHashed, 'istniejący digest NIE został podwójnie zahashowany');
  assert.equal(await readStored(idMissing), null, 'brak tokenu pozostał brakiem');

  // IDEMPOTENCJA: drugi przebieg niczego nie zmienia
  const c2 = await migrateCapabilityTokens(cds.db, PEPPER);
  assert.equal(c2.migrated, 0, 'drugi przebieg: migrated=0');
  assert.equal(await readStored(idLegacy), migrated, 'digest stabilny między przebiegami');
});

test('migracja: nieobsługiwane v2:… PRZERYWA bez nadpisywania i bez wartości w błędzie', async () => {
  const idV2 = cds.utils.uuid();
  const idLegacy = cds.utils.uuid();
  const v2Value = 'v2:' + 'a'.repeat(64);
  const legacyRaw = cds.utils.uuid();
  await cds.db.run(INSERT.into(CONVERSATIONS).entries([
    { ID: idV2, accessToken: v2Value },
    { ID: idLegacy, accessToken: legacyRaw },
  ]));

  await assert.rejects(
    () => migrateCapabilityTokens(cds.db, PEPPER),
    (e) =>
      /nieobsługiwanym formacie/.test(e.message) &&
      !e.message.includes(v2Value) &&
      !e.message.includes(legacyRaw) &&
      !e.message.includes(PEPPER) &&
      !e.message.includes(idV2),
    'kontrolowany błąd bez credentiali i bez ID',
  );
  assert.equal(await readStored(idV2), v2Value, 'v2 nietknięte (żadnego podwójnego hasha)');
  assert.equal(await readStored(idLegacy), legacyRaw, 'inne rekordy nietknięte (przerwanie przed zapisem)');
  // sprzątamy rekord v2, by nie psuł innych scenariuszy tego pliku
  await cds.db.run(DELETE.from(CONVERSATIONS).where({ ID: idV2 }));
});

test('migracja: brak peppera → kontrolowany błąd, zero zmian', async () => {
  const id = cds.utils.uuid();
  const legacyRaw = cds.utils.uuid();
  await cds.db.run(INSERT.into(CONVERSATIONS).entries({ ID: id, accessToken: legacyRaw }));
  await assert.rejects(
    () => migrateCapabilityTokens(cds.db, ''),
    /CAPABILITY_TOKEN_PEPPER/,
    'błąd nazywa zmienną (bez wartości)',
  );
  assert.equal(await readStored(id), legacyRaw, 'nic nie nadpisane');
});

// ── FAIL-CLOSED: nieznane kształty przerywają PRZED zapisami ────────────────
for (const [label, badValue] of [
  ['dowolny niewersjonowany string', 'jakis-arbitralny-sekret-nie-uuid'],
  ['64 hex bez prefiksu (stripped digest)', 'c'.repeat(64)],
  ['uppercase V1:<64hex>', 'V1:' + 'd'.repeat(64)],
]) {
  test(`migracja fail-closed (${label}): przerwana przed zapisami, błąd bez credentiali`, async () => {
    const idBad = cds.utils.uuid();
    const idLegacy = cds.utils.uuid();
    const legacyRaw = cds.utils.uuid();
    await cds.db.run(INSERT.into(CONVERSATIONS).entries([
      { ID: idBad, accessToken: badValue },
      { ID: idLegacy, accessToken: legacyRaw },
    ]));

    await assert.rejects(
      () => migrateCapabilityTokens(cds.db, PEPPER),
      (e) =>
        e instanceof CapabilityTokenMigrationError &&
        !e.message.includes(badValue) &&
        !e.message.includes(legacyRaw) &&
        !e.message.includes(PEPPER) &&
        !e.message.includes(idBad),
      'kontrolowany błąd bez wartości/ID/peppera',
    );
    assert.equal(await readStored(idBad), badValue, 'nieznana wartość NIE została auto-zahashowana');
    assert.equal(await readStored(idLegacy), legacyRaw, 'poprawny legacy NIE został ruszony (skan przed zapisem)');
    await cds.db.run(DELETE.from(CONVERSATIONS).where({ ID: { in: [idBad, idLegacy] } }));
  });
}

// ── REDAKCJA nieoczekiwanych błędów CLI ─────────────────────────────────────
test('safeMigrationErrorMessage: nieznany wyjątek jest redagowany (sentinele nie wyciekają)', () => {
  const sentinels = ['FAKE_RAW_TOKEN', 'FAKE_DIGEST', 'FAKE_PEPPER', 'FAKE_CONVERSATION_ID'];
  const noisy = new Error(`boom: token=FAKE_RAW_TOKEN digest=FAKE_DIGEST pepper=FAKE_PEPPER conv=FAKE_CONVERSATION_ID`);
  const msg = safeMigrationErrorMessage(noisy);
  for (const s of sentinels) assert.ok(!msg.includes(s), `sentinel ${s} zredagowany`);
  assert.equal(msg, 'nieoczekiwany błąd migracji capability tokenów', 'wyłącznie generyczny komunikat');
});

test('safeMigrationErrorMessage: znane kontrolowane klasy zachowują swoje komunikaty', () => {
  const cfg = new CapabilityTokenConfigError('CAPABILITY_TOKEN_PEPPER: brak wartości (test)');
  const mig = new CapabilityTokenMigrationError('migracja capability tokenów przerwana (test)');
  assert.equal(safeMigrationErrorMessage(cfg), cfg.message);
  assert.equal(safeMigrationErrorMessage(mig), mig.message);
});

// ── RZECZYWISTY CLI: sukces + fizyczny scrub SQLite (osobne pliki DB) ───────

/** Deploy świeżej bazy + seed przez better-sqlite3 (bez CAP — izolacja od cds.test). */
function seedCliDb(dbFile, rows) {
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${dbFile}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  const Database = require('better-sqlite3');
  const raw = new Database(dbFile);
  const ins = raw.prepare('INSERT INTO relvia_Conversations (ID, accessToken) VALUES (?, ?)');
  for (const [id, token] of rows) ins.run(id, token);
  raw.close();
}

/** Odczyt accessToken bez CAP. */
function readCliStored(dbFile, id) {
  const Database = require('better-sqlite3');
  const raw = new Database(dbFile, { readonly: true });
  const row = raw.prepare('SELECT accessToken FROM relvia_Conversations WHERE ID = ?').get(id);
  raw.close();
  return row && row.accessToken;
}

/** Uruchamia rzeczywisty CLI migracji na wskazanej bazie. */
function runCli(dbFile) {
  return spawnSync(process.execPath, [path.join('srv', 'migrate-capability-tokens.js')], {
    cwd: PROJECT,
    env: { ...process.env, CAPABILITY_TOKEN_PEPPER: PEPPER, cds_requires_db_credentials_url: dbFile },
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('CLI success: legacy+v1+null → exit 0, stdout tylko liczniki, DB poprawna, drugi przebieg migrated=0', () => {
  const CLI_DB = path.join(os.tmpdir(), `relvia-tokmig-cli-${process.pid}.sqlite`);
  const rmCli = () => { for (const f of [CLI_DB, `${CLI_DB}-wal`, `${CLI_DB}-shm`, `${CLI_DB}-journal`]) try { fs.unlinkSync(f); } catch {} };
  rmCli();
  try {
    const idLegacy = cds.utils.uuid();
    const idHashed = cds.utils.uuid();
    const idMissing = cds.utils.uuid();
    const legacyRaw = cds.utils.uuid();
    const preHashed = hashCapabilityToken(cds.utils.uuid(), PEPPER);
    seedCliDb(CLI_DB, [[idLegacy, legacyRaw], [idHashed, preHashed], [idMissing, null]]);

    const r1 = runCli(CLI_DB);
    assert.equal(r1.status, 0, 'pierwszy przebieg: exit 0');
    assert.match(r1.stdout, /\[capability-token-migration\] migrated=1 alreadyHashed=1 missing=1/, 'poprawne liczniki');
    const combined = String(r1.stdout) + String(r1.stderr);
    assert.ok(!combined.includes(legacyRaw), 'stdout/stderr bez surowego tokenu');
    assert.ok(!combined.includes(preHashed), 'stdout/stderr bez digestu');
    assert.ok(!combined.includes(PEPPER), 'stdout/stderr bez peppera');

    assert.equal(readCliStored(CLI_DB, idLegacy), hashCapabilityToken(legacyRaw, PEPPER), 'legacy → digest');
    assert.equal(readCliStored(CLI_DB, idHashed), preHashed, 'digest nietknięty');
    assert.equal(readCliStored(CLI_DB, idMissing), null, 'brak zostaje brakiem');

    const r2 = runCli(CLI_DB);
    assert.equal(r2.status, 0, 'drugi przebieg: exit 0');
    assert.match(r2.stdout, /migrated=0 alreadyHashed=2 missing=1/, 'idempotencja');
  } finally {
    rmCli();
  }
});

test('SCRUB byte-level: po CLI surowy token NIE występuje w pliku DB / -wal / -journal', () => {
  const SCRUB_DB = path.join(os.tmpdir(), `relvia-tokmig-scrub-${process.pid}.sqlite`);
  const rmScrub = () => { for (const f of [SCRUB_DB, `${SCRUB_DB}-wal`, `${SCRUB_DB}-shm`, `${SCRUB_DB}-journal`]) try { fs.unlinkSync(f); } catch {} };
  rmScrub();
  try {
    const id = cds.utils.uuid();
    const legacyRaw = cds.utils.uuid(); // unikalny sentinel — szukamy go bajtowo
    seedCliDb(SCRUB_DB, [[id, legacyRaw]]);
    // sanity: PRZED migracją plaintext fizycznie JEST w plikach (db albo wal)
    const needle = Buffer.from(legacyRaw, 'utf8');
    let preFound = false;
    for (const f of [SCRUB_DB, `${SCRUB_DB}-wal`]) {
      if (fs.existsSync(f) && fs.readFileSync(f).includes(needle)) preFound = true;
    }
    assert.ok(preFound, 'sanity check: przed migracją surowy token jest w bajtach pliku');

    const r = runCli(SCRUB_DB);
    assert.equal(r.status, 0, 'CLI z scrubem: exit 0');

    for (const f of [SCRUB_DB, `${SCRUB_DB}-wal`, `${SCRUB_DB}-journal`]) {
      if (!fs.existsSync(f)) continue;
      assert.ok(!fs.readFileSync(f).includes(needle), `surowy token nieobecny bajtowo w ${path.basename(f)}`);
    }
    const stored = readCliStored(SCRUB_DB, id);
    assert.match(stored, DIGEST_RE, 'digest obecny logicznie w rekordzie');
    assert.equal(verifyCapabilityToken(legacyRaw, stored, PEPPER), true, 'surowy token nadal weryfikuje digest');
  } finally {
    rmScrub();
  }
});

test('CLI entrypoint: brak peppera → exit code ≠ 0, bez dotykania bazy, bez sekretów w stderr', () => {
  const r = spawnSync(process.execPath, [path.join('srv', 'migrate-capability-tokens.js')], {
    cwd: PROJECT,
    env: {
      ...process.env,
      CAPABILITY_TOKEN_PEPPER: '', // jawnie pusty — dotenv NIE nadpisuje ustawionych zmiennych
      cds_requires_db_credentials_url: DB_FILE, // gdyby jednak dotknął DB — tylko testowej
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.notEqual(r.status, 0, 'niezerowy exit code blokuje start serwera (Dockerfile &&)');
  assert.match(String(r.stderr), /CAPABILITY_TOKEN_PEPPER/, 'komunikat nazywa brakującą zmienną');
});
