import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SenderAuthor } from '@shared/chat-contract';
import Avatar from './Avatar';

// Auto-rosnące pole (jak w ChatGPT): rośnie z treścią do limitu, potem scroll.
const COMPOSER_MAX_H = 132; // ~6 wierszy

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

// kolejność pigułek: Ona (HER) · On (HIM) · Razem (TOGETHER) — etykieta „razem"
// z i18n, imiona przychodzą z góry (ChatScreen tłumaczy domyślne markery ról)
const PILLS: { author: SenderAuthor; label: (h: string, m: string, together: string) => string }[] = [
  { author: 'HER', label: (h) => h },
  { author: 'HIM', label: (_h, m) => m },
  { author: 'TOGETHER', label: (_h, _m, together) => together },
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
  const { t } = useTranslation();
  // auto-grow: po każdej zmianie treści ustaw wysokość = scrollHeight (do limitu),
  // powyżej limitu włącz scroll. Reset do 'auto' najpierw, by pole też się KURCZYŁO
  // (np. po wysłaniu, gdy text → '').
  // Dodatkowo przeliczamy po doładowaniu webfontów (display=swap) i przy zmianie
  // szerokości okna: inaczej pierwszy pomiar pada fontem zastępczym (niższe metryki),
  // a po podmianie Hanken Grotesk jednowierszowy placeholder bywa przycięty od dołu.
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      const next = Math.min(el.scrollHeight, COMPOSER_MAX_H);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden';
    };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);

  return (
    <div className="composer">
      {/* przełącznik autora — pionowa lista „Piszesz jako": Ona / On / Razem.
          Aktywna pozycja dostaje pigułkę w kolorze strony. */}
      <div className={`author-select author-select-${author.toLowerCase()}`}>
        <span className="author-select-label">{t('composer.writingAs')}</span>
        <div className="pills">
          {PILLS.map((p) => (
            <button
              key={p.author}
              type="button"
              className={`pill ${author === p.author ? 'pill-active' : ''} pill-${p.author.toLowerCase()}`}
              onClick={() => onAuthorChange(p.author)}
            >
              {/* awatar(y) strony — zawsze widoczne, podpowiadają, kto pisze */}
              {p.author === 'HER' && <Avatar who="HER" size={20} alt="" />}
              {p.author === 'HIM' && <Avatar who="HIM" size={20} alt="" />}
              {p.author === 'TOGETHER' && (
                <span className="pill-pair">
                  <Avatar who="HER" size={20} alt="" />
                  <Avatar who="HIM" size={20} alt="" />
                </span>
              )}
              <span className="pill-label">{p.label(herName, hisName, t('common.together'))}</span>
            </button>
          ))}
        </div>
      </div>

      {/* pole + przycisk wyślij (↑) */}
      <div className="input-wrap">
        <textarea
          ref={taRef}
          className="input"
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter wysyła; Shift+Enter robi nową linię (pole urośnie).
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={disabled}
        />
        <button
          className="send"
          type="button"
          aria-label={t('composer.send')}
          onClick={onSend}
          disabled={disabled || !text.trim()}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
