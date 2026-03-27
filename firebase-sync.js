/* ===== Firebase Sync (manual + hourly) ===== */

const firebaseConfig = {
  apiKey: "AIzaSyAHhih2TKxOMN3L-R0PdNz1MtCMIY9BGHU",
  authDomain: "taskflow-2b9aa.firebaseapp.com",
  databaseURL: "https://taskflow-2b9aa-default-rtdb.firebaseio.com",
  projectId: "taskflow-2b9aa",
  storageBucket: "taskflow-2b9aa.firebasestorage.app",
  messagingSenderId: "440033831640",
  appId: "1:440033831640:web:96441de0ddb1274e9685ad",
};

// Device ID to prevent echo
const DEVICE_ID = localStorage.getItem("taskflow_device_id") || (() => {
  const id = "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem("taskflow_device_id", id);
  return id;
})();

// Firebase can convert arrays to objects with numeric keys - fix them back
function fixArrays(data) {
  if (!data) return data;
  if (data.projects && !Array.isArray(data.projects)) {
    data.projects = Object.values(data.projects).filter(Boolean);
  }
  if (data.projects) {
    for (const p of data.projects) {
      if (p.tasks && !Array.isArray(p.tasks)) {
        p.tasks = Object.values(p.tasks).filter(Boolean);
      }
      if (!p.tasks) p.tasks = [];
      for (const t of p.tasks) {
        if (t.subtasks && !Array.isArray(t.subtasks)) {
          t.subtasks = Object.values(t.subtasks).filter(Boolean);
        }
        if (!t.subtasks) t.subtasks = [];
      }
    }
  }
  if (data.inbox && !Array.isArray(data.inbox)) {
    data.inbox = Object.values(data.inbox).filter(Boolean);
  }
  if (!data.inbox) data.inbox = [];
  return data;
}

let _db = null;
let _syncEnabled = false;
let _initialSyncDone = false; // Block saveToFirebase until first sync completes
let _lastPulledAt = 0;   // Timestamp of the last data we received FROM remote
let _lastPushedAt = 0;   // Timestamp of the last data we pushed TO remote

function initFirebaseSync() {
  setSyncIndicator("connecting", "接続中...");
  try {
    firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    _syncEnabled = true;

    // Pull latest on init (blocks saveToFirebase until done)
    forceSync().then(() => {
      _initialSyncDone = true;
      console.log("Initial sync completed");
      setSyncIndicator("ok", "同期OK");
    }).catch((e) => {
      _initialSyncDone = true; // Allow saves even if first sync fails
      console.error("Initial sync failed:", e);
      setSyncIndicator("error", "同期エラー: " + e.message);
    });

    // Listen for real-time changes from other devices
    _db.ref("taskflow/data").on("value", (snapshot) => {
      const remote = snapshot.val();
      if (!remote || !remote.projects) return;
      const remoteTime = remote._syncUpdatedAt || 0;
      // Ignore our own writes (matched by device ID + timestamp we just pushed)
      if (remote._deviceId === DEVICE_ID && remoteTime <= _lastPushedAt) return;
      // Apply if remote is newer, OR if local has never been modified (fresh state)
      const isLocalFresh = !(state._localModifiedAt);
      if (isLocalFresh || remoteTime > _lastPulledAt) {
        _lastPulledAt = remoteTime;
        state = fixArrays(remote);
        if (!state.inbox) state.inbox = [];
        if (typeof ensureSubtasks === "function") ensureSubtasks(state);
        delete state._deviceId;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        try {
          render();
          renderInbox();
        } catch (e) {
          console.error("Render after realtime sync error:", e);
        }
        showSyncNotice("別のデバイスから自動反映しました", "auto");
        setSyncIndicator("ok", "同期OK");
        console.log("Realtime sync applied from remote");
      }
    });

    // Monitor connection state
    firebase.database().ref(".info/connected").on("value", (snap) => {
      if (snap.val() === true) {
        setSyncIndicator("ok", "同期OK");
      } else {
        setSyncIndicator("error", "Firebase未接続");
      }
    });

    showSyncNotice("同期: 接続済み", "info");
    console.log("Firebase sync initialized, device:", DEVICE_ID);
  } catch (e) {
    console.warn("Firebase init failed:", e.message);
    setSyncIndicator("error", "Firebase初期化失敗: " + e.message);
    _syncEnabled = false;
  }
}

