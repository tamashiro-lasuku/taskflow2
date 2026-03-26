/* ===== Firebase Realtime Sync ===== */

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

let _db = null;
let _syncEnabled = false;
let _firebaseSaveTimer = null;
let _ignoreNextUpdate = false;

function initFirebaseSync() {
  try {
    firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    _syncEnabled = true;

    // Listen for remote changes
    _db.ref("taskflow/data").on("value", (snapshot) => {
      if (_ignoreNextUpdate) {
        _ignoreNextUpdate = false;
        return;
      }
      const remote = snapshot.val();
      if (!remote || !remote.projects) return;

      // Only apply if from a different device
      if (remote._deviceId === DEVICE_ID) return;

      // Only apply if remote is newer
      const localTime = state._syncUpdatedAt || 0;
      const remoteTime = remote._syncUpdatedAt || 0;
      if (remoteTime <= localTime) return;

      // Apply remote data
      state = remote;
      if (!state.inbox) state.inbox = [];
      delete state._deviceId;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      renderInbox();
      showSyncNotice("別のデバイスから同期しました");
      console.log("Synced from remote device");
    });

    showSyncNotice("リアルタイム同期: 接続済み");
    console.log("Firebase sync initialized, device:", DEVICE_ID);
  } catch (e) {
    console.warn("Firebase init failed:", e.message);
    _syncEnabled = false;
  }
}

function saveToFirebase() {
  if (!_syncEnabled || !_db) return;

  clearTimeout(_firebaseSaveTimer);
  _firebaseSaveTimer = setTimeout(() => {
    const data = JSON.parse(JSON.stringify(state));
    data._deviceId = DEVICE_ID;
    data._syncUpdatedAt = Date.now();
    state._syncUpdatedAt = data._syncUpdatedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    _ignoreNextUpdate = true;
    _db.ref("taskflow/data").set(data).then(() => {
      console.log("Saved to Firebase");
    }).catch((e) => {
      console.warn("Firebase save error:", e.message);
      _ignoreNextUpdate = false;
    });
  }, 1500);
}

function showSyncNotice(msg) {
  const el = document.getElementById("syncStatusBar");
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }
}
