import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const defaultDataDir = path.join(rootDir, "data");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : defaultDataDir;
const dbPath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(dataDir, "htmlquizlab.sqlite");
const dbDir = path.dirname(dbPath);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_COOKIE = "htmlquizlab_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 80;
const MAX_TAG_LENGTH = 120;
const MAX_COMMENT_LENGTH = 220;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;
const SUBJECTS = new Set(["물리", "화학", "생명과학", "지구과학", "한국사"]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const hasBuiltClientAtStartup = fs.existsSync(path.join(distDir, "index.html"));
const isDevServer =
  process.argv.includes("--dev") ||
  process.env.VITE_DEV_SERVER === "true" ||
  (process.env.NODE_ENV !== "production" && !hasBuiltClientAtStartup);

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });

const sessionSecret = getSessionSecret();
const appOrigins = (process.env.APP_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");
lockDownDatabaseFile();

migrateDatabase();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(express.json({ limit: "1mb" }));

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Storage-Backend", "sqlite");
  next();
});

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요." },
  }),
);

app.use(rejectCrossSiteMutations);
app.use(loadSession);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    storage: "sqlite",
    mode: isDevServer ? "development" : "production",
    counts: getStorageCounts(),
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/session", (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post("/api/auth/register", (req, res) => {
  const { id, password } = req.body || {};
  const userId = validateUserId(id);
  const cleanPassword = validatePassword(password);

  if (!userId.ok) return sendValidationError(res, userId.error);
  if (!cleanPassword.ok) return sendValidationError(res, cleanPassword.error);

  const { salt, hash } = hashPassword(cleanPassword.value);

  try {
    db.prepare(
      `insert into users (id, password_hash, password_salt, created_at)
       values (@id, @passwordHash, @passwordSalt, @createdAt)`,
    ).run({
      id: userId.value,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
    }
    throw error;
  }

  setSessionCookie(res, userId.value, req);
  res.status(201).json({ user: { id: userId.value } });
});

app.post("/api/auth/login", (req, res) => {
  const { id, password } = req.body || {};
  const userId = validateUserId(id);
  const cleanPassword = validatePassword(password);

  if (!userId.ok || !cleanPassword.ok) {
    return res.status(401).json({ error: "아이디 또는 비밀번호가 맞지 않습니다." });
  }

  const user = db.prepare("select * from users where id = ?").get(userId.value);
  if (!user || !verifyPassword(cleanPassword.value, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: "아이디 또는 비밀번호가 맞지 않습니다." });
  }

  setSessionCookie(res, user.id, req);
  res.json({ user: { id: user.id } });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.get("/api/quizzes", (req, res) => {
  res.json({ quizzes: listQuizzes() });
});

app.post("/api/quizzes", requireAuth, (req, res) => {
  const validated = validateQuizPayload(req.body || {});
  if (!validated.ok) return sendValidationError(res, validated.error);

  const now = new Date().toISOString();
  const quiz = {
    id: makeId("quiz"),
    title: validated.value.title,
    subject: validated.value.subject,
    tags: JSON.stringify(validated.value.tags),
    authorId: req.user.id,
    html: validated.value.html,
    plays: 0,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `insert into quizzes (id, title, subject, tags, author_id, html, plays, created_at, updated_at)
     values (@id, @title, @subject, @tags, @authorId, @html, @plays, @createdAt, @updatedAt)`,
  ).run(quiz);

  res.status(201).json({ quiz: getQuizById(quiz.id) });
});

app.post("/api/quizzes/:quizId/play", requireAuth, (req, res) => {
  const quizId = validateEntityId(req.params.quizId, "quiz");
  if (!quizId.ok) return sendValidationError(res, quizId.error);

  const result = db.prepare("update quizzes set plays = plays + 1 where id = ?").run(quizId.value);
  if (result.changes === 0) return res.status(404).json({ error: "퀴즈를 찾을 수 없습니다." });

  res.json({ quiz: getQuizById(quizId.value) });
});

app.post("/api/quizzes/:quizId/like", requireAuth, (req, res) => {
  const quizId = validateEntityId(req.params.quizId, "quiz");
  if (!quizId.ok) return sendValidationError(res, quizId.error);
  if (!quizExists(quizId.value)) return res.status(404).json({ error: "퀴즈를 찾을 수 없습니다." });

  const insert = db.prepare(
    `insert or ignore into quiz_likes (quiz_id, user_id, created_at)
     values (?, ?, ?)`,
  ).run(quizId.value, req.user.id, new Date().toISOString());

  if (insert.changes === 0) {
    db.prepare("delete from quiz_likes where quiz_id = ? and user_id = ?").run(
      quizId.value,
      req.user.id,
    );
  }

  res.json({ quiz: getQuizById(quizId.value) });
});

app.post("/api/quizzes/:quizId/comments", requireAuth, (req, res) => {
  const quizId = validateEntityId(req.params.quizId, "quiz");
  if (!quizId.ok) return sendValidationError(res, quizId.error);
  if (!quizExists(quizId.value)) return res.status(404).json({ error: "퀴즈를 찾을 수 없습니다." });

  const body = normalizeText(String(req.body?.body || ""), MAX_COMMENT_LENGTH);
  if (!body) return sendValidationError(res, "댓글 내용을 입력하세요.");

  db.prepare(
    `insert into comments (id, quiz_id, author_id, body, created_at)
     values (@id, @quizId, @authorId, @body, @createdAt)`,
  ).run({
    id: makeId("comment"),
    quizId: quizId.value,
    authorId: req.user.id,
    body,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ quiz: getQuizById(quizId.value) });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API 경로를 찾을 수 없습니다." });
});

await configureClientServing();

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "서버 오류가 발생했습니다." });
});

