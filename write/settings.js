const KEY = 'write.settings';

export const DEFAULTS = Object.freeze({
  provider: 'anthropic',
  anthropic: { apiKey: '', model: 'claude-opus-5-5', baseUrl: '' },
  openai: { apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' },
  local: { apiKey: '', model: '', baseUrl: 'http://localhost:11434/v1' },
  github: { token: '', siteRepo: 'drumpet/drumpet.github.io', draftsRepo: 'drumpet/drafts', siteUrl: 'https://anthonypaek.com' },
});

export function mergeSettings(base, patch) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    const p = patch && patch[k];
    if (v && typeof v === 'object') out[k] = mergeSettings(v, p && typeof p === 'object' ? p : {});
    else out[k] = p === undefined || p === null ? v : p;
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return mergeSettings(DEFAULTS, raw ? JSON.parse(raw) : {});
  } catch {
    return mergeSettings(DEFAULTS, {});
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
}

export function activeProvider(s) {
  const p = s[s.provider] || {};
  return { provider: s.provider, apiKey: p.apiKey || '', model: p.model || '', baseUrl: p.baseUrl || '' };
}

export function isConfigured(s) {
  const p = activeProvider(s);
  if (!s.github?.token || !p.model) return false;
  return s.provider === 'local' || !!p.apiKey;
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ?? (o[k] = {});
  o[keys[keys.length - 1]] = value;
}

export function toggleProviderFields(form) {
  const p = form.elements.provider.value;
  for (const fs of form.querySelectorAll('fieldset[data-provider]')) fs.hidden = fs.dataset.provider !== p;
}

export function fillForm(form, s) {
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = getPath(s, el.name);
    el.value = v === undefined ? '' : v;
  }
  toggleProviderFields(form);
}

export function readForm(form) {
  const s = mergeSettings(DEFAULTS, {});
  for (const el of form.elements) {
    if (!el.name) continue;
    setPath(s, el.name, el.value.trim());
  }
  return s;
}
