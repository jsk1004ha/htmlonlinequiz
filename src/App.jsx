import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STORAGE_KEYS = {
  users: "htmlquizlab:users",
  currentUser: "htmlquizlab:currentUser",
  quizzes: "htmlquizlab:quizzes:v2",
};
const LEGACY_QUIZ_STORAGE_KEYS = ["htmlquizlab:quizzes"];

const SUBJECTS = ["전체", "물리", "화학", "생명과학", "지구과학", "한국사"];
const MAX_HTML_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 80;
const MAX_TAG_LENGTH = 120;
const MAX_COMMENT_LENGTH = 220;
const QUIZ_IFRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const starterHtml = "";
const defaultQuizzes = [];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function digestText(value) {
  const data = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt) {
  return digestText(`${salt}:${password}`);
}

async function hashLegacyPassword(password) {
  return digestText(password);
}

function makeSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function makeId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${Date.now()}-${random}`;
}

function normalizeText(value, maxLength) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function htmlByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildSafeQuizDocument(html) {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(
    QUIZ_IFRAME_CSP,
  )}">`;
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${cspMeta}`);
  }
  if (/<html(\s[^>]*)?>/i.test(html)) {
    return html.replace(
      /<html(\s[^>]*)?>/i,
      (match) => `${match}<head>${cspMeta}</head>`,
    );
  }
  return `<!doctype html><html lang="ko"><head>${cspMeta}</head><body>${html}</body></html>`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  const paths = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    play: (
      <path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" />
    ),
    heart: (
      <path d="M20.8 8.8c0 5.3-8.8 10.2-8.8 10.2S3.2 14.1 3.2 8.8A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.8 1.9Z" />
    ),
    comment: (
      <>
        <path d="M21 14a4 4 0 0 1-4 4H9l-6 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 20h16" />
      </>
    ),
    code: (
      <>
        <path d="m9 18-6-6 6-6" />
        <path d="m15 6 6 6-6 6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    maximize: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </>
    ),
    minimize: (
      <>
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M16 3v3a2 2 0 0 0 2 2h3" />
        <path d="M8 21v-3a2 2 0 0 0-2-2H3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </>
    ),
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function App() {
  const [users, setUsers] = useState(() => readJson(STORAGE_KEYS.users, []));
  const [currentUser, setCurrentUser] = useState(() =>
    readJson(STORAGE_KEYS.currentUser, null),
  );
  const [quizzes, setQuizzes] = useState(() =>
    readJson(STORAGE_KEYS.quizzes, defaultQuizzes),
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [subject, setSubject] = useState("전체");
  const [selectedQuizId, setSelectedQuizId] = useState(null);
  const [view, setView] = useState("home");
  const [pendingProtectedAction, setPendingProtectedAction] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ id: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [studioTab, setStudioTab] = useState("write");
  const [comment, setComment] = useState("");
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const playerPanelRef = useRef(null);
  const [draft, setDraft] = useState({
    title: "",
    subject: "물리",
    tags: "",
    html: starterHtml,
    fileName: "",
  });

  useEffect(() => {
    LEGACY_QUIZ_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.quizzes, JSON.stringify(quizzes));
  }, [quizzes]);

  useEffect(() => {
    function syncFullscreenState() {
      if (!document.fullscreenElement) {
        setIsPlayerFullscreen(false);
      }
    }
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!authOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setAuthOpen(false);
        setAuthError("");
        setPendingProtectedAction(null);
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [authOpen]);

  const filteredQuizzes = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return quizzes.filter((quiz) => {
      const matchesSubject = subject === "전체" || quiz.subject === subject;
      const searchable = [quiz.title, quiz.subject, quiz.author, ...quiz.tags]
        .join(" ")
        .toLowerCase();
      return matchesSubject && searchable.includes(normalizedQuery);
    });
  }, [deferredQuery, quizzes, subject]);

  const popularQuizzes = useMemo(() => {
    return [...filteredQuizzes]
      .sort(
        (a, b) =>
          b.likedBy.length * 3 +
          b.comments.length * 2 +
          b.plays -
          (a.likedBy.length * 3 + a.comments.length * 2 + a.plays),
      )
      .slice(0, 4);
  }, [filteredQuizzes]);

  const newestQuizzes = useMemo(() => {
    return [...filteredQuizzes]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 4);
  }, [filteredQuizzes]);

  const activeQuiz =
    quizzes.find((quiz) => quiz.id === selectedQuizId) || quizzes[0] || null;

  const totalPlays = useMemo(
    () => quizzes.reduce((sum, quiz) => sum + quiz.plays, 0),
    [quizzes],
  );

  const safeActiveQuizHtml = useMemo(
    () => buildSafeQuizDocument(activeQuiz?.html || ""),
    [activeQuiz?.html],
  );

  const safeDraftHtml = useMemo(
    () => buildSafeQuizDocument(draft.html),
    [draft.html],
  );

  const selectedIsLiked = Boolean(
    currentUser && activeQuiz?.likedBy.includes(currentUser.id),
  );

  const resultLabel = useMemo(() => {
    const trimmedQuery = deferredQuery.trim();
    if (trimmedQuery) return `"${trimmedQuery}" 검색 결과`;
    return subject === "전체" ? "전체 퀴즈" : `${subject} 퀴즈`;
  }, [deferredQuery, subject]);

  function openQuizById(quizId) {
    setSelectedQuizId(quizId);
    setView("play");
    setQuizzes((previous) =>
      previous.map((quiz) =>
        quiz.id === quizId ? { ...quiz, plays: quiz.plays + 1 } : quiz,
      ),
    );
  }

  function runProtectedAction(action) {
    if (!action) return;
    if (action.type === "play") {
      openQuizById(action.quizId);
      return;
    }
    if (action.type === "view") {
      setView(action.view);
    }
  }

  function requireLogin(action = null) {
    if (currentUser) return true;
    setPendingProtectedAction(action);
    setAuthMode("login");
    setAuthOpen(true);
    return false;
  }

  function openProtectedView(nextView) {
    if (!requireLogin({ type: "view", view: nextView })) return;
    setView(nextView);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const id = authForm.id.trim();
    const password = authForm.password;
    if (!id || !password) {
      setAuthError("아이디와 비밀번호를 입력하세요.");
      return;
    }

    if (!/^[A-Za-z0-9_-]{3,24}$/.test(id)) {
      setAuthError("아이디는 3~24자의 영문, 숫자, _, -만 사용할 수 있습니다.");
      return;
    }

    if (password.length < 6) {
      setAuthError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    if (authMode === "register") {
      if (users.some((user) => user.id === id)) {
        setAuthError("이미 사용 중인 아이디입니다.");
        return;
      }
      const salt = makeSalt();
      const passwordHash = await hashPassword(password, salt);
      const newUser = {
        id,
        salt,
        passwordHash,
        joinedAt: new Date().toISOString(),
      };
      setUsers((previous) => [...previous, newUser]);
      setCurrentUser({ id });
    } else {
      const user = users.find((storedUser) => storedUser.id === id);
      const passwordHash = user?.salt
        ? await hashPassword(password, user.salt)
        : await hashLegacyPassword(password);
      if (!user || user.passwordHash !== passwordHash) {
        setAuthError("아이디 또는 비밀번호가 맞지 않습니다.");
        return;
      }
      if (!user.salt) {
        const salt = makeSalt();
        const upgradedHash = await hashPassword(password, salt);
        setUsers((previous) =>
          previous.map((storedUser) =>
            storedUser.id === id
              ? { ...storedUser, salt, passwordHash: upgradedHash }
              : storedUser,
          ),
        );
      }
      setCurrentUser({ id });
    }

    runProtectedAction(pendingProtectedAction);
    setPendingProtectedAction(null);
    setAuthForm({ id: "", password: "" });
    setAuthError("");
    setAuthOpen(false);
  }

  function handleQuizPlay(quizId) {
    if (!requireLogin({ type: "play", quizId })) return;
    openQuizById(quizId);
  }

  function toggleLike(quizId) {
    if (!requireLogin()) return;
    setQuizzes((previous) =>
      previous.map((quiz) => {
        if (quiz.id !== quizId) return quiz;
        const hasLiked = quiz.likedBy.includes(currentUser.id);
        return {
          ...quiz,
          likedBy: hasLiked
            ? quiz.likedBy.filter((id) => id !== currentUser.id)
            : [...quiz.likedBy, currentUser.id],
        };
      }),
    );
  }

  function handleCommentSubmit(event) {
    event.preventDefault();
    const body = normalizeText(comment, MAX_COMMENT_LENGTH);
    if (!requireLogin() || !body || !activeQuiz) return;
    const nextComment = {
      id: makeId("comment"),
      author: currentUser.id,
      body,
      createdAt: new Date().toISOString(),
    };
    setQuizzes((previous) =>
      previous.map((quiz) =>
        quiz.id === activeQuiz.id
          ? { ...quiz, comments: [...quiz.comments, nextComment] }
          : quiz,
      ),
    );
    setComment("");
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const isHtml =
      file.name.toLowerCase().endsWith(".html") || file.type === "text/html";
    if (!isHtml) {
      event.target.value = "";
      window.alert("HTML 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_HTML_BYTES) {
      event.target.value = "";
      window.alert("HTML 파일은 512KB 이하만 업로드할 수 있습니다.");
      return;
    }
    const html = await file.text();
    setDraft((previous) => ({
      ...previous,
      html,
      fileName: file.name,
      title:
        previous.title ||
        normalizeText(file.name.replace(/\.html$/i, ""), MAX_TITLE_LENGTH),
    }));
    setStudioTab("upload");
  }

  function handleCreateQuiz(event) {
    event.preventDefault();
    if (!requireLogin({ type: "view", view: "create" })) return;
    const title = normalizeText(draft.title, MAX_TITLE_LENGTH);
    if (!title || !draft.html.trim()) {
      window.alert("퀴즈 이름과 HTML 코드를 입력하세요.");
      return;
    }
    if (htmlByteLength(draft.html) > MAX_HTML_BYTES) {
      window.alert("HTML 코드는 512KB 이하만 등록할 수 있습니다.");
      return;
    }
    const tags = draft.tags
      .split(/[,\s#]+/)
      .map((tag) => normalizeText(tag, 20))
      .filter(Boolean)
      .slice(0, 6);
    const newQuiz = {
      id: makeId("quiz"),
      title,
      subject: draft.subject,
      tags,
      author: currentUser.id,
      createdAt: new Date().toISOString(),
      html: draft.html,
      plays: 0,
      likedBy: [],
      comments: [],
    };
    setQuizzes((previous) => [newQuiz, ...previous]);
    setSelectedQuizId(newQuiz.id);
    setDraft({
      title: "",
      subject: "물리",
      tags: "",
      html: starterHtml,
      fileName: "",
    });
    setStudioTab("write");
    setView("play");
  }

  async function togglePlayerFullscreen() {
    const panel = playerPanelRef.current;
    if (!panel) return;
    if (isPlayerFullscreen || document.fullscreenElement) {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      setIsPlayerFullscreen(false);
      return;
    }
    setIsPlayerFullscreen(true);
    await panel.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="brand brand-button"
          type="button"
          onClick={() => setView("home")}
          aria-label="HTML Quiz Lab 홈"
        >
          <span className="brand-mark">H</span>
          <span>HTML Quiz Lab</span>
        </button>
        <label className="top-search" aria-label="퀴즈 검색">
          <Icon name="search" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setView("home");
            }}
            placeholder="퀴즈 검색"
            type="search"
          />
        </label>
        <nav className="nav-links" aria-label="주요 메뉴">
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => setView("home")}
            type="button"
          >
            메인
          </button>
          <button
            className={view === "play" ? "active" : ""}
            onClick={() => openProtectedView("play")}
            type="button"
          >
            퀴즈 플레이
          </button>
          <button
            className={view === "create" ? "active" : ""}
            onClick={() => openProtectedView("create")}
            type="button"
          >
            퀴즈 제작
          </button>
        </nav>
        <div className="account-area">
          {currentUser ? (
            <>
              <span className="user-chip">
                <Icon name="user" />
                {currentUser.id}
              </span>
              <button
                className="ghost-button"
                onClick={() => {
                  setCurrentUser(null);
                  setPendingProtectedAction(null);
                  setView("home");
                }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <button
                className="ghost-button"
                onClick={() => {
                  setPendingProtectedAction(null);
                  setAuthMode("login");
                  setAuthOpen(true);
                }}
              >
                로그인
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setPendingProtectedAction(null);
                  setAuthMode("register");
                  setAuthOpen(true);
                }}
              >
                회원가입
              </button>
            </>
          )}
        </div>
      </header>

      <main className={`workspace ${view}-workspace`} id="top">
        {view === "home" && (
          <HomeView
            resultLabel={resultLabel}
            quizCount={quizzes.length}
            totalPlays={totalPlays}
            subject={subject}
            activeQuizId={activeQuiz?.id}
            popularQuizzes={popularQuizzes}
            newestQuizzes={newestQuizzes}
            currentUserId={currentUser?.id}
            onSubjectChange={setSubject}
            onPlay={handleQuizPlay}
            onLike={toggleLike}
            onCreate={() => openProtectedView("create")}
          />
        )}

        {view === "play" && (
          <PlayView
            activeQuiz={activeQuiz}
            selectedIsLiked={selectedIsLiked}
            isPlayerFullscreen={isPlayerFullscreen}
            playerPanelRef={playerPanelRef}
            safeActiveQuizHtml={safeActiveQuizHtml}
            comment={comment}
            newestQuizzes={newestQuizzes}
            onLike={toggleLike}
            onPlay={handleQuizPlay}
            onCreate={() => openProtectedView("create")}
            onCommentChange={setComment}
            onCommentSubmit={handleCommentSubmit}
            onToggleFullscreen={togglePlayerFullscreen}
          />
        )}

        {view === "create" && (
          <CreateView
            studioTab={studioTab}
            draft={draft}
            safeDraftHtml={safeDraftHtml}
            onStudioTabChange={setStudioTab}
            onDraftChange={setDraft}
            onFileChange={handleFileChange}
            onSubmit={handleCreateQuiz}
          />
        )}
      </main>

      {authOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="auth-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <h2>{authMode === "login" ? "로그인" : "회원가입"}</h2>
              <button
                className="icon-button"
                onClick={() => {
                  setAuthOpen(false);
                  setAuthError("");
                  setPendingProtectedAction(null);
                }}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAuthSubmit} className="auth-form">
              <label>
                아이디
                <input
                  value={authForm.id}
                  onChange={(event) =>
                    setAuthForm((previous) => ({
                      ...previous,
                      id: event.target.value,
                    }))
                  }
                  autoFocus
                  autoComplete="username"
                  maxLength={24}
                />
              </label>
              <label>
                비밀번호
                <input
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((previous) => ({
                      ...previous,
                      password: event.target.value,
                    }))
                  }
                  type="password"
                  autoComplete={
                    authMode === "login" ? "current-password" : "new-password"
                  }
                />
              </label>
              {authError && (
                <p className="form-error" role="alert">
                  {authError}
                </p>
              )}
              <button className="primary-button wide-button" type="submit">
                {authMode === "login" ? "로그인" : "회원가입"}
              </button>
            </form>
            <button
              className="mode-switch"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
            >
              {authMode === "login" ? "회원가입으로 전환" : "로그인으로 전환"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function HomeView({
  resultLabel,
  quizCount,
  totalPlays,
  subject,
  activeQuizId,
  popularQuizzes,
  newestQuizzes,
  currentUserId,
  onSubjectChange,
  onPlay,
  onLike,
  onCreate,
}) {
  return (
    <section className="screen home-screen" aria-label="메인 화면">
      <div className="screen-header">
        <div>
          <span className="screen-kicker">메인화면</span>
          <h1>퀴즈 탐색</h1>
        </div>
        <button className="primary-button screen-action" onClick={onCreate} type="button">
          <Icon name="code" />
          퀴즈 제작
        </button>
      </div>

      <div className="search-row summary-row">
        <div className="result-summary">
          <span>현재 보기</span>
          <strong>{resultLabel}</strong>
        </div>
        <div className="metric-strip" aria-label="서비스 현황">
          <span>{quizCount}개 퀴즈</span>
          <span>{totalPlays}회 플레이</span>
        </div>
      </div>

      <div className="subject-tabs" aria-label="과목 필터">
        {SUBJECTS.map((item) => (
          <button
            key={item}
            className={subject === item ? "active" : ""}
            onClick={() => onSubjectChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>

      <div className="home-sections">
        <QuizSection
          id="popular"
          title="인기 퀴즈"
          emptyText="조건에 맞는 인기 퀴즈가 없습니다."
          quizzes={popularQuizzes}
          activeQuizId={activeQuizId}
          onPlay={onPlay}
          onLike={onLike}
          currentUserId={currentUserId}
        />

        <QuizSection
          id="new"
          title="신규 퀴즈"
          emptyText="조건에 맞는 신규 퀴즈가 없습니다."
          quizzes={newestQuizzes}
          activeQuizId={activeQuizId}
          onPlay={onPlay}
          onLike={onLike}
          currentUserId={currentUserId}
        />
      </div>
    </section>
  );
}

function PlayView({
  activeQuiz,
  selectedIsLiked,
  isPlayerFullscreen,
  playerPanelRef,
  safeActiveQuizHtml,
  comment,
  newestQuizzes,
  onLike,
  onPlay,
  onCreate,
  onCommentChange,
  onCommentSubmit,
  onToggleFullscreen,
}) {
  if (!activeQuiz) {
    return (
      <section className="screen play-screen" aria-label="퀴즈 플레이 화면">
        <p className="empty-state">플레이할 퀴즈가 없습니다.</p>
      </section>
    );
  }

  const otherQuizzes = newestQuizzes
    .filter((quiz) => quiz.id !== activeQuiz.id)
    .slice(0, 4);

  return (
    <section className="screen play-screen" aria-label="퀴즈 플레이 화면">
      <div className="screen-header play-titlebar">
        <div>
          <span className="screen-kicker">퀴즈 플레이 화면</span>
          <h1>{activeQuiz.title}</h1>
          <div className="screen-meta">
            <span className={`subject-badge subject-${activeQuiz.subject}`}>
              {activeQuiz.subject}
            </span>
            <span>{activeQuiz.plays}회 플레이</span>
            <span>{formatDate(activeQuiz.createdAt)}</span>
          </div>
        </div>
        <button className="ghost-button screen-action" onClick={onCreate} type="button">
          <Icon name="code" />
          새 퀴즈 제작
        </button>
      </div>

      <div className="play-layout">
        <section
          className={`studio-panel player-panel ${
            isPlayerFullscreen ? "is-fullscreen" : ""
          }`}
          ref={playerPanelRef}
        >
          <div className="panel-heading player-heading">
            <div>
              <h2>플레이어</h2>
              <p>{activeQuiz.title}</p>
            </div>
            <div className="player-actions">
              <button
                className={`like-button ${selectedIsLiked ? "active" : ""}`}
                onClick={() => onLike(activeQuiz.id)}
                aria-label={`${activeQuiz.title} 좋아요`}
                type="button"
              >
                <Icon name="heart" />
                {activeQuiz.likedBy.length}
              </button>
              <button
                className="utility-button"
                onClick={onToggleFullscreen}
                type="button"
                aria-label={
                  isPlayerFullscreen ? "퀴즈 전체화면 종료" : "퀴즈 전체화면"
                }
              >
                <Icon name={isPlayerFullscreen ? "minimize" : "maximize"} />
                {isPlayerFullscreen ? "나가기" : "전체화면"}
              </button>
            </div>
          </div>

          <iframe
            className="quiz-frame play-frame"
            title={`${activeQuiz.title} 플레이`}
            sandbox="allow-scripts allow-forms allow-modals"
            allow="fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
            srcDoc={safeActiveQuizHtml}
          />
        </section>

        <aside className="play-side" aria-label="플레이 보조 영역">
          <section className="studio-panel comments-panel">
            <div className="panel-heading compact-heading">
              <h2>댓글</h2>
              <span>{activeQuiz.comments.length}개</span>
            </div>
            <div className="comments">
              <div className="comment-summary">
                <span>
                  <Icon name="comment" />
                  댓글 {activeQuiz.comments.length}
                </span>
                <span>{activeQuiz.plays}회 플레이</span>
              </div>
              <form className="comment-form" onSubmit={onCommentSubmit}>
                <input
                  value={comment}
                  onChange={(event) =>
                    onCommentChange(
                      event.target.value.slice(0, MAX_COMMENT_LENGTH),
                    )
                  }
                  maxLength={MAX_COMMENT_LENGTH}
                  placeholder="댓글 작성"
                />
                <button type="submit">등록</button>
              </form>
              <div className="comment-list">
                {activeQuiz.comments.length === 0 ? (
                  <p className="empty-state">아직 댓글이 없습니다.</p>
                ) : (
                  activeQuiz.comments
                    .slice()
                    .reverse()
                    .map((item) => (
                      <article className="comment-row" key={item.id}>
                        <strong>{item.author}</strong>
                        <span>{item.body}</span>
                        <time>{formatDate(item.createdAt)}</time>
                      </article>
                    ))
                )}
              </div>
            </div>
          </section>

          <section className="studio-panel queue-panel">
            <div className="panel-heading compact-heading">
              <h2>신규 퀴즈</h2>
            </div>
            {otherQuizzes.length === 0 ? (
              <p className="empty-state">다른 신규 퀴즈가 없습니다.</p>
            ) : (
              <div className="queue-list">
                {otherQuizzes.map((quiz) => (
                  <button
                    className="queue-item"
                    key={quiz.id}
                    onClick={() => onPlay(quiz.id)}
                    type="button"
                  >
                    <span className={`subject-badge subject-${quiz.subject}`}>
                      {quiz.subject}
                    </span>
                    <strong>{quiz.title}</strong>
                    <small>
                      {quiz.plays}회 · 댓글 {quiz.comments.length}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function CreateView({
  studioTab,
  draft,
  safeDraftHtml,
  onStudioTabChange,
  onDraftChange,
  onFileChange,
  onSubmit,
}) {
  return (
    <section className="screen create-screen" aria-label="퀴즈 제작 화면">
      <div className="screen-header">
        <div>
          <span className="screen-kicker">퀴즈 제작 화면</span>
          <h1>퀴즈 제작</h1>
        </div>
      </div>

      <div className="creator-layout">
        <section className="studio-panel maker-panel create-editor">
          <div className="panel-heading">
            <h2>입력</h2>
            <div className="segmented">
              <button
                className={studioTab === "write" ? "active" : ""}
                onClick={() => onStudioTabChange("write")}
                type="button"
              >
                <Icon name="code" />
                코드 작성
              </button>
              <button
                className={studioTab === "upload" ? "active" : ""}
                onClick={() => onStudioTabChange("upload")}
                type="button"
              >
                <Icon name="upload" />
                HTML 업로드
              </button>
            </div>
          </div>

          <form className="create-form" onSubmit={onSubmit}>
            <div className="form-grid">
              <label>
                이름
                <input
                  value={draft.title}
                  onChange={(event) =>
                    onDraftChange((previous) => ({
                      ...previous,
                      title: event.target.value.slice(0, MAX_TITLE_LENGTH),
                    }))
                  }
                  maxLength={MAX_TITLE_LENGTH}
                  placeholder="퀴즈 이름"
                />
              </label>
              <label>
                과목
                <select
                  value={draft.subject}
                  onChange={(event) =>
                    onDraftChange((previous) => ({
                      ...previous,
                      subject: event.target.value,
                    }))
                  }
                >
                  {SUBJECTS.filter((item) => item !== "전체").map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              태그
              <input
                value={draft.tags}
                onChange={(event) =>
                  onDraftChange((previous) => ({
                    ...previous,
                    tags: event.target.value.slice(0, MAX_TAG_LENGTH),
                  }))
                }
                maxLength={MAX_TAG_LENGTH}
                placeholder="예: 기말고사, 개념, 서술형"
              />
            </label>

            {studioTab === "upload" && (
              <label className="file-drop">
                <Icon name="upload" />
                <span>{draft.fileName || ".html 파일 선택"}</span>
                <input accept=".html,text/html" type="file" onChange={onFileChange} />
              </label>
            )}

            <label>
              HTML 코드
              <textarea
                value={draft.html}
                onChange={(event) =>
                  onDraftChange((previous) => ({
                    ...previous,
                    html: event.target.value,
                  }))
                }
                maxLength={MAX_HTML_BYTES}
                placeholder="HTML 코드를 입력하거나 HTML 업로드를 선택하세요."
                spellCheck="false"
              />
            </label>

            <button className="primary-button wide-button" type="submit">
              퀴즈 등록
            </button>
          </form>
        </section>

        <section className="studio-panel draft-preview-panel">
          <div className="panel-heading player-heading">
            <div>
              <h2>미리보기</h2>
              <p>{draft.title || "제목 없음"}</p>
            </div>
            <div className="preview-meta">
              <span>{draft.subject}</span>
              <span>{htmlByteLength(draft.html).toLocaleString()} bytes</span>
            </div>
          </div>
          <iframe
            className="quiz-frame draft-frame"
            title="작성 중인 퀴즈 미리보기"
            sandbox="allow-scripts allow-forms allow-modals"
            allow="fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
            srcDoc={safeDraftHtml}
          />
        </section>
      </div>
    </section>
  );
}

const QuizSection = memo(function QuizSection({
  id,
  title,
  emptyText,
  quizzes,
  activeQuizId,
  onPlay,
  onLike,
  currentUserId,
}) {
  return (
    <section className="quiz-section" id={id}>
      <div className="section-title">
        <h2>{title}</h2>
        <span>{quizzes.length}개</span>
      </div>
      {quizzes.length === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <div className="quiz-grid">
          {quizzes.map((quiz) => (
            <QuizCard
              key={quiz.id}
              quiz={quiz}
              active={quiz.id === activeQuizId}
              liked={Boolean(currentUserId && quiz.likedBy.includes(currentUserId))}
              onPlay={() => onPlay(quiz.id)}
              onLike={() => onLike(quiz.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
});

const QuizCard = memo(function QuizCard({ quiz, active, liked, onPlay, onLike }) {
  return (
    <article className={`quiz-card ${active ? "active" : ""}`}>
      <div className="quiz-card-top">
        <span className={`subject-badge subject-${quiz.subject}`}>{quiz.subject}</span>
        <span>{formatDate(quiz.createdAt)}</span>
      </div>
      <h3>{quiz.title}</h3>
      <div className="tag-row">
        {quiz.tags.length === 0 ? (
          <span className="tag">태그 없음</span>
        ) : (
          quiz.tags.map((tag) => (
            <span className="tag" key={tag}>
              #{tag}
            </span>
          ))
        )}
      </div>
      <div className="quiz-card-bottom">
        <div className="card-stats">
          <button
            className={`stat-button ${liked ? "active" : ""}`}
            onClick={onLike}
            aria-label={`${quiz.title} 좋아요`}
          >
            <Icon name="heart" />
            {quiz.likedBy.length}
          </button>
          <span>
            <Icon name="comment" />
            {quiz.comments.length}
          </span>
          <span>{quiz.plays}회</span>
        </div>
        <button className="play-button" onClick={onPlay}>
          <Icon name="play" />
          플레이
        </button>
      </div>
    </article>
  );
});

export default App;
