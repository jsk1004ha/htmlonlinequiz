# HTML Quiz Lab

HTML 파일이나 HTML 코드를 업로드해서 퀴즈를 만들고, 다른 사용자가 플레이할 수 있는 React 기반 퀴즈 사이트입니다.

## 주요 기능

- 아이디/비밀번호 기반 회원가입 및 로그인
- 로그인 상태 자동 유지
- 메인 화면의 인기 퀴즈, 신규 퀴즈, 과목 필터, 검색
- 로그인한 사용자만 HTML 코드 기반 퀴즈 플레이 가능
- 퀴즈 플레이 전체화면 지원
- 로그인한 사용자만 HTML 파일 업로드 또는 HTML 코드 직접 작성 방식의 퀴즈 제작 가능
- 퀴즈 이름, 과목, 태그 등록
- 좋아요와 댓글 작성
- Supabase DB를 통한 회원, 퀴즈, 댓글, 좋아요, 플레이 수 공유 저장

## 화면 구성

- 메인화면: 인기 퀴즈, 신규 퀴즈, 검색, 과목 필터
- 퀴즈 플레이 화면: 로그인 후 접근 가능한 큰 플레이어, 전체화면 버튼, 좋아요, 댓글, 신규 퀴즈 목록
- 퀴즈 제작 화면: 로그인 후 접근 가능한 퀴즈 정보 입력, HTML 업로드/코드 작성, 실시간 미리보기

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 개발 서버 주소를 엽니다. 기본 Vite 설정은 `127.0.0.1` 호스트를 사용합니다.

## DB 공유 저장 설정

기본 상태에서는 환경 변수가 없으면 브라우저 `localStorage`를 캐시 겸 fallback으로 사용합니다. 여러 사용자가 같은 회원, 퀴즈, 댓글, 좋아요, 플레이 수를 공유하게 하려면 Supabase 프로젝트에서 `supabase/schema.sql`을 실행한 뒤 배포 환경 변수에 다음 값을 추가합니다.

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

선택적으로 테이블명을 바꾸려면 다음 값을 함께 설정합니다.

```bash
VITE_SUPABASE_STATE_TABLE=htmlquizlab_state
```

환경 변수가 설정되면 앱은 렌더링 전에 Supabase DB 상태를 `localStorage` 캐시에 먼저 불러오고, 이후 회원가입, 퀴즈 등록, 댓글, 좋아요, 플레이 수 변경을 Supabase REST API로 동기화합니다. 기존 브라우저에만 남아 있던 데이터는 DB에 없는 `id` 항목만 최초 동기화 때 DB로 backfill됩니다.

## 빌드

```bash
npm run build
```

## 보안 메모

- 업로드된 HTML은 iframe sandbox 안에서 실행됩니다.
- iframe에는 CSP가 삽입되며, 외부 네트워크 요청과 상위 창 접근을 제한합니다.
- HTML 크기는 512KB 이하로 제한됩니다.
- Supabase 환경 변수가 없으면 회원, 퀴즈, 댓글 데이터는 브라우저 `localStorage`에만 저장됩니다.
- Supabase 환경 변수가 있으면 공유 DB와 동기화되지만, 현재 인증은 데모용 클라이언트 해시 방식입니다. 실제 서비스에서는 Supabase Auth나 서버 측 인증, 세션 관리, 서버 측 HTML 검증을 추가해야 합니다.
- 기본 더미 퀴즈 데이터는 포함하지 않습니다.

## 기술 스택

- React
- Vite
- Supabase REST API
- Playwright

## 개발 참고

- `.omx/`, `node_modules/`, `dist/`, `.env`, `.env.*`, `*.local` 파일은 Git에 올리지 않습니다.
- 배포 빌드 산출물은 `dist/`에 생성됩니다.
