import { describe, it, expect } from 'vitest';
import { resolveLocale } from './locale';

/**
 * Wybór języka — czysta funkcja resolveLocale (środowisko wstrzykiwane, 0 DOM).
 * Kontrakt: zapisany wybór → navigator.languages (kolejność) → navigator.language → pl.
 */
describe('resolveLocale — kolejność i normalizacja', () => {
  it('zapisane de ma pierwszeństwo przed językiem przeglądarki', () => {
    expect(resolveLocale({ stored: 'de', languages: ['en-US', 'en'], language: 'en-US' })).toBe('de');
  });

  it('zapisane en ma pierwszeństwo przed językiem przeglądarki', () => {
    expect(resolveLocale({ stored: 'en', languages: ['de-DE', 'de'], language: 'de-DE' })).toBe('en');
  });

  it('niepoprawna wartość localStorage jest ignorowana (dalej działa detekcja)', () => {
    expect(resolveLocale({ stored: 'xx-INVALID', languages: ['de-DE'], language: 'de-DE' })).toBe('de');
    expect(resolveLocale({ stored: '{"hacked":true}', languages: ['en-GB'] })).toBe('en');
    expect(resolveLocale({ stored: 42 as unknown, languages: ['pl-PL'] })).toBe('pl');
  });

  it('warianty regionalne: pl-PL → pl', () => {
    expect(resolveLocale({ languages: ['pl-PL'] })).toBe('pl');
  });

  it('warianty regionalne: en-US i en-GB → en', () => {
    expect(resolveLocale({ languages: ['en-US'] })).toBe('en');
    expect(resolveLocale({ languages: ['en-GB'] })).toBe('en');
  });

  it('warianty regionalne: de-DE, de-AT i de-CH → de', () => {
    for (const tag of ['de-DE', 'de-AT', 'de-CH']) {
      expect(resolveLocale({ languages: [tag] })).toBe('de');
    }
  });

  it('respektuje KOLEJNOŚĆ navigator.languages (pierwszy obsługiwany wygrywa)', () => {
    expect(resolveLocale({ languages: ['fr-FR', 'de-AT', 'en-US'] })).toBe('de');
    expect(resolveLocale({ languages: ['fr-FR', 'it-IT', 'en-GB', 'de'] })).toBe('en');
  });

  it('nieobsługiwany język przeglądarki (fr-FR) → polski fallback', () => {
    expect(resolveLocale({ languages: ['fr-FR', 'fr'], language: 'fr-FR' })).toBe('pl');
  });

  it('navigator.language jako zapas, gdy languages puste/nieprzydatne', () => {
    expect(resolveLocale({ languages: [], language: 'de-CH' })).toBe('de');
    expect(resolveLocale({ language: 'en-US' })).toBe('en');
  });

  it('brak navigatora / środowisko SSR-owe → pl, bez wyjątku', () => {
    expect(resolveLocale({})).toBe('pl');
    expect(resolveLocale({ stored: null, languages: undefined, language: undefined })).toBe('pl');
    expect(resolveLocale({ languages: [null, 123, {}] as unknown[] })).toBe('pl');
  });
});
