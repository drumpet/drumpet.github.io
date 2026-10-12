import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
import {
  parseFrontmatter, serializePost, slugify, defaultSlug, slugFromPostPath, postFilename,
  extractDraft, visibleText, buildUserContent, buildSystemPrompt, todayISO,
} from './post.js';
import { streamChat, listModels } from './providers.js';
import { createGitHub } from './github.js';
import { loadSettings, saveSettings, activeProvider, isConfigured, fillForm, readForm, toggleProviderFields } from './settings.js';

const $ = (id) => document.getElementById(id);
const els = {
  picker: $('picker'), btnNew: $('btn-new'), btnSave: $('btn-save'), btnPublish: $('btn-publish'),
  status: $('status'), providerLabel: $('provider-label'), btnSettings: $('btn-settings'), banner: $('banner'),
  messages: $('messages'), chatForm: $('chat-form'), chatInput: $('chat-input'), btnSend: $('btn-send'), btnStop: $('btn-stop'),
  meta: $('meta'), title: $('f-title'), slug: $('f-slug'), description: $('f-description'), lang: $('f-lang'), date: $('f-date'),
  btnUndo: $('btn-undo'), body: $('body'), preview: $('preview'),
  settings: $('settings'), settingsForm: $('settings-form'), btnModels: $('btn-models'), btnSettingsCancel: $('btn-settings-cancel'),
  modelsStatus: $('models-status'),
};

const FIELD_KEYS = ['title', 'date', 'lang', 'description'];
const BUFFER_PREFIX = 'write.buffer.';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

let settings = loadSettings();
let gh = settings.github.token ? createGitHub(settings.github.token) : null;

const state = {
  doc: newPostDoc(),
  postList: [],      // [{ name, path }] from _posts
  undo: [],
  dirty: false,
  busy: false,
  abort: null,
};

// ---------- documents ----------

function newPostDoc() {
  return { kind: 'post', slug: '', savedSlug: null, publishedPath: null, fields: { title: '', date: todayISO(), lang: 'ko', description: '' }, body: '', chat: [] };
}

function docText(doc) {
  return doc.kind === 'about' ? doc.body : serializePost(doc.fields, doc.body);
}

function docTitle(doc) {
  return doc.kind === 'about' ? 'About' : (doc.fields.title || '(제목 없음)');
}

function chatJSON(doc) {
  const p = activeProvider(settings);
  return JSON.stringify({ version: 1, provider: p.provider, model: p.model, messages: doc.chat.map((m) => ({ role: m.role, content: m.content })) }, null, 2) + '\n';
}

function snapshot() {
  return structuredClone({ fields: state.doc.fields, body: state.doc.body, slug: state.doc.slug });
}

// ---------- rendering ----------

function setStatus(text, { url = null, error = false } = {}) {
  els.status.textContent = '';
  els.status.classList.toggle('error', error);
  if (url) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
    els.status.appendChild(a);
  } else {
    els.status.textContent = text;
  }
}

function renderDoc() {
  const d = state.doc;
  els.meta.hidden = d.kind === 'about';
  els.title.value = d.fields.title || '';
  els.slug.value = d.slug || '';
  els.description.value = d.fields.description || '';
  els.lang.value = d.fields.lang || 'ko';
  els.date.value = d.fields.date || '';
  els.body.value = d.body || '';
  els.btnUndo.hidden = state.undo.length === 0;
  els.providerLabel.textContent = `${activeProvider(settings).provider} · ${activeProvider(settings).model || '모델 없음'}`;
  renderChat();
  if (document.body.dataset.view === 'preview') renderPreview();
}

function messageNode(m) {
  const div = document.createElement('div');
  div.className = `msg ${m.role}${m.error ? ' error' : ''}`;
  div.textContent = m.role === 'assistant' ? visibleText(m.content) : m.content;
  if (m.role === 'assistant' && m.note) {
    const chip = document.createElement('span');
    chip.className = 'note';
    chip.textContent = m.note;
    div.appendChild(document.createElement('br'));
    div.appendChild(chip);
  }
  return div;
}

