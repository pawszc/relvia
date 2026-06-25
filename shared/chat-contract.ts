/**
 * Wspólny kontrakt czatu — JEDNO ŹRÓDŁO PRAWDY.
 *
 * Implementują go (ten sam kształt, różne implementacje):
 *  - mock klienta na froncie (Faza 1)            → ChatClient
 *  - realny klient HTTP/SSE na froncie (Faza 2+)  → ChatClient
 *  - warstwa AI w backendzie: mock (Faza 2)       → AdvisorService
 *  - warstwa AI w backendzie: Anthropic (Faza 3)  → AdvisorService
 *
 * Dzięki temu podmiana mock ↔ realne jest zmianą jednej implementacji,
 * a nie refaktorem UI ani logiki CAP.
 */

export type Author = 'HER' | 'HIM' | 'TOGETHER' | 'ADVISOR';

/** Autorzy dostępni dla pary (doradca odpowiada sam). */
export type SenderAuthor = Exclude<Author, 'ADVISOR'>;

export type FinishReason = 'end_turn' | 'max_tokens' | 'error';

// --- Silnik rozmowy (turn-taking engine) -----------------------------------
// Advisor jest reżyserem rozmowy: ZAWSZE analizuje, ale NIE zawsze mówi.
// Po każdej turze zapada decyzja (decide), a generacja dymki (generateReply)
// odpala się tylko gdy decision.shouldSpeak === true.

/** Fazy rozmowy — MIĘKKI cel (nie bramki). Pełna persystencja od kroku 2. */
export type Phase =
  | 'OPENING'        // ustalamy o czym rozmawiamy (kotwica tematu)
  | 'PERSPECTIVE_A'  // perspektywa pierwszej osoby
  | 'PERSPECTIVE_B'  // perspektywa drugiej osoby
  | 'PARAPHRASE'     // parafraza obu stron
  | 'CORE'           // sedno konfliktu
  | 'AGREEMENT';     // ustalenia (małe kroki)

/** Tryb pracy Advisora. */
export type AdvisorMode = 'LEADING' | 'LISTENING' | 'PAUSED';

/** Rodzaj dymki doradcy → render. FULL = duża; pozostałe = małe, wyróżnione. */
export type AdvisorBubbleKind = 'FULL' | 'MODERATION' | 'INTERVENTION';

/** Typ decyzji reżysera po turze pary. */
export type AdvisorDecisionType =
  | 'WAIT' // milcz, zbieramy kontekst
  | 'DEEPEN' // pogłęb: odbij + jedno otwarte pytanie do tej samej osoby
  | 'ASK_OTHER' // oddaj głos drugiej stronie
  | 'CLARIFY' // dopytaj o konkret (np. po "nieprawda!")
  | 'REFRAME' // przeramuj
  | 'NARROW' // zwęź: jeden konkretny przykład
  | 'CHOOSE' // wybierzmy jeden temat ze stołu
  | 'SUMMARIZE' // parafraza obu stron
  | 'PROPOSE' // 1–3 małe kroki
  | 'INTERVENE' // eskalacja w trakcie rozmowy (WZAJEMNA, symetryczna)
  | 'PROTECT' // tor ochronny: wzorzec krzywdy jednej strony, poniżej progu SAFETY_STOP — staje po stronie godności skrzywdzonej osoby
  | 'SAFETY_STOP'; // tor bezpieczeństwa (priorytet ponad wszystkim)

/** Zaparkowana dygresja — lista "do omówienia później". (Persystencja od kroku 2.) */
export interface ParkedTopic {
  id: string;
  text: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  parkedAtSeq: number;
}

/** Stan reżysera dla jednej konwersacji (wejście do decide, odtwarzane przez getState). */
export interface ConversationState {
  phase: Phase;
  topic?: string; // kotwica (gwiazda polarna) z Fazy 1
  advisorMode: AdvisorMode;
  parkedTopics: ParkedTopic[];
  turnsSinceProgress: number; // wykrywanie pętli
  escalationStreak: number; // rozpęd kłótni
  lastComposerHint?: string; // ostatnia podpowiedź do pola — by decide jej nie powtarzał
}

/** Wynik decide() — decyzja reżysera po turze. */
export interface AdvisorDecision {
  shouldSpeak: boolean;
  type: AdvisorDecisionType;
  kind: AdvisorBubbleKind;
  phase: Phase;
  nextSpeaker?: SenderAuthor; // dla ASK_OTHER
  uiHint?: string; // status sceniczny / podpowiedź gdy WAIT
  composerHint?: string; // krótka, kontekstowa podpowiedź do pola (placeholder dla następnej osoby)
  parkAdd?: string; // dygresja do zaparkowania
  reason?: string; // diagnostyka
  // --- wartości stanu do persystencji (handler je zapisuje na Conversations) ---
  topic?: string; // kotwica ustalona/utrzymana w tej turze
  turnsSinceProgress?: number; // nowy licznik pętli po tej turze
  escalationStreak?: number; // rozpęd kłótni po tej turze (krok 3)
  // koszt wyprodukowania TEJ decyzji (krok 5: decide modelem). Reguły/mock = brak.
  usage?: TokenUsage;
}

