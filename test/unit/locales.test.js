/**
 * Unit: wspólny moduł locale (shared/locales.mjs) — jedno źródło prawdy pl/en/de.
 * 0 tokenów, 0 sieci. Backend czyta go przez require(ESM) — ten test pilnuje też,
 * że to wciąż działa (Node ≥22.12).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALE_NATIVE_NAMES,
  normalizeLocale,
  normalizeLocaleOrDefault,
} = require('../../shared/locales.mjs');

test('lista obsługiwanych języków: dokładnie pl/en/de, domyślny pl', () => {
  assert.deepEqual([...SUPPORTED_LOCALES], ['pl', 'en', 'de']);
  assert.equal(DEFAULT_LOCALE, 'pl');
  assert.equal(LOCALE_STORAGE_KEY, 'relvia.locale.v1');
});

test('nazwy natywne dla przełącznika (bez flag): Polski/English/Deutsch', () => {
  assert.equal(LOCALE_NATIVE_NAMES.pl, 'Polski');
  assert.equal(LOCALE_NATIVE_NAMES.en, 'English');
  assert.equal(LOCALE_NATIVE_NAMES.de, 'Deutsch');
});

test('normalizacja wariantów regionalnych → język bazowy', () => {
  assert.equal(normalizeLocale('pl'), 'pl');
  assert.equal(normalizeLocale('pl-PL'), 'pl');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('en-GB'), 'en');
  assert.equal(normalizeLocale('de-DE'), 'de');
  assert.equal(normalizeLocale('de-AT'), 'de');
  assert.equal(normalizeLocale('de-CH'), 'de');
});

test('normalizacja: case-insensitive i podkreślenia', () => {
  assert.equal(normalizeLocale('PL'), 'pl');
  assert.equal(normalizeLocale('De-de'), 'de');
  assert.equal(normalizeLocale('en_US'), 'en');
  assert.equal(normalizeLocale('  de-CH  '), 'de');
});

test('nieobsługiwane/uszkodzone wejście → null (nigdy surowy tekst)', () => {
  for (const bad of ['fr-FR', 'uk', 'plx', '', '  ', null, undefined, 42, {}, [], 'de<script>', '"; DROP TABLE --']) {
    assert.equal(normalizeLocale(bad), null, JSON.stringify(bad));
  }
  // prefiks przed myślnikiem musi być DOKŁADNIE obsługiwanym językiem
  assert.equal(normalizeLocale('den-DE'), null);
});

test('normalizeLocaleOrDefault: kontrakt backendu — nieznane/brak → pl', () => {
  assert.equal(normalizeLocaleOrDefault('de-AT'), 'de');
  assert.equal(normalizeLocaleOrDefault('fr-FR'), 'pl');
  assert.equal(normalizeLocaleOrDefault(undefined), 'pl');
  assert.equal(normalizeLocaleOrDefault(null), 'pl');
});
