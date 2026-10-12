import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter, serializePost, slugify, defaultSlug, slugFromPostPath,
  postFilename, extractDraft, visibleText, buildUserContent, buildSystemPrompt, todayISO,
} from './post.js';

test('parseFrontmatter: basic fields and body', () => {
  const { fields, body } = parseFrontmatter('---\ntitle: Hello\ndate: 2026-10-12\nlang: ko\ndescription: 요약\n---\n\n본문\n');
  assert.deepEqual(fields, { title: 'Hello', date: '2026-10-12', lang: 'ko', description: '요약' });
  assert.equal(body, '\n본문\n');
});

test('parseFrontmatter: quoted values and colon in title', () => {
  const { fields } = parseFrontmatter('---\ntitle: "A: B \\"q\\""\ndescription: \'it\'\'s\'\n---\nx');
  assert.equal(fields.title, 'A: B "q"');
  assert.equal(fields.description, "it's");
});

test('parseFrontmatter: no frontmatter returns whole text as body', () => {
  const r = parseFrontmatter('just text\n---\nnot frontmatter');
  assert.deepEqual(r.fields, {});
  assert.equal(r.body, 'just text\n---\nnot frontmatter');
});

test('parseFrontmatter: hr line in body is not mistaken for the closer', () => {
  const r = parseFrontmatter('---\ntitle: T\n---\nabove\n\n---\n\nbelow');
  assert.equal(r.fields.title, 'T');
  assert.equal(r.body, 'above\n\n---\n\nbelow');
});

test('parseFrontmatter: empty frontmatter', () => {
  const r = parseFrontmatter('---\n---\nbody');
  assert.deepEqual(r.fields, {});
  assert.equal(r.body, 'body');
});

test('serializePost: order, quoting, trailing newline', () => {
  const out = serializePost({ description: 'd', lang: 'ko', title: 'A: B', date: '2026-10-12', slug: 'ignored' }, 'body\n\n');
  assert.equal(out, '---\ntitle: "A: B"\ndate: 2026-10-12\nlang: ko\ndescription: d\n---\n\nbody\n');
});

test('serializePost: omits empty fields', () => {
  assert.equal(serializePost({ title: 'T', date: '2026-01-01', lang: '', description: '' }, 'b'), '---\ntitle: T\ndate: 2026-01-01\n---\n\nb\n');
});

test('round trip', () => {
  const fields = { title: '두 번째: 글', date: '2026-10-12', lang: 'ko', description: 'x #1' };
  const r = parseFrontmatter(serializePost(fields, 'hello'));
  assert.deepEqual(r.fields, fields);
  assert.equal(r.body.trim(), 'hello');
});

test('slugify', () => {
  assert.equal(slugify('Hello, World!  Again'), 'hello-world-again');
  assert.equal(slugify('한글 제목'), '');
  assert.equal(slugify('  Café--Au Lait  '), 'cafe-au-lait');
  assert.equal(defaultSlug('한글', '2026-10-12'), 'post-20261012');
  assert.equal(defaultSlug('My Title', '2026-10-12'), 'my-title');
});

test('slugFromPostPath and postFilename', () => {
  assert.equal(slugFromPostPath('_posts/2026-10-12-my-post.md'), 'my-post');
  assert.equal(postFilename('2026-10-12', 'my-post', null), '_posts/2026-10-12-my-post.md');
  assert.equal(postFilename('2027-01-01', 'renamed', '_posts/2026-10-12-my-post.md'), '_posts/2026-10-12-my-post.md');
});

test('extractDraft: none / one / last of many / unclosed', () => {
  assert.deepEqual(extractDraft('no draft here'), { draft: null, unclosed: false });
  assert.deepEqual(extractDraft('ok\n<draft>\n# A\n</draft>\ndone'), { draft: '# A', unclosed: false });
  assert.deepEqual(extractDraft('<draft>one</draft> x <draft>two</draft>'), { draft: 'two', unclosed: false });
  assert.deepEqual(extractDraft('<draft>one</draft> then <draft>partial'), { draft: 'one', unclosed: true });
  assert.deepEqual(extractDraft('<draft>partial only'), { draft: null, unclosed: true });
});

test('visibleText hides draft blocks and partial tags', () => {
  assert.equal(visibleText('Here it is:\n<draft>secret</draft>\nChanged intro.'), 'Here it is:\n\nChanged intro.');
  assert.equal(visibleText('Writing now\n<draft>partial'), 'Writing now');
  assert.equal(visibleText('Writing now\n<dra'), 'Writing now');
});

test('buildUserContent wraps draft', () => {
  assert.equal(buildUserContent('---\ntitle: T\n---\nb', 'make it shorter'), '<current_draft>\n---\ntitle: T\n---\nb\n</current_draft>\n\nmake it shorter');
});

