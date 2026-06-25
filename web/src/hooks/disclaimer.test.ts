import { describe, it, expect } from 'vitest';
import { SAFETY_DISCLAIMER_TEXT } from './useConversation';

/**
 * Guard A1: disclaimer kryzysowy musi być obecny i zawierać zweryfikowane numery PL.
 * Chroni przed przypadkowym usunięciem treści bezpieczeństwa przy refaktorze.
 */
describe('disclaimer bezpieczeństwa (A1)', () => {
  it('jasno mówi, że to NIE terapeuta / pomoc doraźna', () => {
    expect(SAFETY_DISCLAIMER_TEXT).toMatch(/nie terapeut/i);
    expect(SAFETY_DISCLAIMER_TEXT.length).toBeGreaterThan(40);
  });

  it('podaje zweryfikowane numery: 112, 116 123, 800 120 002', () => {
    expect(SAFETY_DISCLAIMER_TEXT).toContain('112');
    expect(SAFETY_DISCLAIMER_TEXT).toContain('116 123');
    expect(SAFETY_DISCLAIMER_TEXT).toContain('800 120 002');
  });
});
