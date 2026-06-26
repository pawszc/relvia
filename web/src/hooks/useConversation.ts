import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdvisorDecisionType,
  AdvisorMode,
  ChatClient,
  ChatMessage,
  ParkedAction,
  ParkedTopic,
  Phase,
  SenderAuthor,
} from '@shared/chat-contract';

/** Ostatnia decyzja reżysera — napędza „inteligentny kompozytor" (auto-autor + placeholder). */
export interface LastDecision {
  type: AdvisorDecisionType;
  nextSpeaker?: SenderAuthor;
  composerHint?: string; // kontekstowa podpowiedź do pola (z modelu); brak ⇒ fallback statyczny
}

export type SendStatus = 'sending' | 'sent' | 'failed';

/** Wiadomość w UI = ChatMessage + lokalny stan wysyłki (tylko dla wiadomości pary). */
export interface UiMessage extends ChatMessage {
  clientId?: string; // lokalny id wiadomości pary — do reconcile i retry
  status?: SendStatus;
}

/**
 * Status "sceniczny" Advisora — to nie spinner, tylko obecność reżysera.
 *  - idle      → nic się nie dzieje,
 *  - listening → analizuje właśnie zakończoną turę,
 *  - typing    → pisze dymkę (streaming),
 *  - waiting   → świadomie milczy / czeka na drugą stronę (z podpowiedzią).
 */
export interface AdvisorStatus {
  kind: 'idle' | 'listening' | 'typing' | 'waiting';
  hint?: string;
}

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/**
 * Statyczne powitanie doradcy — ZERO tokenów / zero wywołań modelu. Pokazujemy je
 * RAZ, na świeżym wejściu (pusta rozmowa), strumieniowane jak realne SSE, żeby od
 * progu było czuć obecność doradcy (nie tylko placeholder w tle). Nie persystowane
 * w bazie i nie wysyłane do modelu — żyje wyłącznie w stanie UI, więc leniwe
 * tworzenie konwersacji zostaje nietknięte (rozmowa powstaje dopiero przy 1. wysyłce).
 */
const WELCOME_TEXT =
  'Cześć. Jestem tu dla Was obojga — nie po to, żeby oceniać, kto ma rację, tylko żeby pomóc Wam się nawzajem usłyszeć. Zacznijcie, jak Wam wygodnie: jedno z Was albo wspólnie. Słucham.';
const WELCOME_ID = 'welcome';

/**
 * Disclaimer bezpieczeństwa (A1) — pełna treść, pokazywana w stałej mikro-stopce pod ⓘ
 * (nie jako dymka w czacie). Relvia to empatyczny mediator AI, NIE terapeuta i NIE pomoc
 * doraźna. Ujawnienie AI spełnia obowiązek przejrzystości (EU AI Act art. 50). Numery
 * zweryfikowane dla Polski (112 alarmowy; 116 123 kryzysowy telefon zaufania;
 * 800 120 002 Niebieska Linia).
 * ⚠ Przed publikacją: potwierdź numery dla docelowego rynku/języka. Patrz SAFETY.md / PRODUCTION.md.
 */
export const SAFETY_DISCLAIMER_TEXT =
  'Relvia to doradca AI, nie terapeuta ani pomoc w nagłych sytuacjach. Jeśli potrzebujesz pilnej pomocy, zadzwoń pod 112. Wsparcie emocjonalne: całodobowy telefon zaufania 116 123; przy przemocy — Niebieska Linia 800 120 002.';

/** Zwięzła linijka do stopki — zawsze widoczna; pełna treść (z numerami) kryje się pod „Potrzebujesz pomocy?". */
export const SAFETY_DISCLAIMER_SHORT = 'Relvia to doradca AI a nie terapeuta';

