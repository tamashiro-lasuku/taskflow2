// Open task manager on icon click
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "tab.html" });
});

// === Scheduled Notifications ===
const NOTIFY_TIMES = [
  { hour: 7,  min: 30 },
  { hour: 13, min: 0  },
  { hour: 18, min: 0  },
  { hour: 20, min: 0  },
];

// Set up alarms on install/update
chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarms();
});

// Also re-schedule on startup (service worker restart)
chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
});

function scheduleAlarms() {
  // Clear old alarms and re-create
  chrome.alarms.clearAll(() => {
    NOTIFY_TIMES.forEach((t, i) => {
      const name = `inbox-notify-${i}`;
      const when = getNextOccurrence(t.hour, t.min);
      chrome.alarms.create(name, {
        when,
        periodInMinutes: 24 * 60, // repeat daily
      });
    });
  });
}

function getNextOccurrence(hour, min) {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, min, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("inbox-notify-")) {
    checkAndNotify();
  }
});

async function checkAndNotify() {
  const data = await chrome.storage.local.get([
    "inboxCount", "inboxItems", "noDateCount",
  ]);

  const inboxCount = data.inboxCount || 0;
  const noDateCount = data.noDateCount || 0;
  const inboxItems = data.inboxItems || [];

  if (inboxCount === 0 && noDateCount === 0) {
    // Nothing to notify
    updateBadge(0);
    return;
  }

  const lines = [];
  if (inboxCount > 0) {
    lines.push(`インボックス: ${inboxCount}件`);
    // Show up to 5 items
    const preview = inboxItems.slice(0, 5);
    preview.forEach(text => {
      lines.push(`  - ${text}`);
    });
    if (inboxItems.length > 5) {
      lines.push(`  ...ほか${inboxItems.length - 5}件`);
    }
  }
  if (noDateCount > 0) {
    lines.push(`日付未設定タスク: ${noDateCount}件`);
  }

  chrome.notifications.create(`inbox-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "TaskFlow - 未整理タスクがあります",
    message: lines.join("\n"),
    priority: 1,
  });

  updateBadge(inboxCount + noDateCount);
}

// Update badge count
function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#fb923c" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Also update badge whenever storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.inboxCount || changes.noDateCount) {
    const inbox = changes.inboxCount?.newValue || 0;
    const noDate = changes.noDateCount?.newValue || 0;
    updateBadge(inbox + noDate);
  }
});

// Click notification → open task manager
chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: "tab.html" });
});
