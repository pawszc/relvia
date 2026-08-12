import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@shared/locales.mjs';
import { persistLocale, resolveInitialLocale } from './locale';
import pl from './locales/pl.json';
import en from './locales/en.json';
import de from './locales/de.json';

/**
 * Inicjalizacja i18next — SYNCHRONICZNA (zasoby inline, bez backendu HTTP),
 * wołana w main.tsx PRZED renderem Reacta. Dzięki temu pierwszy paint jest już
 * we właściwym języku (zero „błysku" złego języka na starcie).
 *
 * Zasoby: web/src/i18n/locales/{pl,en,de}.json — pl jest bazą znaczeniową.
 * Kompletność kluczy pilnuje test (resources.test.ts) — nie polegamy na cichym
 * fallbacku w produkcji.
 */

export const resources = {
  pl: { translation: pl },
  en: { translation: en },
  de: { translation: de },
} as const;

/** aktualizuje <html lang="…"> przy każdej zmianie języka (SSR-safe) */
function applyDocumentLang(lng: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}

export function initI18n(lng: Locale = resolveInitialLocale()): typeof i18n {
  if (!i18n.isInitialized) {
    // init z inline-resources jest synchroniczny (bez wtyczek async)
    void i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      interpolation: { escapeValue: false }, // React sam escapuje
      returnNull: false,
    });
    i18n.on('languageChanged', applyDocumentLang);
    applyDocumentLang(i18n.language);
  } else if (i18n.language !== lng) {
    void i18n.changeLanguage(lng);
  }
  return i18n;
}

/**
 * JAWNY wybór użytkownika (przełącznik w headerze): zmienia język bez
 * przeładowania strony i utrwala wybór w localStorage. Auto-detekcja ze startu
 * NIGDY nie przechodzi przez tę funkcję — nie jest zapisywana jako preferencja.
 */
export function setUserLocale(locale: Locale): void {
  persistLocale(locale);
  void i18n.changeLanguage(locale);
}

/** Bieżący język jako zwężony typ Locale (i18n.language ⊆ SUPPORTED_LOCALES). */
export function currentLocale(): Locale {
  const l = i18n.language as Locale;
  return (SUPPORTED_LOCALES as readonly string[]).includes(l) ? l : DEFAULT_LOCALE;
}

export default i18n;
