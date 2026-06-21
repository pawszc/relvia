/**
 * Regułowy silnik decyzji reżysera. Czysta funkcja: (history, state, ctx) → AdvisorDecision.
 *
 * ROLA (po zbudowaniu silnika): NIE jest to główny tor. W produkcji decyzje — w tym
 * bezpieczeństwo, eskalacja, dygresja — podejmuje MODEL (anthropicAdvisor) semantycznie
 * i WIELOJĘZYCZNIE. Ten moduł służy jako:
 *   (1) FALLBACK — gdy model padnie / zwróci zły JSON / timeout,
 *   (2) MOCK — tryb offline (ADVISOR=mock): bogate zachowanie bez tokenów (dev/demo).
 *
 * WIELOJĘZYCZNOŚĆ: poniższe wzorce są PL‑only i celowo proste — to best‑effort siatka po
 * polsku, NIE wielojęzyczny detektor. Świadomie ich NIE rozbudowujemy pod inne języki
 * (regex po polsku się nie skaluje) — od wielojęzyczności jest model. Konsekwencja: przy
 * (rzadkiej) awarii modelu w rozmowie nie‑polskiej fallback nie złapie kryzysu/eskalacji.
 *
 * WYJĄTKI działające też w torze MODELU (importowane przez anthropicAdvisor): `isSubstantive`
 * liczy `turnsSinceProgress`, ale jest zdominowany przez próg DŁUGOŚCI (≥40 zn.) → degraduje
 * łagodnie dla obcych języków; `isShouting` (CAPS / „!") jest z natury językowo‑neutralny.
 */

// Sygnały kryzysu/przemocy → tor bezpieczeństwa (priorytet ponad wszystkim).
const CRISIS =
  /(zabić|zabij|skrzywdz|przemoc|uderzy|bije|boję się o|chcę zniknąć|nie chcę żyć|odebrać sobie życie|samobój)/i;

// Krótka, ogólna negacja bez treści — "nieprawda", "bzdura", "przesadzasz", "nie".
const SHORT_NEGATION = /^(nie|tak|nieprawda|bzdura|przesadzasz|wcale nie|właśnie że|kłamiesz)\b[\s.!?]*$/i;

// Marker dygresji — sygnał, że ktoś otwiera nowy wątek obok bieżącego tematu.
const DIGRESSION =
  /(\ba (tak )?w ogóle\b|przy okazji|swoją drogą|poza tym|\bno i jeszcze\b|innym razem|zmieniając temat|odbiegając|aha i)/i;

// Krok 3: eskalacja — wyzwiska, pogarda, oskarżenia personalne, wulgaryzmy.
const ESCALATION =
  /(idiot|debil|kretyn|głup|beznadziejn|żałosn|egoist|samolub|leniw|kłam|nienawidz|zamknij się|spierdal|pierdol|gówn|chrzań|kurwa|do diabła|olewasz|masz mnie gdzieś|przez ciebie|twoja wina|ty zawsze|ty nigdy)/i;

// ── „Drzwi wejścia" composerHint (PL best-effort, jak wyżej) ───────────────────
// Deterministyczny FLOOR doboru drzwi w composerHint: na zimnym starcie męskie
// „co czujesz" zamieniamy na wejście przez zdarzenie. Działa TYLKO po polsku —
// główny tor (semantyczny, wielojęzyczny) to prompt reżysera. Konsumuje to
// anthropicAdvisor.finalizeDecision. „Zimny start" = bramka strukturalna (liczba
// wypowiedzi „z treścią") liczona TAM, nie tu — językowo neutralna.
// WIELOJĘZYCZNY UPGRADE (kiedyś): trigger PL `FEELING_PROBE` zastąpić etykietą drzwi
// od modelu (composerHintDoor: FEELING|EVENT), a `EVENT_DOOR_BANK` — hintem od modelu
// w danym języku; wtedy obie poniższe stałe znikają (opcja C z analizy).
// FEELING_PROBE — hint pyta o uczucie wprost („co czujesz", „jak się czujesz").
const FEELING_PROBE = /\b(co|jak)\b[^?]*\bczuj/i;
// EVENT_DOOR_BANK — gotowe drzwi przez zdarzenie (ogólne, gdy floor podmienia hint).
const EVENT_DOOR_BANK = [
  'Co się stało, gdy to usłyszałeś?',
  'Co Ci wtedy chodziło po głowie?',
  'Co zrobiłeś w tamtym momencie?',
  'Opowiedz, jak to wyglądało u Ciebie.',
];

