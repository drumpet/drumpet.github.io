# 개인 홈페이지 블로그 + AI 협업 에디터 설계

작성일: 2026-10-12
대상 저장소: `drumpet/drumpet.github.io` (public), `drumpet/drafts` (private, 신규)
배포 도메인: `anthonypaek.com` (GoDaddy DNS → GitHub Pages)

## 1. 목표와 제약

목표
- 글이 한 개만 있어도 허전하지 않은 개인 홈페이지.
- 웹페이지에서 AI와 대화하면서 글을 쓰고, 그 자리에서 저장·발행한다.
- 콘텐츠는 모두 Markdown 파일. DB 없음. 저장소는 GitHub.
- 작성 중인 초안(work-in-progress)은 다른 사람이 볼 수 없다.
- AI 제공자는 Claude / OpenAI / 로컬 모델(Ollama, LM Studio) 중 선택.

제약
- 서버·빌드 파이프라인·GitHub Action 없음. 복잡한 시스템을 피한다.
- 비밀값(API 키, GitHub 토큰)은 사용자의 브라우저 localStorage에만 둔다. 저장소에는 절대 들어가지 않는다.
- GitHub Pages 기본 Jekyll(플러그인 없음)만 사용한다.

## 2. 전체 구조

```
브라우저 (/write/ 에디터)
   ├─ Claude Messages API  (직접 호출, 스트리밍)
   ├─ OpenAI chat/completions 또는 로컬 OpenAI 호환 서버 (스트리밍)
   └─ GitHub Contents API
        ├─ drumpet/drafts (private): drafts/*.md, drafts/*.chat.json, archive/*.chat.json
        └─ drumpet/drumpet.github.io (public): _posts/*.md, _includes/about.md
                 └─ GitHub Pages(Jekyll) 자동 빌드 → https://anthonypaek.com
```

## 3. 저장소 레이아웃

### 3.1 public `drumpet/drumpet.github.io`

```
_config.yml
_layouts/default.html
_layouts/post.html
_includes/about.md
_posts/YYYY-MM-DD-slug.md
index.html
write/index.html
write/app.css
write/app.js
write/providers.js
write/github.js
write/post.js
write/test.mjs
CNAME
robots.txt
404.html
style.css
portrait.png
favicon.ico
docs/superpowers/...        (설계·계획 문서, Jekyll 빌드에서 제외)
```

이미 staging된 변경(Next.js 산출물 `_next/`, `.nojekyll`, `apaek.jpg`, `next.svg`, `vercel.svg` 삭제, `index.html`/`404.html` 수정, `style.css`/`portrait.png` 추가)은 이 작업의 첫 커밋에 포함한다. `.nojekyll`은 삭제된 상태를 유지한다(Jekyll을 써야 하므로).

`_config.yml`
```yaml
title: Anthony Paek
url: https://anthonypaek.com
permalink: /blog/:title/
markdown: kramdown
exclude:
  - docs
  - write/test.mjs
  - README.md
  - Gemfile
  - Gemfile.lock
  - vendor
```

`.gitignore`에 `_site/`, `.jekyll-cache/`, `vendor/`를 추가한다.

### 3.2 private `drumpet/drafts`

```
drafts/<slug>.md          초안. frontmatter + 본문 (발행본과 동일 형식)
drafts/<slug>.chat.json   그 초안의 대화 기록
drafts/about.md           About 초안 (frontmatter 없음)
archive/<slug>.chat.json  발행 후 보관되는 대화 기록
README.md                 용도 한 줄
```

### 3.3 글 파일 형식

```markdown
---
title: 글 제목
date: 2026-10-12
lang: ko
description: 목록·피처 카드·OG 미리보기에 쓰는 한 줄 요약
---

본문 Markdown
```

- `date`는 `YYYY-MM-DD`. 파일명은 `_posts/YYYY-MM-DD-slug.md`.
- `lang`은 `ko` 또는 `en`. 글 페이지 `<html lang>`에 반영.
- `slug`는 ASCII 소문자·숫자·하이픈만. 제목이 ASCII면 제목에서 자동 생성, 아니면 사용자가 직접 입력(AI에게 추천을 받을 수 있음). 비어 있으면 `post-YYYYMMDD`.

