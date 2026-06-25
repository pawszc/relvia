import { useEffect, useState } from 'react';
import ChatScreen from './components/ChatScreen';
import LegalPage from './components/LegalPage';
import { mockChatClient } from './client/mockChatClient';
import { httpChatClient } from './client/httpChatClient';

// Domyślnie realny backend CAP (walking skeleton). Tryb offline (mock) włącz
// flagą VITE_USE_MOCK=true — np. w web/.env.local. Podmiana to wciąż jeden punkt.
const useMock = import.meta.env.VITE_USE_MOCK === 'true';
const client = useMock ? mockChatClient : httpChatClient;

// Lekki routing po #hash — bez zależności i bez konfiguracji SPA-fallback na serwerze.
// Strony prawne (Regulamin / Polityka prywatności) żyją pod linkiem; czat to widok domyślny.
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, ''));
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.replace(/^#/, ''));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

// Imiona pary pochodzą z encji Conversations (przez startConversation) — ChatScreen
// pobiera je z hooka useConversation, więc nie zaszywamy ich już tutaj.
export default function App() {
  const route = useHashRoute();
  return (
    <div className="app">
      {route === 'regulamin' ? (
        <LegalPage doc="terms" />
      ) : route === 'polityka-prywatnosci' ? (
        <LegalPage doc="privacy" />
      ) : (
        <ChatScreen client={client} />
      )}
    </div>
  );
}
