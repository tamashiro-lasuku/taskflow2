/* ===== Firebase Sync (Extension version - REST API, no SDK) ===== */

const FIREBASE_DB_URL = "https://taskflow-2b9aa-default-rtdb.firebaseio.com";

const DEVICE_ID = localStorage.getItem("taskflow_device_id") || (() => {
  const id = "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem("taskflow_device_id", id);
  return id;
})();

function fixArrays(data) {
  if (!data) return data;
  if (data.projects && !Array.isArray(data.projects)) {
    data.projects = Object.values(data.projects).filter(Boolean);
  }
  if (data.projects) {
    for (const p of data.projects) {
      if (p.tasks && !Array.isArray(p.tasks)) p.tasks = Object.values(p.tasks).filter(Boolean);
      if (!p.tasks) p.tasks = [];
      for (const t of p.tasks) {
        if (t.subtasks && !Array.isArray(t.subtasks)) t.subtasks = Object.values(t.subtasks).filter(Boolean);
        if (!t.subtasks) t.subtasks = [];
      }
    }
  }
  if (data.inbox && !Array.isArray(data.inbox)) data.inbox = Object.values(data.inbox).filter(Boolean);
  if (!data.inbox) data.inbox = [];
  return data;
}

let _syncEnabled = false;
let _initialSyncDone = false;
let _pollTimer = null;

// ===== Indicator =====
function setSyncIndicator(status, text) {
  let el = document.getElementById("syncIndicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "syncIndicator";
    el.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:9999;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;pointer-events:none;opacity:0.85;";
    document.body.appendChild(el);
  }
  el.style.background = status === "ok" ? "#dcfce7" : status === "error" ? "#fee2e2" : "#fef3c7";
  el.style.color = status === "ok" ? "#16a34a" : status === "error" ? "#dc2626" : "#d97706";
  el.textContent = text;
}

// ===== REST API helpers =====
async function firebaseGet() {
  const res = await fetch(`${FIREBASE_DB_URL}/taskflow/data.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function firebasePut(data) {
  const res = await fetch(`${FIREBASE_DB_URL}/taskflow/data.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ===== Apply remote data =====
function applyRemoteData(remote) {
  const fixed = fixArrays(remote);
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, fixed);
  if (!state.inbox) state.inbox = [];
  if (!state.selectedProjectIds) state.selectedProjectIds = [];
  if (typeof ensureSubtasks === "function") ensureSubtasks(state);
  delete state._deviceId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  try {
    render();
    if (typeof renderInbox === "function") renderInbox();
  } catch (e) {
    console.error("Render error:", e);
  }
}

// ===== Init =====
function initFirebaseSync() {
  setSyncIndicator("connecting", "接続中...");
  _syncEnabled = true;

  firebaseGet().then((remote) => {
    if (remote && remote.projects) {
      applyRemoteData(remote);
      const names = (state.projects || []).map(p => p.name).join(", ");
      setSyncIndicator("ok", names);
      showSyncNotice("データを取得しました", "pull");
    } else {
      pushToFirebase();
      showSyncNotice("データをアップロードしました", "push");
      setSyncIndicator("ok", "同期OK");
    }
    _initialSyncDone = true;

    // Poll for changes every 30 seconds (REST doesn't support realtime)
    _pollTimer = setInterval(async () => {
      try {
        const r = await firebaseGet();
        if (!r || !r.projects) return;
        if (r._deviceId === DEVICE_ID) return;
        const remoteTime = r._syncUpdatedAt || 0;
        const localTime = state._syncUpdatedAt || 0;
        if (remoteTime > localTime) {
          applyRemoteData(r);
          setSyncIndicator("ok", "自動反映OK");
          showSyncNotice("別のデバイスから反映しました", "auto");
        }
      } catch (e) {
        console.warn("Poll error:", e.message);
      }
    }, 30000);

  }).catch((e) => {
    _initialSyncDone = true;
    setSyncIndicator("error", "取得失敗: " + e.message);
  });

  console.log("Firebase REST sync initialized, device:", DEVICE_ID);
}

// ===== Push =====
function pushToFirebase() {
  if (!_syncEnabled) return;
  const data = JSON.parse(JSON.stringify(state));
  data._deviceId = DEVICE_ID;
  data._syncUpdatedAt = Date.now();
  state._syncUpdatedAt = data._syncUpdatedAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  firebasePut(data).catch((e) => console.warn("Firebase save error:", e.message));
}

function saveToFirebase() {
  if (!_initialSyncDone) return;
  pushToFirebase();
}

// ===== Force Sync =====
async function forceSync() {
  if (!_syncEnabled) {
    showSyncNotice("同期未接続", "error");
    return;
  }
  setSyncIndicator("connecting", "反映中...");
  try {
    const remote = await firebaseGet();
    if (!remote || !remote.projects) {
      pushToFirebase();
      showSyncNotice("データをアップロードしました", "push");
      setSyncIndicator("ok", "同期OK");
      return;
    }
    applyRemoteData(remote);
    const names = (state.projects || []).map(p => p.name).join(", ");
    setSyncIndicator("ok", names);
    showSyncNotice("最新データを反映しました", "pull");
  } catch (e) {
    setSyncIndicator("error", "反映失敗: " + e.message);
    showSyncNotice("反映失敗: " + e.message, "error");
  }
}

// ===== Sync Notice & History =====
function showSyncNotice(msg, type) {
  const el = document.getElementById("syncStatusBar");
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }
  addSyncHistory(msg, type);
}

const SYNC_HISTORY_KEY = "taskflow_sync_history";
const SYNC_HISTORY_MAX = 50;

function loadSyncHistory() {
  try { return JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveSyncHistory(history) {
  localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(history));
}

function addSyncHistory(msg, type) {
  if (!msg) return;
  const history = loadSyncHistory();
  history.unshift({ msg, type: type || "info", deviceId: DEVICE_ID, time: Date.now() });
  if (history.length > SYNC_HISTORY_MAX) history.length = SYNC_HISTORY_MAX;
  saveSyncHistory(history);
  if (typeof renderSyncHistory === "function") renderSyncHistory();
}

function formatSyncTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (d.toDateString() === now.toDateString()) return `今日 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨日 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}
