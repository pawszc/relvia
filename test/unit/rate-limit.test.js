/**
 * Unit testy throttle tworzenia konwersacji (`checkAndRecord`). 0 sieci, deterministyczne.
 * Pokrywa: ODSTĘP, TWARDY LIMIT na okno (godzina) i przycinanie poza oknem.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkAndRecord } = require('../../srv/rate-limit');

const CFG = { minIntervalMs: 2000, maxPerWindow: 3, windowMs: 3600000 };

test('pierwsze utworzenie zawsze przechodzi i zapisuje znacznik', () => {
  const r = checkAndRecord([], 1000, CFG);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.timestamps, [1000]);
});

test('ODSTĘP: drugie utworzenie w oknie odstępu → blokada INTERVAL', () => {
  const r = checkAndRecord([1000], 1500, CFG); // 500ms < 2000ms
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'INTERVAL');
  assert.deepEqual(r.timestamps, [1000], 'nie dopisuje zablokowanego');
});

test('ODSTĘP: po upływie minIntervalMs przechodzi', () => {
  const r = checkAndRecord([1000], 3500, CFG); // 2500ms ≥ 2000ms
  assert.equal(r.allowed, true);
  assert.deepEqual(r.timestamps, [1000, 3500]);
});

test('TWARDY LIMIT: po maxPerWindow utworzeniach w oknie → blokada WINDOW_CAP', () => {
  // 3 wpisy rozstawione poza odstępem, w oknie; 4. ma przepaść mimo zachowanego odstępu
  const ts = [0, 3000, 6000];
  const r = checkAndRecord(ts, 9000, CFG); // odstęp OK (3000≥2000), ale length 3 ≥ max 3
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'WINDOW_CAP');
});

test('OKNO: stare wpisy poza windowMs są przycinane i nie liczą się do limitu', () => {
  const now = 10_000_000;
  const old = now - CFG.windowMs - 1; // tuż POZA oknem
  const r = checkAndRecord([old, old, old], now, CFG);
  assert.equal(r.allowed, true, 'stare wpisy nie wliczają się do limitu');
  assert.deepEqual(r.timestamps, [now], 'przycięte do bieżącego okna');
});

test('OKNO: mieszanka — część w oknie, część poza; liczą się tylko aktualne', () => {
  const now = 10_000_000;
  const inWin = [now - 1000, now - 2000];
  const out = [now - CFG.windowMs - 5];
  const r = checkAndRecord([...out, ...inWin], now, { ...CFG, minIntervalMs: 0 });
  assert.equal(r.allowed, true, '2 w oknie < max 3 → przechodzi');
  assert.equal(r.timestamps.length, 3, '2 aktualne + nowy; stary odcięty');
});
