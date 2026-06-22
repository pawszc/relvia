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

  @readonly
  entity Conversations as projection on db.Conversations;

  @readonly
  entity Messages as projection on db.Messages;

  @readonly
  entity ParkedTopics as projection on db.ParkedTopics;

  /** Utworzenie nowej konwersacji. Zwraca identyfikator i imiona (domyślnie Ona/On). */
  action startConversation(
    title : String
  ) returns {
    conversationId : UUID;
    herName        : String;
    hisName        : String;
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
    text           : String
  ) returns {
    advisorMessageId : UUID;
  };

  /**
   * Stan reżysera konwersacji — do odtworzenia UI po odświeżeniu
   * (faza, kotwica tematu, tryb, lista zaparkowanych tematów).
   * Akcja (nie funkcja) dla spójnego wołania POST z klienta.
   */
  action conversationState(conversationId : UUID) returns {
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
    action         : String
  ) returns {
    ok : Boolean;
  };

  /** Pauza/wznowienie doradcy (krok 4). mode: PAUSED („rozmawiajcie sami") / LEADING (wróć). */
  action setAdvisorMode(
    conversationId : UUID,
    mode           : db.AdvisorMode
  ) returns {
    ok : Boolean;
  };

  /** Zagregowane zużycie tokenów dla całej konwersacji (suma po wiadomościach). */
  function conversationUsage(conversationId : UUID) returns {
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
    // model + koszty (rozbicie + suma) w USD wg cennika tego modelu
    model                     : String;
    generationCostUsd         : Decimal;
    decideCostUsd             : Decimal;
    costUsd                   : Decimal;
  };
}
