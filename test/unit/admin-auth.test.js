/**
 * Unit testy bramki AdminService (`checkAdminAuth`). 0 tokenów, 0 sieci.
 * Pilnują, że /admin: bez klucza = wyłączony (503), zły/brak token = 401, poprawny = ok.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkAdminAuth } = require('../../srv/admin-auth');

const KEY = 'super-secret-admin-key';

test('brak skonfigurowanego klucza → 503 (admin wyłączony, bezpieczny default)', () => {
  assert.deepEqual(checkAdminAuth('Bearer cokolwiek', ''), { ok: false, status: 503, message: 'ADMIN_DISABLED' });
  assert.equal(checkAdminAuth('Bearer x', undefined).status, 503);
});

test('klucz ustawiony, brak nagłówka → 401', () => {
  assert.deepEqual(checkAdminAuth(undefined, KEY), { ok: false, status: 401, message: 'UNAUTHORIZED' });
  assert.equal(checkAdminAuth('', KEY).status, 401);
});

test('klucz ustawiony, zły token → 401', () => {
  assert.equal(checkAdminAuth('Bearer inny-token', KEY).status, 401);
});

test('nagłówek bez schematu Bearer → 401', () => {
  assert.equal(checkAdminAuth(KEY, KEY).status, 401, 'sam token bez „Bearer" nie wystarcza');
  assert.equal(checkAdminAuth(`Basic ${KEY}`, KEY).status, 401);
});

test('poprawny Bearer <klucz> → ok (case-insensitive na schemacie)', () => {
  assert.deepEqual(checkAdminAuth(`Bearer ${KEY}`, KEY), { ok: true });
  assert.deepEqual(checkAdminAuth(`bearer ${KEY}`, KEY), { ok: true });
});

test('porównanie pełnego tokenu (prefiks poprawnego klucza nie przechodzi)', () => {
  assert.equal(checkAdminAuth(`Bearer ${KEY.slice(0, -1)}`, KEY).status, 401);
  assert.equal(checkAdminAuth(`Bearer ${KEY}EXTRA`, KEY).status, 401);
});
