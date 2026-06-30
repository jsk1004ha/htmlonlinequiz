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

## 화면 구성

- 메인화면: 인기 퀴즈, 신규 퀴즈, 검색, 과목 필터
- 퀴즈 플레이 화면: 로그인 후 접근 가능한 큰 플레이어, 전체화면 버튼, 좋아요, 댓글, 신규 퀴즈 목록
- 퀴즈 제작 화면: 로그인 후 접근 가능한 퀴즈 정보 입력, HTML 업로드/코드 작성, 실시간 미리보기

## 개발 실행

터미널을 2개 열고 API 서버와 Vite 개발 서버를 함께 실행합니다.

```bash
npm install
npm run dev:api
npm run dev
```

브라우저에서 Vite 개발 서버 주소를 엽니다. `/api` 요청은 `vite.config.js`의 프록시를 통해 `http://127.0.0.1:3000` SQLite API 서버로 전달됩니다.

## 프로덕션 실행

```bash
npm install
npm run build
SESSION_SECRET="$(openssl rand -base64 48)" npm run start
```

기본 SQLite 파일 위치는 `data/htmlquizlab.sqlite`입니다. 위치를 바꾸려면 다음 환경 변수를 사용합니다.

```bash
SQLITE_PATH=/absolute/path/to/htmlquizlab.sqlite
```

API 서버와 브라우저 접속 도메인이 리버스 프록시 뒤에서 다르게 인식될 수 있으면 `APP_ORIGIN`에 허용할 origin을 쉼표로 넣습니다.

```bash
APP_ORIGIN=https://logingwak.xyz,https://www.logingwak.xyz
```

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
- 프로덕션에서는 `SESSION_SECRET`이 없으면 서버가 시작되지 않습니다.
- DB 쓰기는 모두 서버 API에서 인증을 확인한 뒤 parameterized SQL로 실행합니다.
- 상태 변경 API 요청은 `Origin` 검사를 통과해야 하므로 기본 CSRF 위험을 줄입니다.
- API에는 일반 요청 제한과 로그인/회원가입 전용 rate limit을 적용합니다.
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