/** Krzyk: ALL CAPS (≥6 liter) albo nagromadzenie wykrzykników. */
function isShouting(text) {
  const letters = text.replace(/[^a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) return true;
  if ((text.match(/!/g) || []).length >= 3) return true;
  return false;
}

const isEscalating = (text) => ESCALATION.test(text) || isShouting(text);

const isCouple = (m) => m.author !== 'ADVISOR';
const speakerLabel = (author, ctx = {}) =>
  author === 'HER' ? ctx.herName || 'Ona' : author === 'HIM' ? ctx.hisName || 'On' : 'Razem';

/** Wypowiedź "z treścią" — popycha rozmowę do przodu (nie negacja, nie urywek). */
const isSubstantive = (text) => text.trim().length >= 40 && !SHORT_NEGATION.test(text.trim());

/** Skrót długiej wypowiedzi do etykiety kotwicy/zaparkowanego tematu. */
const shorten = (text, n = 120) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
};

/** Które strony pary już się wypowiedziały (TOGETHER liczy się jako obie). */
function sidesSpoken(history) {
  const s = new Set();
  for (const m of history) {
    if (m.author === 'HER') s.add('HER');
    else if (m.author === 'HIM') s.add('HIM');
    else if (m.author === 'TOGETHER') {
      s.add('HER');
      s.add('HIM');
    }
  }
  return s;
}

/** Czy w historii pojawiła się już parafraza doradcy (decyduje o przejściu do CORE). */
const hasParaphrased = (history) =>
  history.some((m) => m.author === 'ADVISOR' && m.decisionType === 'SUMMARIZE');

/** Ile razy z rzędu doradca pogłębiał (DEEPEN) z OBECNYM mówcą (od wypowiedzi drugiej strony). */
function deepenCountForCurrent(history) {
  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];
  if (!last || last.author === 'TOGETHER') return 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.author === 'ADVISOR') {
      if (m.decisionType === 'DEEPEN') count++;
    } else if (m.author !== last.author) break;
  }
  return count;
}

