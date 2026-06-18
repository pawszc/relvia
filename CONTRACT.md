# Kontrakt usługi CAP — Couple Adviser

Jedno źródło prawdy dla frontu (mock i realny), backendu CAP i integracji AI.
Typy: [`shared/chat-contract.ts`](shared/chat-contract.ts) · Model: [`db/schema.cds`](db/schema.cds) · Usługa: [`srv/chat-service.cds`](srv/chat-service.cds)

Wariant wizualny: **A4** (ekspresyjny, wiadomość „razem" jako hero na osi).

> **Silnik rozmowy (reżyser).** `sendMessage` nie generuje odpowiedzi po każdej wiadomości — najpierw zapada
> decyzja (czy i jak Advisor ma się odezwać), a dopiero potem ewentualna generacja. Cele, logika i typy decyzji:
> **[`ENGINE.md`](ENGINE.md)**. Ten dokument opisuje protokół (encje, akcje, zdarzenia SSE).

---

## 1. Zakres i granice

- Powierzchnia **read-only OData** dla historii (`Conversations`, `Messages`, `ParkedTopics`).
- **Akcje**: `startConversation`, `sendMessage`, `conversationState`, `resolveParkedTopic`.
- `sendMessage` zwraca **strumień SSE** (`text/event-stream`), nie JSON OData.
- Warstwa AI jest ukryta za interfejsem `AdvisorService` (`decide` + `generateReply`). **Domyślnie MOCK — zero tokenów** (`ADVISOR=mock`). Realny Anthropic (`ADVISOR=anthropic`): decyzja regułowa, generacja `claude-sonnet-4-6`; mały model decyzyjny (`claude-haiku`) — krok 5.

---

## 2. Model domenowy

| Encja | Pola kluczowe |
|---|---|
| `Conversations` | `ID`, `title`, `herName`, `hisName`, `createdAt` + **stan reżysera**: `phase`, `topic`, `advisorMode`, `turnsSinceProgress`, `escalationStreak`, `lastActivityAt` |
| `Messages` | `ID`, `conversation`, `seq` (Integer), `author`, `text`, `createdAt` + dla dymek ADVISOR: `kind`, `decisionType` |
| `ParkedTopics` | `ID`, `conversation`, `text`, `status` (`OPEN`/`RESOLVED`/`DISMISSED`), `parkedAtSeq` — lista „do omówienia później" |

`author ∈ { HER, HIM, TOGETHER, ADVISOR }`. Para pisze jako `HER`/`HIM`/`TOGETHER`; `ADVISOR` rezerwowany dla AI. `seq` rośnie monotonicznie w obrębie konwersacji i jest jedyną podstawą sortowania.

Znaczenie pól stanu reżysera (`phase`, `topic`, `turnsSinceProgress` …) i parkingu — zob. [`ENGINE.md`](ENGINE.md).

---

## 3. Powierzchnia OData (read-only)

```
GET  /chat/Conversations
GET  /chat/Conversations({id})?$expand=messages($orderby=seq)
GET  /chat/Messages?$filter=conversation_ID eq {id}&$orderby=seq
GET  /chat/ParkedTopics?$filter=conversation_ID eq {id}&$orderby=parkedAtSeq
```

Klient frontowy używa tego do `getHistory()` (np. po odświeżeniu strony). Stan reżysera odtwarza akcja `conversationState` (sekcja 6a).

---

## 4. Akcja `startConversation`

```
POST /chat/startConversation
Content-Type: application/json

{ "title": "Niedziele" }
```

Odpowiedź (JSON OData) — zawiera też imiona pary (z encji `Conversations`):

```json
{ "conversationId": "9f1c…", "herName": "Ola", "hisName": "Tomek" }
```

---

## 5. Akcja `sendMessage` — streaming SSE

### Żądanie

```
POST /chat/sendMessage
Content-Type: application/json
Accept: text/event-stream

{
  "conversationId": "9f1c…",
  "author": "HER",
  "text": "Czuję, że ogarnianie domu wisi tylko na mnie. Jestem zmęczona."
}
```

`author` nie może być `ADVISOR` → `400` (`code: "INVALID_AUTHOR"`).

### Odpowiedź — protokół zdarzeń

Każde zdarzenie: linia `event: <type>` + linia `data: <JSON>` + pusta linia.

Kolejność zależy od decyzji reżysera:
- **Advisor MÓWI:** `message.user` → `advisor.decision` → `[phase.change]` → `[parked.update]` → `advisor.start` → `advisor.delta`* → `advisor.end`
- **Advisor MILCZY:** `message.user` → `advisor.decision` → `[phase.change]` → `[parked.update]` → `advisor.wait`

`phase.change` i `parked.update` są emitowane tylko przy realnej zmianie. `error` może wystąpić w dowolnym momencie i kończy strumień.

| `event:` | `data:` (kształt) | Znaczenie |
|---|---|---|
| `message.user` | `{ message: ChatMessage }` | Zapisana wiadomość pary (z `id`, `seq`) |
| `advisor.decision` | `{ decision, phase, uiHint?, nextSpeaker? }` | Decyzja reżysera po turze (→ status sceniczny) |
| `advisor.wait` | `{ uiHint }` | Advisor analizuje, ale **nie dodaje dymki** (lista nie rośnie) |
| `phase.change` | `{ phase, topic? }` | Zmiana fazy (miękki cel) |
| `parked.update` | `{ topics: ParkedTopic[] }` | Aktualna lista „do omówienia później" |
| `advisor.start` | `{ message: {id, conversationId, seq, author:"ADVISOR", createdAt} }` | Doradca zaczyna — pusty „bąbel" w UI |
| `advisor.delta` | `{ text: "fragment" }` | Kolejny kawałek odpowiedzi (streaming) |
| `advisor.end` | `{ text, finishReason, kind }` | Koniec — treść + rodzaj dymki (`FULL`/`MODERATION`/`INTERVENTION`) |
| `error` | `{ code, message }` | Błąd |

`finishReason ∈ { end_turn, max_tokens, error }`. `decision ∈ AdvisorDecisionType` (zob. [`ENGINE.md`](ENGINE.md)).

### Przykładowy przebieg (treści z prototypu A4)

```
event: message.user
data: {"message":{"id":"m1","conversationId":"9f1c","seq":4,"author":"HER","text":"Czuję, że ogarnianie domu wisi tylko na mnie. Jestem zmęczona.","createdAt":"2026-06-18T10:00:00Z"}}

event: advisor.start
data: {"message":{"id":"m2","conversationId":"9f1c","seq":5,"author":"ADVISOR","createdAt":"2026-06-18T10:00:01Z"}}

event: advisor.delta
data: {"text":"Słyszę "}

event: advisor.delta
data: {"text":"dwie potrzeby naraz: "}

event: advisor.delta
data: {"text":"być widzianą i być docenianym."}

event: advisor.end
data: {"text":"Słyszę dwie potrzeby naraz: być widzianą i być docenianym.","finishReason":"end_turn"}
```

> Wiadomość `TOGETHER` ("razem") idzie tym samym `sendMessage` z `author:"TOGETHER"` — różni się tylko renderem (hero na osi w A4), nie protokołem.

---

## 6a. Akcje stanu i parkingu

Obie wywoływane jako `POST` z ciałem JSON (jak `startConversation`).

**`conversationState`** — odtworzenie stanu reżysera dla UI (po odświeżeniu):

```
POST /chat/conversationState   { "conversationId": "9f1c…" }
→ { "phase": "PARAPHRASE", "topic": "…", "advisorMode": "LEADING",
    "parkedTopics": [ { "id", "text", "status", "parkedAtSeq" } ] }
```

**`resolveParkedTopic`** — zmiana stanu zaparkowanego tematu z panelu „do omówienia później":

```
POST /chat/resolveParkedTopic  { "conversationId", "topicId", "action" }
→ { "ok": true }
```

`action ∈ { PROMOTE, RESOLVED, DISMISSED }`. `PROMOTE` = „wróćmy teraz": ustawia `topic` konwersacji na ten
temat i zamyka go (`RESOLVED`). `RESOLVED`/`DISMISSED` tylko oznaczają status.

---

## 6. Tryb degradacji (bez SSE)

Jeśli klient nie wyśle `Accept: text/event-stream`, handler odpowiada zwykłym JSON-em OData po zakończeniu generacji:

```json
{ "advisorMessageId": "m2" }
```

Gdy reżyser zdecydował, że Advisor milczy (`WAIT`/`advisor.wait`), `advisorMessageId` jest `null`.
UI dociąga treść przez `getHistory()`. Streaming jest ścieżką domyślną; to tylko awaryjne.

---

## 7. Wymienność warstw (dlaczego ten kształt)

`ChatClient.sendMessage()` zwraca `AsyncIterable<ChatStreamEvent>` — identycznie dla mocka frontu i realnego klienta SSE. `AdvisorService` ma dwa kroki: `decide()` (decyzja — czy/jak mówić) i `generateReply()` (`delta`/`end`, tylko gdy `shouldSpeak`) — identycznie dla mocka backendu i Anthropic. Handler CAP tłumaczy decyzję na `advisor.decision`/`advisor.wait`, a generację na `advisor.delta`/`advisor.end`. Żadna podmiana mock↔realne nie dotyka UI ani logiki CAP. Szczegóły silnika: [`ENGINE.md`](ENGINE.md).

---

## 8. Mapowanie na Anthropic

Kształt SSE celowo odzwierciedla `messages.stream()` Anthropic, więc realna implementacja `AdvisorService` (`generateReply`) to cienki adapter (zaimplementowany w [`srv/advisor/anthropicAdvisor.js`](srv/advisor/anthropicAdvisor.js)):

| Anthropic | `AdvisorService` → SSE |
|---|---|
| `content_block_delta` (`text_delta`) | `delta` → `advisor.delta` |
| `message_stop` + `finalMessage()` | `end` → `advisor.end` |
| `stop_reason: "refusal"` | `end` z `finishReason:"error"` (obsłużyć przed czytaniem treści) |

Mapowanie autora na wejście modelu: wiadomości pary → rola `user` z prefiksem mówcy (`[Ola]:` / `[Tomek]:` / `[Razem]:`), wiadomości doradcy → rola `assistant`. Persona doradcy (ciepły, empatyczny, neutralny mediator) w `system` z `cache_control` (stały prefiks → tańszy), uzupełniana o krótką instrukcję sterującą wg typu decyzji. Model generacji: `claude-sonnet-4-6`.

**Domyślnie `ADVISOR=mock` — zero wywołań do API.** Realny model włącza `ADVISOR=anthropic` (wymaga `ANTHROPIC_API_KEY`). Mały model decyzyjny (`claude-haiku`) dla `decide` — krok 5, patrz [`ENGINE.md`](ENGINE.md).
