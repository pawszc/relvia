import type { UiMessage } from '../hooks/useConversation';

/**
 * Pojedynczy bąbel wiadomości w stylu A4. Wygląd zależy od autora:
 *  - ADVISOR  → środek, awatar + biały bąbel (Newsreader),
 *  - HER (Ola) → lewa, gradient terakota,
 *  - HIM (Tomek) → prawa, gradient szałwia,
 *  - TOGETHER → środek, "hero" z etykietą "Powiedzieliście to razem".
 * Pod bąblem pary pokazujemy status wysyłki (sending / failed + retry).
 */

interface Props {
  message: UiMessage;
  herName: string;
  hisName: string;
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

export default function MessageBubble({ message, herName, hisName, typing, onRetry }: Props) {
  // jeden case na autora — to tu mapujemy model (Author) na render A4
  switch (message.author) {
    case 'ADVISOR':
      return (
        <div className="row row-advisor">
          <span className="advisor-avatar">
            <span className="advisor-dot" />
          </span>
          <div className="bubble bubble-advisor">{typing ? <TypingDots /> : message.text}</div>
        </div>
      );

    case 'HER':
      return (
        <div className="row row-her">
          <div className="label label-her">
            <span className="dot dot-her" />
            {herName}
          </div>
          <div className="bubble bubble-her">{message.text}</div>
          <Status message={message} onRetry={onRetry} />
        </div>
      );

    case 'HIM':
      return (
        <div className="row row-him">
          <div className="label label-him">
            {hisName}
            <span className="dot dot-him" />
          </div>
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
