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
module.exports = cds.server;
