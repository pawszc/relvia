# Silnik rozmowy (turn-taking engine) — Couple Adviser

Dokumentacja koncepcyjna i behawioralna „reżysera rozmowy". Czytaj razem z:
kontrakt protokołu → [`CONTRACT.md`](CONTRACT.md) · typy → [`shared/chat-contract.ts`](shared/chat-contract.ts) ·
reguły → [`srv/advisor/decisionRules.js`](srv/advisor/decisionRules.js) · handler → [`srv/chat-service.js`](srv/chat-service.js).

> Status implementacji: **kroki 1–2 gotowe**. Kroki 3–6 (eskalacja po wysłaniu, pauza/heartbeat,
> realny model decyzyjny, wzmocniony tor bezpieczeństwa) — zaplanowane, patrz [Roadmapa](#roadmapa).

---

## 1. Po co to istnieje (cel)

Domyślny chatbot odpowiada **po każdej** wiadomości. W rozmowie pary to nienaturalne i stronnicze:
AI „terapeutyzuje" pierwszą osobę, zanim druga się wypowie, i nie chroni przed eskalacją.

Advisor jest **reżyserem rozmowy**, nie uczestnikiem. Naczelna zasada:

> **Advisor ZAWSZE analizuje każdą turę, ale NIE zawsze się odzywa.**

Z tego wynikają reguły, które odróżniają produkt od zwykłego ChatGPT:

1. **Nie doradzaj, dopóki nie usłyszysz obu stron.** Po wypowiedzi jednej osoby Advisor oddaje głos
   drugiej (`ASK_OTHER`), zamiast od razu doradzać — chroni przed sojuszem z tym, kto napisał pierwszy.
2. **Miękkie fazy, twardy cel.** Rozmowa ma fazy (otwarcie → perspektywy → parafraza → sedno → ustalenia),
   ale nie są to bramki blokujące input. Jest za to **kotwica tematu** (gwiazda polarna), do której Advisor
   wraca, gdy rozmowa zbacza.
3. **Brak postępu uruchamia nacisk.** Gdy para się zapętla (zaprzeczenia, ogólniki), Advisor stopniowo
   forsuje konstruktywny ruch i **nazywa pętlę wprost**.
4. **Dygresje się parkuje, nie ucina.** Nowy wątek trafia na listę „do omówienia później" — nic nie ginie,
   a rozmowa wraca do kotwicy.
5. **Bezpieczeństwo jest nadrzędne.** Sygnał kryzysu/przemocy (`SAFETY_STOP`) ma priorytet ponad wszystkim
   — fazami, pętlą, a docelowo również ponad pauzą.

### Założenia MVP (wpływają na projekt)

- **Jedno urządzenie, z rąk do rąk.** Para pisze z jednego ekranu, oznaczając autora (Ola / Tomek / Razem).
  Tura jest fizyczna — „oddanie głosu" = przekazanie telefonu. **Brak zdalnego async**, brak pingowania nieobecnych.
- **Eskalacja = reakcja PO wysłaniu**, w „luce przekazania" (między ostrą wiadomością a następną), a nie
  blokada inputu przed wysłaniem. (Krok 3.)

---

## 2. Architektura — dwa kroki na turę

Po każdej wiadomości pary handler ([`srv/chat-service.js`](srv/chat-service.js)) wykonuje:

```
wiadomość pary
   │  zapis do DB, lastActivityAt = now
   ▼
decide(history, state, ctx) → AdvisorDecision        ← KROK 1: tania decyzja "czy i jak mówić"
   │  persystencja: phase, topic, turnsSinceProgress; parkowanie dygresji
   │  emit: advisor.decision (+ phase.change / parked.update gdy się zmieniły)
   ▼
decision.shouldSpeak ?
   ├─ NIE → emit advisor.wait (status), KONIEC tury — żadna dymka nie powstaje
   └─ TAK → emit advisor.start → generateReply(history, ctx, decision) → advisor.delta* → advisor.end(kind)
```

**Model kosztu** (ważne — projekt pilnuje tokenów):

| Krok | Mock | Realny (docelowo, krok 5) |
|---|---|---|
| `decide` | reguły, 0 tokenów | mały model (`claude-haiku`), structured output — odpala się ZAWSZE |
| `generateReply` | kanned, 0 tokenów | `claude-sonnet-4-6`, streaming — **tylko gdy `shouldSpeak`** |

Tury, w których Advisor milczy (`WAIT`), kosztują grosze zamiast pełnej generacji. To celowe.

Warstwa AI jest za interfejsem `AdvisorService` (`decide` + `generateReply`) — mock i Anthropic są wymienne,
wybór przez `ADVISOR=mock|anthropic` ([`srv/advisor/advisor.js`](srv/advisor/advisor.js)). Reguły decyzji są
wspólne ([`decisionRules.js`](srv/advisor/decisionRules.js)); w trybie anthropic decyzja jest na razie regułowa,
a generacja realna (haiku dla `decide` dochodzi w kroku 5).

---

## 3. Typy decyzji (`AdvisorDecisionType`)

Zwracane przez `decide`. Określają, czy Advisor mówi i jaki ma cel tury.

| Typ | Mówi? | Kiedy | Cel |
|---|---|---|---|
| `WAIT` | nie | krótka kontynuacja własnej myśli (nie negacja) | dać przestrzeń; tylko status „słucha…" |
| `ASK_OTHER` | tak | wypowiedziała się tylko jedna strona | docenić i oddać głos drugiej (chroni przed stronniczością) |
| `CLARIFY` | tak | krótka ogólna negacja („nieprawda!") | poprosić o konkret zamiast oceny |
| `REFRAME` | tak | krążenie wokół tego samego / dygresja | nazwać wspólną potrzebę pod sporem; wrócić do kotwicy |
| `NARROW` | tak | utknięcie w ogólnikach | poprosić o jeden konkretny przykład |
| `CHOOSE` | tak | kilka wątków naraz | wybrać jeden temat, resztę odłożyć |
| `PROPOSE` | tak | głęboka pętla | zaproponować 1–3 małe kroki |
| `SUMMARIZE` | tak | wypowiedziały się obie strony „z treścią" | parafraza uczuć i potrzeb obojga |
| `INTERVENE` | tak | eskalacja (krok 3) | krótka moderacja w „luce przekazania" |
| `SAFETY_STOP` | tak | sygnał kryzysu/przemocy | zatrzymać; odesłać do profesjonalnej pomocy/służb |

**Rodzaj dymki** (`AdvisorBubbleKind`) steruje renderem: `FULL` (duża dymka), `MODERATION`/`INTERVENTION`
(małe, wyróżnione — od kroku 3).

---

## 4. Logika reguł (krok 1–2)

Kolejność w [`decide()`](srv/advisor/decisionRules.js) (pierwszy pasujący warunek wygrywa):

1. **Brak wypowiedzi pary** → `WAIT`.
2. **Kryzys** (regex `CRISIS`) → `SAFETY_STOP`. Zawsze pierwszy.
3. **Dygresja** (marker `DIGRESSION`, gdy jest już kotwica) → `REFRAME` + `parkAdd` (parkuje wątek).
4. **Tylko jedna strona** mówiła → `ASK_OTHER` (z `nextSpeaker`).
5. **Brak postępu** (ostatnia wypowiedź to negacja/urywek):
   - krótka kontynuacja własnej myśli (nie negacja) → `WAIT`,
   - w innym razie **drabina nacisku** wg `turnsSinceProgress`:
     `1→CLARIFY, 2→REFRAME, 3→NARROW, 4→CHOOSE, ≥5→PROPOSE`.
6. **Obie strony „z treścią"** → `SUMMARIZE`.

Pojęcia:
- **substantive** = wypowiedź `≥ 40` znaków i nie będąca krótką negacją. Posuwa rozmowę → zeruje licznik pętli.
- **`turnsSinceProgress`** rośnie przy turach bez postępu, zeruje się przy wypowiedzi substantywnej → napędza drabinę.
- **kotwica (`topic`)** ustalana z pierwszej substantywnej wypowiedzi; utrzymywana między turami.

### Fazy (miękki cel)

`OPENING → PERSPECTIVE_A → PERSPECTIVE_B → PARAPHRASE → CORE → AGREEMENT`. Pochodzą z `decide` i są
**informacyjne** (wskaźnik w UI), nie blokują niczego. Przejście do `CORE` następuje po pierwszej parafrazie;
drabina nacisku spycha fazę ku `CORE`/`AGREEMENT`.

### Parking dygresji

Marker dygresji → wątek ląduje w `ParkedTopics` (status `OPEN`), Advisor potwierdza zaparkowanie i wraca do
kotwicy. Panel „Do omówienia później" pozwala: **wróćmy teraz** (`PROMOTE` — ustawia kotwicę na ten temat),
**załatwione** (`RESOLVED`), **odrzuć** (`DISMISSED`).

---

## 5. Stan reżysera (persystencja)

Na encji `Conversations` ([`db/schema.cds`](db/schema.cds)):

| Pole | Znaczenie |
|---|---|
| `phase` | bieżąca faza (miękki cel) |
| `topic` | kotwica tematu (gwiazda polarna) |
| `advisorMode` | `LEADING` / `LISTENING` / `PAUSED` (pauza — krok 4) |
| `turnsSinceProgress` | licznik pętli (napędza drabinę nacisku) |
| `escalationStreak` | rozpęd kłótni (krok 3) |
| `lastActivityAt` | znacznik aktywności (heartbeat — krok 4) |

Encja `ParkedTopics` (`text`, `status`, `parkedAtSeq`) — lista „do omówienia później".
Na `Messages` (dymki ADVISOR): `kind` + `decisionType` — render i diagnostyka.

`decide` zwraca nowe wartości (`phase`, `topic`, `turnsSinceProgress`, `parkAdd`), które handler zapisuje.
`ConversationState` odtwarza UI po odświeżeniu (akcja `conversationState`).

---

## 6. Protokół (zdarzenia SSE)

Pełna tabela w [`CONTRACT.md`](CONTRACT.md). Skrótowo, sekwencja tury:

```
message.user → advisor.decision → [phase.change?] → [parked.update?] →
   ( advisor.wait )                                   ← Advisor milczy
   ( advisor.start → advisor.delta* → advisor.end )   ← Advisor mówi
```

- `advisor.decision` — typ decyzji, faza, `uiHint`, `nextSpeaker` (status sceniczny).
- `advisor.wait` — Advisor analizuje, ale **nie dodaje dymki** (lista wiadomości nie rośnie).
- `phase.change` / `parked.update` — emitowane tylko przy realnej zmianie.

**Status sceniczny** w UI (nie spinner — obecność reżysera):
`idle` · `listening` (analizuje) · `typing` (pisze) · `waiting` (świadomie czeka, np. na drugą stronę).
Mapowanie zdarzeń → status: [`web/src/hooks/useConversation.ts`](web/src/hooks/useConversation.ts);
render: [`web/src/components/ChatScreen.tsx`](web/src/components/ChatScreen.tsx).

---

## 7. Gdzie co jest (mapa kodu)

| Warstwa | Plik | Rola |
|---|---|---|
| Kontrakt | [`shared/chat-contract.ts`](shared/chat-contract.ts) | typy decyzji, stanu, zdarzeń — jedno źródło prawdy |
| Reguły | [`srv/advisor/decisionRules.js`](srv/advisor/decisionRules.js) | `decide()` — wspólne dla mocka i anthropic |
| AI mock | [`srv/advisor/mockAdvisor.js`](srv/advisor/mockAdvisor.js) | `decide` + `generateReply` (0 tokenów) |
| AI real | [`srv/advisor/anthropicAdvisor.js`](srv/advisor/anthropicAdvisor.js) | `decide` (reguły) + `generateReply` (sonnet) sterowany decyzją |
| Handler | [`srv/chat-service.js`](srv/chat-service.js) | orkiestracja, persystencja stanu, SSE |
| Model | [`db/schema.cds`](db/schema.cds) | stan reżysera + `ParkedTopics` |
| Hook | [`web/src/hooks/useConversation.ts`](web/src/hooks/useConversation.ts) | stan UI: status, faza, parking |
| Klient offline | [`web/src/client/mockChatClient.ts`](web/src/client/mockChatClient.ts) | lustro reguł dla `VITE_USE_MOCK=true` |

> **Uwaga o duplikacji.** Reguły żyją w `decisionRules.js` (backend, CJS) i są **lustrzanie** powtórzone
> w `mockChatClient.ts` (front, TS) na potrzeby trybu offline — backend Node nie importuje TS, a front nie
> importuje CJS z `srv/`. Zmieniając reguły, zmień **oba** miejsca (taki sam wzorzec jak istniejące `REPLIES`).

---

## 8. Roadmapa

| Krok | Zakres | Status |
|---|---|---|
| 1 | Warstwa decyzyjna (decide → speak/wait), status sceniczny | ✅ |
| 2 | Persystencja stanu, fazy (miękki cel), anti-pętla, parking dygresji | ✅ |
| 3 | Eskalacja po wysłaniu: `INTERVENE` + `escalationStreak`, mała dymka w „luce przekazania", stopniowanie | ⏳ |
| 4 | Pauza/wznowienie („Porozmawiajmy sami") + lekki heartbeat bezczynności; bezpieczeństwo aktywne w pauzie | ⏳ |
| 5 | Realny model decyzyjny: `decide` na `claude-haiku` (structured), `generateReply` na `claude-sonnet-4-6` | ⏳ |
| 6 | Wzmocniony tor bezpieczeństwa (przemoc/kryzys), niezależny od pauzy | ⏳ |

Pełny plan implementacji: `~/.claude/plans/snug-launching-castle.md`.
