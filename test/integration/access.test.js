/**
 * Integration: KONTROLA DOSTĘPU (capability token per konwersacja). 0 TOKENÓW (mock).
 *
 * Kontrola WŁĄCZONA (domyślnie). Sprawdzamy, że bez/ze złym `accessToken` akcje
 * dają 403, a z poprawnym działają — oraz że token jednej konwersacji NIE otwiera
 * innej (brak IDOR). Budżety/rate limit wyłączone, by nie kolidowały.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_FILE = path.join(os.tmpdir(), `relvia-access-${process.pid}.sqlite`);
process.env.ADVISOR = 'mock';
process.env.ADVISOR_ACCESS_CONTROL = 'true'; // TEN plik testuje dostęp → kontrola ON
// hash w spoczynku: kontrola dostępu wymaga peppera (≥32 bajty) — wartość test-only
process.env.CAPABILITY_TOKEN_PEPPER = 'test-only-capability-pepper-at-least-32-bytes';
process.env.ADVISOR_BUDGET_ENABLED = 'false';
process.env.ADVISOR_GLOBAL_BUDGET_ENABLED = 'false';
process.env.ADVISOR_RATELIMIT_ENABLED = 'false';
process.env.ADVISOR_NEWCONV_RATELIMIT = 'false'; // tworzymy wiele rozmów (A, B…)
process.env.cds_requires_db_credentials_url = DB_FILE;

const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const rmDb = () => { for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) try { fs.unlinkSync(f); } catch {} };

const PROJECT = path.join(__dirname, '..', '..');
const LONG = 'To jest dłuższa, treściwa wypowiedź o tym, co naprawdę czuję w tej sytuacji każdego dnia.';

let srv;
before(async () => {
  rmDb();
  execFileSync('npx', ['cds', 'deploy', '--to', `sqlite:${DB_FILE}`], { cwd: PROJECT, stdio: 'ignore', shell: true });
  await cds.test(PROJECT);
  srv = await cds.connect.to('ChatService');
});
after(rmDb);

test('startConversation zwraca niepusty accessToken', async () => {
  const r = await srv.send('startConversation', {});
  assert.ok(r.conversationId);
  assert.ok(typeof r.accessToken === 'string' && r.accessToken.length > 0, 'token wydany');
});

test('sendMessage BEZ tokenu → 403', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG }),
    /FORBIDDEN/i,
  );
});

test('sendMessage ze ZŁYM tokenem → 403', async () => {
  const { conversationId } = await srv.send('startConversation', {});
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId, author: 'HER', text: LONG, accessToken: 'zły-token' }),
    /FORBIDDEN/i,
  );
});

test('sendMessage z POPRAWNYM tokenem → działa', async () => {
  const { conversationId, accessToken } = await srv.send('startConversation', {});
  const r = await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG, accessToken });
  assert.ok(r.advisorMessageId, 'tura przeszła');
});

test('getHistory wymaga tokenu (bez → 403, z → lista)', async () => {
  const { conversationId, accessToken } = await srv.send('startConversation', {});
  await srv.send('sendMessage', { conversationId, author: 'HER', text: LONG, accessToken });
  await assert.rejects(() => srv.send('getHistory', { conversationId }), /FORBIDDEN/i);
  const hist = await srv.send('getHistory', { conversationId, accessToken });
  assert.ok(Array.isArray(hist) && hist.length >= 1, 'historia z poprawnym tokenem');
});

test('conversationState / setAdvisorMode też wymagają tokenu', async () => {
  const { conversationId, accessToken } = await srv.send('startConversation', {});
  await assert.rejects(() => srv.send('conversationState', { conversationId }), /FORBIDDEN/i);
  const st = await srv.send('conversationState', { conversationId, accessToken });
  assert.equal(st.advisorMode, 'LEADING');
  await assert.rejects(() => srv.send('setAdvisorMode', { conversationId, mode: 'PAUSED' }), /FORBIDDEN/i);
});

test('IDOR: token konwersacji A NIE otwiera konwersacji B', async () => {
  const a = await srv.send('startConversation', {});
  const b = await srv.send('startConversation', {});
  await assert.rejects(
    () => srv.send('sendMessage', { conversationId: b.conversationId, author: 'HER', text: LONG, accessToken: a.accessToken }),
    /FORBIDDEN/i,
    'token A nie działa na B',
  );
});

test('nieistniejąca konwersacja → 403 (brak enumeracji)', async () => {
  await assert.rejects(
    () => srv.send('conversationState', { conversationId: cds.utils.uuid(), accessToken: 'cokolwiek' }),
    /FORBIDDEN/i,
  );
});

// ── WŁASNOŚĆ ZAPARKOWANYCH TEMATÓW (anty-IDOR zasobu PODRZĘDNEGO) ───────────
// assertAccess chroni konwersację (rodzica); te testy pilnują, żeby topicId —
// globalny UUID — był ZAWSZE wiązany z uwierzytelnionym conversationId.
// Tematy wstawiamy wprost do izolowanej bazy (cds.db), nie przez model AI.

const CONVERSATIONS = 'relvia.Conversations';
const PARKED_TOPICS = 'relvia.ParkedTopics';

/** Wstawia zaparkowany temat bezpośrednio do DB (0 wywołań modelu). */
async function createParkedTopic(conversationId, text, status = 'OPEN') {
  const ID = cds.utils.uuid();
  await cds.db.run(
    INSERT.into(PARKED_TOPICS).entries({ ID, conversation_ID: conversationId, text, status, parkedAtSeq: 1 }),
  );
  return ID;
}

