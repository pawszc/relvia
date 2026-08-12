#!/usr/bin/env node
/**
 * CLI migracji capability tokenów (uruchamiany PRZED startem serwera):
 *
 *   Dockerfile: npx cds deploy && node srv/migrate-capability-tokens.js && exec npx cds-serve
 *   lokalnie:   npm run migrate:capability-tokens
 *
 * Zamienia legacy surowe tokeny (dokładny UUID) w Conversations.accessToken na
 * digesty v1:HMAC-SHA-256, a dla bazy SQLite wykonuje po migracji fizyczny SCRUB
 * pliku (checkpoint WAL → VACUUM → checkpoint) — patrz capability-token-migration.js.
 * Idempotentny. Przy JAKIMKOLWIEK błędzie (brak/za słaby CAPABILITY_TOKEN_PEPPER,
 * nieznany format credentialu, błąd DB, błąd scrubu) kończy się kodem ≠ 0 →
 * serwer NIE wystartuje (bezpieczne zatrzymanie zamiast degradacji/fałszywej
 * gwarancji). stdout: wyłącznie liczniki. Nieoczekiwane wyjątki są REDAGOWANE
 * (safeMigrationErrorMessage) — surowe e.message mogłoby zawierać dane.
 */
const path = require('node:path');
// te same env co server.js (relvia.env lokalnie; na Fly sekrety są już w process.env)
require('dotenv').config({ path: path.resolve(__dirname, '..', 'relvia.env') });

const { validateCapabilityTokenPepper, CapabilityTokenConfigError } = require('./capability-token');
const {
  migrateCapabilityTokens,
  scrubSqliteFile,
  CapabilityTokenMigrationError,
} = require('./capability-token-migration');

/**
 * Redakcja błędów do logu CLI: tylko ZNANE, kontrolowane klasy mają zaufane
 * komunikaty (pisane bez credentiali). Wszystko inne (sterownik DB, fs, CAP)
 * mogłoby nieść ścieżki/wartości → generyczny komunikat, bez stack trace.
 */
function safeMigrationErrorMessage(error) {
  if (error instanceof CapabilityTokenConfigError || error instanceof CapabilityTokenMigrationError) {
    return error.message;
  }
  return 'nieoczekiwany błąd migracji capability tokenów';
}

async function main() {
  // pepper walidujemy PRZED połączeniem z bazą — bez sekretu nie dotykamy danych
  const pepper = validateCapabilityTokenPepper(process.env.CAPABILITY_TOKEN_PEPPER || '');
  const cds = require('@sap/cds');
  // jawnie ładujemy model projektu (samo connect.to('db') go nie gwarantuje poza
  // pełnym serwerem CAP) — CQN na 'relvia.Conversations' ma być kompilowany z modelu
  cds.model = await cds.load('*', { root: path.resolve(__dirname, '..') });
  const db = await cds.connect.to('db');

  // best effort: secure_delete na połączeniu CAP (pragma jest per-połączenie, więc
  // twardą gwarancję fizycznego usunięcia daje dopiero VACUUM w scrubie poniżej)
  const dbConf = (cds.env.requires && cds.env.requires.db) || {};
  const url = (dbConf.credentials && dbConf.credentials.url) || '';
  const sqliteFile = /sqlite/i.test(dbConf.kind || '') && url && url !== ':memory:' ? url : null;
  if (sqliteFile) await db.run('PRAGMA secure_delete = ON');

  const c = await migrateCapabilityTokens(db, pepper);

  // fizyczny scrub pliku SQLite (zawsze, idempotentnie — usuwa też resztki po
  // przebiegu przerwanym między UPDATE a scrubem); błąd = wyjątek = exit ≠ 0
  if (sqliteFile) scrubSqliteFile(sqliteFile);

  console.log(
    `[capability-token-migration] migrated=${c.migrated} alreadyHashed=${c.alreadyHashed} missing=${c.missing}`,
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[capability-token-migration] BŁĄD:', safeMigrationErrorMessage(e));
      process.exit(1);
    });
}

module.exports = { main, safeMigrationErrorMessage };