function renderChat() {
  els.messages.replaceChildren(...state.doc.chat.map(messageNode));
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderLastMessage() {
  const last = els.messages.lastElementChild;
  const m = state.doc.chat[state.doc.chat.length - 1];
  if (last && m) last.replaceWith(messageNode(m));
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addSystemLine(text, error = false) {
  state.doc.chat.push({ role: 'system', content: text, error });
  renderChat();
}

function renderPreview() {
  const css = new URL('/style.css', location.href).href;
  const html = marked.parse(state.doc.body || '');
  els.preview.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"></head><body><main><section class="post"><article class="post-body">${html}</article></section></main></body></html>`;
}

function showBanner(text, actions) {
  els.banner.replaceChildren();
  const span = document.createElement('span');
  span.textContent = text;
  els.banner.appendChild(span);
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => { els.banner.hidden = true; fn(); });
    els.banner.appendChild(b);
  }
  els.banner.hidden = false;
}

// ---------- dirty / buffer ----------

function bufferKey(doc) { return `${BUFFER_PREFIX}${doc.kind}:${doc.slug || 'new'}`; }

let bufferTimer = null;
function markDirty() {
  state.dirty = true;
  setStatus('저장되지 않음');
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(() => {
    try { localStorage.setItem(bufferKey(state.doc), JSON.stringify({ savedAt: Date.now(), doc: state.doc })); } catch { /* ignore */ }
  }, 300);
}

function clearBuffers() {
  clearTimeout(bufferTimer);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(BUFFER_PREFIX)) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

function latestBuffer() {
  let best = null;
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(BUFFER_PREFIX)) continue;
      const v = JSON.parse(localStorage.getItem(k));
      if (!best || v.savedAt > best.savedAt) best = { key: k, ...v };
    }
  } catch { /* ignore */ }
  return best;
}

function guardDirty(next) {
  if (!state.dirty) return next();
  showBanner('저장되지 않은 변경이 있습니다. 버리고 계속할까요?', [['버리기', () => { state.dirty = false; next(); }], ['취소', () => {}]]);
}

// ---------- form sync ----------

function syncFromForm() {
  const d = state.doc;
  if (d.kind === 'post') {
    d.fields.title = els.title.value;
    d.slug = els.slug.value.trim();
    d.fields.description = els.description.value;
    d.fields.lang = els.lang.value;
    d.fields.date = els.date.value.trim();
  }
  d.body = els.body.value;
  markDirty();
}

function applyDraft(text) {
  state.undo.push(snapshot());
  if (state.undo.length > 10) state.undo.shift();
  const d = state.doc;
  if (d.kind === 'about') {
    d.body = text;
  } else {
    const { fields, body } = parseFrontmatter(text);
    for (const k of FIELD_KEYS) if (fields[k] !== undefined) d.fields[k] = fields[k];
    if (!d.slug && fields.slug) d.slug = slugify(fields.slug);
    d.body = body.replace(/^\n+/, '');
  }
  renderDoc();
  markDirty();
}

function undo() {
  const s = state.undo.pop();
  if (!s) return;
  Object.assign(state.doc, s);
  renderDoc();
  markDirty();
}

// ---------- chat ----------

function errorText(e) {
  let t = e.message || String(e);
  if (e.status === 401 || e.status === 403) t += ' — 설정에서 키를 확인하세요.';
  if (!e.status && /fetch/i.test(t) && settings.provider === 'local') t += ' — 로컬 서버가 켜져 있는지, CORS(OLLAMA_ORIGINS)와 mixed content를 확인하세요.';
  return t;
}

