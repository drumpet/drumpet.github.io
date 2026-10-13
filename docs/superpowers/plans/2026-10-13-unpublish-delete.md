# Unpublish / Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two header actions to the `/write/` editor: `초안으로` (unpublish a post back to a draft) and `삭제` (delete a post or draft from both repos).

**Architecture:** The GitHub call sequences live in a new pure module `write/actions.js` (tested with a fake `gh` client). `write/app.js` adds the two buttons, confirmation banners, busy locking, and state updates around those calls. Spec: `docs/superpowers/specs/2026-10-12-blog-cms-design.md` section 5.8a.

**Tech Stack:** Vanilla ES modules in the browser, no build step. Tests: Node built-in runner (`node --test write/test.mjs`). Current suite: 35 tests passing.

## Global Constraints

- No new dependencies, no build step, no server. Browser code is plain ES modules loaded by `write/index.html`.
- Never use `innerHTML`; build DOM with `textContent` / `createElement` (existing `showBanner` already does this).
- Commit messages for repo writes: `Unpublish: <title>` and `Delete: <title>` (spec 5.8a).
- Unpublish order: save first (existing `save()`), then delete the site file, then delete `archive/<slug>.chat.json`.
- Delete order: site `publishedPath` (only when present), then `drafts/<slug>.md`, `drafts/<slug>.chat.json`, `archive/<slug>.chat.json`. Stop at the first failure (a retry removes the rest). `gh.deleteFile` already no-ops on a missing file.
- Both actions are hidden for `kind === 'about'`. `초안으로` shows only when `publishedPath` is set; `삭제` shows only when `publishedPath` or `savedSlug` is set.
- Both actions take the `state.busy` lock and go through `setBusy`, which must also disable the two new buttons.
- Every commit ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run the full suite before each commit: `node --test write/test.mjs` must pass with zero failures and zero warnings.

---

### Task 1: `write/actions.js` — repo-side steps, with tests

**Files:**
- Create: `write/actions.js`
- Test: `write/test.mjs` (append at the end of the file)

**Interfaces:**
- Consumes: a GitHub client from `createGitHub` with `deleteFile(repo, path, message)` (`write/github.js:74`).
- Produces:
  - `unpublishPost(gh, { siteRepo, draftsRepo }, { slug, publishedPath, title }) → Promise<void>`
  - `deletePost(gh, { siteRepo, draftsRepo }, { slug, publishedPath, title }) → Promise<void>` (`publishedPath` may be `null`)
  - The second argument has the same shape as `settings.github`, so `app.js` can pass that object directly.

- [ ] **Step 1: Append the failing tests to `write/test.mjs`**

Append this block at the very end of `write/test.mjs`:

```js
// ---------- actions.js ----------
import { unpublishPost, deletePost } from './actions.js';

function fakeGh(failOn = null) {
  const calls = [];
  return {
    calls,
    async deleteFile(repo, path, message) {
      calls.push([repo, path, message]);
      if (failOn && path === failOn) throw new Error('boom');
    },
  };
}
const REPOS = { siteRepo: 'o/site', draftsRepo: 'o/drafts' };
const HELLO = { slug: 'hello', publishedPath: '_posts/2026-10-12-hello.md', title: 'Hi' };

test('unpublishPost deletes the site file, then the archived chat', async () => {
  const gh = fakeGh();
  await unpublishPost(gh, REPOS, HELLO);
  assert.deepEqual(gh.calls, [
    ['o/site', '_posts/2026-10-12-hello.md', 'Unpublish: Hi'],
    ['o/drafts', 'archive/hello.chat.json', 'Unpublish: Hi'],
  ]);
});

test('unpublishPost stops when the site delete fails, leaving the archive untouched', async () => {
  const gh = fakeGh('_posts/2026-10-12-hello.md');
  await assert.rejects(unpublishPost(gh, REPOS, HELLO), /boom/);
  assert.equal(gh.calls.length, 1);
});

test('deletePost removes site file, draft, draft chat, archived chat in that order', async () => {
  const gh = fakeGh();
  await deletePost(gh, REPOS, HELLO);
  assert.deepEqual(gh.calls, [
    ['o/site', '_posts/2026-10-12-hello.md', 'Delete: Hi'],
    ['o/drafts', 'drafts/hello.md', 'Delete: Hi'],
    ['o/drafts', 'drafts/hello.chat.json', 'Delete: Hi'],
    ['o/drafts', 'archive/hello.chat.json', 'Delete: Hi'],
  ]);
});

test('deletePost never touches the site repo for an unpublished draft', async () => {
  const gh = fakeGh();
  await deletePost(gh, REPOS, { slug: 'wip', publishedPath: null, title: 'W' });
  assert.deepEqual(gh.calls.map((c) => c[0] + ':' + c[1]), [
    'o/drafts:drafts/wip.md', 'o/drafts:drafts/wip.chat.json', 'o/drafts:archive/wip.chat.json',
  ]);
});

test('deletePost stops at the first failure so a retry can remove the rest', async () => {
  const gh = fakeGh('drafts/hello.md');
  await assert.rejects(deletePost(gh, REPOS, HELLO), /boom/);
  assert.equal(gh.calls.length, 2);
});
```

