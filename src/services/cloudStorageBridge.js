const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
const TABLE_NAME = (import.meta.env.VITE_SUPABASE_STATE_TABLE || "htmlquizlab_state").trim();
const WRITE_DEBOUNCE_MS = 350;

const STORAGE_TO_CLOUD_KEY = new Map([
  ["htmlquizlab:users", "users"],
  ["htmlquizlab:quizzes:v2", "quizzes"],
]);

const CLOUD_TO_STORAGE_KEY = {
  users: "htmlquizlab:users",
  quizzes: "htmlquizlab:quizzes:v2",
};

let isPatched = false;
let isHydrating = false;
let originalSetItem = null;
const pendingWriteTimers = new Map();

function normalizeSupabaseUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function isCloudStorageConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && TABLE_NAME);
}

export async function initializeCloudStorageBridge() {
  if (!canUseBrowserStorage() || !isCloudStorageConfigured()) return;

  patchLocalStorageWrites();

  try {
    isHydrating = true;
    const cloudState = await fetchCloudState();
    const mergedState = hydrateLocalStorage(cloudState);
    isHydrating = false;
    await backfillMissingCloudState(cloudState, mergedState);
    window.dispatchEvent(
      new CustomEvent("htmlquizlab:cloud-storage-ready", {
        detail: { configured: true, synced: true },
      }),
    );
  } catch (error) {
    isHydrating = false;
    console.warn(
      "[HTML Quiz Lab] Supabase shared storage is unavailable. Falling back to localStorage.",
      error,
    );
    window.dispatchEvent(
      new CustomEvent("htmlquizlab:cloud-storage-ready", {
        detail: { configured: true, synced: false, error },
      }),
    );
  }
}

function patchLocalStorageWrites() {
  if (isPatched || typeof Storage === "undefined") return;
  originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    originalSetItem.call(this, key, value);
    if (this === window.localStorage) {
      queueCloudWrite(String(key), String(value));
    }
  };
  isPatched = true;
}

function queueCloudWrite(storageKey, rawValue) {
  if (isHydrating || !isCloudStorageConfigured()) return;

  const cloudKey = STORAGE_TO_CLOUD_KEY.get(storageKey);
  if (!cloudKey) return;

  let parsedValue;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    return;
  }

  if (!Array.isArray(parsedValue)) return;

  const previousTimer = pendingWriteTimers.get(cloudKey);
  if (previousTimer) window.clearTimeout(previousTimer);

  const nextTimer = window.setTimeout(async () => {
    pendingWriteTimers.delete(cloudKey);
    try {
      await saveCloudValue(cloudKey, parsedValue);
      window.dispatchEvent(
        new CustomEvent("htmlquizlab:cloud-storage-saved", {
          detail: { key: cloudKey },
        }),
      );
    } catch (error) {
      console.warn(`[HTML Quiz Lab] Failed to sync ${cloudKey} to Supabase.`, error);
      window.dispatchEvent(
        new CustomEvent("htmlquizlab:cloud-storage-error", {
          detail: { key: cloudKey, error },
        }),
      );
    }
  }, WRITE_DEBOUNCE_MS);

  pendingWriteTimers.set(cloudKey, nextTimer);
}

async function fetchCloudState() {
  const rows = await supabaseRequest(`${encodeURIComponent(TABLE_NAME)}?select=key,value`);
  const state = { users: [], quizzes: [] };

  for (const row of rows || []) {
    if (row?.key in state && Array.isArray(row.value)) {
      state[row.key] = row.value;
    }
  }

  return state;
}

async function saveCloudValue(key, value) {
  await supabaseRequest(`${encodeURIComponent(TABLE_NAME)}?on_conflict=key`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      key,
      value,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function hydrateLocalStorage(cloudState) {
  const localState = {
    users: readLocalJson(CLOUD_TO_STORAGE_KEY.users, []),
    quizzes: readLocalJson(CLOUD_TO_STORAGE_KEY.quizzes, []),
  };

  const mergedState = {
    users: mergeRecordsById(cloudState.users, localState.users),
    quizzes: mergeRecordsById(cloudState.quizzes, localState.quizzes),
  };

  writeLocalJson(CLOUD_TO_STORAGE_KEY.users, mergedState.users);
  writeLocalJson(CLOUD_TO_STORAGE_KEY.quizzes, mergedState.quizzes);

  return mergedState;
}

async function backfillMissingCloudState(cloudState, mergedState) {
  const writes = [];
  if (!jsonEqual(cloudState.users, mergedState.users)) {
    writes.push(saveCloudValue("users", mergedState.users));
  }
  if (!jsonEqual(cloudState.quizzes, mergedState.quizzes)) {
    writes.push(saveCloudValue("quizzes", mergedState.quizzes));
  }
  await Promise.all(writes);
}

function mergeRecordsById(cloudRecords, localRecords) {
  const merged = [];
  const seen = new Set();

  for (const record of cloudRecords || []) {
    const id = getRecordId(record);
    if (!id || seen.has(id)) continue;
    merged.push(record);
    seen.add(id);
  }

  for (const record of localRecords || []) {
    const id = getRecordId(record);
    if (!id || seen.has(id)) continue;
    merged.push(record);
    seen.add(id);
  }

  return merged;
}

function getRecordId(record) {
  return record && typeof record === "object" && typeof record.id === "string"
    ? record.id
    : null;
}

function readLocalJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  const nativeSetItem = originalSetItem || Storage.prototype.setItem;
  nativeSetItem.call(window.localStorage, key, JSON.stringify(value));
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
