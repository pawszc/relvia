namespace couple.adviser;

using { cuid, managed } from '@sap/cds/common';

/**
 * Autor wiadomości.
 * Para pisze jako HER (Ola), HIM (Tomek) lub TOGETHER ("razem" — wiadomość na osi).
 * Doradca AI to ADVISOR. To jest sedno domeny — przenosimy je aż do promptu modelu.
 */
type Author : String(10) enum {
  HER;       // Ola — z prawej
  HIM;       // Tomek — z lewej
  TOGETHER;  // "razem" — hero na środku (wariant A4)
  ADVISOR;   // doradca AI — w środku
}

/** Faza rozmowy — MIĘKKI cel reżysera (nie bramka blokująca input). */
type Phase : String(16) enum {
  OPENING;        // ustalamy temat (kotwica)
  PERSPECTIVE_A;  // perspektywa pierwszej osoby
  PERSPECTIVE_B;  // perspektywa drugiej osoby
  PARAPHRASE;     // parafraza obu stron
  CORE;           // sedno konfliktu
  AGREEMENT;      // ustalenia (małe kroki)
}

/** Tryb pracy Advisora. */
type AdvisorMode : String(10) enum { LEADING; LISTENING; PAUSED; }

/** Pojedyncza sesja czatu pary z doradcą. */
entity Conversations : cuid, managed {
  title    : String;
  herName  : String default 'Ona';    // etykieta UI — z danych, nie z kodu
  hisName  : String default 'On';
  messages : Composition of many Messages on messages.conversation = $self;

  // --- stan reżysera (silnik rozmowy) ---
  phase              : Phase default 'OPENING';
  topic              : String;                 // kotwica (gwiazda polarna) z Fazy 1
  advisorMode        : AdvisorMode default 'LEADING';
  turnsSinceProgress : Integer default 0;      // wykrywanie pętli
  escalationStreak   : Integer default 0;      // rozpęd kłótni (krok 3)
  lastActivityAt     : Timestamp;              // heartbeat (krok 4)
  parked             : Composition of many ParkedTopics on parked.conversation = $self;
}

/** Zaparkowana dygresja — lista "do omówienia później". */
entity ParkedTopics : cuid, managed {
  conversation : Association to Conversations;
  text         : String;
  status       : String(10) enum { OPEN; RESOLVED; DISMISSED } default 'OPEN';
  parkedAtSeq  : Integer;
}

/** Wiadomość w konwersacji (od pary lub od doradcy). */
entity Messages : cuid, managed {
  conversation : Association to Conversations;
  seq          : Integer;       // monotoniczna kolejność w obrębie konwersacji
  author       : Author;
  text         : LargeString;

  // Render dymki doradcy: jak ją pokazać i jaka decyzja ją wywołała.
  // Tylko dla wiadomości ADVISOR (dla pary pozostają puste).
  kind         : String(12);  // FULL | MODERATION | INTERVENTION (brak ⇒ FULL)
  decisionType : String(16);  // wartość AdvisorDecisionType (diagnostyka)

  // Zużycie tokenów — wypełniane tylko dla wiadomości ADVISOR (generacja modelu).
  // W trybie mock pozostają zerami; realne wartości przychodzą z Anthropic.
  inputTokens         : Integer default 0;
  outputTokens        : Integer default 0;
  cacheReadTokens     : Integer default 0;
  cacheCreationTokens : Integer default 0;
}
