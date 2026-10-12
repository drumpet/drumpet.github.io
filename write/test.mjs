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
