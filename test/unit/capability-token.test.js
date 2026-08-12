/**
 * Unit testy modułu capability tokenów (srv/capability-token.js).
 * 0 tokenów, 0 sieci — czysty node:crypto.
 *
 * Kontrakt: baza trzyma TYLKO `v1:` + HMAC-SHA-256(pepper, domena+token);
 * surowy token widzi wyłącznie klient. Timing-safety zapewnia
 * crypto.timingSafeEqual w kodzie (weryfikacja przez code review, nie pomiar
 * czasu — testy czasowe są z natury flaky).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCapabilityTokenPepper,
  hashCapabilityToken,
  isCapabilityTokenDigest,
  isLegacyCapabilityToken,
  verifyCapabilityToken,
  verifyStoredCapabilityToken,
  CapabilityTokenConfigError,
  DIGEST_RE,
  LEGACY_TOKEN_RE,
  MIN_PEPPER_BYTES,
} = require('../../srv/capability-token');

// pepper testowy — wyłącznie do testów jednostkowych (≥32 bajty)
const PEPPER = 'unit-test-pepper-0123456789abcdef-0123456789abcdef';
const OTHER_PEPPER = 'unit-test-OTHER-pepper-0123456789abcdef-01234567';
const RAW = 'e2b1c3d4-5678-4abc-9def-001122334455';

// ── format i determinizm ────────────────────────────────────────────────────
test('hash ma format v1:<64 lowercase hex>', () => {
  const d = hashCapabilityToken(RAW, PEPPER);
  assert.match(d, DIGEST_RE);
  assert.match(d, /^v1:[0-9a-f]{64}$/);
});

test('ten sam token + ten sam pepper → identyczny digest (deterministycznie)', () => {
  assert.equal(hashCapabilityToken(RAW, PEPPER), hashCapabilityToken(RAW, PEPPER));
});

test('inny token → inny digest', () => {
  assert.notEqual(hashCapabilityToken(RAW, PEPPER), hashCapabilityToken(RAW + 'x', PEPPER));
});

test('inny pepper → inny digest', () => {
  assert.notEqual(hashCapabilityToken(RAW, PEPPER), hashCapabilityToken(RAW, OTHER_PEPPER));
});

// ── weryfikacja ─────────────────────────────────────────────────────────────
test('verify poprawnego tokenu → true', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  assert.equal(verifyCapabilityToken(RAW, stored, PEPPER), true);
});

test('verify złego tokenu → false', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  assert.equal(verifyCapabilityToken('inny-token', stored, PEPPER), false);
});

test('sam zapisany digest podany jako bearer token → false (digest ≠ token)', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  assert.equal(verifyCapabilityToken(stored, stored, PEPPER), false);
  assert.equal(verifyStoredCapabilityToken(stored, stored, PEPPER).ok, false);
});

test('uszkodzony digest → false (bez wyjątku)', () => {
  for (const bad of ['v1:zzzz', 'v1:' + 'a'.repeat(63), 'v1:' + 'A'.repeat(64), 'v1', '', null, 42]) {
    assert.equal(verifyCapabilityToken(RAW, bad, PEPPER), false, String(bad).slice(0, 12));
  }
});

test('nieobsługiwane v2:… → false i NIE jest traktowane jako plaintext', () => {
  const v2 = 'v2:' + 'a'.repeat(64);
  assert.equal(verifyCapabilityToken(RAW, v2, PEPPER), false);
  // nawet gdy „raw token" jest identyczny ze stored — to NIE legacy plaintext
  const r = verifyStoredCapabilityToken(v2, v2, PEPPER);
  assert.equal(r.ok, false);
  assert.equal(r.needsMigration, false);
});

test('pusty / nie-string raw token → false (verify) i kontrolowany błąd (hash)', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  for (const bad of ['', null, undefined, 42, {}]) {
    assert.equal(verifyCapabilityToken(bad, stored, PEPPER), false);
    assert.deepEqual(verifyStoredCapabilityToken(bad, stored, PEPPER), { ok: false, needsMigration: false });
  }
  assert.throws(() => hashCapabilityToken('', PEPPER), CapabilityTokenConfigError);
  assert.throws(() => hashCapabilityToken(null, PEPPER), CapabilityTokenConfigError);
});

// ── pepper ──────────────────────────────────────────────────────────────────
test('brak peppera → kontrolowany błąd (nazywa zmienną, nie wartość)', () => {
  for (const bad of ['', '   ', null, undefined]) {
    assert.throws(
      () => validateCapabilityTokenPepper(bad),
      (e) => e instanceof CapabilityTokenConfigError && /CAPABILITY_TOKEN_PEPPER/.test(e.message),
    );
  }
});

test('pepper krótszy niż 32 bajty → kontrolowany błąd bez ujawnienia wartości', () => {
  const short = 'tylko-31-bajtow-aaaaaaaaaaaaaaa'; // 31 bajtów
  assert.equal(Buffer.byteLength(short, 'utf8'), MIN_PEPPER_BYTES - 1, 'przygotowany przypadek graniczny');
  assert.throws(
    () => validateCapabilityTokenPepper(short),
    (e) => e instanceof CapabilityTokenConfigError && !e.message.includes(short),
  );
});

test('pepper ≥ 32 bajty → zaakceptowany (zwrot po trim)', () => {
  const ok32 = 'rowno-32-bajty-aaaaaaaaaaaaaaaaa'; // 32 bajty
  assert.equal(Buffer.byteLength(ok32, 'utf8'), MIN_PEPPER_BYTES);
  assert.equal(validateCapabilityTokenPepper(ok32), ok32);
  assert.equal(validateCapabilityTokenPepper(`  ${ok32}  `), ok32, 'zewnętrzne spacje ucięte');
});

// ── verifyStored: digest vs legacy ──────────────────────────────────────────
test('verifyStored dla v1 → ok=true, needsMigration=false', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  assert.deepEqual(verifyStoredCapabilityToken(RAW, stored, PEPPER), { ok: true, needsMigration: false });
});

test('verifyStored dla poprawnego legacy raw → ok=true, needsMigration=true', () => {
  assert.deepEqual(verifyStoredCapabilityToken(RAW, RAW, PEPPER), { ok: true, needsMigration: true });
});

test('verifyStored dla błędnego legacy raw → ok=false i needsMigration=false', () => {
  assert.deepEqual(verifyStoredCapabilityToken('inny-token', RAW, PEPPER), { ok: false, needsMigration: false });
});

test('raw token NIE jest trimowany — porównanie dokładne', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  assert.equal(verifyCapabilityToken(` ${RAW}`, stored, PEPPER), false);
  assert.equal(verifyStoredCapabilityToken(`${RAW} `, RAW, PEPPER).ok, false);
});

test('isCapabilityTokenDigest: tylko dokładny format v1', () => {
  assert.equal(isCapabilityTokenDigest(hashCapabilityToken(RAW, PEPPER)), true);
  for (const bad of [RAW, 'v2:' + 'a'.repeat(64), 'v1:' + 'A'.repeat(64), '', null]) {
    assert.equal(isCapabilityTokenDigest(bad), false, String(bad).slice(0, 12));
  }
});

// ── FAIL-CLOSED legacy: tylko dokładny UUID jest kandydatem na plaintext ────
test('cds.utils.uuid() przechodzi isLegacyCapabilityToken (wzorzec zgodny z historycznym generatorem)', () => {
  const cds = require('@sap/cds');
  for (let i = 0; i < 20; i++) {
    const u = cds.utils.uuid();
    assert.equal(isLegacyCapabilityToken(u), true, 'realny uuid akceptowany');
    assert.match(u, LEGACY_TOKEN_RE);
  }
});

test('poprawny legacy UUID nadal daje ok=true, needsMigration=true', () => {
  assert.deepEqual(verifyStoredCapabilityToken(RAW, RAW, PEPPER), { ok: true, needsMigration: true });
});

test('fail-closed: dowolny tekst równy storedValue NIE jest bearerem', () => {
  for (const stored of ['jakis-sekret', 'password123', 'token', RAW + 'x', 'a'.repeat(36)]) {
    const r = verifyStoredCapabilityToken(stored, stored, PEPPER);
    assert.equal(r.ok, false, 'nie-UUID nigdy nie autoryzuje');
    assert.equal(r.needsMigration, false);
  }
});

test('fail-closed: 64 hex bez prefiksu NIE jest bearerem', () => {
  const hex64 = 'a'.repeat(64);
  const r = verifyStoredCapabilityToken(hex64, hex64, PEPPER);
  assert.equal(r.ok, false);
  assert.equal(r.needsMigration, false);
});

test('fail-closed: digest v1 z USUNIĘTYM prefiksem NIE jest bearerem', () => {
  const stripped = hashCapabilityToken(RAW, PEPPER).slice('v1:'.length);
  assert.match(stripped, /^[0-9a-f]{64}$/, 'przygotowany przypadek: sam hex digestu');
  const r = verifyStoredCapabilityToken(stripped, stripped, PEPPER);
  assert.equal(r.ok, false);
  assert.equal(r.needsMigration, false);
});

test('fail-closed: V1:<64hex> (uppercase) = nieobsługiwany format wersjonowany, NIE plaintext', () => {
  const upper = 'V1:' + 'a'.repeat(64);
  const r = verifyStoredCapabilityToken(upper, upper, PEPPER);
  assert.equal(r.ok, false);
  assert.equal(r.needsMigration, false);
  assert.equal(verifyCapabilityToken(RAW, upper, PEPPER), false, 'digest musi być lowercase');
});

test('fail-closed: V2:<64hex> analogicznie odrzucone bez fallbacku plaintext', () => {
  const v2upper = 'V2:' + 'b'.repeat(64);
  const r = verifyStoredCapabilityToken(v2upper, v2upper, PEPPER);
  assert.equal(r.ok, false);
  assert.equal(r.needsMigration, false);
});

test('fail-closed: UUID z leading/trailing whitespace odrzucony (bez trimowania)', () => {
  for (const stored of [` ${RAW}`, `${RAW} `, `\t${RAW}`, `${RAW}\n`]) {
    assert.equal(isLegacyCapabilityToken(stored), false);
    const r = verifyStoredCapabilityToken(stored, stored, PEPPER);
    assert.equal(r.ok, false);
    assert.equal(r.needsMigration, false);
  }
});

test('fail-closed: uszkodzony UUID odrzucony (zła wersja/wariant/długość)', () => {
  const broken = [
    'e2b1c3d4-5678-6abc-9def-001122334455', // wersja 6 — poza 1–5
    'e2b1c3d4-5678-4abc-cdef-001122334455', // zły wariant (c zamiast 8/9/a/b)
    'e2b1c3d4-5678-4abc-9def-0011223344', // za krótki
    'e2b1c3d45678-4abc-9def-001122334455', // brak myślnika
    'g2b1c3d4-5678-4abc-9def-001122334455', // znak spoza hex
  ];
  for (const stored of broken) {
    assert.equal(isLegacyCapabilityToken(stored), false, stored.slice(0, 14));
    const r = verifyStoredCapabilityToken(stored, stored, PEPPER);
    assert.equal(r.ok, false);
    assert.equal(r.needsMigration, false, 'żaden odrzucony przypadek nie proponuje migracji');
  }
});

test('funkcje nie modyfikują argumentów (stringi niemutowalne; obiekt zwrotny świeży)', () => {
  const stored = hashCapabilityToken(RAW, PEPPER);
  const r1 = verifyStoredCapabilityToken(RAW, RAW, PEPPER);
  const r2 = verifyStoredCapabilityToken(RAW, RAW, PEPPER);
  assert.notEqual(r1, r2, 'każde wywołanie zwraca nowy obiekt');
  assert.deepEqual(r1, r2);
  assert.equal(verifyCapabilityToken(RAW, stored, PEPPER), true, 'stan globalny nietknięty między wywołaniami');
});
