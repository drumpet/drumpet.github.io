// node --test analytics/test.mjs   (uses node:sqlite as a stand-in for D1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from './src/worker.js';
import { kstDay, addDays, isBot, deviceOf, parseHit, refHost, safeEqual, clampDays, visitorHash } from './src/lib.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => db.prepare(sql).run(...args),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}

const SITE = 'https://anthonypaek.com';
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148 Safari/604.1';

function env() {
  return { DB: fakeD1(), ALLOWED_ORIGINS: `${SITE},http://localhost:8000`, STATS_TOKEN: 'secret' };
}

function beacon(body, { origin = SITE, ua = CHROME, ip = '1.2.3.4' } = {}) {
  const req = new Request('https://w.example/h', { method: 'POST', body, headers: { origin, 'user-agent': ua, 'cf-connecting-ip': ip, 'content-type': 'text/plain' } });
  return req;
}

const count = (e) => e.DB.raw.prepare('SELECT COUNT(*) AS n FROM hits').get().n;

test('kstDay and addDays', () => {
  assert.equal(kstDay(Date.parse('2026-10-13T14:59:59Z')), '2026-10-13');
  assert.equal(kstDay(Date.parse('2026-10-13T15:00:00Z')), '2026-10-14');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('bot and device detection', () => {
  assert.equal(isBot(''), true);
  assert.equal(isBot('Googlebot/2.1'), true);
  assert.equal(isBot('Mozilla/5.0 HeadlessChrome/140'), true);
  assert.equal(isBot(CHROME), false);
  assert.equal(deviceOf(IPHONE), 'mobile');
  assert.equal(deviceOf(CHROME), 'desktop');
});

test('parseHit keeps the path only and rejects junk', () => {
  assert.deepEqual(parseHit('{"p":"/blog/x/?utm=1#a","r":""}', SITE), { path: '/blog/x/', ref: null });
  assert.equal(parseHit('{"p":"https://evil/"}', SITE), null);
  assert.equal(parseHit('{"p":"/write/"}', SITE), null);
  assert.equal(parseHit('{"p":"/manage/"}', SITE), null);
  assert.equal(parseHit('not json', SITE), null);
  assert.equal(parseHit(JSON.stringify({ p: '/' + 'a'.repeat(400) }), SITE), null);
});

test('refHost drops same-site and non-http referrers', () => {
  assert.equal(refHost('https://www.linkedin.com/feed/', SITE), 'linkedin.com');
  assert.equal(refHost('https://anthonypaek.com/blog/x/', SITE), null);
  assert.equal(refHost('https://www.anthonypaek.com/', SITE), null);
  assert.equal(refHost('android-app://com.slack', SITE), null);
  assert.equal(refHost('garbage', SITE), null);
});

test('safeEqual and clampDays', () => {
  assert.equal(safeEqual('Bearer a', 'Bearer a'), true);
  assert.equal(safeEqual('Bearer a', 'Bearer b'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(clampDays('7'), 7);
  assert.equal(clampDays('9999'), 365);
  assert.equal(clampDays(undefined), 30);
});

test('visitorHash depends on the salt', async () => {
  const a = await visitorHash('s1', '1.2.3.4', CHROME);
  assert.equal(a, await visitorHash('s1', '1.2.3.4', CHROME));
  assert.notEqual(a, await visitorHash('s2', '1.2.3.4', CHROME));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('beacon from the site is recorded without storing the IP', async () => {
  const e = env();
  const res = await worker.fetch(beacon('{"p":"/blog/hello/","r":"https://www.linkedin.com/"}'), e);
  assert.equal(res.status, 204);
  const row = e.DB.raw.prepare('SELECT * FROM hits').get();
  assert.equal(row.path, '/blog/hello/');
  assert.equal(row.ref, 'linkedin.com');
  assert.equal(row.device, 'desktop');
  assert.equal(row.day, kstDay());
  assert.ok(!JSON.stringify(row).includes('1.2.3.4'));
});

test('beacons from other origins, bots, and the editor are ignored', async () => {
  const e = env();
  await worker.fetch(beacon('{"p":"/"}', { origin: 'https://evil.example' }), e);
  await worker.fetch(beacon('{"p":"/"}', { origin: '' }), e);
  await worker.fetch(beacon('{"p":"/"}', { ua: 'Googlebot/2.1' }), e);
  await worker.fetch(beacon('{"p":"/write/"}'), e);
  assert.equal(count(e), 0);
});

test('stats requires the token and aggregates views and visitors', async () => {
  const e = env();
  await worker.fetch(beacon('{"p":"/"}'), e);
  await worker.fetch(beacon('{"p":"/"}'), e);                                   // same visitor
  await worker.fetch(beacon('{"p":"/blog/a/","r":"https://t.co/x"}', { ua: IPHONE, ip: '5.6.7.8' }), e);

  const denied = await worker.fetch(new Request('https://w.example/stats', { headers: { origin: SITE } }), e);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('access-control-allow-origin'), SITE);

  const res = await worker.fetch(new Request('https://w.example/stats?days=7', { headers: { origin: SITE, authorization: 'Bearer secret' } }), e);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.to, kstDay());
  assert.equal(s.from, addDays(kstDay(), -6));
  assert.deepEqual(s.daily, [{ day: kstDay(), views: 3, visitors: 2 }]);
  assert.deepEqual(s.pages[0], { path: '/', views: 2, visitors: 1 });
  assert.deepEqual(s.refs, [{ ref: 't.co', views: 1 }]);
  assert.deepEqual(s.devices.map((d) => d.device).sort(), ['desktop', 'mobile']);
});

test('preflight answers allowed origins only', async () => {
  const e = env();
  const ok = await worker.fetch(new Request('https://w.example/stats', { method: 'OPTIONS', headers: { origin: 'http://localhost:8000' } }), e);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  const no = await worker.fetch(new Request('https://w.example/stats', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), e);
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('scheduled cleanup drops old salts and old views', async () => {
  const e = env();
  const old = addDays(kstDay(), -500);
  e.DB.raw.prepare('INSERT INTO hits VALUES (0, ?, ?, NULL, NULL, ?, ?)').run(old, '/', 'desktop', 'v');
  e.DB.raw.prepare('INSERT INTO salts VALUES (?, ?)').run(addDays(kstDay(), -1), 's');
  await worker.fetch(beacon('{"p":"/"}'), e);
  await worker.scheduled({}, e);
  assert.equal(count(e), 1);
  assert.deepEqual(e.DB.raw.prepare('SELECT day FROM salts').all().map((r) => r.day), [kstDay()]);
});
