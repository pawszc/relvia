/**
 * Obsługiwane języki aplikacji — JEDNO ŹRÓDŁO PRAWDY (frontend + backend).
 *
 * Format ESM (.mjs) celowo: frontend importuje przez alias `@shared`
 * (Vite/TS), a backend CommonJS przez `require()` — Node ≥22.12 wspiera
 * synchroniczne require() modułów ESM bez top-level await (projekt: Node 24,
 * CI: Node 22). Dzięki temu lista pl/en/de i normalizacja żyją w JEDNYM pliku.
 *
 * Kontrakt normalizacji (wersjonowany razem z kodem):
 *  - warianty regionalne → język bazowy (pl-PL→pl, en-US/en-GB→en, de-DE/de-AT/de-CH→de),
 *  - porównanie case-insensitive (PL, De-de → pl, de),
 *  - wszystko inne (fr-FR, '', null, obiekty, próby injection) → null.
 * Fallback do DEFAULT_LOCALE robi WOŁAJĄCY (resolver frontendu / walidacja
 * backendu) — dzięki temu resolver umie odróżnić „nieobsługiwany" od „polski".
 */

export const SUPPORTED_LOCALES = /** @type {const} */ (['pl', 'en', 'de']);

export const DEFAULT_LOCALE = 'pl';

/** Klucz localStorage jawnego wyboru użytkownika (wersjonowany). */
export const LOCALE_STORAGE_KEY = 'relvia.locale.v1';

/** Nazwy języków w ich własnym języku (przełącznik w UI — bez flag). */
export const LOCALE_NATIVE_NAMES = Object.freeze({
  pl: 'Polski',
  en: 'English',
  de: 'Deutsch',
});

/**
 * Normalizuje dowolny tag języka (np. z navigator.language, localStorage albo
 * pola requestu) do obsługiwanego locale — albo null, gdy nieobsługiwany.
 * NIGDY nie zwraca surowego wejścia: wynik to wyłącznie element SUPPORTED_LOCALES.
 * @param {unknown} tag
 * @returns {'pl'|'en'|'de'|null}
 */
export function normalizeLocale(tag) {
  if (typeof tag !== 'string') return null;
  const base = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED_LOCALES.includes(/** @type {any} */ (base)) ? /** @type {any} */ (base) : null;
}

/**
 * Jak wyżej, ale z fallbackiem do DEFAULT_LOCALE — kontrakt backendu
 * („brak/nieznane locale = pl", kompatybilność ze starszym klientem).
 * @param {unknown} tag
 * @returns {'pl'|'en'|'de'}
 */
export function normalizeLocaleOrDefault(tag) {
  return normalizeLocale(tag) ?? DEFAULT_LOCALE;
}