async function send() {
  const text = els.chatInput.value.trim();
  if (!text || state.busy) return;
  if (!isConfigured(settings)) { setStatus('설정이 필요합니다', { error: true }); openSettings(); return; }

  const doc = state.doc;
  const current = () => state.doc === doc;
  const p = activeProvider(settings);
  const history = doc.chat.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const messages = [...history, { role: 'user', content: buildUserContent(docText(doc), text) }];

  doc.chat.push({ role: 'user', content: text });
  const assistant = { role: 'assistant', content: '' };
  doc.chat.push(assistant);
  els.chatInput.value = '';
  renderChat();

  state.busy = true;
  state.abort = new AbortController();
  setBusy(true);
  try {
    const { text: full, stop } = await streamChat({
      provider: p.provider, settings: p, system: buildSystemPrompt(), messages, signal: state.abort.signal,
      onText: (t) => { assistant.content = t; if (current()) renderLastMessage(); },
    });
    assistant.content = full;
    const { draft, unclosed } = extractDraft(full);
    if (unclosed) assistant.note = '초안이 잘려 반영하지 않았습니다';
    else if (draft !== null && current()) { applyDraft(draft); assistant.note = '초안 갱신됨'; }
    if (stop === 'length' && current()) addSystemLine('응답이 길이 제한으로 잘렸습니다.');
    if (stop === 'refusal' && current()) addSystemLine('모델이 요청을 거부했습니다.');
  } catch (e) {
    if (!assistant.content) doc.chat.pop();
    if (e.name === 'AbortError') doc.chat.push({ role: 'system', content: '중지했습니다.' });
    else doc.chat.push({ role: 'system', content: errorText(e), error: true });
    if (current()) renderChat();
  } finally {
    state.busy = false;
    state.abort = null;
    setBusy(false);
    if (current()) { renderChat(); markDirty(); }
  }
}

function setBusy(busy) {
  els.btnSend.disabled = busy;
  els.btnStop.hidden = !busy;
  els.btnSave.disabled = busy;
  els.btnPublish.disabled = busy;
  els.picker.disabled = busy;
  els.btnNew.disabled = busy;
  els.btnUndo.disabled = busy;
}

// ---------- GitHub: list / load ----------

function requireGitHub() {
  if (!gh) { setStatus('설정에서 GitHub 토큰을 입력하세요', { error: true }); openSettings(); return false; }
  return true;
}

async function refreshPicker() {
  if (!gh) return;
  const [drafts, posts] = await Promise.all([
    gh.listDir(settings.github.draftsRepo, 'drafts'),
    gh.listDir(settings.github.siteRepo, '_posts'),
  ]);
  state.postList = posts.filter((f) => f.name.endsWith('.md'));
  const draftFiles = drafts.filter((f) => f.name.endsWith('.md') && f.name !== 'about.md');

  const group = (label, items) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const [value, text] of items) {
      const o = document.createElement('option');
      o.value = value; o.textContent = text;
      g.appendChild(o);
    }
    return g;
  };
  const first = document.createElement('option');
  first.value = ''; first.textContent = '글 선택…';
  els.picker.replaceChildren(
    first,
    group('초안', draftFiles.map((f) => [`draft:${f.name.replace(/\.md$/, '')}`, f.name.replace(/\.md$/, '')])),
    group('발행됨', state.postList.slice().reverse().map((f) => [`post:${f.path}`, f.name.replace(/\.md$/, '')])),
    group('페이지', [['about', 'About']]),
  );
}

function findPublishedPath(slug) {
  const hit = state.postList.find((f) => slugFromPostPath(f.path) === slug);
  return hit ? hit.path : null;
}

async function loadChat(slug) {
  for (const p of [`drafts/${slug}.chat.json`, `archive/${slug}.chat.json`]) {
    const f = await gh.getFile(settings.github.draftsRepo, p);
    if (f) {
      try { return (JSON.parse(f.content).messages || []).map((m) => ({ role: m.role, content: m.content })); } catch { /* ignore */ }
    }
  }
  return [];
}

function fieldsFrom(parsed) {
  const out = { title: '', date: todayISO(), lang: 'ko', description: '' };
  for (const k of FIELD_KEYS) if (parsed[k] !== undefined) out[k] = parsed[k];
  return out;
}

