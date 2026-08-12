/**
 * Capability tokeny konwersacji — hash w spoczynku (JEDNO źródło prawdy).
 *
 * Model: klient dostaje SUROWY token wyłącznie w odpowiedzi startConversation
 * i trzyma go u siebie; baza przechowuje TYLKO wersjonowany digest
 * `v1:` + HMAC-SHA-256(pepper, domena + surowy token) w kolumnie
 * `Conversations.accessToken` (nazwa historyczna — to digest, nie bearer).
 * Wyciek bazy lub /admin nie daje więc gotowego tokenu do przejęcia rozmowy.
 *
 * Moduł jest czysty i deterministyczny: bez CAP, bez bazy, bez sieci — tylko
 * node:crypto. Pepper to sekret serwera (env CAPABILITY_TOKEN_PEPPER); nigdy
 * nie trafia do repo, fly.toml, logów, odpowiedzi API ani bazy — dlatego żaden
 * komunikat błędu z tego modułu nie zawiera wartości peppera ani tokenów.
 */
const crypto = require('node:crypto');

// Domain separation: ten sam pepper użyty kiedyś do innego celu nie wyprodukuje
// kolidującego digestu. Wersja domeny idzie w parze z prefiksem `v1:`.
const TOKEN_DOMAIN = 'relvia:conversation-capability:v1\0';
const DIGEST_PREFIX = 'v1:';
/** Dokładny format przechowywanego digestu: v1: + 64 małe znaki hex. */
const DIGEST_RE = /^v1:[0-9a-f]{64}$/;
// Wygląda jak wersjonowany credential (vN:...) — nawet jeśli wersji nie znamy,
// NIE wolno potraktować tego jako legacy plaintextu (ani porównywać, ani hashować).
// Case-insensitive: "V1:..." też jest formatem wersjonowanym (uszkodzonym), nie plaintextem.
const VERSIONED_RE = /^v\d+:/i;
// Historyczne surowe tokeny były generowane WYŁĄCZNIE przez cds.utils.uuid()
// (RFC 4122, wersje 1–5, poprawny wariant). Tylko DOKŁADNIE taki kształt wolno
// rozważać jako legacy plaintext — dowolny inny string (64 hex bez prefiksu,
// digest bez prefiksu, tekst, wartość z białymi znakami) NIGDY nie jest bearerem.
const LEGACY_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Minimalna długość peppera (bajty UTF-8). Rekomendacja produkcyjna: 32 losowe bajty jako 64 hex. */
const MIN_PEPPER_BYTES = 32;

/** Kontrolowany błąd konfiguracji/kontraktu — komunikat NIGDY nie zawiera sekretów. */
class CapabilityTokenConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapabilityTokenConfigError';
  }
}

/**
 * Waliduje pepper: niepusty string, po trim ≥ 32 bajty UTF-8.
 * @returns {string} pepper po trim (kanoniczna postać używana do HMAC)
 * @throws {CapabilityTokenConfigError} bez ujawniania wartości
 */
function validateCapabilityTokenPepper(pepper) {
  if (typeof pepper !== 'string' || pepper.trim() === '') {
    throw new CapabilityTokenConfigError(
      'CAPABILITY_TOKEN_PEPPER: brak wartości (wymagany sekret serwera do HMAC capability tokenów)',
    );
  }
  const trimmed = pepper.trim();
  if (Buffer.byteLength(trimmed, 'utf8') < MIN_PEPPER_BYTES) {
    throw new CapabilityTokenConfigError(
      `CAPABILITY_TOKEN_PEPPER: za krótki (wymagane co najmniej ${MIN_PEPPER_BYTES} bajty UTF-8)`,
    );
  }
  return trimmed;
}

/**
 * Digest surowego tokenu do zapisu w bazie: v1:hex(HMAC-SHA-256(pepper, domena+token)).
 * @throws {CapabilityTokenConfigError} zły pepper albo pusty/nie-string token
 */