### 3.4 대화 기록 형식 (`*.chat.json`)

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-5-5",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`messages`는 사용자와 AI의 텍스트만 담는다. `<draft>` 블록은 assistant content 안에 그대로 남긴다(기록 보존, 재전송 시 모델이 자기 변경 이력을 안다). 현재 초안 주입분(`<current_draft>`)은 저장하지 않는다.

## 4. 사이트 (Jekyll)

### 4.1 `_layouts/default.html`
- `<html lang="{{ page.lang | default: 'en' }}">`
- `<title>`: 글이면 `{{ page.title }} · Anthony Paek`, 아니면 `Anthony Paek | 백승욱`
- OG 메타: `og:title`, `og:description`(`page.description` → 없으면 사이트 기본 문구), `og:image`(`{{ site.url }}/portrait.png`), `og:url`(`{{ site.url }}{{ page.url }}`), `og:type`(글이면 `article`, 아니면 `profile`).
- `style.css` 링크, favicon.
- `<main>{{ content }}</main>`

### 4.2 `_layouts/post.html`
- `layout: default`
- 상단에 홈으로 가는 작은 링크(`← Anthony Paek`), 제목(`<h1>`), 날짜(`<time>`), 본문.
- 하단에 홈 링크 반복.

### 4.3 `index.html`
위에서 아래로:
1. 프로필 헤더 — 지금 `index.html`의 `.header` 섹션 그대로.
2. 최신 글 피처 카드 — `site.posts.first`가 있을 때만. 제목(링크), 날짜, description, "읽기 →".
3. About — `{% capture about %}{% include about.md %}{% endcapture %}{{ about | markdownify }}`.
4. 글 목록 — `site.posts`에서 첫 글을 제외한 나머지. 1개 이상일 때만 "Writing" 소제목과 함께 표시. 항목은 제목(링크)과 날짜.

글 0개: 2와 4 모두 숨김. 글 1개: 2만 표시. 글 2개 이상: 2와 4 표시.

### 4.4 `_includes/about.md`
초기 내용은 지금 `index.html`의 소개 문단 하나. 이후 에디터의 About 편집으로 확장한다.

### 4.5 `style.css`
기존 규칙은 유지하고 다음을 추가한다: 피처 카드(`.featured`), 글 목록(`.posts`), 글 본문 타이포(`.post h1/h2/p/blockquote/pre/code/img`, 본문 이미지 `max-width: 100%`), 코드 블록 가로 스크롤, 모바일(520px 이하) 여백. 폰트·색·컬럼 폭은 기존 값 그대로.

### 4.6 기타
- `404.html`: `layout: default` 사용으로 전환.
- `robots.txt`: `User-agent: *` / `Disallow: /write/`.
- `CNAME`: `anthonypaek.com`.

## 5. 에디터 (`/write/`)

### 5.1 원칙
- 바닐라 ES 모듈. 빌드 없음. 외부 의존성은 미리보기용 `marked`(cdnjs) 하나.
- `<meta name="robots" content="noindex">`.
- 키가 없으면 설정 화면만 뜨고 아무것도 할 수 없다. 에디터 자체에는 비밀이 없으므로 public 저장소에 둔다.
- 같은 파일을 로컬 정적 서버(`python3 -m http.server`)로 띄워도 동일하게 동작한다. 로컬 모델을 쓸 때는 이 방식을 권장한다(https 페이지에서 `http://localhost` 호출은 브라우저가 차단할 수 있음).

### 5.2 파일 책임
| 파일 | 역할 | 의존 |
|---|---|---|
| `index.html` | 마크업, 설정 모달, 스크립트 로드 | app.js |
| `app.css` | 에디터 레이아웃(2단, 모바일은 탭 전환) | — |
| `app.js` | 상태, UI 이벤트, 저장/발행 오케스트레이션, localStorage | providers, github, post |
| `providers.js` | `streamChat({provider, settings, system, messages, onText})`, `listModels(settings)` | fetch |
| `github.js` | `getFile`, `putFile`, `deleteFile`, `listDir` (Contents API, sha 처리, 409 재시도 1회) | fetch |
| `post.js` | 순수 함수: `parseFrontmatter`, `serializePost`, `slugify`, `postFilename`, `extractDraft`, `buildPrompt` | 없음 |
| `test.mjs` | `node --test` 로 post.js와 providers.js의 요청 본문 생성 테스트 | post, providers |

