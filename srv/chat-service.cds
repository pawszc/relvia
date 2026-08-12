using relvia as db from '../db/schema';

/**
 * Usługa czatu. Ścieżka bazowa: /chat
 *
 * Dwie powierzchnie:
 *  1. OData (read-only) — historia konwersacji i wiadomości.
 *  2. Akcje — startConversation oraz sendMessage.
 *
 * UWAGA dot. transportu: sendMessage jest zdefiniowana jako akcja OData
 * (dla typowania kontraktu klienta), ale jej handler NIE zwraca JSON-a OData —
 * przełącza odpowiedź na `text/event-stream` (SSE) i streamuje odpowiedź doradcy.
 * Szczegóły protokołu zdarzeń: CONTRACT.md.
 */
service ChatService @(path: '/chat') {

  // ⚠ BEZPIECZEŃSTWO: NIE wystawiamy encji bazy jako OData (`Conversations`/`Messages`/
  // `ParkedTopics`). Wcześniej `@readonly` projekcje pozwalały KAŻDEMU pobrać `GET /chat/Messages`
  // = prywatne rozmowy WSZYSTKICH par. Dostęp jest teraz wyłącznie przez akcje, a każda akcja
  // wymaga `accessToken` (capability) pasującego do danej konwersacji. Pełny, zaufany wgląd w bazę
  // jest w osobnym, chronionym `AdminService` (/admin). Szczegóły: SAFETY.md.

  /**
   * Utworzenie nowej konwersacji. Zwraca identyfikator, imiona oraz `accessToken` —
   * sekret-token, który klient MUSI dołączać do każdej kolejnej akcji tej konwersacji.
   */
  action startConversation(
    title  : String,
    // Język UI klienta (pl|en|de) — zapisywany w metadanych konwersacji.
    // Brak/nieznany (starszy klient) ⇒ backend normalizuje do 'pl'.
    locale : String
  ) returns {
    conversationId : UUID;
    herName        : String;
    hisName        : String;
    accessToken    : String;
  };

  /** Historia wiadomości JEDNEJ konwersacji (zastępuje dawny odczyt OData). Wymaga accessToken. */
  action getHistory(
    conversationId : UUID,
    accessToken    : String
  ) returns array of {
    id           : UUID;
    conversationId : UUID;
    seq          : Integer;
    author       : db.Author;
    text         : String;
    createdAt    : Timestamp;
    kind         : String;
    decisionType : String;
  };

  /**
   * Wysłanie wiadomości od pary. Odpowiedź doradcy jest streamowana przez SSE.
   * Pole zwrotne (advisorMessageId) jest używane tylko w trybie degradacji
   * (brak streamingu); normalnie ID przychodzi w zdarzeniu `advisor.start`.
   *
   * author NIE może być ADVISOR — para nie pisze jako doradca (walidacja w handlerze).
   */
  action sendMessage(
    conversationId : UUID,
    author         : db.Author,
    text           : String,
    accessToken    : String,
    // Język UI w chwili wysyłki — ma PIERWSZEŃSTWO nad locale konwersacji i jest
    // na niej utrwalany (zmiana języka obowiązuje od następnej odpowiedzi doradcy).
    locale         : String
  ) returns {
    advisorMessageId : UUID;
  };

  /**
   * Stan reżysera konwersacji — do odtworzenia UI po odświeżeniu
   * (faza, kotwica tematu, tryb, lista zaparkowanych tematów).
   * Akcja (nie funkcja) dla spójnego wołania POST z klienta.
   */
  action conversationState(conversationId : UUID, accessToken : String) returns {
    phase       : db.Phase;
    topic       : String;
    advisorMode : db.AdvisorMode;
    parkedTopics : array of {
      id          : UUID;
      text        : String;
      status      : String;
      parkedAtSeq : Integer;
    };
  };

  /**
   * Zmiana stanu zaparkowanego tematu.
   * action: PROMOTE (wróćmy teraz → ustawia topic), RESOLVED, DISMISSED.
   */
  action resolveParkedTopic(
    conversationId : UUID,
    topicId        : UUID,
    action         : String,
    accessToken    : String
  ) returns {
    ok : Boolean;
  };

  /** Pauza/wznowienie doradcy (krok 4). mode: PAUSED („rozmawiajcie sami") / LEADING (wróć). */
  action setAdvisorMode(
    conversationId : UUID,
    mode           : db.AdvisorMode,
    accessToken    : String,
    // Język deterministycznego pożegnania doradcy przy pauzie (pl|en|de).
    locale         : String
  ) returns {
    ok : Boolean;
  };

  /** Zagregowane zużycie tokenów dla całej konwersacji (suma po wiadomościach). */
  function conversationUsage(conversationId : UUID, accessToken : String) returns {
    // generacja (dymki doradcy)
    inputTokens               : Integer;
    outputTokens              : Integer;
    cacheReadTokens           : Integer;
    cacheCreationTokens       : Integer;
    messages                  : Integer; // liczba wiadomości doradcy (z generacją)
    // decyzja (decide modelem, krok 5 — narasta co turę)
    decideInputTokens         : Integer;
    decideOutputTokens        : Integer;
    decideCacheReadTokens     : Integer;
    decideCacheCreationTokens : Integer;
    // modele per warstwa (pod model-split) + koszty (rozbicie + suma) w USD
    model                     : String; // headline = model generacji (zgodność wstecz)
    decideModel               : String;
    generateModel             : String;
    generationCostUsd         : Decimal;
    decideCostUsd             : Decimal;
    costUsd                   : Decimal;
  };
}
