/**
 * Throttle tworzenia konwersacji per IP — CZYSTA funkcja (bez CAP/Express),
 * więc testowalna jednostkowo. Łączy dwa dławiki:
 *   • ODSTĘP   — min. czas między kolejnymi utworzeniami (tempo),
 *   • OKNO     — twardy limit, ile łącznie utworzeń mieści się w oknie (np. godzinie).
 *
 * Operuje na liście znaczników czasu danego IP. Zwraca decyzję ORAZ przyciętą listę
 * (poza oknem usunięte), żeby wołający trzymał w pamięci tylko aktualne wpisy.
 *
 * @param {number[]} timestamps  dotychczasowe znaczniki (ms) tego IP
 * @param {number}   now         bieżący czas (Date.now())
 * @param {{minIntervalMs:number, maxPerWindow:number, windowMs:number}} cfg
 * @returns {{allowed:boolean, reason?:'INTERVAL'|'WINDOW_CAP', timestamps:number[]}}
 */
function checkAndRecord(timestamps, now, { minIntervalMs, maxPerWindow, windowMs }) {
  const recent = (timestamps || []).filter((t) => now - t < windowMs); // tylko w oknie
  const last = recent.length ? recent[recent.length - 1] : 0;

  if (last && now - last < minIntervalMs) {
    return { allowed: false, reason: 'INTERVAL', timestamps: recent };
  }
  if (recent.length >= maxPerWindow) {
    return { allowed: false, reason: 'WINDOW_CAP', timestamps: recent };
  }
  recent.push(now);
  return { allowed: true, timestamps: recent };
}

module.exports = { checkAndRecord };