`providers.js`의 요청 본문 생성(`buildAnthropicBody`, `buildOpenAIBody`)은 fetch와 분리된 순수 함수로 export 해서 테스트한다.

### 5.3 화면
```
┌──────────────────────────────────────────────────────────────┐
│ [글 선택 ▾] [새 글] [저장] [발행] [초안으로] [삭제]  상태  [설정] │
├───────────────────────────┬──────────────────────────────────┤
│ 대화                       │ 제목 [            ] slug [      ] │
│                           │ description [                 ]  │
│ 나: ...                    │ 언어 [ko▾] 날짜 [2026-10-12]      │
│ AI: ...  (초안 갱신됨) [되돌리기]│ [편집] [미리보기]                 │
│                           │ ┌──────────────────────────────┐ │
│                           │ │ 본문 textarea / 미리보기 iframe │ │
│ [입력               ] [보내기]│ └──────────────────────────────┘ │
└───────────────────────────┴──────────────────────────────────┘
```
- 글 선택 메뉴: 섹션 세 개 — 초안(`drafts/*.md`), 발행됨(`_posts/*.md`), 페이지(About). 열면 해당 파일과 대화 기록을 불러온다.
- About을 열면 frontmatter 입력칸은 숨기고 본문만 편집한다.
- 상태 표시: "저장되지 않음 / 저장됨 / 저장 중 / 발행 중 / 오류".
- 모바일(768px 이하): 대화·초안을 탭으로 전환.

### 5.4 설정 (localStorage `write.settings`)
```json
{
  "provider": "anthropic",
  "anthropic": { "apiKey": "", "model": "claude-opus-5-5" },
  "openai":    { "apiKey": "", "model": "", "baseUrl": "https://api.openai.com/v1" },
  "local":     { "apiKey": "", "model": "", "baseUrl": "http://localhost:11434/v1" },
  "github":    { "token": "", "siteRepo": "drumpet/drumpet.github.io", "draftsRepo": "drumpet/drafts" }
}
```
- "모델 목록 불러오기" 버튼: OpenAI·로컬은 `GET {baseUrl}/models`, Claude는 `GET https://api.anthropic.com/v1/models`. 실패하면 직접 입력.
- GitHub 토큰은 fine-grained PAT, 두 저장소에 Contents: Read and write 만. 설정 화면에 발급 경로와 권한을 안내 문구로 적는다.

### 5.5 AI 협업 규약
요청 구성(매 턴):
1. `system`: 고정 시스템 프롬프트. 역할(블로그 공동 집필자), 글쓴이 정보(이름, 직함), 규칙:
   - 평소에는 짧게 대화로 답한다.
   - 초안을 쓰거나 고칠 때는 **frontmatter를 포함한 초안 전체**를 `<draft>` … `</draft>` 안에 넣는다. 부분만 넣지 않는다.
   - `<draft>` 밖에서는 바뀐 점을 한두 문장으로 설명한다.
   - 사용자가 직접 고친 초안이 항상 최신이다(`<current_draft>` 기준).
   - 글의 언어는 초안의 `lang`을 따른다.
2. `messages`: 대화 기록 + 마지막 사용자 메시지. 마지막 사용자 메시지의 content는
   ```
   <current_draft>
   (현재 에디터 초안 전체, frontmatter 포함)
   </current_draft>

   (사용자가 입력한 텍스트)
   ```
   기록에 저장할 때는 사용자가 입력한 텍스트만 저장한다.

