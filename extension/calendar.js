/* ===== Google Calendar Sync ===== */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SYNCED_KEY = "taskflow_synced_events";
const OAUTH_CLIENT_ID = "439914640624-nmjf7v44o11em188eaumk6l8r661t6gs.apps.googleusercontent.com";
const OAUTH_SCOPES = "https://www.googleapis.com/auth/calendar.events";

// Token cache
let _cachedToken = null;
let _tokenExpiry = 0;

// Get OAuth token (cached)
async function getAuthToken() {
  // Return cached token if still valid
  if (_cachedToken && Date.now() < _tokenExpiry) {
    return _cachedToken;
  }

  // Try chrome.identity.getAuthToken first
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
    if (token) {
      _cachedToken = token;
      _tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 min
      return token;
    }
  } catch (e) {
    console.log("getAuthToken failed, trying launchWebAuthFlow:", e.message);
  }

  // Fallback: launchWebAuthFlow
  const token = await getTokenViaWebAuthFlow();
  _cachedToken = token;
  _tokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

// OAuth via launchWebAuthFlow
async function getTokenViaWebAuthFlow() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUrl);
  authUrl.searchParams.set("scope", OAUTH_SCOPES);
  authUrl.searchParams.set("prompt", "consent");

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const url = new URL(responseUrl);
        const params = new URLSearchParams(url.hash.substring(1));
        const token = params.get("access_token");
        const expiresIn = parseInt(params.get("expires_in") || "3600");
        if (token) {
          _cachedToken = token;
          _tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
          resolve(token);
        } else {
          reject(new Error("アクセストークンを取得できませんでした"));
        }
      }
    );
  });
}

// Clear cached token (for re-auth on 401)
function clearCachedToken() {
  const old = _cachedToken;
  _cachedToken = null;
  _tokenExpiry = 0;
  if (old) {
    try { chrome.identity.removeCachedAuthToken({ token: old }, () => {}); } catch {}
  }
}

// API call helper
async function calendarFetch(endpoint, options = {}) {
  const token = await getAuthToken();
  const res = await fetch(`${CALENDAR_API}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Token expired, clear and retry once
    clearCachedToken();
    const newToken = await getAuthToken();
    return await fetch(`${CALENDAR_API}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${newToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  return res;
}

// Load synced event mappings { taskId: calendarEventId }
function loadSyncedEvents() {
  try {
    return JSON.parse(localStorage.getItem(SYNCED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSyncedEvents(map) {
  localStorage.setItem(SYNCED_KEY, JSON.stringify(map));
}

// Sync a single task to Google Calendar
async function syncTaskToCalendar(task, projectName, projectColor) {
  if (!task.dueDate && !task.startDate) {
    return { success: false, reason: "日付なし" };
  }

  const synced = loadSyncedEvents();
  const eventId = synced[task.id];

  const startDate = task.startDate || task.dueDate;
  const endDate = task.dueDate || task.startDate;

  const endDatePlusOne = new Date(endDate);
  endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);

  const score = (task.urgency || 3) * (task.importance || 3);
  const priorityLabel = score >= 15 ? "\u{1F534}高" : score >= 8 ? "\u{1F7E1}中" : "\u{1F535}低";

  const event = {
    summary: `${task.name}`,
    description: [
      `プロジェクト: ${projectName}`,
      `優先スコア: ${score} (${priorityLabel})`,
      `進捗: ${task.progress || 0}%`,
      `ステータス: ${task.status}`,
      task.memo ? `メモ: ${task.memo}` : "",
    ].filter(Boolean).join("\n"),
    start: { date: startDate },
    end: { date: endDatePlusOne.toISOString().slice(0, 10) },
    colorId: getCalendarColor(projectColor),
    visibility: "private",
  };

  try {
    let res;
    if (eventId) {
      res = await calendarFetch(`/calendars/primary/events/${eventId}`, {
        method: "PUT",
        body: JSON.stringify(event),
      });
      if (res.status === 404) {
        res = await calendarFetch("/calendars/primary/events", {
          method: "POST",
          body: JSON.stringify(event),
        });
      }
    } else {
      res = await calendarFetch("/calendars/primary/events", {
        method: "POST",
        body: JSON.stringify(event),
      });
    }

    if (res.ok) {
      const data = await res.json();
      synced[task.id] = data.id;
      saveSyncedEvents(synced);
      return { success: true, eventId: data.id };
    } else {
      const err = await res.text();
      return { success: false, reason: err };
    }
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Delete a synced event from calendar
async function deleteCalendarEvent(taskId) {
  const synced = loadSyncedEvents();
  const eventId = synced[taskId];
  if (!eventId) return;

  try {
    await calendarFetch(`/calendars/primary/events/${eventId}`, {
      method: "DELETE",
    });
  } catch {}

  delete synced[taskId];
  saveSyncedEvents(synced);
}

// Delete all synced events from calendar
async function deleteAllSyncedEvents() {
  const synced = loadSyncedEvents();
  const ids = Object.values(synced);
  let deleted = 0;
  for (const eventId of ids) {
    try {
      const res = await calendarFetch(`/calendars/primary/events/${eventId}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204 || res.status === 410) deleted++;
    } catch {}
  }
  saveSyncedEvents({});
  return deleted;
}

// Sync all tasks (skip projects with "個人" in the name)
async function syncAllToCalendar(projects) {
  const results = { success: 0, skipped: 0, failed: 0 };

  for (const p of projects) {
    if (p.name.includes("個人")) {
      results.skipped += p.tasks.length;
      continue;
    }
    for (const t of p.tasks) {
      const res = await syncTaskToCalendar(t, p.name, p.color);
      if (res.success) results.success++;
      else if (res.reason === "日付なし") results.skipped++;
      else results.failed++;
    }
  }

  return results;
}

// Map project color to Google Calendar colorId (1-11)
function getCalendarColor(hexColor) {
  const colorMap = {
    "#f5e642": "5",
    "#7ec87e": "2",
    "#8ecae6": "7",
    "#e05050": "11",
    "#c084fc": "3",
    "#fb923c": "6",
    "#67e8f9": "7",
    "#a3a3a3": "8",
  };
  return colorMap[hexColor] || "1";
}

// Check if synced
function isTaskSynced(taskId) {
  const synced = loadSyncedEvents();
  return !!synced[taskId];
}
