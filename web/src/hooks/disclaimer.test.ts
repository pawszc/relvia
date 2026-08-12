import { describe, it, expect } from 'vitest';
import pl from '../i18n/locales/pl.json';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';

/**
 * Guard A1: disclaimer kryzysowy musi być obecny i zawierać zweryfikowane numery PL —
 * w KAŻDYM obsługiwanym języku (zatwierdzone wersje pl/en/de, nie spontaniczne
 * tłumaczenie). Chroni przed przypadkowym usunięciem treści bezpieczeństwa.
 */
const LANGS = { pl, en, de } as const;

describe('disclaimer bezpieczeństwa (A1) — pl/en/de', () => {
  it.each(Object.entries(LANGS))('%s: jasno mówi, że to NIE terapeuta / pomoc doraźna', (_lng, res) => {
    expect(res.safety.full).toMatch(/nie terapeut|not a therapist|kein Therapeut/i);
    expect(res.safety.full.length).toBeGreaterThan(40);
  });

  it.each(Object.entries(LANGS))('%s: podaje zweryfikowane numery: 112, 116 123, 800 120 002', (_lng, res) => {
    for (const text of [res.safety.full, res.safety.help]) {
      expect(text).toContain('112');
      expect(text).toContain('116 123');
      expect(text).toContain('800 120 002');
    }
  });

  it('polska wersja pozostaje niezmieniona względem stanu sprzed i18n (regresja)', () => {
    expect(pl.safety.full).toBe(
      'Relvia to doradca AI, nie terapeuta ani pomoc w nagłych sytuacjach. Jeśli potrzebujesz pilnej pomocy, zadzwoń pod 112. Wsparcie emocjonalne: całodobowy telefon zaufania 116 123; przy przemocy — Niebieska Linia 800 120 002.',
    );
    expect(pl.safety.short).toBe('Relvia to doradca AI a nie terapeuta');
  });
});
