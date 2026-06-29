import type { Author, AdvisorBubbleKind, AdvisorDecisionType } from '@shared/chat-contract';

/**
 * Po której stronie kanału „dwa brzegi" pochyla się dymka doradcy: lewy (Ona) /
 * prawy (On) / środek (do obojga). Czysta funkcja — wydzielona z MessageList, by
 * dało się ją testować (Vitest) bez ładowania React/DOM.
 *
 * JEDNO ŹRÓDŁO PRAWDY: adresat wyliczony przez reżysera (backend `replyAudience` →
 * `nextSpeaker`) jest stemplowany na dymce jako `audience` i to ON wyznacza stronę.
 * Dawne LUSTRO listy typów zostaje już TYLKO jako fallback dla wiadomości bez `audience`
 * (np. historyczne sprzed tej zmiany): typy „do obojga" → środek; reszta → bieżący mówca.
 */
export type AdvisorSide = 'left' | 'right' | 'center';

/** FALLBACK: typy adresowane do OBOJGA → środek (gdy brak `audience` na dymce).
 *  PROTECT NIE jest tu — adresuje osobę skrzywdzoną (idzie przez `audience`/bieżący mówca). */
const TO_BOTH = new Set<AdvisorDecisionType>(['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE']);

const sideForAuthor = (a: Author): AdvisorSide => (a === 'HER' ? 'left' : a === 'HIM' ? 'right' : 'center');

/** Minimalny kształt wiadomości potrzebny do pozycjonowania (UiMessage go spełnia). */
type Msg = { author: Author; kind?: AdvisorBubbleKind; decisionType?: AdvisorDecisionType; audience?: Author };

/** Do którego brzegu pochyla się dymka doradcy o indeksie `i` (wg adresata). */
export function advisorSide(messages: Msg[], i: number): AdvisorSide {
  const m = messages[i];
  // mała dymka (interwencja/moderacja) zawsze na środku — komunikat do obojga
  if (m.kind === 'INTERVENTION' || m.kind === 'MODERATION') return 'center';
  // adresat wg reżysera (jedno źródło prawdy z backendem) — gdy znany, on rządzi stroną
  if (m.audience) return sideForAuthor(m.audience);
  // — fallback dla dymek bez audience (historyczne) —
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
