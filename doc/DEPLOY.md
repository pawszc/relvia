# relvia — wdrożenie na Fly.io (monolit dla testerów)

Jak wystawić aplikację jako stronę www z trwałą bazą i HTTPS. Monolit: jeden kontener Node,
CAP serwuje zbudowany frontend (`web/dist`) z tego samego origin co `/chat` i `/admin`.

Powiązane: [PRODUCTION.md](PRODUCTION.md) (gotowość/dług), [SAFETY.md](SAFETY.md) (sekrety, dostęp), [../README.md](../README.md).

## Co składa się na wdrożenie (w repo)
- **[../Dockerfile](../Dockerfile)** — build frontu (Vite) + backendu (CAP), runtime slim. `cds deploy` przy starcie.
- **[../fly.toml](../fly.toml)** — region, port 4004, wolumen `/data`, health-check `/health`, 1 instancja.
- **[../srv/server.js](../srv/server.js)** — serwuje `web/dist` (statyki) obok `/chat` i `/admin`.
- **profil `[production]` w [../package.json](../package.json)** — baza na `/data/db.sqlite` + `schema_evolution: auto`.

## Wymagania wstępne
1. Konto Fly.io + `flyctl` (CLI):
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
   - `fly auth signup` (lub `fly auth login`).
2. Klucz API Anthropic z `console.anthropic.com` (z kredytami).

## Pierwsze wdrożenie (jednorazowo)
Z katalogu `couple-adviser/`:

```bash
# 1. Zarejestruj aplikację BEZ deployu (fly.toml jest już w repo).
#    Zmień najpierw `app` w fly.toml na własną, globalnie unikalną nazwę.
fly launch --no-deploy --copy-config

# 2. Utwórz trwały wolumen na bazę (ten sam region co w fly.toml, ta sama nazwa co [mounts].source).
fly volumes create relvia_data --region fra --size 1   # 1 GB wystarczy; region MUSI = primary_region z fly.toml

# 3. Ustaw sekrety (NIE trafiają do obrazu ani do gita).
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set ADMIN_API_KEY=$(openssl rand -hex 32)   # długi losowy; włącza /admin
# WYMAGANY pepper HMAC capability tokenów (patrz sekcja niżej) — bez niego kontener
# celowo NIE wystartuje przy włączonej kontroli dostępu:
fly secrets set CAPABILITY_TOKEN_PEPPER=$(openssl rand -hex 32)

# 4. Deploy.
fly deploy

# 5. Otwórz w przeglądarce.
fly open                 # → https://<twoja-nazwa>.fly.dev
```

## ⚠️ Migracja capability tokenów (obowiązkowa kolejność przy PIERWSZYM wdrożeniu tej wersji)

Ta wersja przechowuje capability tokeny konwersacji jako **`v1:HMAC-SHA-256`** zamiast plaintextu
(SAFETY.md §Izolacja danych). Kontener przy starcie uruchamia **automatyczną, idempotentną migrację**
(`cds deploy → node srv/migrate-capability-tokens.js → cds-serve`), która **blokuje start przy błędzie**.
Pierwszy deploy tej wersji wykonuj w **kontrolowanym oknie bez zapisu** (najlepiej gdy nikt nie
rozmawia — np. `fly scale count 0` na czas backupu albo świadomie zaakceptowana chwila ciszy),
W TEJ KOLEJNOŚCI:

