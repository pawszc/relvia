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
  // Nie-Anthropic — TYLKO do porównań w evalu (cross-provider). Stawki /1M wg cennika
  // dostawcy (27.06.2026). OpenAI: brak premii za zapis cache → cacheCreation ≈ input.
  'gpt-5-mini': { label: 'GPT-5 mini (OpenAI)', input: 0.25, output: 2, cacheRead: 0.025, cacheCreation: 0.25 },
};

const DEFAULT_MODEL = 'claude-haiku-4-5';

/** Aktywny model z env ADVISOR_MODEL (fallback do domyślnego, gdy pusty/nieznany). */
function activeModel() {
  const m = process.env.ADVISOR_MODEL;
  return m && MODELS[m] ? m : DEFAULT_MODEL;
}

/**
 * Model warstwy DECYZJI (reżyser). Z ADVISOR_DECIDE_MODEL; fallback → activeModel().
 * Pozwala rozdzielić modele per warstwa (tani decide / mocniejszy generate).
 */
function decideModel() {
  const m = process.env.ADVISOR_DECIDE_MODEL;
  return m && MODELS[m] ? m : activeModel();
}

/**
 * Model warstwy GENERACJI (treść dymki — czytana przez parę). Z ADVISOR_GENERATE_MODEL;
 * fallback → activeModel(). Tu warto dać mocniejszy model (jakość polszczyzny).
 */
function generateModel() {
  const m = process.env.ADVISOR_GENERATE_MODEL;
  return m && MODELS[m] ? m : activeModel();
}

/** Stawki dla danego modelu (fallback: aktywny → domyślny). */
function ratesFor(model) {
  return MODELS[model] || MODELS[activeModel()] || MODELS[DEFAULT_MODEL];
}

module.exports = { MODELS, DEFAULT_MODEL, activeModel, decideModel, generateModel, ratesFor };
