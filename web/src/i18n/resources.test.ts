import { describe, it, expect } from 'vitest';
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAMES } from '@shared/locales.mjs';
import pl from './locales/pl.json';
import en from './locales/en.json';
import de from './locales/de.json';

/**
 * Kompletność zasobów tłumaczeniowych — brakujące/puste tłumaczenie ma wywalić
 * TEST, a nie cicho fallbackować w produkcji. Porównanie kluczy jest REKURENCYJNE.
 */

const RESOURCES: Record<string, unknown> = { pl, en, de };

/** Rekurencyjnie spłaszcza obiekt zasobów do listy ścieżek kluczy-liści. */
function leafPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  if (obj && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  throw new Error(`nie-tekstowy liść zasobów pod "${prefix}"`);
}

function leafValue(obj: unknown, path: string): string {
  return path.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)[k], obj) as string;
}

/** Placeholdery interpolacji {{name}} oraz tagi komponentów <terms>…</terms> w wartości. */
const interpolations = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const componentTags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

describe('zasoby i18n (pl/en/de)', () => {
  it('pokrywają wszystkie obsługiwane locale z shared/locales.mjs', () => {
    expect(Object.keys(RESOURCES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const l of SUPPORTED_LOCALES) expect(LOCALE_NATIVE_NAMES[l]).toBeTruthy();
  });

  it('wszystkie języki mają IDENTYCZNY zestaw kluczy (rekurencyjnie)', () => {
    const base = leafPaths(pl).sort();
    for (const [lng, res] of Object.entries(RESOURCES)) {
      expect(leafPaths(res).sort(), `klucze ${lng} vs pl`).toEqual(base);
    }
  });

  it('żadna wartość nie jest pusta ani nie jest surowym kluczem', () => {
    for (const [lng, res] of Object.entries(RESOURCES)) {
      for (const path of leafPaths(res)) {
        const v = leafValue(res, path);
        expect(v.trim().length, `${lng}:${path}`).toBeGreaterThan(0);
        expect(v, `${lng}:${path} wygląda jak surowy klucz`).not.toMatch(/^[a-z]+(\.[A-Za-z_]+)+$/);
      }
    }
  });

  it('placeholdery interpolacji i tagi komponentów są zgodne między wersjami', () => {
    for (const path of leafPaths(pl)) {
      const expected = interpolations(leafValue(pl, path));
      const expectedTags = componentTags(leafValue(pl, path));
      for (const [lng, res] of Object.entries(RESOURCES)) {
        expect(interpolations(leafValue(res, path)), `${lng}:${path} interpolacje`).toEqual(expected);
        expect(componentTags(leafValue(res, path)), `${lng}:${path} tagi <…>`).toEqual(expectedTags);
      }
    }
  });

  it('en i de to realne tłumaczenia UI, nie kopie polskiego (próbka kluczy)', () => {
    // niektóre klucze bywają celowo identyczne (np. "Paraphrase"), więc porównujemy próbkę
    const mustDiffer = ['conversation.welcome', 'composer.writingAs', 'safety.full', 'placeholders.paused', 'parked.title'];
    for (const path of mustDiffer) {
      expect(leafValue(en, path), `en:${path}`).not.toEqual(leafValue(pl, path));
      expect(leafValue(de, path), `de:${path}`).not.toEqual(leafValue(pl, path));
    }
  });

  it('niemiecki jest nieformalny (du/ihr) w tekstach zwróconych do pary', () => {
    const sample = ['conversation.welcome', 'placeholders.paused', 'placeholders.idle', 'safety.full'].map((p) =>
      leafValue(de, p),
    );
    expect(sample.join(' ')).toMatch(/\b(ihr|euch|du|dir)\b/i);
    // brak formalnego „Sie" w środku zdania (wielka litera po małej literze/przecinku)
    for (const s of sample) expect(s).not.toMatch(/[a-zäöüß,;] Sie\b/);
  });
});
