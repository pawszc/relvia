/** Deklaracje typów dla shared/locales.mjs (jedno źródło prawdy locale). */

export type Locale = 'pl' | 'en' | 'de';

export declare const SUPPORTED_LOCALES: readonly ['pl', 'en', 'de'];
export declare const DEFAULT_LOCALE: 'pl';
export declare const LOCALE_STORAGE_KEY: 'relvia.locale.v1';
export declare const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>>;

/** Tag języka → obsługiwane locale albo null (nieobsługiwany). */
export declare function normalizeLocale(tag: unknown): Locale | null;
/** Jak normalizeLocale, ale z fallbackiem do DEFAULT_LOCALE (kontrakt backendu). */
export declare function normalizeLocaleOrDefault(tag: unknown): Locale;
