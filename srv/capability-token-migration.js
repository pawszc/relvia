/**
 * Migracja capability tokenów w spoczynku: legacy surowe tokeny (DOKŁADNY kształt
 * UUID) w `Conversations.accessToken` → wersjonowany digest `v1:HMAC-SHA-256`.
 *
 * FAIL-CLOSED: skan i walidacja WSZYSTKICH rekordów kończy się PRZED pierwszym
 * UPDATE — nieznany format nigdy nie powoduje częściowej migracji. Klasyfikacja:
 *  - dokładny digest v1        → alreadyHashed (nietykane),
 *  - null/puste                → missing (nietykane),
 *  - dokładny legacy UUID      → do migracji,
 *  - dowolne `vN:` ≠ dokładny v1 (też uppercase / uszkodzony digest z prefiksem)
 *                              → kontrolowany błąd,
 *  - KAŻDA inna wartość (tekst, 64 hex bez prefiksu, digest bez prefiksu,
 *    białe znaki, malformed UUID) → kontrolowany błąd — NIGDY auto-hash.
 *
 * Zapisy to IDEMPOTENTNE guarded UPDATE po (ID + stara wartość) — świadoma
 * decyzja zamiast pełnej transakcji CAP: równoległa lazy-migracja z assertAccess
 * nie zostanie nadpisana, a przerwany przebieg można bezpiecznie powtórzyć.
 *
 * SCRUB SQLITE (fizyczne usunięcie plaintextu z pliku): scrubSqliteFile() —
 * checkpoint WAL (TRUNCATE) → PRAGMA secure_delete=ON → VACUUM (pełna przebudowa
 * pliku: strony zwolnione po UPDATE nie przenoszą się do nowego pliku) → ponowny
 * checkpoint TRUNCATE (VACUUM w trybie WAL pisze przez WAL). Gwarancją jest
 * PRZEBUDOWA pliku przez VACUUM, nie samo secure_delete (pragma jest per-połączenie,
 * a pula CAP może użyć innego połączenia do UPDATE). Granica gwarancji: plik DB,
 * -wal i -journal — NIE obejmuje remanencji na poziomie systemu plików/dysku ani
 * wcześniejszych backupów (patrz DEPLOY.md).
 *
 * Logi/kontrakt zwrotu: WYŁĄCZNIE liczniki. Nigdy ID rozmów, tokenów, digestów
 * ani peppera — także w komunikatach błędów.
 */
const cds = require('@sap/cds');
const {
  validateCapabilityTokenPepper,
  hashCapabilityToken,
  isCapabilityTokenDigest,
  isLegacyCapabilityToken,
  VERSIONED_RE,
} = require('./capability-token');

const CONVERSATIONS = 'relvia.Conversations';

/** Kontrolowany błąd migracji — komunikat NIGDY nie zawiera credentiali, ID ani peppera. */
class CapabilityTokenMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapabilityTokenMigrationError';
  }
}

/**
 * @param {object} db połączenie CAP (`await cds.connect.to('db')` albo cds.db w testach)
 * @param {string} pepper CAPABILITY_TOKEN_PEPPER (walidowany tutaj)
 * @returns {Promise<{migrated:number, alreadyHashed:number, missing:number}>}
 * @throws {CapabilityTokenMigrationError} nieznany format credentialu (fail-closed, przed zapisami)
 */
async function migrateCapabilityTokens(db, pepper) {
  const key = validateCapabilityTokenPepper(pepper);
  const { SELECT, UPDATE } = cds.ql;

  const rows = await db.run(SELECT.from(CONVERSATIONS).columns('ID', 'accessToken'));
  const counters = { migrated: 0, alreadyHashed: 0, missing: 0 };
  const pending = [];

  // FAZA 1: pełny skan + walidacja — kończy się PRZED jakimkolwiek UPDATE
  for (const row of rows) {
    const stored = row.accessToken;
    if (stored === null || stored === undefined || stored === '') {
      counters.missing += 1; // brak credentialu zostaje brakiem (nie fabrykujemy tokenów)
      continue;
    }
    if (isCapabilityTokenDigest(stored)) {
      counters.alreadyHashed += 1; // idempotencja: nigdy podwójnego hashowania
      continue;
    }
    if (VERSIONED_RE.test(stored)) {
      throw new CapabilityTokenMigrationError(
        'migracja capability tokenów przerwana: napotkano wersjonowany credential w nieobsługiwanym formacie',
      );
    }
    if (!isLegacyCapabilityToken(stored)) {
      throw new CapabilityTokenMigrationError(
        'migracja capability tokenów przerwana: napotkano credential w nieznanym kształcie (to nie jest historyczny token UUID)',
      );
    }
    pending.push({ ID: row.ID, legacy: stored });
  }

  // FAZA 2: zapisy (dopiero po pomyślnej walidacji CAŁEGO zbioru)
  for (const p of pending) {
    const digest = hashCapabilityToken(p.legacy, key);
    // guarded update: warunek po STAREJ wartości → nie nadpisze równoległej migracji
    const n = await db.run(
      UPDATE(CONVERSATIONS).set({ accessToken: digest }).where({ ID: p.ID, accessToken: p.legacy }),
    );
    if (n > 0) counters.migrated += 1;
    else counters.alreadyHashed += 1; // ktoś (lazy migration) zdążył pierwszy — OK
  }

  return counters;
}

/**
 * Fizyczny scrub pliku SQLite po migracji (startupowe CLI, przed HTTP).
 * Osobne połączenie better-sqlite3 (poza pulą CAP): checkpoint TRUNCATE →
 * secure_delete=ON → VACUUM → checkpoint TRUNCATE. Rzuca przy niepowodzeniu
 * (wołający kończy proces z kodem ≠ 0 — bez fałszywej gwarancji czystości).
 * @param {string} dbFile ścieżka głównego pliku bazy SQLite
 */
function scrubSqliteFile(dbFile) {
  let raw;
  try {
    const Database = require('better-sqlite3');
    raw = new Database(dbFile);
    raw.pragma('wal_checkpoint(TRUNCATE)'); // domknij WAL zanim przebudujemy plik
    raw.pragma('secure_delete = ON'); // strony zwalniane przez VACUUM są zerowane
    raw.exec('VACUUM'); // pełna przebudowa: stare obrazy wierszy nie przenoszą się
    const wal = raw.pragma('wal_checkpoint(TRUNCATE)'); // VACUUM w WAL pisze przez WAL
    if (Array.isArray(wal) && wal[0] && wal[0].busy) {
      throw new Error('wal checkpoint busy');
    }
  } catch (_e) {
    // celowo generycznie: żadnych ścieżek/wartości z wnętrza wyjątku sterownika
    throw new CapabilityTokenMigrationError(
      'scrub pliku SQLite po migracji nie powiódł się — przerwano start (plaintext mógł nie zostać fizycznie usunięty)',
    );
  } finally {
    if (raw) {
      try {
        raw.close();
      } catch (_e) {
        /* zamknięcie best-effort */
      }
    }
  }
}

module.exports = { migrateCapabilityTokens, scrubSqliteFile, CapabilityTokenMigrationError };