app.listen(PORT, HOST, () => {
  console.log(`HTML Quiz Lab server listening on http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${dbPath}`);
  console.log(`Client mode: ${getClientModeLabel()}`);
});

async function configureClientServing() {
  const hasBuiltClient = fs.existsSync(path.join(distDir, "index.html"));

  if (isDevServer) {
    await useViteDevMiddleware();
    return;
  }

  if (!hasBuiltClient) {
    throw new Error("dist/index.html이 없습니다. 먼저 `npm run build`를 실행하세요.");
  }

  app.use(express.static(distDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

async function useViteDevMiddleware() {
  try {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: rootDir,
      server: {
        middlewareMode: true,
        hmr: {
          clientPort: Number(process.env.HMR_CLIENT_PORT || PORT),
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } catch (error) {
    if (fs.existsSync(path.join(distDir, "index.html"))) {
      console.warn("[HTML Quiz Lab] Vite dev middleware unavailable. Serving dist instead.", error);
      app.use(express.static(distDir, { index: false }));
      app.use((req, res, next) => {
        if (req.method !== "GET") return next();
        res.sendFile(path.join(distDir, "index.html"));
      });
      return;
    }
    throw new Error(
      "프론트 개발 서버를 시작하지 못했습니다. `npm install` 후 다시 실행하거나 `npm run build`를 먼저 실행하세요.",
      { cause: error },
    );
  }
}

function getClientModeLabel() {
  if (isDevServer) return "vite-middleware";
  return "dist";
}

function migrateDatabase() {
  db.exec(`
    create table if not exists users (
      id text primary key,
      password_hash text not null,
      password_salt text not null,
      created_at text not null
    );

    create table if not exists quizzes (
      id text primary key,
      title text not null,
      subject text not null,
      tags text not null default '[]',
      author_id text not null references users(id) on delete cascade,
      html text not null,
      plays integer not null default 0 check (plays >= 0),
      created_at text not null,
      updated_at text not null
    );

    create table if not exists quiz_likes (
      quiz_id text not null references quizzes(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      created_at text not null,
      primary key (quiz_id, user_id)
    );

    create table if not exists comments (
      id text primary key,
      quiz_id text not null references quizzes(id) on delete cascade,
      author_id text not null references users(id) on delete cascade,
      body text not null,
      created_at text not null
    );

    create index if not exists idx_quizzes_created_at on quizzes(created_at desc);
    create index if not exists idx_likes_quiz_id on quiz_likes(quiz_id);
    create index if not exists idx_comments_quiz_id_created_at on comments(quiz_id, created_at);
  `);
}

function listQuizzes() {
  const quizRows = db
    .prepare(
      `select id, title, subject, tags, author_id as author, html, plays, created_at as createdAt
       from quizzes
       order by datetime(created_at) desc`,
    )
    .all();

  const likesByQuiz = groupRows(
    db.prepare("select quiz_id as quizId, user_id as userId from quiz_likes").all(),
    "quizId",
  );
  const commentsByQuiz = groupRows(
    db
      .prepare(
        `select id, quiz_id as quizId, author_id as author, body, created_at as createdAt
         from comments
         order by datetime(created_at) asc`,
      )
      .all(),
    "quizId",
  );

  return quizRows.map((row) => formatQuiz(row, likesByQuiz, commentsByQuiz));
}

function getQuizById(quizId) {
  const row = db
    .prepare(
      `select id, title, subject, tags, author_id as author, html, plays, created_at as createdAt
       from quizzes
       where id = ?`,
    )
    .get(quizId);

  if (!row) return null;

  const likesByQuiz = groupRows(
    db.prepare("select quiz_id as quizId, user_id as userId from quiz_likes where quiz_id = ?").all(quizId),
    "quizId",
  );
  const commentsByQuiz = groupRows(
    db
      .prepare(
        `select id, quiz_id as quizId, author_id as author, body, created_at as createdAt
         from comments
         where quiz_id = ?
         order by datetime(created_at) asc`,
      )
      .all(quizId),
    "quizId",
  );

  return formatQuiz(row, likesByQuiz, commentsByQuiz);
}

function formatQuiz(row, likesByQuiz, commentsByQuiz) {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    tags: safeJsonArray(row.tags),
    author: row.author,
    html: row.html,
    plays: row.plays,
    createdAt: row.createdAt,
    likedBy: (likesByQuiz.get(row.id) || []).map((like) => like.userId),
    comments: (commentsByQuiz.get(row.id) || []).map((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  };
}

function groupRows(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row[key])) grouped.set(row[key], []);
    grouped.get(row[key]).push(row);
  }
  return grouped;
}

function quizExists(quizId) {
  return Boolean(db.prepare("select 1 from quizzes where id = ?").get(quizId));
}

function getStorageCounts() {
  return {
    users: db.prepare("select count(*) as count from users").get().count,
    quizzes: db.prepare("select count(*) as count from quizzes").get().count,
    likes: db.prepare("select count(*) as count from quiz_likes").get().count,
    comments: db.prepare("select count(*) as count from comments").get().count,
  };
}

function loadSession(req, res, next) {
  const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
  const session = verifySessionToken(token);
  if (!session) {
    req.user = null;
    return next();
  }

  const user = db.prepare("select id, created_at as createdAt from users where id = ?").get(session.sub);
  req.user = user || null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  next();
}

function publicUser(user) {
  return user ? { id: user.id } : null;
}

function rejectCrossSiteMutations(req, res, next) {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (!origin) return next();

  if (!isAllowedMutationOrigin(origin, req)) {
    return res.status(403).json({
      error: "허용되지 않은 요청 출처입니다. APP_ORIGIN 또는 프록시 Host/X-Forwarded-Proto 설정을 확인하세요.",
    });
  }

  next();
}

function isAllowedMutationOrigin(originValue, req) {
  let origin;
  try {
    origin = new URL(originValue);
  } catch {
    return false;
  }

  const currentOrigin = `${req.protocol}://${req.get("host")}`;
  const forwardedHost = firstForwardedValue(req.get("x-forwarded-host"));
  const forwardedProto = firstForwardedValue(req.get("x-forwarded-proto"));
  const forwardedOrigin =
    forwardedHost && forwardedProto ? `${forwardedProto}://${forwardedHost}` : null;
  const allowedOrigins = new Set([currentOrigin, forwardedOrigin, ...appOrigins].filter(Boolean));

  if (allowedOrigins.has(origin.origin)) return true;

  const requestHosts = new Set([req.get("host"), forwardedHost].filter(Boolean));
  return requestHosts.has(origin.host) && ["http:", "https:"].includes(origin.protocol);
}

function firstForwardedValue(value) {
  return value ? value.split(",")[0].trim() : "";
}

function validateUserId(value) {
  const id = normalizeText(String(value || ""), 24);
  if (!USERNAME_PATTERN.test(id)) {
    return { ok: false, error: "아이디는 3~24자의 영문, 숫자, _, -만 사용할 수 있습니다." };
  }
  return { ok: true, value: id };
}

function validatePassword(value) {
  if (typeof value !== "string") {
    return { ok: false, error: "비밀번호를 입력하세요." };
  }
  if (value.length < 6 || value.length > 128) {
    return { ok: false, error: "비밀번호는 6~128자여야 합니다." };
  }
  return { ok: true, value };
}

function validateEntityId(value, prefix) {
  const id = String(value || "");
  if (!new RegExp(`^${prefix}-[A-Za-z0-9_-]{16,40}$`).test(id)) {
    return { ok: false, error: "잘못된 요청입니다." };
  }
  return { ok: true, value: id };
}

function validateQuizPayload(payload) {
  const title = normalizeText(String(payload.title || ""), MAX_TITLE_LENGTH);
  const subject = normalizeText(String(payload.subject || ""), 20);
  const html = typeof payload.html === "string" ? payload.html : "";
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : String(payload.tags || "")
        .split(/[,\s#]+/)
        .filter(Boolean);

  if (!title) return { ok: false, error: "퀴즈 이름을 입력하세요." };
  if (!SUBJECTS.has(subject)) return { ok: false, error: "과목 값이 올바르지 않습니다." };
  if (!html.trim()) return { ok: false, error: "HTML 코드를 입력하세요." };
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return { ok: false, error: "HTML 코드는 512KB 이하만 등록할 수 있습니다." };
  }

  const normalizedTags = tags
    .map((tag) => normalizeText(String(tag), 20))
    .filter(Boolean)
    .slice(0, 6);
  if (normalizedTags.join(" ").length > MAX_TAG_LENGTH) {
    return { ok: false, error: "태그가 너무 깁니다." };
  }

  return { ok: true, value: { title, subject, html, tags: normalizedTags } };
}

function normalizeText(value, maxLength) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64url");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(expectedHash, "base64url");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

function setSessionCookie(res, userId, req) {
  const token = signSessionToken(userId);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${shouldUseSecureCookie(req) ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(res, req) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${shouldUseSecureCookie(req) ? "; Secure" : ""}`,
  );
}

function shouldUseSecureCookie(req) {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;

  const origin = req.get("origin") || "";
  const forwardedProto = firstForwardedValue(req.get("x-forwarded-proto"));
  return req.secure || forwardedProto === "https" || origin.startsWith("https://");
}

function signSessionToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      nonce: crypto.randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = sign(payload);
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.sub || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) return cookies;
    cookies[rawName] = rawValue.join("=");
    return cookies;
  }, {});
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomBytes(15).toString("base64url")}`;
}

function sendValidationError(res, error) {
  return res.status(400).json({ error });
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }

  const secretPath = path.join(dataDir, ".session-secret");
  try {
    if (fs.existsSync(secretPath)) {
      const savedSecret = fs.readFileSync(secretPath, "utf8").trim();
      if (savedSecret) return savedSecret;
    }

    const generatedSecret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(secretPath, `${generatedSecret}\n`, { mode: 0o600 });
    return generatedSecret;
  } catch (error) {
    console.warn("[HTML Quiz Lab] Could not persist development session secret.", error);
    return crypto.randomBytes(48).toString("base64url");
  }
}

function lockDownDatabaseFile() {
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    // chmod is best-effort and may fail on Windows or restricted file systems.
  }
}