/** Treść panelu „Potrzebujesz pomocy?" — same numery kryzysowe, bez powtarzania linijki stopki. */
export const SAFETY_HELP_TEXT =
  'Jeśli potrzebujesz pilnej pomocy, zadzwoń pod 112. Wsparcie emocjonalne: całodobowy telefon zaufania 116 123; przy przemocy — Niebieska Linia 800 120 002.';

/** Dokleja tekst do wiadomości o danym id (no-op, gdy jej nie ma — np. para zaczęła sama). */
function appendToId(messages: UiMessage[], id: string, text: string): UiMessage[] {
  return messages.map((x) => (x.id === id ? { ...x, text: x.text + text } : x));
}

/** Status „na kogo doradca czeka" — gdy decyzja wskazuje następnego mówcę. */
function waitHintFor(next: SenderAuthor, herName: string, hisName: string): string {
  if (next === 'TOGETHER') return 'Doradca czeka na Waszą wspólną odpowiedź…';
  return `Doradca czeka na odpowiedź: ${next === 'HER' ? herName : hisName}`;
}
const nextSeq = (messages: UiMessage[]) => messages.reduce((m, x) => Math.max(m, x.seq), 0) + 1;

function appendToLast(messages: UiMessage[], text: string): UiMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, text: last.text + text }];
}

function setLastText(messages: UiMessage[], text: string): UiMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, text }];
}

/** Dopisuje metadane (np. kind dymki) do ostatniej wiadomości. */
function setLastMeta(messages: UiMessage[], meta: Partial<UiMessage>): UiMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, ...meta }];
}

function setStatus(messages: UiMessage[], clientId: string, status: SendStatus): UiMessage[] {
  return messages.map((x) => (x.clientId === clientId ? { ...x, status } : x));
}

export interface UseConversation {
  messages: UiMessage[];
  advisorTyping: boolean;
  advisorStatus: AdvisorStatus; // obecność sceniczna reżysera
  advisorMode: AdvisorMode; // LEADING / PAUSED (krok 4)
  lastDecision: LastDecision | null; // ostatnia decyzja reżysera (kompozytor: auto-autor/placeholder)
  idle: boolean; // długa cisza — delikatny heartbeat (krok 4)
  phase: Phase; // bieżący miękki cel rozmowy
  parkedTopics: ParkedTopic[]; // lista „do omówienia później"
  sending: boolean;
  error: string | null;
  ready: boolean;
  herName: string; // imię HER z konwersacji (źródło: encja Conversations)
  hisName: string; // imię HIM z konwersacji
  send: (author: SenderAuthor, text: string) => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  resolveParked: (topicId: string, action: ParkedAction) => Promise<void>;
  setMode: (mode: AdvisorMode) => Promise<void>; // pauza/wznowienie doradcy
}

