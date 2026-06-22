/**
 * Unit testy regułowego silnika (fallback + mock). 0 tokenów, 0 sieci.
 * Pokrywa czyste helpery i drabinę decide() (kolejność priorytetów, liczniki).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  decide,
  speakerLabel,
  isSubstantive,
  shorten,
  FEELING_PROBE,
  EVENT_DOOR_BANK,
} = require('../../srv/advisor/decisionRules');

let seq = 0;
const m = (author, text, decisionType) => ({ author, text, seq: seq++, ...(decisionType && { decisionType }) });
const reset = () => (seq = 0);
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji.'; // >40

test('isSubstantive: próg długości + nie-negacja', () => {
  assert.equal(isSubstantive(LONG), true);
  assert.equal(isSubstantive('nie'), false);
  assert.equal(isSubstantive('nieprawda'), false);
  assert.equal(isSubstantive('krótko'), false);
});

test('shorten: skraca z wielokropkiem', () => {
  assert.equal(shorten('abc'), 'abc');
  const s = shorten('x'.repeat(200), 50);
  assert.ok(s.length <= 50 && s.endsWith('…'));
});

test('speakerLabel: role i własne imiona', () => {
  assert.equal(speakerLabel('HER'), 'Ona');
  assert.equal(speakerLabel('HIM'), 'On');
  assert.equal(speakerLabel('TOGETHER'), 'Razem');
  assert.equal(speakerLabel('HER', { herName: 'Ola' }), 'Ola');
});

test('drzwi composerHint: FEELING_PROBE i bank zdarzeń', () => {
  assert.match('co czujesz, gdy on milczy', FEELING_PROBE);
  assert.match('jak się czujesz', FEELING_PROBE);
  assert.doesNotMatch('co się stało wtedy', FEELING_PROBE);
  assert.ok(Array.isArray(EVENT_DOOR_BANK) && EVENT_DOOR_BANK.length >= 3);
});

test('decide: brak wypowiedzi → WAIT (milczy)', () => {
  reset();
  const d = decide([], {});
  assert.equal(d.type, 'WAIT');
  assert.equal(d.shouldSpeak, false);
});

test('decide: kryzys → SAFETY_STOP (priorytet)', () => {
  reset();
  const d = decide([m('HER', 'Wczoraj uderzył mnie w twarz.')], {});
  assert.equal(d.type, 'SAFETY_STOP');
  assert.equal(d.shouldSpeak, true);
});

test('decide: PAUSED → WAIT (poza kryzysem)', () => {
  reset();
  const d = decide([m('HER', LONG)], { advisorMode: 'PAUSED' });
  assert.equal(d.type, 'WAIT');
  assert.equal(d.shouldSpeak, false);
});

test('decide: eskalacja → INTERVENE + escalationStreak rośnie', () => {
  reset();
  const d = decide([m('HIM', 'Jesteś beznadziejna i do niczego się nie nadajesz.')], { escalationStreak: 1 });
  assert.equal(d.type, 'INTERVENE');
  assert.equal(d.kind, 'INTERVENTION');
  assert.equal(d.escalationStreak, 2);
});

test('decide: krzyk (ALL CAPS) → INTERVENE', () => {
  reset();
  const d = decide([m('HIM', 'PRZESTAŃ NATYCHMIAST')], {});
  assert.equal(d.type, 'INTERVENE');
});

test('decide: dygresja przy ustalonej kotwicy → REFRAME + parkAdd', () => {
  reset();
  const d = decide([m('HER', 'A tak w ogóle to musimy kiedyś pogadać o wakacjach nad morzem.')], { topic: 'podział obowiązków' });
  assert.equal(d.type, 'REFRAME');
  assert.ok(d.parkAdd);
});

test('decide: pojedyncza treściwa wypowiedź → DEEPEN (zostań przy osobie)', () => {
  reset();
  const d = decide([m('HER', LONG)], {});
  assert.equal(d.type, 'DEEPEN');
  assert.equal(d.nextSpeaker, 'HER');
});

test('decide: po 2× DEEPEN z tą samą osobą → ASK_OTHER do drugiej strony', () => {
  reset();
  const hist = [
    m('HER', LONG),
    m('ADVISOR', 'dopytuję', 'DEEPEN'),
    m('ADVISOR', 'dopytuję jeszcze', 'DEEPEN'),
    m('HER', LONG + ' i jeszcze coś.'),
  ];
  const d = decide(hist, {});
  assert.equal(d.type, 'ASK_OTHER');
  assert.equal(d.nextSpeaker, 'HIM');
});

test('decide: krótka negacja → drabina nacisku CLARIFY (tsp≤1)', () => {
  reset();
  const d = decide([m('HER', LONG), m('HIM', 'nieprawda!')], { turnsSinceProgress: 0 });
  assert.equal(d.type, 'CLARIFY');
});

test('decide: obie strony „z treścią" (TOGETHER) → SUMMARIZE', () => {
  reset();
  const d = decide([m('TOGETHER', 'Razem czujemy, że ostatnio się od siebie oddalamy i chcemy to zmienić.')], {});
  assert.equal(d.type, 'SUMMARIZE');
});

test('decide: treściwa wypowiedź zeruje turnsSinceProgress', () => {
  reset();
  const d = decide([m('HER', LONG)], { turnsSinceProgress: 3 });
  assert.equal(d.turnsSinceProgress, 0);
});
