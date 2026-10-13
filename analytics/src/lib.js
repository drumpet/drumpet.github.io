// Pure helpers for the worker. No Cloudflare APIs here so node --test can cover them.

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|fetch|curl|wget|python|httpclient|java\/|go-http|monitor|uptime/i;
const MOBILE_UA = /mobi|android|iphone|ipad|ipod/i;

export function kstDay(ms = Date.now()) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isBot(ua) {
  return !ua || BOT_UA.test(ua);
}

export function deviceOf(ua) {
  return MOBILE_UA.test(ua || '') ? 'mobile' : 'desktop';
}

export function parseOrigins(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

// Validates the beacon body {p, r}. Returns null for anything that is not a plausible page view.
export function parseHit(text, origin) {
  if (typeof text !== 'string' || text.length > 2000) return null;
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j.p !== 'string') return null;
  const path = j.p.split(/[?#]/)[0];
  if (!path.startsWith('/') || path.length > 300 || /^\/(write|manage)\//.test(path)) return null;
  return { path, ref: refHost(j.r, origin) };
}

// Keeps only the referrer's host; drops same-site and non-http referrers.
export function refHost(r, origin) {
  if (typeof r !== 'string' || !r) return null;
  let host;
  try {
    const u = new URL(r);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.hostname.replace(/^www\./, '');
  } catch { return null; }
  let own = '';
  try { own = new URL(origin).hostname.replace(/^www\./, ''); } catch { /* none */ }
  return host && host !== own ? host.slice(0, 200) : null;
}

export async function visitorHash(salt, ip, ua) {
  const data = new TextEncoder().encode(`${salt}|${ip}|${ua}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (!a || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export function clampDays(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 365) : 30;
}
