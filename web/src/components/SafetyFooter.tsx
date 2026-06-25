import { useState } from 'react';
import { SAFETY_DISCLAIMER_SHORT, SAFETY_HELP_TEXT } from '../hooks/useConversation';

/**
 * Stała mikro-stopka bezpieczeństwa (A1) — zastępuje dawną disclaimer-dymkę w czacie.
 * Linijka „Relvia to doradca AI, nie terapeuta." jest ZAWSZE widoczna i NIE da się jej
 * zamknąć — to ujawnienie AI wymagane przez EU AI Act art. 50 (jedyne miejsce w aplikacji,
 * więc nie może znikać). Zwijać/rozwijać można jedynie numery kryzysowe pod
 * „Potrzebujesz pomocy?" — bo te są dobrą praktyką, nie wymogiem ciągłej widoczności.
 */
export default function SafetyFooter() {
  const [open, setOpen] = useState(false);

  return (
    <div className="safety-footer">
      <div className="safety-footer-line">
        <span className="safety-footer-text">{SAFETY_DISCLAIMER_SHORT}</span>
        <button
          type="button"
          className="safety-footer-info"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Potrzebujesz pomocy?
        </button>
        <span className="safety-footer-sep" aria-hidden="true">·</span>
        <span className="safety-footer-accept">
          Korzystając z Relvii, akceptujesz <a href="#regulamin">Regulamin</a> i{' '}
          <a href="#polityka-prywatnosci">Politykę prywatności</a>.
        </span>
      </div>
      {open && (
        <div className="safety-footer-full" role="note">
          <span>{SAFETY_HELP_TEXT}</span>
          <button
            type="button"
            className="safety-footer-close"
            aria-label="Zamknij"
            title="Zamknij"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
