/**
 * LIVE i18n smoke test — OPT-IN, płatny (realne wywołania Anthropic).
 *
 * Uruchomienie (świadome, nigdy w `npm test` ani w CI):
 *   RUN_LIVE_AI_TESTS=true npm run test:ai:i18n:live
 *
 * Zakres: MAKSYMALNIE 3 wywołania (po jednym reprezentatywnym scenariuszu na
 * język pl/en/de), aktualny model generacji aplikacji (models.generateModel),
 * niski limit tokenów odpowiedzi, temperature 0 (deterministycznie jak się da).
 *
 * TWARDY LIMIT KOSZTU: 3.00 USD na CAŁĄ sesję testową. Zmienna środowiskowa
 * LIVE_AI_BUDGET_USD może limit tylko OBNIŻYĆ — nigdy podnieść (Math.min z 3).
 * Przed każdym wywołaniem liczymy konserwatywny worst-case (wejście po ~2.5
 * znaku/token + pełny max_tokens wyjścia) i przerywamy PRZED wywołaniem, gdyby
 * suma dotychczasowych kosztów + worst-case przekroczyła limit. Jeżeli provider
 * nie zwróci usage, rozliczamy wywołanie po worst-case.
 *
 * Ocena LOKALNA (bez drugiego modelu / LLM-judge): niepusta odpowiedź, prosty
 * format (proza bez markdownu/etykiet), heurystyczna identyfikacja języka
 * (stop-słowa + diakrytyki — wystarczająca dla ~kilkuset znaków), brak
 * oczywistego mieszania alfabetów, podstawowe reguły stylu (maks. 1–2 pytania).
 *
 * Brak RUN_LIVE_AI_TESTS/klucza/cennika → wyjście bez wywołań, koszt 0 USD.
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', 'relvia.env') });

const HARD_CAP_USD = 3.0;
const budgetEnv = Number(process.env.LIVE_AI_BUDGET_USD);
const BUDGET_USD = Math.min(Number.isFinite(budgetEnv) && budgetEnv > 0 ? budgetEnv : HARD_CAP_USD, HARD_CAP_USD);
const MAX_OUTPUT_TOKENS = 300;
/** Konserwatywnie: ~2.5 znaku/token (PL bywa 3–4; zawyżamy liczbę tokenów wejścia). */
const CHARS_PER_TOKEN = 2.5;

function bail(msg) {
  console.log(msg);
  console.log('Wywołań API: 0. Koszt: $0.00 (limit 3.00 USD nietknięty).');
  process.exit(0);
}

if (String(process.env.RUN_LIVE_AI_TESTS).toLowerCase() !== 'true') {
  bail('RUN_LIVE_AI_TESTS != true → testy live pominięte (opt-in).');
}
if (!process.env.ANTHROPIC_API_KEY) {
  bail('Brak ANTHROPIC_API_KEY → testy live pominięte.');
}

const Anthropic = require('@anthropic-ai/sdk');
const { generateModel, ratesFor } = require('../../srv/advisor/models');
const { costUsd } = require('../../srv/advisor/pricing');
const { __testables } = require('../../srv/advisor/anthropicAdvisor');

const MODEL = generateModel();
const RATES = ratesFor(MODEL);
if (!RATES || !RATES.input || !RATES.output) {
  bail(`Brak danych cennika dla modelu ${MODEL} → nie da się wiarygodnie oszacować kosztu; testy live pominięte.`);
}

// ── scenariusze: 1 reprezentatywna tura na język ──────────────────────────────
const SCENARIOS = [
  {
    locale: 'pl',
    text: 'Ostatnio czuję, że cały ciężar domu spada na mnie i jestem tym bardzo zmęczona.',
  },
  {
    locale: 'en',
    text: 'Lately I feel like I carry the whole weight of our home on my own, and I am very tired of it.',
  },
  {
    locale: 'de',
    text: 'In letzter Zeit habe ich das Gefühl, dass die ganze Last unseres Zuhauses auf mir liegt, und ich bin sehr müde davon.',
  },
];
const DECISION = { type: 'DEEPEN', kind: 'FULL', phase: 'OPENING', shouldSpeak: true, nextSpeaker: 'HER' };

// ── lokalna heurystyka języka (bez modelu) ────────────────────────────────────
const STOPWORDS = {
  pl: ['się', 'nie', 'jest', 'czego', 'żeby', 'ale', 'gdy', 'tobie', 'ciebie', 'jak', 'w tym'],
  en: ['the', 'and', 'you', 'that', 'what', 'this', 'feel', 'when', 'your', 'it'],
  de: ['und', 'nicht', 'das', 'ist', 'ich', 'du', 'dir', 'dich', 'was', 'wie', 'dass', 'wenn'],
};
const wordCount = (text, words) =>
  words.reduce((n, w) => n + (text.match(new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'giu')) || []).length, 0);

function detectLang(text) {
  const t = text.toLowerCase();
  const scores = {
    pl: (t.match(/[ąćęłńśźż]/g) || []).length * 2 + wordCount(t, STOPWORDS.pl),
    de: (t.match(/[äöüß]/g) || []).length * 2 + wordCount(t, STOPWORDS.de),
    en: wordCount(t, STOPWORDS.en),
  };
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { lang: winner[1] >= 3 ? winner[0] : 'unknown', scores };
}

