import { useState } from 'react';
import type { ChatClient, Phase, SenderAuthor } from '@shared/chat-contract';
import { useConversation } from '../hooks/useConversation';
import MessageList from './MessageList';
import Composer from './Composer';

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
  } = useConversation(client);

  // który autor jest aktywny w kompozytorze (HER / TOGETHER / HIM)
  const [author, setAuthor] = useState<SenderAuthor>('HER');

  // status "sceniczny" reżysera: pokazujemy tylko gdy coś znaczy (nie 'idle')
  const statusLabel =
    advisorStatus.kind === 'waiting'
      ? (advisorStatus.hint ?? 'Advisor czeka…')
      : advisorStatus.kind === 'listening'
        ? (advisorStatus.hint ?? 'Advisor słucha…')
        : advisorStatus.kind === 'typing'
          ? 'Advisor pisze…'
          : null;

  return (
    <div className="card">
      {/* pasek górny: nazwa + awatary pary */}
      <header className="header">
        <div className="brand">
          <span className="brand-title">wspólnie</span>
          <span className="brand-sub">wasza przestrzeń</span>
        </div>
        <div className="header-right">
          {/* dyskretny wskaźnik fazy — bieżący miękki cel (nie blokuje niczego) */}
          {messages.length > 0 && (
            <span className="phase-pill" title={`Faza ${PHASE_ORDER.indexOf(phase) + 1}/6`}>
              {PHASE_LABEL[phase]}
            </span>
          )}
          <div className="avatars">
            <span className="avatar avatar-her">{herName.charAt(0).toUpperCase()}</span>
            <span className="avatar avatar-him">{hisName.charAt(0).toUpperCase()}</span>
          </div>
        </div>
      </header>

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

      {/* status sceniczny reżysera — obecność, nie spinner (słucha / czeka / pisze) */}
      {statusLabel && (
        <div className={`advisor-status advisor-status-${advisorStatus.kind}`}>
          <span className="advisor-status-dot" />
          {statusLabel}
        </div>
      )}

      {/* globalny komunikat błędu (np. zerwany strumień) */}
      {error && <div className="error-banner">{error}</div>}

      {/* kompozytor; blokujemy na czas wysyłki (sending) i zanim hook jest gotów */}
      <Composer
        author={author}
        onAuthorChange={setAuthor}
        onSend={(text) => send(author, text)}
        herName={herName}
        hisName={hisName}
        disabled={!ready || sending}
      />
    </div>
  );
}
