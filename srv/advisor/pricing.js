/**
 * Cennik tokenów do szacowania kosztu (USD za 1M tokenów).
 *
 * Stawki dla modelu używanego przez anthropicAdvisor: claude-sonnet-4-6.
 * ⚠ Jeśli zmienisz model w anthropicAdvisor.js, zaktualizuj te stawki.
 *
 * Cache: odczyt ~0.1× wejścia, zapis (5 min TTL) ~1.25× wejścia.
 */
const RATES = {
  input: 3.0, // wejście (tokeny niecache'owane)
  output: 15.0, // wyjście
  cacheRead: 0.3, // odczyt z cache (~0.1× input)
  cacheCreation: 3.75, // zapis do cache 5 min (~1.25× input)
};

/** Szacowany koszt (USD) dla obiektu zużycia {inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens}. */
function costUsd(usage) {
  const u = usage || {};
  return (
    ((u.inputTokens || 0) * RATES.input +
      (u.outputTokens || 0) * RATES.output +
      (u.cacheReadTokens || 0) * RATES.cacheRead +
      (u.cacheCreationTokens || 0) * RATES.cacheCreation) /
    1e6
  );
}

module.exports = { RATES, costUsd };
