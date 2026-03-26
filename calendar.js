/* ===== Calendar Sync - PWA Stub ===== */
/* Calendar sync is only available in the Chrome Extension version */

function syncTaskToCalendar() { return Promise.resolve({ success: false, reason: "PWA版では利用不可" }); }
function deleteCalendarEvent() { return Promise.resolve(); }
function syncAllToCalendar() { return Promise.resolve({ success: 0, skipped: 0, failed: 0 }); }
function isTaskSynced() { return false; }
