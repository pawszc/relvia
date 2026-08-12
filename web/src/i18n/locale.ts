import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, normalizeLocale, type Locale } from '@shared/locales.mjs';

/**
 * Wybór języka UI — czyste funkcje (testowalne bez DOM).
 *
 * Kolejność (kontrakt):
 *  1. jawny wybór użytkownika zapisany w localStorage (klucz LOCALE_STORAGE_KEY),
 *  2. navigator.languages (w kolejności preferencji przeglądarki),
 *  3. navigator.language,
 *  4. fallback do DEFAULT_LOCALE (pl).
 *
 * Warianty regionalne normalizuje shared/locales.mjs (pl-PL→pl, en-GB→en,
 * de-AT→de); wartości nieobsługiwane/uszkodzone są pomijane (nie przerywają
 * detekcji). Automatyczna detekcja NIE jest zapisywana — do localStorage trafia
 * wyłącznie jawny wybór użytkownika (persistLocale, wołane z przełącznika).
 */

export interface LocaleEnv {
  stored?: unknown; // surowa wartość z localStorage (może być śmieciem)
  languages?: readonly unknown[]; // navigator.languages
  language?: unknown; // navigator.language
}

/** Czysta funkcja wyboru — całe środowisko wstrzykiwane (testy/SSR-safe). */
export function resolveLocale(env: LocaleEnv): Locale {
  const stored = normalizeLocale(env.stored);
  if (stored) return stored; // 1. jawny wybór użytkownika
  if (Array.isArray(env.languages)) {
    for (const tag of env.languages) {
      const l = normalizeLocale(tag);
      if (l) return l; // 2. pierwszy obsługiwany z listy preferencji
    }
  }
  const single = normalizeLocale(env.language);
  if (single) return single; // 3. navigator.language
  return DEFAULT_LOCALE; // 4. fallback
}

/** Odczyt zapisanej preferencji (odporny na brak localStorage / tryb prywatny). */
export function readStoredLocale(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Locale na start aplikacji — z realnego środowiska przeglądarki (SSR-safe). */
export function resolveInitialLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return resolveLocale({
    stored: readStoredLocale(),
    languages: nav?.languages,
    language: nav?.language,
  });
}

/** Utrwala JAWNY wybór użytkownika (tylko z przełącznika — nie z auto-detekcji). */
export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // brak localStorage (np. tryb prywatny) — wybór działa do końca sesji
  }
}
