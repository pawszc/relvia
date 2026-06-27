/**
 * Adapter WARSTWY GENERACJI dla OpenAI (np. gpt-5-mini) — TYLKO do evalu/porównań.
 * NIE jest częścią produkcji. Reużywa DOKŁADNIE ten sam prompt co Anthropic
 * (buildGenerateParts: persona + rejestr wg płci + steer wg typu decyzji + wiązanie
 * adresata + historia), żeby porównanie modeli było uczciwe — różni się tylko dostawca.
 *
 * Wystawia `generateReply(history, context, decision, options)` zgodny z kontraktem
 * używanym przez run-eval (async generator zdarzeń {type:'delta'|'end', text, usage}).
 * Klucz z OPENAI_API_KEY (env; run-eval ładuje relvia.env).
 */
const OpenAI = require('openai');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { __testables } = require(path.join(ROOT, 'srv/advisor/anthropicAdvisor'));
const { generateModel } = require(path.join(ROOT, 'srv/advisor/models'));
const CONFIG = require(path.join(ROOT, 'srv/advisor/config'));

const client = new OpenAI();
// effort rozumowania GPT-5: dla krótkiej empatycznej prozy nie potrzeba dużo; 'low'
// trzyma koszt/latency w ryzach. Nadpisywalne ADVISOR_OPENAI_REASONING.
const REASONING = process.env.ADVISOR_OPENAI_REASONING || 'low';

module.exports = {
  async *generateReply(history, context = {}, decision /*, options */) {
    const { systemTexts, messages: rawMessages, bindUser } = __testables.buildGenerateParts(
      history,
      context,
      decision,
    );
    // OpenAI: bloki system → jeden string; wiadomości jako zwykłe role user/assistant.
    const system = systemTexts.join('\n\n');
    const messages = [{ role: 'system', content: system }, ...rawMessages];
    if (bindUser) messages.push(bindUser);

    const params = {
      model: generateModel(),
      messages,
      max_completion_tokens: CONFIG.replyMaxTokens,
      // brak temperature — modele rozumujące GPT-5 akceptują tylko domyślną
    };
    // reasoning_effort TYLKO dla modeli rozumujących; nie-rozumujące (gpt-5-chat,
    // gpt-4.1) odrzucą ten parametr → ADVISOR_OPENAI_REASONING=none go pomija.
    if (REASONING && REASONING !== 'none') params.reasoning_effort = REASONING;
    const resp = await client.chat.completions.create(params);

    const text = (resp.choices && resp.choices[0] && resp.choices[0].message.content) || '';
    const u = resp.usage || {};
    const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    const usage = {
      inputTokens: Math.max(0, (u.prompt_tokens || 0) - cached),
      outputTokens: u.completion_tokens || 0, // wlicza tokeny rozumowania (rozliczane jako output)
      cacheReadTokens: cached,
      cacheCreationTokens: 0, // OpenAI: brak osobnej premii za zapis cache
    };
    yield { type: 'end', text, finishReason: resp.choices?.[0]?.finish_reason || 'stop', usage };
  },
};