응답 처리:
- 스트리밍 텍스트를 받으면서 `<draft>`가 열리면 그 이후는 대화창에 표시하지 않고 버퍼에 쌓는다. `</draft>`가 닫히거나 스트림이 끝나면 버퍼를 `parseFrontmatter`로 파싱해 제목·slug(비어 있을 때만)·description·lang·date·본문에 반영한다.
- 반영 직전 초안을 undo 스택(최근 10개)에 넣고, 대화창 메시지에 "초안 갱신됨 [되돌리기]" 칩을 붙인다.
- `<draft>`가 열렸는데 안 닫힌 채 끝나면(토큰 초과 등) 반영하지 않고 "초안이 잘려 반영하지 않았습니다"를 표시한다.
- 응답이 `<draft>`를 여러 번 포함하면 마지막 것만 반영한다.

### 5.6 제공자별 호출 (`providers.js`)

Claude (`provider: "anthropic"`)
- `POST https://api.anthropic.com/v1/messages`
- 헤더: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `anthropic-beta: server-side-fallback-2026-07-01`, `content-type: application/json`
- 본문: `{ model, max_tokens: 16000, stream: true, system, messages, fallbacks: "default" }`. `thinking` 파라미터는 보내지 않는다(Opus 5.5는 기본 adaptive).
- SSE 파싱: `content_block_delta` 의 `delta.text`만 모은다. `message_delta`의 `stop_reason`이 `refusal`이면 오류로 표시. `max_tokens`면 잘림 경고.

OpenAI / 로컬 (`provider: "openai" | "local"`)
- `POST {baseUrl}/chat/completions`
- 헤더: `Authorization: Bearer {apiKey}`(로컬은 키가 비어 있으면 헤더 생략), `content-type: application/json`
- 본문: `{ model, stream: true, messages: [{role:"system", content: system}, ...messages] }`
- SSE 파싱: `choices[0].delta.content`. `[DONE]`에서 종료. `finish_reason: "length"`면 잘림 경고.

공통
- `AbortController`로 "중지" 버튼 지원.
- HTTP 오류는 상태 코드와 응답 본문의 메시지를 대화창에 빨간 시스템 줄로 표시. 401/403은 "설정에서 키를 확인하세요"를 덧붙인다. 네트워크 오류(`TypeError: Failed to fetch`)는 로컬 제공자일 때 CORS/mixed content 가능성을 안내한다.

### 5.7 저장 (`저장` 버튼, Cmd/Ctrl+S)
1. `serializePost(fields, body)` → `drafts/<slug>.md` 로 `putFile`(기존 sha 있으면 갱신).
2. 대화 기록 → `drafts/<slug>.chat.json` 로 `putFile`.
3. About이면 `drafts/about.md` 하나만.
4. slug가 바뀌었으면 옛 파일 둘을 `deleteFile`.
5. 커밋 메시지: `Save draft: <title>`.

### 5.8 발행 (`발행` 버튼)
1. 검증: 제목·slug·날짜(`YYYY-MM-DD`)·본문이 비어 있지 않을 것. About은 본문만.
2. 대상 경로: 새 글은 `_posts/<date>-<slug>.md`. 발행된 글을 다시 발행하면 **원래 파일명 유지**(URL 보존). About은 `_includes/about.md`.
3. 먼저 저장(5.7)을 수행한다.
4. public 저장소에 `putFile`(커밋 메시지 `Publish: <title>` 또는 `Update: <title>`).
5. 성공하면 private 저장소에서 `drafts/<slug>.md` 삭제, `drafts/<slug>.chat.json` → `archive/<slug>.chat.json`으로 이동(put 후 delete). About은 `drafts/about.md` 삭제.
6. 글 URL(`{siteUrl}/blog/<slug>/`)을 표시하고 "GitHub Pages 빌드 후 약 1분 뒤 반영"을 안내.
7. 발행된 글을 다시 열 때는 `archive/<slug>.chat.json`이 있으면 대화를 불러온다. 다시 저장하면 `drafts/`에 초안이 생기고 글 선택 메뉴에 초안과 발행됨 양쪽에 나타난다(초안이 우선).

### 5.8a 발행 취소와 삭제 (2026-10-13 추가)

헤더에 상황에 따라 보이는 버튼 둘. About 페이지에서는 둘 다 숨긴다.

