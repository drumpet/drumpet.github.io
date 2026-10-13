// POST /h      page-view beacon from the site (text/plain JSON {p, r}, sent with navigator.sendBeacon)
// GET  /stats  aggregated numbers for the editor; Authorization: Bearer <STATS_TOKEN>
import { kstDay, addDays, isBot, deviceOf, parseOrigins, parseHit, visitorHash, safeEqual, clampDays } from './lib.js';

const RETENTION_DAYS = 400;

function cors(origin, allowed) {
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization',
    'access-control-allow-methods': 'GET, POST',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// The salt for `day` is created on first use; older salts are deleted so past visitor hashes
// can no longer be recomputed.
async function saltFor(db, day) {
  await db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, crypto.randomUUID()).run();
  const row = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
  return row.salt;
}

async function recordHit(request, env, origin) {
  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return;
  const hit = parseHit(await request.text(), origin);
  if (!hit) return;
  const now = Date.now();
  const day = kstDay(now);
  const salt = await saltFor(env.DB, day);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const visitor = await visitorHash(salt, ip, ua);
  const country = request.cf?.country || null;
  await env.DB.prepare('INSERT INTO hits (ts, day, path, ref, country, device, visitor) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now, day, hit.path, hit.ref, country, deviceOf(ua), visitor).run();
}

async function stats(env, days) {
  const today = kstDay();
  const from = addDays(today, -(days - 1));
  const q = (sql) => env.DB.prepare(sql).bind(from).all().then((r) => r.results);
  const [daily, pages, refs, countries, devices] = await Promise.all([
    q('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM hits WHERE day >= ? GROUP BY day ORDER BY day'),
    q('SELECT path, COUNT(*) AS views, COUNT(DISTINCT day || visitor) AS visitors FROM hits WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 30'),
    q('SELECT ref, COUNT(*) AS views FROM hits WHERE day >= ? AND ref IS NOT NULL GROUP BY ref ORDER BY views DESC LIMIT 20'),
    q("SELECT COALESCE(country, '??') AS country, COUNT(*) AS views FROM hits WHERE day >= ? GROUP BY 1 ORDER BY views DESC LIMIT 20"),
    q('SELECT device, COUNT(*) AS views FROM hits WHERE day >= ? GROUP BY device ORDER BY views DESC'),
  ]);
  return { from, to: today, daily, pages, refs, countries, devices };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const allowed = parseOrigins(env.ALLOWED_ORIGINS);
    const headers = cors(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname === '/h' && request.method === 'POST') {
      if (allowed.includes(origin)) {
        try { await recordHit(request, env, origin); } catch (e) { console.error(e); }
      }
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      const auth = request.headers.get('authorization') || '';
      if (!env.STATS_TOKEN || !safeEqual(auth, `Bearer ${env.STATS_TOKEN}`)) return json({ error: 'unauthorized' }, 401, headers);
      return json(await stats(env, clampDays(url.searchParams.get('days'))), 200, headers);
    }

    return new Response('not found', { status: 404, headers });
  },

  // Daily cleanup (see [triggers] in wrangler.toml).
  async scheduled(_event, env) {
    const today = kstDay();
    await env.DB.prepare('DELETE FROM hits WHERE day < ?').bind(addDays(today, -RETENTION_DAYS)).run();
    await env.DB.prepare('DELETE FROM salts WHERE day < ?').bind(today).run();
  },
};
