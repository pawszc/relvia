/**
 * Realna warstwa AI (Faza 3) — implementuje kontrakt AdvisorService przy użyciu
 * oficjalnego SDK Anthropic i modelu claude-sonnet-4-6, ze streamingiem tokenów.
 *
 * Aktywne tylko gdy ADVISOR=anthropic (patrz advisor.js). Wymaga ANTHROPIC_API_KEY
 * w środowisku — klucz NIGDY nie trafia do przeglądarki (zostaje na serwerze).
 *
 * Tokeny modelu są mapowane na te same zdarzenia co mock ({delta}/{end}),
 * więc handler CAP i front nie wymagają żadnych zmian.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { decide } = require('./decisionRules');

const MODEL = 'claude-sonnet-4-6';

// Krok 1: decyzja reżysera jest regułowa (wspólna z mockiem) — generacja realna.
// Krok 5 podmieni to na mały model (claude-haiku) ze structured output.
// Krótka instrukcja sterująca tonem/celem dymki wg typu decyzji.
const DECISION_STEER = {
  ASK_OTHER:
    'Cel tej tury: krótko docenić osobę, która właśnie napisała, i oddać głos drugiej stronie. NIE doradzaj jeszcze — najpierw poproś o jej perspektywę.',
  CLARIFY:
    'Cel tej tury: ostatnia wypowiedź to ogólna negacja bez treści. Poproś o jeden konkretny przykład zamiast oceny całości. Bądź zwięzły.',
  REFRAME:
    'Cel tej tury: rozmowa krąży wokół tego samego z dwóch stron. Nazwij to wprost i przeramuj — pomóż zobaczyć wspólną potrzebę pod sporem. Zwięźle.',
  NARROW:
    'Cel tej tury: utknęliśmy w ogólnikach/zaprzeczaniu. Poproś, by każde z osobna podało JEDEN konkretny przykład zamiast oceny całości.',
  CHOOSE:
    'Cel tej tury: na stole jest kilka wątków naraz. Zaproponuj wybór jednego, najważniejszego teraz; resztę odłóżcie na później.',
  PROPOSE:
    'Cel tej tury: rozmowa się zapętla. Zaproponuj 1–3 małe, konkretne kroki do wypróbowania, zamiast dalszego roztrząsania.',
  SUMMARIZE:
    'Cel tej tury: sparafrazuj uczucia i potrzeby OBU stron, zanim cokolwiek zaproponujesz.',
  SAFETY_STOP:
    'Cel tej tury: pojawił się sygnał zagrożenia. Z troską zatrzymaj rozmowę i zachęć do kontaktu z profesjonalistą lub służbami. Nie udawaj terapeuty.',
};

/** Dodatkowa instrukcja, gdy reżyser parkuje dygresję — wróć do kotwicy tematu. */
const parkSteer = (decision) =>
  decision && decision.parkAdd
    ? `Pojawiła się dygresja: „${decision.parkAdd}”. Potwierdź krótko, że zapiszesz ją na później, i wróć do tematu${
        decision.topic ? ` „${decision.topic}”` : ''
      }. Nie rozwijaj nowego wątku teraz.`
    : null;

// Persona doradcy — ciepły, empatyczny, neutralny mediator (jak w prototypie).
// Trzymana jako stały prefiks z cache_control → tańsze odczyty przy każdej wiadomości.
const PERSONA = `Jesteś ciepłym, empatycznym doradcą relacji dla pary, która pisze do Ciebie wspólnie z jednego urządzenia. Rozmawiasz po polsku.

Twoja rola:
- Jesteś neutralnym mediatorem — nie stajesz po żadnej stronie i nie oceniasz, kto ma rację.
- Najpierw słuchasz i nazywasz uczucia oraz potrzeby obojga, zanim zaproponujesz cokolwiek konkretnego.
- Zadajesz delikatne, otwarte pytania, które pomagają parze lepiej się zrozumieć.
- Doceniasz, gdy mówią jednym głosem (wiadomości oznaczone [Razem]).

Styl:
- Mów ciepło, spokojnie i z szacunkiem; bez oceniania, moralizowania i gotowych recept.
- Odpowiadaj zwięźle — kilka zdań, naturalnym językiem, bez list i nagłówków.
- Zwracaj się do obojga; jeśli to pomaga, odnieś się po imieniu do osoby, która właśnie napisała.

Wiadomości pary są poprzedzone etykietą mówcy w nawiasie kwadratowym, np. "[Ola]:", "[Tomek]:" lub "[Razem]:".

Bezpieczeństwo: jeśli pojawią się sygnały przemocy, zagrożenia lub krzywdy, z troską zachęć do kontaktu z profesjonalistą lub odpowiednimi służbami — nie udawaj, że zastępujesz terapeutę.`;

// Klient czyta ANTHROPIC_API_KEY ze środowiska. Konstrukcja na poziomie modułu
// znaczy: jeśli ustawisz ADVISOR=anthropic bez klucza, błąd pojawi się od razu.
const client = new Anthropic();

/** Etykieta mówcy do prefiksu wiadomości (imiona z kontekstu konwersacji). */
function speakerLabel(author, ctx) {
  switch (author) {
    case 'HER':
      return ctx.herName || 'Ona';
    case 'HIM':
      return ctx.hisName || 'On';
    case 'TOGETHER':
      return 'Razem';
    default:
      return 'Doradca';
  }
}

/** Historia (ChatMessage[]) → wiadomości w formacie Anthropic (role user/assistant). */
function toMessages(history, ctx) {
  return history.map((m) =>
    m.author === 'ADVISOR'
      ? { role: 'assistant', content: m.text }
      : { role: 'user', content: `[${speakerLabel(m.author, ctx)}]: ${m.text}` },
  );
}

module.exports = {
  decide(history, state, context = {}) {
    return Promise.resolve(decide(history, state, context));
  },

  async *generateReply(history, context = {}, decision) {
    // System = stała persona (cache) + krótka instrukcja sterująca wg decyzji.
    const steer = decision && DECISION_STEER[decision.type];
    const system = [{ type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } }];
    if (steer) system.push({ type: 'text', text: steer });
    const park = parkSteer(decision);
    if (park) system.push({ type: 'text', text: park });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      // Czat ma odpowiadać szybko — wyłączamy rozszerzone myślenie, by pierwszy
      // token pojawiał się od razu. (Można później dostroić jakość przez effort.)
      thinking: { type: 'disabled' },
      system,
      messages: toMessages(history, context),
    });

    // Strumień tokenów → zdarzenia 'delta' (1:1 z mockiem).
    let acc = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        acc += event.delta.text;
        yield { type: 'delta', text: event.delta.text };
      }
    }

    // Domknięcie — mapujemy stop_reason na finishReason oraz zużycie tokenów.
    const final = await stream.finalMessage();
    const u = final.usage || {};
    const usage = {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheCreationTokens: u.cache_creation_input_tokens || 0,
    };

    if (final.stop_reason === 'refusal') {
      const text =
        acc ||
        'Przepraszam, nie mogę pomóc w tej konkretnej sprawie. Jeśli czujecie się zagrożeni, rozważcie kontakt z profesjonalistą lub odpowiednimi służbami.';
      yield { type: 'end', text, finishReason: 'error', usage };
    } else {
      yield {
        type: 'end',
        text: acc,
        finishReason: final.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
        usage,
      };
    }
  },
};
