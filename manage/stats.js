// /manage/ page: reads aggregated page views from the analytics Worker (analytics/).

export async function fetchStats({ url, token }, days, fetchImpl = fetch) {
  const res = await fetchImpl(`${String(url).replace(/\/+$/, '')}/stats?days=${days}`, {
    headers: { authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (!res.ok) {
    const e = new Error(res.status === 401 ? '통계 토큰이 맞지 않습니다' : `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// One row per day in [from, to], zero-filled, so the chart has no silent gaps.
export function fillDays(from, to, daily) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    out.push({ day, views: byDay.get(day)?.views || 0, visitors: byDay.get(day)?.visitors || 0 });
  }
  return out;
}

export function totals(daily) {
  return daily.reduce((t, d) => ({ views: t.views + d.views, visitors: t.visitors + d.visitors }), { views: 0, visitors: 0 });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tile(label, value) {
  const t = el('div', 'stat-tile');
  t.append(el('div', 'stat-value', value.toLocaleString()), el('div', 'stat-label', label));
  return t;
}

function chart(days) {
  const max = Math.max(1, ...days.map((d) => d.views));
  const wrap = el('div', 'stat-chart');
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', '일별 조회수');
  for (const d of days) {
    const col = el('div', 'stat-col');
    col.title = `${d.day}  조회 ${d.views} · 방문자 ${d.visitors}`;
    const bar = el('div', 'stat-bar');
    bar.style.height = `${(d.views / max) * 100}%`;
    col.append(bar);
    wrap.append(col);
  }
  const axis = el('div', 'stat-axis');
  axis.append(el('span', '', days[0]?.day.slice(5) ?? ''), el('span', '', `최대 ${max}`), el('span', '', days.at(-1)?.day.slice(5) ?? ''));
  const box = el('div');
  box.append(wrap, axis);
  return box;
}

function table(title, cols, rows) {
  const sec = el('section', 'stat-table');
  sec.append(el('h3', '', title));
  if (!rows.length) { sec.append(el('p', 'hint', '아직 없음')); return sec; }
  const t = el('table');
  const head = el('tr');
  for (const [, label] of cols) head.append(el('th', '', label));
  t.append(head);
  for (const r of rows) {
    const tr = el('tr');
    for (const [key] of cols) tr.append(el('td', typeof r[key] === 'number' ? 'num' : '', typeof r[key] === 'number' ? r[key].toLocaleString() : String(r[key] ?? '')));
    t.append(tr);
  }
  sec.append(t);
  return sec;
}

export function renderStats(root, s) {
  const days = fillDays(s.from, s.to, s.daily);
  const t = totals(days);
  const tiles = el('div', 'stat-tiles');
  tiles.append(tile('조회수', t.views), tile('방문자 (일별 합계)', t.visitors));
  const grid = el('div', 'stat-grid');
  grid.append(
    table('페이지', [['path', '경로'], ['views', '조회'], ['visitors', '방문자']], s.pages),
    table('유입 경로', [['ref', '사이트'], ['views', '조회']], s.refs),
    table('국가', [['country', '국가'], ['views', '조회']], s.countries),
    table('기기', [['device', '기기'], ['views', '조회']], s.devices),
  );
  root.replaceChildren(tiles, chart(days), grid);
}
