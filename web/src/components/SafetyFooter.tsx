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
        <span className="safety-footer-text">
          {SAFETY_DISCLAIMER_SHORT}
          {/* kropka tylko na desktopie — na mobile po niej idzie małe „pomoc” */}
          <span className="ftr-full">.</span>
        </span>
        <button
          type="button"
          className="safety-footer-info"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {/* pełna etykieta na desktopie, skrót na mobile (jedna linia stopki) */}
          <span className="ftr-full">Potrzebujesz pomocy?</span>
          <span className="ftr-short">pomoc</span>
        </button>
        {/* separator „·” tylko na desktopie — na mobile po „pomoc” idzie wprost „korzystając…” */}
        <span className="safety-footer-sep ftr-full" aria-hidden="true">·</span>
        <span className="safety-footer-accept">
          {/* desktop: pełna klauzula zgody; mobile: krótka preambuła + linki */}
          <span className="ftr-full">Korzystając z Relvii, akceptujesz </span>
          <span className="ftr-short">korzystając akceptujesz </span>
          <a href="#regulamin">Regulamin</a>
          <span className="ftr-full"> i </span>
          <span className="ftr-short"> · </span>
          <a href="#polityka-prywatnosci">
            <span className="ftr-full">Politykę prywatności</span>
            <span className="ftr-short">Prywatność</span>
          </a>
          <span className="ftr-full">.</span>
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
