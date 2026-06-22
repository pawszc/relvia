import { describe, it, expect } from 'vitest';
import { decide as frontDecide } from './mockChatClient';
// backend to CJS bez deklaracji typów — w runtime ładuje go Vitest, tu tylko uciszamy tsc.
// @ts-expect-error: brak .d.ts dla srv/advisor/decisionRules.js (typowane castem niżej)
import backend from '../../../srv/advisor/decisionRules.js';
import type { ChatMessage, ConversationState } from '@shared/chat-contract';

/**
 * Strażnik FOOTGUNA „zmieniaj OBA": reguły żyją w decisionRules.js (backend, CJS) i
 * są lustrzanie powtórzone w mockChatClient.ts (front, TS). Ten test odpala OBA `decide`
 * na tym samym zestawie historii i sprawdza, że dają tę samą decyzję (typ + shouldSpeak).
 * Rozjazd reguł = czerwony test.
 */
const backendDecide = (backend as { decide: typeof frontDecide }).decide;

let seq = 0;
const m = (author: string, text: string, decisionType?: string) =>
  ({ id: String(seq), conversationId: 'c', seq: seq++, author, text, createdAt: '', ...(decisionType && { decisionType }) }) as ChatMessage;
const st = (over: Partial<ConversationState> = {}) =>
  ({ phase: 'OPENING', advisorMode: 'LEADING', parkedTopics: [], turnsSinceProgress: 0, escalationStreak: 0, ...over }) as ConversationState;
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji.';

const cases: { name: string; hist: ChatMessage[]; state: ConversationState }[] = [
  { name: 'brak wypowiedzi → WAIT', hist: [], state: st() },
  { name: 'kryzys → SAFETY_STOP', hist: [m('HER', 'Wczoraj uderzył mnie w twarz.')], state: st() },
  { name: 'PAUSED → WAIT', hist: [m('HER', LONG)], state: st({ advisorMode: 'PAUSED' }) },
  { name: 'eskalacja → INTERVENE', hist: [m('HIM', 'Jesteś beznadziejna i do niczego się nie nadajesz.')], state: st() },
  { name: 'dygresja → REFRAME', hist: [m('HER', 'A tak w ogóle to pogadajmy kiedyś o wakacjach nad morzem.')], state: st({ topic: 'podział obowiązków' }) },
  { name: 'pojedyncza treść → DEEPEN', hist: [m('HER', LONG)], state: st() },
  { name: 'krótka negacja → CLARIFY', hist: [m('HER', LONG), m('HIM', 'nieprawda!')], state: st() },
  { name: 'TOGETHER z treścią → SUMMARIZE', hist: [m('TOGETHER', 'Razem czujemy, że się od siebie oddalamy i chcemy to naprawić.')], state: st() },
];

describe('parzystość reguł: mockChatClient (front) ↔ decisionRules (back)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const f = frontDecide(c.hist, c.state);
      const b = backendDecide(c.hist, c.state);
      expect(f.type, `typ: ${c.name}`).toBe(b.type);
      expect(f.shouldSpeak, `shouldSpeak: ${c.name}`).toBe(b.shouldSpeak);
    });
  }
});
