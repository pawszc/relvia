# Couple Adviser — specyfikacja techniczna

Ten dokument tłumaczy **jak aplikacja jest zbudowana i dlaczego** — z myślą o developerze na poziomie
**junior/mid**. Pojęcia, które mogą być nowe (SSE, structured output, async generatory, prompt caching,
specyfika SAP CAP), są wyjaśniane „po drodze", a nie zakładane jako znane.

Czytaj razem z:
- **[FUNCTIONAL.md](FUNCTIONAL.md)** — co aplikacja robi (zachowanie, bez kodu). Dobry punkt startu.
- **[ENGINE.md](ENGINE.md)** — silnik decyzji od strony koncepcyjnej.
- **[CONTRACT.md](CONTRACT.md)** — dokładny protokół (encje, akcje, zdarzenia SSE).
- **[SAFETY.md](SAFETY.md)** — postawa bezpieczeństwa.

> Konwencja: 🧠 *„Wyjaśnienie pojęcia"* to wtrącenia tłumaczące koncept ogólny (nie tylko ten projekt).

---

## Spis treści

1. [Obraz całości](#1-obraz-całości)
2. [Stack i kluczowe decyzje](#2-stack-i-kluczowe-decyzje)
3. [Przepływ jednej tury (end-to-end)](#3-przepływ-jednej-tury-end-to-end)
4. [Transport: SSE i „Plan A"](#4-transport-sse-i-plan-a)
5. [Kontrakt i wymienność warstw](#5-kontrakt-i-wymienność-warstw)
6. [Silnik decyzji — `decide()`](#6-silnik-decyzji--decide)
7. [Generacja odpowiedzi — `generateReply()`](#7-generacja-odpowiedzi--generatereply)
8. [Rejestr empatii wg płci + floor](#8-rejestr-empatii-wg-płci--floor)
9. [Model danych i persystencja](#9-model-danych-i-persystencja)
10. [Tokeny, koszt i rozliczanie](#10-tokeny-koszt-i-rozliczanie)
11. [Fallback i tryb mock](#11-fallback-i-tryb-mock)
12. [Konfiguracja i uruchomienie](#12-konfiguracja-i-uruchomienie)
13. [Pułapki i świadome decyzje](#13-pułapki-i-świadome-decyzje)
14. [Mapa plików](#14-mapa-plików)
15. [Słowniczek techniczny](#15-słowniczek-techniczny)

---

## 1. Obraz całości

```
┌─────────────────────────┐        /chat (OData + akcje + SSE)        ┌──────────────────────────┐
│  Front: React+Vite+TS    │  ───────────────────────────────────▶   │  Backend: SAP CAP (Node) │
│  web/                    │  ◀───────  strumień SSE  ───────────     │  srv/                    │
│  - useConversation (hook)│                                          │  - chat-service.js       │
│  - ChatScreen / Composer │                                          │  - advisor/* (warstwa AI)│
│  - httpChatClient (SSE)  │                                          └─────────┬────────────────┘
│  - mockChatClient (offl.)│                                                    │
└─────────────────────────┘                                          ┌─────────▼──────────┐   ┌──────────────┐
                                                                     │ SQLite (db.sqlite) │   │ Anthropic SDK │
                                                                     └────────────────────┘   │  (Haiku)      │
                                                                                               └──────────────┘
```

- **Monolit, jeden origin.** Docelowo CAP serwuje zbudowany frontend jako statyki — brak CORS. W dev są dwa
  procesy (Vite + CAP) z proxy.
- **Warstwa AI jest wymienna** za interfejsem `AdvisorService`: `mock` (zero tokenów) lub `anthropic`
  (realny model). Przełącza zmienna `ADVISOR`.
- **Frontend też ma swój mock** (`mockChatClient`) na tryb offline — można rozwijać UI bez backendu.

🧠 *Monolit vs serwerless:* aplikacja używa **streamingu SSE** (długie połączenie HTTP) i **pliku
SQLite**, więc wymaga hosta z **trwałym procesem Node** i **systemem plików**. Funkcje serverless
(Vercel/Netlify functions) i hosty statyczne **nie nadają się** na backend (pod sam frontend SPA owszem).

---

## 2. Stack i kluczowe decyzje

| Warstwa | Technologia | Dlaczego tak |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | szybki dev (Vite), typy współdzielone z backendem |
| Backend | **SAP CAP** (Node, czysty JS) | użytkownik zna CAP; tu używany **jak zwykły backend Node** |
| Baza | SQLite (plik `db.sqlite`) | prostota dev; możliwy Postgres przy większym ruchu |
| AI | Anthropic SDK (model **Haiku 4.5**) | jeden model dla decyzji i generacji; tani, szybki |
| Kontrakt typów | `shared/chat-contract.ts` | **jedno źródło prawdy** dla frontu i backendu |

> **WAŻNE: to nie jest produkt SAP i nie idzie na BTP.** CAP jest tu zwykłym backendem Node. Nie wymaga
> infrastruktury SAP. Cel to publiczna strona www.

🧠 *Co to jest SAP CAP?* To framework Node (i Java) do budowy usług OData/REST z modelem danych w języku
**CDS** (`.cds`). Definiujesz encje i akcje deklaratywnie, a logikę dopinasz w handlerach (`.js`). Tu
korzystamy z małego wycinka: encje (jako tabele SQLite), akcje (jako endpointy POST) i własne handlery.

---

## 3. Przepływ jednej tury (end-to-end)

To jest **najważniejszy diagram w całym dokumencie** — ścieżka jednej wiadomości:

```
1. Front: użytkownik wysyła wiadomość
   httpChatClient.sendMessage() → POST /chat/sendMessage  (Accept: text/event-stream)

2. Backend (chat-service.js, handler 'sendMessage'):
   a) walidacja (author ≠ ADVISOR, text niepusty)
   b) ZAPIS wiadomości pary do Messages (kolejny seq)
   c) jeśli tryb = „tylko słucha" (PAUSED) → wyślij tylko message.user, KONIEC (zero modelu)
   d) wczytaj historię (loadHistory) + stan reżysera (loadState)
   e) decide(history, state, ctx)  ← KROK 1: cicha decyzja (czy/jak mówić)   [woła model]
   f) persistState(...)            ← zapis fazy, kotwicy, liczników, tokenów decide; parkowanie dygresji
   g) otwórz odpowiedź jako SSE i wyślij:
        message.user → advisor.decision → [phase.change?] → [parked.update?]
   h) decision.shouldSpeak ?
        NIE → advisor.wait, res.end(), KONIEC
        TAK → advisor.start → generateReply(...) streamuje advisor.delta* → advisor.end  [woła model]
   i) zapis dymki doradcy do Messages (po sanityzacji), zapis tokenów generacji, res.end()

3. Front: httpChatClient.sendMessage() zwraca async-strumień zdarzeń (parseSSE).
   useConversation iteruje go (for await … switch) i aktualizuje stan Reacta per typ
   zdarzenia (wiadomości, status sceniczny, faza, placeholder).
```

Dwie rzeczy warto zauważyć od razu:
- **Decyzja poprzedza generację.** Najpierw `decide` rozstrzyga „czy i jak", potem ewentualnie
  `generateReply`. To serce „reżysera".
- **Dwa wywołania modelu na turę** (w trybie anthropic): `decide` **zawsze**, `generateReply` **tylko gdy
  doradca mówi**. Stąd model kosztu (§10).

---

## 4. Transport: SSE i „Plan A"

### Co to jest SSE

🧠 *Server-Sent Events (SSE)* to prosty sposób, w jaki **serwer wysyła strumień zdarzeń do przeglądarki**
po jednym połączeniu HTTP (jednokierunkowo: serwer → klient). Format jest tekstowy:

```
event: advisor.delta
data: {"text":"Słyszę "}

event: advisor.delta
data: {"text":"dwie potrzeby…"}
```

Każde zdarzenie to linia `event:` + linia `data:` (JSON) + pusta linia. Idealne do **streamingu tokenów**
modelu, bo dymka „dopisuje się" w UI na żywo, zamiast pojawiać się naraz po kilku sekundach.

### „Plan A" — jak CAP streamuje SSE

Tu jest najważniejszy trik backendu. Akcja `sendMessage` jest **zadeklarowana** w CDS jako zwykła akcja
OData (żeby front miał typy), ale jej handler **nie zwraca JSON-a OData**. Zamiast tego:

1. pisze bezpośrednio do **surowej odpowiedzi HTTP** (`req.http.res`) — ustawia nagłówki
   `text/event-stream` i wypisuje zdarzenia funkcją `sse(res, event, data)`;
2. po skończeniu woła `res.end()`;
3. **`return`** z handlera — co sygnalizuje CAP, żeby **nie próbował już serializować własnej odpowiedzi**
   (inaczej CAP dopisałby swój JSON do zamkniętego strumienia → błąd).

🧠 *Dlaczego tak?* CAP domyślnie sam buduje odpowiedź OData. Żeby streamować, „przejmujemy" surowy obiekt
odpowiedzi Node (`res`), piszemy ręcznie i mówimy CAP „już załatwione". To świadomy kompromis (nazwany w
kodzie „Plan A").

### Tryb degradacji (bez SSE)

Jeśli klient **nie** wyśle `Accept: text/event-stream`, handler nie streamuje — po zakończeniu generacji
zwraca zwykły JSON `{ advisorMessageId }` (albo `null`, gdy doradca milczał). UI dociąga wtedy treść
przez `getHistory()`. To ścieżka awaryjna; domyślna jest SSE.

---

## 5. Kontrakt i wymienność warstw

Cały sens architektury: **podmiana mock ↔ realne to zmiana jednej implementacji, nie refaktor UI/logiki.**
Pilnują tego dwa interfejsy w `shared/chat-contract.ts` (jedno źródło prawdy typów, importowane i przez
front, i przez backend).

### `ChatClient` (front)

```ts
interface ChatClient {
  startConversation(title?): Promise<ConversationMeta>;
  getHistory(id): Promise<ChatMessage[]>;
  sendMessage(req): AsyncIterable<ChatStreamEvent>;   // ← strumień zdarzeń
  getState(id): Promise<UiConversationState>;
  resolveParkedTopic(id, topicId, action): Promise<void>;
  setAdvisorMode(id, mode): Promise<void>;
}
```

Dwie implementacje: `httpChatClient` (realny SSE) i `mockChatClient` (offline). UI nie wie, której używa.

### `AdvisorService` (backend, warstwa AI)

```ts
interface AdvisorService {
  decide(history, state, context?): Promise<AdvisorDecision>;
  generateReply(history, context?, decision?): AsyncIterable<
    | { type: 'delta'; text }
    | { type: 'end'; text; finishReason; usage? }
  >;
}
```

Dwie implementacje: `anthropicAdvisor` (realny model) i `mockAdvisor` (reguły, 0 tokenów). Handler CAP
nie wie, której używa — wybiera ją `advisor.js` wg zmiennej `ADVISOR`.

🧠 *Async iterator / generator (`AsyncIterable`, `async function*`)*: to funkcja, która **„oddaje" wyniki
po kawałku w czasie** zamiast zwracać wszystko naraz. Konsument robi `for await (const ev of …)`. Tu
pasuje idealnie: model streamuje tokeny, a my je `yield`-ujemy jako `{type:'delta'}`, aż na końcu
`{type:'end'}`. Handler CAP po prostu iteruje i przepisuje je na zdarzenia SSE.

> **Dlaczego kształt zdarzeń jest „pod Anthropic":** SSE celowo odzwierciedla `messages.stream()` SDK,
> więc realna implementacja `generateReply` to cienki adapter: `content_block_delta`→`delta`,
> `finalMessage()`→`end`.

---

## 6. Silnik decyzji — `decide()`

`decide(history, state, context)` zwraca obiekt `AdvisorDecision` (typ, czy mówić, faza, `nextSpeaker`,
`composerHint`, `topic`, liczniki, `usage`). W trybie anthropic robi to **model**, nie kod.

### Structured output (JSON wg schematu)

🧠 *Structured output* to mechanizm, w którym model **gwarantowanie** zwraca JSON pasujący do podanego
schematu (`DECIDE_SCHEMA`). W SDK ustawiamy `output_config.format = { type: 'json_schema', schema }`.
Dzięki temu nie parsujemy „luźnego" tekstu — dostajemy przewidywalny obiekt. Prompt systemowy
`DECIDE_SYSTEM` opisuje rolę „reżysera" i kryteria każdego typu decyzji (w tym bezpieczeństwa).

### Podział ról: MODEL ocenia, KOD liczy

Kluczowa zasada projektowa: **model ocenia jakościowo, kod liczy deterministycznie.**

| Robi MODEL | Robi KOD (`finalizeDecision`) |
|---|---|
| typ decyzji, `shouldSpeak`, faza, `nextSpeaker`, kotwica, `composerHint`, ocena kryzysu/eskalacji | liczniki `turnsSinceProgress` / `escalationStreak`; wymuszenie `kind` wg typu; bezpiecznik pętli pogłębień; floor drzwi (§8) |

🧠 *Dlaczego kod liczy liczniki?* Modele językowe **słabo liczą i pilnują stanu** między wywołaniami.
Liczbę tur bez postępu czy rozpęd kłótni wyliczamy więc w kodzie z historii + typu decyzji, a nie ufamy,
że model „zapamięta". Podobnie `kind` (mała/duża dymka) wyznacza kod wg typu — bo zdarzało się, że model
oznaczał kryzys jako „małą dymkę".

### `finalizeDecision` — strażnicy

Po decyzji modelu kod nakłada deterministyczne korekty:
- **bezpiecznik pętli:** jeśli model chciałby pogłębiać po raz ≥3 z tą samą osobą → zmień na oddanie głosu
  (jeśli druga strona nie mówiła) lub parafrazę;
- **`kind`:** tylko `INTERVENE` = mała dymka; wszystko inne (w tym `SAFETY_STOP`) = pełna;
- **liczniki:** przeliczane wg typu i „substantywności" ostatniej wypowiedzi;
- **floor drzwi** (§8).

---

## 7. Generacja odpowiedzi — `generateReply()`

Streamuje dymkę doradcy. System prompt jest **warstwowy** — budowany jako tablica bloków:

```
system = [
  PERSONA            (cache_control: ephemeral)   ← stały, cache'owany prefiks
  nameSteer(ctx)                                   ← jak zwracać się do pary (imiona / Ty-Wy)
  audienceSteer(...)                               ← REJESTR EMPATII wg adresata (§8)
  DECISION_STEER[typ]                              ← krótka instrukcja celu tej tury
  parkSteer(...)?                                  ← gdy parkujemy dygresję
]
```

### Prompt caching (dlaczego `cache_control`)

🧠 *Prompt caching* (Anthropic): jeśli **początek** promptu się nie zmienia, model może go „zapamiętać" na
~5 min i liczyć taniej przy kolejnych wywołaniach (odczyt z cache ≈ 0.1× ceny wejścia). Dlatego długa,
stała `PERSONA` jest pierwszym blokiem z `cache_control: ephemeral`, a zmienne instrukcje (steer-y) idą
**po niej** — żeby nie psuć cache'owanego prefiksu.

### Pozostałe szczegóły

- **`thinking: disabled`** — wyłączone rozszerzone myślenie, żeby pierwszy token pojawiał się od razu
  (czat ma być szybki).
- **Mapowanie autora → rola:** wiadomości pary → rola `user` z prefiksem `[kobieta]/[mężczyzna]/[razem]`
  (albo imiona), dymki doradcy → rola `assistant`. Prefiks to wewnętrzna wskazówka „kto pisze".
- **Obsługa odmowy:** jeśli model zwróci `stop_reason: 'refusal'`, mapujemy to na `end` z
  `finishReason:'error'` i bezpiecznym tekstem.
- **Sanityzacja (`sanitizeAdvisor`):** zanim dymka trafi do bazy i UI, kod **twardo** usuwa markdown
  (`**`, `*`, `#`, `>`) i wiodące etykiety (`[On]:`). To gwarancja niezależna od tego, czy model posłuchał
  persony. (Uwaga: numerów telefonów **nie** usuwa — patrz bezpieczeństwo.)

---

## 8. Rejestr empatii wg płci + floor

Najnowsza warstwa. Cel: **to samo ciepło dla obojga, inna droga dojścia do emocji** (pełny opis
behawioralny w [FUNCTIONAL.md §6](FUNCTIONAL.md)). Technicznie składa się z trzech elementów.

### 8.1 Rejestr dymki (`audienceSteer`)

W `anthropicAdvisor.js`:
- `REGISTER` — trzy stałe instrukcje: `HER` (nazwij uczucie), `HIM` (wejście przez zdarzenie, walidacja
  wysiłku, bez tonu pouczającego), `TOGETHER` (most-tłumacz między dialektami).
- `replyAudience(decision, history)` — wylicza **adresata** dymki: typy do obojga (`SUMMARIZE`/`REFRAME`/
  `PROPOSE`/`CHOOSE`) → `TOGETHER`; `ASK_OTHER` → `nextSpeaker`; reszta → bieżący mówca.
- `audienceSteer(...)` — zwraca odpowiedni blok `REGISTER`, doklejany do `system[]`. **Zwraca `null` dla
  `SAFETY_STOP` i `INTERVENE`** → tor bezpieczeństwa/de-eskalacji jest symetryczny i nietknięty.

### 8.2 Drzwi wejścia w `composerHint` (prompt)

W `DECIDE_SYSTEM` jest reguła „płeć = domyślne drzwi": mężczyzna → domyślnie wejście przez zdarzenie (nie
„co czujesz"), kobieta → uczucie OK, styl osoby nadpisuje. Żeby działało też przy **własnych imionach**
(które ukrywają płeć), do `stateNote` w `modelDecide` dokładana jest **mapa płci** („kobieta = …, mężczyzna
= …").

### 8.3 Floor — deterministyczny strażnik na zimny start (wariant B)

Prompt to wciąż model (~80% posłuszeństwa zmierzone empirycznie). Żeby **start** był pewny, w
`finalizeDecision` działa floor:

```
jeśli (doradca mówi) i (composerHint pasuje do FEELING_PROBE, czyli „co czujesz")
   i (adresat = HIM)
   i (zimny start: mężczyzna ma ≤1 wypowiedź „z treścią"):
       podmień composerHint na wejście przez zdarzenie z EVENT_DOOR_BANK
```

Po ≥2 jego turach floor **milczy** — steruje sam prompt. Bramka „zimny start" jest **strukturalna**
(liczba tur, językowo neutralna) — wcześniej była tu krucha lista słów, usunięta po pomiarze A/B.

🧠 *Dlaczego stałe floora są w `decisionRules.js`, a nie obok kodu floora?* `FEELING_PROBE` i
`EVENT_DOOR_BANK` to **polskie** wzorce — siedzą obok innych PL-stałych (CRISIS/ESCALATION) dla spójności.
Różnica: większość tych regexów to **siatka awaryjna** (patrz §11), a floor **działa na żywym torze
modelu, co turę**. Floor jest PL-only: poza polskim trigger nie trafia → floor to cichy no-op (prompt
niesie całość), bez wstrzykiwania polskiego tekstu do obcej rozmowy. Wielojęzyczny upgrade („opcja C") =
zastąpić trigger etykietą drzwi od modelu i bank — hintem modelu w danym języku.

---

## 9. Model danych i persystencja

Model w `db/schema.cds` (namespace `couple.adviser`). Trzy encje:

### `Conversations` — sesja + **stan reżysera**

Oprócz `title`/`herName`/`hisName` trzyma cały stan silnika (żeby przeżył odświeżenie i restart):

| Pole | Rola |
|---|---|
| `phase` | bieżąca faza (miękki cel) |
| `topic` | kotwica tematu |
| `advisorMode` | `LEADING` / `PAUSED` (`LISTENING` istnieje w typie, ale jest nieużywany) |
| `turnsSinceProgress`, `escalationStreak` | liczniki pętli i eskalacji |
| `lastActivityAt` | znacznik aktywności (idle/heartbeat) |
| `model` | model AI użyty do generacji |
| `lastComposerHint` | ostatnia podpowiedź — by `decide` jej nie powtarzał |
| `decideInputTokens` … | tokeny warstwy DECYZJI (narastają co turę) |

### `Messages` — wiadomości

`seq` (monotoniczna kolejność, **jedyna** podstawa sortowania), `author`
(`HER`/`HIM`/`TOGETHER`/`ADVISOR`), `text`. Dla dymek doradcy dodatkowo: `kind`, `decisionType` i **tokeny
generacji**.

### `ParkedTopics` — „do omówienia później"

`text`, `status` (`OPEN`/`RESOLVED`/`DISMISSED`), `parkedAtSeq`.

🧠 *Projekcje CAP i pułapka `cds deploy`.* Usługa (`chat-service.cds`) wystawia encje jako `@readonly`
**projekcje** (`projection on db.…`) — to osobne widoki SQL nad tabelami bazowymi. Konsekwencja: **zmiana
schematu wymaga `cds deploy`**, bo regeneruje też te widoki. Sam ALTER tabeli nie wystarczy (widok
zostanie stary → „no such column"). **`cds deploy` czyści dane** — pamiętaj przy zmianach schematu.

---

## 10. Tokeny, koszt i rozliczanie

- **Generacja:** zdarzenie `end` z `generateReply` niesie `usage` (tokeny wejścia/wyjścia/cache). Handler
  zapisuje je w kolumnach na `Messages`.
- **Decyzja:** `decide` zwraca `usage` na decyzji; handler **dodaje** je narastająco do kolumn
  `decide*Tokens` na `Conversations` (bo `WAIT` nie tworzy wiadomości, a koszt powstał).
- **Cennik:** `models.js` to tabela `model → stawki` (in/out/cacheRead/cacheCreation za 1M tokenów) +
  `activeModel()` (z `ADVISOR_MODEL`). `pricing.js → costUsd(usage, model)` liczy dolary.
- **Raport:** funkcja `conversationUsage(id)` zwraca rozbicie **generacja vs decyzja** + `costUsd`.

🧠 *Dlaczego koszt rośnie „kwadratowo"?* `decide` (i generacja) wysyłają **całą historię** co turę. Im
dłuższa rozmowa, tym większe wejście każdego kolejnego wywołania → suma rośnie szybciej niż liniowo.
Optymalizacja (okno kontekstu / caching) jest świadomie odłożona — patrz ENGINE.md roadmapa.

---

## 11. Fallback i tryb mock

🧠 *Siatka awaryjna (fallback).* `anthropicAdvisor.decide` jest owinięte w `try/catch`. Gdy wywołanie
modelu padnie (timeout, zły JSON, błąd API), zamiast się wywrócić, kod **przełącza się na reguły**
(`decisionRules.decide`) — prosty silnik dopasowujący **polskie** wzorce (CRISIS → stop bezpieczeństwa,
ESCALATION → interwencja, itd.). Druga warstwa: handler ma jeszcze twardy default (`SUMMARIZE`), gdyby i
reguły zawiodły. Dzięki temu aplikacja **nigdy nie zamilknie** i wciąż złapie najbardziej oczywiste
sygnały — choć tylko po polsku (od wielojęzyczności jest model).

**Tryb mock** (`ADVISOR=mock`, domyślny) używa tych samych reguł jako **głównego** silnika — zero tokenów,
do dev/demo. `advisor.js` wybiera implementację leniwie (w trybie mock SDK Anthropic nie jest nawet
ładowany).

> **Duplikacja, o której trzeba wiedzieć:** reguły żyją w `decisionRules.js` (backend, CommonJS) i są
> **lustrzanie** powtórzone w `web/src/client/mockChatClient.ts` (front, TS) na potrzeby trybu offline —
> bo backend Node nie importuje TS, a front nie importuje CJS z `srv/`. **Zmieniasz reguły → zmień oba
> miejsca.**

---

## 12. Konfiguracja i uruchomienie

### Zmienne środowiskowe

Trzyma je plik **`couple-adviser.env`** (gitignored; szablon `couple-adviser.env.example`):

```ini
ADVISOR=anthropic            # mock | anthropic   (mock = 0 tokenów)
ADVISOR_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-... # wymagany tylko gdy ADVISOR=anthropic
```

🧠 *Jak ładuje się env.* `srv/server.js` wczytuje ten plik przez `dotenv` (ścieżką bezwzględną)
**zanim** załadują się usługi CAP — bo CAP sam tego nie robi, a klient Anthropic czyta klucz przy starcie.

### Dev (dwa procesy)

```
# backend (port 4004)
cd couple-adviser
npx cds deploy      # tylko za pierwszym razem (tworzy db.sqlite); UWAGA: ponowny deploy czyści dane
npx cds watch

# frontend (Vite, proxy /chat → :4004)
cd couple-adviser/web
npm install
npm run dev
```

Tryb front-only: `VITE_USE_MOCK=true` → UI działa bez backendu (mock streamingu).

---

## 13. Pułapki i świadome decyzje

| Pułapka / decyzja | Co trzeba wiedzieć |
|---|---|
| **`cds deploy` czyści dane** | Każda zmiana `schema.cds` (nawet pola) wymaga deploy → regeneruje widoki projekcji i **kasuje** dane dev. Zmiana samego *komentarza* w `.cds` — nie. |
| **`decide` co turę** | Odpala się ZAWSZE (też przy `WAIT`) → koszt wejścia rośnie kwadratowo. Świadome; optymalizacja odłożona. |
| **Reguły = tylko PL + tylko fallback/mock** | Nie rozbudowuj regexów pod inne języki — od wielojęzyczności jest model. Wyjątek: floor drzwi (PL, ale na żywym torze). |
| **Duplikacja reguł** | `decisionRules.js` ↔ `mockChatClient.ts` — zmieniaj OBA. |
| **better-sqlite3 na Node 24** | W root `package.json` jest `overrides: { "better-sqlite3": "^12" }` (^12 ma prebuildy dla Node 24 → bez kompilacji natywnej / VS Build Tools). |
| **Testy z polskimi znakami** | `curl` w Git Bash mangli diakrytyki (psuje testy regexów kryzysu) → testuj przez `node fetch`, nie `curl`. |
| **„Tylko słucha" = 0 modelu** | Handler robi krótkie spięcie (zapis + `message.user` + `end`) — celowo bez `decide`/detekcji. |

---

## 14. Mapa plików

| Plik | Rola |
|---|---|
| `shared/chat-contract.ts` | **jedno źródło prawdy** typów (decyzje, stan, zdarzenia, interfejsy) |
| `db/schema.cds` | model danych (stan reżysera, `ParkedTopics`, `Messages`) |
| `srv/chat-service.cds` | deklaracja usługi (encje read-only + akcje + funkcja) |
| `srv/chat-service.js` | **handler**: orkiestracja tury, SSE („Plan A"), persystencja, sanityzacja, koszty |
| `srv/server.js` | bootstrap — ładuje `couple-adviser.env` |
| `srv/advisor/advisor.js` | wybór implementacji AI wg `ADVISOR` (leniwy require) |
| `srv/advisor/anthropicAdvisor.js` | realny model: `decide` (structured output) + `generateReply` (streaming) + rejestr + floor |
| `srv/advisor/mockAdvisor.js` | mock generacji (kanned, 0 tokenów) |
| `srv/advisor/decisionRules.js` | regułowy `decide` — **fallback + mock** (PL); stałe floora |
| `srv/advisor/models.js` · `pricing.js` | tabela modeli→stawki, `activeModel()`, `costUsd()` |
| `web/src/hooks/useConversation.ts` | stan UI: wiadomości, status sceniczny, faza, parking, `lastDecision`, tryb |
| `web/src/components/ChatScreen.tsx` · `Composer.tsx` | render, przełącznik trybu, placeholdery, auto-autor |
| `web/src/client/httpChatClient.ts` | realny klient SSE (fetch + parser strumienia) |
| `web/src/client/mockChatClient.ts` | lustro reguł dla trybu offline (`VITE_USE_MOCK`) |

---

## 15. Słowniczek techniczny

| Termin | Wyjaśnienie |
|---|---|
| **SSE** | Server-Sent Events — strumień zdarzeń serwer→przeglądarka po jednym połączeniu HTTP; tu do streamingu tokenów. |
| **„Plan A"** | Pisanie SSE wprost do `req.http.res` + `res.end()` + `return`, żeby CAP nie dublował odpowiedzi. |
| **Structured output** | Wymuszenie, by model zwrócił JSON wg schematu (`output_config.format`); tu dla `decide`. |
| **Async iterator / generator** | Funkcja oddająca wyniki po kawałku w czasie (`async function*`, `for await`); tu streaming dymki. |
| **Prompt caching** | Cache stałego prefiksu promptu (~5 min) → tańsze odczyty; stąd `cache_control` na `PERSONA`. |
| **`decide` / `generateReply`** | Dwa kroki silnika: cicha decyzja „czy/jak mówić" oraz generacja dymki (tylko gdy `shouldSpeak`). |
| **`finalizeDecision`** | Deterministyczne strażniki na wynik modelu (liczniki, `kind`, bezpiecznik pętli, floor). |
| **Floor (drzwi)** | Strażnik w kodzie podmieniający męskie „co czujesz" na wejście przez zdarzenie na zimnym starcie. |
| **Fallback / siatka awaryjna** | Reguły regexowe (PL) używane tylko, gdy model padnie; w trybie mock — główny silnik. |
| **Projekcja CAP** | Widok SQL nad tabelą bazową; zmiana schematu wymaga `cds deploy` (czyści dane). |
| **`substantive`** | Wypowiedź „z treścią" (≥40 znaków, nie krótka negacja) — zeruje licznik pętli, napędza tempo. |
| **Kotwica (`topic`)** | Krótkie „o czym rozmawiamy", utrzymywane między turami. |
