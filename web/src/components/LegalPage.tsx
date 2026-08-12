import { useTranslation } from 'react-i18next';

/**
 * Strony prawne (Regulamin / Polityka prywatności).
 *
 * STAN NA CZAS TESTÓW (2026-06-25): pokazujemy WYŁĄCZNIE baner „zamknięta wersja testowa".
 * Pełna treść obu dokumentów (szkielet/draft) jest ZAKOMENTOWANA niżej — NIE usuwać:
 * wracamy do dopracowania brzmienia PO testach z testerami (placeholdery [E-MAIL]/[DATA],
 * weryfikacja prawna, decyzja o zgodzie art. 9). Lekka ścieżka zgodności, wariant
 * zamkniętego testu — administrator wskazany kontaktem e-mail, pełne dane przy publicznym starcie.
 */

export type LegalDoc = 'terms' | 'privacy';

function Terms() {
  // DRAFT odłożony do pracy PO testach z testerami — na razie pokazujemy tylko baner.
  /*
  return (
    <>
      <h1>Regulamin</h1>
      <p className="legal-draft">
        ⚠ Wersja robocza (szkielet) — przed publikacją wymaga weryfikacji prawnej i uzupełnienia
        danych administratora. Ostatnia aktualizacja: [DATA].
      </p>

      <h2>1. Postanowienia ogólne</h2>
      <p>
        Niniejszy Regulamin określa zasady korzystania z aplikacji Relvia („Aplikacja", „Usługa")
        w jej <strong>zamkniętej wersji testowej</strong>. Na czas testu Usługę prowadzi osoba
        organizująca test; kontakt: [E-MAIL]. Pełne dane podmiotu odpowiedzialnego zostaną podane
        przy publicznym uruchomieniu. Korzystając z Aplikacji, akceptujesz niniejszy Regulamin oraz
        Politykę prywatności.
      </p>

      <h2>2. Czym jest Relvia (i czym nie jest)</h2>
      <p>
        Relvia to <strong>doradca AI</strong> (system sztucznej inteligencji) wspierający rozmowę pary.
        Pełni funkcję informacyjno-wspierającą i <strong>nie jest</strong>: terapeutą, psychologiem,
        psychoterapeutą, lekarzem ani usługą kryzysową. Odpowiedzi Aplikacji nie są poradą medyczną,
        prawną ani terapeutyczną i nie zastępują kontaktu ze specjalistą.
      </p>

      <h2>3. Zasady korzystania</h2>
      <ul>
        <li>Usługa jest przeznaczona wyłącznie dla osób, które ukończyły 18 lat.</li>
        <li>Nie wolno wykorzystywać Aplikacji niezgodnie z prawem ani do celów innych niż rozmowa o relacji.</li>
      </ul>

      <h2>4. Bezpieczeństwo i sytuacje kryzysowe</h2>
      <p>
        Relvia nie jest pomocą w nagłych sytuacjach. Jeśli ktoś jest w zagrożeniu życia lub zdrowia,
        zadzwoń pod <strong>112</strong>. Wsparcie emocjonalne: całodobowy telefon zaufania
        <strong> 116 123</strong>; przy przemocy — Niebieska Linia <strong>800 120 002</strong>.
      </p>

      <h2>5. Ochrona danych osobowych</h2>
      <p>
        Zasady przetwarzania danych opisuje <a href="#polityka-prywatnosci">Polityka prywatności</a>.
      </p>

      <h2>6. Wyłączenie odpowiedzialności</h2>
      <p>
        Usługa jest dostarczana „taka, jaka jest", bez gwarancji co do trafności czy kompletności
        odpowiedzi generowanych przez AI. W granicach dozwolonych prawem Usługodawca nie ponosi
        odpowiedzialności za decyzje podjęte na podstawie treści z Aplikacji. [DO WERYFIKACJI PRAWNEJ]
      </p>

      <h2>7. Zmiany Regulaminu i postanowienia końcowe</h2>
      <p>
        Usługodawca może zmienić Regulamin; o istotnych zmianach poinformuje w Aplikacji. W sprawach
        nieuregulowanych stosuje się prawo polskie. Kontakt: [E-MAIL].
      </p>
    </>
  );
  */
  return null;
}

