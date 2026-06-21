import { useCallback, useEffect, useState } from 'react';
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
    if (messages.length === 0 || sending || advisorMode === 'PAUSED') return;
    const t = setTimeout(() => setIdle(true), 120000); // 2 min ciszy
    return () => clearTimeout(t);
  }, [messages, sending, advisorMode]);

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
        for await (const ev of client.sendMessage({ conversationId: cid, author, text })) {
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
      await client.resolveParkedTopic(conversationId, topicId, action);
      const s = await client.getState(conversationId);
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
      try {
        await client.setAdvisorMode(conversationId, mode);
        // „tylko słucha": doradca milknie → wyczyść status sceniczny i pokaż pożegnanie
        if (mode === 'PAUSED') {
          setAdvisorTyping(false);
          setAdvisorStatus({ kind: 'idle' });
          setMessages(await client.getHistory(conversationId));
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
