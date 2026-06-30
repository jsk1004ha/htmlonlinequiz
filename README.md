# HTML Quiz Lab

HTML 파일이나 HTML 코드를 업로드해서 퀴즈를 만들고, 다른 사용자가 플레이할 수 있는 React 기반 퀴즈 사이트입니다.

## 주요 기능

- 아이디/비밀번호 기반 회원가입 및 로그인
- HttpOnly 세션 쿠키 기반 로그인 상태 유지
- 메인 화면의 인기 퀴즈, 신규 퀴즈, 과목 필터, 검색
- 로그인한 사용자만 HTML 코드 기반 퀴즈 플레이 가능
- 퀴즈 플레이 전체화면 지원
- 로그인한 사용자만 HTML 파일 업로드 또는 HTML 코드 직접 작성 방식의 퀴즈 제작 가능
- 퀴즈 이름, 과목, 태그 등록
- 좋아요와 댓글 작성
- 서버 내부 SQLite DB를 통한 회원, 퀴즈, 댓글, 좋아요, 플레이 수 공유 저장

## 핵심 실행 구조

이 프로젝트는 더 이상 브라우저 `localStorage`를 공유 저장소로 사용하지 않습니다. 브라우저는 항상 `/api`를 호출하고, `/api` 서버가 서버 컴퓨터의 SQLite 파일에 저장합니다.

중요한 점은 **Vite 프론트만 단독으로 켜면 저장이 되지 않는다**는 것입니다. 반드시 Node 서버를 실행해야 합니다. 이제 `npm run dev` 하나로 React 프론트와 SQLite API가 같은 서버 프로세스에 붙도록 수정되어 있습니다.

## 개발 실행

```bash
npm install
npm run dev
```

기본 접속 주소는 다음과 같습니다.

```text
http://서버IP:3000
```

`npm run dev`는 Node/Express API와 Vite 개발 미들웨어를 한 프로세스에서 실행합니다. 따라서 `/api/quizzes`, `/api/auth/*` 요청이 같은 서버의 SQLite DB로 바로 연결됩니다.

기존처럼 Vite만 따로 띄우고 싶을 때만 다음을 사용합니다.

```bash
npm run dev:api
npm run dev:client
```

이 경우에도 브라우저는 Vite 프록시를 통해 API 서버에 연결되어야 합니다.

## 프로덕션 실행

```bash
npm install
npm run build
SESSION_SECRET="$(openssl rand -base64 48)" npm run start
```

빌드된 `dist/index.html`이 있으면 `npm run start`는 정적 파일과 `/api`를 같은 Express 서버에서 제공합니다. `dist`가 없고 `NODE_ENV=production`이 아니면 개발 편의를 위해 Vite 미들웨어로 프론트를 제공합니다.

## SQLite DB 위치

기본 SQLite 파일 위치는 다음과 같습니다.

```text
./data/htmlquizlab.sqlite
```

위치를 바꾸려면 다음 환경 변수를 사용합니다.

```bash
DATA_DIR=/absolute/path/to/data
SQLITE_PATH=/absolute/path/to/htmlquizlab.sqlite
```

서버가 시작될 때 DB 폴더와 테이블을 자동 생성합니다. DB 파일은 Git에 올라가지 않도록 `.gitignore`에 포함되어 있습니다.

## 서버 상태 확인

서버에서 다음 주소를 열면 실제 SQLite API가 연결되어 있는지 확인할 수 있습니다.

```text
http://서버IP:3000/api/health
```

정상 응답 예시는 다음과 같습니다.

```json
{
  "ok": true,
  "storage": "sqlite",
  "counts": {
    "users": 1,
    "quizzes": 2,
    "likes": 0,
    "comments": 0
  }
}
```

브라우저에서 `/api/health` 대신 React HTML이 보이면 API 서버가 아니라 프론트만 단독 실행 중인 상태입니다. 그 상태에서는 공유 DB 저장이 되지 않습니다.

## 리버스 프록시 / 도메인 설정

API 서버와 브라우저 접속 도메인이 리버스 프록시 뒤에서 다르게 인식될 수 있으면 `APP_ORIGIN`에 허용할 origin을 쉼표로 넣습니다.

```bash
APP_ORIGIN=https://logingwak.xyz,https://www.logingwak.xyz
```

프록시를 쓰는 경우 가능하면 다음 헤더를 백엔드로 전달하세요.

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

HTTPS 환경에서는 세션 쿠키에 `Secure`가 자동으로 붙습니다. HTTP 테스트 서버에서 쿠키가 저장되지 않는 경우에는 `.env`에서 `COOKIE_SECURE=false`를 사용할 수 있지만, 실제 공개 서비스에서는 HTTPS를 권장합니다.

## SQLite 저장 구조

앱 시작 시 서버가 SQLite DB와 테이블을 자동 생성합니다.

- `users`: 사용자 ID, 서버 측 scrypt 비밀번호 해시, salt
- `quizzes`: 퀴즈 제목, 과목, 태그 JSON, HTML, 작성자, 플레이 수
- `quiz_likes`: 퀴즈별 사용자 좋아요
- `comments`: 퀴즈별 댓글

브라우저는 DB 파일이나 DB 접속 권한을 직접 받지 않습니다. 모든 읽기/쓰기는 `/api` 서버를 통해서만 처리됩니다.

## 보안 메모

- 비밀번호는 클라이언트가 아니라 서버에서 `crypto.scryptSync`와 사용자별 salt로 해시합니다.
- 로그인 세션은 JavaScript에서 읽을 수 없는 HttpOnly 쿠키로 보관합니다.
- `SESSION_SECRET`이 없으면 운영 환경에서는 서버가 시작되지 않습니다.
- 개발 환경에서는 `data/.session-secret`을 자동 생성해 서버 재시작 후에도 세션 서명이 유지됩니다.
- DB 쓰기는 모두 서버 API에서 인증을 확인한 뒤 parameterized SQL로 실행합니다.
- 상태 변경 API 요청은 `Origin` 검사를 통과해야 하므로 기본 CSRF 위험을 줄입니다.
- 동일 host의 HTTP/HTTPS 프록시 차이는 허용하지만, 다른 사이트 origin은 차단합니다.
- API에는 일반 요청 제한과 로그인/회원가입 전용 rate limit을 적용합니다.
- API 응답에는 `X-Storage-Backend: sqlite` 헤더를 넣어 프론트가 정적 HTML 응답을 API로 오인하지 않게 했습니다.
- 업로드된 HTML은 iframe sandbox 안에서 실행됩니다.
- iframe에는 CSP가 삽입되며, 외부 네트워크 요청과 상위 창 접근을 제한합니다.
- HTML 크기는 512KB 이하로 제한됩니다.
- `data/`, `*.sqlite`, `*.sqlite-*`, `.env` 파일은 Git에 올리지 않습니다.

## 기술 스택

- React
- Vite
- Node.js / Express
- SQLite / better-sqlite3
- Helmet
- express-rate-limit
- Playwright

## 개발 참고

- `.omx/`, `node_modules/`, `dist/`, `data/`, `.env`, `.env.*`, `*.sqlite`, `*.sqlite-*`, `*.local` 파일은 Git에 올리지 않습니다.
- 배포 빌드 산출물은 `dist/`에 생성됩니다.
- 기존 브라우저 `localStorage` 회원/퀴즈 데이터는 더 이상 인증 소스로 사용하지 않습니다. 공유 저장을 위해 새 SQLite 서버에서 다시 회원가입 후 퀴즈를 등록하세요.
