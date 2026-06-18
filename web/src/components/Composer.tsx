import { useState } from 'react';
import type { SenderAuthor } from '@shared/chat-contract';

/**
 * Kompozytor: przełącznik autora (Ola / Razem / Tomek) + pole tekstowe.
 * Stan tekstu jest lokalny; wybrany autor przychodzi z góry (ChatScreen),
 * bo decyduje też o tym, jak wygląda pasek i placeholder.
 * Enter wysyła, Shift+Enter nie (zostawiamy miejsce na ewentualne wielolinie).
 */

interface Props {
  author: SenderAuthor;
  onAuthorChange: (a: SenderAuthor) => void;
  onSend: (text: string) => void;
  herName: string;
  hisName: string;
  disabled: boolean; // blokada na czas wysyłki / zanim hook gotowy
}

// kolejność i etykiety pigułek: Ola (HER) · Razem (TOGETHER) · Tomek (HIM)
const PILLS: { author: SenderAuthor; label: (h: string, m: string) => string }[] = [
  { author: 'HER', label: (h) => h },
  { author: 'TOGETHER', label: () => 'Razem' },
  { author: 'HIM', label: (_h, m) => m },
];

export default function Composer({
  author,
  onAuthorChange,
  onSend,
  herName,
  hisName,
  disabled,
}: Props) {
  const [text, setText] = useState('');

  // placeholder zależny od aktywnego autora
  const placeholder =
    author === 'TOGETHER'
      ? 'Piszecie razem…'
      : author === 'HER'
        ? `Napisz jako ${herName}…`
        : `Napisz jako ${hisName}…`;

  // wyślij i wyczyść pole (ignoruj puste / gdy zablokowane)
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };

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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
        />
        <button className="send" type="button" onClick={submit} disabled={disabled || !text.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
