/**
 * PRODUKCYJNA warstwa GENERACJI przez OpenAI (np. gpt-5-chat-latest) — streaming.
 * Aktywna gdy ADVISOR_GENERATE_PROVIDER=openai; delegowana z anthropicAdvisor.generateReply.
 * Decyzja reżysera (decide) zostaje na Anthropic — TU tylko generacja dymki.
 *
 * Reużywa DOKŁADNIE ten sam prompt co ścieżka Anthropic (buildGenerateParts:
 * persona + rejestr wg płci + steer reżysera + wiązanie adresata + historia), więc
 * jakość/zachowanie = to, co zmierzył eval. Mapuje zdarzenia 1:1 z mockiem/Anthropic
 * ({delta}/{end}) i zużycie tokenów na nasz kształt (do wyceny per warstwa).
 *
 * Klient czyta OPENAI_API_KEY ze środowiska. Wymaga `openai` (w deps).
 */
const OpenAI = require('openai');
const { __testables } = require('./anthropicAdvisor'); // tylko buildGenerateParts (ładowane leniwie z generateReply, więc bez cyklu)
const { generateModel } = require('./models');
const CONFIG = require('./config');

const client = new OpenAI({ timeout: CONFIG.anthropicTimeoutMs });
// gpt-5-chat-latest jest NIE-rozumujący → 'none' (pomija reasoning_effort).
// Dla modelu rozumującego ustaw ADVISOR_OPENAI_REASONING=low|minimal|...
const REASONING = process.env.ADVISOR_OPENAI_REASONING || 'none';

module.exports = {
  async *generateReply(history, context = {}, decision, options = {}) {
    const { systemTexts, messages: rawMessages, bindUser } = __testables.buildGenerateParts(
      history,
      context,
      decision,
    );
    const messages = [{ role: 'system', content: systemTexts.join('\n\n') }, ...rawMessages];
    if (bindUser) messages.push(bindUser);

    const params = {
      model: generateModel(),
      messages,
      max_completion_tokens: CONFIG.replyMaxTokens,
      stream: true,
      stream_options: { include_usage: true }, // usage przychodzi w ostatnim chunku
    };
    if (REASONING && REASONING !== 'none') params.reasoning_effort = REASONING;

    // ABORT: gdy klient się rozłączy, handler woła ac.abort() → przerywamy stream.
    const stream = await client.chat.completions.create(params, { signal: options.signal });

    let acc = '';
    let usage = null;
    let refusal = false;
    for await (const chunk of stream) {
      const choice = chunk.choices && chunk.choices[0];
      const delta = choice && choice.delta;
      if (delta && delta.content) {
        acc += delta.content;
        yield { type: 'delta', text: delta.content };
      }
      if (delta && delta.refusal) refusal = true;
      if (chunk.usage) usage = chunk.usage;
    }

    const u = usage || {};
    const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    const mapped = {
      inputTokens: Math.max(0, (u.prompt_tokens || 0) - cached),
      outputTokens: u.completion_tokens || 0,
      cacheReadTokens: cached,
      cacheCreationTokens: 0, // OpenAI: brak osobnej premii za zapis cache
    };

    if (refusal && !acc) {
      yield {
        type: 'end',
        text: 'Przepraszam, nie mogę pomóc w tej konkretnej sprawie. Jeśli czujecie się zagrożeni, rozważcie kontakt z profesjonalistą lub odpowiednimi służbami.',
        finishReason: 'error',
        usage: mapped,
      };
    } else {
      yield { type: 'end', text: acc, finishReason: 'end_turn', usage: mapped };
    }
  },
};
