# 방문 통계 (Cloudflare Worker + D1)

사이트의 각 페이지가 열릴 때 `navigator.sendBeacon`으로 이 Worker에 `{경로, 유입 사이트}`를 보냅니다. Worker는 D1(SQLite)에 한 줄씩 쌓고, 관리 페이지 `/manage/`가 집계를 읽어 보여 줍니다(코드: `manage/`).

- 쿠키 없음. IP는 저장하지 않습니다. 방문자 수는 `(그날의 무작위 salt, IP, User-Agent)` 해시로 셉니다. salt는 매일(한국 시간 자정) 지워지므로 같은 사람을 날짜를 넘어 추적할 수 없습니다. 그래서 "방문자"는 **일별 순방문자의 합**입니다.
- 봇(User-Agent 기준), `/write/`·`/manage/`, 허용되지 않은 origin에서 온 요청은 버립니다.
- 400일이 지난 기록은 매일 자동 삭제됩니다.
- 사이트에 외부 스크립트는 넣지 않습니다(`_layouts/default.html`의 인라인 몇 줄).
- 비용: Workers·D1 무료 한도 안에서 개인 사이트는 0원입니다.

## 처음 한 번: 배포

필요한 것: Cloudflare 계정(무료), Node.js 18 이상이 깔린 컴퓨터. 도메인을 Cloudflare로 옮길 필요는 없습니다.

1. https://dash.cloudflare.com/sign-up 에서 가입하고 이메일 인증을 합니다.
2. 이 저장소의 `analytics/` 폴더에서:

   ```sh
   cd analytics
   npx wrangler login                 # 브라우저가 열리면 Allow
   npx wrangler d1 create ap-pulse    # 출력된 database_id 를 복사
   ```

3. `wrangler.toml`의 `database_id = "REPLACE_WITH_ID_FROM_d1_create"`를 방금 복사한 값으로 바꿉니다.
4. 테이블을 만들고, 통계 토큰을 정하고, 배포합니다.

   ```sh
   npx wrangler d1 execute ap-pulse --remote --file=schema.sql
   openssl rand -hex 24                  # 이 값을 통계 토큰으로 씀. 따로 보관
   npx wrangler secret put STATS_TOKEN   # 위 값을 붙여넣기
   npx wrangler deploy                   # 끝에 https://ap-pulse.<계정>.workers.dev 주소가 나옴
   ```

   처음 배포할 때 workers.dev 하위 도메인 이름을 물으면 원하는 이름을 정하면 됩니다.

5. 사이트에 연결: `_config.yml`의 `analytics_url`에 Worker 주소를 넣고(끝에 `/` 없이) 커밋합니다.

   ```yaml
   analytics_url: "https://ap-pulse.<계정>.workers.dev"
   ```

6. `https://anthonypaek.com/manage/`를 열고 설정에 Worker URL과 4단계의 통계 토큰을 넣습니다.

## 나중에

- 코드를 바꾼 뒤: `cd analytics && npx wrangler deploy`
- 토큰 교체: `npx wrangler secret put STATS_TOKEN` 후 `/manage/` 설정도 바꿈
- 원본 데이터 보기: `npx wrangler d1 execute ap-pulse --remote --command "SELECT * FROM hits ORDER BY ts DESC LIMIT 20"`
- 테스트: 저장소 루트에서 `node --test analytics/test.mjs` (Node 22.5 이상, `node:sqlite`로 D1을 흉내 냄)

## 알아둘 점

- 광고 차단기 일부는 `*.workers.dev`로 가는 비콘도 막을 수 있어 실제보다 조금 적게 잡힐 수 있습니다. 도메인 DNS를 Cloudflare로 옮기면 `stats.anthonypaek.com` 같은 자기 도메인으로 붙일 수 있습니다(선택).
- 비콘은 누구나 흉내 낼 수 있습니다(Origin 헤더 위조). 개인 사이트 통계 용도로는 충분하지만 숫자를 증빙에 쓰지는 마세요.
