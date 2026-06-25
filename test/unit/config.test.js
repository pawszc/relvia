/**
 * Unit testy centralnego configu ochrony (config.js). 0 tokenów, 0 sieci.
 * Pilnują, że JEDEN punkt prawdy ma sensowne domyślne progi i poprawnie czyta env.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'srv', 'advisor', 'config.js');

/** Świeży require config.js z podmienionym env (busting cache modułu). */
function freshConfig(env = {}) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  delete require.cache[require.resolve(CONFIG_PATH)];
  try {
    return require(CONFIG_PATH);
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[require.resolve(CONFIG_PATH)];
  }
}

test('config: domyślne progi ochrony (budżet $0.50, cache 5m, flagi ON, rate 1500ms)', () => {
  const c = freshConfig({
    ADVISOR_BUDGET_USD: undefined,
    ADVISOR_BUDGET_ENABLED: undefined,
    ADVISOR_CACHE_ENABLED: undefined,
    ADVISOR_CACHE_TTL: undefined,
    ADVISOR_RATELIMIT_ENABLED: undefined,
    ADVISOR_RATELIMIT_MIN_MS: undefined,
    ADVISOR_GLOBAL_BUDGET_ENABLED: undefined,
    ADVISOR_GLOBAL_BUDGET_USD: undefined,
    ADVISOR_GLOBAL_WINDOW_HOURS: undefined,
  });
  assert.equal(c.conversationBudgetUsd, 0.5, 'domyślny budżet per-sesja $0.50');
  assert.equal(c.budgetEnabled, true);
  assert.equal(c.cacheEnabled, true);
  assert.equal(c.cacheTtl, '5m', 'domyślny TTL = 5m');
  assert.equal(c.rateLimitEnabled, true);
  assert.equal(c.rateLimitMinIntervalMs, 800);
  assert.equal(c.globalBudgetEnabled, true, 'globalny limit domyślnie ON');
  assert.equal(c.globalDailyBudgetUsd, 20, 'domyślny globalny limit $20');
  assert.equal(c.globalWindowMs, 24 * 3600 * 1000, 'domyślne okno 24h');
  assert.ok(typeof c.model === 'string' && c.model.length > 0, 'model z models.js');
});

test('config: domyślne progi odporności/walidacji i dostępu', () => {
  const c = freshConfig({
    ADVISOR_MAX_MESSAGE_CHARS: undefined,
    ADVISOR_ANTHROPIC_TIMEOUT_MS: undefined,
    ADVISOR_NEWCONV_MIN_MS: undefined,
    ADVISOR_NEWCONV_MAX_PER_HOUR: undefined,
    ADVISOR_NEWCONV_WINDOW_MS: undefined,
    ADVISOR_NEWCONV_RATELIMIT: undefined,
    ADVISOR_ACCESS_CONTROL: undefined,
    ADMIN_API_KEY: undefined,
  });
  assert.equal(c.maxMessageChars, 4000, 'domyślny cap długości wiadomości');
  assert.equal(c.anthropicTimeoutMs, 60000, 'domyślny timeout Anthropic 60s');
  assert.equal(c.decideMaxTokens, 400, 'token cap decyzji');
  assert.equal(c.replyMaxTokens, 1024, 'token cap dymki');
  assert.equal(c.newConvRateLimitEnabled, true, 'limit nowych rozmów domyślnie ON');
  assert.equal(c.newConversationMinIntervalMs, 2000, 'odstęp 2s między nowymi rozmowami');
  assert.equal(c.newConversationMaxPerHour, 30, 'twardy limit 30 nowych rozmów/h');
  assert.equal(c.newConversationWindowMs, 3600000, 'okno 1h');
  assert.equal(c.accessControlEnabled, true, 'kontrola dostępu domyślnie ON');
  assert.equal(c.adminApiKey, '', 'brak klucza admina domyślnie (admin wyłączony)');
});

test('config: env nadpisuje globalny limit i okno', () => {
  const c = freshConfig({ ADVISOR_GLOBAL_BUDGET_USD: '50', ADVISOR_GLOBAL_WINDOW_HOURS: '12' });
  assert.equal(c.globalDailyBudgetUsd, 50);
  assert.equal(c.globalWindowMs, 12 * 3600 * 1000);
});

test('config: env nadpisuje budżet, TTL i flagi', () => {
  const c = freshConfig({
    ADVISOR_BUDGET_USD: '1.25',
    ADVISOR_CACHE_TTL: '1h',
    ADVISOR_BUDGET_ENABLED: 'false',
    ADVISOR_RATELIMIT_MIN_MS: '3000',
  });
  assert.equal(c.conversationBudgetUsd, 1.25);
  assert.equal(c.cacheTtl, '1h');
  assert.equal(c.budgetEnabled, false);
  assert.equal(c.rateLimitMinIntervalMs, 3000);
});

test('config: nieznany TTL degraduje do 5m (tylko 5m/1h dozwolone)', () => {
  const c = freshConfig({ ADVISOR_CACHE_TTL: 'banana' });
  assert.equal(c.cacheTtl, '5m');
});

test('config: śmieciowy budżet → domyślny 0.50 (parser num odporny)', () => {
  const c = freshConfig({ ADVISOR_BUDGET_USD: 'xyz' });
  assert.equal(c.conversationBudgetUsd, 0.5);
});

test('config: flagi bool akceptują 1/true/yes/on i wyłączają na 0/false', () => {
  assert.equal(freshConfig({ ADVISOR_CACHE_ENABLED: '0' }).cacheEnabled, false);
  assert.equal(freshConfig({ ADVISOR_CACHE_ENABLED: 'off' }).cacheEnabled, false);
  assert.equal(freshConfig({ ADVISOR_RATELIMIT_ENABLED: 'yes' }).rateLimitEnabled, true);
});
