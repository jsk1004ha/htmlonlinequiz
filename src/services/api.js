const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function apiRequest(path, options = {}) {
  const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  }
  return payload;
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
