/**
 * „Markdown B" — twarde czyszczenie odpowiedzi doradcy z artefaktów, których UI
 * (czysty tekst) nie renderuje: znaczniki markdown i wiodące etykiety mówcy.
 * Gwarancja niezależna od tego, czy model posłuchał instrukcji w personie.
 *
 * Wydzielone z chat-service.js jako czysta funkcja → testowalne bez ładowania CAP.
 */
function sanitizeAdvisor(text) {
  if (!text) return text;
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **pogrubienie** → tekst
    .replace(/\*([^*\n]+)\*/g, '$1') // *kursywa* → tekst
    .replace(/\*/g, '') // osierocone gwiazdki
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // nagłówki markdown
    .replace(/^\s{0,3}>\s?/gm, '') // cytaty blokowe
    .replace(/^\s*\[[^\]]+\]\s*:?\s*/, '') // wiodąca etykieta np. "[On]:"
    .trim();
}

module.exports = { sanitizeAdvisor };
