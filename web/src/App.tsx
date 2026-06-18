import ChatScreen from './components/ChatScreen';
import { mockChatClient } from './client/mockChatClient';
import { httpChatClient } from './client/httpChatClient';

// Domyślnie realny backend CAP (walking skeleton). Tryb offline (mock) włącz
// flagą VITE_USE_MOCK=true — np. w web/.env.local. Podmiana to wciąż jeden punkt.
const useMock = import.meta.env.VITE_USE_MOCK === 'true';
const client = useMock ? mockChatClient : httpChatClient;

// Imiona pary pochodzą z encji Conversations (przez startConversation) — ChatScreen
// pobiera je z hooka useConversation, więc nie zaszywamy ich już tutaj.
export default function App() {
  return (
    <div className="app">
      <ChatScreen client={client} />
    </div>
  );
}