function Privacy() {
  // DRAFT odłożony do pracy PO testach z testerami — na razie pokazujemy tylko baner.
  /*
  return (
    <>
      <h1>Polityka prywatności</h1>
      <p className="legal-draft">
        ⚠ Wersja robocza (szkielet) — przed publikacją wymaga weryfikacji prawnej i uzupełnienia
        danych administratora. Ostatnia aktualizacja: [DATA].
      </p>

      <h2>1. Administrator danych</h2>
      <p>
        W zamkniętej wersji testowej administratorem danych jest osoba organizująca test.
        Kontakt w sprawach danych (dostęp, usunięcie): [E-MAIL]. Pełne dane administratora
        (nazwa podmiotu, adres) zostaną podane przy publicznym uruchomieniu Usługi.
      </p>

      <h2>2. Jakie dane przetwarzamy i na jakiej podstawie</h2>
      <p>
        Przetwarzamy treść Waszej rozmowy z Relvią oraz dane techniczne niezbędne do działania Usługi.
        Podstawą jest <strong>art. 6 ust. 1 lit. b RODO</strong> (wykonanie usługi) oraz uzasadniony
        interes administratora (bezpieczeństwo, jakość). [DO WERYFIKACJI: czy potrzebna wyraźna zgoda
        art. 9 dla danych wrażliwych — decyzja prawna.]
      </p>

      <h2>3. Zakres zbieranych danych</h2>
      <p>
        Zbieramy wyłącznie dane potrzebne do działania Usługi — przede wszystkim treść Waszej rozmowy
        z Relvią. Nie tworzymy profili marketingowych i nie sprzedajemy danych.
      </p>

      <h2>4. Przekazywanie danych poza EOG</h2>
      <p>
        Aby Relvia mogła odpowiadać, treść rozmowy jest przesyłana do dostawcy modelu AI —
        <strong> Anthropic, PBC (USA)</strong>. Dostawca działa poza Europejskim Obszarem Gospodarczym;
        stosujemy gwarancje wynikające z RODO (umowa powierzenia / DPA, standardowe klauzule umowne).
        [DO POTWIERDZENIA: zawarcie DPA + mechanizm transferu.]
      </p>

      <h2>5. Okres przechowywania</h2>
      <p>
        W wersji testowej nie przechowujemy rozmów dłużej, niż to potrzebne — usuwamy je okresowo,
        najpóźniej po ok. <strong>14 dniach</strong> od ostatniej aktywności.
      </p>

      <h2>6. Twoje prawa</h2>
      <p>
        Masz prawo do: dostępu do danych, sprostowania, <strong>usunięcia</strong>, ograniczenia i
        sprzeciwu wobec przetwarzania oraz przenoszenia danych. Aby z nich skorzystać, napisz na [E-MAIL].
        Przysługuje Ci też skarga do Prezesa UODO.
      </p>

      <h2>7. Bezpieczeństwo</h2>
      <p>
        Stosujemy środki techniczne i organizacyjne chroniące dane (m.in. ograniczenie dostępu,
        [szyfrowanie w spoczynku — DO WDROŻENIA]).
      </p>

      <h2>8. Zmiany i kontakt</h2>
      <p>O istotnych zmianach poinformujemy w Aplikacji. Kontakt: [E-MAIL].</p>
    </>
  );
  */
  return null;
}

export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t } = useTranslation();
  return (
    <div className="card legal-page">
      <div className="legal-inner">
        <a className="legal-back" href="#">{t('legal.back')}</a>
        <div className="legal-test-banner">
          🧪 <strong>{t('legal.testBannerTitle')}</strong> {t('legal.testBannerBody')}
        </div>
        {doc === 'terms' ? <Terms /> : <Privacy />}
      </div>
    </div>
  );
}