```bash
# 1. SPÓJNY backup bazy (przed migracją in-place). NIE kopiuj „na żywo" aktywnego
#    db.sqlite (WAL może być niedomknięty) — użyj SQLite online backup przez
#    zainstalowany w kontenerze better-sqlite3:
fly ssh console -C "node -e \"require('better-sqlite3')('/data/db.sqlite').backup('/data/db.before-capability-hmac.sqlite').then(()=>console.log('backup OK'))\""

# 2. Pobierz backup lokalnie i USUŃ kopię pomocniczą z wolumenu:
fly ssh sftp get /data/db.before-capability-hmac.sqlite ./db.before-capability-hmac.sqlite
fly ssh console -C "rm /data/db.before-capability-hmac.sqlite"

# 3. Zweryfikuj integralność pobranego backupu lokalnie:
node -e "console.log(require('better-sqlite3')('./db.before-capability-hmac.sqlite',{readonly:true}).pragma('integrity_check',{simple:true}))"   # → ok

# 4. Wygeneruj JEDEN stabilny sekret lokalnie (32 losowe bajty jako 64 hex):
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# 5. Ustaw go jako Fly secret (PRZED uruchomieniem nowego obrazu):
fly secrets set CAPABILITY_TOKEN_PEPPER=<WYGENEROWANA_WARTOSC>

# 6. Dopiero potem:
fly deploy
```

**⚠️ Backup sprzed migracji zawiera AKTYWNE surowe bearer tokeny wszystkich rozmów — traktuj go
jak zbiór sekretów.** Nie wrzucaj do Git/OneDrive/publicznego storage bez szyfrowania; przechowuj
lokalnie zaszyfrowany; po zakończeniu ustalonego okna rollbacku **bezpiecznie usuń**. Dopóki nie
ma rotacji/expiry tokenów, każdy stary snapshot/backup pozostaje źródłem działających raw tokenów.

Zasady (twarde):
- **NIE wpisuj peppera do `fly.toml`** ani do repo — wyłącznie `fly secrets`.
- **NIE generuj nowego peppera przy każdym deployu** — zmiana peppera unieważnia wszystkie
  istniejące sesje par (digesty przestają pasować). Ustaw raz i trzymaj stabilnie.
- Sekret musi być ustawiony **zanim** nowy obraz wystartuje — inaczej kontener odmówi startu
  (to zamierzone: bezpieczne zatrzymanie zamiast zapisu plaintextu).
- Istniejące surowe tokeny klientów **pozostają ważne** — migracja podmienia tylko zapis w bazie.
- Startupowa migracja robi też **fizyczny scrub pliku SQLite** (checkpoint WAL → VACUUM →
  checkpoint): plaintext znika także z bajtów pliku/-wal/-journal. Lazy-migracja w trakcie
  requestu NIE robi VACUUM — dlatego **produkcyjny deployment zawsze musi przejść przez migrację
  startupową** (Dockerfile to wymusza). Granica gwarancji: pliki bazy — nie remanencja na poziomie
  systemu plików ani wcześniejsze backupy.

Po udanym deployu (w tej kolejności):
1. `fly logs` — linia `[capability-token-migration] migrated=… alreadyHashed=… missing=…`
   (**wyłącznie liczniki**, nigdy tokenów) i brak błędów startu.
2. Test poprawnego dostępu **istniejącym** tokenem (otwarta wcześniej rozmowa nadal działa).
3. **Nowy backup post-migration** (już bez plaintextu — ta sama procedura online backup).
4. Dopiero po ustalonym oknie rollbacku usuń backup plaintextowy sprzed migracji.

## Rollback po migracji capability tokenów

- Migracja in-place jest **zgodna do przodu, ale NIE ze starym kodem**: poprzedni backend
  porównuje token przez `===` z wartością kolumny, więc **nie potrafi zweryfikować `v1:HMAC`** —
  wszystkie sesje przestałyby działać.
- **Samo wdrożenie poprzedniego obrazu NIE jest poprawnym rollbackiem.** Rollback do wersji
  sprzed tego PR wymaga JEDNOCZEŚNIE przywrócenia bazy sprzed migracji
  (`db.before-capability-hmac.sqlite` → `/data/db.sqlite` przy zatrzymanej aplikacji).
- Przywrócenie starej bazy **traci rozmowy utworzone po backupie** — stąd zalecenie
  wykonywania pierwszego deployu w kontrolowanym oknie bez zapisu.

## Kolejne deploye
```bash
fly deploy
```
`schema_evolution: auto` migruje schemat bez utraty danych, a migracja tokenów jest idempotentna
(kolejne starty: `migrated=0`). Dane żyją na wolumenie `/data`, więc redeploy/restart ich nie kasuje
(w przeciwieństwie do lokalnego `cds deploy`).

