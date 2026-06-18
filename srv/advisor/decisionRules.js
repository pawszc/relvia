/**
 * Regułowy silnik decyzji reżysera — wspólny dla mocka i (na razie) trybu
 * anthropic. Czysta funkcja: (history, state, ctx) → AdvisorDecision.
 *
 * Krok 2: stan ma znaczenie. decide() korzysta z `state` (faza, kotwica tematu,
 * licznik pętli) i ZWRACA nowe wartości do persystencji (topic, turnsSinceProgress).
 * Heurystyki celowo proste; realny model decyzyjny (claude-haiku) podmieni `decide`
 * w kroku 5 — patrz plan.
 */

// Sygnały kryzysu/przemocy → tor bezpieczeństwa (priorytet ponad wszystkim).
const CRISIS =
  /(zabić|zabij|skrzywdz|przemoc|uderzy|bije|boję się o|chcę zniknąć|nie chcę żyć|odebrać sobie życie|samobój)/i;

// Krótka, ogólna negacja bez treści — "nieprawda", "bzdura", "przesadzasz", "nie".
const SHORT_NEGATION = /^(nie|tak|nieprawda|bzdura|przesadzasz|wcale nie|właśnie że|kłamiesz)\b[\s.!?]*$/i;

// Marker dygresji — sygnał, że ktoś otwiera nowy wątek obok bieżącego tematu.
const DIGRESSION =
  /(\ba (tak )?w ogóle\b|przy okazji|swoją drogą|poza tym|\bno i jeszcze\b|innym razem|zmieniając temat|odbiegając|aha i)/i;

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

/** @returns {import('../../shared/chat-contract').AdvisorDecision} */
function decide(history, state = {}, context = {}) {
  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];
  const prev = couple[couple.length - 2];
  const tsp = state.turnsSinceProgress || 0;
  const phase = state.phase || 'OPENING';

  if (!last) {
    return { shouldSpeak: false, type: 'WAIT', kind: 'FULL', phase: 'OPENING', uiHint: 'Advisor słucha…', turnsSinceProgress: 0 };
  }

  // 1) tor bezpieczeństwa — zawsze pierwszy
  if (CRISIS.test(last.text)) {
    return { shouldSpeak: true, type: 'SAFETY_STOP', kind: 'FULL', phase, topic: state.topic, turnsSinceProgress: 0, reason: 'sygnał kryzysu' };
  }

  const substantive = isSubstantive(last.text);
  const newTsp = substantive ? 0 : tsp + 1;

  // kotwica tematu: pierwsza wypowiedź "z treścią" ustala, o czym rozmawiamy
  const topic = state.topic || (substantive ? shorten(last.text) : undefined);

  // 2) dygresja → zaparkuj i wróć do kotwicy (nie ucinaj — odłóż)
  if (topic && DIGRESSION.test(last.text)) {
    return {
      shouldSpeak: true,
      type: 'REFRAME',
      kind: 'FULL',
      phase,
      topic,
      parkAdd: shorten(last.text),
      turnsSinceProgress: newTsp,
      reason: 'dygresja → parking',
    };
  }

  // 3) wypowiedziała się tylko jedna strona → oddaj głos drugiej
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
      uiHint: `Advisor czeka na perspektywę: ${speakerLabel(nextSpeaker, context)}`,
      reason: 'jedna strona',
    };
  }

  // 4) brak postępu (negacja / urywek)
  if (!substantive) {
    // krótka kontynuacja WŁASNEJ myśli (nie negacja) → daj przestrzeń, milcz
    if (!SHORT_NEGATION.test(last.text.trim()) && prev && prev.author === last.author) {
      return { shouldSpeak: false, type: 'WAIT', kind: 'FULL', phase, topic, turnsSinceProgress: newTsp, uiHint: 'Advisor słucha…', reason: 'kontynuacja' };
    }
    // stopniowany nacisk — nazwij pętlę i pchnij w konstruktywną stronę
    const ladder =
      newTsp <= 1 ? 'CLARIFY' : newTsp === 2 ? 'REFRAME' : newTsp === 3 ? 'NARROW' : newTsp === 4 ? 'CHOOSE' : 'PROPOSE';
    const ladderPhase = newTsp >= 5 ? 'AGREEMENT' : newTsp >= 2 ? 'CORE' : phase;
    return { shouldSpeak: true, type: ladder, kind: 'FULL', phase: ladderPhase, topic, turnsSinceProgress: newTsp, reason: `brak postępu (${newTsp})` };
  }

  // 5) obie strony "z treścią" → parafraza, a po niej sedno
  return {
    shouldSpeak: true,
    type: 'SUMMARIZE',
    kind: 'FULL',
    phase: hasParaphrased(history) ? 'CORE' : 'PARAPHRASE',
    topic,
    turnsSinceProgress: 0,
    reason: 'obie strony',
  };
}

module.exports = { decide, speakerLabel, isCouple, shorten };