export function useConversation(client: ChatClient): UseConversation {
  // LENIWE tworzenie: konwersacja powstaje dopiero przy pierwszej wysłanej
  // wiadomości — nie przy wejściu na stronę. Żadnych pustych rekordów w bazie.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // sekret-token dostępu do tej konwersacji (capability) — w ref, by callbacki
  // czytały najświeższy bez przebudowy. Ustawiany przy tworzeniu konwersacji.
  const accessTokenRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [advisorTyping, setAdvisorTyping] = useState(false);
  const [advisorStatus, setAdvisorStatus] = useState<AdvisorStatus>({ kind: 'idle' });
  const [phase, setPhase] = useState<Phase>('OPENING');
  const [parkedTopics, setParkedTopics] = useState<ParkedTopic[]>([]);
  const [advisorMode, setAdvisorModeState] = useState<AdvisorMode>('LEADING');
  const [lastDecision, setLastDecision] = useState<LastDecision | null>(null);
  const [idle, setIdle] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // imiona pary — domyślne do czasu utworzenia konwersacji, potem z bazy
  const [herName, setHerName] = useState('Ona');
  const [hisName, setHisName] = useState('On');

  // Lekki heartbeat bezczynności (krok 4): po dłuższej ciszy pokaż delikatny
  // status. Czysto kliencki — zero tokenów, zero wywołań serwera. Reset przy
  // każdej aktywności (nowa wiadomość, wysyłka, zmiana trybu). Nie w pauzie.
  useEffect(() => {
    setIdle(false);
    // samo powitanie doradcy (brak realnej tury pary) NIE uruchamia heartbeatu —
    // inaczej placeholder zmieniłby się na „Wróćcie…" zanim para w ogóle zacznie.
    const hasPairTurn = messages.some((m) => m.author !== 'ADVISOR');
    if (!hasPairTurn || sending || advisorMode === 'PAUSED') return;
    const t = setTimeout(() => setIdle(true), 120000); // 2 min ciszy
    return () => clearTimeout(t);
  }, [messages, sending, advisorMode]);

  // Powitanie doradcy (jednorazowe). Odtwarzamy tor SSE: chwila „namysłu" po renderze
  // → kropki „pisze" → strumień słowo-po-słowie → wygaszenie. Guard refem przetrwa
  // React StrictMode: cleanup CELOWO nie kasuje timerów (drugi montaż w devie nie może
  // wyzerować powitania), a ref blokuje jego zdublowanie. W produkcji ekran nie
  // odmontowuje się w trakcie sesji, więc brak cleanup jest bezpieczny.
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (welcomedRef.current) return;
    if (conversationId || messages.length > 0) return; // tylko świeże wejście
    welcomedRef.current = true;

    setTimeout(() => {
      setAdvisorTyping(true);
      setAdvisorStatus({ kind: 'typing' });
      // pusta dymka doradcy = animowane kropki „pisze" — tylko gdy rozmowa wciąż pusta
      setMessages((m) =>
        // A1: disclaimer NIE jest już dymką w czacie — żyje w stałej mikro-stopce (SafetyFooter).
        m.length === 0
          ? [{ id: WELCOME_ID, conversationId: '', seq: 0, author: 'ADVISOR', text: '', createdAt: nowIso(), kind: 'FULL' } as UiMessage]
          : m,
      );
      // Chunkowanie i tempo 1:1 z realnym torem SSE (mockAdvisor.js / mockChatClient.ts):
      // chunk = „słowo + spacja" (/\S+\s*/g), 40 ms na chunk, po krótkiej chwili „myśli"
      // (kropki widoczne ~480 ms) — żeby wrażenie było nie do odróżnienia od zwykłej tury.
      const chunks = WELCOME_TEXT.match(/\S+\s*/g) ?? [WELCOME_TEXT];
      chunks.forEach((c, i) => {
        setTimeout(() => {
          setMessages((m) => appendToId(m, WELCOME_ID, c));
        }, 480 + i * 40);
      });
      // koniec strumienia — wygaś „pisze" (tylko jeśli nikt nie przejął statusu)
      setTimeout(() => {
        setAdvisorTyping(false);
        setAdvisorStatus((s) => (s.kind === 'typing' ? { kind: 'idle' } : s));
      }, 480 + chunks.length * 40 + 120);
    }, 450); // namysł po wyrenderowaniu — żeby poczuć opóźnienie
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ⤵ TU DZIEJE SIĘ LENIWE TWORZENIE KONWERSACJI.
   * Jeśli konwersacja już istnieje — zwracamy jej ID. Jeśli nie — tworzymy ją
   * DOPIERO TERAZ (przy pierwszej wysyłce), nie na wejściu na stronę.
   * Dzięki temu samo odświeżenie strony nie tworzy żadnego rekordu w bazie.
   * Wołane z send() i retry() — patrz niżej.
   */
  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    // jedyne miejsce, w którym powstaje konwersacja:
    const meta = await client.startConversation('Niedziele');
    accessTokenRef.current = meta.accessToken; // zapamiętaj token PRZED pierwszą wysyłką
    setConversationId(meta.conversationId);
    setHerName(meta.herName); // imiona z bazy (encja Conversations)
    setHisName(meta.hisName);
    return meta.conversationId;
  }, [client, conversationId]);

  /** Streamuje wysyłkę dla wiadomości pary, która już jest w UI pod clientId. */
  const runSend = useCallback(
    async (cid: string, clientId: string, author: SenderAuthor, text: string) => {
      setSending(true);
      setError(null);
      setMessages((m) => setStatus(m, clientId, 'sending'));

      // zapamiętujemy "spoczynkowy" status z decyzji (np. ASK_OTHER → czeka na drugą stronę)
      let restingHint: string | undefined;
      let restingNextSpeaker: SenderAuthor | undefined;
      // rodzaj dymki znany już z decyzji → ustawiamy go przy starcie (bez przeskoku renderu)
      let pendingKind: UiMessage['kind'] = 'FULL';
      // typ decyzji → stempel na żywej dymce, by pozycja „dwa brzegi" liczyła się z TEGO
      // SAMEGO źródła co reżyser (a nie z fallbacku po ostatnim mówcy przed odświeżeniem)
      let pendingDecisionType: UiMessage['decisionType'];

      let confirmed = false;
      try {
        for await (const ev of client.sendMessage({
          conversationId: cid,
          author,
          text,
          accessToken: accessTokenRef.current ?? undefined,
        })) {
          switch (ev.type) {
            case 'message.user':
              confirmed = true;
              setMessages((m) =>
                m.map((x) =>
                  x.clientId === clientId
                    ? {
                        ...x,
                        id: ev.message.id,
                        conversationId: ev.message.conversationId,
                        seq: ev.message.seq,
                        createdAt: ev.message.createdAt,
                        status: 'sent',
                      }
                    : x,
                ),
              );
              break;
            case 'advisor.decision':
              // reżyser właśnie ocenił turę; po dymce hint może zostać statusem spoczynkowym
              restingHint = ev.uiHint;
              restingNextSpeaker = ev.nextSpeaker;
              pendingKind = ev.decision === 'INTERVENE' ? 'INTERVENTION' : 'FULL';
              pendingDecisionType = ev.decision;
              setLastDecision({ type: ev.decision, nextSpeaker: ev.nextSpeaker, composerHint: ev.composerHint });
              setAdvisorStatus({ kind: 'listening', hint: ev.uiHint });
              break;
            case 'advisor.wait':
              // Advisor świadomie milczy — NIE dodajemy dymki, pokazujemy status
              setAdvisorTyping(false);
              setAdvisorStatus({ kind: 'waiting', hint: ev.uiHint });
              break;
            case 'phase.change':
              setPhase(ev.phase);
              break;
            case 'parked.update':
              setParkedTopics(ev.topics);
              break;
            case 'advisor.start':
              setAdvisorTyping(true);
              setAdvisorStatus({ kind: 'typing' });
              setMessages((m) => [...m, { ...ev.message, text: '', kind: pendingKind, decisionType: pendingDecisionType }]);
              break;
            case 'advisor.delta':
              setMessages((m) => appendToLast(m, ev.text));
              break;
            case 'advisor.end':
              setAdvisorTyping(false);
              setMessages((m) => setLastMeta(setLastText(m, ev.text), { kind: ev.kind }));
              // po wypowiedzi: jeśli decyzja oddawała głos komuś, pokaż NA KOGO czekamy
              // (hint z reguł, a gdy go brak — np. model — budujemy z nextSpeaker + imion)
              setAdvisorStatus(
                restingNextSpeaker
                  ? { kind: 'waiting', hint: restingHint ?? waitHintFor(restingNextSpeaker, herName, hisName) }
                  : { kind: 'idle' },
              );
              break;
            case 'error':
              setAdvisorTyping(false);
              setAdvisorStatus({ kind: 'idle' });
              setMessages((m) => setStatus(m, clientId, 'failed'));
              setError(ev.message);
              break;
          }
        }
        if (!confirmed) {
          setMessages((m) => setStatus(m, clientId, 'failed'));
          setError((e) => e ?? 'Backend nie potwierdził wysłania.');
        }
      } catch (e) {
        setAdvisorTyping(false);
        setMessages((m) => setStatus(m, clientId, 'failed'));
        setError(e instanceof Error ? e.message : 'Nie udało się wysłać.');
      } finally {
        setSending(false);
      }
    },
    [client, herName, hisName],
  );

  const send = useCallback(
    async (author: SenderAuthor, text: string) => {
      const trimmed = text.trim();
      if (sending || !trimmed) return;

      const clientId = uid();
      // OPTYMISTYCZNIE: wiadomość pojawia się od razu (status 'sending')
      setMessages((m) => [
        ...m,
        {
          id: clientId,
          clientId,
          conversationId: conversationId ?? '',
          seq: nextSeq(m),
          author,
          text: trimmed,
          createdAt: nowIso(),
          status: 'sending',
        },
      ]);

      // leniwe tworzenie: konwersacja powstaje tu, przy PIERWSZEJ wysłanej
      // wiadomości (ensureConversation), a nie przy montowaniu komponentu
      let cid: string;
      try {
        cid = await ensureConversation();
      } catch (e) {
        setMessages((m) => setStatus(m, clientId, 'failed'));
        setError(e instanceof Error ? e.message : 'Nie udało się utworzyć rozmowy.');
        return;
      }
      await runSend(cid, clientId, author, trimmed);
    },
    [sending, conversationId, ensureConversation, runSend],
  );

  const retry = useCallback(
    async (clientId: string) => {
      if (sending) return;
      const msg = messages.find((x) => x.clientId === clientId);
      if (!msg || msg.author === 'ADVISOR') return;
      let cid: string;
      try {
        cid = await ensureConversation();
      } catch (e) {
        setMessages((m) => setStatus(m, clientId, 'failed'));
        setError(e instanceof Error ? e.message : 'Nie udało się utworzyć rozmowy.');
        return;
      }
      await runSend(cid, clientId, msg.author as SenderAuthor, msg.text);
    },
    [messages, sending, ensureConversation, runSend],
  );

  // Akcja z panelu „do omówienia później": wróćmy teraz / załatwione / odrzuć.
  // Po zmianie odświeżamy stan z backendu (lista + ewentualnie nowa kotwica/faza).
  const resolveParked = useCallback(
    async (topicId: string, action: ParkedAction) => {
      if (!conversationId) return;
      const tok = accessTokenRef.current ?? undefined;
      await client.resolveParkedTopic(conversationId, topicId, action, tok);
      const s = await client.getState(conversationId, tok);
      setParkedTopics(s.parkedTopics);
      setPhase(s.phase);
      setAdvisorModeState(s.advisorMode);
    },
    [client, conversationId],
  );

  // Pauza/wznowienie doradcy (krok 4). Optymistycznie ustawiamy lokalnie, potem backend.
  const setMode = useCallback(
    async (mode: AdvisorMode) => {
      if (!conversationId) return;
      setAdvisorModeState(mode);
      const tok = accessTokenRef.current ?? undefined;
      try {
        await client.setAdvisorMode(conversationId, mode, tok);
        // „tylko słucha": doradca milknie → wyczyść status sceniczny i pokaż pożegnanie
        if (mode === 'PAUSED') {
          setAdvisorTyping(false);
          setAdvisorStatus({ kind: 'idle' });
          setMessages(await client.getHistory(conversationId, tok));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Nie udało się zmienić trybu doradcy.');
      }
    },
    [client, conversationId],
  );

  return {
    messages,
    advisorTyping,
    advisorStatus,
    advisorMode,
    lastDecision,
    idle,
    phase,
    parkedTopics,
    sending,
    error,
    ready: true, // brak tworzenia na starcie → kompozytor aktywny od razu
    herName,
    hisName,
    send,
    retry,
    resolveParked,
    setMode,
  };
}
