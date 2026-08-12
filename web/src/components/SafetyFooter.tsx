import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

/**
 * Stała mikro-stopka bezpieczeństwa (A1) — zastępuje dawną disclaimer-dymkę w czacie.
 * Linijka „Relvia to doradca AI, nie terapeuta." jest ZAWSZE widoczna i NIE da się jej
 * zamknąć — to ujawnienie AI wymagane przez EU AI Act art. 50 (jedyne miejsce w aplikacji,
 * więc nie może znikać). Zwijać/rozwijać można jedynie numery kryzysowe pod
 * „Potrzebujesz pomocy?" — bo te są dobrą praktyką, nie wymogiem ciągłej widoczności.
 *
 * Wszystkie teksty (w tym pełne komunikaty z numerami) mają zatwierdzone wersje
 * pl/en/de w zasobach i18n (safety.*). Klauzula zgody to JEDNO zdanie na język
 * (Trans z osadzonymi linkami) — bez sklejania gramatyki z fragmentów.
 */
export default function SafetyFooter() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const termsLink = <a href="#regulamin" />;
  const privacyLink = <a href="#polityka-prywatnosci" />;

  return (
    <div className="safety-footer">
      <div className="safety-footer-line">
        <span className="safety-footer-text">
          {t('safety.short')}
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
          <span className="ftr-full">{t('safety.helpButton')}</span>
          <span className="ftr-short">{t('safety.helpButtonShort')}</span>
        </button>
        {/* separator „·” tylko na desktopie — na mobile po „pomoc” idzie wprost klauzula */}
        <span className="safety-footer-sep ftr-full" aria-hidden="true">·</span>
        <span className="safety-footer-accept">
          {/* desktop: pełna klauzula zgody; mobile: skrócona — oba warianty to całe zdania */}
          <span className="ftr-full">
            <Trans i18nKey="safety.acceptFull" components={{ terms: termsLink, privacy: privacyLink }} />
          </span>
          <span className="ftr-short">
            <Trans i18nKey="safety.acceptShort" components={{ terms: termsLink, privacy: privacyLink }} />
          </span>
        </span>
      </div>
      {open && (
        <div className="safety-footer-full" role="note">
          <span>{t('safety.help')}</span>
          <button
            type="button"
            className="safety-footer-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
