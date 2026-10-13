import { fetchStats, renderStats } from './stats.js';

const KEY = 'manage.settings';
const $ = (id) => document.getElementById(id);
const els = {
  days: $('days'), refresh: $('btn-refresh'), status: $('status'), body: $('stats-body'),
  settings: $('settings'), form: $('settings-form'), btnSettings: $('btn-settings'), cancel: $('btn-settings-cancel'),
};

function loadSettings() {
  try { return { url: '', token: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { url: '', token: '' }; }
}
function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
}

let settings = loadSettings();

function setStatus(text, error = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', error);
}

function openSettings() {
  els.form.elements.url.value = settings.url;
  els.form.elements.token.value = settings.token;
  els.settings.showModal();
}

let seq = 0;
async function load() {
  if (!settings.url || !settings.token) { setStatus('설정에서 Worker URL과 통계 토큰을 넣으세요'); openSettings(); return; }
  const mine = ++seq;
  setStatus('불러오는 중…');
  try {
    const s = await fetchStats(settings, els.days.value);
    if (mine !== seq) return;
    renderStats(els.body, s);
    setStatus(`${s.from} ~ ${s.to} (한국 시간)`);
  } catch (e) {
    if (mine !== seq) return;
    setStatus('오류: ' + e.message, true);
  }
}

els.days.addEventListener('change', load);
els.refresh.addEventListener('click', load);
els.btnSettings.addEventListener('click', openSettings);
els.cancel.addEventListener('click', () => els.settings.close());
els.form.addEventListener('submit', () => {
  settings = { url: els.form.elements.url.value.trim(), token: els.form.elements.token.value.trim() };
  saveSettings(settings);
  load();
});

load();
