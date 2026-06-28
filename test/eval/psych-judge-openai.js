/**
 * DRUGI, NIEZALEŻNY sędzia trafności psychologicznej — najmocniejszy model OpenAI
 * (gpt-5.5-pro). Cel: kontrola stronniczości wewnątrzrodzinnej (Claude oceniający
 * Claude'a). Ocenia DOKŁADNIE tę samą rubrykę 6 osi co sędzia Anthropic (Fable 5),
 * importowaną z psych-judge.js → oceny obu są wprost porównywalne.
 *
 * Tylko eval. Klucz z OPENAI_API_KEY (env; run-eval ładuje relvia.env). Wymaga openai (devDep).
 */
const OpenAI = require('openai');
const { PSYCH_SYSTEM, PSYCH_SCHEMA, renderHistory } = require('./psych-judge');

const PSYCH_JUDGE_OPENAI_MODEL = 'gpt-5.5-pro';
const client = new OpenAI();

function parse(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch {
    return { dostrojenie: 0, wnikliwosc: 0, ruch: 0, cieplo: 0, komunikatywnosc: 0, ludzkiTon: 0, generic: true, weakness: 'nieparsowalny werdykt' };
  }
}

async function judgePsychOpenAI(history, reply) {
  // gpt-5.5-pro to model „pro" → TYLKO przez Responses API (chat/completions zwraca 404).
  const resp = await client.responses.create({
    model: PSYCH_JUDGE_OPENAI_MODEL,
    max_output_tokens: 4000, // model rozumujący — zapas na rozumowanie + JSON
    input: [
      { role: 'system', content: PSYCH_SYSTEM },
      {
        role: 'user',
        content: `ROZMOWA PARY:\n${renderHistory(history)}\n\nODPOWIEDŹ DORADCY (oceń trafność psychologiczną):\n"${reply}"`,
      },
    ],
    text: { format: { type: 'json_schema', name: 'psych_ocena', strict: true, schema: PSYCH_SCHEMA } },
  });
  const p = parse(resp.output_text);
  const u = resp.usage || {};
  const cached = (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
  return {
    dostrojenie: p.dostrojenie || 0,
    wnikliwosc: p.wnikliwosc || 0,
    ruch: p.ruch || 0,
    cieplo: p.cieplo || 0,
    komunikatywnosc: p.komunikatywnosc || 0,
    ludzkiTon: p.ludzkiTon || 0,
    generic: !!p.generic,
    weakness: p.weakness || '',
    usage: {
      // Responses API: usage.input_tokens ZAWIERA cached; output_tokens ZAWIERA reasoning.
      inputTokens: Math.max(0, (u.input_tokens || 0) - cached),
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: cached,
      cacheCreationTokens: 0,
    },
  };
}

module.exports = { judgePsychOpenAI, PSYCH_JUDGE_OPENAI_MODEL };
