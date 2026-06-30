const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 12000);

async function apiRequest(path, options = {}) {
  const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      credentials: "include",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("API 서버 응답 시간이 초과되었습니다. SQLite 서버가 실행 중인지 확인하세요.");
    }
    throw new Error("API 서버에 연결할 수 없습니다. Vite 단독 실행이 아니라 `npm run dev` 통합 서버 또는 `npm run start`로 실행하세요.");
  } finally {
    window.clearTimeout(timeoutId);
  }

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!isJson) {
    const storageHeader = response.headers.get("x-storage-backend");
    const lowerText = responseText.trim().toLowerCase();
    if (!storageHeader && (lowerText.startsWith("<!doctype html") || lowerText.startsWith("<html"))) {
      throw new Error("API 대신 프론트 HTML이 응답했습니다. 서버 SQLite API가 붙은 통합 서버로 실행해야 저장됩니다.");
    }
    throw new Error("API 서버가 JSON 응답을 반환하지 않았습니다. `/api/health`가 SQLite 서버에서 열리는지 확인하세요.");
  }

  const payload = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  }
  return payload;
}

export function fetchHealth() {
  return apiRequest("/api/health");
}

export function fetchCurrentSession() {
  return apiRequest("/api/session");
}

export function fetchQuizzes() {
  return apiRequest("/api/quizzes");
}

export function registerUser({ id, password }) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: { id, password },
  });
}

export function loginUser({ id, password }) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: { id, password },
  });
}

export function logoutUser() {
  return apiRequest("/api/auth/logout", { method: "POST", body: {} });
}

export function createQuiz(payload) {
  return apiRequest("/api/quizzes", {
    method: "POST",
    body: payload,
  });
}

export function recordQuizPlay(quizId) {
  return apiRequest(`/api/quizzes/${encodeURIComponent(quizId)}/play`, {
    method: "POST",
    body: {},
  });
}

export function toggleQuizLike(quizId) {
  return apiRequest(`/api/quizzes/${encodeURIComponent(quizId)}/like`, {
    method: "POST",
    body: {},
  });
}

export function addQuizComment(quizId, body) {
  return apiRequest(`/api/quizzes/${encodeURIComponent(quizId)}/comments`, {
    method: "POST",
    body: { body },
  });
}