function hashCapabilityToken(rawToken, pepper) {
  const key = validateCapabilityTokenPepper(pepper);
  if (typeof rawToken !== 'string' || rawToken === '') {
    throw new CapabilityTokenConfigError('capability token: surowy token musi być niepustym stringiem');
  }
  const mac = crypto.createHmac('sha256', key).update(TOKEN_DOMAIN + rawToken, 'utf8').digest('hex');
  return DIGEST_PREFIX + mac;
}

/** Czy wartość ma dokładny format przechowywanego digestu v1. */
function isCapabilityTokenDigest(value) {
  return typeof value === 'string' && DIGEST_RE.test(value);
}

/** Czy wartość ma DOKŁADNY kształt historycznego surowego tokenu (UUID RFC 4122). */
function isLegacyCapabilityToken(value) {
  return typeof value === 'string' && LEGACY_TOKEN_RE.test(value);
}

/** Porównanie stałoczasowe dwóch stringów (crypto.timingSafeEqual; różna długość → false). */
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Weryfikacja surowego tokenu względem digestu v1. Token z requestu porównujemy
 * DOKŁADNIE (bez trim). Zły format digestu → false (bez wyjątku ujawniającego dane).
 */
function verifyCapabilityToken(rawToken, storedDigest, pepper) {
  if (typeof rawToken !== 'string' || rawToken === '') return false;
  if (!isCapabilityTokenDigest(storedDigest)) return false;
  return timingSafeEqualStr(hashCapabilityToken(rawToken, pepper), storedDigest);
}

/**
 * Weryfikacja względem WARTOŚCI PRZECHOWYWANEJ, z obsługą legacy plaintextu.
 * FAIL-CLOSED — kolejność decyzji (bez trimowania rawToken ani storedValue):
 *  1. dokładny digest v1 → standardowy HMAC; needsMigration=false,
 *  2. cokolwiek wersjonowanego `vN:` (case-insensitive) → odrzucone; NIGDY
 *     fallback plaintext,
 *  3. DOKŁADNY historyczny UUID (LEGACY_TOKEN_RE) → porównanie stałoczasowe;
 *     needsMigration=true wyłącznie po poprawnym dopasowaniu,
 *  4. każdy inny string → ok=false; żadnego porównania jako bearer, żadnej migracji.
 * Legacy fallback istnieje TYLKO na czas migracji starych baz — zapis nowych
 * konwersacji nigdy nie przechodzi tą ścieżką.
 * @returns {{ok: boolean, needsMigration: boolean}}
 */
function verifyStoredCapabilityToken(rawToken, storedValue, pepper) {
  if (typeof rawToken !== 'string' || rawToken === '') return { ok: false, needsMigration: false };
  if (typeof storedValue !== 'string' || storedValue === '') return { ok: false, needsMigration: false };
  if (isCapabilityTokenDigest(storedValue)) {
    return { ok: verifyCapabilityToken(rawToken, storedValue, pepper), needsMigration: false };
  }
  if (VERSIONED_RE.test(storedValue)) {
    return { ok: false, needsMigration: false }; // nieobsługiwana/uszkodzona wersja — nie plaintext
  }
  if (!isLegacyCapabilityToken(storedValue)) {
    return { ok: false, needsMigration: false }; // nieznany kształt — NIE jest bearerem
  }
  const ok = timingSafeEqualStr(rawToken, storedValue);
  return { ok, needsMigration: ok };
}

module.exports = {
  validateCapabilityTokenPepper,
  hashCapabilityToken,
  isCapabilityTokenDigest,
  isLegacyCapabilityToken,
  verifyCapabilityToken,
  verifyStoredCapabilityToken,
  CapabilityTokenConfigError,
  // stałe wystawione dla testów/migracji (nie zawierają sekretów)
  DIGEST_PREFIX,
  DIGEST_RE,
  VERSIONED_RE,
  LEGACY_TOKEN_RE,
  MIN_PEPPER_BYTES,
  TOKEN_DOMAIN,
};
