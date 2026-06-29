import { describe, it, expect } from 'vitest';
import { advisorSide } from './advisorSide';

/** Pozycjonowanie dymki doradcy (czysta logika, bez DOM). */
const adv = (decisionType?: string, kind?: string, audience?: string) =>
  ({ author: 'ADVISOR', decisionType, kind, ...(audience && { audience }) }) as any;
const her = { author: 'HER' } as any;
const him = { author: 'HIM' } as any;
const both = { author: 'TOGETHER' } as any;

describe('advisorSide — pozycja dymki doradcy', () => {
  it('audience (reżyser) jest JEDNYM źródłem prawdy i nadpisuje heurystykę', () => {
    // PROTECT do Niej, choć On pisał ostatni (edge długiej rozmowy) → lewy brzeg (Ona)
    expect(advisorSide([him, adv('PROTECT', undefined, 'HER')], 1)).toBe('left');
    expect(advisorSide([her, adv('DEEPEN', undefined, 'HIM')], 1)).toBe('right');
    expect(advisorSide([her, adv('SUMMARIZE', undefined, 'TOGETHER')], 1)).toBe('center');
  });

  it('FALLBACK (brak audience): typy „do obojga" → center (PROTECT już NIE tu)', () => {
    for (const t of ['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE'])
      expect(advisorSide([her, adv(t)], 1), t).toBe('center');
  });

  it('FALLBACK: PROTECT bez audience → przy mówiącym (po HER → left)', () => {
    expect(advisorSide([her, adv('PROTECT')], 1)).toBe('left');
  });

  it('mała dymka INTERVENTION/MODERATION → center', () => {
    expect(advisorSide([her, adv('INTERVENE', 'INTERVENTION')], 1)).toBe('center');
    expect(advisorSide([him, adv('SAFETY_STOP', 'MODERATION')], 1)).toBe('center');
  });

  it('ASK_OTHER oddaje głos drugiej stronie: po HER → right, po HIM → left', () => {
    expect(advisorSide([her, adv('ASK_OTHER')], 1)).toBe('right');
    expect(advisorSide([him, adv('ASK_OTHER')], 1)).toBe('left');
  });

  it('DEEPEN/CLARIFY zostają przy mówiącym: HER → left, HIM → right', () => {
    expect(advisorSide([her, adv('DEEPEN')], 1)).toBe('left');
    expect(advisorSide([him, adv('CLARIFY')], 1)).toBe('right');
  });

  it('po wypowiedzi TOGETHER → center', () => {
    expect(advisorSide([both, adv('DEEPEN')], 1)).toBe('center');
  });

  it('brak wcześniejszej wypowiedzi pary → center', () => {
    expect(advisorSide([adv('DEEPEN')], 0)).toBe('center');
  });
});
