import { Fragment, useEffect, useRef, useState } from 'react';
import type { AdvisorDecisionType, AdvisorMode, ChatClient, Phase, SenderAuthor } from '@shared/chat-contract';
import { useConversation, type LastDecision } from '../hooks/useConversation';
import MessageList from './MessageList';
import Composer from './Composer';
import Avatar from './Avatar';

/** Etykiety faz — dyskretny wskaźnik bieżącego miękkiego celu rozmowy. */
const PHASE_LABEL: Record<Phase, string> = {
  OPENING: 'Otwarcie',
  PERSPECTIVE_A: 'Perspektywa I',
  PERSPECTIVE_B: 'Perspektywa II',
  PARAPHRASE: 'Parafraza',
  CORE: 'Sedno',
  AGREEMENT: 'Ustalenia',
};
const PHASE_ORDER: Phase[] = ['OPENING', 'PERSPECTIVE_A', 'PERSPECTIVE_B', 'PARAPHRASE', 'CORE', 'AGREEMENT'];

// Flaga: przełącznik trybu doradcy (Rozmawia/Tylko słucha) jest na razie ukryty.
// Cała logika trybu (advisorMode/setMode/PAUSED) zostaje w kodzie — możemy do niej
// wrócić, włączając VITE_ADVISOR_MODE_TOGGLE=true (np. w web/.env.local).
const SHOW_ADVISOR_MODE_TOGGLE = import.meta.env.VITE_ADVISOR_MODE_TOGGLE === 'true';

/**
 * „Inteligentny kompozytor" (faza 2): placeholder naprowadza na konstruktywny krok
 * wg ostatniej decyzji reżysera. Pokazuje się tylko przy pustym polu (placeholder),
 * więc nie przeszkadza w pisaniu. Zero tokenów — czysto na danych, które już mamy.
 */
const DECISION_PLACEHOLDER: Partial<Record<AdvisorDecisionType, string>> = {
  DEEPEN: 'Śmiało, rozwiń to — co czujesz najmocniej?',
  CLARIFY: 'Napisz konkretnie — jeden przykład zamiast oceny…',
  NARROW: 'Jeden konkretny przykład z ostatniego tygodnia…',
  REFRAME: 'Powiedz wprost, o co Ci najbardziej chodzi…',
  CHOOSE: 'Który wątek jest teraz dla Was najważniejszy?',
  PROPOSE: 'Zaproponuj mały krok do wypróbowania…',
  INTERVENE: 'Spróbuj zacząć od „czuję…" zamiast oceny…',
};

function composerPlaceholder(p: {
  advisorMode: AdvisorMode;
  idle: boolean;
  lastDecision: LastDecision | null;
  author: SenderAuthor;
  herName: string;
  hisName: string;
}): string {
  const { advisorMode, idle, lastDecision, author, herName, hisName } = p;
  const nameOf = (a: SenderAuthor) => (a === 'HER' ? herName : a === 'HIM' ? hisName : 'oboje');
  if (advisorMode === 'PAUSED') return 'Piszcie do siebie — doradca tylko słucha…';
  if (idle) return 'Wróćcie, gdy będziecie gotowi — napiszcie razem, jak poszło…';
  // podpowiedź z modelu (kontekstowa) ma pierwszeństwo; niżej — statyczny fallback
  if (lastDecision?.composerHint) return lastDecision.composerHint;
  const t = lastDecision?.type;
  if (t === 'ASK_OTHER' && author !== 'TOGETHER') return `Twoja kolej, ${nameOf(author)} — jak Ty to widzisz?`;
  if (t && DECISION_PLACEHOLDER[t]) return DECISION_PLACEHOLDER[t]!;
  return author === 'TOGETHER' ? 'Piszecie razem…' : `Napisz jako ${nameOf(author)}…`;
}

/**
 * Główny ekran czatu (wariant A4) — spina trzy elementy:
 *  - useConversation: cały stan i logika rozmowy (wysyłka, streaming, retry),
 *  - MessageList: lista wiadomości,
 *  - Composer: przełącznik autora + pole wpisywania.
 *
 * Sam komponent jest "głupi" — nie zna mocka ani backendu; dostaje gotowy
 * `client` (kontrakt ChatClient) i przekazuje go do hooka.
 */

