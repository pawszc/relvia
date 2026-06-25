using relvia as db from '../db/schema';

/**
 * AdminService — pełny, ZAUFANY wgląd w całą bazę przez OData (read-only).
 * Pod ścieżką `/admin`. Przeznaczony do wygodnego czytania danych produkcyjnych
 * z innej aplikacji/narzędzia (OData: $filter/$orderby/$expand, curl, Excel itp.).
 *
 * ⚠ DOSTĘP: chroniony bramką w `srv/admin-auth.js` (wpięta w `srv/server.js`),
 * która wymaga nagłówka `Authorization: Bearer <ADMIN_API_KEY>`. Bez ustawionego
 * klucza /admin jest wyłączony (503). To NIE jest publiczny ChatService —
 * para nigdy nie dostaje tego endpointu. Szczegóły: SAFETY.md.
 */
service AdminService @(path: '/admin') {
  @readonly entity Conversations as projection on db.Conversations;
  @readonly entity Messages      as projection on db.Messages;
  @readonly entity ParkedTopics  as projection on db.ParkedTopics;
  @readonly entity UsageEvents   as projection on db.UsageEvents;
}
