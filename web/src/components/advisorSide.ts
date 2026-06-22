import type { Author, AdvisorBubbleKind, AdvisorDecisionType } from '@shared/chat-contract';

/**
 * Po której stronie kanału „dwa brzegi" pochyla się dymka doradcy: lewy (Ona) /
 * prawy (On) / środek (do obojga). Czysta funkcja — wydzielona z MessageList, by
 * dało się ją testować (Vitest) bez ładowania React/DOM.
 *
 * To FRONTOWE LUSTRO backendowego `replyAudience` (anthropicAdvisor.js): typy „do
 * obojga" (w tym PROTECT) → środek; ASK_OTHER → druga strona; reszta → bieżący mówca.
 * Trzymać zgodne z backendem — patrz test parzystości advisorSide.test.ts.
 */
export type AdvisorSide = 'left' | 'right' | 'center';

/** Typy adresowane do OBOJGA → dymka na środku (lustro replyAudience → TOGETHER). */
const TO_BOTH = new Set<AdvisorDecisionType>(['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE', 'PROTECT']);

const sideForAuthor = (a: Author): AdvisorSide => (a === 'HER' ? 'left' : a === 'HIM' ? 'right' : 'center');

/** Minimalny kształt wiadomości potrzebny do pozycjonowania (UiMessage go spełnia). */
type Msg = { author: Author; kind?: AdvisorBubbleKind; decisionType?: AdvisorDecisionType };

/** Do którego brzegu pochyla się dymka doradcy o indeksie `i` (wg adresata). */
export function advisorSide(messages: Msg[], i: number): AdvisorSide {
  const m = messages[i];
  // mała dymka (interwencja/moderacja) zawsze na środku — komunikat do obojga
  if (m.kind === 'INTERVENTION' || m.kind === 'MODERATION') return 'center';
  if (m.decisionType && TO_BOTH.has(m.decisionType)) return 'center';

  // ostatnia wypowiedź pary przed tą dymką wyznacza „bieżącego mówcę"
  let last: Author | null = null;
  for (let j = i - 1; j >= 0; j--) {
    if (messages[j].author !== 'ADVISOR') {
      last = messages[j].author;
      break;
    }
  }
  if (!last || last === 'TOGETHER') return 'center';
  // ASK_OTHER → oddaje głos drugiej stronie; reszta (DEEPEN/CLARIFY/…) → zostaje przy mówiącym
  if (m.decisionType === 'ASK_OTHER') return last === 'HER' ? 'right' : 'left';
  return sideForAuthor(last);
}