/** @returns {import('../../shared/chat-contract').AdvisorDecision} */
function decide(history, state = {}, context = {}) {
  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];
  const prev = couple[couple.length - 2];
  const tsp = state.turnsSinceProgress || 0;
  const phase = state.phase || 'OPENING';

  if (!last) {
    return { shouldSpeak: false, type: 'WAIT', kind: 'FULL', phase: 'OPENING', uiHint: 'Doradca słucha w milczeniu…', turnsSinceProgress: 0, escalationStreak: 0 };
  }

  // 1) tor bezpieczeństwa — zawsze pierwszy (działa też w pauzie)
  if (CRISIS.test(last.text)) {
    return { shouldSpeak: true, type: 'SAFETY_STOP', kind: 'FULL', phase, topic: state.topic, turnsSinceProgress: 0, escalationStreak: 0, reason: 'sygnał kryzysu' };
  }

  // 1b) „TYLKO SŁUCHA" (PAUSED) — obrona w głębi: doradca milczy. W realnym backendzie
  //     ta gałąź jest nieosiągalna (handler w trybie PAUSED w ogóle nie woła decide),
  //     ale zostaje jako zabezpieczenie dla fallbacku.
  if (state.advisorMode === 'PAUSED') {
    return {
      shouldSpeak: false,
      type: 'WAIT',
      kind: 'FULL',
      phase,
      topic: state.topic,
      turnsSinceProgress: tsp,
      escalationStreak: state.escalationStreak || 0,
      uiHint: 'Doradca przysłuchuje się w tle…',
      reason: 'pauza',
    };
  }

  const substantive = isSubstantive(last.text);
  const newTsp = substantive ? 0 : tsp + 1;

  // kotwica tematu: pierwsza wypowiedź "z treścią" ustala, o czym rozmawiamy
  const topic = state.topic || (substantive ? shorten(last.text) : undefined);

  // 2) eskalacja (krok 3) — ostre słowa/krzyk → krótka moderacja w „luce przekazania".
  //    Ma priorytet ponad zwykłym tokiem (oddanie głosu, pętla), poniżej bezpieczeństwa.
  if (isEscalating(last.text)) {
    const newStreak = (state.escalationStreak || 0) + 1;
    return {
      shouldSpeak: true,
      type: 'INTERVENE',
      kind: 'INTERVENTION',
      phase,
      topic,
      escalationStreak: newStreak,
      turnsSinceProgress: newTsp,
      uiHint: 'Doradca łagodzi napięcie…',
      reason: `eskalacja (${newStreak})`,
    };
  }

  // od tego miejsca tura jest "spokojna" → zerujemy rozpęd kłótni
  // 3) dygresja → zaparkuj i wróć do kotwicy (nie ucinaj — odłóż)
  if (topic && DIGRESSION.test(last.text)) {
    return {
      shouldSpeak: true,
      type: 'REFRAME',
      kind: 'FULL',
      phase,
      topic,
      parkAdd: shorten(last.text),
      turnsSinceProgress: newTsp,
      escalationStreak: 0,
      reason: 'dygresja → parking',
    };
  }

  // 3b) POGŁĘBIENIE — zanim oddamy głos/sparafrazujemy, zostań przy mówiącej osobie i
  //     dopytaj. Gate na treściowości = adaptacyjnie: płytka/urywana odpowiedź NIE
  //     pogłębia (leci dalej), a sufit 2× chroni przed pętlą pytań.
  if (last.author !== 'TOGETHER' && substantive && deepenCountForCurrent(history) < 2) {
    return {
      shouldSpeak: true,
      type: 'DEEPEN',
      kind: 'FULL',
      phase: last.author === 'HER' ? 'PERSPECTIVE_A' : 'PERSPECTIVE_B',
      topic,
      nextSpeaker: last.author,
      turnsSinceProgress: 0,
      escalationStreak: 0,
      uiHint: 'Doradca dopytuje…',
      reason: `pogłębienie (${deepenCountForCurrent(history) + 1})`,
    };
  }

  // 4) wypowiedziała się tylko jedna strona → oddaj głos drugiej
  const spoken = sidesSpoken(history);
  if (last.author !== 'TOGETHER' && spoken.size < 2) {
    const nextSpeaker = last.author === 'HER' ? 'HIM' : 'HER';
    return {
      shouldSpeak: true,
      type: 'ASK_OTHER',
      kind: 'FULL',
      phase: last.author === 'HER' ? 'PERSPECTIVE_B' : 'PERSPECTIVE_A',
      nextSpeaker,
      topic,
      turnsSinceProgress: newTsp,
      escalationStreak: 0,
      uiHint: `Doradca czeka na perspektywę: ${speakerLabel(nextSpeaker, context)}`,
      reason: 'jedna strona',
    };
  }

  // 5) brak postępu (negacja / urywek)
  if (!substantive) {
    // krótka kontynuacja WŁASNEJ myśli (nie negacja) → daj przestrzeń, milcz
    if (!SHORT_NEGATION.test(last.text.trim()) && prev && prev.author === last.author) {
      return { shouldSpeak: false, type: 'WAIT', kind: 'FULL', phase, topic, turnsSinceProgress: newTsp, escalationStreak: 0, uiHint: 'Doradca słucha w milczeniu…', reason: 'kontynuacja' };
    }
    // stopniowany nacisk — nazwij pętlę i pchnij w konstruktywną stronę
    const ladder =
      newTsp <= 1 ? 'CLARIFY' : newTsp === 2 ? 'REFRAME' : newTsp === 3 ? 'NARROW' : newTsp === 4 ? 'CHOOSE' : 'PROPOSE';
    const ladderPhase = newTsp >= 5 ? 'AGREEMENT' : newTsp >= 2 ? 'CORE' : phase;
    return { shouldSpeak: true, type: ladder, kind: 'FULL', phase: ladderPhase, topic, turnsSinceProgress: newTsp, escalationStreak: 0, reason: `brak postępu (${newTsp})` };
  }

  // 6) obie strony "z treścią" → parafraza, a po niej sedno
  return {
    shouldSpeak: true,
    type: 'SUMMARIZE',
    kind: 'FULL',
    phase: hasParaphrased(history) ? 'CORE' : 'PARAPHRASE',
    topic,
    turnsSinceProgress: 0,
    escalationStreak: 0,
    reason: 'obie strony',
  };
}

module.exports = {
  decide,
  speakerLabel,
  isCouple,
  shorten,
  isSubstantive,
  // stałe „drzwi wejścia" (PL best-effort) konsumowane przez anthropicAdvisor.finalizeDecision
  FEELING_PROBE,
  EVENT_DOOR_BANK,
};
