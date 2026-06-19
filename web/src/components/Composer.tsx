import type { SenderAuthor } from '@shared/chat-contract';

/**
 * Kompozytor: przełącznik autora (Ona / Razem / On) + pole tekstowe.
 * Komponent prezentacyjny — tekst, placeholder i autor przychodzą z góry (ChatScreen),
 * bo to ChatScreen prowadzi „inteligentny kompozytor" (auto-autor + placeholder wg
 * decyzji reżysera). Enter wysyła, Shift+Enter nie.
 */

interface Props {
  author: SenderAuthor;
  onAuthorChange: (a: SenderAuthor) => void;
  text: string;
  onTextChange: (t: string) => void;
  placeholder: string;
  onSend: () => void;
  herName: string;
  hisName: string;
  disabled: boolean; // blokada na czas wysyłki / zanim hook gotowy
}

// kolejność i etykiety pigułek: Ona (HER) · Razem (TOGETHER) · On (HIM)
const PILLS: { author: SenderAuthor; label: (h: string, m: string) => string }[] = [
  { author: 'HER', label: (h) => h },
  { author: 'TOGETHER', label: () => 'Razem' },
  { author: 'HIM', label: (_h, m) => m },
];

export default function Composer({
  author,
  onAuthorChange,
  text,
  onTextChange,
  placeholder,
  onSend,
  herName,
  hisName,
  disabled,
}: Props) {
  return (
    <div className="composer">
      {/* przełącznik autora; aktywna pigułka dostaje kropkę(-i) i styl */}
      <div className={`pills pills-${author.toLowerCase()}`}>
        {PILLS.map((p) => (
          <button
            key={p.author}
            type="button"
            className={`pill ${author === p.author ? 'pill-active' : ''} pill-${p.author.toLowerCase()}`}
            onClick={() => onAuthorChange(p.author)}
          >
            {/* kropki kolorystyczne tylko przy aktywnym autorze */}
            {p.author === 'TOGETHER' && author === 'TOGETHER' && (
              <>
                <span className="dot dot-her" />
                <span className="dot dot-him" />
              </>
            )}
            {p.author === 'HER' && author === 'HER' && <span className="dot dot-her" />}
            {p.author === 'HIM' && author === 'HIM' && <span className="dot dot-him" />}
            {p.label(herName, hisName)}
          </button>
        ))}
      </div>

      {/* pole + przycisk wyślij (↑) */}
      <div className="input-wrap">
        <input
          className="input"
          value={text}
          placeholder={placeholder}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={disabled}
        />
        <button className="send" type="button" onClick={onSend} disabled={disabled || !text.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
