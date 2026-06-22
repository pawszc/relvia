/**
 * Unit testy sanitizeAdvisor — guardrail odpalany na KAŻDEJ dymce doradcy.
 * Czyści markdown i wiodące etykiety mówcy, których UI (czysty tekst) nie renderuje.
 * 0 tokenów, 0 sieci (czysta funkcja, bez ładowania CAP).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAdvisor } = require('../../srv/sanitize');

test('pogrubienie i kursywa → czysty tekst', () => {
  assert.equal(sanitizeAdvisor('To jest **ważne** i *istotne*.'), 'To jest ważne i istotne.');
});

test('osierocone gwiazdki usuwane', () => {
  assert.equal(sanitizeAdvisor('Lista * punkt * drugi'), 'Lista  punkt  drugi');
});

test('nagłówki markdown usuwane', () => {
  assert.equal(sanitizeAdvisor('## Tytuł\ntreść'), 'Tytuł\ntreść');
});

test('cytaty blokowe (>) usuwane', () => {
  assert.equal(sanitizeAdvisor('> cytat\n> drugi'), 'cytat\ndrugi');
});

test('wiodąca etykieta mówcy [On]: usuwana (znany glitch Haiku)', () => {
  assert.equal(sanitizeAdvisor('[On]: czuję, że...'), 'czuję, że...');
  assert.equal(sanitizeAdvisor('[Ona] no właśnie'), 'no właśnie');
});

test('etykieta pogrubiona **[Ona]** też pada (markdown najpierw, potem etykieta)', () => {
  assert.equal(sanitizeAdvisor('**[Ona]** słyszę Cię'), 'słyszę Cię');
});

test('etykieta w środku zdania NIE jest ruszana (tylko wiodąca)', () => {
  assert.equal(sanitizeAdvisor('Mówisz [tak] z troską'), 'Mówisz [tak] z troską');
});

test('zwykły tekst bez artefaktów bez zmian (poza trim)', () => {
  assert.equal(sanitizeAdvisor('  Słyszę Was oboje.  '), 'Słyszę Was oboje.');
});

test('pusty/undefined zwracany bez zmian', () => {
  assert.equal(sanitizeAdvisor(''), '');
  assert.equal(sanitizeAdvisor(undefined), undefined);
});
