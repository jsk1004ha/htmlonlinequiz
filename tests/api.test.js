import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Vite supplies import.meta.env in production; load the same module with only
// that build-time substitution so the tests exercise the real exported API.
const source = await readFile(new URL("../src/services/api.js", import.meta.url), "utf8");
const moduleSource = source.replaceAll("import.meta.env", JSON.stringify({ VITE_API_TIMEOUT_MS: "25" })) + "\n//# sourceURL=api-under-test.js";
const api = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

function harness(t, fetchImpl) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const timers = new Map();
  let nextId = 1;
  globalThis.window = {
    setTimeout(callback, delay) {
      assert.equal(delay, 25);
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.fetch = fetchImpl;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });
  return {
    timers,
    expire() {
      assert.equal(timers.size, 1, "deadline must remain active until the body is consumed");
      for (const callback of timers.values()) callback();
    },
  };
}

function untilAborted(signal) {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

test("deadline aborts a body that stalls after response headers", async (t) => {
  let bodyStarted;
  const reading = new Promise((resolve) => { bodyStarted = resolve; });
  const clock = harness(t, async (_url, { signal }) => ({
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    text() { bodyStarted(); return untilAborted(signal); },
  }));
  const pending = api.fetchHealth();
  await reading;
  clock.expire();
  await assert.rejects(pending, /응답 시간이 초과/);
  assert.equal(clock.timers.size, 0);
});

test("deadline still aborts a request waiting for headers", async (t) => {
  const clock = harness(t, (_url, { signal }) => untilAborted(signal));
  const pending = api.fetchHealth();
  clock.expire();
  await assert.rejects(pending, /응답 시간이 초과/);
  assert.equal(clock.timers.size, 0);
});

test("successful JSON body preserves request options and clears the deadline", async (t) => {
  const clock = harness(t, async (url, options) => {
    assert.equal(url, "/api/auth/login");
    assert.equal(options.credentials, "include");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { id: "student", password: "test-password" });
    return new Response('{"user":{"id":"student"}}', { headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(await api.loginUser({ id: "student", password: "test-password" }), { user: { id: "student" } });
  assert.equal(clock.timers.size, 0);
});

for (const [name, response, expected] of [
  ["HTTP API error", () => new Response('{"error":"로그인이 필요합니다."}', { status: 401, headers: { "content-type": "application/json" } }), /로그인이 필요합니다/],
  ["frontend HTML response", () => new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } }), /API 대신 프론트 HTML/],
  ["non-JSON response", () => new Response("unavailable"), /JSON 응답을 반환하지 않았/],
  ["malformed JSON", () => new Response("{", { headers: { "content-type": "application/json" } }), SyntaxError],
]) {
  test(`${name} retains its error and clears the deadline`, async (t) => {
    const clock = harness(t, async () => response());
    await assert.rejects(api.fetchHealth(), expected);
    assert.equal(clock.timers.size, 0);
  });
}

test("body transport failures receive the network error and clear the deadline", async (t) => {
  const clock = harness(t, async () => ({ text: async () => { throw new TypeError("connection reset"); } }));
  await assert.rejects(api.fetchHealth(), /API 서버에 연결할 수 없습니다/);
  assert.equal(clock.timers.size, 0);
});
