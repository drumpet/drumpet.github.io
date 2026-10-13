import {
  parseFrontmatter, serializePost, slugify, defaultSlug, slugFromPostPath, postFilename,
  extractDraft, visibleText, buildUserContent, buildSystemPrompt, buildHistory, todayISO,
} from './post.js';
import { streamChat, listModels } from './providers.js';
import { createGitHub } from './github.js';
import { unpublishPost, deletePost } from './actions.js';
import { loadSettings, saveSettings, activeProvider, isConfigured, fillForm, readForm, toggleProviderFields } from './settings.js';

const $ = (id) => document.getElementById(id);
const els = {
  picker: $('picker'), btnNew: $('btn-new'), btnSave: $('btn-save'), btnPublish: $('btn-publish'),
  btnUnpublish: $('btn-unpublish'), btnDelete: $('btn-delete'),
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
const RAW_HTML_RISK = /<script\b|<iframe\b|<object\b|<embed\b|\son\w+\s*=|javascript:/i;

// Pinned and loaded lazily so the editor still works when the CDN is unreachable.
const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.esm.js';
let markedPromise = null;
function getMarked() { return (markedPromise ||= import(MARKED_URL).then((m) => m.marked)); }

let settings = loadSettings();
let gh = settings.github.token ? createGitHub(settings.github.token) : null;

const state = {
  doc: newPostDoc(),
  postList: [],      // [{ name, path }] from _posts
  undo: [],
  dirty: false,
  rev: 0,            // bumped on every edit; lets save() notice edits made while it ran
  bufferKey: null,   // localStorage key this document's unsaved buffer was last written to
  pickerValue: '',   // picker value of the document currently loaded
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
  els.slug.disabled = d.kind === 'post' && !!d.publishedPath;   // URL of a published post is fixed
  els.description.value = d.fields.description || '';
  els.lang.value = d.fields.lang || 'ko';
  els.date.value = d.fields.date || '';
  els.body.value = d.body || '';
  els.btnUndo.hidden = state.undo.length === 0;
  renderActions();
  els.providerLabel.textContent = `${activeProvider(settings).provider} · ${activeProvider(settings).model || '모델 없음'}`;
  renderChat();
  if (document.body.dataset.view === 'preview') renderPreview();
}

// Which of 초안으로 / 삭제 apply to the current document (spec 5.8a). Never for About.
function renderActions() {
  const d = state.doc;
  const isPost = d.kind === 'post';
  els.btnUnpublish.hidden = !(isPost && !!d.publishedPath);
  els.btnDelete.hidden = !(isPost && !!(d.publishedPath || d.savedSlug));
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

async function renderPreview() {
  let marked;
  try {
    marked = await getMarked();
  } catch {
    markedPromise = null;   // retry on the next preview
    els.preview.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>미리보기 라이브러리를 불러오지 못했습니다.</p></body></html>';
    return;
  }
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
  state.rev++;
  setStatus('저장되지 않음');
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(() => {
    try {
      const key = bufferKey(state.doc);
      if (state.bufferKey && state.bufferKey !== key) localStorage.removeItem(state.bufferKey);
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), doc: state.doc }));
      state.bufferKey = key;
    } catch { /* ignore */ }
  }, 300);
}

// Removes only the current document's buffer; other documents' unsaved work stays recoverable.
function clearBuffer() {
  clearTimeout(bufferTimer);
  try { if (state.bufferKey) localStorage.removeItem(state.bufferKey); } catch { /* ignore */ }
  state.bufferKey = null;
}

