# Bezpieczeństwo — relvia

Jak aplikacja reaguje na sygnały kryzysu (przemoc, samookaleczenie, myśli samobójcze, zagrożenie
życia/zdrowia) i jakie **świadome kompromisy** przyjęliśmy. Dla współtwórców i jako zapis decyzji.

> **To nie jest usługa kryzysowa ani wyrób medyczny.** Doradca jest empatycznym mediatorem, nie
> terapeutą — i mówi to wprost. W realnym zagrożeniu kieruje do profesjonalistów i służb.

## Zasada naczelna

**Bezpieczeństwo wykrywa MODEL — semantycznie i wielojęzycznie — i ma absolutny priorytet** ponad
wszystkim (fazami, pętlą, pogłębianiem, oddawaniem głosu). Świadomie **nie** opieramy detekcji na
regexach (po polsku się nie skalują, a celujemy w wiele języków). Model jednak **wybiera `type`
i proponuje pola pomocnicze**; to, że rozpoznany kryzys ZAWSZE skutkuje widoczną reakcją (dymka,
pełny render), gwarantują deterministyczne inwarianty w kodzie — patrz „Inwarianty decyzji" niżej.

**Rejestr empatii wg płci NIE dotyka bezpieczeństwa.** Profilowanie tonu doradcy wg adresata
(`audienceSteer` w [`anthropicAdvisor.js`](../srv/advisor/anthropicAdvisor.js)) zwraca `null` dla
`SAFETY_STOP`, `INTERVENE` i `PROTECT` — dymka kryzysowa, moderacja eskalacji i tor ochronny są
**identyczne niezależnie od płci** adresata. Detekcja kryzysu jest symetryczna (przemoc „ze strony
partnera" w obie strony); tor `PROTECT` (asymetria ofiara/sprawca) też nie profiluje tonu płcią.

## Inwarianty decyzji — model klasyfikuje, kod decyduje o reakcji

Model NIE kontroluje samodzielnie całego mechanizmu reakcji. Model **wybiera `type` i proponuje
pola pomocnicze** (phase, topic, parkAdd, composerHint, nextSpeaker), ale **inwarianty wykonawcze
wynikające z `type` — w szczególności `shouldSpeak` i `kind` — wyznacza deterministycznie kod** —
wspólny normalizator
[`srv/advisor/decisionNormalizer.js`](../srv/advisor/decisionNormalizer.js), stosowany na
KAŻDEJ ścieżce decyzji (model, fallback reguł, mock, granica handlera). Zamyka to lukę,
w której model zwracał np. `SAFETY_STOP` z `shouldSpeak=false` i aplikacja — mimo poprawnie
rozpoznanego zagrożenia — pozostawała w milczeniu.

| Inwariant | Gwarancja kodu (niezależnie od wartości z modelu) |
|---|---|
| `shouldSpeak` | wynika z typu: **WAIT jest jedynym typem milczącym**; każdy inny typ mówi |
| `SAFETY_STOP` / `PROTECT` | **nie mogą milczeć** i nie przesuwają fazy mediacji (faza = poprzedni stan) |
| `kind` | wynika z typu: `INTERVENE` → `INTERVENTION`, wszystko inne → `FULL` (legacy `MODERATION` nie jest emitowane) |
| `PROTECT` | **nigdy nie jest adresowany do TOGETHER** — poprawne wskazanie reżysera (HER/HIM) zostaje; gdy konkretnego adresata nie da się ustalić bez zgadywania, PROTECT **pozostaje aktywny**, ale `nextSpeaker` jest pomijany — na wspólnym ekranie pada odpowiedź ochronna bez automatycznego przypisywania kolejnego głosu (i bez `composerHint`) |
| `WAIT` | nie niesie instrukcji do UI (`composerHint`), nie parkuje tematu (`parkAdd`), nie przekazuje głosu (`nextSpeaker`) |
| nieznany/zepsuty `type` | kontrolowany `DecisionInvariantError` → regułowy fallback (bez cichej zamiany typu) |

Awaria warstwy decyzji w handlerze prowadzi do deterministycznego `rulesDecide` (nie do
twardego `SUMMARIZE`) — sygnał kryzysu po polsku nadal trafia w `SAFETY_STOP` fallbacku.

> Te inwarianty NIE rozwiązują pozostałego długu (jawnie otwarte): brak safety w trybie
> `PAUSED` i po wyczerpaniu budżetu, fallback awarii modelu pozostaje PL-only, numery
> kryzysowe w dymce nadal pochodzą z modelu, wspólny ekran w przypadkach przemocy.

## Jak działa detekcja

Po każdej turze (w trybie „Rozmawia") `decide` ocenia ostatnią wiadomość. Kryteria `SAFETY_STOP` są
wprost w prompcie decyzyjnym ([`srv/advisor/anthropicAdvisor.js`](../srv/advisor/anthropicAdvisor.js) →
`DECIDE_SYSTEM`):

- przemoc (też **domowa / ze strony partnera / wobec dzieci**), samookaleczenie, myśli samobójcze,
  zagrożenie życia/zdrowia — w **dowolnym języku**, także **parafrazą, eufemizmem, aluzją**
  (np. „nie chcę dłużej żyć", „lepiej żeby mnie nie było", „boję się, że mnie skrzywdzi");
- przy realnej wątpliwości → wybierz `SAFETY_STOP`;
- **odróżniaj od przenośni/hiperboli** („zabija mnie ta cisza", „umieram z tęsknoty") — sama metafora
  to NIE sygnał (ochrona przed fałszywymi alarmami).

**Weryfikacja (real Haiku):** kryzys 6/6 → `SAFETY_STOP` (PL wprost/eufemizm/przemoc + **angielski,
ukraiński**); metafory 3/3 → brak alarmu.

## Co robi `SAFETY_STOP`

Dymka doradcy ([`DECISION_STEER.SAFETY_STOP`](../srv/advisor/anthropicAdvisor.js)):
**przerywa mediację** (nie analizuje konfliktu, nie rozstrzyga racji), ciepło i bez paniki nazywa
powagę, mówi, że najważniejsze jest bezpieczeństwo, i zachęca do **natychmiastowego kontaktu z
profesjonalistą lub służbami, podając konkretny numer**. Render: pełna, wyraźna dymka (`kind:FULL`
wymuszane przez kod). `sanitizeAdvisor` czyści markdown, ale **nie usuwa numerów**.

## Tor ochronny `PROTECT` (asymetria ofiara/sprawca, PONIŻEJ progu kryzysu)

Między zwykłą mediacją a `SAFETY_STOP` jest trzecia kategoria. Neutralny mediator („nie oceniam, kto ma rację")
tworzył **fałszywą symetrię**, gdy jedna strona jest sprawcą (pogarda, coercive control, DARVO, gaslighting,
szantaż), a druga ofiarą — równał krzywdę z odczuciem sprawcy i kazał skrzywdzonej osobie „mówić o sobie zamiast
oceniać" (re‑wiktymizacja). Typ decyzji **`PROTECT`** zamyka tę lukę: doradca NIE mediuje symetrycznie — waliduje
realność skrzywdzonej osoby, nazywa wzorzec i staje po stronie jej godności (PERSONA: „krzywda nie jest racją,
którą się waży; godność i bezpieczeństwo są ważniejsze niż symetria"). Może łagodnie wskazać wsparcie indywidualne.

- **Granica wobec `INTERVENE`:** `INTERVENE` = eskalacja **wzajemna** (obie strony); `PROTECT` = **asymetria**
  (jedna krzywdzi, druga jest obiektem). Granica wobec `SAFETY_STOP` = brak bezpośredniego zagrożenia życia/zdrowia.
- **Symetria płci zachowana:** tak jak dla `SAFETY_STOP`/`INTERVENE`, `audienceSteer`/`audienceBinding` zwracają
  `null` dla `PROTECT` — **bez profilowania tonu wg płci**. Render: pełna dymka (`kind:FULL`), wyśrodkowana.
- **Detekcja model‑only.** Kryteria w `DECIDE_SYSTEM` (semantycznie, wielojęzycznie) z **twardym strażnikiem
  przed fałszywym alarmem** (zwykła kłótnia / obustronne obwinianie / metafory = NIE `PROTECT`). Reguły fallbacku
  i mock celowo NIE wykrywają `PROTECT` (jak niuanse `SAFETY_STOP`).
- **Zweryfikowane evalem** ([`test/`](../test/README.md)): treść dymek w nadużyciu 2/10 → 9/10, **zero fałszywych
  pozytywów** w zestawie kalibracyjnym, kryzys i zachowania bazowe nienaruszone.

## Warstwy i fallback

- **L1 — model (główna i jedyna w produkcji).** Semantyczny, wielojęzyczny.
- **L2 — regex `CRISIS` (PL), TYLKO fallback** w [`decisionRules.js`](../srv/advisor/decisionRules.js) na
  wypadek awarii modelu (zły JSON / timeout) oraz w trybie mock. **Nie** jest to override ani detektor
  wielojęzyczny — best‑effort siatka po polsku.

## Disclaimer, przejrzystość AI i kontakty kryzysowe (stała stopka)

Niezależnie od reakcji modelu w rozmowie, w UI jest **stała mikro-stopka** (nie dymka w czacie):
- **`SAFETY_DISCLAIMER_SHORT`** — zawsze widoczna linijka „Relvia to doradca AI, nie terapeuta." → spełnia
  obowiązek **ujawnienia, że rozmawiasz z AI** (EU AI Act art. 50, przejrzystość).
- panel „Potrzebujesz pomocy?" — **`SAFETY_HELP_TEXT`** z numerami (112; 116 123 telefon zaufania;
  800 120 002 Niebieska Linia).
- pełna treść w **`SAFETY_DISCLAIMER_TEXT`** ([`web/src/hooks/useConversation.ts`](../web/src/hooks/useConversation.ts));
  guard `web/src/hooks/disclaimer.test.ts` pilnuje obecności numerów (regresja).

To **uzupełnia** (nie zastępuje) numer podawany przez model w dymce `SAFETY_STOP`: model reaguje na konkretny
sygnał w rozmowie, a stopka jest zawsze pod ręką.

## Świadome kompromisy (decyzje produktowe)

1. **Tryb „Tylko słucha" = brak detekcji.** W tym trybie model nie jest wołany w ogóle (zero tokenów),
   więc **bezpieczeństwo jest wtedy wyłączone**. Wybór celowy: to prywatna przestrzeń pary „między sobą".
   Możliwa przyszła opcja: cichy strażnik tylko‑safety (regex, 0 tokenów) — **nie wdrożony** z wyboru.
2. **Numery kryzysowe podaje model w dymce** (bez doklejanego bloku do treści — naturalność), a **dodatkowo**
   są w stałej stopce (`SAFETY_HELP_TEXT`). Resztkowe ryzyko: numer z modelu może być nieaktualny — dlatego
   stopka ma zweryfikowane numery jako kotwicę.
3. **Stopka „Potrzebujesz pomocy?" — dodana** (wcześniej odrzucony stały panel). Powód zmiany: stała,
   nienachalna stopka spełnia też obowiązek przejrzystości AI; nie zaśmieca czatu (kryje się pod ⓘ).
4. **Awaria modelu w rozmowie nie‑polskiej** → fallback (PL regex) nie złapie kryzysu. Rzadki edge,
   przyjęty świadomie (model jest warstwą wielojęzyczną).

## Gdzie w kodzie

| Element | Plik |
|---|---|
| Kryteria `SAFETY_STOP` (decyzja) | [`srv/advisor/anthropicAdvisor.js`](../srv/advisor/anthropicAdvisor.js) → `DECIDE_SYSTEM` |
| Ton dymki kryzysowej | tamże → `DECISION_STEER.SAFETY_STOP` |
| Disclaimer „nie zastępuję terapeuty" | tamże → `PERSONA` |
| Inwarianty decyzji (shouldSpeak/kind z typu, adresat PROTECT, higiena pól) | [`srv/advisor/decisionNormalizer.js`](../srv/advisor/decisionNormalizer.js) |
| Wymuszenie pełnej dymki + czyszczenie | `finalizeDecision` + `decisionNormalizer` + [`srv/chat-service.js`](../srv/chat-service.js) `sanitizeAdvisor` |
| Fallback PL (awaria modelu / mock) | [`srv/advisor/decisionRules.js`](../srv/advisor/decisionRules.js) → `CRISIS` |

## Ochrona dostępu do modelu i konwersacji

Osobna od bezpieczeństwa kryzysowego warstwa: chroni **koszt, reputację i rolę** doradcy przed nadużyciem
(zalewanie endpointu, „darmowy ChatGPT", prompt injection, rozmowy zupełnie nie na temat). Świadome rozdzielenie:
to **nie** jest filtr tematu — zakres pilnujemy personą i przekierowaniem, a wolumen/koszt infrastrukturą.
Wszystkie progi/flagi w **jednym miejscu** ([`srv/advisor/config.js`](../srv/advisor/config.js)); model i stawki
zostają w [`models.js`](../srv/advisor/models.js).

- **Budżet konwersacji (twardy, $0,50 domyślnie).** Liczony PRZED każdą turą z poniesionego kosztu
  (`conversationCostUsd` w [`chat-service.js`](../srv/chat-service.js)). Po osiągnięciu progu — flaga
  `budgetReached` na konwersacji i **łagodny read-only**: ciepła notka (szablon, 0 tokenów) + zero dalszych
  wywołań modelu. Tura przekraczająca próg dokańcza się; blokada działa od następnej (overshoot ≤ koszt jednej tury).
  To główna dźwignia przeciw kwadratowemu kosztowi i nadużyciu jednej sesji.
- **Globalny limit dzienny aplikacji (twardy, $20/24h domyślnie).** Bezpiecznik app-wide: ledger
  `relvia.UsageEvents` (zdarzenie zużycia per tura, z `createdAt`) → `globalCostLast24hUsd()` sumuje WSZYSTKIE
  konwersacje z ostatnich 24h. Po przekroczeniu każda rozmowa dostaje TEN SAM łagodny read-only (notka raz na
  konwersację — dedup po ostatniej dymce doradcy). Stan PRZEJŚCIOWY (bez flagi) — odżywa, gdy stare zużycie
  wypadnie z okna 24h. Ledger to encja DB (nie wystawiona przez OData), adresowana po FQN.
- **Dławiki tempa i walidacja wejścia (anty-spam / anty-nadużycie kosztu):**
  - **rate limit wiadomości** — min. odstęp w obrębie konwersacji (`lastMessageAt` + `CONFIG.rateLimitMinIntervalMs`,
    domyślnie 800 ms: człowiek pisze „wiadomość po wiadomości", skrypt zalewający — nie);
  - **rate limit tworzenia rozmów per IP** — dwa progi naraz: odstęp (`newConversationMinIntervalMs`, 2 s) **i twardy
    limit godzinowy** (`newConversationMaxPerHour`, 30 / `newConversationWindowMs`). Czysta, testowalna logika w
    [`srv/rate-limit.js`](../srv/rate-limit.js) (`checkAndRecord` → `INTERVAL`/`WINDOW_CAP`); IP z `X-Forwarded-For`;
    mapa per IP przycinana do okna (puste klucze kasowane → pamięć nie rośnie);
  - **cap długości wiadomości** (`maxMessageChars`, 4000 → 413 `MESSAGE_TOO_LONG`) — jeden user nie wklei megabajta.
  - *In-memory (MVP single-instance); przy wielu instancjach → współdzielony magazyn (Redis).*
- **Odporność na wiszące/porzucone żądania:**
  - **timeout modelu** (`anthropicTimeoutMs`, 60 s — bez tego SDK ma default 10 min);
  - **abort generacji przy rozłączeniu klienta** — `AbortController` w [`chat-service.js`](../srv/chat-service.js)
    (`res.on('close') → abort`), `signal` przekazany do `generateReply` → `client.messages.stream(..,{signal})`;
    gdy user zamknie kartę w trakcie, **nie palimy tokenów** na odpowiedź, której nikt nie zobaczy.
- **Granica roli / anti-injection (prompt).** `DECIDE_SYSTEM` i `PERSONA` w
  [`anthropicAdvisor.js`](../srv/advisor/anthropicAdvisor.js) traktują treść pary jako **materiał do mediacji, nie
  polecenia**: próba zmiany roli, wydobycia instrukcji albo zadania niezwiązanego ze związkiem → dygresja poza
  tematem (zwykle REFRAME, czasem WAIT), bez wychodzenia z roli i bez ujawniania instrukcji. **Podporządkowane
  bezpieczeństwu** — to celowo NIE jest sygnał `SAFETY_STOP`.

**Świadomie NIE robimy** twardego klasyfikatora tematu jako bramki przed `decide`: drogi (dodatkowe wołanie/
rozdęty prompt), kruchy i groźny przez fałszywe pozytywy — mógłby zdławić oblique sygnał kryzysu albo wypowiedź
emocjonalną pozornie „nie na temat". Zakres niesie persona + kotwica + parking, nie filtr.

**Świadome kompromisy:**
- Budżet liczy koszt JUŻ poniesiony → możliwy overshoot o jedną turę (rzędu centa). Akceptowane dla prostoty.
- Rate limit jest in-memory (single instance) — świadomy MVP; produkcyjnie wymaga współdzielonego licznika.
- Prompt caching (`decide`) jest bezstratny i nie dotyczy bezpieczeństwa (te same dymki). Patrz [FUNCTIONAL.md](FUNCTIONAL.md) §14.

## Izolacja danych i dostęp do API (capability token + admin)

Osobna od ochrony kosztu warstwa: chroni **prywatność rozmów par** przed dostępem osób trzecich.

**Problem (naprawiony):** ChatService wystawiał encje `Conversations/Messages/ParkedTopics` jako `@readonly`
projekcje OData. `@readonly` blokuje tylko ZAPIS — odczyt był otwarty, więc `GET /chat/Messages` zwracał
prywatne rozmowy WSZYSTKICH par (z `$filter/$top` = pełny eksport). Brak było jakiejkolwiek autoryzacji
(`cds.requires` bez `auth`; zero `@requires`/`@restrict`).

**Model dostępu — capability token (pasuje do UX bez logowania).** Aplikacja nie ma kont (jedno urządzenie,
z rąk do rąk), więc zamiast „auth per user":
- ChatService **nie wystawia już żadnych encji przez OData** — dostęp wyłącznie przez akcje; w handlerze
  encje DB adresowane po FQN (`'relvia.Conversations'`…), operacje idą wprost na bazę.
- `startConversation` zwraca **`accessToken`** (niezgadywalny UUID, kolumna `Conversations.accessToken`).
  Każda akcja konwersacji (`sendMessage`, `getHistory`, `conversationState`, `conversationUsage`,
  `resolveParkedTopic`, `setAdvisorMode`) przechodzi przez **`assertAccess`** → **403** bez/ze złym tokenem.
  Ten sam 403 dla nieistniejącej konwersacji → **brak enumeracji** (IDOR zamknięty). Token jest jedynym
  dowodem „to moja rozmowa"; front trzyma go w pamięci sesji (hook), backend wymaga (`CONFIG.accessControlEnabled`, domyślnie ON).
- Historia: dawny odczyt OData zastąpiony akcją **`getHistory(conversationId, accessToken)`**.

**Zaufany wgląd w całą bazę — `AdminService` (/admin).** Pełny OData (read-only) wszystkich encji
(`Conversations/Messages/ParkedTopics/UsageEvents`) dla wygodnego dostępu z innej aplikacji/narzędzia
(curl, Excel, własny panel). **Chroniony bramką** [`srv/admin-auth.js`](../srv/admin-auth.js) (wpiętą w
[`server.js`](../srv/server.js) przez `cds bootstrap`): wymaga `Authorization: Bearer <ADMIN_API_KEY>`
(porównanie `timingSafeEqual`). **Bez ustawionego `ADMIN_API_KEY` /admin jest WYŁĄCZONY (503)** — bezpieczny
default. To NIE jest publiczny ChatService; para nigdy nie dostaje tego endpointu.

**Zweryfikowane:** unit (`checkAdminAuth` 503/401/200; `assertAccess`/IDOR via integration `access.test.js`),
oraz smoke HTTP: `GET /chat/Messages`→**404** (encja zdjęta), `/admin/*` bez/zły token→**401**, z poprawnym→**200**.

**Świadome granice:** capability token = „kto zna id+token, ma tę rozmowę" — jak nieodgadywalny link.
Adekwatne dla apki bez logowania; mocniejsze (osobny rotowalny token, konta) to przyszłość. `accessToken`
jest sekretem — nie logować go ani nie wstawiać w URL (tylko body POST).

## Pokrycie testami (security) — automatyczne

Odpalane w `npm run test:all` (unit + integration + web):

| Obszar | Test |
|---|---|
| Detekcja kryzysu / PROTECT / kalibracja (jakość modelu) | eval `test/eval/` (płatny, na żądanie) |
| Fallback nie myli off-topic/injection z kryzysem; kryzys nadal `SAFETY_STOP` | `test/unit/security.test.js` |
| Guardrails anti-injection obecne w prompcie; ChatService bez encji OData; AdminService read-only | `test/unit/security.test.js` |
| Capability token: 403 bez/zły token, IDOR, brak enumeracji, `getHistory` | `test/integration/access.test.js` |
| Admin bramka 503/401/200 | `test/unit/admin-auth.test.js` |
| Budżet / globalny limit / rate-limit wiadomości | `test/integration/budget|global|ratelimit.test.js` |
| Dławik nowych rozmów (odstęp + 30/h) | `test/unit/rate-limit.test.js` + `test/integration/newconv.test.js` |
| Cap długości wiadomości (413) | `test/integration/handler.test.js` |
| Disclaimer + numery kryzysowe obecne | `web/src/hooks/disclaimer.test.ts` |

Niepokryte automatem (brak osiągalnego HTTP w `cds.test`): abort-przy-rozłączeniu, `/health`, middleware `/admin`
e2e — zweryfikowane code-review + smoke HTTP.

## Do rozważenia przed publikacją

- **Weryfikacja aktualności numerów kryzysowych** dla docelowych rynków/języków (PL: 112 / 116 123 / 800 120 002).
- Czy domknąć lukę „tylko słucha" cichym strażnikiem (świadomie odłożone).
- Polityka prywatności + zgoda (wrażliwe dane par). Szerszy dług produkcyjny → [PRODUCTION.md](PRODUCTION.md).