test('buildSystemPrompt mentions the protocol', () => {
  const s = buildSystemPrompt();
  assert.match(s, /<draft>/);
  assert.match(s, /<current_draft>/);
});

test('todayISO format', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

import { buildAnthropicRequest, buildOpenAIRequest, sseData, streamChat } from './providers.js';

const msgs = [{ role: 'user', content: 'hi' }];

test('buildAnthropicRequest: headers and body', () => {
  const r = buildAnthropicRequest({ apiKey: 'k', model: 'claude-opus-5-5' }, 'SYS', msgs);
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.headers['x-api-key'], 'k');
  assert.equal(r.headers['anthropic-version'], '2023-06-01');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(r.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.deepEqual(r.body, { model: 'claude-opus-5-5', max_tokens: 16000, stream: true, system: 'SYS', messages: msgs, fallbacks: 'default' });
  assert.equal(r.body.thinking, undefined);
});

test('buildOpenAIRequest: system goes into messages, bearer header, trailing slash trimmed', () => {
  const r = buildOpenAIRequest({ apiKey: 'k', model: 'm', baseUrl: 'https://api.openai.com/v1/' }, 'SYS', msgs);
  assert.equal(r.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.deepEqual(r.body, { model: 'm', stream: true, messages: [{ role: 'system', content: 'SYS' }, ...msgs] });
});

test('buildOpenAIRequest: no authorization header when key empty (local)', () => {
  const r = buildOpenAIRequest({ apiKey: '', model: 'llama3', baseUrl: 'http://localhost:11434/v1' }, 'S', msgs);
  assert.equal(r.headers.authorization, undefined);
  assert.equal(r.url, 'http://localhost:11434/v1/chat/completions');
});

function streamOf(...chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
}

test('sseData yields data payloads across chunk boundaries', async () => {
  const out = [];
  for await (const d of sseData(streamOf('event: x\ndata: {"a":1}\n\nda', 'ta: [DONE]\n\n'))) out.push(d);
  assert.deepEqual(out, ['{"a":1}', '[DONE]']);
});

test('streamChat parses anthropic events', async () => {
  const body = streamOf(
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  );
  const seen = [];
  const fetchImpl = async () => new Response(body, { status: 200 });
  const r = await streamChat({ provider: 'anthropic', settings: { apiKey: 'k', model: 'm' }, system: 'S', messages: msgs, onText: (t) => seen.push(t), fetchImpl });
  assert.deepEqual(seen, ['Hel', 'Hello']);
  assert.deepEqual(r, { text: 'Hello', stop: 'end' });
});

test('streamChat parses openai events and length stop', async () => {
  const body = streamOf(
    'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"B"},"finish_reason":"length"}]}\n\n',
    'data: [DONE]\n\n',
  );
  const fetchImpl = async () => new Response(body, { status: 200 });
  const r = await streamChat({ provider: 'local', settings: { apiKey: '', model: 'm', baseUrl: 'http://x/v1' }, system: 'S', messages: msgs, onText: () => {}, fetchImpl });
  assert.deepEqual(r, { text: 'AB', stop: 'length' });
});

test('streamChat throws with status on HTTP error', async () => {
  const fetchImpl = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
  await assert.rejects(
    streamChat({ provider: 'anthropic', settings: { apiKey: 'k', model: 'm' }, system: 'S', messages: msgs, onText: () => {}, fetchImpl }),
    (e) => e.status === 401 && /bad key/.test(e.message),
  );
});

import { createGitHub, encodeContent, decodeContent } from './github.js';

test('encode/decode content round trips UTF-8', () => {
  const s = '한글 and emoji 🎉\n---\n';
  assert.equal(decodeContent(encodeContent(s)), s);
  assert.equal(decodeContent('7ZWc6riAIGFuZCBlbW9qaSDwn46J\nCi0tLQo='), s);
});

function fakeFetch(handlers) {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    const h = handlers.shift();
    if (!h) throw new Error('unexpected call ' + method + ' ' + url);
    return new Response(h.body === undefined ? null : JSON.stringify(h.body), { status: h.status });
  };
  f.calls = calls;
  return f;
}

test('getFile returns null on 404 and decoded content on 200', async () => {
  const f = fakeFetch([{ status: 404, body: {} }, { status: 200, body: { sha: 'abc', content: encodeContent('hi') } }]);
  const gh = createGitHub('t', f);
  assert.equal(await gh.getFile('o/r', 'drafts/x.md'), null);
  assert.deepEqual(await gh.getFile('o/r', 'drafts/x.md'), { sha: 'abc', content: 'hi' });
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/o/r/contents/drafts/x.md');
});

test('putFile sends sha for existing file and retries once on 409', async () => {
  const f = fakeFetch([
    { status: 200, body: { sha: 'old', content: encodeContent('v1') } },   // GET
    { status: 409, body: { message: 'conflict' } }, // PUT fails
    { status: 200, body: { sha: 'newer', content: encodeContent('v2') } }, // GET again
    { status: 200, body: { content: {} } },         // PUT ok
  ]);
  const gh = createGitHub('t', f);
  await gh.putFile('o/r', 'drafts/x.md', 'body', 'msg');
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[1].body.sha, 'old');
  assert.equal(f.calls[3].body.sha, 'newer');
  assert.equal(f.calls[3].body.message, 'msg');
  assert.equal(decodeContent(f.calls[3].body.content), 'body');
});