async function loadSelection(value) {
  if (!value || !requireGitHub()) return;
  setStatus('불러오는 중…');
  try {
    let doc;
    if (value === 'about') {
      const draft = await gh.getFile(settings.github.draftsRepo, 'drafts/about.md');
      const src = draft || (await gh.getFile(settings.github.siteRepo, '_includes/about.md'));
      doc = { kind: 'about', slug: 'about', savedSlug: draft ? 'about' : null, publishedPath: '_includes/about.md', fields: {}, body: src ? src.content : '', chat: await loadChat('about') };
    } else if (value.startsWith('draft:')) {
      const slug = value.slice(6);
      const f = await gh.getFile(settings.github.draftsRepo, `drafts/${slug}.md`);
      const { fields, body } = parseFrontmatter(f ? f.content : '');
      doc = { kind: 'post', slug, savedSlug: slug, publishedPath: findPublishedPath(slug), fields: fieldsFrom(fields), body, chat: await loadChat(slug) };
    } else if (value.startsWith('post:')) {
      const path = value.slice(5);
      const slug = slugFromPostPath(path);
      const f = await gh.getFile(settings.github.siteRepo, path);
      const { fields, body } = parseFrontmatter(f ? f.content : '');
      doc = { kind: 'post', slug, savedSlug: null, publishedPath: path, fields: fieldsFrom(fields), body, chat: await loadChat(slug) };
    } else {
      return;
    }
    state.doc = doc;
    state.undo = [];
    state.dirty = false;
    renderDoc();
    setStatus('불러옴');
  } catch (e) {
    setStatus('불러오기 오류: ' + e.message, { error: true });
  }
}

// ---------- save / publish ----------

function fail(msg) { setStatus(msg, { error: true }); return false; }

function validateForSave() {
  const d = state.doc;
  if (d.kind === 'post') {
    if (!d.slug) d.slug = defaultSlug(d.fields.title, d.fields.date || todayISO());
    els.slug.value = d.slug;
    if (!/^[a-z0-9-]+$/.test(d.slug)) return fail('slug는 영문 소문자·숫자·하이픈만 쓸 수 있습니다');
  }
  return true;
}

async function save() {
  if (state.busy || !requireGitHub() || !validateForSave()) return false;
  const d = state.doc;
  const repo = settings.github.draftsRepo;
  const title = docTitle(d);
  state.busy = true; setBusy(true);
  setStatus('저장 중…');
  try {
    await gh.putFile(repo, `drafts/${d.slug}.md`, docText(d), `Save draft: ${title}`);
    await gh.putFile(repo, `drafts/${d.slug}.chat.json`, chatJSON(d), `Save chat: ${title}`);
    if (d.savedSlug && d.savedSlug !== d.slug) {
      await gh.deleteFile(repo, `drafts/${d.savedSlug}.md`, `Rename draft: ${d.savedSlug} → ${d.slug}`);
      await gh.deleteFile(repo, `drafts/${d.savedSlug}.chat.json`, `Rename draft: ${d.savedSlug} → ${d.slug}`);
    }
    d.savedSlug = d.slug;
    state.dirty = false;
    clearBuffers();
    setStatus('저장됨');
    refreshPicker().catch(() => {});
    return true;
  } catch (e) {
    setStatus('저장 오류: ' + e.message, { error: true });
    return false;
  } finally {
    state.busy = false; setBusy(false);
  }
}

function siteUrl() {
  return LOCAL_HOSTS.has(location.hostname) ? settings.github.siteUrl.replace(/\/+$/, '') : location.origin;
}

async function publish() {
  const d = state.doc;
  if (d.kind === 'post') {
    if (!d.fields.title.trim()) return fail('제목이 비었습니다');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fields.date)) return fail('날짜는 YYYY-MM-DD 형식이어야 합니다');
  }
  if (!d.body.trim()) return fail('본문이 비었습니다');
  if (!(await save())) return;

  const site = settings.github.siteRepo;
  const drafts = settings.github.draftsRepo;
  const title = docTitle(d);
  const path = d.kind === 'about' ? '_includes/about.md' : postFilename(d.fields.date, d.slug, d.publishedPath);
  const verb = d.publishedPath && d.kind === 'post' ? 'Update' : 'Publish';
  state.busy = true; setBusy(true);
  setStatus('발행 중…');
  try {
    await gh.putFile(site, path, docText(d), `${verb}: ${title}`);
    await gh.putFile(drafts, `archive/${d.slug}.chat.json`, chatJSON(d), `Archive chat: ${title}`);
    await gh.deleteFile(drafts, `drafts/${d.slug}.md`, `Published: ${title}`);
    await gh.deleteFile(drafts, `drafts/${d.slug}.chat.json`, `Published: ${title}`);
    d.publishedPath = path;
    d.savedSlug = null;
    const url = d.kind === 'about' ? `${siteUrl()}/` : `${siteUrl()}/blog/${d.slug}/`;
    setStatus(`발행됨 → ${url} (약 1분 뒤 반영)`, { url });
    refreshPicker().catch(() => {});
  } catch (e) {
    setStatus('발행 오류: ' + e.message, { error: true });
  } finally {
    state.busy = false; setBusy(false);
  }
}