const readTopic = async (topicId) =>
  (await cds.db.read(PARKED_TOPICS).where({ ID: topicId }))[0];
const readConvTopic = async (conversationId) =>
  (await cds.db.read(CONVERSATIONS).columns('topic').where({ ID: conversationId }))[0].topic;

test('resolveParkedTopic wymaga tokenu (bez/zły → 403; temat zostaje OPEN)', async () => {
  const a = await srv.send('startConversation', {});
  const topicId = await createParkedTopic(a.conversationId, 'temat A');
  await assert.rejects(
    () => srv.send('resolveParkedTopic', { conversationId: a.conversationId, topicId, action: 'RESOLVED' }),
    /FORBIDDEN/i,
    'bez tokenu',
  );
  await assert.rejects(
    () => srv.send('resolveParkedTopic', { conversationId: a.conversationId, topicId, action: 'RESOLVED', accessToken: 'zły-token' }),
    /FORBIDDEN/i,
    'zły token',
  );
  assert.equal((await readTopic(topicId)).status, 'OPEN', 'temat nietknięty');
});

test('resolveParkedTopic: token A na conversationId B → 403 (ochrona rodzica); temat B zostaje OPEN', async () => {
  const a = await srv.send('startConversation', {});
  const b = await srv.send('startConversation', {});
  const topicB = await createParkedTopic(b.conversationId, 'temat B');
  await assert.rejects(
    () =>
      srv.send('resolveParkedTopic', {
        conversationId: b.conversationId,
        topicId: topicB,
        action: 'RESOLVED',
        accessToken: a.accessToken,
      }),
    /FORBIDDEN/i,
  );
  assert.equal((await readTopic(topicB)).status, 'OPEN');
});

