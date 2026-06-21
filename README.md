# Couple Adviser — „wspólnie"

Czat, w którym **para rozmawia z empatycznym AI‑doradcą relacji z jednego urządzenia**.
Ona / On piszą naprzemiennie (albo „Razem"), a doradca jest **reżyserem rozmowy** — zawsze ją
analizuje, ale odzywa się tylko wtedy, gdy to pomaga (nie po każdej wiadomości).

> Aplikacja webowa. **To nie jest produkt SAP i nie idzie na BTP** — CAP jest użyty jako zwykły
> backend Node. Cel: publiczna strona www (monolit — CAP serwuje zbudowany frontend).

## Dokumentacja

- **[FUNCTIONAL.md](FUNCTIONAL.md)** — dokumentacja funkcjonalna: jak aplikacja się zachowuje (dla osób produktowych, testerów, nowych w zespole).
- **[TECHNICAL.md](TECHNICAL.md)** — specyfikacja techniczna: jak to jest zbudowane, z wyjaśnieniami pojęć (dla developera junior/mid).
- **[ENGINE.md](ENGINE.md)** — silnik rozmowy („reżyser"): cele, typy decyzji, fazy, pogłębianie, kompozytor, rejestr empatii wg płci, roadmapa.
- **[CONTRACT.md](CONTRACT.md)** — protokół usługi CAP: encje, akcje, zdarzenia SSE.
- **[SAFETY.md](SAFETY.md)** — postawa bezpieczeństwa: detekcja kryzysu, świadome kompromisy.

## Architektura

```
web/  (React + Vite + TS)  ──/chat (OData + akcje + SSE)──▶  CAP (Node/JS) ──▶ SQLite (db.sqlite)
                                                                  └─▶ Anthropic SDK (Haiku)
```

- **Frontend:** React 18 + Vite + TypeScript ([`web/`](web/)). Wariant wizualny „A4".
- **Backend:** SAP CAP (Node, JS) — custom akcje + **streaming SSE** (`sendMessage` pisze do `req.http.res`).
- **Baza:** SQLite na pliku (`db.sqlite`).
- **AI:** Anthropic SDK bezpośrednio. Domyślny model **`claude-haiku-4-5`** dla obu kroków (`decide` + generacja).
  Warstwa AI za interfejsem `AdvisorService` — przełączana flagą `ADVISOR=mock|anthropic`.
- **Kontrakt** (jedno źródło prawdy typów): [`shared/chat-contract.ts`](shared/chat-contract.ts).

## Wymagania

- Node.js (projekt rozwijany na Node 24).
- Konto Anthropic z kredytami API (tylko do trybu `anthropic`) — klucz z `console.anthropic.com`
  (osobne od subskrypcji claude.ai; subskrypcji nie da się użyć programowo).

## Konfiguracja środowiska

Sekrety i tryb trzyma plik **`couple-adviser.env`** (gitignored). Skopiuj szablon i uzupełnij:

```
cp couple-adviser.env.example couple-adviser.env
```

```ini
ADVISOR=anthropic            # mock | anthropic  (mock = 0 tokenów)
ADVISOR_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-... # wymagany tylko gdy ADVISOR=anthropic
```

Plik wczytuje [`srv/server.js`](srv/server.js) (dotenv) zanim załadują się usługi — CAP nie robi tego sam.

## Uruchomienie (dev — 2 procesy)

**Backend** (port 4004):
```
cd couple-adviser
npx cds deploy      # tylko za pierwszym razem (tworzy db.sqlite); UWAGA: ponowny deploy czyści dane
npx cds watch
```

**Frontend** (Vite, proxy `/chat` → `:4004`):
```
cd couple-adviser/web
npm install
npm run dev
```

> Zmiana schematu (`db/schema.cds`) wymaga `npx cds deploy` (regeneruje też widoki projekcji) — **czyści dane**.

### Tryb bez backendu (front‑only)

Front ma wbudowany mock klienta. Z `VITE_USE_MOCK=true` działa **bez** CAP i bez tokenów
(symulowany streaming) — przydatne do pracy nad UI.

## Struktura

```
couple-adviser/
├─ db/schema.cds            # model danych (stan reżysera, ParkedTopics, Messages)
├─ srv/
│  ├─ chat-service.cds/.js  # usługa CAP: akcje + SSE + persystencja
│  ├─ server.js             # bootstrap (wczytuje couple-adviser.env)
│  └─ advisor/              # warstwa AI: advisor.js (wybór), anthropicAdvisor.js,
│                           #   mockAdvisor.js, decisionRules.js (fallback+mock), models.js, pricing.js
├─ shared/chat-contract.ts  # wspólny kontrakt typów (front + backend)
└─ web/                     # frontend React + Vite
```

## Koszty / tokeny

`decide` woła model **co turę** (też gdy doradca milczy) → wejście rośnie kwadratowo w długiej rozmowie
(kandydat do optymalizacji). Funkcja `conversationUsage` rozbija koszt na generację vs decyzję (`costUsd`).

## Przed publikacją (TODO)

- Rate limiting / ochrona publicznego endpointu.
- Wdrożenie monolitu: host z **trwałym procesem Node** (SSE = długie połączenie) i **systemem plików**
  (SQLite). Hosty statyczne/serverless nie nadają się na backend (pod sam SPA owszem).
- Ewentualnie SQLite → Postgres przy większym ruchu.
