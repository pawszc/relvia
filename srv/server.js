/**
 * Własny bootstrap serwera CAP.
 *
 * Jedyne zadanie: wczytać zmienne z pliku `relvia.env` do process.env
 * ZANIM CAP załaduje usługi i handlery (m.in. advisor.js, które czyta ADVISOR
 * i ANTHROPIC_API_KEY). Bez tego CAP nie czyta tego pliku automatycznie.
 *
 * Dalej działa standardowy serwer CAP.
 */
const path = require('node:path');
// ścieżka bezwzględna (plik leży w katalogu projektu, server.js w srv/)
require('dotenv').config({ path: path.resolve(__dirname, '..', 'relvia.env') });

const cds = require('@sap/cds');

// Bramka /admin: chroni AdminService (pełny OData bazy) bearer-tokenem ZANIM
// zamontuje się router serwisu. Bez ADMIN_API_KEY /admin oddaje 503 (wyłączony).
const { adminGate } = require('./admin-auth');
cds.on('bootstrap', (app) => {
  // Health check dla hosta / load balancera / monitoringu (publiczny, bez sekretów).
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', advisor: (process.env.ADVISOR || 'mock').toLowerCase() });
  });
  // Bramka /admin: chroni AdminService bearer-tokenem ZANIM zamontuje się router serwisu.
  app.use('/admin', adminGate);
});

module.exports = cds.server;