for (const action of ['PROMOTE', 'RESOLVED', 'DISMISSED']) {
  test(`IDOR tematu (${action}): token A + topicId z konwersacji B → ok:false, ZERO zmian w A i B`, async () => {
    const a = await srv.send('startConversation', {});
    // kontrolna kotwica A — nie może zostać nadpisana tekstem obcego tematu
    await cds.db.run(UPDATE(CONVERSATIONS).set({ topic: 'kotwica A' }).where({ ID: a.conversationId }));
    const b = await srv.send('startConversation', {});
    const secretText = `tajny temat B — ${action}`;
    const topicB = await createParkedTopic(b.conversationId, secretText);

    const r = await srv.send('resolveParkedTopic', {
      conversationId: a.conversationId, // rodzic uwierzytelniony poprawnie…
      topicId: topicB, // …ale temat należy do B
      action,
      accessToken: a.accessToken,
    });
    assert.equal(r.ok, false, `${action}: obcy temat = wynik neutralny`);

    const tb = await readTopic(topicB);
    assert.equal(tb.status, 'OPEN', `${action}: status tematu B bez zmian`);
    assert.equal(tb.conversation_ID, b.conversationId, `${action}: temat nadal należy do B`);
    assert.equal(tb.text, secretText, `${action}: tekst tematu B bez zmian`);
    assert.equal(await readConvTopic(a.conversationId), 'kotwica A', `${action}: kotwica A nietknięta`);
  });
}

test('obcy topicId i nieistniejący topicId są NIEROZRÓŻNIALNE (ten sam ok:false, zero zmian)', async () => {
  const a = await srv.send('startConversation', {});
  await cds.db.run(UPDATE(CONVERSATIONS).set({ topic: 'kotwica A' }).where({ ID: a.conversationId }));
  const b = await srv.send('startConversation', {});
  const topicB = await createParkedTopic(b.conversationId, 'temat B do enumeracji');

  const foreign = await srv.send('resolveParkedTopic', {
    conversationId: a.conversationId, topicId: topicB, action: 'PROMOTE', accessToken: a.accessToken,
  });
  const missing = await srv.send('resolveParkedTopic', {
    conversationId: a.conversationId, topicId: cds.utils.uuid(), action: 'PROMOTE', accessToken: a.accessToken,
  });
  assert.equal(foreign.ok, false);
  assert.equal(missing.ok, false, 'obcy i nieistniejący → identycznie neutralnie');
  assert.equal((await readTopic(topicB)).status, 'OPEN');
  assert.equal(await readConvTopic(a.conversationId), 'kotwica A');
});

test('regresja pozytywna: PROMOTE własnego tematu → kotwica = tekst tematu, status RESOLVED', async () => {
  const a = await srv.send('startConversation', {});
  const topicId = await createParkedTopic(a.conversationId, 'własny temat do promocji');
  const r = await srv.send('resolveParkedTopic', {
    conversationId: a.conversationId, topicId, action: 'PROMOTE', accessToken: a.accessToken,
  });
  assert.equal(r.ok, true, 'PROMOTE własnego tematu przechodzi');
  assert.equal(await readConvTopic(a.conversationId), 'własny temat do promocji');
  assert.equal((await readTopic(topicId)).status, 'RESOLVED');
});

for (const action of ['RESOLVED', 'DISMISSED']) {
  test(`regresja pozytywna: ${action} własnego tematu → status ${action}, kotwica bez zmian`, async () => {
    const a = await srv.send('startConversation', {});
    await cds.db.run(UPDATE(CONVERSATIONS).set({ topic: 'kotwica A' }).where({ ID: a.conversationId }));
    const topicId = await createParkedTopic(a.conversationId, `własny temat — ${action}`);
    const r = await srv.send('resolveParkedTopic', {
      conversationId: a.conversationId, topicId, action, accessToken: a.accessToken,
    });
    assert.equal(r.ok, true, `${action} własnego tematu przechodzi`);
    assert.equal((await readTopic(topicId)).status, action);
    assert.equal(await readConvTopic(a.conversationId), 'kotwica A', `${action}: kotwica przypadkiem nie zmieniona`);
  });
}

// ── HASH CAPABILITY TOKENÓW W SPOCZYNKU (v1:HMAC-SHA-256) ───────────────────
// Surowy token widzi tylko klient; baza trzyma digest. Wyciek DB/adminu nie
// daje bearer tokenu. Komunikaty asercji celowo NIE wypisują wartości tokenów.

