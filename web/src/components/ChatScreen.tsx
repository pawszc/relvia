import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AdvisorMode, ChatClient, Phase, SenderAuthor } from '@shared/chat-contract';
import { useConversation, type AdvisorStatus, type LastDecision } from '../hooks/useConversation';
import MessageList from './MessageList';
import Composer from './Composer';
import Avatar from './Avatar';
import SafetyFooter from './SafetyFooter';
import LanguageSwitcher from './LanguageSwitcher';

const PHASE_ORDER: Phase[] = ['OPENING', 'PERSPECTIVE_A', 'PERSPECTIVE_B', 'PARAPHRASE', 'CORE', 'AGREEMENT'];

// Flaga: przełącznik trybu doradcy (Rozmawia/Tylko słucha) jest na razie ukryty.
// Cała logika trybu (advisorMode/setMode/PAUSED) zostaje w kodzie — możemy do niej
// wrócić, włączając VITE_ADVISOR_MODE_TOGGLE=true (np. w web/.env.local).
const SHOW_ADVISOR_MODE_TOGGLE = import.meta.env.VITE_ADVISOR_MODE_TOGGLE === 'true';

// Flaga: wskaźnik postępu fazy (Otwarcie → Ustalenia). Domyślnie UKRYTY — nie pokazujemy
// go użytkownikom, ale łatwo włączyć do testów: VITE_PHASE_PROGRESS=true (np. w web/.env.local).
const SHOW_PHASE_PROGRESS = import.meta.env.VITE_PHASE_PROGRESS === 'true';

// Typy decyzji z dedykowaną etykietą statusu „listening" (reszta → advisorStatus.listening).
const LISTENING_LABEL_KEY: Partial<Record<string, string>> = {
  DEEPEN: 'advisorStatus.probing',
  INTERVENE: 'advisorStatus.calming',
};

/**
 * „Inteligentny kompozytor" (faza 2): placeholder naprowadza na konstruktywny krok
 * wg ostatniej decyzji reżysera. Pokazuje się tylko przy pustym polu (placeholder),
 * więc nie przeszkadza w pisaniu. Zero tokenów — czysto na danych, które już mamy.
 * Statyczne fallbacki tłumaczy i18n (placeholders.*); composerHint z modelu przychodzi
 * już w języku rozmowy (dyrektywa językowa w promptcie decide).
 */
const DECISION_PLACEHOLDER_KEYS = new Set(['DEEPEN', 'CLARIFY', 'NARROW', 'REFRAME', 'CHOOSE', 'PROPOSE', 'INTERVENE']);

function composerPlaceholder(p: {
  t: TFunction;
  advisorMode: AdvisorMode;
  idle: boolean;
  lastDecision: LastDecision | null;
  author: SenderAuthor;
  herName: string;
  hisName: string;
}): string {
  const { t, advisorMode, idle, lastDecision, author, herName, hisName } = p;
  const nameOf = (a: SenderAuthor) => (a === 'HER' ? herName : a === 'HIM' ? hisName : t('common.both'));
  if (advisorMode === 'PAUSED') return t('placeholders.paused');
  if (idle) return t('placeholders.idle');
  // podpowiedź z modelu (kontekstowa) ma pierwszeństwo; niżej — statyczny fallback
  if (lastDecision?.composerHint) return lastDecision.composerHint;
  const type = lastDecision?.type;
  if (type === 'ASK_OTHER' && author !== 'TOGETHER') return t('placeholders.askOther', { name: nameOf(author) });
  if (type && DECISION_PLACEHOLDER_KEYS.has(type)) return t(`placeholders.${type}`);
  return author === 'TOGETHER' ? t('placeholders.together') : t('placeholders.writeAs', { name: nameOf(author) });
}

