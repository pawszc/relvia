import type {
  ChatClient,
  ChatMessage,
  ChatStreamEvent,
  ParkedAction,
  SendMessageRequest,
  UiConversationState,
} from '@shared/chat-contract';

/**
 * Realny klient czatu (Faza 2) — implementuje TEN SAM kontrakt ChatClient
 * co mock. Rozmawia z backendem CAP: OData (historia) + akcje (start/sendMessage)
 * + parsowanie strumienia SSE z sendMessage.
 *
 * Ścieżki względne — w dev proxy Vite kieruje /chat → http://localhost:4004,
 * w produkcji (monolit) CAP serwuje statyki pod tym samym originem.
 */

const BASE = '/chat';

/** Wiersz OData (ID, conversation_ID, …) → ChatMessage z kontraktu. */
function toMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.ID ?? row.id),
    conversationId: String(row.conversation_ID ?? row.conversationId),
    seq: Number(row.seq),
    author: row.author as ChatMessage['author'],
    text: String(row.text ?? ''),
    createdAt: String(row.createdAt ?? ''),
    // zachowaj rodzaj dymki/diagnostykę (np. INTERVENTION) przy odświeżeniu/historii
    ...(row.kind ? { kind: row.kind as ChatMessage['kind'] } : {}),
    ...(row.decisionType ? { decisionType: row.decisionType as ChatMessage['decisionType'] } : {}),
  };
}

/** Parsuje jeden blok SSE ("event:" + "data:") na ChatStreamEvent. */
function parseBlock(block: string): ChatStreamEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!event) return null;
  const dataStr = dataLines.join('\n');
  const data = dataStr ? JSON.parse(dataStr) : {};
  // kształt kontraktu: { type: <event>, ...pozostałe pola z data }
  return { type: event, ...data } as ChatStreamEvent;
}

/** Strumień bajtów SSE → kolejne ChatStreamEvent. */
async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseBlock(block);
        if (ev) yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const httpChatClient: ChatClient = {
  async startConversation(title?: string) {
    const r = await fetch(`${BASE}/startConversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? null }),
    });
    if (!r.ok) throw new Error(`startConversation: HTTP ${r.status}`);
    const j = await r.json();
    return {
      conversationId: j.conversationId as string,
      herName: (j.herName as string) ?? 'Ona',
      hisName: (j.hisName as string) ?? 'On',
      accessToken: j.accessToken as string,
    };
  },

  async getHistory(conversationId: string, accessToken?: string) {
    // Historia przez AKCJĘ (nie OData) — backend nie wystawia już encji Messages,
    // a akcja wymaga accessToken (capability tej konwersacji).
    const r = await fetch(`${BASE}/getHistory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, accessToken }),
    });
    if (!r.ok) throw new Error(`getHistory: HTTP ${r.status}`);
    const j = await r.json();
    // akcja CAP zwraca tablicę w `value`
    const rows = (j.value ?? j) as Record<string, unknown>[];
    return rows.map(toMessage);
  },

  async *sendMessage(req: SendMessageRequest): AsyncIterable<ChatStreamEvent> {
    const r = await fetch(`${BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(req),
    });
    if (!r.ok || !r.body) {
      yield { type: 'error', code: 'HTTP_ERROR', message: `sendMessage: HTTP ${r.status}` };
      return;
    }
    yield* parseSSE(r.body);
  },

  async getState(conversationId: string, accessToken?: string): Promise<UiConversationState> {
    const r = await fetch(`${BASE}/conversationState`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, accessToken }),
    });
    if (!r.ok) throw new Error(`conversationState: HTTP ${r.status}`);
    const j = await r.json();
    return {
      phase: j.phase ?? 'OPENING',
      topic: j.topic ?? undefined,
      advisorMode: j.advisorMode ?? 'LEADING',
      parkedTopics: j.parkedTopics ?? [],
    };
  },

  async resolveParkedTopic(
    conversationId: string,
    topicId: string,
    action: ParkedAction,
    accessToken?: string,
  ): Promise<void> {
    const r = await fetch(`${BASE}/resolveParkedTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, topicId, action, accessToken }),
    });
    if (!r.ok) throw new Error(`resolveParkedTopic: HTTP ${r.status}`);
  },

  async setAdvisorMode(conversationId: string, mode, accessToken?: string): Promise<void> {
    const r = await fetch(`${BASE}/setAdvisorMode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, mode, accessToken }),
    });
    if (!r.ok) throw new Error(`setAdvisorMode: HTTP ${r.status}`);
  },
};