const DIGEST_RE = /^v1:[0-9a-f]{64}$/;
/** Przechowywany credential konwersacji (kolumna accessToken = digest, nazwa historyczna). */
const readStoredCredential = async (conversationId) =>
  (await cds.db.read(CONVERSATIONS).columns('accessToken').where({ ID: conversationId }))[0].accessToken;

test('nowa konwersacja przechowuje WYŁĄCZNIE HMAC (nie raw token), a raw token nadal autoryzuje', async () => {
  const a = await srv.send('startConversation', {});
  assert.ok(typeof a.accessToken === 'string' && a.accessToken.length > 0, 'klient dostał surowy token');
  const stored = await readStoredCredential(a.conversationId);
  assert.notEqual(stored, a.accessToken, 'DB nie zawiera surowego tokenu');
  assert.match(stored, DIGEST_RE, 'DB zawiera wersjonowany digest v1:<64 hex>');
  const st = await srv.send('conversationState', { conversationId: a.conversationId, accessToken: a.accessToken });
  assert.equal(st.advisorMode, 'LEADING', 'surowy token nadal autoryzuje request');
});

test('digest z bazy NIE działa jako bearer token → neutralny 403', async () => {
  const a = await srv.send('startConversation', {});
  const stored = await readStoredCredential(a.conversationId);
  await assert.rejects(
    () => srv.send('conversationState', { conversationId: a.conversationId, accessToken: stored }),
    /FORBIDDEN/i,
    'kradzież digestu z DB/adminu nie przejmuje rozmowy',
  );
  await assert.rejects(
    () => srv.send('getHistory', { conversationId: a.conversationId, accessToken: stored }),
    /FORBIDDEN/i,
  );
});

test('lazy migracja: legacy raw token w DB → akcja przechodzi i DB dostaje digest v1', async () => {
  // historyczna konwersacja sprzed hashowania: surowy UUID wprost w kolumnie
  const ID = cds.utils.uuid();
  const legacyRaw = cds.utils.uuid();
  await cds.db.run(INSERT.into(CONVERSATIONS).entries({ ID, accessToken: legacyRaw }));

  const st = await srv.send('conversationState', { conversationId: ID, accessToken: legacyRaw });
  assert.equal(st.advisorMode, 'LEADING', 'legacy token pozostaje ważny po wdrożeniu');

  const stored = await readStoredCredential(ID);
  assert.match(stored, DIGEST_RE, 'po poprawnym requestcie credential zmigrowany do v1');
  assert.notEqual(stored, legacyRaw, 'digest ≠ surowy token');
  // zmigrowany digest nadal weryfikuje ten sam surowy token
  const st2 = await srv.send('conversationState', { conversationId: ID, accessToken: legacyRaw });
  assert.equal(st2.advisorMode, 'LEADING');
});

test('błędny token NIE migruje legacy wartości (403, DB bez zmian)', async () => {
  const ID = cds.utils.uuid();
  const legacyRaw = cds.utils.uuid();
  await cds.db.run(INSERT.into(CONVERSATIONS).entries({ ID, accessToken: legacyRaw }));

  await assert.rejects(
    () => srv.send('conversationState', { conversationId: ID, accessToken: cds.utils.uuid() }),
    /FORBIDDEN/i,
  );
  const stored = await readStoredCredential(ID);
  assert.equal(stored, legacyRaw, 'pierwotna wartość nietknięta — żaden digest z błędnego requestu');
});

test('niepoprawna action (DELETE) na własnym temacie → ok:false, zero zmian', async () => {
  const a = await srv.send('startConversation', {});
  await cds.db.run(UPDATE(CONVERSATIONS).set({ topic: 'kotwica A' }).where({ ID: a.conversationId }));
  const topicId = await createParkedTopic(a.conversationId, 'temat przy złej akcji');
  const r = await srv.send('resolveParkedTopic', {
    conversationId: a.conversationId, topicId, action: 'DELETE', accessToken: a.accessToken,
  });
  assert.equal(r.ok, false);
  assert.equal((await readTopic(topicId)).status, 'OPEN');
  assert.equal(await readConvTopic(a.conversationId), 'kotwica A');
});