**`초안으로`** — `kind === 'post'`이고 `publishedPath`가 있을 때만 보인다.
1. 배너로 확인: "사이트에서 글이 내려가고 초안으로 돌아갑니다. 계속할까요?" [초안으로] [취소].
2. 먼저 저장(5.7)을 수행한다. 저장되지 않은 변경이 있어도 저장되므로 유실이 없다. 저장 실패 시 중단.
3. public 저장소에서 `publishedPath` 삭제(커밋 메시지 `Unpublish: <title>`).
4. private 저장소에서 `archive/<slug>.chat.json` 삭제(같은 메시지). 대화는 2단계에서 이미 `drafts/<slug>.chat.json`에 있다.
5. 문서 상태: `publishedPath = null`, slug 잠금 해제. 글 선택 목록을 다시 읽고 `draft:<slug>`를 선택 상태로 둔다. 상태줄 "초안으로 되돌림 (사이트에는 약 1분 뒤 반영)".
6. 3단계 이후 실패하면 "초안 + 발행본 공존" 상태가 되는데, 이는 5.8.7의 정상 상태(초안 우선)이므로 글이 사라지지 않는다.
7. 다시 발행하면 `publishedPath`가 없으므로 그때의 날짜로 새 파일명이 된다(5.8.2).

**`삭제`** — `kind === 'post'`이고 `publishedPath` 또는 `savedSlug`가 있을 때만 보인다. 빨간 계열(`button.danger`).
1. 배너로 확인: "'<title>'을(를) 삭제합니다. 저장하지 않은 변경도 함께 사라집니다. (두 저장소의 git 기록에는 남습니다)" [삭제] [취소].
2. 저장하지 않는다. 순서대로 `deleteFile`: public `publishedPath`(있을 때), private `drafts/<slug>.md`, `drafts/<slug>.chat.json`, `archive/<slug>.chat.json`. 없는 파일은 건너뛴다(`deleteFile`이 이미 그렇게 동작). 커밋 메시지 `Delete: <title>`.
3. 성공하면 새 글 화면으로 돌아간다: 현재 문서의 localStorage 버퍼 삭제, `dirty=false`, 글 선택을 비우고 목록을 다시 읽는다. 상태줄 "삭제됨".
4. 중간 실패 시 남은 파일은 그대로 두고 오류를 표시한다. 다시 `삭제`를 누르면 남은 것만 지워진다.

**공통**
- 두 작업 모두 `state.busy`로 잠그고 `setBusy`로 버튼을 비활성화한다. `setBusy`는 두 버튼도 함께 잠근다.
- 확인 배너는 기존 `showBanner`를 쓴다. 휴지통·되돌리기 단계는 두지 않는다. 복구는 git(`git revert`)으로 한다.
- GitHub 호출 순서는 순수 모듈 `write/actions.js`(`unpublishPost`, `deletePost`)에 두고 가짜 `gh`로 단위 테스트한다. `app.js`는 저장·상태 갱신·화면만 맡는다.

### 5.9 임시 저장과 복구
- 초안 필드·본문·대화가 바뀔 때마다 localStorage `write.buffer.<slug|new>`에 저장(300ms debounce).
- 에디터를 열 때 버퍼가 있으면 "저장되지 않은 작업이 있습니다. 복구할까요?"를 묻는다.
- 저장·발행 성공 시 해당 버퍼 삭제.

### 5.10 보안
- 미리보기는 `<iframe sandbox>`(allow-same-origin 없음)에 `srcdoc`으로 렌더링한다. 초안 안의 스크립트가 에디터의 localStorage에 접근할 수 없다.
- 대화 메시지는 `textContent`로만 넣는다. HTML로 해석하지 않는다.
- 설정 화면의 키 입력은 `type=password`.
- GitHub 토큰은 두 저장소 Contents 권한만. 만료 1년.
- **같은 origin 주의.** 에디터(`/write/`)와 발행된 글은 같은 origin(`anthonypaek.com`, 그 전엔 `drumpet.github.io`)에서 서빙된다. kramdown은 본문의 raw HTML을 그대로 통과시키므로, 발행된 글에 `<script>`나 이벤트 핸들러가 들어가면 글쓴이가 자기 사이트를 열 때 localStorage의 키·토큰을 읽을 수 있다. 완화책: (1) Liquid로 출력하는 제목·설명은 모두 `escape`, (2) 발행 전에 본문에서 `<script`, `<iframe`, `on*=`, `javascript:` 패턴을 찾으면 확인을 받는다, (3) AI 응답이나 붙여넣은 텍스트에서 온 HTML은 미리보기(sandbox)에서는 실행되지 않으니 눈으로 안 보인다는 점을 기억한다. 근본 해결은 에디터를 별도 origin(예: `write.anthonypaek.com`)에서 서빙하는 것이며, 필요해지면 별도 작업으로 한다.
- 미리보기 라이브러리 `marked`는 jsDelivr에서 **버전을 고정**해 불러오고, 미리보기를 열 때 지연 로드한다. CDN이 죽어도 에디터 자체는 뜬다.

