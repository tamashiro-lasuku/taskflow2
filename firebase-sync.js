/* ===== Firebase Sync ===== */

const firebaseConfig = {
  apiKey: "AIzaSyAHhih2TKxOMN3L-R0PdNz1MtCMIY9BGHU",
  authDomain: "taskflow-2b9aa.firebaseapp.com",
  databaseURL: "https://taskflow-2b9aa-default-rtdb.firebaseio.com",
  projectId: "taskflow-2b9aa",
  storageBucket: "taskflow-2b9aa.firebasestorage.app",
  messagingSenderId: "440033831640",
  appId: "1:440033831640:web:96441de0ddb1274e9685ad",
};

const DEVICE_ID = localStorage.getItem("taskflow_device_id") || (() => {
  const id = "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem("taskflow_device_id", id);
  return id;
})();

// Firebase can convert arrays to objects with numeric keys
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

let _db = null;
let _syncEnabled = false;
let _initialSyncDone = false;

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

// ===== Apply remote data to state and re-render =====
function applyRemoteData(remote) {
  // Save current state to compare
  const oldProjectNames = (state.projects || []).map(p => p.name).join(",");

  // Overwrite global state
  const fixed = fixArrays(remote);
  // Copy all properties onto state (preserves the variable reference)
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, fixed);
  if (!state.inbox) state.inbox = [];
  if (!state.selectedProjectIds) state.selectedProjectIds = [];
  if (typeof ensureSubtasks === "function") ensureSubtasks(state);
  delete state._deviceId;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const newProjectNames = (state.projects || []).map(p => p.name).join(",");

  try {
    render();
    if (typeof renderInbox === "function") renderInbox();
  } catch (e) {
    console.error("Render error:", e);
    setSyncIndicator("error", "描画エラー: " + e.message);
  }

  console.log("Applied remote data:", oldProjectNames, "→", newProjectNames);
}

// ===== Init =====
function initFirebaseSync() {
  setSyncIndicator("connecting", "接続中...");
  try {
    firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    _syncEnabled = true;
  } catch (e) {
    setSyncIndicator("error", "初期化失敗: " + e.message);
    return;
  }

  // Step 1: Pull from Firebase (always apply remote on first load)
  _db.ref("taskflow/data").once("value").then((snapshot) => {
    const remote = snapshot.val();
    if (remote && remote.projects) {
      applyRemoteData(remote);
      const names = (state.projects || []).map(p => p.name).join(", ");
      setSyncIndicator("ok", names);
      showSyncNotice("データを取得しました", "pull");
    } else {
      // No remote data, push local
      pushToFirebase();
      showSyncNotice("データをアップロードしました", "push");
    }
    _initialSyncDone = true;

    // Step 2: After initial sync, listen for realtime changes
    _db.ref("taskflow/data").on("value", (snap) => {
      const r = snap.val();
      if (!r || !r.projects) return;
      if (r._deviceId === DEVICE_ID) return; // Ignore own writes
      applyRemoteData(r);
      setSyncIndicator("ok", "自動反映OK");
      showSyncNotice("別のデバイスから反映しました", "auto");
    });

  }).catch((e) => {
    _initialSyncDone = true;
    setSyncIndicator("error", "取得失敗: " + e.message);
  });

  console.log("Firebase sync initialized, device:", DEVICE_ID);
}

// ===== Push =====
function pushToFirebase() {
  if (!_syncEnabled || !_db) return;
  const data = JSON.parse(JSON.stringify(state));
  data._deviceId = DEVICE_ID;
  data._syncUpdatedAt = Date.now();
  state._syncUpdatedAt = data._syncUpdatedAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  _db.ref("taskflow/data").set(data).catch((e) => {
    console.warn("Firebase save error:", e.message);
  });
}

function saveToFirebase() {
  if (!_initialSyncDone) return; // Don't push before first pull
  pushToFirebase();
}

// ===== Force Sync (反映ボタン) =====
async function forceSync() {
  if (!_syncEnabled || !_db) {
    showSyncNotice("同期未接続", "error");
    return;
  }
  const snapshot = await _db.ref("taskflow/data").once("value");
  const remote = snapshot.val();
  if (!remote || !remote.projects) {
    pushToFirebase();
    showSyncNotice("データをアップロードしました", "push");
    return;
  }
  applyRemoteData(remote);
  const names = (state.projects || []).map(p => p.name).join(", ");
  setSyncIndicator("ok", names);
  showSyncNotice("最新データを反映しました", "pull");
}

// ===== Sync Notice =====
function showSyncNotice(msg, type) {
  const el = document.getElementById("syncStatusBar");
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }
  addSyncHistory(msg, type);
}

// ===== Sync History =====
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
