# relvia — gotowość produkcyjna i dług

Świadomy zapis: co jest gotowe na **eksperymentalny MVP**, co jest **must‑do przed startem**, a co
to **udokumentowany dług** do zrobienia planowo (gdy ruch/dane urosną), żeby nie gasić pożarów.

Powiązane: [SAFETY.md](SAFETY.md) (bezpieczeństwo + ochrona dostępu/kosztu), [README.md](../README.md),
[ENGINE.md](ENGINE.md).

---

## ✅ Zrobione (fundament)

- **Silnik‑reżyser** z warstwą bezpieczeństwa (`SAFETY_STOP`/`PROTECT`/`INTERVENE`), model‑only, wielojęzyczny.
- **Ochrona kosztu:** budżet per‑sesja ($0,50), globalny dzienny ($20/24h), prompt caching `decide`. Konfig w `srv/advisor/config.js`.
- **Ochrona dostępu:** capability token per konwersacja (`assertAccess`, 403, brak enumeracji), zero encji OData na ChatService, `AdminService` (/admin) za bearer‑tokenem.
- **Anti‑nadużycie / odporność:** rate‑limit wiadomości (per konwersacja) i tworzenia rozmów (per IP), **cap długości wiadomości**, **timeout Anthropic**, **abort generacji przy rozłączeniu klienta**, anti‑injection w prompcie.
- **Operacyjne:** `/health`, `schema_evolution: auto` na profilu `[production]`.
- **Testy:** unit + integration + web (silnik, safety, koszt, dostęp, admin‑auth).

---

## 🔴 Must‑do PRZED startem (nawet dla grupki)

| # | Rzecz | Status | Uwaga |
|---|---|---|---|
| 1 | **Disclaimer kryzysowy widoczny** („to nie terapia/pomoc doraźna" + numery) | częściowo | Jest dymka na wejściu (`SAFETY_DISCLAIMER_TEXT`). **Do zrobienia:** STAŁA stopka (nie tylko start) + potwierdzenie numerów dla rynku. |
| 2 | **Polityka prywatności + zgoda** (wrażliwe dane par; RODO jeśli UE) | TODO | Krótko: co zapisujemy, jak długo, kontakt do usunięcia. Treść prawna — po stronie produktu. |
| 3 | **Wdrożenie z trwałością** | TODO | Host z trwałym procesem Node + **wolumen** na `db.sqlite` + **backup pliku** (cron `cp`). |
| 4 | **`ADMIN_API_KEY` długi/losowy + HTTPS** | TODO | Na produkcji ustaw silny sekret; TLS z platformy. |
| 5 | **Cap długości wiadomości** | ✅ zrobione | `CONFIG.maxMessageChars` (413 powyżej). |

---

## 🟠🟡 Dług produkcyjny (świadomie odłożony)

### Niezawodność
- [x] Timeout Anthropic; [x] abort przy rozłączeniu klienta.
- [ ] **Graceful shutdown** (SIGTERM → domknąć otwarte SSE przy deployu).
- [ ] **Retry/backoff** — SDK ma domyślne 2 retry (4xx/5xx); dla streamu rozważyć własną obsługę.

### Obserwowalność
- [ ] **Error tracking** (Sentry/itp.) — stack trace + kontekst zamiast samych logów.
- [ ] **Korelacja `request-id`** Anthropic w logach błędów.
- [ ] **Metryki:** koszt/dzień, latencja, błędy modelu, **cache hit rate** (dane są w usage).
- [x] `/health` (jest).

### Skalowanie (gdy duży ruch)
- [ ] **Wiele instancji → Postgres + Redis.** In‑memory rate‑limit i `accessToken` (hook) są per instancja. Migracja SQLite→Postgres = głównie konfiguracja CAP.
- [ ] **WAL mode** na SQLite (lepsza współbieżność): `PRAGMA journal_mode=WAL` na pliku bazy.
- [ ] **Retencja `UsageEvents` + indeks `createdAt`** — globalny gate skanuje tę tabelę co turę; bez retencji rośnie.
- [ ] **decide kwadratowy** — caching łagodzi; przy bardzo długich rozmowach kiedyś okno/kompakcja (stratne — świadomie odłożone).

### Bezpieczeństwo (twardo)
- [x] rate‑limit `startConversation` per IP; [x] cap długości; [x] capability token.
- [ ] **Security headers** (HSTS/CSP — `helmet`) + **limit rozmiaru body** (express).
- [ ] **`accessToken` bez rotacji/wygaśnięcia** — akceptowalne dla MVP; rozważyć TTL/rotację.
- [ ] **CAP auth „mocked"**, akcje bez `@requires` — chronione capability tokenem (model bez logowania); threat‑model udokumentowany w SAFETY.md.

### Dane / zgodność
- [ ] **Retencja rozmów** (kasowanie po czasie) + **prawo do usunięcia**.
- [ ] **Szyfrowanie w spoczynku** (wrażliwe dane — szyfrowany wolumen).
- [ ] **Backup + odtwarzanie** (procedura, nie tylko `cp`).

### UX / produkt
- [ ] **Persystencja rozmowy po odświeżeniu** — hook nie zapisuje `id`+`token`, więc refresh = nowa rozmowa. Decyzja: `localStorage(id+token)` (jak „magic link"; uwaga: token w localStorage = ekspozycja na XSS) albo konta. **Świadoma decyzja produktowa.**
- [ ] **Stała stopka z disclaimerem** (zamiast tylko dymki na starcie).

### Testy / CI
- [ ] **Testy `useConversation`** (reduktor SSE→UI: optymizm/status/retry/idle).
- [ ] **Kontrakt SSE e2e** (alternatywa dla nieosiągalnego HTTP w cds.test).
- [ ] **eval N=3** (flaga `--runs` + majority — wariancja modelu).
- [ ] **Load test** (ile równoległych SSE udźwignie jedna instancja).

### Jakość modelu (znane)
- [ ] **Wycieki obcych znaków na Haiku** (cyrylica/odmiana rodzaju) — Sonnet do generacji albo strażnik nie‑PL w `sanitizeAdvisor`.
- [ ] **Ton „pouczający" do mężczyzny** miejscami (wariancja Haiku).
- [ ] **`uiHint`=(brak)** na torze modelu — jedyny placeholder to `composerHint`.

---

## Konfiguracja produkcyjna (ściągawka)

```bash
NODE_ENV=production          # aktywuje profil [production] (schema_evolution: auto)
ADVISOR=anthropic
ADVISOR_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=...        # sekret
ADMIN_API_KEY=...            # długi losowy; włącza /admin (bez niego /admin = 503)
ADVISOR_BUDGET_USD=0.50
ADVISOR_GLOBAL_BUDGET_USD=20 # docelowo wyżej
# opcjonalnie (dławiki/odporność):
#   ADVISOR_MAX_MESSAGE_CHARS=4000     # cap długości wiadomości
#   ADVISOR_RATELIMIT_MIN_MS=800       # odstęp między wiadomościami
#   ADVISOR_NEWCONV_MIN_MS=2000        # odstęp między nowymi rozmowami (per IP)
#   ADVISOR_NEWCONV_MAX_PER_HOUR=30    # twardy limit nowych rozmów/h (per IP)
#   ADVISOR_ANTHROPIC_TIMEOUT_MS=60000 # timeout modelu
```

Migracja schematu bez utraty danych (produkcja): `cp db.sqlite db.sqlite.bak` → `cds deploy --dry --profile production` (sprawdź brak `DROP`) → `cds deploy --profile production`.