/** Zużycie tokenów jednej generacji doradcy (z odpowiedzi modelu Anthropic). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  seq: number;            // kolejność w konwersacji
  author: Author;
  text: string;
  createdAt: string;      // ISO 8601
  // Tylko dymki ADVISOR: jak je renderować i jaka decyzja je wywołała.
  kind?: AdvisorBubbleKind;        // brak ⇒ traktuj jak 'FULL'
  decisionType?: AdvisorDecisionType;
}

export interface SendMessageRequest {
  conversationId: string;
  author: SenderAuthor;
  text: string;
  accessToken?: string; // capability token konwersacji (realny klient HTTP zawsze dołącza)
}

/**
 * Zdarzenia SSE wysyłane przez sendMessage (i requestAdvisor/pokeAdvisor).
 * Na drucie: `event: <type>` + `data: <JSON pozostałych pól>`.
 *
 * Kolejność (tura, w której Advisor MÓWI):
 *   message.user → advisor.decision → advisor.start → advisor.delta* → advisor.end
 * Kolejność (tura, w której Advisor MILCZY):
 *   message.user → advisor.decision → advisor.wait
 * `error` może wystąpić w dowolnym momencie i kończy strumień.
 */
export type ChatStreamEvent =
  | { type: 'message.user'; message: ChatMessage }
  | {
      type: 'advisor.decision';
      decision: AdvisorDecisionType;
      phase: Phase;
      uiHint?: string;
      nextSpeaker?: SenderAuthor;
      composerHint?: string; // kontekstowa podpowiedź do pola wpisywania (placeholder)
    }
  | { type: 'advisor.wait'; uiHint: string } // Advisor analizuje, ale nie dodaje dymki
  | { type: 'phase.change'; phase: Phase; topic?: string }
  | { type: 'parked.update'; topics: ParkedTopic[] } // lista „do omówienia później"
  | {
      type: 'advisor.start';
      message: Pick<ChatMessage, 'id' | 'conversationId' | 'seq' | 'author' | 'createdAt'>;
    }
  | { type: 'advisor.delta'; text: string }
  | { type: 'advisor.end'; text: string; finishReason: FinishReason; kind: AdvisorBubbleKind }
  | { type: 'error'; code: string; message: string };

/** Metadane konwersacji (imiona pary pochodzą z encji Conversations w bazie). */
export interface ConversationMeta {
  conversationId: string;
  herName: string;
  hisName: string;
  // Sekret-token dostępu do tej konwersacji (capability). Klient MUSI go dołączać
  // do każdej kolejnej akcji. Niezgadywalny; jedyny dowód „to moja rozmowa".
  accessToken: string;
}

/** Akcja na zaparkowanym temacie z panelu „do omówienia później". */
export type ParkedAction = 'PROMOTE' | 'RESOLVED' | 'DISMISSED';

/** Stan reżysera widoczny dla UI (podzbiór ConversationState z serwera). */
export type UiConversationState = Pick<
  ConversationState,
  'phase' | 'topic' | 'advisorMode' | 'parkedTopics'
>;

/** Kontrakt klienta używany przez UI. Mock i realny klient są wymienne. */
// Uwaga: `accessToken` jest opcjonalny w sygnaturach (mock offline go ignoruje),
// ale realny klient HTTP ZAWSZE go dołącza, a backend go WYMAGA (403 bez niego).
export interface ChatClient {
  startConversation(title?: string): Promise<ConversationMeta>;
  getHistory(conversationId: string, accessToken?: string): Promise<ChatMessage[]>;
  sendMessage(req: SendMessageRequest): AsyncIterable<ChatStreamEvent>;
  /** Stan reżysera (faza/kotwica/parking) — do odtworzenia UI po odświeżeniu. */
  getState(conversationId: string, accessToken?: string): Promise<UiConversationState>;
  /** Zmiana stanu zaparkowanego tematu (wróćmy teraz / załatwione / odrzuć). */
  resolveParkedTopic(
    conversationId: string,
    topicId: string,
    action: ParkedAction,
    accessToken?: string,
  ): Promise<void>;
  /** Pauza/wznowienie doradcy (krok 4): PAUSED = „rozmawiajcie sami", LEADING = wróć. */
  setAdvisorMode(conversationId: string, mode: AdvisorMode, accessToken?: string): Promise<void>;
}

/** Kontekst przekazywany do warstwy AI (np. imiona do prefiksów mówców). */
export interface AdvisorContext {
  herName?: string;
  hisName?: string;
}

/**
 * Kontrakt warstwy AI w backendzie. Mock (Faza 2) i Anthropic (Faza 3) są wymienne.
 * Handler CAP mapuje te zdarzenia na zdarzenia SSE (advisor.delta / advisor.end).
 *
 * Dwa kroki silnika rozmowy:
 *  1. decide() — TANIA decyzja po turze (czy mówić i jak). W mocku regułowa,
 *     w realu mały model (haiku). Odpala się zawsze (też w pauzie — bezpieczeństwo).
 *  2. generateReply() — generacja dymki; TYLKO gdy decision.shouldSpeak === true.
 */
export interface AdvisorService {
  /** Decyzja reżysera po ostatniej turze. */
  decide(
    history: ChatMessage[],
    state: ConversationState,
    context?: AdvisorContext,
  ): Promise<AdvisorDecision>;

  generateReply(
    history: ChatMessage[],
    context?: AdvisorContext,
    decision?: AdvisorDecision, // kształtuje treść (ton/długość) wg typu decyzji
    options?: { signal?: AbortSignal }, // abort generacji przy rozłączeniu klienta
  ): AsyncIterable<
    | { type: 'delta'; text: string }
    // 'end' niesie zużycie tokenów tej generacji (mock = zera, anthropic = realne)
    | { type: 'end'; text: string; finishReason: FinishReason; usage?: TokenUsage }
  >;
}

/** Stan startowy reżysera (świeża konwersacja). Używany zanim dojdzie persystencja. */
export const initialConversationState = (): ConversationState => ({
  phase: 'OPENING',
  advisorMode: 'LEADING',
  parkedTopics: [],
  turnsSinceProgress: 0,
  escalationStreak: 0,
});