## 6. 도메인 연결

GoDaddy DNS (사용자 작업, 단계 안내 제공)
| 타입 | 이름 | 값 |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | drumpet.github.io |

기존 `@` A 레코드(GoDaddy 파킹 `76.223.105.230`, `13.248.243.5`)와 `www` 레코드는 삭제한다. GoDaddy 웹사이트 빌더/포워딩이 켜져 있으면 끈다.

GitHub (`drumpet` 계정으로 `gh auth login` 후 API 또는 웹 UI)
1. 계정 설정 → Pages → 도메인 검증(`anthonypaek.com`) — TXT 레코드 하나를 GoDaddy에 추가.
2. 저장소 Settings → Pages → Custom domain `anthonypaek.com` 저장 (`CNAME` 파일 커밋됨). DNS 검사 통과 후 Enforce HTTPS 켜기.
3. `_config.yml`의 `url`과 `default.html`의 OG URL이 `https://anthonypaek.com`인지 확인.

## 7. 검증

단위 테스트 (`node --test write/test.mjs`)
- `parseFrontmatter` ↔ `serializePost` 왕복, 콜론·따옴표 포함 제목, frontmatter 없는 파일.
- `slugify`: ASCII 제목, 한글 제목(빈 결과), 공백·특수문자, 연속 하이픈.
- `postFilename`: 날짜+slug, 기존 파일명 유지 규칙.
- `extractDraft`: 없음 / 하나 / 여러 개(마지막) / 닫히지 않음 / 스트리밍 중 부분 수신.
- `buildPrompt`: `<current_draft>` 주입, 기록에는 원문만.
- `buildAnthropicBody`, `buildOpenAIBody`: 필수 필드와 헤더, 로컬 키 없을 때 Authorization 생략.

사이트
- Homebrew Ruby + `gem install jekyll bundler`로 로컬 빌드(`bundle exec jekyll serve`)가 되면 글 0개/1개/3개 케이스를 임시 글로 확인한 뒤 임시 글 제거.
- 로컬 빌드가 안 되면 푸시 후 `gh api repos/drumpet/drumpet.github.io/pages/builds/latest`로 상태 확인, `curl`로 `/`, `/blog/<slug>/`, `/write/`, `/404` 응답 확인.

에디터
- 로컬 정적 서버로 띄워 Chrome에서: 설정 저장, 글 선택 목록, 편집/미리보기, 되돌리기, 모바일 폭 레이아웃.
- 실제 API 키·GitHub 토큰을 쓰는 대화·저장·발행 테스트는 사용자가 수행한다.

## 8. 범위 밖

이미지 업로드, 태그/카테고리, 댓글, RSS, 검색, 다국어 동시 발행, 글 예약 발행. 필요해지면 별도 스펙으로.

## 9. 구현 순서 (개요)

1. 저장소 정리 커밋(이미 staging된 Next.js 산출물 삭제 등) + Jekyll 사이트 골격 + 홈·글 레이아웃.
2. private `drafts` 저장소 생성, README.
3. 에디터: `post.js` + 테스트 → `providers.js` + 테스트 → `github.js` → `app.js`/UI.
4. 도메인 연결(GoDaddy DNS, GitHub Pages 설정).
5. 사용자가 첫 글 작성·발행으로 end-to-end 확인.
