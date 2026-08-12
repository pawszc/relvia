import { useTranslation } from 'react-i18next';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, type Locale } from '@shared/locales.mjs';
import { currentLocale, setUserLocale } from '../i18n';

/**
 * Przełącznik języka (header) — natywny <select>. Celowo NIE segment przycisków:
 * lista języków ma rosnąć, a segment przestaje się mieścić już przy ~4 pozycjach.
 * Natywna kontrolka skaluje się na dowolną długość listy, na mobile otwiera
 * systemowy picker, a dostępność (klawiatura, czytniki, wyszukiwanie po pierwszej
 * literze) dostajemy bez własnego kodu.
 *
 * Nazwy języków w ich własnym języku (Polski / English / Deutsch), bez flag —
 * flaga to kraj, nie język. Zmiana działa bez przeładowania i utrwala JAWNY
 * wybór (localStorage).
 */
export default function LanguageSwitcher() {
  const { t } = useTranslation();
  // currentLocale() zamiast i18n.language: zwęża do Locale (np. 'en-US' → 'en'),
  // więc <select> nigdy nie dostanie wartości spoza listy opcji.
  const value = currentLocale();

  return (
    <div className="lang-switch">
      <select
        className="lang-select"
        aria-label={t('app.languageLabel')}
        value={value}
        onChange={(e) => setUserLocale(e.target.value as Locale)}
      >
        {SUPPORTED_LOCALES.map((locale: Locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LOCALE_NATIVE_NAMES[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
