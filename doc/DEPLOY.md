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

# 4. Deploy.
fly deploy

# 5. Otwórz w przeglądarce.
fly open                 # → https://<twoja-nazwa>.fly.dev
```

## Kolejne deploye
```bash
fly deploy
```
`schema_evolution: auto` migruje schemat bez utraty danych. Dane żyją na wolumenie `/data`,
więc redeploy/restart ich nie kasuje (w przeciwieństwie do lokalnego `cds deploy`).

## Konfiguracja środowiska
Jawne (niewrażliwe) zmienne są w `fly.toml [env]`; sekrety przez `fly secrets`.

| Zmienna | Gdzie | Uwaga |
|---|---|---|
| `NODE_ENV=production` | fly.toml | aktywuje profil CAP `[production]` (baza na `/data`) |
| `ADVISOR=anthropic` | fly.toml | realny model (nie mock) |
| `ADVISOR_MODEL` | fly.toml | bazowy/fallback; domyślnie `claude-haiku-4-5` |
| `ADVISOR_DECIDE_MODEL` | fly.toml | model warstwy reżysera (decide); `claude-haiku-4-5` |
| `ADVISOR_GENERATE_MODEL` | fly.toml | model warstwy generacji dymek; `claude-sonnet-4-6` (jakość PL) |
| `ADVISOR_CACHE_TTL` | fly.toml | `1h` (ludzie odpowiadają wolno; 5m wygasał) |
| `ADVISOR_GLOBAL_BUDGET_USD` | fly.toml | globalny dzienny limit kosztu (bezpiecznik) |
| `ANTHROPIC_API_KEY` | **secret** | wymagany |
| `ADMIN_API_KEY` | **secret** | długi/losowy; bez niego `/admin` = 503 |

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
- **Jedna instancja.** Rate-limit i `accessToken` są in-memory (per proces), a wolumen montuje się do
  jednej maszyny. Skalowanie poziome → najpierw Postgres + Redis (patrz [PRODUCTION.md](PRODUCTION.md) §Skalowanie).
- **`X-Forwarded-For`** ustawia Fly — rate-limit per IP czyta z niego poprawnie.
- **Lokalny test obrazu** (opcjonalnie): `docker build -t relvia . && docker run -p 4004:4004 -e ANTHROPIC_API_KEY=... -v %cd%/data:/data relvia`.
