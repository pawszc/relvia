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
- **Akcje**: `startConversation`, `sendMessage`, `conversationState`, `resolveParkedTopic`, `setAdvisorMode`; **funkcja** `conversationUsage`.
- `sendMessage` zwraca **strumień SSE** (`text/event-stream`), nie JSON OData.
- Warstwa AI jest ukryta za interfejsem `AdvisorService` (`decide` + `generateReply`). **Domyślnie MOCK — zero tokenów** (`ADVISOR=mock`). Realny Anthropic (`ADVISOR=anthropic`): **oba kroki na `claude-haiku-4-5`** (`ADVISOR_MODEL`) — `decide` przez structured output (odpala się co turę), generacja streamingiem (tylko gdy `shouldSpeak`); reguły służą jako fallback. Model wymienny przez `ADVISOR_MODEL`, wycena auto wg modelu ([`srv/advisor/models.js`](srv/advisor/models.js)).

---

## 2. Model domenowy

| Encja | Pola kluczowe |
|---|---|
| `Conversations` | `ID`, `title`, `herName` (dom. `Ona`), `hisName` (dom. `On`), `createdAt` + **stan reżysera**: `phase`, `topic`, `advisorMode`, `turnsSinceProgress`, `escalationStreak`, `lastActivityAt`, `model`, `lastComposerHint`, `decide*Tokens` (tokeny warstwy decyzji, narastają co turę) |
| `Messages` | `ID`, `conversation`, `seq` (Integer), `author`, `text`, `createdAt` + dla dymek ADVISOR: `kind`, `decisionType`, tokeny generacji (`inputTokens`/`outputTokens`/…) |
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
{ "conversationId": "9f1c…", "herName": "Ona", "hisName": "On" }
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

W trybie **„tylko słucha"** (`advisorMode = PAUSED`) handler **nie woła modelu** — emituje wyłącznie `message.user` i kończy strumień (żadnych `advisor.*`). Para rozmawia między sobą; powrót przez `setAdvisorMode`.

| `event:` | `data:` (kształt) | Znaczenie |
|---|---|---|
| `message.user` | `{ message: ChatMessage }` | Zapisana wiadomość pary (z `id`, `seq`) |
| `advisor.decision` | `{ decision, phase, uiHint?, nextSpeaker?, composerHint? }` | Decyzja reżysera po turze (→ status sceniczny + podpowiedź do pola) |
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

**`setAdvisorMode`** — przełącznik trybu doradcy („Rozmawia" = `LEADING` / „Tylko słucha" = `PAUSED`):

```
POST /chat/setAdvisorMode   { "conversationId", "mode" }   // mode ∈ { LEADING, PAUSED }
→ { "ok": true }
```

Wejście w `PAUSED` dopisuje **szablonowe pożegnanie doradcy** (dymka ADVISOR, 0 tokenów, `kind:"FULL"`) — front dociąga je przez `getHistory()`. W `PAUSED` `sendMessage` nie woła modelu (patrz §5). Powrót do `LEADING` przywraca pełny tor.

**`conversationUsage`** (funkcja OData) — rozbicie zużycia tokenów i kosztu (generacja vs decyzja):

```
GET /chat/conversationUsage(conversationId='9f1c…')
→ { inputTokens, outputTokens, messages,
    decideInputTokens, decideOutputTokens,
    model, generationCostUsd, decideCostUsd, costUsd }
```

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

Mapowanie autora na wejście modelu: wiadomości pary → rola `user` z prefiksem mówcy, wiadomości doradcy → rola `assistant`. Prefiks to wewnętrzna wskazówka „kto pisze": przy domyślnych imionach (Ona/On) role‑etykiety `[kobieta]` / `[mężczyzna]` / `[razem]`, przy własnych imionach — imiona; doradca nigdy nie powtarza etykiet w odpowiedzi (`sanitizeAdvisor` dodatkowo czyści markdown i wiodące etykiety). Persona doradcy (ciepły, empatyczny, neutralny mediator) w `system` z `cache_control`, uzupełniana o krótką instrukcję sterującą wg typu decyzji (`DECISION_STEER`). **Model: `claude-haiku-4-5`** (`ADVISOR_MODEL`) — dla generacji ORAZ dla `decide` (structured output, `output_config.format` json_schema).

**Domyślnie `ADVISOR=mock` — zero wywołań do API.** Realny model włącza `ADVISOR=anthropic` (wymaga `ANTHROPIC_API_KEY`). Decyzja i generacja na tym samym modelu; reguły ([`decisionRules.js`](srv/advisor/decisionRules.js)) służą jako fallback. Szczegóły silnika i bezpieczeństwa: [`ENGINE.md`](ENGINE.md).