// ---------- settings ----------

function openSettings() {
  fillForm(els.settingsForm, settings);
  els.modelsStatus.textContent = '';
  els.settings.showModal();
}

async function fetchModels() {
  const s = readForm(els.settingsForm);
  const p = activeProvider(s);
  els.modelsStatus.textContent = '불러오는 중…';
  try {
    const ids = await listModels(p.provider, p);
    const list = $(`models-${p.provider}`);
    list.replaceChildren(...ids.map((id) => Object.assign(document.createElement('option'), { value: id })));
    els.modelsStatus.textContent = `${ids.length}개`;
  } catch (e) {
    els.modelsStatus.textContent = '오류: ' + errorText(e);
  }
}

// ---------- events ----------

function bind() {
  els.picker.addEventListener('change', () => {
    const v = els.picker.value;
    guardDirty(() => loadSelection(v));
  });
  els.btnNew.addEventListener('click', () => guardDirty(() => {
    state.doc = newPostDoc(); state.undo = []; state.dirty = false;
    els.picker.value = '';
    renderDoc(); setStatus('새 글');
  }));
  els.btnSave.addEventListener('click', save);
  els.btnPublish.addEventListener('click', publish);
  els.btnUndo.addEventListener('click', undo);
  els.btnSettings.addEventListener('click', openSettings);
  els.btnSettingsCancel.addEventListener('click', () => els.settings.close());
  els.btnModels.addEventListener('click', fetchModels);
  els.settingsForm.elements.provider.addEventListener('change', () => toggleProviderFields(els.settingsForm));
  els.settingsForm.addEventListener('submit', () => {
    settings = readForm(els.settingsForm);
    saveSettings(settings);
    gh = settings.github.token ? createGitHub(settings.github.token) : null;
    renderDoc();
    refreshPicker().catch((e) => setStatus('목록 오류: ' + e.message, { error: true }));
  });

  for (const el of [els.title, els.slug, els.description, els.lang, els.date, els.body]) el.addEventListener('input', syncFromForm);
  els.title.addEventListener('blur', () => {
    if (state.doc.kind === 'post' && !state.doc.slug && !state.doc.savedSlug) {
      const s = slugify(els.title.value);
      if (s) { state.doc.slug = s; els.slug.value = s; markDirty(); }
    }
  });

  els.chatForm.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  els.btnStop.addEventListener('click', () => state.abort?.abort());

  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => {
      document.body.dataset.view = b.dataset.view;
      els.preview.hidden = b.dataset.view !== 'preview';
      for (const x of document.querySelectorAll('[data-view]')) x.classList.toggle('active', x === b);
      if (b.dataset.view === 'preview') renderPreview();
    });
  }
  for (const b of document.querySelectorAll('[data-pane]')) {
    b.addEventListener('click', () => {
      document.body.dataset.pane = b.dataset.pane;
      for (const x of document.querySelectorAll('[data-pane]')) x.classList.toggle('active', x === b);
    });
  }
  document.querySelector('[data-view="edit"]').classList.add('active');
  document.querySelector('[data-pane="chat"]').classList.add('active');

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

// ---------- init ----------

async function init() {
  bind();
  renderDoc();
  if (!isConfigured(settings)) {
    setStatus('설정에서 키를 입력하세요');
    openSettings();
  }
  if (gh) refreshPicker().catch((e) => setStatus('목록 오류: ' + e.message, { error: true }));
  const b = latestBuffer();
  if (b && b.doc) {
    showBanner(`저장되지 않은 작업 "${docTitle(b.doc)}"이(가) 있습니다.`, [
      ['복구', () => { state.doc = b.doc; state.undo = []; renderDoc(); markDirty(); }],
      ['버리기', () => { try { localStorage.removeItem(b.key); } catch { /* ignore */ } }],
    ]);
  }
}

init();
