# Silnik rozmowy (turn-taking engine) — Couple Adviser

Dokumentacja koncepcyjna i behawioralna „reżysera rozmowy". Czytaj razem z:
kontrakt protokołu → [`CONTRACT.md`](CONTRACT.md) · typy → [`shared/chat-contract.ts`](shared/chat-contract.ts) ·
reguły → [`srv/advisor/decisionRules.js`](srv/advisor/decisionRules.js) · handler → [`srv/chat-service.js`](srv/chat-service.js).

> Status: **silnik gotowy** — kroki 1–6 + rework pauzy (przełącznik „Rozmawia / Tylko słucha"),
> typ `DEEPEN` (pogłębianie) oraz „inteligentny kompozytor" (Faza 2). Zostały zadania po‑silnikowe:
> optymalizacja kosztu `decide`. Patrz [Roadmapa](#8-roadmapa).

---

## 1. Po co to istnieje (cel)

Domyślny chatbot odpowiada **po każdej** wiadomości. W rozmowie pary to nienaturalne i stronnicze:
AI „terapeutyzuje" pierwszą osobę, zanim druga się wypowie, i nie chroni przed eskalacją.

Advisor jest **reżyserem rozmowy**, nie uczestnikiem. Naczelna zasada:

> **Advisor ZAWSZE analizuje każdą turę, ale NIE zawsze się odzywa.**

Z tego wynikają reguły, które odróżniają produkt od zwykłego ChatGPT:

1. **Najpierw zrozum, nie spiesz się.** Po wypowiedzi osoby Advisor najpierw ją **pogłębia**
   (`DEEPEN` — odbicie uczucia + jedno otwarte pytanie, adaptacyjnie 0–2× wg sytuacji), a dopiero potem
   oddaje głos drugiej stronie (`ASK_OTHER`). Nie doradza, dopóki nie usłyszy i nie zrozumie obojga —
   chroni przed sojuszem z tym, kto napisał pierwszy.
2. **Miękkie fazy, twardy cel.** Rozmowa ma fazy (otwarcie → perspektywy → parafraza → sedno → ustalenia),
   ale nie są to bramki blokujące input. Jest za to **kotwica tematu** (gwiazda polarna), do której Advisor
   wraca, gdy rozmowa zbacza.
3. **Brak postępu uruchamia nacisk.** Gdy para się zapętla (zaprzeczenia, ogólniki), Advisor stopniowo
   forsuje konstruktywny ruch i **nazywa pętlę wprost**.
4. **Dygresje się parkuje, nie ucina.** Nowy wątek trafia na listę „do omówienia później" — nic nie ginie,
   a rozmowa wraca do kotwicy.
5. **Bezpieczeństwo jest nadrzędne.** Sygnał kryzysu/przemocy (`SAFETY_STOP`) ma priorytet ponad wszystkim —
   fazami, pętlą, pogłębianiem. Wykrywa go **MODEL** (semantycznie, wielojęzycznie); regex to tylko PL‑fallback
   na awarię modelu. UWAGA: w trybie „tylko słucha" model nie jest wołany, więc detekcja jest wtedy wyłączona
   (świadomy wybór — patrz §MVP).

### Założenia MVP (wpływają na projekt)

- **Jedno urządzenie, z rąk do rąk.** Para pisze z jednego ekranu, oznaczając autora (Ona / On / Razem).
  Tura jest fizyczna — „oddanie głosu" = przekazanie telefonu. **Brak zdalnego async**, brak pingowania nieobecnych.
- **Eskalacja = reakcja PO wysłaniu**, w „luce przekazania" (między ostrą wiadomością a następną), a nie
  blokada inputu przed wysłaniem.
- **Tryb doradcy = przełącznik „Rozmawia / Tylko słucha"** (nagłówek). „Rozmawia" = reżyser jak wyżej.
  **„Tylko słucha" = doradca CAŁKOWICIE wyłączony: ZERO wywołań modelu** — para rozmawia między sobą,
  wiadomości tylko się zapisują; powrót **tylko** przełącznikiem. Konsekwencja: w tym trybie nie ma także
  detekcji bezpieczeństwa (świadomy trade‑off — „to ich prywatna przestrzeń").

---

## 2. Architektura — dwa kroki na turę

Po każdej wiadomości pary handler ([`srv/chat-service.js`](srv/chat-service.js)) wykonuje:

```
wiadomość pary
   │  zapis do DB, lastActivityAt = now
   │  jeśli advisorMode = PAUSED („tylko słucha") → tylko echo message.user, KONIEC (zero modelu)
   ▼
decide(history, state, ctx) → AdvisorDecision        ← KROK 1: decyzja "czy i jak mówić" (+ composerHint)
   │  persystencja: phase, topic, liczniki, model, lastComposerHint; parkowanie dygresji
   │  emit: advisor.decision (+ phase.change / parked.update gdy się zmieniły)
   ▼
decision.shouldSpeak ?
   ├─ NIE → emit advisor.wait (status), KONIEC tury — żadna dymka nie powstaje
   └─ TAK → emit advisor.start → generateReply(history, ctx, decision) → advisor.delta* → advisor.end(kind)
```

**Model kosztu** (projekt pilnuje tokenów):

| Krok | Mock (`ADVISOR=mock`) | Produkcja (`ADVISOR=anthropic`) |
|---|---|---|
| `decide` | reguły, 0 tokenów | `claude-haiku-4-5`, structured output — odpala się ZAWSZE (też przy WAIT) |
| `generateReply` | kanned, 0 tokenów | `claude-haiku-4-5` (`ADVISOR_MODEL`), streaming — **tylko gdy `shouldSpeak`** |

Tury, w których Advisor milczy (`WAIT`), kosztują tylko `decide` zamiast pełnej generacji. `decide` resetuje
pełny kontekst co turę → koszt wejścia rośnie kwadratowo (kandydat do optymalizacji — patrz Roadmapa).

Warstwa AI jest za interfejsem `AdvisorService` (`decide` + `generateReply`) — mock i Anthropic są wymienne,
wybór przez `ADVISOR=mock|anthropic` ([`srv/advisor/advisor.js`](srv/advisor/advisor.js)). W trybie anthropic
`decide` woła model (Haiku, structured output), a reguły ([`decisionRules.js`](srv/advisor/decisionRules.js))
służą jako **fallback** (zły JSON / awaria / timeout) oraz w trybie mock.

---

## 3. Typy decyzji (`AdvisorDecisionType`)

Zwracane przez `decide`. Określają, czy Advisor mówi i jaki ma cel tury.

| Typ | Mówi? | Kiedy | Cel |
|---|---|---|---|
| `WAIT` | nie | para rozmawia między sobą / krótka kontynuacja własnej myśli | dać przestrzeń; status „słucha w milczeniu…" |
| `DEEPEN` | tak | wypowiedź niesie uczucie/treść do zgłębienia | odbicie + jedno otwarte pytanie do TEJ SAMEJ osoby (0–2× adaptacyjnie) |
| `ASK_OTHER` | tak | pierwsza osoba wysłuchana, druga jeszcze nie mówiła | docenić i oddać głos drugiej (chroni przed stronniczością) |
| `CLARIFY` | tak | krótka ogólna negacja („nieprawda!") | poprosić o konkret zamiast oceny |
| `REFRAME` | tak | krążenie wokół tego samego / dygresja | nazwać wspólną potrzebę pod sporem; wrócić do kotwicy |
| `NARROW` | tak | utknięcie w ogólnikach | poprosić o jeden konkretny przykład |
| `CHOOSE` | tak | kilka wątków naraz | wybrać jeden temat, resztę odłożyć |
| `PROPOSE` | tak | głęboka pętla / obie strony zrozumiane | zaproponować 1–3 małe kroki |
| `SUMMARIZE` | tak | wypowiedziały się obie strony „z treścią" | parafraza uczuć i potrzeb obojga |
| `INTERVENE` | tak | eskalacja | krótka moderacja w „luce przekazania" (mała dymka) |
| `SAFETY_STOP` | tak | sygnał kryzysu/przemocy | zatrzymać mediację; odesłać do profesjonalnej pomocy/służb |

**Rodzaj dymki** (`AdvisorBubbleKind`) steruje renderem: `INTERVENTION` (mała, wyróżniona — tylko `INTERVENE`),
`FULL` (duża — cała reszta, w tym `SAFETY_STOP`). Kind wyznacza KOD wg typu (nie ufamy `kind` z modelu).

**`composerHint`** — krótka, kontekstowa podpowiedź do pola wpisywania dla następnej osoby (placeholder).
Generuje ją model w `decide`; różnicowana z tury na turę (poprzednia trafia do promptu jako „nie powtarzaj").

---

## 4. Logika reguł (fallback + mock)

> Te reguły to **nie** główny tor. W produkcji decyzje (w tym bezpieczeństwo, eskalacja, dygresja, pogłębianie)
> podejmuje MODEL — semantycznie i wielojęzycznie. Reguły działają jako fallback na awarię modelu i jako mock
> offline. Wzorce są **PL‑only** i celowo proste — świadomie nie skalujemy regexu pod inne języki.

Kolejność w [`decide()`](srv/advisor/decisionRules.js) (pierwszy pasujący warunek wygrywa):

1. **Brak wypowiedzi pary** → `WAIT`.
2. **Kryzys** (regex `CRISIS`, PL) → `SAFETY_STOP`. Zawsze pierwszy. (W produkcji robi to model; tu tylko fallback.)
3. **Pauza** (`advisorMode = PAUSED`) → `WAIT` (defensywnie; w realnym torze handler i tak nie woła `decide` w tym trybie).
4. **Eskalacja** (`ESCALATION` / krzyk) → `INTERVENE` (+`escalationStreak`).
5. **Dygresja** (`DIGRESSION`, gdy jest kotwica) → `REFRAME` + `parkAdd` (parkuje wątek).
6. **Pogłębienie** — wypowiedź substantywna i `< 2` pogłębień z tą osobą → `DEEPEN` (zostań przy niej).
7. **Tylko jedna strona** mówiła → `ASK_OTHER` (z `nextSpeaker`).
8. **Brak postępu** (negacja/urywek):
   - krótka kontynuacja własnej myśli (nie negacja) → `WAIT`,
   - inaczej **drabina nacisku** wg `turnsSinceProgress`: `1→CLARIFY, 2→REFRAME, 3→NARROW, 4→CHOOSE, ≥5→PROPOSE`.
9. **Obie strony „z treścią"** → `SUMMARIZE`.

Pojęcia:
- **substantive** = wypowiedź `≥ 40` znaków i nie będąca krótką negacją. Posuwa rozmowę → zeruje licznik pętli.
- **`turnsSinceProgress`** rośnie przy turach bez postępu, zeruje się przy wypowiedzi substantywnej → napędza drabinę.
- **głębia** — liczba `DEEPEN` z rzędu z tą samą osobą; w produkcji dobiera ją MODEL adaptacyjnie (0–2), kod
  ma tylko bezpiecznik na pętlę pytań (≥3 → ruch dalej). W regułach: gate na substantywności + sufit 2×.
- **kotwica (`topic`)** ustalana z pierwszej substantywnej wypowiedzi; utrzymywana między turami.

### Fazy (miękki cel)

`OPENING → PERSPECTIVE_A → PERSPECTIVE_B → PARAPHRASE → CORE → AGREEMENT`. Pochodzą z `decide`, są
**informacyjne** (wskaźnik w UI), nie blokują niczego.

### Parking dygresji

Marker dygresji → wątek ląduje w `ParkedTopics` (status `OPEN`), Advisor potwierdza i wraca do kotwicy.
Panel „Do omówienia później": **wróćmy teraz** (`PROMOTE` — ustawia kotwicę), **załatwione** (`RESOLVED`),
**odrzuć** (`DISMISSED`).

---

## 5. Stan reżysera (persystencja)

Na encji `Conversations` ([`db/schema.cds`](db/schema.cds)):

| Pole | Znaczenie |
|---|---|
| `phase` | bieżąca faza (miękki cel) |
| `topic` | kotwica tematu (gwiazda polarna) |
| `advisorMode` | `LEADING` („Rozmawia") / `PAUSED` („Tylko słucha") |
| `turnsSinceProgress` | licznik pętli (napędza drabinę nacisku) |
| `escalationStreak` | rozpęd kłótni |
| `lastActivityAt` | znacznik aktywności (idle/heartbeat) |
| `model` | model AI użyty do generacji (np. `claude-haiku-4-5`) |
| `lastComposerHint` | ostatnia podpowiedź do pola — by `decide` jej nie powtarzał |
| `decideInputTokens` … `decideCacheCreationTokens` | zużycie tokenów warstwy DECYZJI (narasta co turę) |

Encja `ParkedTopics` (`text`, `status`, `parkedAtSeq`) — lista „do omówienia później".
Na `Messages` (dymki ADVISOR): `kind` + `decisionType` + tokeny generacji.

`decide` zwraca nowe wartości stanu, które handler zapisuje. `ConversationState` odtwarza UI po odświeżeniu
(akcja `conversationState`). Koszt: funkcja `conversationUsage` rozbija tokeny generacja vs decyzja + `costUsd`
(cennik per model w [`srv/advisor/pricing.js`](srv/advisor/pricing.js) / [`models.js`](srv/advisor/models.js)).

---

## 6. Protokół (zdarzenia SSE)

Pełna tabela w [`CONTRACT.md`](CONTRACT.md). Skrótowo, sekwencja tury:

```
message.user → advisor.decision → [phase.change?] → [parked.update?] →
   ( advisor.wait )                                   ← Advisor milczy
   ( advisor.start → advisor.delta* → advisor.end )   ← Advisor mówi
```
(W trybie „tylko słucha": tylko `message.user`, bez wołania modelu.)

- `advisor.decision` — typ decyzji, faza, `uiHint`, `nextSpeaker`, **`composerHint`** (podpowiedź do pola).
- `advisor.wait` — Advisor analizuje, ale **nie dodaje dymki** (lista wiadomości nie rośnie).
- `phase.change` / `parked.update` — emitowane tylko przy realnej zmianie.

**Status sceniczny** w UI (nie spinner — obecność reżysera):
`idle` · `listening` (analizuje) · `typing` (pisze) · `waiting` (świadomie czeka, np. „Doradca czeka na
odpowiedź: {imię}"). Mapowanie: [`web/src/hooks/useConversation.ts`](web/src/hooks/useConversation.ts);
render: [`web/src/components/ChatScreen.tsx`](web/src/components/ChatScreen.tsx).

### „Inteligentny kompozytor" (Faza 2)

Pole wpisywania odzwierciedla kierunek doradcy — zawsze nadpisywalne, zmiana tylko przy pustym polu:
- **auto‑autor** wg `nextSpeaker` (ASK_OTHER → druga strona; DEEPEN → ta sama osoba),
- **placeholder** = `composerHint` z modelu (fallback: statyczna mapa wg typu decyzji),
- po dłuższej ciszy (`idle`) → autor „Razem" + zapraszający placeholder.

---

## 7. Gdzie co jest (mapa kodu)

| Warstwa | Plik | Rola |
|---|---|---|
| Kontrakt | [`shared/chat-contract.ts`](shared/chat-contract.ts) | typy decyzji, stanu, zdarzeń — jedno źródło prawdy |
| Reguły | [`srv/advisor/decisionRules.js`](srv/advisor/decisionRules.js) | `decide()` regułowy — **fallback + mock** (PL) |
| AI mock | [`srv/advisor/mockAdvisor.js`](srv/advisor/mockAdvisor.js) | `decide` + `generateReply` (0 tokenów) |
| AI real | [`srv/advisor/anthropicAdvisor.js`](srv/advisor/anthropicAdvisor.js) | `decide` (Haiku, structured output) + `generateReply` (Haiku) sterowany decyzją |
| Modele/cennik | [`srv/advisor/models.js`](srv/advisor/models.js) · [`pricing.js`](srv/advisor/pricing.js) | tabela modeli→stawki, `activeModel()`, `costUsd()` |
| Handler | [`srv/chat-service.js`](srv/chat-service.js) | orkiestracja, pauza, persystencja, SSE, `sanitizeAdvisor` |
| Model danych | [`db/schema.cds`](db/schema.cds) | stan reżysera + `ParkedTopics` + tokeny |
| Hook | [`web/src/hooks/useConversation.ts`](web/src/hooks/useConversation.ts) | stan UI: status, faza, parking, `lastDecision`, tryb |
| Ekran + kompozytor | [`web/src/components/ChatScreen.tsx`](web/src/components/ChatScreen.tsx) · [`Composer.tsx`](web/src/components/Composer.tsx) | przełącznik trybu, placeholdery, auto‑autor |
| Klient offline | [`web/src/client/mockChatClient.ts`](web/src/client/mockChatClient.ts) | lustro reguł dla `VITE_USE_MOCK=true` |

> **Uwaga o duplikacji.** Reguły żyją w `decisionRules.js` (backend, CJS) i są **lustrzanie** powtórzone
> w `mockChatClient.ts` (front, TS) na potrzeby trybu offline — backend Node nie importuje TS, a front nie
> importuje CJS z `srv/`. Zmieniając reguły, zmień **oba** miejsca.

---

## 8. Roadmapa

| Krok | Zakres | Status |
|---|---|---|
| 1 | Warstwa decyzyjna (decide → speak/wait), status sceniczny | ✅ |
| 2 | Persystencja stanu, fazy (miękki cel), anti-pętla, parking dygresji | ✅ |
| 3 | Eskalacja po wysłaniu: `INTERVENE` + `escalationStreak`, mała dymka, stopniowanie | ✅ |
| 4 | Pauza/wznowienie + heartbeat → przebudowane w **przełącznik „Rozmawia / Tylko słucha"** (twardy, zero modelu w „tylko słucha") | ✅ |
| 5 | Realny model decyzyjny: `decide` na Haiku (structured output), liczniki deterministyczne, bezpieczeństwo semantyczne (model), reguły jako fallback, rozliczanie tokenów decide | ✅ |
| 6 | Wzmocniony tor bezpieczeństwa — **model‑only** (kryteria SAFETY_STOP + wykluczenie metafor, jakość dymki); zweryfikowany wielojęzycznie | ✅ |
| + | `DEEPEN` (pogłębianie, adaptacyjne 0–2×) | ✅ |
| + | „Inteligentny kompozytor" (Faza 2): auto‑autor, placeholdery z modelu (`composerHint`), idle→Razem | ✅ |

**Zadania po‑silnikowe:**
- Przegląd regexów pod wielojęzyczność — **zrobione** (regexy są świadomie PL‑only jako fallback/mock; model = warstwa wielojęzyczna; patrz nagłówek `decisionRules.js`).
- **Optymalizacja kosztu `decide`** (rośnie kwadratowo) — TODO: cache prefiksu / krótszy kontekst dla decide.
- Krok ku publikacji: rate limiting / ochrona publicznego endpointu, wdrożenie (CAP serwuje build SPA).

Pełny plan implementacji: `~/.claude/plans/snug-launching-castle.md`.
