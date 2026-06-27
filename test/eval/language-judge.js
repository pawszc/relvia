/**
 * Sędzia JAKOŚCI JĘZYKA POLSKIEGO — osobny LLM-judge (Opus), oceniający WYŁĄCZNIE
 * polszczyznę dymki doradcy (nie treść, nie empatię, nie bezpieczeństwo).
 *
 * Po co: pomiar A/B jakości językowej między modelami (np. Haiku vs Sonnet dla
 * warstwy generate). Zwraca oceny 1–5 (gramatyka / naturalność / zrozumiałość) i
 * listę KONKRETNYCH usterek (cytat + problem) — żeby wyłapać subtelne nienaturalności,
 * błędy fleksji i wtręty z innych języków, które robią słabsze modele.
 *
 * NIE jest częścią aplikacji ani jej kosztu — odpalany tylko w evalu.
 */
const Anthropic = require('@anthropic-ai/sdk');

const LANG_JUDGE_MODEL = 'claude-opus-4-8';
const client = new Anthropic();

const SYSTEM = `Jesteś bardzo wymagającym, native korektorem języka polskiego. Oceniasz WYŁĄCZNIE jakość JĘZYKOWĄ wypowiedzi doradcy par — nie oceniaj treści, empatii, trafności ani bezpieczeństwa, tylko sam polski.

Oceń wypowiedź w trzech wymiarach, w skali 1–5 (5 = bezbłędna, w pełni naturalna polszczyzna jak u wykształconego native speakera; 3 = zrozumiała, ale z wyczuwalnymi potknięciami; 1 = liczne błędy lub fragmenty trudne do zrozumienia):
- grammar: poprawność gramatyczna — fleksja (przypadki, rodzaj, liczba), składnia, rząd czasownika, zgoda.
- naturalness: naturalność doboru słów i frazeologii — brak kalek, dziwacznych kolokacji, sztucznych sformułowań oraz brak wtrętów z innych języków/alfabetów (np. „montaña rusów”, słowa nieistniejące jak „samooprawa”).
- clarity: zrozumiałość — czy każde zdanie da się od razu zrozumieć, bez zgadywania.

Wypisz też KONKRETNE usterki: dla każdej krótki cytat błędnego fragmentu z wypowiedzi + zwięzłe nazwanie problemu (np. „zły przypadek”, „kalka”, „słowo nieistniejące”, „wtręt obcojęzyczny”, „niezrozumiałe”). Jeśli usterek brak — pusta lista. Bądź surowy i drobiazgowy.

Zwróć WYŁĄCZNIE JSON wg schematu.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    grammar: { type: 'integer' },
    naturalness: { type: 'integer' },
    clarity: { type: 'integer' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          quote: { type: 'string' },
          problem: { type: 'string' },
        },
        required: ['quote', 'problem'],
      },
    },
  },
  required: ['grammar', 'naturalness', 'clarity', 'issues'],
};

function parse(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch {
    return { grammar: 0, naturalness: 0, clarity: 0, issues: [{ quote: '', problem: 'nieparsowalny werdykt' }] };
  }
}

/**
 * @param {string} reply treść dymki doradcy
 * @returns {Promise<{grammar:number,naturalness:number,clarity:number,issues:Array<{quote,problem}>, usage:object}>}
 */
async function judgeLanguage(reply) {
  const resp = await client.messages.create({
    model: LANG_JUDGE_MODEL,
    max_tokens: 700,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `WYPOWIEDŹ DORADCY (oceń tylko polszczyznę):\n"${reply}"` }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  const block = (resp.content || []).find((b) => b.type === 'text');
  const p = parse(block && block.text);
  const u = resp.usage || {};
  return {
    grammar: p.grammar || 0,
    naturalness: p.naturalness || 0,
    clarity: p.clarity || 0,
    issues: p.issues || [],
    usage: {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheCreationTokens: u.cache_creation_input_tokens || 0,
    },
  };
}

module.exports = { judgeLanguage, LANG_JUDGE_MODEL };
