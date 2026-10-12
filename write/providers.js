// AI 제공자 호출. Anthropic Messages API와 OpenAI 호환 chat/completions 두 형식.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1';

function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

export function buildAnthropicRequest(p, system, messages) {
  return {
    url: `${ANTHROPIC_URL}/messages`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': p.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: { model: p.model, max_tokens: 16000, stream: true, system, messages, fallbacks: 'default' },
  };
}

export function buildOpenAIRequest(p, system, messages) {
  const headers = { 'content-type': 'application/json' };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  return {
    url: `${trimSlash(p.baseUrl)}/chat/completions`,
    headers,
    body: { model: p.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] },
  };
}

export async function* sseData(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function httpError(res) {
  const raw = await res.text().catch(() => '');
  let msg = raw.slice(0, 300);
  try { msg = JSON.parse(raw).error?.message || msg; } catch { /* keep raw */ }
  const e = new Error(`HTTP ${res.status}: ${msg}`);
  e.status = res.status;
  return e;
}

function normalizeStop(provider, raw) {
  if (!raw) return null;
  if (provider === 'anthropic') {
    if (raw === 'max_tokens') return 'length';
    if (raw === 'refusal') return 'refusal';
    return 'end';
  }
  if (raw === 'length') return 'length';
  if (raw === 'content_filter') return 'refusal';
  return 'end';
}

export async function streamChat({ provider, settings, system, messages, onText, signal, fetchImpl = fetch }) {
  const isAnthropic = provider === 'anthropic';
  const req = isAnthropic ? buildAnthropicRequest(settings, system, messages) : buildOpenAIRequest(settings, system, messages);
  const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  if (!res.ok) throw await httpError(res);

  let text = '';
  let stop = null;
  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') break;
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (isAnthropic) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; onText(text); }
      else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new Error(ev.error?.message || 'stream error');
    } else {
      if (ev.error) throw new Error(ev.error.message || 'stream error');
      const c = ev.choices?.[0];
      if (c?.delta?.content) { text += c.delta.content; onText(text); }
      if (c?.finish_reason) stop = c.finish_reason;
    }
  }
  return { text, stop: normalizeStop(provider, stop) };
}

export async function listModels(provider, p, fetchImpl = fetch) {
  let url, headers;
  if (provider === 'anthropic') {
    url = `${ANTHROPIC_URL}/models?limit=100`;
    headers = { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  } else {
    url = `${trimSlash(p.baseUrl)}/models`;
    headers = p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
  }
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw await httpError(res);
  const json = await res.json();
  return (json.data || []).map((m) => m.id).filter(Boolean).sort();
}
