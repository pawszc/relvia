/**
 * Deterministyczne INWARIANTY decyzji reżysera — jedno źródło prawdy.
 *
 * Problem, który zamyka ten moduł: model potrafi zwrócić decyzję semantycznie
 * sprzeczną (np. SAFETY_STOP z shouldSpeak=false albo kind=INTERVENTION) i handler,
 * ufając shouldSpeak, zostawiał aplikację w MILCZENIU mimo poprawnie rozpoznanego
 * zagrożenia. Zasada po zmianie: model wybiera `type` i PROPONUJE pola pomocnicze
 * (phase, topic, parkAdd, composerHint, nextSpeaker), ale kod DETERMINISTYCZNIE
 * wyznacza inwarianty wykonawcze wynikające z `type` — w szczególności shouldSpeak
 * i kind.
 *
 * Kontrakt funkcji normalizeDecision(raw, history, state):
 *  - czysta i deterministyczna (bez sieci, bez SDK, bez zegara/losowości),
 *  - NIE mutuje wejścia (zwraca nowy obiekt),
 *  - idempotentna: normalize(normalize(x)) ≡ normalize(x),
 *  - nieznany/brakujący `type` albo nie-obiekt → kontrolowany DecisionInvariantError
 *    (ŻADNEJ cichej zamiany na SUMMARIZE/INTERVENE/SAFETY_STOP — o fallbacku
 *    decyduje wołający, np. rulesDecide w catchu),
 *  - metadane decyzji (usage, liczniki, uiHint, reason, …) przechodzą bez strat.
 *
 * Stosowana na KAŻDEJ ścieżce decyzji: anthropicAdvisor (model + fallback reguł),
 * mockAdvisor oraz dodatkowo na granicy handlera w chat-service.js (obrona przed
 * przyszłym providerem — idempotencja czyni powtórną normalizację bezpieczną).
 */

/** Wszystkie obsługiwane typy decyzji (zamknięta lista — patrz shared/chat-contract.ts). */
const DECISION_TYPES = Object.freeze([
  'WAIT',
  'DEEPEN',
  'ASK_OTHER',
  'CLARIFY',
  'REFRAME',
  'NARROW',
  'CHOOSE',
  'PROPOSE',
  'SUMMARIZE',
  'INTERVENE',
  'PROTECT',
  'SAFETY_STOP',
]);

/** Poprawne fazy rozmowy (Phase z kontraktu). */
const PHASES = Object.freeze([
  'OPENING',
  'PERSPECTIVE_A',
  'PERSPECTIVE_B',
  'PARAPHRASE',
  'CORE',
  'AGREEMENT',
]);

// Limity pól tekstowych: composerHint zgrany z kolumną DB (lastComposerHint:
// String(160)); topic/parkAdd — konserwatywne limity aplikacyjne (kolumny nie
// mają jawnego limitu w schema.cds).
const MAX_COMPOSER_HINT = 160;
const MAX_TOPIC = 255;
const MAX_PARK_ADD = 255;

/** Kontrolowany błąd inwariantu decyzji — wołający decyduje o fallbacku. */
class DecisionInvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecisionInvariantError';
  }
}

/**
 * Normalizacja opcjonalnego pola tekstowego: trim; nie-string albo puste po trim
 * → pole USUNIĘTE; nadmiar przycięty do limitu (i trimEnd po cięciu, żeby druga
 * normalizacja nie zdjęła już żadnego znaku — idempotencja).
 */
