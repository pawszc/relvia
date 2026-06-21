import type { SenderAuthor } from '@shared/chat-contract';
import Avatar from './Avatar';

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

// kolejność i etykiety pigułek: Ona (HER) · On (HIM) · Razem (TOGETHER)
const PILLS: { author: SenderAuthor; label: (h: string, m: string) => string }[] = [
  { author: 'HER', label: (h) => h },
  { author: 'HIM', label: (_h, m) => m },
  { author: 'TOGETHER', label: () => 'Razem' },
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
            {/* awatar(y) strony — zawsze widoczne, podpowiadają, kto pisze */}
            {p.author === 'HER' && <Avatar who="HER" size={18} alt="" />}
            {p.author === 'HIM' && <Avatar who="HIM" size={18} alt="" />}
            {p.author === 'TOGETHER' && (
              <span className="pill-pair">
                <Avatar who="HER" size={18} alt="" />
                <Avatar who="HIM" size={18} alt="" />
              </span>
            )}
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