- [ ] **Step 2: Run the suite and confirm the new tests fail**

Run: `node --test write/test.mjs 2>&1 | tail -12`
Expected: the run aborts loading `./actions.js` (`ERR_MODULE_NOT_FOUND`) or reports 5 failures; the 35 existing tests are unaffected.

- [ ] **Step 3: Create `write/actions.js`**

```js
// Repo-side steps of "unpublish" and "delete". Pure: takes a GitHub client and plain data.
// app.js owns saving, state, and the screen; this module owns only the order of repo writes.

// Precondition: the caller has already saved the current draft + chat to drafts/ (spec 5.8a).
export async function unpublishPost(gh, { siteRepo, draftsRepo }, { slug, publishedPath, title }) {
  const message = `Unpublish: ${title}`;
  await gh.deleteFile(siteRepo, publishedPath, message);
  await gh.deleteFile(draftsRepo, `archive/${slug}.chat.json`, message);
}

// Stops at the first failure; a retry removes whatever is left (deleteFile skips missing files).
export async function deletePost(gh, { siteRepo, draftsRepo }, { slug, publishedPath, title }) {
  const message = `Delete: ${title}`;
  if (publishedPath) await gh.deleteFile(siteRepo, publishedPath, message);
  for (const path of [`drafts/${slug}.md`, `drafts/${slug}.chat.json`, `archive/${slug}.chat.json`]) {
    await gh.deleteFile(draftsRepo, path, message);
  }
}
```

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `node --test write/test.mjs 2>&1 | tail -12`
Expected: `ℹ tests 40`, `ℹ pass 40`, `ℹ fail 0`, no `MODULE_TYPELESS` or other warnings.

- [ ] **Step 5: Commit**

```bash
git add write/actions.js write/test.mjs
git commit -m "Add unpublishPost/deletePost repo steps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Editor UI — buttons, confirmations, state

**Files:**
- Modify: `write/index.html` (header, lines 12-21)
- Modify: `write/app.css` (after the `button.primary:hover` rule, line 25)
- Modify: `write/app.js` (imports, `els`, `renderDoc`, `setBusy`, `refreshPicker`, `save`, `doPublish`, new `unpublish`/`doUnpublish`/`remove`/`doDelete`, `bind`)

**Interfaces:**
- Consumes: `unpublishPost`, `deletePost` from Task 1; existing `save()`, `showBanner(text, actions)`, `setBusy(busy)`, `refreshPicker()`, `newPostDoc()`, `docTitle(doc)`, `clearBuffer()`, `bufferKey(doc)`, `requireGitHub()`, `setStatus(text, opts)`, `renderDoc()` in `write/app.js`.
- Produces: header buttons `#btn-unpublish` and `#btn-delete`; `renderActions()` helper in `app.js`.

No DOM unit tests exist (browser-only file). Verification is by reading the diff plus a manual smoke list at the end of the task.

- [ ] **Step 1: Add the two buttons to `write/index.html`**

Replace the header block (lines 12-21) with:

```html
  <header class="bar">
    <select id="picker" title="글 선택"><option value="">글 선택…</option></select>
    <button id="btn-new" type="button">새 글</button>
    <button id="btn-save" type="button">저장</button>
    <button id="btn-publish" type="button" class="primary">발행</button>
    <button id="btn-unpublish" type="button" hidden>초안으로</button>
    <button id="btn-delete" type="button" class="danger" hidden>삭제</button>
    <span id="status" class="status"></span>
    <span class="spacer"></span>
    <span id="provider-label" class="muted"></span>
    <button id="btn-settings" type="button">설정</button>
  </header>
```

- [ ] **Step 2: Add the danger style to `write/app.css`**

