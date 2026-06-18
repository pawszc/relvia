import { useEffect, useRef } from 'react';
import type { UiMessage } from '../hooks/useConversation';
import MessageBubble from './MessageBubble';

/**
 * Przewijalna lista wiadomości. Renderuje je w kolejności tablicy (nie sortuje
 * po seq) — bo o kolejności decyduje moment dodania (wiadomość pary dodajemy
 * optymistycznie, potem doradca). Auto-scrolluje na dół przy każdej zmianie.
 */

interface Props {
  messages: UiMessage[];
  herName: string;
  hisName: string;
  advisorTyping: boolean; // czy doradca aktualnie "pisze" (pokazuje kropki)
  onRetry: (clientId: string) => void;
}

export default function MessageList({ messages, herName, hisName, advisorTyping, onRetry }: Props) {
  // pusty <div> na samym dole, do którego przewijamy
  const endRef = useRef<HTMLDivElement>(null);

  // auto-scroll na dół przy nowych wiadomościach / kolejnych chunkach streamingu
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, advisorTyping]);

  return (
    <div className="messages">
      {/* empty-state: brak wiadomości i doradca nie pisze (świeże wejście) */}
      {messages.length === 0 && !advisorTyping && (
        <div className="empty-state">
          Zacznijcie tutaj — napiszcie pierwsze zdanie, każde z osobna albo&nbsp;razem.
        </div>
      )}

      {messages.map((m) => (
        <MessageBubble
          // klucz: clientId dla wiadomości pary (stabilny mimo reconcile id),
          // a id dla wiadomości doradcy
          key={m.clientId ?? m.id}
          message={m}
          herName={herName}
          hisName={hisName}
          // "pisze" tylko pusty bąbel doradcy w trakcie streamingu
          typing={advisorTyping && m.author === 'ADVISOR' && m.text.length === 0}
          onRetry={onRetry}
        />
      ))}

      <div ref={endRef} />
    </div>
  );
}
