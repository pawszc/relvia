/**
 * Dostępne modele Anthropic + cennik (USD za 1M tokenów) — JEDNO ŹRÓDŁO PRAWDY.
 *
 * Aktywny model wybiera zmienna środowiskowa ADVISOR_MODEL (relvia.env);
 * gdy nieustawiona/nieznana → DEFAULT_MODEL.
 *
 * Cache (Anthropic): odczyt ~0.1× wejścia, zapis 5 min ~1.25× wejścia.
 * ⚠ Stawki wg cennika ~2026-06 — przy zmianach zaktualizuj tabelę.
 */
const MODELS = {
  'claude-haiku-4-5': { label: 'Haiku 4.5', input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 },
  'claude-sonnet-4-6': { label: 'Sonnet 4.6', input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-opus-4-6': { label: 'Opus 4.6', input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 },
  'claude-opus-4-7': { label: 'Opus 4.7', input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 },
  'claude-opus-4-8': { label: 'Opus 4.8', input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 },
  'claude-fable-5': { label: 'Fable 5', input: 10, output: 50, cacheRead: 1.0, cacheCreation: 12.5 },
};

const DEFAULT_MODEL = 'claude-haiku-4-5';

/** Aktywny model z env ADVISOR_MODEL (fallback do domyślnego, gdy pusty/nieznany). */
function activeModel() {
  const m = process.env.ADVISOR_MODEL;
  return m && MODELS[m] ? m : DEFAULT_MODEL;
}

/** Stawki dla danego modelu (fallback: aktywny → domyślny). */
function ratesFor(model) {
  return MODELS[model] || MODELS[activeModel()] || MODELS[DEFAULT_MODEL];
}

module.exports = { MODELS, DEFAULT_MODEL, activeModel, ratesFor };