// Persistent sync status indicator (always visible)
function setSyncIndicator(status, text) {
  let el = document.getElementById("syncIndicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "syncIndicator";
    el.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:9999;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;pointer-events:none;opacity:0.85;";
    document.body.appendChild(el);
  }
  if (status === "ok") {
    el.style.background = "#dcfce7";
    el.style.color = "#16a34a";
  } else if (status === "error") {
    el.style.background = "#fee2e2";
    el.style.color = "#dc2626";
  } else {
    el.style.background = "#fef3c7";
    el.style.color = "#d97706";
  }
  el.textContent = text;
}

// Upload local data to Firebase
function saveToFirebase() {
  if (!_syncEnabled || !_db) return;
  // Don't push until initial sync has pulled remote data
  if (!_initialSyncDone) return;

  const data = JSON.parse(JSON.stringify(state));
  data._deviceId = DEVICE_ID;
  data._syncUpdatedAt = Date.now();
  state._syncUpdatedAt = data._syncUpdatedAt;
  // Track what we pushed so the realtime listener ignores our own write
  _lastPushedAt = data._syncUpdatedAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  _db.ref("taskflow/data").set(data).then(() => {
    console.log("Saved to Firebase");
  }).catch((e) => {
    console.warn("Firebase save error:", e.message);
  });
}

// Force sync: always pull remote, then decide whether to apply or push
async function forceSync() {
  if (!_syncEnabled || !_db) {
    showSyncNotice("同期未接続", "error");
    return;
  }

  const snapshot = await _db.ref("taskflow/data").once("value");
  const remote = snapshot.val();

  if (!remote || !remote.projects) {
    // No remote data - push local
    saveToFirebase();
    showSyncNotice("データをアップロードしました", "push");
    return;
  }

  const remoteTime = remote._syncUpdatedAt || 0;
  const localModified = state._localModifiedAt || 0;
  const remoteProjectCount = Array.isArray(remote.projects) ? remote.projects.length : Object.keys(remote.projects || {}).length;
  const localProjectCount = (state.projects || []).length;

  // DEBUG: show sync decision on screen
  setSyncIndicator("connecting",
    `remote:${remoteProjectCount}件 local:${localProjectCount}件 ` +
    `rTime:${remoteTime} lMod:${localModified} pulled:${_lastPulledAt}`
  );

  // ALWAYS pull from remote on forceSync - this is what the user expects
  // when pressing the sync button or on page load
  _lastPulledAt = remoteTime;
  state = fixArrays(remote);
  if (!state.inbox) state.inbox = [];
  if (typeof ensureSubtasks === "function") ensureSubtasks(state);
  delete state._deviceId;
  state._localModifiedAt = undefined; // Mark as not locally modified yet
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  try {
    render();
    renderInbox();
  } catch (e) {
    console.error("Render after sync error:", e);
  }
  showSyncNotice(`反映完了 (${remoteProjectCount}件のプロジェクト)`, "pull");
}

function showSyncNotice(msg, type) {
  const el = document.getElementById("syncStatusBar");
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }
  addSyncHistory(msg, type);
}

// === Sync History ===
const SYNC_HISTORY_KEY = "taskflow_sync_history";
const SYNC_HISTORY_MAX = 50;

function loadSyncHistory() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY) || "[]");
  } catch { return []; }
}

function saveSyncHistory(history) {
  localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify(history));
}

function addSyncHistory(msg, type) {
  if (!msg) return;
  const history = loadSyncHistory();
  history.unshift({
    msg,
    type: type || "info",
    deviceId: DEVICE_ID,
    time: Date.now(),
  });
  // Keep only the latest entries
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
