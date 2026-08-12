/**
 * Unit testy warstwy STRAŻNIKÓW i ADRESATA (anthropicAdvisor.__testables).
 * 0 tokenów, 0 sieci — atrapa klucza pozwala załadować moduł bez wołania API
 * (konstruktor SDK waliduje tylko obecność klucza, nie robi requestu).
 * Skupienie: tor ochronny PROTECT + symetria bezpieczeństwa + liczniki + floor.
 */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-dummy';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { __testables } = require('../../srv/advisor/anthropicAdvisor');
const { EVENT_DOOR_BANK } = require('../../srv/advisor/decisionRules');
const { normalizeDecision } = require('../../srv/advisor/decisionNormalizer');

const {
  finalizeDecision,
  replyAudience,
  audienceSteer,
  audienceBinding,
  composerTarget,
  deepenCountForCurrent,
} = __testables;

let seq = 0;
const m = (author, text, decisionType) => ({ author, text, seq: seq++, ...(decisionType && { decisionType }) });
const reset = () => (seq = 0);
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę przeżywam teraz w tej sytuacji.';

// ── replyAudience ──────────────────────────────────────────────────────────
test('replyAudience: typy „do obojga" → TOGETHER (BEZ PROTECT)', () => {
  for (const type of ['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE']) {
    assert.equal(replyAudience({ type }, [m('HER', 'x')]), 'TOGETHER', type);
  }
});

test('replyAudience: PROTECT → wyłącznie jawne wskazanie reżysera (HER/HIM); bez wskazania → undefined', () => {
  // jawne wskazanie ofiary — działa też w edge: sprawca pisał ostatni, dymka do Niej
  assert.equal(replyAudience({ type: 'PROTECT', nextSpeaker: 'HER' }, [m('HIM', 'x')]), 'HER');
  reset();
  assert.equal(replyAudience({ type: 'PROTECT', nextSpeaker: 'HIM' }, [m('HER', 'x')]), 'HIM');
  reset();
  // brak wskazania → ŻADNEGO zgadywania z ostatniego autora (nie musi być osobą skrzywdzoną)
  assert.equal(replyAudience({ type: 'PROTECT' }, [m('HER', 'x')]), undefined);
  reset();
  assert.equal(replyAudience({ type: 'PROTECT' }, [m('HIM', 'x')]), undefined);
  reset();
  // TOGETHER nie jest poprawnym adresatem ochrony → też undefined
  assert.equal(replyAudience({ type: 'PROTECT', nextSpeaker: 'TOGETHER' }, [m('HER', 'x')]), undefined);
});

test('replyAudience: ASK_OTHER → nextSpeaker; reszta → bieżący mówca', () => {
  assert.equal(replyAudience({ type: 'ASK_OTHER', nextSpeaker: 'HIM' }, [m('HER', 'x')]), 'HIM');
  reset();
  assert.equal(replyAudience({ type: 'DEEPEN' }, [m('HER', 'x')]), 'HER');
});

// ── audienceSteer / audienceBinding: symetria torów ochronnych ───────────────
test('audienceSteer: null dla SAFETY_STOP / INTERVENE / PROTECT (bez profilu płci)', () => {
  for (const type of ['SAFETY_STOP', 'INTERVENE', 'PROTECT']) {
    assert.equal(audienceSteer({ type }, [m('HER', 'x')]), null, type);
  }
});

test('audienceSteer: rejestr empatii dla zwykłych typów (nie-null)', () => {
  reset();
  assert.ok(audienceSteer({ type: 'DEEPEN' }, [m('HIM', 'x')])); // HIM register
  assert.ok(audienceSteer({ type: 'SUMMARIZE' }, [m('HER', 'x')])); // TOGETHER register
});

test('audienceBinding: null dla torów ochronnych; wiązanie dla zwykłych', () => {
  for (const type of ['SAFETY_STOP', 'INTERVENE', 'PROTECT']) {
    assert.equal(audienceBinding({ type }, [m('HER', 'x')], {}), null, type);
  }
  reset();
  const bind = audienceBinding({ type: 'DEEPEN' }, [m('HER', LONG)], {});
  assert.match(bind, /ADRESAT TEJ TURY/);
});

