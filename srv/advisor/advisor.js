/**
 * Punkt wyboru implementacji warstwy AI (AdvisorService).
 *
 * Sterowane zmiennymi środowiskowymi:
 *   ADVISOR        → (brak)/"mock" = mock, ZERO tokenów (domyślnie); "anthropic" = realny model.
 *   ADVISOR_MODEL  → który model (gdy anthropic); domyślnie claude-haiku-4-5. Patrz models.js.
 *
 * anthropicAdvisor jest wymagany LENIWIE — w trybie mock SDK Anthropic
 * nie jest w ogóle ładowany, więc dev bez klucza działa bez przeszkód.
 * Handler CAP i kontrakt SSE są takie same dla obu implementacji.
 */
const { activeModel } = require('./models');

const kind = (process.env.ADVISOR || 'mock').toLowerCase();

module.exports = kind === 'anthropic' ? require('./anthropicAdvisor') : require('./mockAdvisor');

console.log(
  `[advisor] tryb warstwy AI: ${kind === 'anthropic' ? `anthropic (${activeModel()})` : 'mock (zero tokenów)'}`,
);
