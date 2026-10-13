// node --test manage/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillDays, totals, fetchStats } from './stats.js';

test('fillDays zero-fills missing days across a month boundary', () => {
  const out = fillDays('2026-09-29', '2026-10-02', [{ day: '2026-09-30', views: 5, visitors: 2 }]);
  assert.deepEqual(out.map((d) => d.day), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(out.map((d) => d.views), [0, 5, 0, 0]);
  assert.deepEqual(totals(out), { views: 5, visitors: 2 });
});

test('fetchStats sends the bearer token and reports a bad token clearly', async () => {
  let seen;
  const ok = await fetchStats({ url: 'https://w.example/', token: 't' }, 7, async (url, init) => {
    seen = { url, auth: init.headers.authorization };
    return { ok: true, json: async () => ({ from: 'a' }) };
  });
  assert.deepEqual(seen, { url: 'https://w.example/stats?days=7', auth: 'Bearer t' });
  assert.equal(ok.from, 'a');
  await assert.rejects(fetchStats({ url: 'u', token: 'x' }, 7, async () => ({ ok: false, status: 401 })), /토큰/);
});
