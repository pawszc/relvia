/**
 * Unit testy cennika / wyboru modelu. 0 tokenów.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { costUsd } = require('../../srv/advisor/pricing');
const { activeModel, ratesFor, DEFAULT_MODEL } = require('../../srv/advisor/models');

test('activeModel: znany ADVISOR_MODEL wygrywa, nieznany → domyślny', () => {
  const prev = process.env.ADVISOR_MODEL;
  process.env.ADVISOR_MODEL = 'claude-opus-4-8';
  assert.equal(activeModel(), 'claude-opus-4-8');
  process.env.ADVISOR_MODEL = 'nieistniejacy-model';
  assert.equal(activeModel(), DEFAULT_MODEL);
  if (prev === undefined) delete process.env.ADVISOR_MODEL;
  else process.env.ADVISOR_MODEL = prev;
});

test('costUsd: Haiku liczy in/out wg stawek (1/5 za 1M)', () => {
  const c = costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'claude-haiku-4-5');
  assert.equal(c, 6); // 1*1 + 1*5
});

test('costUsd: cache liczony osobno', () => {
  const r = ratesFor('claude-haiku-4-5');
  const c = costUsd({ cacheReadTokens: 1_000_000 }, 'claude-haiku-4-5');
  assert.equal(c, r.cacheRead);
});

test('costUsd: pusty usage → 0', () => {
  assert.equal(costUsd({}, 'claude-haiku-4-5'), 0);
});
