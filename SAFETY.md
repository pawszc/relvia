# Bezpieczeństwo — Couple Adviser

Jak aplikacja reaguje na sygnały kryzysu (przemoc, samookaleczenie, myśli samobójcze, zagrożenie
życia/zdrowia) i jakie **świadome kompromisy** przyjęliśmy. Dla współtwórców i jako zapis decyzji.

> **To nie jest usługa kryzysowa ani wyrób medyczny.** Doradca jest empatycznym mediatorem, nie
> terapeutą — i mówi to wprost. W realnym zagrożeniu kieruje do profesjonalistów i służb.

## Zasada naczelna

**Bezpieczeństwo wykrywa MODEL — semantycznie i wielojęzycznie — i ma absolutny priorytet** ponad
wszystkim (fazami, pętlą, pogłębianiem, oddawaniem głosu). Świadomie **nie** opieramy detekcji na
regexach (po polsku się nie skalują, a celujemy w wiele języków).

**Rejestr empatii wg płci NIE dotyka bezpieczeństwa.** Profilowanie tonu doradcy wg adresata
(`audienceSteer` w [`anthropicAdvisor.js`](srv/advisor/anthropicAdvisor.js)) zwraca `null` dla
`SAFETY_STOP`, `INTERVENE` i `PROTECT` — dymka kryzysowa, moderacja eskalacji i tor ochronny są
**identyczne niezależnie od płci** adresata. Detekcja kryzysu jest symetryczna (przemoc „ze strony
partnera" w obie strony); tor `PROTECT` (asymetria ofiara/sprawca) też nie profiluje tonu płcią.

## Jak działa detekcja

Po każdej turze (w trybie „Rozmawia") `decide` ocenia ostatnią wiadomość. Kryteria `SAFETY_STOP` są
wprost w prompcie decyzyjnym ([`srv/advisor/anthropicAdvisor.js`](srv/advisor/anthropicAdvisor.js) →
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

Dymka doradcy ([`DECISION_STEER.SAFETY_STOP`](srv/advisor/anthropicAdvisor.js)):
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
- **Zweryfikowane evalem** ([`test/`](test/README.md)): treść dymek w nadużyciu 2/10 → 9/10, **zero fałszywych
  pozytywów** w zestawie kalibracyjnym, kryzys i zachowania bazowe nienaruszone.

## Warstwy i fallback

- **L1 — model (główna i jedyna w produkcji).** Semantyczny, wielojęzyczny.
- **L2 — regex `CRISIS` (PL), TYLKO fallback** w [`decisionRules.js`](srv/advisor/decisionRules.js) na
  wypadek awarii modelu (zły JSON / timeout) oraz w trybie mock. **Nie** jest to override ani detektor
  wielojęzyczny — best‑effort siatka po polsku.

## Świadome kompromisy (decyzje produktowe)

1. **Tryb „Tylko słucha" = brak detekcji.** W tym trybie model nie jest wołany w ogóle (zero tokenów),
   więc **bezpieczeństwo jest wtedy wyłączone**. Wybór celowy: to prywatna przestrzeń pary „między sobą".
   Możliwa przyszła opcja: cichy strażnik tylko‑safety (regex, 0 tokenów) — **nie wdrożony** z wyboru.
2. **Numery kryzysowe podaje model**, bez doklejanego, stałego bloku zasobów. Zaakceptowane ryzyko, że
   model poda nieaktualny numer (w zamian — naturalność i brak zaśmiecania UI).
3. **Brak stałego panelu „pilna pomoc".** Odrzucony — model sam zabezpiecza, panel zbędny.
4. **Awaria modelu w rozmowie nie‑polskiej** → fallback (PL regex) nie złapie kryzysu. Rzadki edge,
   przyjęty świadomie (model jest warstwą wielojęzyczną).

## Gdzie w kodzie

| Element | Plik |
|---|---|
| Kryteria `SAFETY_STOP` (decyzja) | [`srv/advisor/anthropicAdvisor.js`](srv/advisor/anthropicAdvisor.js) → `DECIDE_SYSTEM` |
| Ton dymki kryzysowej | tamże → `DECISION_STEER.SAFETY_STOP` |
| Disclaimer „nie zastępuję terapeuty" | tamże → `PERSONA` |
| Wymuszenie pełnej dymki + czyszczenie | `finalizeDecision` + [`srv/chat-service.js`](srv/chat-service.js) `sanitizeAdvisor` |
| Fallback PL (awaria modelu / mock) | [`srv/advisor/decisionRules.js`](srv/advisor/decisionRules.js) → `CRISIS` |

## Do rozważenia przed publikacją

- Czy domknąć lukę „tylko słucha" cichym strażnikiem (świadomie odłożone).
- Weryfikacja aktualności numerów kryzysowych dla docelowych rynków/języków.
- Widoczna informacja dla użytkownika, że to nie jest usługa kryzysowa (np. w onboardingu/stopce).