function normalizeText(out, field, max) {
  const v = out[field];
  if (typeof v !== 'string') {
    delete out[field];
    return;
  }
  const trimmed = v.trim();
  if (!trimmed) {
    delete out[field];
    return;
  }
  out[field] = trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/**
 * Jedyne źródło prawdy inwariantów decyzji.
 * @param {unknown} rawDecision surowa decyzja (model / reguły / przyszły provider)
 * @param {Array<{author:string}>} history pełna historia konwersacji (część stabilnej
 *   sygnatury — obecnie nieużywana; adresata PROTECT celowo NIE zgadujemy z historii)
 * @param {{phase?:string}} state stan reżysera sprzed tej tury (fallback fazy)
 * @returns {object} nowa, znormalizowana decyzja (wejście nietknięte)
 * @throws {DecisionInvariantError} nie-obiekt / brak type / nieznany type
 */
function normalizeDecision(rawDecision, history = [], state = {}) {
  if (!rawDecision || typeof rawDecision !== 'object' || Array.isArray(rawDecision)) {
    throw new DecisionInvariantError(
      `decyzja nie jest obiektem (otrzymano: ${Array.isArray(rawDecision) ? 'array' : typeof rawDecision})`,
    );
  }
  const type = rawDecision.type;
  if (!DECISION_TYPES.includes(type)) {
    throw new DecisionInvariantError(`nieznany typ decyzji: ${JSON.stringify(type)}`);
  }

  // kopia płytka — zachowuje WSZYSTKIE metadane (usage, liczniki, uiHint, reason, …)
  // i gwarantuje niemutowanie wejścia
  const out = { ...rawDecision };

  // INWARIANT 1: shouldSpeak wynika z TYPU, nie z decyzji modelu.
  // WAIT = jedyny typ milczący; SAFETY_STOP/PROTECT/INTERVENE nie mogą milczeć.
  out.shouldSpeak = type !== 'WAIT';

  // INWARIANT 2: kind wynika z TYPU. Tylko INTERVENE = mała dymka moderacji;
  // wszystko inne (w tym SAFETY_STOP i PROTECT) = pełna, wyraźna dymka.
  // Legacy MODERATION nigdy nie jest emitowane (zostaje tylko w danych historycznych).
  out.kind = type === 'INTERVENE' ? 'INTERVENTION' : 'FULL';

  // INWARIANT 3: faza. Tory ochronne (SAFETY_STOP/PROTECT) NIE przesuwają mediacji —
  // faza zostaje poprzednią poprawną fazą stanu. Zwykłe typy: poprawna faza z decyzji,
  // inaczej faza stanu, ostatecznie OPENING.
  const statePhase = PHASES.includes(state && state.phase) ? state.phase : 'OPENING';
  out.phase =
    type === 'SAFETY_STOP' || type === 'PROTECT'
      ? statePhase
      : PHASES.includes(out.phase)
        ? out.phase
        : statePhase;

  // higiena pól tekstowych (trim + limity aplikacyjne; puste → pole nieobecne)
  normalizeText(out, 'composerHint', MAX_COMPOSER_HINT);
  normalizeText(out, 'topic', MAX_TOPIC);
  normalizeText(out, 'parkAdd', MAX_PARK_ADD);

  // INWARIANT 4: WAIT nie niesie instrukcji do UI ani nie parkuje tematu
  // (topic zostaje — to utrzymywana kotwica stanu, nie instrukcja).
  // SAFETY_STOP analogicznie: przerywa mediację, więc nie steruje kompozytorem,
  // nie parkuje dygresji i nie przekazuje głosu.
  if (type === 'WAIT' || type === 'SAFETY_STOP') {
    delete out.composerHint;
    delete out.parkAdd;
    delete out.nextSpeaker;
  }

  // INWARIANT 5: adresat PROTECT to KONKRETNA osoba (skrzywdzona) — nigdy TOGETHER
  // (ochrona jest asymetryczna). Poprawne wskazanie reżysera (HER/HIM) zostaje.
  // Gdy adresata NIE DA SIĘ ustalić bez zgadywania (brak/TOGETHER/inna wartość):
  // NIE zgadujemy z historii (ostatni mówca nie musi być osobą skrzywdzoną) i NIE
  // rzucamy błędu — rozpoznany wzorzec krzywdy NIGDY nie może zdegradować się do
  // zwykłej mediacji tylko dlatego, że nie znamy strony. PROTECT zostaje aktywny
  // (shouldSpeak=true, kind=FULL, faza stanu), a `nextSpeaker` jest po prostu
  // NIEOBECNY: na wspólnym ekranie pada odpowiedź ochronna bez automatycznego
  // przypisania kolejnego głosu. composerHint też usuwamy — nie wiemy bezpiecznie,
  // do kogo miałaby być skierowana podpowiedź.
  if (type === 'PROTECT' && out.nextSpeaker !== 'HER' && out.nextSpeaker !== 'HIM') {
    delete out.nextSpeaker;
    delete out.composerHint;
  }

  return out;
}

module.exports = {
  normalizeDecision,
  DecisionInvariantError,
  DECISION_TYPES,
  PHASES,
};
