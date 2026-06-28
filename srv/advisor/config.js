/**
 * Centralny config warstwy doradcy — JEDNO MIEJSCE na flagi, progi i parametry
 * ochrony (budżet, rate limit, prompt caching). Domyślne sensowne wartości żyją
 * tutaj; każdą można nadpisać zmienną środowiskową (relvia.env).
 *
 * Model i jego stawki NIE są tu duplikowane — pochodzą z models.js
 * (`activeModel()` / `ADVISOR_MODEL`). Tu jest tylko wygodny getter `model`.
 */
const { activeModel } = require('./models');

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

const CONFIG = {
  // --- BUDŻET KONWERSACJI ---------------------------------------------------
  // Twardy próg kosztu (USD) na pojedynczą konwersację. Po przekroczeniu doradca
  // wchodzi w łagodny read-only: ZERO dalszych wywołań modelu, tylko echo
  // wiadomości pary. Egzekwowane w chat-service.js PRZED `decide`.
  // Uwaga: tura, która przekracza próg, dokańcza się normalnie — blokada działa
  // od następnej (overshoot ≤ koszt jednej tury, rzędu centa).
  budgetEnabled: bool(process.env.ADVISOR_BUDGET_ENABLED, true),
  conversationBudgetUsd: num(process.env.ADVISOR_BUDGET_USD, 0.5),

  // --- GLOBALNY DZIENNY LIMIT (cała aplikacja) ------------------------------
  // Bezpiecznik na całą aplikację: jeśli łączny koszt WSZYSTKICH konwersacji z
  // ostatnich `globalWindowMs` (domyślnie 24h) przekroczy próg, każda rozmowa
  // wchodzi w ten sam łagodny read-only co budżet per-sesja. Stan przejściowy —
  // „odżywa" sam, gdy stare zużycie wypadnie z okna 24h (bez flagi na konwersacji).
  globalBudgetEnabled: bool(process.env.ADVISOR_GLOBAL_BUDGET_ENABLED, true),
  globalDailyBudgetUsd: num(process.env.ADVISOR_GLOBAL_BUDGET_USD, 20),
  globalWindowMs: num(process.env.ADVISOR_GLOBAL_WINDOW_HOURS, 24) * 3600 * 1000,

  // --- PROMPT CACHING (warstwa decyzji `decide`) ----------------------------
  // Cache prefiksu historii: model dostaje pełen, identyczny kontekst, ale za
  // znany początek płacimy ~0,1× zamiast 1×. Bezstratne — nie skraca rozmowy.
  // TTL = jak długo wpis żyje od ostatniego użycia:
  //   '5m' → zapis 1,25×, gubi cache po >5 min ciszy (domyślny),
  //   '1h' → zapis 2×, przeżywa dłuższe pauzy „z rąk do rąk".
  cacheEnabled: bool(process.env.ADVISOR_CACHE_ENABLED, true),
  // Domyślnie '1h': ludzie w rozmowie odpowiadają wolno (często >5 min), więc 5-min
  // cache wygasał i płaciliśmy drogie re-zapisy. 1h przeżywa pauzy „z rąk do rąk".
  // Nadpisywalne: ADVISOR_CACHE_TTL=5m wraca do krótszego.
  cacheTtl: process.env.ADVISOR_CACHE_TTL === '5m' ? '5m' : '1h',

  // --- RATE LIMIT (ochrona publicznego endpointu) ---------------------------
  // Minimalny odstęp między wiadomościami w obrębie jednej konwersacji.
  // Para „z rąk do rąk" tego nie dotknie; skrypt zalewający — owszem.
  rateLimitEnabled: bool(process.env.ADVISOR_RATELIMIT_ENABLED, true),
  // Odstęp między wiadomościami: na tyle mały, by człowiek mógł pisać „wiadomość po
  // wiadomości", na tyle duży, by blokować skrypt zalewający. 800 ms ≈ ludzki limit.
  rateLimitMinIntervalMs: num(process.env.ADVISOR_RATELIMIT_MIN_MS, 800),
  // Anty-spam tworzenia konwersacji per IP (osobna flaga — testy orkiestracji ją wyłączają).
  // Dwa dławiki naraz: ODSTĘP (tempo) + TWARDY LIMIT na okno (ile łącznie na godzinę).
  newConvRateLimitEnabled: bool(process.env.ADVISOR_NEWCONV_RATELIMIT, true),
  newConversationMinIntervalMs: num(process.env.ADVISOR_NEWCONV_MIN_MS, 2000),
  newConversationMaxPerHour: num(process.env.ADVISOR_NEWCONV_MAX_PER_HOUR, 30),
  newConversationWindowMs: num(process.env.ADVISOR_NEWCONV_WINDOW_MS, 3600000),

  // --- WALIDACJA WEJŚCIA ----------------------------------------------------
  // Twardy limit długości pojedynczej wiadomości (znaki). Bez tego jeden user mógłby
  // wkleić megabajt → ogromny koszt tokenów. ~4000 znaków ≈ kilka akapitów czatu.
  maxMessageChars: num(process.env.ADVISOR_MAX_MESSAGE_CHARS, 4000),

  // --- ODPORNOŚĆ ------------------------------------------------------------
  // Timeout (ms) na wywołania modelu Anthropic. Bez tego SDK ma default 10 min →
  // zawieszony model = wiszące SSE. 60 s wystarcza (generacja jest krótka, max_tokens≤1024).
  anthropicTimeoutMs: num(process.env.ADVISOR_ANTHROPIC_TIMEOUT_MS, 60000),

  // --- LIMITY GENERACJI (token caps modelu) ---------------------------------
  // Twarde sufity wyjścia modelu: decyzja (JSON, krótka) i dymka doradcy. Trzymane
  // tu, by wszystkie limity były w JEDNYM miejscu (nie zaszyte w anthropicAdvisor).
  decideMaxTokens: num(process.env.ADVISOR_DECIDE_MAX_TOKENS, 400),
  replyMaxTokens: num(process.env.ADVISOR_REPLY_MAX_TOKENS, 1024),
  // Temperatura GENERACJI dymki. Domyślnie 1.0 (zachowanie prod). Niższa (np. 0.7)
  // = mniej „kreatywnego" zjazdu w szablon, węższa wariancja języka. Eksperyment: ADVISOR_GENERATE_TEMP=0.7
  generateTemp: num(process.env.ADVISOR_GENERATE_TEMP, 1),

  // --- KONTROLA DOSTĘPU (capability token per konwersacja) ------------------
  // Gdy ON (domyślnie): każda akcja ChatService wymaga `accessToken` pasującego do
  // konwersacji (403 bez niego). Wyłączane tylko w testach, które sprawdzają INNE
  // rzeczy niż dostęp (silnik/budżet/rate limit) — dedykowany test trzyma to ON.
  accessControlEnabled: bool(process.env.ADVISOR_ACCESS_CONTROL, true),

  // --- ADMIN (pełny wgląd w bazę przez /admin) ------------------------------
  // Serwis AdminService (/admin) wystawia całą bazę przez OData, ale TYLKO dla
  // żądań z nagłówkiem `Authorization: Bearer <adminApiKey>`. Bez ustawionego
  // klucza /admin jest WYŁĄCZONY (503) — bezpieczny default. Sekret z env.
  adminApiKey: (process.env.ADMIN_API_KEY || '').trim(),

  /** Aktywny model (z models.js / ADVISOR_MODEL) — bez duplikowania stawek. */
  get model() {
    return activeModel();
  },
};

module.exports = CONFIG;