test('audienceBinding: ASK_OTHER→HER wiąże w formy ŻEŃSKIE; DEEPEN po HIM w MĘSKIE', () => {
  // strażnik klasy „rozjazd adresata": wiązanie MUSI nazwać właściwą osobę i rodzaj
  reset();
  const ask = audienceBinding({ type: 'ASK_OTHER', nextSpeaker: 'HER' }, [m('HIM', LONG)], {});
  assert.match(ask, /ŻEŃSK|czułaś|powiedziałaś/, 'ASK_OTHER→HER = formy żeńskie do Ony');
  reset();
  const deep = audienceBinding({ type: 'DEEPEN' }, [m('HIM', LONG)], {});
  assert.match(deep, /MĘSK|czułeś|powiedziałeś/, 'DEEPEN po HIM = formy męskie do Niego');
});

// ── finalizeDecision: PROTECT jak tor ochronny ──────────────────────────────
test('finalizeDecision: PROTECT → kind FULL, zeruje liczniki, jawny adresat NIE jest nadpisywany', () => {
  reset();
  // reżyser tagnął ofiarę (HER) MIMO że sprawca (HIM) pisał ostatni — adresat trzyma się ofiary
  const out = finalizeDecision(
    { type: 'PROTECT', shouldSpeak: true, nextSpeaker: 'HER' },
    [m('HER', LONG), m('HIM', 'Jesteś głupia i do niczego.')],
    { turnsSinceProgress: 4, escalationStreak: 3 },
  );
  assert.equal(out.kind, 'FULL');
  assert.equal(out.turnsSinceProgress, 0);
  assert.equal(out.escalationStreak, 0);
  assert.equal(out.nextSpeaker, 'HER'); // skrzywdzona osoba, NIE „oboje", NIE ostatni mówca
});

test('finalizeDecision: PROTECT bez nextSpeaker → undefined (bez zgadywania z ostatniego autora)', () => {
  reset();
  const out = finalizeDecision(
    { type: 'PROTECT', shouldSpeak: true },
    [m('HER', LONG), m('HIM', 'Sama się prosiłaś, wszystko przez ciebie.')],
    { turnsSinceProgress: 2, escalationStreak: 1 },
  );
  assert.equal(out.nextSpeaker, undefined, 'ostatni pisał HIM, ale nie zakładamy, że to on jest adresatem');
});

test('pełny deterministyczny tor: finalizeDecision → normalizeDecision dla PROTECT bez adresata', () => {
  reset();
  const history = [m('HER', LONG), m('HIM', 'Przestań wreszcie histeryzować, zawsze wszystko psujesz.')];
  const state = { phase: 'CORE', turnsSinceProgress: 3, escalationStreak: 1 };
  const finalized = finalizeDecision({ type: 'PROTECT', shouldSpeak: true }, history, state);
  const normalized = normalizeDecision(finalized, history, state);
  assert.equal(normalized.type, 'PROTECT', 'ochrona NIE zdegradowana');
  assert.equal(normalized.shouldSpeak, true);
  assert.equal(normalized.kind, 'FULL');
  assert.equal(normalized.phase, 'CORE', 'faza = poprzedni stan (tor ochronny nie przesuwa mediacji)');
  assert.ok(!('nextSpeaker' in normalized), 'adresat nieustalony → pole nieobecne');
  assert.ok(!('composerHint' in normalized), 'podpowiedź bez pewnego adresata → nieobecna');
});

test('finalizeDecision: SAFETY_STOP zeruje liczniki', () => {
  reset();
  const out = finalizeDecision({ type: 'SAFETY_STOP', shouldSpeak: true }, [m('HER', LONG)], { turnsSinceProgress: 5, escalationStreak: 2 });
  assert.equal(out.turnsSinceProgress, 0);
  assert.equal(out.escalationStreak, 0);
});

test('finalizeDecision: INTERVENE → kind INTERVENTION, streak+1', () => {
  reset();
  const out = finalizeDecision({ type: 'INTERVENE', shouldSpeak: true }, [m('HIM', 'krótko')], { escalationStreak: 1 });
  assert.equal(out.kind, 'INTERVENTION');
  assert.equal(out.escalationStreak, 2);
});

