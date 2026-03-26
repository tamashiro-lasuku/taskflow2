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

function initFirebaseSync() {
  try {
    firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    _syncEnabled = true;

    // Pull latest on init
    forceSync().then(() => {
      console.log("Initial sync completed");
    });

    // Hourly auto-sync
    setInterval(() => {
      forceSync().then(() => {
        console.log("Hourly sync completed");
      });
    }, 60 * 60 * 1000);

    showSyncNotice("同期: 接続済み");
    console.log("Firebase sync initialized, device:", DEVICE_ID);
  } catch (e) {
    console.warn("Firebase init failed:", e.message);
    _syncEnabled = false;
  }
}

// Upload local data to Firebase
function saveToFirebase() {
  if (!_syncEnabled || !_db) return;

  const data = JSON.parse(JSON.stringify(state));
  data._deviceId = DEVICE_ID;
  data._syncUpdatedAt = Date.now();
  state._syncUpdatedAt = data._syncUpdatedAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  _db.ref("taskflow/data").set(data).then(() => {
    console.log("Saved to Firebase");
  }).catch((e) => {
    console.warn("Firebase save error:", e.message);
  });
}

// Force sync: pull remote, merge (newer wins), then push
async function forceSync() {
  if (!_syncEnabled || !_db) {
    showSyncNotice("同期未接続");
    return;
  }

  const snapshot = await _db.ref("taskflow/data").once("value");
  const remote = snapshot.val();

  if (!remote || !remote.projects) {
    // No remote data - push local
    saveToFirebase();
    showSyncNotice("データをアップロードしました");
    return;
  }

  const localTime = state._syncUpdatedAt || 0;
  const remoteTime = remote._syncUpdatedAt || 0;

  if (remoteTime > localTime) {
    // Remote is newer - apply it
    state = fixArrays(remote);
    if (!state.inbox) state.inbox = [];
    if (typeof ensureSubtasks === "function") ensureSubtasks(state);
    delete state._deviceId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    try {
      render();
      renderInbox();
    } catch (e) {
      console.error("Render after sync error:", e);
    }
    showSyncNotice("最新データを反映しました");
  } else {
    // Local is newer or same - push to remote
    saveToFirebase();
    showSyncNotice("データをアップロードしました");
  }
}

function showSyncNotice(msg) {
  const el = document.getElementById("syncStatusBar");
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }
}
