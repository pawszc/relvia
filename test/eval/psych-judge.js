/**
 * Sędzia TRAFNOŚCI PSYCHOLOGICZNEJ / GŁĘBI TERAPEUTYCZNEJ — osobny LLM-judge (Opus).
 * Stały wymiar zestawu ewaluacyjnego, OBOK języka (language-judge) i treści/bezpieczeństwa
 * (judge). Mierzy to, czego tamte nie łapią: czy wypowiedź doradcy realnie TRAFIA
 * psychologicznie — dostrojenie, wnikliwość, ruch terapeutyczny, ciepło — a nie tylko
 * jest poprawna językowo i bezpieczna.
 *
 * Ocenia w kontekście rozmowy (potrzebny, bo trafność zależy od tego, co padło).
 * Zwraca 4 oceny 1–5 + flagę „ogólnikowości” + najsłabszy punkt. NIE część produkcji.
 */
const Anthropic = require('@anthropic-ai/sdk');

const PSYCH_JUDGE_MODEL = 'claude-opus-4-8';
const client = new Anthropic();

const SYSTEM = `Jesteś doświadczonym superwizorem terapii par. Oceniasz WYŁĄCZNIE TRAFNOŚĆ PSYCHOLOGICZNĄ
i GŁĘBIĘ TERAPEUTYCZNĄ jednej wypowiedzi doradcy — NIE poprawność językową, NIE bezpieczeństwo
proceduralne. Pytanie nadrzędne: czy ta wypowiedź sprawia, że osoba poczułaby się naprawdę
usłyszana i zrozumiana, i czy realnie posuwa proces?

Oceń 6 wymiarów w skali 1–5 (5 = poziom bardzo dobrego terapeuty; 3 = poprawne, ale powierzchowne;
1 = chybione lub puste).

GŁĘBIA / TRAFNOŚĆ:
- dostrojenie: czy TRAFNIE odczytuje i odzwierciedla to, co osoba NAPRAWDĘ czuje/przeżywa
  (pod słowami), zamiast odbić powierzchowne lub nie na temat.
- wnikliwosc: czy wnosi nietrywialne zrozumienie — nazywa potrzebę, lęk, wzorzec, sedno —
  zamiast ogólników, frazesów i „coachowych” banałów.
- ruch: czy pytanie/parafraza realnie OTWIERA i posuwa rozmowę we właściwym kierunku
  (pogłębia, zaprasza), a nie zamyka, spłyca ani odbiega.
- cieplo: czy brzmi jak ktoś, komu można zaufać — ciepło, bez oceniania, bez protekcjonalności
  i bez terapeutycznego żargonu „na pokaz”.

STYL / ODBIÓR (oceniaj NIEZALEŻNIE od głębi — wypowiedź może być mądra, a brzmieć jak AI):
- komunikatywnosc: czy łatwo „wchodzi" — przystępny, prosty język; TRAFNA długość i tempo
  (nie przegadane, nie eseistyczne, nie przeładowane); bez żargonu; odbiorca od razu czuje sedno.
- ludzkiTon: czy brzmi jak realny, ciepły CZŁOWIEK, a nie AI — naturalny rytm i konkret;
  BEZ szablonowych otwieraczy („Słyszę, że…", „To brzmi, jakby…", „Rozumiem, że…"), bez nadmiernej
  struktury i grzecznościowego wypełniacza, bez „terapeutycznego automatu”. Karz schematyczność.

Dodatkowo:
- generic: true, jeśli wypowiedź brzmi jak uniwersalny, wymienny frazes (mógłby pasować do
  niemal każdej sytuacji) — sygnał braku trafności; false, jeśli jest osadzona i konkretna.
- weakness: jedno zdanie — najsłabszy punkt psychologiczny tej wypowiedzi (lub „—” jeśli brak).

Bądź wymagający: „poprawne i miłe” to najwyżej 3. Piątki tylko za realną, osadzoną trafność.
Zwróć WYŁĄCZNIE JSON wg schematu.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dostrojenie: { type: 'integer' },
    wnikliwosc: { type: 'integer' },
    ruch: { type: 'integer' },
    cieplo: { type: 'integer' },
    komunikatywnosc: { type: 'integer' },
    ludzkiTon: { type: 'integer' },
    generic: { type: 'boolean' },
    weakness: { type: 'string' },
  },
  required: ['dostrojenie', 'wnikliwosc', 'ruch', 'cieplo', 'komunikatywnosc', 'ludzkiTon', 'generic', 'weakness'],
};

const ROLE_LABEL = { HER: 'kobieta', HIM: 'mężczyzna', TOGETHER: 'oboje', ADVISOR: 'doradca' };

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

/**
 * @param {Array} history pełna historia (obiekty {author,text})
 * @param {string} reply treść dymki doradcy
 * @returns {Promise<{dostrojenie,wnikliwosc,ruch,cieplo,generic,weakness, usage}>}
 */
async function judgePsych(history, reply) {
  const convo = history.map((m) => `[${ROLE_LABEL[m.author] || m.author}]: ${m.text}`).join('\n');
  const resp = await client.messages.create({
    model: PSYCH_JUDGE_MODEL,
    max_tokens: 500,
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `ROZMOWA PARY:\n${convo}\n\nODPOWIEDŹ DORADCY (oceń trafność psychologiczną):\n"${reply}"`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  const block = (resp.content || []).find((b) => b.type === 'text');
  const p = parse(block && block.text);
  const u = resp.usage || {};
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
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheCreationTokens: u.cache_creation_input_tokens || 0,
    },
  };
}

module.exports = { judgePsych, PSYCH_JUDGE_MODEL };
