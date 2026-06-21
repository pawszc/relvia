import { useEffect, useRef } from 'react';
import type { Author } from '@shared/chat-contract';
import type { UiMessage } from '../hooks/useConversation';
import MessageBubble, { type AdvisorSide } from './MessageBubble';

/**
 * Przewijalna lista wiadomości w kanale „dwa brzegi": lewy brzeg = Ona (terakota),
 * prawy = On (szałwia), środkiem cienka linia. Renderuje w kolejności tablicy
 * (nie sortuje po seq) i auto-scrolluje na dół przy każdej zmianie.
 *
 * Doradca jest pozycjonowany WG ADRESATA — pochyla się ku brzegowi osoby, do której
 * mówi. Stronę wyliczamy z `decisionType` (zapisanego na dymce) + poprzedzającej
 * wypowiedzi pary, replikując regułę `replyAudience` z backendu. To czysto wizualne
 * — nie dotykamy logiki rozmowy.
 */

interface Props {
  messages: UiMessage[];
  herName: string;
  hisName: string;
  advisorTyping: boolean; // czy doradca aktualnie "pisze" (pokazuje kropki)
  onRetry: (clientId: string) => void;
}

const TO_BOTH = new Set(['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE']);
const sideForAuthor = (a: Author): AdvisorSide => (a === 'HER' ? 'left' : a === 'HIM' ? 'right' : 'center');

/** Do którego brzegu pochyla się dymka doradcy o indeksie `i` (wg adresata). */
function advisorSide(messages: UiMessage[], i: number): AdvisorSide {
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

export default function MessageList({ messages, herName, hisName, advisorTyping, onRetry }: Props) {
  // pusty <div> na samym dole, do którego przewijamy
  const endRef = useRef<HTMLDivElement>(null);

  // auto-scroll na dół przy nowych wiadomościach / kolejnych chunkach streamingu
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, advisorTyping]);

  return (
    <div className="channel">
      {/* warstwy brzegów + linia środkowa (tło, pod wiadomościami) */}
      <div className="bank bank-her" aria-hidden="true" />
      <div className="bank bank-him" aria-hidden="true" />
      <div className="channel-line" aria-hidden="true" />

      <div className="messages">
        {/* empty-state: brak wiadomości i doradca nie pisze (świeże wejście) */}
        {messages.length === 0 && !advisorTyping && (
          // dwie połówki straddlujące linię środkową kanału (lewa = brzeg Ony, prawa = On)
          <div className="empty-state">
            <span className="empty-left">Wybierzcie,&nbsp;kto&nbsp;zaczyna</span>
            <span className="empty-right">albo&nbsp;zacznijcie&nbsp;wspólnie</span>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble
            // klucz: clientId dla wiadomości pary (stabilny mimo reconcile id),
            // a id dla wiadomości doradcy
            key={m.clientId ?? m.id}
            message={m}
            herName={herName}
            hisName={hisName}
            advisorSide={m.author === 'ADVISOR' ? advisorSide(messages, i) : 'center'}
            // "pisze" tylko pusty bąbel doradcy w trakcie streamingu
            typing={advisorTyping && m.author === 'ADVISOR' && m.text.length === 0}
            onRetry={onRetry}
          />
        ))}

        <div ref={endRef} />
      </div>
    </div>
  );
}
