using relvia as db from '../db/schema';

/**
 * AdminService — ZAUFANY WIDOK OPERACYJNY bazy przez OData (read-only), który
 * CELOWO WYKLUCZA CREDENTIALE. Pod ścieżką `/admin`; do czytania danych
 * produkcyjnych z innego narzędzia (OData: $filter/$orderby/$expand, curl, Excel).
 *
 * ⚠ DOSTĘP: chroniony bramką w `srv/admin-auth.js` (wpięta w `srv/server.js`),
 * która wymaga nagłówka `Authorization: Bearer <ADMIN_API_KEY>`. Bez ustawionego
 * klucza /admin jest wyłączony (503). To NIE jest publiczny ChatService —
 * para nigdy nie dostaje tego endpointu. Szczegóły: SAFETY.md.
 *
 * ⚠ Conversations to JAWNA ALLOWLIST pól (bez `*`, bez `excluding`): kolumna
 * `accessToken` (digest capability tokenu) ani żaden przyszły credential NIGDY
 * nie mogą tu trafić — wyciek ADMIN_API_KEY nie może dawać materiału do
 * przejmowania rozmów. Nowe pole w db.Conversations trzeba dopisać tu ŚWIADOMIE.
 */
service AdminService @(path: '/admin') {
  @readonly entity Conversations as projection on db.Conversations {
    ID,
    createdAt,
    modifiedAt,
    title,
    herName,
    hisName,
    locale,
    phase,
    topic,
    advisorMode,
    turnsSinceProgress,
    escalationStreak,
    lastActivityAt,
    model,
    costUsd,
    lastComposerHint,
    budgetReached,
    decideInputTokens,
    decideOutputTokens,
    decideCacheReadTokens,
    decideCacheCreationTokens
  };
  @readonly entity Messages      as projection on db.Messages;
  @readonly entity ParkedTopics  as projection on db.ParkedTopics;
  @readonly entity UsageEvents   as projection on db.UsageEvents;
}