/** Etykieta statusu scenicznego (poza torem „czeka na osobę" — ten ma własny render). */
function statusLabelFor(t: TFunction, status: AdvisorStatus): string | null {
  if (status.kind === 'waiting') return t('advisorStatus.silent');
  if (status.kind === 'listening') {
    const key = (status.decisionType && LISTENING_LABEL_KEY[status.decisionType]) || 'advisorStatus.listening';
    return t(key);
  }
  if (status.kind === 'typing') return t('advisorStatus.typing');
  return null;
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
  const { t, i18n } = useTranslation();
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

  // Imiona do WYŚWIETLANIA: domyślne markery z bazy ('Ona'/'On' — patrz schema.cds)
  // tłumaczymy na etykiety ról w bieżącym języku; własne imiona pary zostają bez zmian.
  const displayHer = herName === 'Ona' ? t('common.her') : herName;
  const displayHis = hisName === 'On' ? t('common.him') : hisName;

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
    const trimmed = text.trim();
    if (!trimmed) return;
    send(author, trimmed);
    setText('');
  };

  // status "sceniczny" reżysera: pokazujemy tylko gdy coś znaczy (nie 'idle');
  // tor „czeka na osobę" (waitingFor) ma osobny render z awatarami niżej
  const statusLabel = statusLabelFor(t, advisorStatus);

  // osoba, na którą doradca czeka (do pulsującego awatara w statusie obecności)
  const waitFor = advisorStatus.kind === 'waiting' ? advisorStatus.waitingFor : undefined;

  // komunikat błędu: stan trzyma KOD — tekst tłumaczymy dopiero przy renderze
  const errorLabel = error ? (i18n.exists(`errors.${error}`) ? t(`errors.${error}`) : t('errors.generic')) : null;

  return (
    <div className="card">
      {/* pasek górny: brand lockup (Venn + nazwa) + przełącznik języka + klaster awatarów */}
      <header className="header">
        <div className="brand">
          <span className="brand-venn" aria-hidden="true">
            <span className="ring ring-her" />
            <span className="ring ring-him" />
          </span>
          <span className="brand-text">
            <span className="brand-title">
              Relvia<span className="brand-badge">EXPERIMENTAL</span>
            </span>
            <span className="brand-sub">support for your relationship · room for both voices</span>
          </span>
        </div>
        <div className="header-right">
          <LanguageSwitcher />
          {/* tryb doradcy (krok 4): trwały przełącznik „rozmawia" / „tylko słucha".
              „tylko słucha" = doradca całkowicie wyłączony (zero wywołań modelu).
              Na razie ukryty za flagą SHOW_ADVISOR_MODE_TOGGLE — logika zostaje w kodzie. */}
          {SHOW_ADVISOR_MODE_TOGGLE && messages.length > 0 && (
            <div className="advisor-toggle" role="group" aria-label={t('header.advisorToggleGroup')}>
              <span className="advisor-toggle-label">{t('header.advisorLabel')}</span>
              <div className="advisor-toggle-seg">
                <button
                  type="button"
                  className={`advisor-toggle-opt ${advisorMode === 'LEADING' ? 'is-active' : ''}`}
                  aria-pressed={advisorMode === 'LEADING'}
                  onClick={() => setMode('LEADING')}
                >
                  {t('header.modeLeading')}
                </button>
                <button
                  type="button"
                  className={`advisor-toggle-opt advisor-toggle-listen ${advisorMode === 'PAUSED' ? 'is-active' : ''}`}
                  aria-pressed={advisorMode === 'PAUSED'}
                  onClick={() => setMode('PAUSED')}
                >
                  {t('header.modeListening')}
                </button>
              </div>
            </div>
          )}
          <div className="avatars" title={t('header.avatarsTitle', { her: displayHer, his: displayHis })}>
            <Avatar who="ADVISOR" size={34} className="av-stack" />
            <Avatar who="HER" size={34} alt={displayHer} className="av-stack" />
            <Avatar who="HIM" size={34} alt={displayHis} className="av-stack" />
          </div>
        </div>
      </header>

      {/* wstęga faz — bieżący miękki cel rozmowy (postęp Otwarcie → Ustalenia).
          Ukryta za flagą SHOW_PHASE_PROGRESS — domyślnie niewidoczna dla użytkowników. */}
      {SHOW_PHASE_PROGRESS && messages.length > 0 && (
        <div className="phase-ribbon" title={t('phases.ribbonTitle', { n: PHASE_ORDER.indexOf(phase) + 1, total: 6 })}>
          <span className="phase-ribbon-label">{t('phases.ribbonLabel')}</span>
          <div className="phase-track">
            {PHASE_ORDER.map((p, i) => (
              <Fragment key={p}>
                <span
                  className={`phase-bar ${i <= PHASE_ORDER.indexOf(phase) ? 'is-on' : ''} ${p === phase ? 'is-active' : ''}`}
                />
                {p === phase && <span className="phase-name">{t(`phases.${p}`)}</span>}
              </Fragment>
            ))}
          </div>
          <span className="phase-ribbon-goal">{t('phases.ribbonGoal')}</span>
        </div>
      )}

      {/* lista wiadomości; onRetry pozwala ponowić wiadomość ze statusem 'failed' */}
      <MessageList
        messages={messages}
        herName={displayHer}
        hisName={displayHis}
        advisorTyping={advisorTyping}
        onRetry={retry}
      />

      {/* panel „do omówienia później" — zaparkowane dygresje, nic nie ginie */}
      {parkedTopics.length > 0 && (
        <div className="parked-panel">
          <div className="parked-title">{t('parked.title')}</div>
          {parkedTopics.map((topic) => (
            <div key={topic.id} className="parked-item">
              <span className="parked-text">{topic.text}</span>
              <span className="parked-actions">
                <button type="button" className="parked-btn parked-promote" onClick={() => resolveParked(topic.id, 'PROMOTE')}>
                  {t('parked.promote')}
                </button>
                <button type="button" className="parked-btn" onClick={() => resolveParked(topic.id, 'RESOLVED')}>
                  {t('parked.resolved')}
                </button>
                <button
                  type="button"
                  className="parked-btn parked-dismiss"
                  onClick={() => resolveParked(topic.id, 'DISMISSED')}
                  title={t('parked.dismiss')}
                  aria-label={t('parked.dismiss')}
                >
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
      {waitFor ? (
        <div className="advisor-status advisor-status-waiting advisor-presence">
          <Avatar who="ADVISOR" size={22} />
          <span>{waitFor === 'TOGETHER' ? t('advisorStatus.presenceWaitBoth') : t('advisorStatus.presenceWaitFor')}</span>
          {waitFor === 'TOGETHER' ? (
            <span className="pill-pair">
              <Avatar who="HER" size={22} pulse alt={displayHer} />
              <Avatar who="HIM" size={22} pulse alt={displayHis} />
            </span>
          ) : (
            <Avatar who={waitFor} size={22} pulse alt={waitFor === 'HER' ? displayHer : displayHis} />
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

      {/* globalny komunikat błędu (np. zerwany strumień) — kod tłumaczony przy renderze */}
      {errorLabel && <div className="error-banner">{errorLabel}</div>}

      {/* kompozytor; blokujemy na czas wysyłki (sending) i zanim hook jest gotów */}
      <Composer
        author={author}
        onAuthorChange={setAuthor}
        text={text}
        onTextChange={setText}
        placeholder={composerPlaceholder({ t, advisorMode, idle, lastDecision, author, herName: displayHer, hisName: displayHis })}
        onSend={handleSend}
        herName={displayHer}
        hisName={displayHis}
        disabled={!ready || sending}
      />

      {/* stała mikro-stopka bezpieczeństwa (A1) — ujawnienie AI + numery pod ⓘ */}
      <SafetyFooter />
    </div>
  );
}
