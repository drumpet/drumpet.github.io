// GitHub Contents API 최소 래퍼. 토큰은 fine-grained PAT (Contents: read/write).

const API = 'https://api.github.com';

export function encodeContent(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeContent(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGitHub(token, fetchImpl = fetch) {
  const base = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };

  async function request(method, path, body) {
    const headers = body ? { ...base, 'content-type': 'application/json' } : base;
    const res = await fetchImpl(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* ignore */ }
      const e = new Error(`GitHub ${res.status}${msg ? ': ' + msg : ''}`);
      e.status = res.status;
      throw e;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  const contents = (repo, path) => `/repos/${repo}/contents/${encodePath(path)}`;

  const api = {
    async getFile(repo, path) {
      const r = await request('GET', contents(repo, path));
      if (!r || Array.isArray(r)) return null;
      return { sha: r.sha, content: decodeContent(r.content) };
    },

    async listDir(repo, path) {
      const r = await request('GET', contents(repo, path));
      if (!Array.isArray(r)) return [];
      return r.filter((x) => x.type === 'file').map((x) => ({ name: x.name, path: x.path, sha: x.sha }));
    },

    async putFile(repo, path, content, message) {
      const attempt = async () => {
        const cur = await api.getFile(repo, path);
        const body = { message, content: encodeContent(content) };
        if (cur) body.sha = cur.sha;
        await request('PUT', contents(repo, path), body);
      };
      try {
        await attempt();
      } catch (e) {
        if (e.status === 409 || e.status === 422) await attempt();
        else throw e;
      }
    },

    async deleteFile(repo, path, message) {
      const cur = await api.getFile(repo, path);
      if (!cur) return;
      await request('DELETE', contents(repo, path), { message, sha: cur.sha });
    },
  };
  return api;
}
