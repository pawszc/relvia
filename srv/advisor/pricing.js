/**
 * Szacowanie kosztu (USD) z zużycia tokenów.
 * Stawki per model pochodzą z models.js — koszt automatycznie dopasowuje się
 * do podanego modelu (domyślnie do aktywnego z ADVISOR_MODEL).
 */
const { ratesFor, activeModel } = require('./models');

/**
 * @param {{inputTokens?,outputTokens?,cacheReadTokens?,cacheCreationTokens?}} usage
 * @param {string} [model] id modelu; domyślnie aktywny
 */
function costUsd(usage, model = activeModel()) {
  const r = ratesFor(model);
  const u = usage || {};
  return (
    ((u.inputTokens || 0) * r.input +
      (u.outputTokens || 0) * r.output +
      (u.cacheReadTokens || 0) * r.cacheRead +
      (u.cacheCreationTokens || 0) * r.cacheCreation) /
    1e6
  );
}

module.exports = { costUsd };