/** Znaki jednoznacznie spoza języka odpowiedzi = oczywiste mieszanie. */
const FOREIGN_CHARS = {
  pl: /[äöüß]|[Ѐ-ӿ]/, // niemieckie + cyrylica
  en: /[ąćęłńśźżäöüß]|[Ѐ-ӿ]/,
  de: /[ąćęłńśźż]|[Ѐ-ӿ]/, // polskie + cyrylica (ó celowo poza — rzadkie zapożyczenia)
};

function checkReply(locale, text) {
  const problems = [];
  if (!text || text.trim().length < 60) problems.push('odpowiedź pusta/zbyt krótka');
  if (/[*#>]|\[[^\]]+\]\s*:/.test(text)) problems.push('artefakty formatowania (markdown/etykieta)');
  const q = (text.match(/\?/g) || []).length;
  if (q > 2) problems.push(`za dużo pytań (${q} > 2) — persona: jedno pytanie na turę`);
  const det = detectLang(text);
  if (det.lang !== locale) problems.push(`wykryty język "${det.lang}" ≠ oczekiwany "${locale}" (${JSON.stringify(det.scores)})`);
  if (FOREIGN_CHARS[locale].test(text)) problems.push('znaki spoza języka odpowiedzi (mieszanie)');
  if (locale === 'de' && /[a-zäöüß,;] Sie\b/.test(text)) problems.push('formalne „Sie" zamiast du/ihr');
  return problems;
}

// ── budżet ────────────────────────────────────────────────────────────────────
const estimateTokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);
const worstCaseUsd = (inputTokens) =>
  (inputTokens * RATES.input + MAX_OUTPUT_TOKENS * RATES.output) / 1_000_000;

async function main() {
  const client = new Anthropic({ timeout: 60_000 });

  // preflight: plan i konserwatywny koszt maksymalny CAŁEJ sesji
  const plans = SCENARIOS.map((s) => {
    const { systemTexts, messages, bindUser } = __testables.buildGenerateParts(
      [{ author: 'HER', text: s.text, seq: 1 }],
      { locale: s.locale },
      DECISION,
    );
    const allMessages = bindUser ? [...messages, bindUser] : messages;
    const chars =
      systemTexts.join('').length + allMessages.reduce((n, m) => n + String(m.content).length, 0);
    return { ...s, systemTexts, allMessages, estIn: estimateTokens(chars) };
  });
  const worstTotal = plans.reduce((n, p) => n + worstCaseUsd(p.estIn), 0);

  console.log('── PLAN TESTU LIVE (i18n) ─────────────────────────────');
  console.log(`model:               ${MODEL}`);
  console.log(`planowane wywołania: ${plans.length} (po 1 na język: ${plans.map((p) => p.locale).join(', ')})`);
  console.log(`max_tokens/wywołanie: ${MAX_OUTPUT_TOKENS}, temperature: 0`);
  console.log(`konserwatywny koszt maks.: $${worstTotal.toFixed(4)} (limit twardy: $${BUDGET_USD.toFixed(2)})`);
  console.log('───────────────────────────────────────────────────────');
  if (worstTotal > BUDGET_USD) bail('Worst-case przekracza limit → nie wykonuję ŻADNEGO wywołania.');

  let spentUsd = 0;
  let calls = 0;
  const totals = { in: 0, out: 0 };
  let failed = false;

  for (const p of plans) {
    const worst = worstCaseUsd(p.estIn);
    if (spentUsd + worst > BUDGET_USD) {
      console.error(`✖ ${p.locale}: pominięte — worst-case $${worst.toFixed(4)} przekroczyłby pozostały budżet ($${(BUDGET_USD - spentUsd).toFixed(4)}).`);
      failed = true;
      break;
    }

    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      thinking: { type: 'disabled' },
      system: p.systemTexts.map((text) => ({ type: 'text', text })),
      messages: p.allMessages,
    });
    calls += 1;

    const u = resp.usage;
    if (u && typeof u.input_tokens === 'number') {
      const usage = {
        inputTokens: u.input_tokens || 0,
        outputTokens: u.output_tokens || 0,
        cacheReadTokens: u.cache_read_input_tokens || 0,
        cacheCreationTokens: u.cache_creation_input_tokens || 0,
      };
      spentUsd += costUsd(usage, MODEL);
      totals.in += usage.inputTokens;
      totals.out += usage.outputTokens;
    } else {
      spentUsd += worst; // brak usage → rozliczenie po worst-case
      console.warn(`(${p.locale}) provider nie zwrócił usage — rozliczam worst-case $${worst.toFixed(4)}`);
    }

    const text = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const problems = checkReply(p.locale, text);
    if (problems.length) {
      failed = true;
      console.error(`✖ ${p.locale}: ${problems.join('; ')}`);
      console.error(`   odpowiedź: ${text.slice(0, 220)}…`);
    } else {
      console.log(`✔ ${p.locale}: OK (${text.length} zn.) — „${text.slice(0, 90).replace(/\s+/g, ' ')}…"`);
    }
  }

  console.log('───────────────────────────────────────────────────────');
  console.log(`wywołania: ${calls}/${plans.length} · tokeny: in=${totals.in} out=${totals.out} · koszt: $${spentUsd.toFixed(4)} (limit $${BUDGET_USD.toFixed(2)})`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Błąd testu live:', (e && e.message) || e);
  process.exit(1);
});
