/**
 * Bramka dostępu do AdminService (/admin). Wymaga nagłówka
 * `Authorization: Bearer <ADMIN_API_KEY>` (klucz z config.js / env ADMIN_API_KEY).
 *
 *  - brak ustawionego klucza w configu → 503 (admin WYŁĄCZONY — bezpieczny default),
 *  - brak / zły token                  → 401.
 *
 * Porównanie tokenów jest odporne na timing (`crypto.timingSafeEqual`).
 * `checkAdminAuth` jest czyste (bez Express) → testowalne jednostkowo.
 */
const crypto = require('crypto');
const CONFIG = require('./advisor/config');

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false; // różna długość → i tak nie równe
  return crypto.timingSafeEqual(ba, bb);
}

/** Czysta decyzja: (nagłówek Authorization, klucz admina) → {ok} albo {ok:false,status,message}. */
function checkAdminAuth(authHeader, adminApiKey) {
  if (!adminApiKey) return { ok: false, status: 503, message: 'ADMIN_DISABLED' };
  const m = /^Bearer\s+(.+)$/i.exec(String(authHeader || ''));
  const token = m ? m[1].trim() : '';
  if (!token || !timingSafeEqual(token, adminApiKey)) {
    return { ok: false, status: 401, message: 'UNAUTHORIZED' };
  }
  return { ok: true };
}

/** Express middleware na ścieżkę /admin (wpięty w server.js przez cds bootstrap). */
function adminGate(req, res, next) {
  const r = checkAdminAuth(req.headers && req.headers.authorization, CONFIG.adminApiKey);
  if (r.ok) return next();
  res.status(r.status);
  res.set('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: r.message }));
}

module.exports = { adminGate, checkAdminAuth };