test('putFile creates without sha when missing', async () => {
  const f = fakeFetch([{ status: 404, body: {} }, { status: 201, body: {} }]);
  await createGitHub('t', f).putFile('o/r', 'new.md', 'x', 'm');
  assert.equal(f.calls[1].body.sha, undefined);
});

test('listDir returns files only and [] on 404', async () => {
  const f = fakeFetch([
    { status: 200, body: [{ type: 'file', name: 'a.md', path: 'drafts/a.md', sha: '1' }, { type: 'dir', name: 'sub', path: 'drafts/sub', sha: '2' }] },
    { status: 404, body: {} },
  ]);
  const gh = createGitHub('t', f);
  assert.deepEqual(await gh.listDir('o/r', 'drafts'), [{ name: 'a.md', path: 'drafts/a.md', sha: '1' }]);
  assert.deepEqual(await gh.listDir('o/r', 'nope'), []);
});

test('deleteFile is a no-op when file is missing', async () => {
  const f = fakeFetch([{ status: 404, body: {} }]);
  await createGitHub('t', f).deleteFile('o/r', 'gone.md', 'm');
  assert.equal(f.calls.length, 1);
});

test('requests bypass the HTTP cache so the sha is never stale', async () => {
  const inits = [];
  const f = async (url, init = {}) => {
    inits.push(init);
    return new Response(JSON.stringify({ sha: 's', content: encodeContent('x') }), { status: 200 });
  };
  await createGitHub('t', f).getFile('o/r', 'drafts/x.md');
  assert.equal(inits.length, 1);
  assert.equal(inits[0].cache, 'no-store');
});

import { DEFAULTS, mergeSettings, activeProvider, isConfigured } from './settings.js';

test('mergeSettings keeps defaults and ignores unknown keys', () => {
  const s = mergeSettings(DEFAULTS, { provider: 'local', local: { model: 'llama3' }, bogus: 1 });
  assert.equal(s.provider, 'local');
  assert.equal(s.local.model, 'llama3');
  assert.equal(s.local.baseUrl, 'http://localhost:11434/v1');
  assert.equal(s.anthropic.model, 'claude-opus-5-5');
  assert.equal(s.bogus, undefined);
});

test('activeProvider and isConfigured', () => {
  const s = mergeSettings(DEFAULTS, { github: { token: 't' } });
  assert.equal(isConfigured(s), false);                       // anthropic needs key
  s.anthropic.apiKey = 'k';
  assert.equal(isConfigured(s), true);
  assert.deepEqual(activeProvider(s), { provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5-5', baseUrl: '' });
  s.provider = 'local'; s.local.model = '';
  assert.equal(isConfigured(s), false);                       // local needs model
  s.local.model = 'llama3';
  assert.equal(isConfigured(s), true);                        // local needs no key
  s.github.token = '';
  assert.equal(isConfigured(s), false);
});

import { buildHistory } from './post.js';

test('buildHistory drops system lines and empty assistant messages', () => {
  const chat = [
    { role: 'user', content: 'a' },
    { role: 'system', content: '중지했습니다.' },
    { role: 'assistant', content: '   ' },
    { role: 'assistant', content: 'b' },
  ];
  assert.deepEqual(buildHistory(chat), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
});

test('buildHistory merges consecutive user turns with a blank line', () => {
  const chat = [
    { role: 'user', content: 'first' },
    { role: 'system', content: 'error', error: true },
    { role: 'user', content: 'second' },
  ];
  assert.deepEqual(buildHistory(chat), [{ role: 'user', content: 'first\n\nsecond' }]);
});

test('buildHistory drops leading assistant messages', () => {
  const chat = [{ role: 'assistant', content: 'hello' }, { role: 'user', content: 'hi' }];
  assert.deepEqual(buildHistory(chat), [{ role: 'user', content: 'hi' }]);
});

test('buildHistory returns a normal chat unchanged without mutating input', () => {
  const chat = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1', note: '초안 갱신됨' },
    { role: 'user', content: 'q2' },
  ];
  const before = structuredClone(chat);
  const out = buildHistory(chat);
  assert.deepEqual(out, [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]);
  assert.deepEqual(chat, before);
  assert.notEqual(out[0], chat[0]);
});
