/**
 * Unit testy INWARIANTÓW decyzji (srv/advisor/decisionNormalizer.js).
 * 0 tokenów, 0 sieci — czysta funkcja bez SDK.
 *
 * Sedno: model wybiera `type` i proponuje pola pomocnicze, ale inwarianty
 * wykonawcze wynikające z type (w szczególności shouldSpeak i kind) wyznacza
 * deterministycznie kod. Klasa błędu, którą zamykamy: SAFETY_STOP z
 * shouldSpeak=false zostawiał aplikację w milczeniu mimo rozpoznanego zagrożenia.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDecision,
  DecisionInvariantError,
  DECISION_TYPES,
  PHASES,
} = require('../../srv/advisor/decisionNormalizer');

const m = (author, text = 'x') => ({ author, text });
const HIST = [m('HER', 'wypowiedź jej'), m('ADVISOR', 'dymka'), m('HIM', 'wypowiedź jego')];
const STATE = { phase: 'CORE' };

// ── SAFETY_STOP: nie może milczeć, nie przesuwa mediacji ────────────────────
test('SAFETY_STOP z shouldSpeak=false → shouldSpeak=true (luka „milczący kryzys" zamknięta)', () => {
  const out = normalizeDecision(
    { type: 'SAFETY_STOP', shouldSpeak: false, kind: 'INTERVENTION', phase: 'AGREEMENT' },
    HIST,
    STATE,
  );
  assert.equal(out.shouldSpeak, true);
});

test('SAFETY_STOP z kind=INTERVENTION/MODERATION → kind=FULL', () => {
  for (const kind of ['INTERVENTION', 'MODERATION']) {
    const out = normalizeDecision({ type: 'SAFETY_STOP', shouldSpeak: true, kind }, HIST, STATE);
    assert.equal(out.kind, 'FULL', `kind=${kind}`);
  }
});

test('SAFETY_STOP zachowuje poprzednią fazę stanu (ignoruje fazę z decyzji)', () => {
  const out = normalizeDecision(
    { type: 'SAFETY_STOP', shouldSpeak: true, kind: 'FULL', phase: 'AGREEMENT' },
    HIST,
    { phase: 'PERSPECTIVE_A' },
  );
  assert.equal(out.phase, 'PERSPECTIVE_A');
});

test('SAFETY_STOP usuwa composerHint/parkAdd/nextSpeaker (przerywa mediację, nie steruje UI)', () => {
  const out = normalizeDecision(
    {
      type: 'SAFETY_STOP',
      shouldSpeak: true,
      kind: 'FULL',
      phase: 'CORE',
      composerHint: 'napisz coś',
      parkAdd: 'dygresja',
      nextSpeaker: 'HER',
    },
    HIST,
    STATE,
  );
  assert.ok(!('composerHint' in out));
  assert.ok(!('parkAdd' in out));
  assert.ok(!('nextSpeaker' in out));
});

// ── PROTECT: mówi i ma konkretnego adresata ─────────────────────────────────
test('PROTECT z shouldSpeak=false → shouldSpeak=true', () => {
  const out = normalizeDecision(
    { type: 'PROTECT', shouldSpeak: false, kind: 'FULL', phase: 'CORE', nextSpeaker: 'HER' },
    HIST,
    STATE,
  );
  assert.equal(out.shouldSpeak, true);
});

test('PROTECT z nextSpeaker=TOGETHER → PROTECT zostaje AKTYWNY, nextSpeaker/composerHint nieobecne', () => {
  // NIE zgadujemy adresata z historii (ostatni mówca nie musi być osobą skrzywdzoną)
  const out = normalizeDecision(
    {
      type: 'PROTECT',
      shouldSpeak: true,
      kind: 'FULL',
      phase: 'CORE',
      nextSpeaker: 'TOGETHER',
      composerHint: 'podpowiedź bez pewnego adresata',
    },
    HIST, // historia ZAWIERA HER/HIM — mimo to nie służy do zgadywania
    STATE,
  );
  assert.equal(out.type, 'PROTECT');
  assert.equal(out.shouldSpeak, true);
  assert.equal(out.kind, 'FULL');
  assert.ok(!('nextSpeaker' in out), 'adresat nieustalony → pole nieobecne (nigdy TOGETHER)');
  assert.ok(!('composerHint' in out), 'podpowiedź bez pewnego adresata → usunięta');
});

test('PROTECT: poprawny nextSpeaker HER/HIM zostaje zachowany (nie nadpisujemy wskazania)', () => {
  // reżyser tagnął ofiarę (HER), mimo że ostatni pisał HIM — wskazanie ma pierwszeństwo
  const out = normalizeDecision(
    { type: 'PROTECT', shouldSpeak: true, kind: 'FULL', phase: 'CORE', nextSpeaker: 'HER' },
    HIST,
    STATE,
  );
  assert.equal(out.nextSpeaker, 'HER');
});

test('PROTECT bez adresata przy historii TYLKO TOGETHER/ADVISOR → NIE rzuca; ochrona pozostaje aktywna', () => {
  // najważniejszy inwariant: rozpoznany wzorzec krzywdy NIGDY nie degraduje się do
  // zwykłej mediacji tylko dlatego, że nie znamy strony (dawniej: błąd → rulesDecide
  // bez PROTECT). Odpowiedź ochronna pada na wspólnym ekranie bez przypisania głosu.
  const togetherOnly = [m('TOGETHER', 'piszemy razem'), m('ADVISOR', 'dymka')];
  const out = normalizeDecision(
    { type: 'PROTECT', shouldSpeak: true, kind: 'FULL', phase: 'CORE' },
    togetherOnly,
    STATE,
  );
  assert.equal(out.type, 'PROTECT');
  assert.equal(out.shouldSpeak, true);
  assert.equal(out.kind, 'FULL');
  assert.ok(!('nextSpeaker' in out));
  assert.ok(!('composerHint' in out));
});

test('PROTECT zachowuje poprzednią fazę stanu (jak SAFETY_STOP)', () => {
  const out = normalizeDecision(
    { type: 'PROTECT', shouldSpeak: true, kind: 'FULL', phase: 'AGREEMENT', nextSpeaker: 'HER' },
    HIST,
    { phase: 'PARAPHRASE' },
  );
  assert.equal(out.phase, 'PARAPHRASE');
});

// ── INTERVENE / WAIT ────────────────────────────────────────────────────────
test('INTERVENE z shouldSpeak=false i kind=FULL → shouldSpeak=true, kind=INTERVENTION', () => {
  const out = normalizeDecision(
    { type: 'INTERVENE', shouldSpeak: false, kind: 'FULL', phase: 'CORE' },
    HIST,
    STATE,
  );
  assert.equal(out.shouldSpeak, true);
  assert.equal(out.kind, 'INTERVENTION');
});

test('WAIT z shouldSpeak=true → shouldSpeak=false (WAIT nie może przypadkiem generować dymki)', () => {
  const out = normalizeDecision(
    { type: 'WAIT', shouldSpeak: true, kind: 'FULL', phase: 'OPENING' },
    HIST,
    STATE,
  );
  assert.equal(out.shouldSpeak, false);
});

test('WAIT usuwa composerHint, parkAdd i nextSpeaker (topic zostaje jako kotwica stanu)', () => {
  const out = normalizeDecision(
    {
      type: 'WAIT',
      shouldSpeak: false,
      kind: 'FULL',
      phase: 'OPENING',
      composerHint: 'Nie powinno przejść',
      parkAdd: 'Nie powinno zostać zaparkowane',
      nextSpeaker: 'HER',
      topic: 'kotwica tematu',
    },
    HIST,
    STATE,
  );
  assert.ok(!('composerHint' in out));
  assert.ok(!('parkAdd' in out));
  assert.ok(!('nextSpeaker' in out));
  assert.equal(out.topic, 'kotwica tematu');
});

// ── tabelarycznie: cała lista typów ─────────────────────────────────────────
test('każdy typ poza WAIT ma shouldSpeak=true (niezależnie od wartości z modelu)', () => {
  for (const type of DECISION_TYPES) {
    const out = normalizeDecision(
      { type, shouldSpeak: false, kind: 'FULL', phase: 'CORE', nextSpeaker: 'HER' },
      HIST,
      STATE,
    );
    assert.equal(out.shouldSpeak, type !== 'WAIT', type);
  }
});

test('każdy typ poza INTERVENE ma kind=FULL (legacy MODERATION nigdy nie jest emitowane)', () => {
  for (const type of DECISION_TYPES) {
    const out = normalizeDecision(
      { type, shouldSpeak: true, kind: 'MODERATION', phase: 'CORE', nextSpeaker: 'HER' },
      HIST,
      STATE,
    );
    assert.equal(out.kind, type === 'INTERVENE' ? 'INTERVENTION' : 'FULL', type);
  }
});

// ── odrzucanie zepsutego wejścia ────────────────────────────────────────────
test('nieznany typ → DecisionInvariantError (bez cichej zamiany na inny typ)', () => {
  for (const type of ['SPEAK', 'MODERATE', '', undefined, null, 42]) {
    assert.throws(
      () => normalizeDecision({ type, shouldSpeak: true, kind: 'FULL', phase: 'CORE' }, HIST, STATE),
      DecisionInvariantError,
      `type=${JSON.stringify(type)}`,
    );
  }
});

test('null, string i tablica jako decyzja → DecisionInvariantError', () => {
  for (const bad of [null, undefined, 'SAFETY_STOP', ['SAFETY_STOP'], 7]) {
    assert.throws(() => normalizeDecision(bad, HIST, STATE), DecisionInvariantError);
  }
});

// ── faza ────────────────────────────────────────────────────────────────────
test('niepoprawna faza z decyzji → fallback do fazy stanu', () => {
  const out = normalizeDecision(
    { type: 'DEEPEN', shouldSpeak: true, kind: 'FULL', phase: 'NIEZNANA' },
    HIST,
    { phase: 'PARAPHRASE' },
  );
  assert.equal(out.phase, 'PARAPHRASE');
});

test('niepoprawna faza decyzji ORAZ stanu → OPENING', () => {
  for (const state of [{ phase: 'ZŁA' }, {}, { phase: null }]) {
    const out = normalizeDecision(
      { type: 'DEEPEN', shouldSpeak: true, kind: 'FULL', phase: 'ZŁA' },
      HIST,
      state,
    );
    assert.equal(out.phase, 'OPENING');
  }
});

test('poprawna faza z decyzji zostaje (zwykłe typy)', () => {
  for (const phase of PHASES) {
    const out = normalizeDecision(
      { type: 'SUMMARIZE', shouldSpeak: true, kind: 'FULL', phase },
      HIST,
      { phase: 'OPENING' },
    );
    assert.equal(out.phase, phase);
  }
});

// ── higiena pól tekstowych ──────────────────────────────────────────────────
test('trim + limity: composerHint ≤160, topic ≤255, parkAdd ≤255; puste po trim → nieobecne', () => {
  const out = normalizeDecision(
    {
      type: 'REFRAME',
      shouldSpeak: true,
      kind: 'FULL',
      phase: 'CORE',
      composerHint: `  ${'h'.repeat(300)}  `,
      topic: `  ${'t'.repeat(300)}  `,
      parkAdd: '   \n\t  ',
    },
    HIST,
    STATE,
  );
  assert.equal(out.composerHint, 'h'.repeat(160));
  assert.equal(out.topic, 't'.repeat(255));
  assert.ok(!('parkAdd' in out), 'puste po trim → pole usunięte');
});

test('nie-stringi w polach tekstowych → pole nieobecne (nic nie trafia do kolumny DB)', () => {
  const out = normalizeDecision(
    { type: 'REFRAME', shouldSpeak: true, kind: 'FULL', phase: 'CORE', composerHint: 42, topic: {} },
    HIST,
    STATE,
  );
  assert.ok(!('composerHint' in out));
  assert.ok(!('topic' in out));
});

// ── metadane, niemutowanie, idempotencja ────────────────────────────────────
test('usage i liczniki (turnsSinceProgress/escalationStreak) + uiHint/reason przechodzą bez strat', () => {
  const usage = { inputTokens: 200, outputTokens: 30, cacheReadTokens: 5, cacheCreationTokens: 1 };
  const out = normalizeDecision(
    {
      type: 'SUMMARIZE',
      shouldSpeak: true,
      kind: 'FULL',
      phase: 'PARAPHRASE',
      usage,
      turnsSinceProgress: 3,
      escalationStreak: 2,
      uiHint: 'Doradca porządkuje…',
      reason: 'obie strony',
    },
    HIST,
    STATE,
  );
  assert.deepEqual(out.usage, usage);
  assert.equal(out.turnsSinceProgress, 3);
  assert.equal(out.escalationStreak, 2);
  assert.equal(out.uiHint, 'Doradca porządkuje…');
  assert.equal(out.reason, 'obie strony');
});

test('wejściowy obiekt NIE zostaje zmodyfikowany', () => {
  const raw = {
    type: 'SAFETY_STOP',
    shouldSpeak: false,
    kind: 'INTERVENTION',
    phase: 'AGREEMENT',
    composerHint: '  do usunięcia  ',
    nextSpeaker: 'TOGETHER',
  };
  const frozen = JSON.stringify(raw);
  normalizeDecision(raw, HIST, STATE);
  assert.equal(JSON.stringify(raw), frozen, 'raw bajt w bajt nietknięty');
});

test('idempotencja: normalize(normalize(x)) daje identyczny wynik', () => {
  const cases = [
    { type: 'SAFETY_STOP', shouldSpeak: false, kind: 'INTERVENTION', phase: 'AGREEMENT' },
    { type: 'WAIT', shouldSpeak: true, kind: 'FULL', phase: 'ZŁA', composerHint: 'x', parkAdd: 'y' },
    // PROTECT z pewnym adresatem ORAZ bez ustalonego adresata (TOGETHER → pole znika)
    { type: 'PROTECT', shouldSpeak: false, kind: 'MODERATION', phase: 'CORE', nextSpeaker: 'HER' },
    { type: 'PROTECT', shouldSpeak: false, kind: 'MODERATION', phase: 'CORE', nextSpeaker: 'TOGETHER', composerHint: 'x' },
    { type: 'PROTECT', shouldSpeak: true, kind: 'FULL', phase: 'AGREEMENT' },
    {
      type: 'REFRAME',
      shouldSpeak: true,
      kind: 'FULL',
      phase: 'CORE',
      composerHint: `  ${'h'.repeat(300)} x `,
      topic: `${'t'.repeat(254)} końcówka`,
    },
  ];
  for (const raw of cases) {
    const once = normalizeDecision(raw, HIST, STATE);
    const twice = normalizeDecision(once, HIST, STATE);
    assert.deepEqual(twice, once, raw.type);
  }
});
