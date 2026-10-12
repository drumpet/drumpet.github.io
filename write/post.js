// 순수 함수만. DOM·fetch 없음.

const FIELD_ORDER = ['title', 'date', 'lang', 'description'];

export function parseFrontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0].trim() !== '---') return { fields: {}, body: text };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { fields: {}, body: text };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (/^".*"$/.test(value)) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    if (key) fields[key] = value;
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function yamlScalar(v) {
  const s = String(v);
  const risky = /[:#\[\]{}&*!|>'"%@`]|^\s|\s$|^[-?]|^(true|false|yes|no|null|~)$/i;
  return risky.test(s) ? JSON.stringify(s) : s;
}

export function serializePost(fields, body) {
  const lines = ['---'];
  for (const key of FIELD_ORDER) {
    const v = fields[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    lines.push(`${key}: ${yamlScalar(v)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n\n' + String(body).replace(/\s+$/, '') + '\n';
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function defaultSlug(title, date) {
  return slugify(title) || `post-${String(date).replace(/-/g, '')}`;
}

export function slugFromPostPath(path) {
  return path.replace(/^.*\//, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
}

export function postFilename(date, slug, existingPath) {
  return existingPath || `_posts/${date}-${slug}.md`;
}

export function extractDraft(text) {
  const re = /<draft>\s*([\s\S]*?)\s*<\/draft>/g;
  let draft = null;
  let m;
  while ((m = re.exec(text))) draft = m[1];
  const open = text.lastIndexOf('<draft>');
  const close = text.lastIndexOf('</draft>');
  const unclosed = open !== -1 && close < open;
  return { draft, unclosed };
}

export function visibleText(text) {
  let out = text.replace(/<draft>[\s\S]*?<\/draft>/g, '');
  const i = out.indexOf('<draft>');
  if (i !== -1) out = out.slice(0, i);
  out = out.replace(/<(d(r(a(f(t)?)?)?)?)?$/, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function buildUserContent(draftText, userText) {
  return `<current_draft>\n${draftText}\n</current_draft>\n\n${userText}`;
}

export function buildHistory(chat) {
  const out = [];
  for (const m of chat) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = String(m.content ?? '');
    if (!content.trim()) continue;
    if (out.length === 0 && m.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + content;
    else out.push({ role: m.role, content });
  }
  return out;
}

export function buildSystemPrompt() {
  return `You are a writing partner for Anthony Paek (백승욱), co-founder and Executive Chairman of Lunit, who writes a personal blog at anthonypaek.com in Korean and English.

How to work:
- Reply conversationally and briefly. Ask when the direction is unclear.
- Each user message starts with the user's current draft inside <current_draft>...</current_draft>. That draft is always the source of truth, even if it differs from what you wrote earlier; the user may have edited it by hand.
- When you write or revise the draft, output the COMPLETE draft inside <draft> ... </draft>: the YAML frontmatter (title, date, lang, description; you may add a "slug:" line with a short English URL slug) followed by the Markdown body. Never output a partial draft or a diff. If the current draft has no frontmatter, it is a page rather than a post: output only the Markdown body inside <draft>.
- Outside <draft>, explain what you changed in one or two sentences.
- Do not use <draft> when you are only discussing, brainstorming, or answering a question.
- Write in the language of the draft's lang field (ko or en). Keep the author's voice: first person, direct, concrete, no filler, no hype.`;
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