// Called when another document becomes current: forget (but keep) the previous buffer.
function detachBuffer() {
  clearTimeout(bufferTimer);
  state.bufferKey = null;
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

function guardDirty(next, onCancel = () => {}) {
  if (!state.dirty) return next();
  showBanner('저장되지 않은 변경이 있습니다. 버리고 계속할까요?', [['버리기', () => { clearBuffer(); state.dirty = false; next(); }], ['취소', onCancel]]);
}

// ---------- form sync ----------

function syncFromForm() {
  const d = state.doc;
  if (d.kind === 'post') {
    d.fields.title = els.title.value;
    if (!els.slug.disabled) d.slug = els.slug.value.trim();
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
  const history = buildHistory(doc.chat);
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
    if (!full.trim()) {
      doc.chat.pop();
      doc.chat.push({ role: 'system', content: '빈 응답이 왔습니다. 다시 시도하세요.' });
      if (current()) renderChat();
      return;
    }
    const { draft, unclosed } = extractDraft(full);
    if (unclosed) assistant.note = '초안이 잘려 반영하지 않았습니다';
    else if (draft !== null && current()) { applyDraft(draft); assistant.note = '초안 갱신됨'; }
    if (stop === 'length' && current()) addSystemLine('응답이 길이 제한으로 잘렸습니다.');
    if (stop === 'refusal' && current()) addSystemLine('모델이 요청을 거부했습니다.');
  } catch (e) {
    if (!assistant.content) {
      doc.chat.pop();                       // assistant placeholder
      doc.chat.pop();                       // the user turn that never got an answer
      els.chatInput.value = text;
    }
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
  els.btnUnpublish.disabled = busy;
  els.btnDelete.disabled = busy;
  els.picker.disabled = busy;
  els.btnNew.disabled = busy;
  els.btnUndo.disabled = busy;
}

// ---------- GitHub: list / load ----------

function requireGitHub() {
  if (!gh) { setStatus('설정에서 GitHub 토큰을 입력하세요', { error: true }); openSettings(); return false; }
  return true;
}

let pickerSeq = 0;
async function refreshPicker() {
  if (!gh) return;
  const seq = ++pickerSeq;
  const [drafts, posts] = await Promise.all([
    gh.listDir(settings.github.draftsRepo, 'drafts'),
    gh.listDir(settings.github.siteRepo, '_posts'),
  ]);
  if (seq !== pickerSeq) return;   // a newer refresh is in flight; let it win
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
    let loadedStatus = '불러옴';
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
      // A saved draft of a published post is newer than the published file (spec 5.8.7).
      const draft = await gh.getFile(settings.github.draftsRepo, `drafts/${slug}.md`);
      const f = draft || (await gh.getFile(settings.github.siteRepo, path));
      const { fields, body } = parseFrontmatter(f ? f.content : '');
      doc = { kind: 'post', slug, savedSlug: draft ? slug : null, publishedPath: path, fields: fieldsFrom(fields), body, chat: await loadChat(slug) };
      if (draft) loadedStatus = '초안을 불러왔습니다 (발행본보다 새 버전)';
    } else {
      return;
    }
    state.doc = doc;
    state.undo = [];
    state.dirty = false;
    state.pickerValue = value;
    detachBuffer();
    renderDoc();
    setStatus(loadedStatus);
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
  const rev = state.rev;
  state.busy = true; setBusy(true);
  setStatus('저장 중…');
  try {
    if (d.kind === 'post' && d.savedSlug !== d.slug) {
      // New document or renamed slug: never overwrite another draft that already uses this slug.
      if (await gh.getFile(repo, `drafts/${d.slug}.md`)) return fail('같은 slug의 초안이 이미 있습니다. slug를 바꾸세요.');
    }
    await gh.putFile(repo, `drafts/${d.slug}.md`, docText(d), `Save draft: ${title}`);
    await gh.putFile(repo, `drafts/${d.slug}.chat.json`, chatJSON(d), `Save chat: ${title}`);
    if (d.savedSlug && d.savedSlug !== d.slug) {
      await gh.deleteFile(repo, `drafts/${d.savedSlug}.md`, `Rename draft: ${d.savedSlug} → ${d.slug}`);
      await gh.deleteFile(repo, `drafts/${d.savedSlug}.chat.json`, `Rename draft: ${d.savedSlug} → ${d.slug}`);
    }
    d.savedSlug = d.slug;
    renderActions();
    if (state.rev === rev) {
      state.dirty = false;
      clearBuffer();
      setStatus('저장됨');
    } else {
      setStatus('저장됨 (이후 변경은 아직 저장되지 않음)');
    }
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
  if (!validateForSave()) return;
  if (d.kind === 'post' && !d.publishedPath && findPublishedPath(d.slug)) {
    return fail('같은 slug로 발행된 글이 있습니다. 글 선택에서 그 글을 열어 수정하세요.');
  }
  if (RAW_HTML_RISK.test(d.body)) {
    showBanner('본문에 스크립트나 이벤트 핸들러로 보이는 HTML이 있습니다. 그대로 발행하면 사이트 방문자(그리고 이 에디터)의 브라우저에서 실행됩니다. 그래도 발행할까요?', [
      ['발행', () => { doPublish(); }],
      ['취소', () => {}],
    ]);
    return;
  }
  return doPublish();
}

async function doPublish() {
  const d = state.doc;
  if (!(await save())) return;
  if (state.dirty) return fail('저장 중 변경이 생겼습니다. 다시 저장 후 발행하세요.');

  const site = settings.github.siteRepo;
  const drafts = settings.github.draftsRepo;
  const title = docTitle(d);
  const path = d.kind === 'about' ? '_includes/about.md' : postFilename(d.fields.date, d.slug, d.publishedPath);
  const verb = d.publishedPath && d.kind === 'post' ? 'Update' : 'Publish';
  state.busy = true; setBusy(true);
  setStatus('발행 중…');
  try {
    await gh.putFile(site, path, docText(d), `${verb}: ${title}`);
    d.publishedPath = path;   // set now so a retry after a later failure updates this file instead of creating another
    await gh.putFile(drafts, `archive/${d.slug}.chat.json`, chatJSON(d), `Archive chat: ${title}`);
    await gh.deleteFile(drafts, `drafts/${d.slug}.md`, `Published: ${title}`);
    await gh.deleteFile(drafts, `drafts/${d.slug}.chat.json`, `Published: ${title}`);
    d.savedSlug = null;
    els.slug.disabled = d.kind === 'post';
    renderActions();
    const url = d.kind === 'about' ? `${siteUrl()}/` : `${siteUrl()}/blog/${d.slug}/`;
    setStatus(`발행됨 → ${url} (약 1분 뒤 반영)`, { url });
    refreshPicker().catch(() => {});
  } catch (e) {
    setStatus('발행 오류: ' + e.message, { error: true });
  } finally {
    state.busy = false; setBusy(false);
  }
}

// ---------- unpublish / delete (spec 5.8a) ----------

function unpublish() {
  const d = state.doc;
  if (state.busy || d.kind !== 'post' || !d.publishedPath || !requireGitHub()) return;
  showBanner('사이트에서 글이 내려가고 초안으로 돌아갑니다. 계속할까요?', [
    ['초안으로', () => { doUnpublish(); }],
    ['취소', () => {}],
  ]);
}

async function doUnpublish() {
  const d = state.doc;
  if (!(await save())) return;            // draft + chat now live in drafts/, so nothing can be lost below
  const title = docTitle(d);
  state.busy = true; setBusy(true);
  setStatus('초안으로 되돌리는 중…');
  try {
    await unpublishPost(gh, settings.github, { slug: d.slug, publishedPath: d.publishedPath, title });
    d.publishedPath = null;
    els.slug.disabled = false;
    renderActions();
    await refreshPicker().catch(() => {});
    state.pickerValue = `draft:${d.slug}`;
    els.picker.value = state.pickerValue;
    setStatus('초안으로 되돌림 (사이트에는 약 1분 뒤 반영)');
  } catch (e) {
    setStatus('되돌리기 오류: ' + e.message, { error: true });
  } finally {
    state.busy = false; setBusy(false);
  }
}

function remove() {
  const d = state.doc;
  if (state.busy || d.kind !== 'post' || !(d.publishedPath || d.savedSlug) || !requireGitHub()) return;
  showBanner(`'${docTitle(d)}'을(를) 삭제합니다. 저장하지 않은 변경도 함께 사라집니다. (두 저장소의 git 기록에는 남습니다)`, [
    ['삭제', () => { doDelete(); }],
    ['취소', () => {}],
  ]);
}

async function doDelete() {
  const d = state.doc;
  const slug = d.savedSlug || d.slug;     // files on disk use the saved slug, not an unsaved rename
  state.busy = true; setBusy(true);
  setStatus('삭제 중…');
  try {
    await deletePost(gh, settings.github, { slug, publishedPath: d.publishedPath, title: docTitle(d) });
    try { localStorage.removeItem(bufferKey(d)); } catch { /* ignore */ }
    clearBuffer();
    state.doc = newPostDoc(); state.undo = []; state.dirty = false;
    state.pickerValue = ''; els.picker.value = '';
    renderDoc();
    setStatus('삭제됨');
    await refreshPicker().catch(() => {});
  } catch (e) {
    setStatus('삭제 오류: ' + e.message, { error: true });
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
    guardDirty(() => loadSelection(v), () => { els.picker.value = state.pickerValue; });
  });
  els.btnNew.addEventListener('click', () => guardDirty(() => {
    state.doc = newPostDoc(); state.undo = []; state.dirty = false;
    detachBuffer();
    state.pickerValue = ''; els.picker.value = '';
    renderDoc(); setStatus('새 글');
  }));
  els.btnSave.addEventListener('click', save);
  els.btnPublish.addEventListener('click', publish);
  els.btnUnpublish.addEventListener('click', unpublish);
  els.btnDelete.addEventListener('click', remove);
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
      ['복구', () => { state.doc = b.doc; state.undo = []; state.bufferKey = b.key; renderDoc(); markDirty(); }],
      ['버리기', () => { try { localStorage.removeItem(b.key); } catch { /* ignore */ } }],
    ]);
  }
}

init();