## Konfiguracja środowiska
Jawne (niewrażliwe) zmienne są w `fly.toml [env]`; sekrety przez `fly secrets`.

| Zmienna | Gdzie | Uwaga |
|---|---|---|
| `NODE_ENV=production` | fly.toml | aktywuje profil CAP `[production]` (baza na `/data`) |
| `ADVISOR=anthropic` | fly.toml | realny model (nie mock) |
| `ADVISOR_MODEL` | fly.toml | bazowy/fallback; domyślnie `claude-haiku-4-5` |
| `ADVISOR_DECIDE_MODEL` | fly.toml | model warstwy reżysera (decide); `claude-haiku-4-5` |
| `ADVISOR_GENERATE_MODEL` | fly.toml | model warstwy generacji dymek; `claude-sonnet-4-6` (trafność psychologiczna) |
| `ADVISOR_CACHE_TTL` | fly.toml | `1h` (ludzie odpowiadają wolno; 5m wygasał) |
| `ADVISOR_GLOBAL_BUDGET_USD` | fly.toml | globalny dzienny limit kosztu (bezpiecznik) |
| `ANTHROPIC_API_KEY` | **secret** | wymagany |
| `ADMIN_API_KEY` | **secret** | długi/losowy; bez niego `/admin` = 503 |
| `CAPABILITY_TOKEN_PEPPER` | **secret** | ≥32 bajty, STABILNY między deployami; bez niego kontener nie startuje |

Pełna lista progów (budżet per-sesja, rate-limity, timeout) → [SAFETY.md](SAFETY.md) i `srv/advisor/config.js`;
ustawia się je tak samo (`fly secrets set` lub `fly.toml [env]`).

## Weryfikacja po deployu
```bash
fly logs                                              # start: cds deploy → serwer na :4004
curl https://<nazwa>.fly.dev/health                   # {"status":"ok","advisor":"anthropic"}
curl https://<nazwa>.fly.dev/admin/Conversations      # 401 bez tokenu (bramka działa)
curl -H "Authorization: Bearer <ADMIN_API_KEY>" https://<nazwa>.fly.dev/admin/Conversations  # 200
```
Front: `fly open` → czat ładuje się z `/`, wiadomości idą przez `/chat` (SSE) na tym samym origin.

## Backup bazy (zalecane przy testerach)
```bash
fly ssh console -C "cp /data/db.sqlite /data/db.sqlite.bak"   # ad-hoc kopia na wolumenie
# lub pobranie lokalnie:
fly ssh sftp get /data/db.sqlite ./db.backup.sqlite
```

## Własna domena (opcjonalnie, później)
Subdomena `*.fly.dev` z HTTPS działa od razu. Dla własnej domeny:
```bash
fly certs add relvia.pl       # pokaże rekordy DNS (A/AAAA lub CNAME) do dodania u rejestratora
fly certs show relvia.pl      # status certyfikatu (Let's Encrypt, automat)
```

## Uwagi / ograniczenia (świadome, MVP)
- **Jedna instancja.** Rate-limit jest in-memory (per proces), a wolumen montuje się do jednej
  maszyny. Surowy `accessToken` żyje w pamięci frontendu klienta, ale credential WERYFIKACYJNY
  jest w bazie jako digest `v1:HMAC` (nie plaintext) — patrz SAFETY.md. Skalowanie poziome →
  najpierw Postgres + Redis (patrz [PRODUCTION.md](PRODUCTION.md) §Skalowanie).
- **`X-Forwarded-For`** ustawia Fly — rate-limit per IP czyta z niego poprawnie.
- **Lokalny test obrazu** (opcjonalnie): `docker build -t relvia . && docker run -p 4004:4004 -e ANTHROPIC_API_KEY=... -e CAPABILITY_TOKEN_PEPPER=<TESTOWY_STABILNY_PEPPER_MIN_32_BAJTY> -v %cd%/data:/data relvia`.
