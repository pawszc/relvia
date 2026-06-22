# Relvia — Frontend (Faza 1)

React + Vite + TypeScript. Wariant wizualny **A4**. Backend jest **zamockowany po stronie frontu** — zero sieci, zero tokenów.

## Uruchomienie

```bash
cd relvia/web
npm install
npm run dev
```

Otwórz adres wypisany przez Vite (domyślnie http://localhost:5173).

## Co działa

- Pełny ekran czatu A4: doradca (środek), Ola (lewa), Tomek (prawa), wiadomość „razem" (hero na osi).
- Przełącznik autora w kompozytorze: **Ola / Razem / Tomek**.
- **Symulowany streaming** odpowiedzi doradcy (chunki słowo po słowie, wskaźnik pisania).
- Seedowane otwarcie rozmowy w duchu prototypu.

## Architektura (kluczowe dla kolejnych faz)

- [`src/client/mockChatClient.ts`](src/client/mockChatClient.ts) implementuje interfejs `ChatClient` z [`../shared/chat-contract.ts`](../shared/chat-contract.ts).
- **Podmiana mock → realny klient SSE (Faza 2+) = zmiana jednej linii** w [`src/App.tsx`](src/App.tsx) (`const client = …`). UI i hook (`useConversation`) pozostają bez zmian, bo konsumują wyłącznie `AsyncIterable<ChatStreamEvent>` z kontraktu.
- Typy są importowane ze wspólnego `../shared/chat-contract.ts` (alias `@shared`) — jedno źródło prawdy z backendem CAP.

## Czego tu NIE ma (świadomie)

- Żadnych wywołań AI ani HTTP — zgodnie z zasadą „zero tokenów do Fazy 3".
- Persystencji między odświeżeniami (mock trzyma stan w pamięci).