Directly after the line `button.primary:hover { background: #44403c; }` add:

```css
button.danger { color: #b91c1c; border-color: #fca5a5; }
button.danger:hover { background: #fef2f2; }
```

- [ ] **Step 3: Wire `write/app.js`**

3a. Imports — after `import { createGitHub } from './github.js';` add:

```js
import { unpublishPost, deletePost } from './actions.js';
```

3b. `els` — change the first line of the `els` object to:

```js
  picker: $('picker'), btnNew: $('btn-new'), btnSave: $('btn-save'), btnPublish: $('btn-publish'),
  btnUnpublish: $('btn-unpublish'), btnDelete: $('btn-delete'),
```

3c. `renderDoc` — replace the line `els.btnUndo.hidden = state.undo.length === 0;` with:

```js
  els.btnUndo.hidden = state.undo.length === 0;
  renderActions();
```

and add this function directly after `renderDoc`:

```js
// Which of 초안으로 / 삭제 apply to the current document (spec 5.8a). Never for About.
function renderActions() {
  const d = state.doc;
  const isPost = d.kind === 'post';
  els.btnUnpublish.hidden = !(isPost && !!d.publishedPath);
  els.btnDelete.hidden = !(isPost && !!(d.publishedPath || d.savedSlug));
}
```

3d. `setBusy` — add two lines inside the function body:

```js
  els.btnUnpublish.disabled = busy;
  els.btnDelete.disabled = busy;
```

3e. `refreshPicker` — a `save()` inside unpublish starts a background refresh that can still see the published file; a later refresh must win. Change the start of `refreshPicker` to:

```js
let pickerSeq = 0;
async function refreshPicker() {
  if (!gh) return;
  const seq = ++pickerSeq;
  const [drafts, posts] = await Promise.all([
    gh.listDir(settings.github.draftsRepo, 'drafts'),
    gh.listDir(settings.github.siteRepo, '_posts'),
  ]);
  if (seq !== pickerSeq) return;   // a newer refresh is in flight; let it win
```

(the rest of the function is unchanged).

3f. `save` — the 삭제 button must appear after the first save. Replace the line `d.savedSlug = d.slug;` inside `save()` with:

```js
    d.savedSlug = d.slug;
    renderActions();
```

3g. `doPublish` — replace the line `els.slug.disabled = d.kind === 'post';` with:

```js
    els.slug.disabled = d.kind === 'post';
    renderActions();
```

3h. New handlers — add directly after `doPublish` (before the `// ---------- settings ----------` comment):

```js
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
```

3i. `bind` — after `els.btnPublish.addEventListener('click', publish);` add:

```js
  els.btnUnpublish.addEventListener('click', unpublish);
  els.btnDelete.addEventListener('click', remove);
```

- [ ] **Step 4: Syntax check and full suite**

Run: `node --check write/app.js && node --test write/test.mjs 2>&1 | tail -8`
Expected: no syntax error; `ℹ tests 40`, `ℹ pass 40`, `ℹ fail 0`.

- [ ] **Step 5: Static walk-through (write the answers in your report)**

Confirm by reading the code, and state each in the report:
1. With a fresh `새 글`, both new buttons are hidden (`renderDoc` → `renderActions`).
2. After the first successful `저장`, `삭제` appears; `초안으로` stays hidden.
3. After opening an item from the `발행됨` group, both appear; the slug field is disabled.
4. After `초안으로` succeeds, `초안으로` hides, `삭제` stays, slug enabled, picker shows `draft:<slug>`.
5. After `삭제` succeeds, the form is a new empty post, both buttons hidden, picker on `글 선택…`.
6. Opening About hides both buttons.
7. While any request runs, both buttons are disabled (`setBusy`).

- [ ] **Step 6: Commit**

```bash
git add write/index.html write/app.css write/app.js
git commit -m "Editor: unpublish to draft and delete actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Manual verification (controller, after Task 2)

Serve the site locally (`scripts/jekyll-serve.sh`) or use the deployed editor, and with the real token:
1. Open the published post, press `초안으로`, confirm. Expect: picker moves it to 초안, `_posts/` file gone, `drafts/<slug>.md` + `.chat.json` present, `archive/<slug>.chat.json` gone.
2. Press `발행` again. Expect: new `_posts/<today>-<slug>.md`, draft files gone, archive present.
3. Create a throwaway draft, save, press `삭제`, confirm. Expect: draft files gone, new-post screen.
