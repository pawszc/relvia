/**
 * Deterministyczne komunikaty backendu WIDOCZNE DLA PARY — zatwierdzone wersje
 * pl/en/de (żaden nie zależy od spontanicznego tłumaczenia przez model, 0 tokenów).
 *
 * Wersja polska jest bazą znaczeniową i pozostaje BAJT W BAJT taka, jak przed i18n.
 * Niemiecki: konsekwentnie nieformalnie — „du" do jednej osoby, „ihr/euch" do pary.
 * Kompletność (te same klucze i niepuste wartości we wszystkich językach) pilnuje
 * test/unit/i18n-texts.test.js.
 *
 * ⚠ Numery pomocy (112, 116 123, 800 120 002) są zweryfikowane dla POLSKI —
 * usługa celuje w rynek polski; wersje en/de mówią to wprost („in Poland").
 * Przy wejściu na inny rynek numery wymagają przeglądu (patrz SAFETY.md).
 */
const { SUPPORTED_LOCALES, normalizeLocaleOrDefault } = require('../../shared/locales.mjs');

const TEXTS = {
  /** Ciepłe pożegnanie doradcy przy wejściu w pauzę (krok 4). Szablon — 0 tokenów. */
  sendoff: {
    pl: 'Zostawiam Was z tym we dwoje — porozmawiajcie między sobą, choćby na spokojnie poza aplikacją. Gdy zechcecie, żebym znów się włączył, przełączcie mnie na „rozmawia" i po prostu napiszcie, jak Wam poszło.',
    en: 'I\'ll leave the two of you with this — talk it over between yourselves, even calmly outside the app. Whenever you want me to join in again, switch me back to "talks" and simply write how it went.',
    de: 'Ich lasse euch damit zu zweit — sprecht in Ruhe miteinander, gern auch außerhalb der App. Wenn ihr möchtet, dass ich wieder dabei bin, stellt mich zurück auf „spricht mit" und schreibt einfach, wie es gelaufen ist.',
  },

  /**
   * Łagodne wejście w read-only po osiągnięciu progu kosztu. Ten SAM komunikat dla
   * obu progów: budżetu per-sesja i globalnego dziennego limitu aplikacji.
   * Prosty język, bez technikaliów. Szablon — 0 tokenów.
   */
  budget: {
    pl: 'Na dziś musimy zrobić tu pauzę — skończyła nam się pula, którą cała aplikacja ma na rozmowy na dziś. To, co sobie powiedzieliście, zostaje z Wami. Wróćcie proszę później, najlepiej jutro — chętnie znów Wam wtedy potowarzyszę.',
    en: 'We need to pause here for today — the pool the whole app has for conversations today has run out. What you\'ve said to each other stays with you. Please come back later, ideally tomorrow — I\'ll gladly be with you again then.',
    de: 'Für heute müssen wir hier eine Pause machen — das Kontingent, das die ganze App für Gespräche heute hat, ist aufgebraucht. Was ihr einander gesagt habt, bleibt bei euch. Kommt bitte später wieder, am besten morgen — dann begleite ich euch gern wieder.',
  },

  /** Fallback, gdy model odmówi generacji (stop_reason=refusal) — widoczny dla pary. */
  refusal: {
    pl: 'Przepraszam, nie mogę pomóc w tej konkretnej sprawie. Jeśli czujecie się zagrożeni, rozważcie kontakt z profesjonalistą lub odpowiednimi służbami.',
    en: 'I\'m sorry, I can\'t help with this particular matter. If you feel unsafe, please consider contacting a professional or the appropriate services.',
    de: 'Es tut mir leid, dabei kann ich nicht helfen. Wenn ihr euch bedroht fühlt, wendet euch bitte an eine Fachperson oder die zuständigen Stellen.',
  },
};

/** Tekst danego rodzaju w danym języku (nieznane locale → pl, kontrakt backendu). */
function textFor(kind, locale) {
  const bank = TEXTS[kind];
  if (!bank) throw new Error(`texts: nieznany rodzaj komunikatu "${kind}"`);
  return bank[normalizeLocaleOrDefault(locale)];
}

const sendoffText = (locale) => textFor('sendoff', locale);
const budgetText = (locale) => textFor('budget', locale);
const refusalText = (locale) => textFor('refusal', locale);

/** Czy tekst to notka budżetowa w KTÓRYMKOLWIEK języku (dedup notki przy zmianie języka). */
const isBudgetText = (text) => SUPPORTED_LOCALES.some((l) => TEXTS.budget[l] === text);

module.exports = { TEXTS, sendoffText, budgetText, refusalText, isBudgetText };
