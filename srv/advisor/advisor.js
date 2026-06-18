/**
 * Punkt wyboru implementacji warstwy AI (AdvisorService).
 *
 * Sterowane zmienną środowiskową ADVISOR:
 *   - (brak) lub "mock"  → mock, ZERO tokenów (domyślnie),
 *   - "anthropic"        → realny model claude-sonnet-4-6 (wymaga ANTHROPIC_API_KEY).
 *
 * anthropicAdvisor jest wymagany LENIWIE — w trybie mock SDK Anthropic
 * nie jest w ogóle ładowany, więc dev bez klucza działa bez przeszkód.
 * Handler CAP i kontrakt SSE są takie same dla obu implementacji.
 */
const kind = (process.env.ADVISOR || 'mock').toLowerCase();

module.exports = kind === 'anthropic' ? require('./anthropicAdvisor') : require('./mockAdvisor');

console.log(`[advisor] tryb warstwy AI: ${kind === 'anthropic' ? 'anthropic (claude-sonnet-4-6)' : 'mock (zero tokenów)'}`);
