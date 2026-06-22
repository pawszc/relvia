# Testy — Couple Adviser

Dwie rozłączne warstwy:

## 1. Eval modelu (`test/eval/`) — kosztuje tokeny, na żądanie

Uruchamia realny pipeline produkcyjny (`anthropicAdvisor`: `decide` + `generateReply`,
Haiku) na korpusie scenariuszy i ocenia **dwie rzeczy osobno**:

- **klasyfikację reżysera** — deterministyczna asercja na `decision.type` (`expect`/`forbid`),
- **treść dymki doradcy** — LLM-judge na **Opus** wg rubryki (fałszywa symetria, DARVO,
  re-wiktymizacja). Sędzia to narzędzie wyłącznie testowe — **nie dotyka aplikacji ani
  jej kosztu**; aplikacja zostaje na Haiku.

```bash
npm run test:eval                      # cały korpus + judge Opus + raport kosztu
npm run test:eval -- --only=KALIBRACJA # tylko jedna kategoria
npm run test:eval -- --id=A1,A3        # wybrane scenariusze (smoke test)
npm run test:eval -- --no-judge        # tylko klasyfikacja (0 tokenów judge'a)
```

Kategorie korpusu ([scenarios.js](eval/scenarios.js)):

| Kategoria | Cel |
|---|---|
| `NADUZYCIE` | jedna strona sprawcą — pożądane `PROTECT`/`SAFETY_STOP`; **celowo czerwone** na obecnym kodzie (baseline luki fałszywej symetrii) |
| `KRYZYS` | przemoc / myśli samobójcze (też EN, UA) — zawsze `SAFETY_STOP` |
| `KALIBRACJA` | zwykłe kłótnie, metafory — **strażnik fałszywych pozytywów**: NIE `PROTECT`/`SAFETY_STOP` |
| `REGRESJA` | zachowania bazowe silnika (WAIT, ASK_OTHER, parafraza, drzwi composerHint) |

Raport: stdout + [`eval/last-report.md`](eval/last-report.md). Koszt liczony tym samym
`costUsd` co aplikacja, rozbity na Haiku (doradca+reżyser) i Opus (sędzia).

Wymaga `couple-adviser.env` z `ANTHROPIC_API_KEY` (wczytywany jak w `server.js`).

## 2. Unit testy (`test/unit/`) — 0 tokenów, do CI

```bash
npm test     # node --test, wszystkie pliki test/unit/**/*.test.js
```

Deterministyczna logika reguł i strażników, runner wbudowany `node:test`:

| Plik | Pokrycie |
|---|---|
| [`decisionRules.test.js`](unit/decisionRules.test.js) | drabina `decide()` (kolejność, liczniki, anti-pętla), helpery (`isSubstantive`, `shorten`, `speakerLabel`, drzwi composerHint) |
| [`policy.test.js`](unit/policy.test.js) | strażnicy i adresat z `anthropicAdvisor.__testables`: **`PROTECT`** (kind FULL, zerowanie liczników, adresat TOGETHER), symetria płci (`audienceSteer`/`audienceBinding`=null dla SAFETY_STOP/INTERVENE/PROTECT), bezpiecznik pętli DEEPEN, FLOOR drzwi |
| [`pricing.test.js`](unit/pricing.test.js) | `activeModel()`, `costUsd()` wg stawek |

Czyste funkcje są wystawione przez `module.exports.__testables` w `anthropicAdvisor.js`
(nie część kontraktu `AdvisorService`). Test ustawia atrapę `ANTHROPIC_API_KEY` przed
`require` — konstruktor SDK waliduje tylko obecność klucza, **nie woła sieci**, więc
testy są offline i bez kosztu.