test('finalizeDecision: WAIT nie rusza liczników', () => {
  reset();
  const out = finalizeDecision({ type: 'WAIT', shouldSpeak: false }, [m('HER', 'ok')], { turnsSinceProgress: 2, escalationStreak: 1 });
  assert.equal(out.turnsSinceProgress, 2);
  assert.equal(out.escalationStreak, 1);
});

test('finalizeDecision: niesubstantywna ostatnia tura → turnsSinceProgress+1', () => {
  reset();
  const out = finalizeDecision({ type: 'CLARIFY', shouldSpeak: true }, [m('HER', 'nie')], { turnsSinceProgress: 1 });
  assert.equal(out.turnsSinceProgress, 2);
});

test('finalizeDecision: ANTY-PING-PONG — ASK_OTHER po świeżo zaproszonym + terse → DEEPEN (zostań przy nim)', () => {
  reset();
  // doradca zaprosił Jego (ASK_OTHER), On rzucił terse „sfrustrowany" → nie odbijaj do Niej
  const hist = [
    m('HER', LONG),
    m('ADVISOR', 'A Ty jak to widzisz?', 'ASK_OTHER'),
    m('HIM', 'sfrustrowany'),
  ];
  const out = finalizeDecision({ type: 'ASK_OTHER', shouldSpeak: true, nextSpeaker: 'HER' }, hist, {});
  assert.equal(out.type, 'DEEPEN', 'odbicie głosu zamienione na pogłębienie');
  assert.equal(out.nextSpeaker, 'HIM', 'zostajemy przy świeżo zaproszonym mówcy (On)');
});

test('finalizeDecision: ASK_OTHER NIE jest ruszany, gdy mówca odpowiedział treściwie', () => {
  reset();
  const hist = [
    m('HER', LONG),
    m('ADVISOR', 'A Ty jak to widzisz?', 'ASK_OTHER'),
    m('HIM', 'Jestem sfrustrowany, bo mówię coś, a ona tego w ogóle nie słyszy i czuję się sam.'),
  ];
  const out = finalizeDecision({ type: 'ASK_OTHER', shouldSpeak: true, nextSpeaker: 'HER' }, hist, {});
  assert.equal(out.type, 'ASK_OTHER', 'treściwa odpowiedź → ASK_OTHER zostaje');
});

test('finalizeDecision: bezpiecznik pętli DEEPEN (≥3) → ASK_OTHER do drugiej strony', () => {
  reset();
  const hist = [
    m('HER', LONG),
    m('ADVISOR', 'd1', 'DEEPEN'),
    m('ADVISOR', 'd2', 'DEEPEN'),
    m('ADVISOR', 'd3', 'DEEPEN'),
    m('HER', LONG),
  ];
  const out = finalizeDecision({ type: 'DEEPEN', shouldSpeak: true }, hist, {});
  assert.equal(out.type, 'ASK_OTHER');
  assert.equal(out.nextSpeaker, 'HIM');
});

test('finalizeDecision: FLOOR drzwi — męskie „co czujesz" na zimnym starcie → bank zdarzeń', () => {
  reset();
  const hist = [m('HIM', 'no nie wiem')]; // 0 wypowiedzi substantywnych mężczyzny = zimny start
  const out = finalizeDecision(
    { type: 'DEEPEN', shouldSpeak: true, composerHint: 'Co czujesz, gdy to słyszysz?', nextSpeaker: 'HIM' },
    hist,
    {},
  );
  assert.ok(EVENT_DOOR_BANK.includes(out.composerHint), `hint podmieniony na bank: ${out.composerHint}`);
});

// ── helpery ─────────────────────────────────────────────────────────────────
test('composerTarget: nextSpeaker albo bieżący mówca', () => {
  assert.equal(composerTarget({ nextSpeaker: 'HER' }, { author: 'HIM' }), 'HER');
  assert.equal(composerTarget({}, { author: 'HIM' }), 'HIM');
});

test('deepenCountForCurrent: liczy serię DEEPEN bieżącego mówcy', () => {
  reset();
  const hist = [m('HER', LONG), m('ADVISOR', 'd1', 'DEEPEN'), m('HER', LONG)];
  assert.equal(deepenCountForCurrent(hist), 1);
});
