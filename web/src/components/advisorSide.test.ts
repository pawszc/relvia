import { describe, it, expect } from 'vitest';
import { advisorSide } from './advisorSide';

/** Pozycjonowanie dymki doradcy (czysta logika, bez DOM). */
const adv = (decisionType?: string, kind?: string) =>
  ({ author: 'ADVISOR', decisionType, kind }) as any;
const her = { author: 'HER' } as any;
const him = { author: 'HIM' } as any;
const both = { author: 'TOGETHER' } as any;

describe('advisorSide — pozycja dymki doradcy', () => {
  it('typy „do obojga" (w tym PROTECT) → center', () => {
    for (const t of ['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE', 'PROTECT'])
      expect(advisorSide([her, adv(t)], 1), t).toBe('center');
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
