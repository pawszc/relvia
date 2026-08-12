# relvia

Czat, w którym **para rozmawia z empatycznym AI‑doradcą relacji z jednego urządzenia**.
Ona / On piszą naprzemiennie (albo „Razem"), a doradca jest **reżyserem rozmowy** — zawsze ją
analizuje, ale odzywa się tylko wtedy, gdy to pomaga (nie po każdej wiadomości).

> Aplikacja webowa. **To nie jest produkt SAP i nie idzie na BTP** — CAP jest użyty jako zwykły
> backend Node. Cel: publiczna strona www (monolit — CAP serwuje zbudowany frontend).

## Dokumentacja

Cała dokumentacja jest w katalogu **[`doc/`](doc/)** (poza tym README):

- **[doc/FUNCTIONAL.md](doc/FUNCTIONAL.md)** — dokumentacja funkcjonalna: jak aplikacja się zachowuje (dla osób produktowych, testerów, nowych w zespole).
- **[doc/TECHNICAL.md](doc/TECHNICAL.md)** — specyfikacja techniczna: jak to jest zbudowane, z wyjaśnieniami pojęć (dla developera junior/mid).
- **[doc/ENGINE.md](doc/ENGINE.md)** — silnik rozmowy („reżyser"): cele, typy decyzji, fazy, pogłębianie, kompozytor, rejestr empatii wg płci, roadmapa.
- **[doc/CONTRACT.md](doc/CONTRACT.md)** — protokół usługi CAP: akcje, `accessToken`, zdarzenia SSE, AdminService.
- **[doc/SAFETY.md](doc/SAFETY.md)** — bezpieczeństwo: detekcja kryzysu, ochrona dostępu (capability token + admin), dławiki, świadome kompromisy.
- **[doc/PRODUCTION.md](doc/PRODUCTION.md)** — gotowość produkcyjna i dług: must-do przed startem + backlog (skala, RODO, observability).

## Architektura

```
web/  (React + Vite + TS)  ──/chat (akcje + SSE; capability token)──▶  CAP (Node/JS) ──▶ SQLite (db.sqlite)
                                                       /admin (OData, za bearer)──▶        └─▶ Anthropic SDK (Haiku)
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

Sekrety i tryb trzyma plik **`relvia.env`** (gitignored). Skopiuj szablon i uzupełnij:

```
cp relvia.env.example relvia.env
```

```ini
ADVISOR=anthropic            # mock | anthropic  (mock = 0 tokenów)
ADVISOR_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-... # wymagany tylko gdy ADVISOR=anthropic
```

Plik wczytuje [`srv/server.js`](srv/server.js) (dotenv) zanim załadują się usługi — CAP nie robi tego sam.

## Języki (i18n)

Relvia działa w trzech językach: **polski (`pl`, domyślny), angielski (`en`), niemiecki (`de`)**.
Polska treść jest bazą znaczeniową; niemiecki konsekwentnie nieformalny (du / ihr–euch).

- **Jedno źródło prawdy locale:** [`shared/locales.mjs`](shared/locales.mjs) — lista języków,
  `normalizeLocale()` (warianty regionalne: `pl-PL→pl`, `en-US/GB→en`, `de-DE/AT/CH→de`;
  nieobsługiwane → `null`/fallback `pl`). Frontend importuje go przez alias `@shared`,
  backend przez `require()` (Node ≥ 22.12 wspiera require-ESM).
- **Kolejność wyboru języka** (frontend, `web/src/i18n/locale.ts`):
  1. jawny wybór użytkownika z localStorage (klucz **`relvia.locale.v1`** — zapisywany
     TYLKO z przełącznika, nigdy z auto-detekcji),
  2. `navigator.languages` (w kolejności preferencji),
  3. `navigator.language`,
  4. fallback **`pl`**.
- **Przełącznik** w nagłówku (Polski / English / Deutsch) — zmiana bez przeładowania,
  nie resetuje rozmowy, ustawia `<html lang>`; historyczne wiadomości NIE są tłumaczone.
- **Tłumaczenia UI:** i18next + react-i18next, zasoby w
  [`web/src/i18n/locales/{pl,en,de}.json`](web/src/i18n/locales/) (init synchroniczny w
  `main.tsx` — bez błysku złego języka). **Nowy język** = wpis w `SUPPORTED_LOCALES` +
  nowy plik `xx.json` (identyczny zestaw kluczy — pilnuje test) + teksty w
  `srv/advisor/texts.js` + dyrektywy językowe w `anthropicAdvisor.js`.
- **Locale → backend/AI:** frontend dokłada `locale` do `startConversation`, `sendMessage`
  i `setAdvisorMode`; backend waliduje (nieznane → `pl`), zapisuje na `Conversations.locale`
  (wartość z requestu ma pierwszeństwo — zmiana języka obowiązuje od następnej odpowiedzi)
  i przekazuje do promptów (`persona(locale)` / `decideSystem(locale)`) jako deterministyczną
  dyrektywę języka odpowiedzi. Stary klient bez `locale` = `pl`. Deterministyczne komunikaty
  (pożegnanie przy pauzie, notka budżetowa, fallback odmowy) mają zatwierdzone wersje
  pl/en/de w [`srv/advisor/texts.js`](srv/advisor/texts.js). Błędy API idą jako stabilne
  KODY (np. `RATE_LIMIT`), tłumaczone przez frontend.
- ⚠ Numery pomocowe (112, 116 123, 800 120 002) są zweryfikowane dla **Polski** — wersje
  en/de mówią to wprost; przy wejściu na inny rynek wymagają przeglądu (SAFETY.md).

### Testy i18n

- **Deterministyczne (0 tokenów, uruchamiane w `npm run test:all` i CI):** wybór języka,
  rekurencyjna kompletność zasobów, komponenty/scenariusze przeglądarkowe (Vitest + jsdom;
  repo nie ma osobnego narzędzia E2E), kontrakt locale w backendzie
  (`test/integration/locale.test.js` — warstwa AI w pełni zamockowana).
- **Live (OPT-IN, płatne):** `RUN_LIVE_AI_TESTS=true npm run test:ai:i18n:live` —
  maks. **3 wywołania** (1 scenariusz/język) na realnym modelu aplikacji, z twardym
  limitem **3.00 USD** (env `LIVE_AI_BUDGET_USD` może limit tylko obniżyć). Przed każdym
  wywołaniem konserwatywna wycena worst-case; ocena języka lokalną heurystyką (bez
  drugiego modelu). NIE uruchamiają się w `npm test` ani w CI; bez `RUN_LIVE_AI_TESTS`
  lub klucza kończą się bez wywołań (koszt 0 USD).

## Uruchomienie (dev — 2 procesy)

**Backend** (port 4004):
```
cd relvia
npx cds deploy      # tylko za pierwszym razem (tworzy db.sqlite); UWAGA: ponowny deploy czyści dane
npx cds watch
```

**Frontend** (Vite, proxy `/chat` → `:4004`):
```
cd relvia/web
npm install
npm run dev
```

> Zmiana schematu (`db/schema.cds`) wymaga `npx cds deploy` (regeneruje też widoki projekcji) — **czyści dane**.

### Tryb bez backendu (front‑only)

Front ma wbudowany mock klienta. Z `VITE_USE_MOCK=true` działa **bez** CAP i bez tokenów
(symulowany streaming) — przydatne do pracy nad UI.

## Struktura

```
relvia/
├─ doc/                     # cała dokumentacja (FUNCTIONAL/TECHNICAL/ENGINE/CONTRACT/SAFETY/PRODUCTION)
├─ db/schema.cds            # model danych (stan reżysera, accessToken, budgetReached, ParkedTopics, Messages, UsageEvents)
├─ srv/
│  ├─ chat-service.cds/.js  # usługa CAP: akcje + SSE + persystencja + dostęp (assertAccess) + dławiki
│  ├─ admin-service.cds     # AdminService (/admin) — pełny OData read-only bazy
│  ├─ admin-auth.js         # bramka /admin (bearer token)
│  ├─ rate-limit.js         # dławik nowych rozmów (odstęp + limit godzinowy)
│  ├─ server.js             # bootstrap (relvia.env + /health + /admin)
│  └─ advisor/              # warstwa AI: advisor.js (wybór), anthropicAdvisor.js, mockAdvisor.js,
│                           #   decisionRules.js (fallback+mock), models.js, pricing.js, config.js (progi/flagi)
├─ shared/chat-contract.ts  # wspólny kontrakt typów (front + backend)
└─ web/                     # frontend React + Vite
```

## Koszty / tokeny

`decide` woła model **co turę** (też gdy doradca milczy) → wejście rośnie kwadratowo w długiej rozmowie
(kandydat do optymalizacji). Funkcja `conversationUsage` rozbija koszt na generację vs decyzję (`costUsd`).

## Przed publikacją

Pełna lista gotowości i długu: **[doc/PRODUCTION.md](doc/PRODUCTION.md)**. W skrócie — zrobione: ochrona dostępu
(capability token + AdminService), budżety + globalny limit, rate-limity, dławiki, anti-injection, disclaimer
kryzysowy. Zostało głównie: **polityka prywatności**, **wdrożenie** (host z trwałym procesem Node + wolumen na
SQLite; statyczny/serverless nie nadaje się na backend), oraz dług na skalę (Postgres/Redis, observability).
