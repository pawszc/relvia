import type { UiMessage } from '../hooks/useConversation';
import Avatar from './Avatar';

/**
 * Pojedynczy bąbel wiadomości (design „Relvia", kanał „dwa brzegi"). Wygląd zależy od autora:
 *  - HER (Ona)   → lewy brzeg, awatar nad dymką, gradient terakota,
 *  - HIM (On)    → prawy brzeg, awatar nad dymką, gradient szałwia,
 *  - TOGETHER    → środek, „hero" z etykietą „Powiedzieliście to razem",
 *  - ADVISOR     → biały bąbel (Newsreader) pochylony ku adresatowi (advisorSide),
 *                  interwencja/moderacja → mała dymka na środku.
 * Pod bąblem pary pokazujemy status wysyłki (sending / failed + retry).
 */

export type AdvisorSide = 'left' | 'right' | 'center';

interface Props {
  message: UiMessage;
  herName: string;
  hisName: string;
  advisorSide: AdvisorSide; // do którego brzegu pochyla się doradca (wg adresata)
  typing: boolean; // doradca pisze (pusty bąbel) → animowane kropki
  onRetry: (clientId: string) => void;
}

/** Animowane "…" gdy doradca generuje odpowiedź. */
const TypingDots = () => (
  <span className="typing">
    <span />
    <span />
    <span />
  </span>
);

/**
 * Pasek statusu pod wiadomością pary:
 *  - 'sending' → dyskretne "wysyłanie…",
 *  - 'failed'  → klikalne "wyślij ponownie" (woła onRetry z clientId),
 *  - 'sent'/brak → nic.
 */
function Status({ message, onRetry }: { message: UiMessage; onRetry: (id: string) => void }) {
  if (message.status === 'sending') return <div className="msg-status">wysyłanie…</div>;
  if (message.status === 'failed') {
    return (
      <button
        type="button"
        className="msg-status msg-retry"
        onClick={() => message.clientId && onRetry(message.clientId)}
      >
        Nie wysłano · wyślij ponownie
      </button>
    );
  }
  return null;
}

export default function MessageBubble({ message, herName, hisName, advisorSide, typing, onRetry }: Props) {
  // jeden case na autora — to tu mapujemy model (Author) na render „dwa brzegi"
  switch (message.author) {
    case 'ADVISOR': {
      // interwencja/moderacja → mała, wyróżniona dymka na środku.
      const small = message.kind === 'INTERVENTION' || message.kind === 'MODERATION';
      if (small) {
        return (
          <div className="row row-intervene">
            <div className="label label-intervene">chwila spokoju</div>
            <div className="bubble bubble-intervene">{typing ? <TypingDots /> : message.text}</div>
          </div>
        );
      }
      return (
        <div className={`row row-advisor row-advisor-${advisorSide}`}>
          <Avatar who="ADVISOR" size={34} className="advisor-av" />
          <div className="bubble bubble-advisor">{typing ? <TypingDots /> : message.text}</div>
        </div>
      );
    }

    case 'HER':
      return (
        <div className="row row-her">
          <Avatar who="HER" size={34} alt={herName} className="msg-av" />
          <div className="bubble bubble-her">{message.text}</div>
          <Status message={message} onRetry={onRetry} />
        </div>
      );

    case 'HIM':
      return (
        <div className="row row-him">
          <Avatar who="HIM" size={34} alt={hisName} className="msg-av" />
          <div className="bubble bubble-him">{message.text}</div>
          <Status message={message} onRetry={onRetry} />
        </div>
      );

    case 'TOGETHER':
      return (
        <div className="row row-together">
          <div className="label label-together">
            <span className="dot dot-her" />
            <span className="dot dot-him" />
            Powiedzieliście to razem
          </div>
          <div className="bubble bubble-together">{message.text}</div>
          <Status message={message} onRetry={onRetry} />
        </div>
      );
  }
}