interface Props {
  client: ChatClient;
}

export default function ChatScreen({ client }: Props) {
  // cała mechanika rozmowy żyje w hooku — w tym imiona pary (z encji Conversations)
  const {
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
    ready,
    herName,
    hisName,
    send,
    retry,
    resolveParked,
    setMode,
  } = useConversation(client);

  // który autor jest aktywny w kompozytorze (HER / TOGETHER / HIM) + treść pola
  const [author, setAuthor] = useState<SenderAuthor>('HER');
  const [text, setText] = useState('');

  // „inteligentny kompozytor": auto-zmiany autora robimy TYLKO przy pustym polu,
  // żeby nigdy nie nadpisać tego, co użytkownik właśnie pisze (ref = bieżąca treść).
  const textRef = useRef('');
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // auto-autor: gdy reżyser wskaże następnego mówcę (ASK_OTHER→druga strona, DEEPEN→ta
  // sama osoba), ustaw go — zawsze nadpisywalne, tylko przy pustym polu.
  useEffect(() => {
    const next = lastDecision?.nextSpeaker;
    if (next && !textRef.current.trim()) setAuthor(next);
  }, [lastDecision]);

  // po dłuższej ciszy wróć do wspólnego „Razem" (neutralny reset), też tylko przy pustym polu
  useEffect(() => {
    if (idle && !textRef.current.trim()) setAuthor('TOGETHER');
  }, [idle]);

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    send(author, t);
    setText('');
  };

  // status "sceniczny" reżysera: pokazujemy tylko gdy coś znaczy (nie 'idle')
  const statusLabel =
    advisorStatus.kind === 'waiting'
      ? (advisorStatus.hint ?? 'Doradca czeka…')
      : advisorStatus.kind === 'listening'
        ? (advisorStatus.hint ?? 'Doradca słucha…')
        : advisorStatus.kind === 'typing'
          ? 'Doradca pisze…'
          : null;

  // osoba, na którą doradca czeka (do pulsującego awatara w statusie obecności)
  const waitFor = lastDecision?.nextSpeaker;

  return (
    <div className="card">
      {/* pasek górny: brand lockup (Venn + nazwa) + klaster awatarów Doradca·Ona·On */}
      <header className="header">
        <div className="brand">
          <span className="brand-venn" aria-hidden="true">
            <span className="ring ring-her" />
            <span className="ring ring-him" />
          </span>
          <span className="brand-text">
            <span className="brand-title">Relvia</span>
            <span className="brand-sub">support for your relationship · room for both voices</span>
          </span>
        </div>
        <div className="header-right">
          {/* tryb doradcy (krok 4): trwały przełącznik „rozmawia" / „tylko słucha".
              „tylko słucha" = doradca całkowicie wyłączony (zero wywołań modelu).
              Na razie ukryty za flagą SHOW_ADVISOR_MODE_TOGGLE — logika zostaje w kodzie. */}
          {SHOW_ADVISOR_MODE_TOGGLE && messages.length > 0 && (
            <div className="advisor-toggle" role="group" aria-label="Tryb doradcy">
              <span className="advisor-toggle-label">Doradca:</span>
              <div className="advisor-toggle-seg">
                <button
                  type="button"
                  className={`advisor-toggle-opt ${advisorMode === 'LEADING' ? 'is-active' : ''}`}
                  aria-pressed={advisorMode === 'LEADING'}
                  onClick={() => setMode('LEADING')}
                >
                  Rozmawia
                </button>
                <button
                  type="button"
                  className={`advisor-toggle-opt advisor-toggle-listen ${advisorMode === 'PAUSED' ? 'is-active' : ''}`}
                  aria-pressed={advisorMode === 'PAUSED'}
                  onClick={() => setMode('PAUSED')}
                >
                  Tylko słucha
                </button>
              </div>
            </div>
          )}
          <div className="avatars" title={`Doradca · ${herName} · ${hisName}`}>
            <Avatar who="ADVISOR" size={34} className="av-stack" />
            <Avatar who="HER" size={34} alt={herName} className="av-stack" />
            <Avatar who="HIM" size={34} alt={hisName} className="av-stack" />
          </div>
        </div>
      </header>

      {/* wstęga faz — bieżący miękki cel rozmowy (postęp Otwarcie → Ustalenia) */}
      {messages.length > 0 && (
        <div className="phase-ribbon" title={`Faza ${PHASE_ORDER.indexOf(phase) + 1}/6`}>
          <span className="phase-ribbon-label">Faza</span>
          <div className="phase-track">
            {PHASE_ORDER.map((p, i) => (
              <Fragment key={p}>
                <span
                  className={`phase-bar ${i <= PHASE_ORDER.indexOf(phase) ? 'is-on' : ''} ${p === phase ? 'is-active' : ''}`}
                />
                {p === phase && <span className="phase-name">{PHASE_LABEL[p]}</span>}
              </Fragment>
            ))}
          </div>
          <span className="phase-ribbon-goal">→ Sedno · Ustalenia</span>
        </div>
      )}

      {/* lista wiadomości; onRetry pozwala ponowić wiadomość ze statusem 'failed' */}
      <MessageList
        messages={messages}
        herName={herName}
        hisName={hisName}
        advisorTyping={advisorTyping}
        onRetry={retry}
      />

      {/* panel „do omówienia później" — zaparkowane dygresje, nic nie ginie */}
      {parkedTopics.length > 0 && (
        <div className="parked-panel">
          <div className="parked-title">Do omówienia później</div>
          {parkedTopics.map((t) => (
            <div key={t.id} className="parked-item">
              <span className="parked-text">{t.text}</span>
              <span className="parked-actions">
                <button type="button" className="parked-btn parked-promote" onClick={() => resolveParked(t.id, 'PROMOTE')}>
                  wróćmy teraz
                </button>
                <button type="button" className="parked-btn" onClick={() => resolveParked(t.id, 'RESOLVED')}>
                  załatwione
                </button>
                <button type="button" className="parked-btn parked-dismiss" onClick={() => resolveParked(t.id, 'DISMISSED')} title="odrzuć">
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* status sceniczny reżysera — obecność, nie spinner (słucha / czeka / pisze).
          Przy oddaniu głosu pokazujemy awatar doradcy + pulsujący awatar osoby, na
          którą czekamy (zamiast samego imienia). Pozostałe stany: kropka + tekst. */}
      {advisorStatus.kind === 'waiting' && waitFor && /czeka na/i.test(advisorStatus.hint ?? '') ? (
        <div className="advisor-status advisor-status-waiting advisor-presence">
          <Avatar who="ADVISOR" size={22} />
          <span>{waitFor === 'TOGETHER' ? 'czeka na Waszą wspólną odpowiedź' : 'czeka na odpowiedź'}</span>
          {waitFor === 'TOGETHER' ? (
            <>
              <Avatar who="HER" size={22} pulse alt={herName} />
              <Avatar who="HIM" size={22} pulse alt={hisName} />
            </>
          ) : (
            <Avatar who={waitFor} size={22} pulse alt={waitFor === 'HER' ? herName : hisName} />
          )}
        </div>
      ) : (
        statusLabel && (
          <div className={`advisor-status advisor-status-${advisorStatus.kind}`}>
            <span className="advisor-status-dot" />
            {statusLabel}
          </div>
        )
      )}

      {/* globalny komunikat błędu (np. zerwany strumień) */}
      {error && <div className="error-banner">{error}</div>}

      {/* kompozytor; blokujemy na czas wysyłki (sending) i zanim hook jest gotów */}
      <Composer
        author={author}
        onAuthorChange={setAuthor}
        text={text}
        onTextChange={setText}
        placeholder={composerPlaceholder({ advisorMode, idle, lastDecision, author, herName, hisName })}
        onSend={handleSend}
        herName={herName}
        hisName={hisName}
        disabled={!ready || sending}
      />
    </div>
  );
}
