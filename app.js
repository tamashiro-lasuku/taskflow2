/* ===== TaskFlow - Chrome Extension Task Manager ===== */

// === Data Layer ===
const STORAGE_KEY = "taskflow_data";

const defaultData = () => ({
  projects: [
    {
      id: genId(),
      name: "サンプルプロジェクト",
      color: "#8ecae6",
      description: "はじめてのプロジェクト",
      tasks: [
        {
          id: genId(),
          name: "要件定義",
          assignee: "",
          urgency: 5,
          importance: 4,
          status: "進行中",
          startDate: todayStr(),
          dueDate: futureStr(7),
          estimate: 8,
          actual: 3,
          progress: 40,
          memo: "",
          subtasks: [
            { id: genId(), name: "ヒアリング", status: "完了", assignee: "", dueDate: todayStr() },
            { id: genId(), name: "要件書作成", status: "進行中", assignee: "", dueDate: futureStr(3) },
          ],
        },
        {
          id: genId(),
          name: "画面設計",
          assignee: "",
          urgency: 4,
          importance: 5,
          status: "未着手",
          startDate: futureStr(7),
          dueDate: futureStr(14),
          estimate: 12,
          actual: 0,
          progress: 0,
          memo: "",
          subtasks: [],
        },
        {
          id: genId(),
          name: "開発環境構築",
          assignee: "",
          urgency: 2,
          importance: 3,
          status: "完了",
          startDate: "",
          dueDate: todayStr(),
          estimate: 4,
          actual: 3,
          progress: 100,
          memo: "Docker + Node.js",
          subtasks: [],
        },
      ],
    },
  ],
  selectedProjectId: null,
  currentView: "kanban",
});

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function futureStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// === Storage: localStorage + chrome.storage.sync ===

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Load error:", e);
  }
  return defaultData();
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (typeof saveToFirebase === "function") saveToFirebase();
}

let state = loadData();
if (!state.inbox) state.inbox = [];
ensureSubtasks(state);

function ensureSubtasks(s) {
  if (!s.projects) return;
  for (const p of s.projects) {
    if (!p.tasks) p.tasks = [];
    for (const t of p.tasks) {
      if (!t.subtasks) t.subtasks = [];
    }
  }
}

// Migrate old priority format to urgency/importance
(function migrateData() {
  let changed = false;
  for (const p of state.projects) {
    for (const t of p.tasks) {
      if (t.priority && !t.urgency) {
        const map = { "高": [5, 5], "中": [3, 3], "低": [1, 2] };
        const [u, i] = map[t.priority] || [3, 3];
        t.urgency = u;
        t.importance = i;
        delete t.priority;
        changed = true;
      }
    }
  }
  if (changed) saveData();
})();

// === Helpers ===
function getAllTasks() {
  const tasks = [];
  for (const p of state.projects) {
    for (const t of p.tasks) {
      tasks.push({ ...t, projectId: p.id, projectName: p.name, projectColor: p.color });
    }
  }
  return tasks;
}

function getFilteredTasks() {
  let tasks = getAllTasks();
  if (state.selectedProjectId) {
    tasks = tasks.filter((t) => t.projectId === state.selectedProjectId);
  }
  const pf = document.getElementById("filterPriority").value;
  if (pf !== "all") {
    tasks = tasks.filter((t) => {
      const score = getPriorityScore(t);
      if (pf === "high") return score >= 15;
      if (pf === "mid") return score >= 8 && score < 15;
      return score < 8;
    });
  }
  return tasks;
}

function findTask(taskId) {
  for (const p of state.projects) {
    for (const t of p.tasks) {
      if (t.id === taskId) return { task: t, project: p };
      for (const st of t.subtasks) {
        if (st.id === taskId) return { task: st, parent: t, project: p };
      }
    }
  }
  return null;
}

function findProject(id) {
  return state.projects.find((p) => p.id === id);
}

function formatDate(d) {
  if (!d) return "";
  const parts = d.split("-");
  return `${parts[1]}/${parts[2]}`;
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(todayStr());
}

function statusClass(s) {
  const map = { 未着手: "status-todo", 進行中: "status-progress", 対応待ち: "status-review", 完了: "status-done", 保留: "status-hold" };
  return map[s] || "";
}

function statusColor(s) {
  const map = {
    未着手: "var(--status-todo)",
    進行中: "var(--status-progress)",
    対応待ち: "var(--status-review)",
    完了: "var(--status-done)",
    保留: "var(--status-hold)",
  };
  return map[s] || "var(--status-todo)";
}

function getPriorityScore(t) {
  const u = t.urgency || 3;
  const i = t.importance || 3;
  return u * i;
}

function priorityLevel(score) {
  if (score >= 15) return "high";
  if (score >= 8) return "mid";
  return "low";
}

function priorityLabel(score) {
  if (score >= 15) return "高";
  if (score >= 8) return "中";
  return "低";
}

function priorityBadgeHtml(t) {
  const score = getPriorityScore(t);
  const level = priorityLevel(score);
  return `<span class="priority-badge score-${level}">${score}</span>`;
}

function progressColor(pct) {
  if (pct >= 80) return "var(--accent-green)";
  if (pct >= 40) return "var(--accent-blue)";
  if (pct > 0) return "var(--accent-orange)";
  return "var(--status-todo)";
}

// === Rendering ===
// === Calendar View State ===
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();

// === Recurrence Helpers ===
function getRecurrenceLabel(rec) {
  if (!rec || rec.type === "none") return "";
  const units = { daily: "日", weekly: "週", monthly: "月", yearly: "年" };
  const interval = rec.interval || 1;
  return interval === 1
    ? `毎${units[rec.type]}`
    : `${interval}${units[rec.type]}ごと`;
}

// Generate real task instances for recurrence (saved to project.tasks)
function generateRecurrenceTasks(baseTask) {
  const rec = baseTask.recurrence;
  if (!rec || rec.type === "none") return [];

  const baseDate = baseTask.dueDate || baseTask.startDate;
  if (!baseDate) return [];

  const tasks = [];
  const interval = rec.interval || 1;
  let maxCount = 365;

  if (rec.endType === "count") maxCount = (rec.endCount || 5) - 1;
  else if (rec.endType === "never") maxCount = 52;
  else if (rec.endType === "date" && rec.endDate) maxCount = 365;

  const endLimit = rec.endType === "date" && rec.endDate ? new Date(rec.endDate) : null;
  const duration = baseTask.startDate && baseTask.dueDate
    ? (new Date(baseTask.dueDate) - new Date(baseTask.startDate)) / (1000 * 60 * 60 * 24)
    : 0;

  const groupId = baseTask.recurrenceGroupId || baseTask.id;

  for (let i = 1; i <= maxCount; i++) {
    const d = new Date(baseDate);
    if (rec.type === "daily") d.setDate(d.getDate() + interval * i);
    else if (rec.type === "weekly") d.setDate(d.getDate() + 7 * interval * i);
    else if (rec.type === "monthly") d.setMonth(d.getMonth() + interval * i);
    else if (rec.type === "yearly") d.setFullYear(d.getFullYear() + interval * i);

    if (endLimit && d > endLimit) break;

    const dueStr = d.toISOString().slice(0, 10);
    let startStr = "";
    if (duration > 0) {
      const s = new Date(d);
      s.setDate(s.getDate() - duration);
      startStr = s.toISOString().slice(0, 10);
    }

    tasks.push({
      id: genId(),
      name: baseTask.name,
      urgency: baseTask.urgency,
      importance: baseTask.importance,
      status: "未着手",
      startDate: startStr || dueStr,
      dueDate: dueStr,
      estimate: baseTask.estimate,
      progress: 0,
      memo: baseTask.memo,
      subtasks: [],
      recurrenceGroupId: groupId,
      recurrenceIndex: i + 1,
      recurrence: { type: "none" },
    });
  }
  return tasks;
}

// Delete all tasks in the same recurrence group
function deleteRecurrenceGroup(groupId, projectId) {
  const project = findProject(projectId);
  if (!project) return;
  project.tasks = project.tasks.filter((t) => t.recurrenceGroupId !== groupId);
}

// Regenerate recurrence instances when base task is edited
function regenerateRecurrence(baseTask, project) {
  const groupId = baseTask.recurrenceGroupId || baseTask.id;
  // Remove old instances (keep the base task)
  project.tasks = project.tasks.filter(
    (t) => t.recurrenceGroupId !== groupId || t.id === baseTask.id
  );
  // Generate new ones
  const instances = generateRecurrenceTasks(baseTask);
  project.tasks.push(...instances);
}

function render() {
  renderSidebar();
  renderKanban();
  renderList();
  renderGantt();
  renderCalendar();
  renderDashboard();
  renderGlobalAlerts();
}

function renderGlobalAlerts() {
  const allTasks = getAllTasks();
  const noDate = allTasks.filter(t => !t.startDate && !t.dueDate && t.status !== "完了");
  const alert = document.getElementById("noDateAlert");
  const text = document.getElementById("noDateAlertText");
  if (noDate.length > 0) {
    alert.hidden = false;
    text.textContent = `日付未設定のタスクが ${noDate.length} 件あります`;
  } else {
    alert.hidden = true;
  }
}

function renderSidebar() {
  const list = document.getElementById("projectList");
  // "すべて" item
  let html = `<li class="project-item ${!state.selectedProjectId ? "active" : ""}" data-project-id="">
    <span class="project-dot" style="background: var(--text-tertiary)"></span>
    <span class="project-item-name">すべて</span>
    <span class="project-count">${getAllTasks().length}</span>
  </li>`;

  for (const p of state.projects) {
    html += `<li class="project-item ${state.selectedProjectId === p.id ? "active" : ""}" data-project-id="${p.id}" data-editable>
      <span class="project-dot" style="background: ${p.color}"></span>
      <span class="project-item-name">${esc(p.name)}</span>
      <span class="project-count">${p.tasks.length}</span>
    </li>`;
  }
  list.innerHTML = html;

  // Click handlers
  list.querySelectorAll(".project-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      state.selectedProjectId = el.dataset.projectId || null;
      saveData();
      render();
    });
    el.addEventListener("dblclick", (e) => {
      if (el.dataset.editable !== undefined) {
        openProjectModal(el.dataset.projectId);
      }
    });
  });
}

function renderKanban() {
  const board = document.getElementById("kanbanBoard");
  const columns = [
    { status: "未着手", color: "var(--status-todo)" },
    { status: "進行中", color: "var(--status-progress)" },
    { status: "対応待ち", color: "var(--status-review)" },
    { status: "完了", color: "var(--status-done)" },
    { status: "保留", color: "var(--status-hold)" },
  ];

  const tasks = getFilteredTasks();

  // Status summary
  const summary = document.getElementById("statusSummary");
  if (summary) {
    summary.innerHTML = columns.map(col => {
      const count = tasks.filter(t => t.status === col.status).length;
      return `<span class="status-chip">
        <span class="status-chip-dot" style="background:${col.color}"></span>
        ${col.status} <span class="status-chip-count">${count}</span>
      </span>`;
    }).join("");
  }
  let html = "";

  for (const col of columns) {
    const colTasks = tasks.filter((t) => t.status === col.status);
    html += `<div class="kanban-column">
      <div class="kanban-column-header">
        <span class="kanban-column-dot" style="background: ${col.color}"></span>
        <span class="kanban-column-title">${col.status}</span>
        <span class="kanban-column-count">${colTasks.length}</span>
      </div>
      <div class="kanban-column-body" data-status="${col.status}">`;

    for (const t of colTasks) {
      html += renderKanbanCard(t);
    }

    if (colTasks.length === 0) {
      html += `<div class="empty-state empty-state-compact">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
        <p>ドロップしてタスクを移動</p>
      </div>`;
    }

    html += `</div></div>`;
  }

  board.innerHTML = html;
  setupDragAndDrop();
  renderKanbanInbox();
}

function renderKanbanCard(t) {
  if (!t.subtasks) t.subtasks = [];
  const dueClass = isOverdue(t.dueDate) && t.status !== "完了" ? "overdue" : "";
  const subtaskDone = t.subtasks.filter((s) => s.status === "完了").length;
  const subtaskTotal = t.subtasks.length;

  let cardHtml = `<div class="kanban-card" draggable="true" data-task-id="${t.id}">
    <div class="card-select" data-task-id="${t.id}"></div>
    <div class="card-project-tag">
      <span class="card-project-dot" style="background: ${t.projectColor}"></span>
      ${esc(t.projectName)}
    </div>
    <div class="card-title">${esc(t.name)}</div>
    <div class="card-meta">
      ${priorityBadgeHtml(t)}
      ${t.recurrence && t.recurrence.type !== "none" ? `<span class="recurrence-badge">${getRecurrenceLabel(t.recurrence)}</span>` : ""}
      ${t.dueDate ? `<span class="card-due ${dueClass}">${formatDate(t.dueDate)}</span>` : ""}
    </div>`;

  if (t.progress > 0) {
    cardHtml += `<div class="card-progress-bar"><div class="card-progress-fill" style="width:${t.progress}%;background:${progressColor(t.progress)}"></div></div>`;
  }

  if (subtaskTotal > 0) {
    cardHtml += `<div class="card-subtasks">`;
    for (const st of t.subtasks) {
      const done = st.status === "完了";
      cardHtml += `<div class="card-subtask">
        <div class="card-subtask-check ${done ? "done" : ""}" data-subtask-id="${st.id}"></div>
        <span class="card-subtask-name ${done ? "done" : ""}">${esc(st.name)}</span>
      </div>`;
    }
    cardHtml += `</div>`;
  }

  cardHtml += `</div>`;
  return cardHtml;
}

function renderList() {
  const content = document.getElementById("listContent");
  const projects = state.selectedProjectId
    ? state.projects.filter((p) => p.id === state.selectedProjectId)
    : state.projects;

  if (projects.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
      <p>プロジェクトを追加してください</p>
    </div>`;
    return;
  }

  let html = "";
  for (const p of projects) {
    const tasks = filterProjectTasks(p);
    const doneCount = tasks.filter((t) => t.status === "完了").length;
    const pct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

    html += `<div class="list-project-group">
      <div class="list-project-header" data-project-id="${p.id}">
        <svg class="list-project-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="project-dot" style="background: ${p.color}"></span>
        <span class="list-project-name">${esc(p.name)}</span>
        <div class="list-project-progress"><div class="list-project-progress-fill" style="width:${pct}%"></div></div>
        <span class="list-project-pct">${pct}%</span>
      </div>
      <div class="list-tasks" data-project-id="${p.id}">`;

    for (const t of tasks) {
      const done = t.status === "完了";
      const dueClass = isOverdue(t.dueDate) && !done ? "overdue" : "";
      html += `<div class="list-task-row" data-task-id="${t.id}" tabindex="0">
        <div class="list-select-check" data-task-id="${t.id}"></div>
        <div class="list-task-check ${done ? "done" : ""}" data-task-id="${t.id}"></div>
        <div class="list-task-name ${done ? "done" : ""}">${esc(t.name)}</div>
        <div class="list-task-status ${statusClass(t.status)}">${t.status}</div>
        <div class="list-task-priority">${priorityBadgeHtml(t)}${t.recurrence && t.recurrence.type !== "none" ? ` <span class="recurrence-badge">${getRecurrenceLabel(t.recurrence)}</span>` : ""}</div>
        <div class="list-task-due ${dueClass}">${t.dueDate ? formatDate(t.dueDate) : "—"}</div>
        <div class="list-task-progress-cell">
          <div class="list-task-mini-bar"><div class="list-task-mini-fill" style="width:${t.progress}%;background:${progressColor(t.progress)}"></div></div>
          ${t.progress}%
        </div>
      </div>`;

      // Subtasks
      for (const st of t.subtasks) {
        const stDone = st.status === "完了";
        html += `<div class="list-subtask-row" data-task-id="${st.id}" data-parent-id="${t.id}">
          <div></div>
          <div class="list-task-check ${stDone ? "done" : ""}" data-subtask-id="${st.id}" data-parent-id="${t.id}"></div>
          <div class="list-task-name ${stDone ? "done" : ""}">${esc(st.name)}</div>
          <div class="list-task-status ${statusClass(st.status)}">${st.status}</div>
          <div></div>
          <div class="list-task-due">${st.dueDate ? formatDate(st.dueDate) : ""}</div>
          <div></div>
        </div>`;
      }
    }

    html += `</div></div>`;
  }

  content.innerHTML = html;
  setupListEvents();
}

function filterProjectTasks(project) {
  let tasks = [...project.tasks];
  const pf = document.getElementById("filterPriority").value;
  if (pf !== "all") {
    tasks = tasks.filter((t) => {
      const score = getPriorityScore(t);
      if (pf === "high") return score >= 15;
      if (pf === "mid") return score >= 8 && score < 15;
      return score < 8;
    });
  }
  return tasks;
}

function renderDashboard() {
  const content = document.getElementById("dashboardContent");
  const tasks = getFilteredTasks();
  const total = tasks.length;

  if (total === 0) {
    content.innerHTML = `<div class="empty-state dash-card-full">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="4" rx="1"/><rect x="3" y="13" width="8" height="4" rx="1"/><rect x="13" y="9" width="8" height="12" rx="1"/></svg>
      <p>タスクを追加するとダッシュボードが表示されます</p>
    </div>`;
    return;
  }

  const statusCounts = { 未着手: 0, 進行中: 0, 対応待ち: 0, 完了: 0, 保留: 0 };
  let totalProgress = 0;

  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    totalProgress += t.progress;
  }

  const avgProgress = Math.round(totalProgress / total);
  const doneCount = statusCounts["完了"];
  const overdueTasks = tasks.filter((t) => isOverdue(t.dueDate) && t.status !== "完了");

  // Current month remaining calc
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const remainDays = lastDay.getDate() - now.getDate();
  const remainWeeks = Math.ceil(remainDays / 7);
  const remainEstimate = tasks
    .filter((t) => t.status !== "完了")
    .reduce((sum, t) => sum + (t.estimate || 0) * (1 - (t.progress || 0) / 100), 0);
  const monthLabel = `${now.getMonth() + 1}月`;

  // Update header meta (injected next to title)
  const workDaysLeft = remainDays - Math.floor(remainDays / 7) * 2; // rough weekday estimate
  const capacityHours = workDaysLeft * 8;
  const headerMeta = document.getElementById("dashboardMeta");
  if (headerMeta) {
    headerMeta.innerHTML = `
      <span class="dash-meta-date">${now.getFullYear()}年${now.getMonth() + 1}月</span>
      <span class="dash-meta-group">
        <span class="dash-meta-label">残り</span><strong>${remainDays}</strong><span class="dash-meta-unit">日</span>
      </span>
      <span class="dash-meta-group">
        <span class="dash-meta-label">残り</span><strong>${remainWeeks}</strong><span class="dash-meta-unit">週</span>
      </span>
      <span class="dash-meta-group">
        <span class="dash-meta-label">稼働可能</span><strong>${capacityHours}</strong><span class="dash-meta-unit">h</span>
      </span>
      <span class="dash-meta-group">
        <span class="dash-meta-label">残タスク</span><strong>${Math.round(remainEstimate)}</strong><span class="dash-meta-unit">h</span>
      </span>
    `;
  }

  // Stats Row
  let html = `<div class="stats-row">
    <div class="stat-card">
      <div class="stat-value">${total}</div>
      <div class="stat-label">総タスク</div>
    </div>
    <div class="stat-card">
      <div class="stat-value text-green">${avgProgress}<span class="stat-unit">%</span></div>
      <div class="stat-label">平均進捗</div>
    </div>
    <div class="stat-card">
      <div class="stat-value text-blue">${doneCount}<span class="stat-unit">/${total}</span></div>
      <div class="stat-label">完了</div>
    </div>
    <div class="stat-card">
      <div class="stat-value ${overdueTasks.length > 0 ? "text-red" : "text-green"}">${overdueTasks.length}</div>
      <div class="stat-label">期限超過</div>
    </div>
  </div>`;

  // Status Donut
  html += `<div class="dash-card">
    <div class="dash-card-title">ステータス分布</div>
    ${renderDonut(statusCounts, total)}
  </div>`;

  // Project Progress
  html += `<div class="dash-card">
    <div class="dash-card-title">プロジェクト進捗</div>
    <div class="project-progress-list">`;

  const projects = state.selectedProjectId
    ? state.projects.filter((p) => p.id === state.selectedProjectId)
    : state.projects;

  for (const p of projects) {
    const pTasks = p.tasks;
    const pDone = pTasks.filter((t) => t.status === "完了").length;
    const pPct = pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0;
    html += `<div class="progress-item">
      <div class="progress-item-header">
        <span class="progress-item-name">
          <span class="project-dot" style="background:${p.color}"></span>
          ${esc(p.name)}
        </span>
        <span class="progress-item-pct">${pPct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pPct}%;background:${p.color}"></div></div>
    </div>`;
  }

  html += `</div></div>`;

  // Priority Distribution (urgency × importance)
  html += `<div class="dash-card">
    <div class="dash-card-title">優先度分布（緊急度×重要度）</div>
    <div class="priority-bars">`;

  const priorities = [
    { label: "高(15-25)", count: tasks.filter((t) => getPriorityScore(t) >= 15).length, color: "var(--priority-high)" },
    { label: "中(8-14)", count: tasks.filter((t) => { const s = getPriorityScore(t); return s >= 8 && s < 15; }).length, color: "var(--priority-mid)" },
    { label: "低(1-7)", count: tasks.filter((t) => getPriorityScore(t) < 8).length, color: "var(--priority-low)" },
  ];

  for (const pri of priorities) {
    const w = total > 0 ? (pri.count / total) * 100 : 0;
    html += `<div class="priority-bar-item">
      <span class="priority-bar-label">${pri.label}</span>
      <div class="priority-bar-track">
        <div class="priority-bar-fill" style="width:${Math.max(w, pri.count > 0 ? 15 : 0)}%;background:${pri.color}">${pri.count}</div>
      </div>
    </div>`;
  }

  html += `</div></div>`;

  // (workload shown in stats row above)

  // Timeline (Gantt-like)
  html += `<div class="dash-card dash-card-full">
    <div class="dash-card-title">タイムライン</div>
    ${renderTimeline(tasks)}
  </div>`;

  content.innerHTML = html;
}

function renderDonut(statusCounts, total) {
  const statuses = [
    { name: "未着手", color: "#d4d3ca" },
    { name: "進行中", color: "#8ecae6" },
    { name: "対応待ち", color: "#fb923c" },
    { name: "完了", color: "#7ec87e" },
    { name: "保留", color: "#e05050" },
  ];

  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const r = 52;
  const strokeW = 20;

  let svg = `<div class="donut-container">
    <svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;

  if (total === 0) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e4dc" stroke-width="${strokeW}"/>`;
  } else {
    let offset = 0;
    const circ = 2 * Math.PI * r;
    for (const s of statuses) {
      const count = statusCounts[s.name] || 0;
      if (count === 0) continue;
      const pct = count / total;
      const dashLen = circ * pct;
      const dashGap = circ - dashLen;
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="${s.color}" stroke-width="${strokeW}"
        stroke-dasharray="${dashLen} ${dashGap}"
        stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${cx} ${cy})"
        style="transition: stroke-dasharray 500ms ease-out"/>`;
      offset += dashLen;
    }
  }

  // Center text
  svg += `<text x="${cx}" y="${cx - 4}" text-anchor="middle" font-family="Bricolage Grotesque,Noto Sans JP" font-weight="900" font-size="28" fill="#1a1a1a">${total > 0 ? Math.round((statusCounts["完了"] / total) * 100) : 0}%</text>`;
  svg += `<text x="${cx}" y="${cx + 16}" text-anchor="middle" font-family="Noto Sans JP" font-size="10" fill="#8a8a8a">完了率</text>`;
  svg += `</svg><div class="donut-legend">`;

  for (const s of statuses) {
    const count = statusCounts[s.name] || 0;
    svg += `<div class="legend-item">
      <span class="legend-dot" style="background:${s.color}"></span>
      <span>${s.name}</span>
      <span class="legend-count">${count}</span>
    </div>`;
  }

  svg += `</div></div>`;
  return svg;
}

function renderTimeline(tasks) {
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  if (dated.length === 0) {
    return `<div class="timeline-empty">日付が設定されたタスクがありません</div>`;
  }

  // Find date range
  const allDates = [];
  for (const t of dated) {
    if (t.startDate) allDates.push(new Date(t.startDate));
    if (t.dueDate) allDates.push(new Date(t.dueDate));
  }

  let minDate = new Date(Math.min(...allDates));
  let maxDate = new Date(Math.max(...allDates));

  // Add padding
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);

  const totalDays = Math.max((maxDate - minDate) / (1000 * 60 * 60 * 24), 1);

  // Date labels
  const labels = [];
  const labelCount = Math.min(Math.floor(totalDays), 8);
  for (let i = 0; i <= labelCount; i++) {
    const d = new Date(minDate.getTime() + (totalDays / labelCount) * i * 24 * 60 * 60 * 1000);
    labels.push(formatDate(d.toISOString().slice(0, 10)));
  }

  let html = `<div class="timeline-container">
    <div class="timeline-dates-header">
      <span class="timeline-task-name">タスク</span>
      <div class="timeline-date-labels">
        ${labels.map((l) => `<span>${l}</span>`).join("")}
      </div>
    </div>`;

  for (const t of dated) {
    const start = t.startDate ? new Date(t.startDate) : new Date(t.dueDate);
    const end = t.dueDate ? new Date(t.dueDate) : new Date(t.startDate);
    const leftPct = ((start - minDate) / (1000 * 60 * 60 * 24) / totalDays) * 100;
    const widthPct = Math.max(((end - start) / (1000 * 60 * 60 * 24) / totalDays) * 100, 2);
    const color = t.projectColor || "var(--accent-blue)";

    html += `<div class="timeline-row">
      <span class="timeline-task-name">${esc(t.name)}</span>
      <div class="timeline-bar-container">
        <div class="timeline-bar" style="left:${leftPct}%;width:${widthPct}%;background:${color};opacity:0.7"></div>
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// === Drag & Drop ===
function setupDragAndDrop() {
  const cards = document.querySelectorAll(".kanban-card");
  const columns = document.querySelectorAll(".kanban-column-body");

  cards.forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", card.dataset.taskId);
      e.dataTransfer.effectAllowed = "move";
      document.getElementById("kanbanTrash").classList.add("visible");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      columns.forEach((col) => col.classList.remove("drag-over"));
      const trash = document.getElementById("kanbanTrash");
      trash.classList.remove("visible", "drag-over");
    });

    card.addEventListener("click", (e) => {
      // Checkbox toggle
      if (e.target.closest(".card-select")) {
        const sel = e.target.closest(".card-select");
        sel.classList.toggle("checked");
        card.classList.toggle("selected", sel.classList.contains("checked"));
        updateDeleteBtn();
        return;
      }
      if (e.target.closest(".card-subtask-check")) {
        const stId = e.target.closest(".card-subtask-check").dataset.subtaskId;
        toggleSubtask(stId);
        return;
      }
      openTaskModal(card.dataset.taskId);
    });
  });

  columns.forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    });

    col.addEventListener("dragleave", () => {
      col.classList.remove("drag-over");
    });

    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const taskId = e.dataTransfer.getData("text/plain");
      const newStatus = col.dataset.status;
      updateTaskStatus(taskId, newStatus);
    });
  });

  // Trash drop zone
  const trash = document.getElementById("kanbanTrash");
  trash.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trash.classList.add("drag-over");
  });
  trash.addEventListener("dragleave", () => {
    trash.classList.remove("drag-over");
  });
  trash.addEventListener("drop", async (e) => {
    e.preventDefault();
    trash.classList.remove("drag-over", "visible");
    const taskId = e.dataTransfer.getData("text/plain");
    const found = findTask(taskId);
    if (!found) return;
    const ok = await showConfirm(`「${found.task.name}」を削除しますか？`);
    if (!ok) return;
    for (const p of state.projects) {
      p.tasks = p.tasks.filter((t) => t.id !== taskId);
    }
    saveData();
    render();
  });
}

function updateDeleteBtn() {
  const count = document.querySelectorAll(".card-select.checked").length;
  const btn = document.getElementById("deleteSelectedBtn");
  btn.hidden = count === 0;
  document.getElementById("deleteSelectedCount").textContent = count;
}

function updateListDeleteBtn() {
  const count = document.querySelectorAll(".list-select-check.checked").length;
  const btn = document.getElementById("deleteSelectedList");
  btn.hidden = count === 0;
  document.getElementById("deleteSelectedListCount").textContent = count;
}

function updateGanttDeleteBtn() {
  const count = document.querySelectorAll(".gantt-select-check.checked").length;
  const btn = document.getElementById("deleteSelectedGantt");
  btn.hidden = count === 0;
  document.getElementById("deleteSelectedGanttCount").textContent = count;
}

function updateTaskStatus(taskId, newStatus) {
  const found = findTask(taskId);
  if (found && !found.parent) {
    found.task.status = newStatus;
    if (newStatus === "完了") found.task.progress = 100;
    saveData();
    render();
  }
}

function toggleSubtask(subtaskId) {
  for (const p of state.projects) {
    for (const t of p.tasks) {
      for (const st of t.subtasks) {
        if (st.id === subtaskId) {
          st.status = st.status === "完了" ? "未着手" : "完了";
          saveData();
          render();
          return;
        }
      }
    }
  }
}

// === List Events ===
function setupListEvents() {
  // Project header collapse
  document.querySelectorAll(".list-project-header").forEach((el) => {
    el.addEventListener("click", () => {
      const chevron = el.querySelector(".list-project-chevron");
      const tasks = el.nextElementSibling;
      chevron.classList.toggle("collapsed");
      tasks.style.display = tasks.style.display === "none" ? "" : "none";
    });
  });

  // Task row click → open modal
  document.querySelectorAll(".list-task-row").forEach((el) => {
    el.addEventListener("click", (e) => {
      // Select checkbox
      if (e.target.closest(".list-select-check")) {
        const sel = e.target.closest(".list-select-check");
        sel.classList.toggle("checked");
        updateListDeleteBtn();
        return;
      }
      if (e.target.closest(".list-task-check")) {
        const taskId = e.target.closest(".list-task-check").dataset.taskId;
        const found = findTask(taskId);
        if (found && !found.parent) {
          found.task.status = found.task.status === "完了" ? "未着手" : "完了";
          if (found.task.status === "完了") found.task.progress = 100;
          else found.task.progress = 0;
          saveData();
          render();
        }
        return;
      }
      openTaskModal(el.dataset.taskId);
    });
  });

  // Subtask row
  document.querySelectorAll(".list-subtask-row").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".list-task-check")) {
        const stId = e.target.closest(".list-task-check").dataset.subtaskId;
        toggleSubtask(stId);
        return;
      }
      openTaskModal(el.dataset.taskId, el.dataset.parentId);
    });
  });
}

// === Modals ===
function openTaskModal(taskId, parentId) {
  const modal = document.getElementById("taskModal");
  const form = document.getElementById("taskForm");
  const title = document.getElementById("modalTitle");
  const deleteBtn = document.getElementById("deleteTaskBtn");
  const subtaskBtn = document.getElementById("addSubtaskBtn");

  form.reset();
  document.getElementById("taskId").value = "";
  document.getElementById("taskParentId").value = "";
  document.getElementById("taskType").value = "task";
  document.getElementById("progressValue").textContent = "0";
  document.getElementById("taskProgress").value = 0;

  // Populate project select
  const projSelect = document.getElementById("taskProject");
  projSelect.innerHTML = state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");

  if (taskId) {
    const found = findTask(taskId);
    if (!found) return;

    const t = found.task;
    const isSubtask = !!found.parent;

    title.textContent = isSubtask ? "サブタスク編集" : "タスク編集";
    document.getElementById("taskId").value = t.id;
    document.getElementById("taskName").value = t.name;
    document.getElementById("taskStatus").value = t.status;

    if (isSubtask) {
      document.getElementById("taskParentId").value = found.parent.id;
      document.getElementById("taskType").value = "subtask";
      document.getElementById("taskDue").value = t.dueDate || "";
      projSelect.value = found.project.id;
      // Hide recurrence for subtasks
      document.getElementById("taskRecurrence").value = "none";
      document.getElementById("recurrenceDetail").hidden = true;
      document.getElementById("recurrenceEndRow").hidden = true;
    } else {
      document.getElementById("taskUrgency").value = t.urgency || 3;
      document.getElementById("taskImportance").value = t.importance || 3;
      updatePriorityScore();
      document.getElementById("taskStart").value = t.startDate || "";
      document.getElementById("taskDue").value = t.dueDate || "";
      document.getElementById("taskEstimate").value = t.estimate || "";
      document.getElementById("taskProgress").value = t.progress;
      document.getElementById("progressValue").textContent = t.progress;
      updateProgressButtons(t.progress);
      document.getElementById("taskMemo").value = t.memo || "";
      projSelect.value = found.project.id;

      // Recurrence
      const rec = t.recurrence || { type: "none" };
      document.getElementById("taskRecurrence").value = rec.type || "none";
      updateRecurrenceUI(rec.type || "none");
      if (rec.type && rec.type !== "none") {
        document.getElementById("recurrenceInterval").value = rec.interval || 1;
        document.getElementById("recurrenceEndType").value = rec.endType || "count";
        document.getElementById("recurrenceCount").value = rec.endCount || 5;
        document.getElementById("recurrenceUntil").value = rec.endDate || "";
        updateRecurrenceEndUI(rec.endType || "count");
      }
    }

    deleteBtn.hidden = false;
    subtaskBtn.hidden = isSubtask;
    const syncBtn = document.getElementById("syncTaskBtn");
    syncBtn.hidden = isSubtask;
    syncBtn.classList.toggle("synced", !isSubtask && isTaskSynced(t.id));
    if (!isSubtask && isTaskSynced(t.id)) {
      syncBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> 同期済み`;
    } else {
      syncBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> カレンダー`;
    }
  } else {
    title.textContent = "タスク追加";
    deleteBtn.hidden = true;
    subtaskBtn.hidden = true;
    document.getElementById("syncTaskBtn").hidden = true;
    document.getElementById("taskRecurrence").value = "none";
    document.getElementById("recurrenceDetail").hidden = true;
    document.getElementById("recurrenceEndRow").hidden = true;
    if (state.selectedProjectId) {
      projSelect.value = state.selectedProjectId;
    }
  }

  document.getElementById("inboxAddInput").value = "";
  modal.classList.add("open");
  document.getElementById("taskName").focus();
}

function openProjectModal(projectId) {
  const modal = document.getElementById("projectModal");
  const form = document.getElementById("projectForm");
  const title = document.getElementById("projectModalTitle");
  const deleteBtn = document.getElementById("deleteProjectBtn");

  form.reset();
  document.getElementById("projectId").value = "";

  // Reset color picker
  document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
  document.querySelector('.color-swatch[data-color="#f5e642"]').classList.add("active");

  if (projectId) {
    const p = findProject(projectId);
    if (!p) return;
    title.textContent = "プロジェクト編集";
    document.getElementById("projectId").value = p.id;
    document.getElementById("projectName").value = p.name;
    document.getElementById("projectDesc").value = p.description || "";

    document.querySelectorAll(".color-swatch").forEach((s) => {
      s.classList.toggle("active", s.dataset.color === p.color);
    });

    deleteBtn.hidden = false;
  } else {
    title.textContent = "プロジェクト追加";
    deleteBtn.hidden = true;
  }

  modal.classList.add("open");
  document.getElementById("projectName").focus();
}

function closeModal(modal) {
  modal.classList.remove("open");
  // Cancel pending inbox assign if modal closed without saving
  if (modal.id === "taskModal") {
    pendingInboxAssignId = null;
  }
}

function getSelectedColor() {
  const active = document.querySelector(".color-swatch.active");
  return active ? active.dataset.color : "#f5e642";
}

// === Confirm Dialog ===
function showConfirm(message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirmDialog");
    document.getElementById("confirmMessage").textContent = message;
    dialog.classList.add("open");

    const ok = document.getElementById("confirmOk");
    const cancel = document.getElementById("confirmCancel");

    const cleanup = () => {
      dialog.classList.remove("open");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
    };

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };

    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
  });
}

// === Progress Buttons ===
function updateProgressButtons(value) {
  document.querySelectorAll(".progress-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.value) === value);
  });
}

// === Priority Score UI ===
function updatePriorityScore() {
  const u = parseInt(document.getElementById("taskUrgency").value) || 3;
  const i = parseInt(document.getElementById("taskImportance").value) || 3;
  const score = u * i;
  const el = document.getElementById("priorityScore");
  el.textContent = score;
  el.className = "priority-score score-" + priorityLevel(score);

  // Mini matrix
  const matrix = document.getElementById("priorityMatrixMini");
  let html = "";
  for (let row = 1; row <= 5; row++) {
    for (let col = 1; col <= 5; col++) {
      const cellScore = row * col;
      const zone = cellScore >= 15 ? "zone-high" : cellScore >= 8 ? "zone-mid" : "zone-low";
      const active = col === u && row === i ? "active" : "";
      html += `<div class="matrix-cell ${zone} ${active}"></div>`;
    }
  }
  matrix.innerHTML = html;
}

// === Gantt Chart ===
const ganttZoom = "day";

function renderGantt() {
  const content = document.getElementById("ganttContent");
  const tasks = getFilteredTasks();
  const dated = tasks.filter((t) => t.startDate || t.dueDate);

  if (dated.length === 0) {
    content.innerHTML = `<div class="gantt-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="12" height="3" rx="1"/><rect x="7" y="10" width="14" height="3" rx="1"/><rect x="5" y="16" width="8" height="3" rx="1"/><line x1="3" y1="2" x2="3" y2="22"/></svg>
      <p>日付が設定されたタスクを追加するとガントチャートが表示されます</p>
    </div>`;
    return;
  }

  // Date range
  const allDates = [];
  for (const t of dated) {
    if (t.startDate) allDates.push(new Date(t.startDate));
    if (t.dueDate) allDates.push(new Date(t.dueDate));
    for (const st of t.subtasks || []) {
      if (st.dueDate) allDates.push(new Date(st.dueDate));
    }
  }

  let minDate = new Date(Math.min(...allDates));
  let maxDate = new Date(Math.max(...allDates));
  minDate.setDate(minDate.getDate() - 3);
  maxDate.setDate(maxDate.getDate() + 7);

  const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
  const cellWidth = ganttZoom === "day" ? 40 : ganttZoom === "week" ? 24 : 8;
  const today = new Date(todayStr());

  // Build day columns
  const days = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  // Group tasks by project
  const projects = state.selectedProjectId
    ? state.projects.filter((p) => p.id === state.selectedProjectId)
    : state.projects;

  // Build rows
  const rows = [];
  for (const p of projects) {
    const pTasks = filterProjectTasks(p).filter((t) => t.startDate || t.dueDate);
    if (pTasks.length === 0) continue;
    rows.push({ type: "project", project: p });
    for (const t of pTasks) {
      rows.push({ type: "task", task: t, project: p });
      for (const st of t.subtasks || []) {
        if (st.dueDate) {
          rows.push({ type: "subtask", task: st, parent: t, project: p });
        }
      }
    }
  }

  // Header
  let headerHtml = "";
  const months = {};
  for (const d of days) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!months[key]) months[key] = { name: `${d.getMonth() + 1}月`, count: 0 };
    months[key].count++;
  }

  let prevMonth = -1;
  for (const d of days) {
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = d.toISOString().slice(0, 10) === todayStr();
    const cls = [isWeekend ? "is-weekend" : "", isToday ? "is-today" : ""].filter(Boolean).join(" ");
    const dayLabel = ganttZoom === "month" ? "" : d.getDate();
    const dayName = ganttZoom !== "day" ? "" : ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    const showMonth = d.getMonth() !== prevMonth;
    prevMonth = d.getMonth();
    headerHtml += `<div class="gantt-header-cell ${cls}" style="width:${cellWidth}px;min-width:${cellWidth}px">
      ${showMonth ? `<span class="gantt-header-month">${d.getMonth() + 1}月</span>` : ""}
      ${ganttZoom === "day" ? `<span class="gantt-header-day">${dayName}</span>` : ""}
      <span>${dayLabel}</span>
    </div>`;
  }

  // Sidebar
  let sidebarHtml = `<div class="gantt-sidebar-header">タスク名</div>`;
  for (const row of rows) {
    if (row.type === "project") {
      sidebarHtml += `<div class="gantt-sidebar-row is-project">
        <span class="project-dot" style="background:${row.project.color}"></span>
        <span class="gantt-sidebar-task-name">${esc(row.project.name)}</span>
      </div>`;
    } else if (row.type === "task") {
      sidebarHtml += `<div class="gantt-sidebar-row" data-task-id="${row.task.id}">
        <div class="gantt-select-check" data-task-id="${row.task.id}"></div>
        <span class="gantt-sidebar-task-name">${esc(row.task.name)}</span>
        ${priorityBadgeHtml(row.task)}
      </div>`;
    } else {
      sidebarHtml += `<div class="gantt-sidebar-row is-subtask" data-task-id="${row.task.id}" data-parent-id="${row.parent.id}">
        <span class="gantt-sidebar-task-name">${esc(row.task.name)}</span>
      </div>`;
    }
  }

  // Body
  let bodyHtml = "";
  for (const row of rows) {
    const isProject = row.type === "project";
    let rowHtml = `<div class="gantt-row ${isProject ? "is-project" : ""}">`;

    // Background cells
    for (const d of days) {
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      rowHtml += `<div class="gantt-cell ${isWeekend ? "is-weekend" : ""}" style="width:${cellWidth}px;min-width:${cellWidth}px"></div>`;
    }

    // Bar
    if (!isProject) {
      const t = row.task;
      const start = t.startDate ? new Date(t.startDate) : (t.dueDate ? new Date(t.dueDate) : null);
      const end = t.dueDate ? new Date(t.dueDate) : (t.startDate ? new Date(t.startDate) : null);

      if (start && end) {
        const startIdx = Math.max(0, Math.round((start - minDate) / (1000 * 60 * 60 * 24)));
        const endIdx = Math.round((end - minDate) / (1000 * 60 * 60 * 24));
        const barLeft = startIdx * cellWidth;
        const barWidth = Math.max((endIdx - startIdx + 1) * cellWidth, cellWidth);
        const color = row.project.color;
        const progress = t.progress || (t.status === "完了" ? 100 : 0);
        const isSubtask = row.type === "subtask";

        rowHtml += `<div class="${isSubtask ? "gantt-bar subtask-bar" : "gantt-bar"}"
          style="left:${barLeft}px;width:${barWidth}px;background:${color}"
          data-task-id="${t.id}" ${row.parent ? `data-parent-id="${row.parent.id}"` : ""}>
          <div class="gantt-bar-progress" style="width:${progress}%;background:${color}"></div>
          ${!isSubtask && barWidth > 60 ? `<span class="gantt-bar-label">${esc(t.name)}</span>` : ""}
        </div>`;
      }
    }

    rowHtml += `</div>`;
    bodyHtml += rowHtml;
  }

  // Today line
  const todayIdx = Math.round((today - minDate) / (1000 * 60 * 60 * 24));
  const todayLeft = todayIdx * cellWidth + cellWidth / 2;

  content.innerHTML = `<div class="gantt-wrapper">
    <div class="gantt-sidebar">${sidebarHtml}</div>
    <div class="gantt-timeline">
      <div class="gantt-header">${headerHtml}</div>
      <div class="gantt-body" style="position:relative">
        ${bodyHtml}
        <div class="gantt-today-line" style="left:${todayLeft}px">
          <span class="gantt-today-label">今日</span>
        </div>
      </div>
    </div>
  </div>`;

  // Click handlers for gantt sidebar rows
  content.querySelectorAll(".gantt-sidebar-row[data-task-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".gantt-select-check")) {
        e.target.closest(".gantt-select-check").classList.toggle("checked");
        updateGanttDeleteBtn();
        return;
      }
      openTaskModal(el.dataset.taskId, el.dataset.parentId);
    });
  });

  // Click handlers for gantt bars
  content.querySelectorAll(".gantt-bar[data-task-id]").forEach((el) => {
    el.addEventListener("click", () => {
      openTaskModal(el.dataset.taskId, el.dataset.parentId);
    });
  });
}

// === Recurrence UI ===
function updateRecurrenceUI(type) {
  const detail = document.getElementById("recurrenceDetail");
  const endRow = document.getElementById("recurrenceEndRow");
  const unitEl = document.getElementById("recurrenceIntervalUnit");

  if (type === "none") {
    detail.hidden = true;
    endRow.hidden = true;
    return;
  }

  detail.hidden = false;
  endRow.hidden = false;

  const units = { daily: "日", weekly: "週", monthly: "月", yearly: "年" };
  unitEl.textContent = units[type] || "";
}

function updateRecurrenceEndUI(endType) {
  document.getElementById("recurrenceEndCount").hidden = endType !== "count";
  document.getElementById("recurrenceEndDate").hidden = endType !== "date";
}

// === Calendar View ===
function renderCalendar() {
  const content = document.getElementById("calendarContent");
  const label = document.getElementById("calendarMonthLabel");
  if (!content || !label) return;

  label.textContent = `${calendarYear}年${calendarMonth + 1}月`;

  const year = calendarYear;
  const month = calendarMonth;

  // First day of month and total days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay(); // 0=Sun

  // Previous month fill
  const prevMonthLast = new Date(year, month, 0).getDate();

  // Collect all tasks (including recurrence instances) mapped by date
  const tasksByDate = {};
  const allTasks = getFilteredTasks();

  // Add all tasks (including materialized recurrence instances)
  for (const t of allTasks) {
    if (t.dueDate) {
      if (!tasksByDate[t.dueDate]) tasksByDate[t.dueDate] = [];
      tasksByDate[t.dueDate].push(t);
    }
    if (t.startDate && t.startDate !== t.dueDate) {
      if (!tasksByDate[t.startDate]) tasksByDate[t.startDate] = [];
      tasksByDate[t.startDate].push({ ...t, isStartDate: true });
    }
  }

  const todayString = todayStr();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

  let html = `<div class="calendar-grid">`;

  // Weekday headers
  for (let i = 0; i < 7; i++) {
    const isWeekend = i === 0 || i === 6;
    html += `<div class="calendar-weekday ${isWeekend ? "is-weekend" : ""}">${weekdays[i]}</div>`;
  }

  // Calendar cells
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - startWeekday;
    let dayNum, dateStr, isOtherMonth = false, isWeekend = false;

    if (dayOffset < 0) {
      // Previous month
      dayNum = prevMonthLast + dayOffset + 1;
      const d = new Date(year, month - 1, dayNum);
      dateStr = d.toISOString().slice(0, 10);
      isOtherMonth = true;
    } else if (dayOffset >= daysInMonth) {
      // Next month
      dayNum = dayOffset - daysInMonth + 1;
      const d = new Date(year, month + 1, dayNum);
      dateStr = d.toISOString().slice(0, 10);
      isOtherMonth = true;
    } else {
      dayNum = dayOffset + 1;
      const d = new Date(year, month, dayNum);
      dateStr = d.toISOString().slice(0, 10);
    }

    const weekday = i % 7;
    isWeekend = weekday === 0 || weekday === 6;
    const isToday = dateStr === todayString;

    const classes = [
      "calendar-day",
      isOtherMonth ? "other-month" : "",
      isToday ? "is-today" : "",
      isWeekend ? "is-weekend" : "",
    ].filter(Boolean).join(" ");

    html += `<div class="${classes}" data-date="${dateStr}">`;
    html += `<div class="calendar-day-number">${dayNum}</div>`;
    html += `<div class="calendar-day-tasks">`;

    const dayTasks = tasksByDate[dateStr] || [];
    const maxShow = 4;
    const shown = dayTasks.slice(0, maxShow);
    const remaining = dayTasks.length - maxShow;

    for (const t of shown) {
      const isDone = t.status === "完了";
      const chipBg = t.projectColor ? t.projectColor + "22" : "var(--bg-hover)";
      const chipBorder = t.projectColor || "var(--border-medium)";
      const isRecurring = !!t.recurrenceGroupId;
      const isStart = t.isStartDate;

      html += `<div class="calendar-task-chip ${isDone ? "status-done" : ""}"
        style="background:${chipBg};border-left-color:${chipBorder}"
        data-task-id="${t.id}"
        title="${esc(t.name)}${isRecurring ? " (繰り返し)" : ""}${isStart ? " (開始)" : ""}">
        ${esc(t.name)}${isRecurring ? " ↻" : ""}
      </div>`;
    }

    if (remaining > 0) {
      html += `<div class="calendar-day-more">+${remaining}件</div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  content.innerHTML = html;

  // Click handlers
  content.querySelectorAll(".calendar-task-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      openTaskModal(chip.dataset.taskId);
    });
  });
}

// === Event Listeners ===
// === Inbox (Quick Memo) ===
function addInboxLines(rawText) {
  const lines = rawText.split("\n")
    .map(l => l.replace(/^[\s\-\*・•]+/, "").trim())
    .filter(Boolean);
  for (const text of lines) {
    state.inbox.push({ id: genId(), text, createdAt: todayStr() });
  }
  if (lines.length > 0) saveData();
  return lines.length;
}

// Track which inbox item is being assigned (removed only on save)
let pendingInboxAssignId = null;

function bindInboxItemEvents(container) {
  // Assign → open task modal with name pre-filled (don't remove yet)
  container.querySelectorAll(".assign-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.inboxId;
      const item = state.inbox.find(item => item.id === id);
      if (!item) return;
      pendingInboxAssignId = id;
      openTaskModal();
      document.getElementById("taskName").value = item.text;
    });
  });

  // Delete
  container.querySelectorAll(".inbox-delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.inboxId;
      const idx = state.inbox.findIndex(item => item.id === id);
      if (idx === -1) return;
      state.inbox.splice(idx, 1);
      saveData();
      renderInbox();
      renderKanban();
    });
  });
}

function renderInboxItem(item) {
  return `
    <span class="inbox-item-bullet"></span>
    <span class="inbox-item-text" title="${esc(item.text)}">${esc(item.text)}</span>
    <span class="inbox-item-actions">
      <button class="inbox-action-btn assign-btn" data-inbox-id="${item.id}" title="タスクに振り分け">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button class="inbox-action-btn inbox-delete-btn" data-inbox-id="${item.id}" title="削除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </span>`;
}

function renderInbox() {
  const list = document.getElementById("inboxList");
  const count = document.getElementById("inboxCount");
  count.textContent = state.inbox.length;

  if (state.inbox.length === 0) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = state.inbox.map(item =>
    `<li class="inbox-item" data-inbox-id="${item.id}">${renderInboxItem(item)}</li>`
  ).join("");

  bindInboxItemEvents(list);
}

function renderKanbanInbox() {
  const board = document.getElementById("kanbanBoard");
  // Remove existing inbox column
  const existing = board.querySelector(".kanban-inbox-column");
  if (existing) existing.remove();

  const col = document.createElement("div");
  col.className = "kanban-inbox-column";
  col.innerHTML = `
    <div class="kanban-column-header">
      <span class="kanban-column-dot" style="background: var(--accent-orange)"></span>
      <span class="kanban-column-title">インボックス</span>
      <span class="kanban-column-count">${state.inbox.length}</span>
    </div>
    <div class="kanban-inbox-input-row">
      <textarea class="kanban-inbox-input" rows="2" placeholder="メモ追加 (1行1件)"></textarea>
      <button class="inbox-send-btn kanban-inbox-send-btn" title="追加">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
    <div class="kanban-inbox-body">
      ${state.inbox.map(item => `
        <div class="kanban-inbox-card" data-inbox-id="${item.id}">
          <span class="inbox-item-bullet"></span>
          <span class="kanban-inbox-card-text">${esc(item.text)}</span>
          <span class="kanban-inbox-card-actions">
            <button class="inbox-action-btn assign-btn" data-inbox-id="${item.id}" title="タスクに振り分け">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="inbox-action-btn inbox-delete-btn" data-inbox-id="${item.id}" title="削除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </span>
        </div>
      `).join("")}
      ${state.inbox.length === 0 ? `<div class="empty-state empty-state-compact"><p>メモをここに追加</p></div>` : ""}
    </div>
  `;

  board.insertBefore(col, board.firstChild);

  // Kanban inbox textarea
  const ta = col.querySelector(".kanban-inbox-input");
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInbox(ta);
    }
  });
  col.querySelector(".kanban-inbox-send-btn").addEventListener("click", () => {
    submitInbox(ta);
  });

  bindInboxItemEvents(col);
}

function submitInbox(textarea) {
  const added = addInboxLines(textarea.value);
  if (added > 0) {
    textarea.value = "";
    renderInbox();
    renderKanbanInbox();
  }
}

function initInbox() {
  const input = document.getElementById("inboxInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInbox(input);
    }
  });
  document.getElementById("inboxSendBtn").addEventListener("click", () => {
    submitInbox(input);
  });
  renderInbox();
}

function init() {
  // View switching
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      const viewId = btn.dataset.view + "View";
      document.getElementById(viewId).classList.add("active");
      state.currentView = btn.dataset.view;
      saveData();
    });
  });

  // Restore view
  if (state.currentView) {
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === state.currentView);
    });
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(state.currentView + "View").classList.add("active");
  }

  // Add project
  document.getElementById("addProjectBtn").addEventListener("click", () => openProjectModal());

  // Add task buttons
  // FAB add task
  document.getElementById("fabAddTask").addEventListener("click", () => openTaskModal());

  // Calendar navigation
  document.getElementById("calendarPrev").addEventListener("click", () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
  });
  document.getElementById("calendarNext").addEventListener("click", () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar();
  });
  document.getElementById("calendarToday").addEventListener("click", () => {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
    renderCalendar();
  });

  // Recurrence UI
  document.getElementById("taskRecurrence").addEventListener("change", (e) => {
    updateRecurrenceUI(e.target.value);
  });
  document.getElementById("recurrenceEndType").addEventListener("change", (e) => {
    updateRecurrenceEndUI(e.target.value);
  });

  // Bulk delete - kanban
  document.getElementById("deleteSelectedBtn").addEventListener("click", async () => {
    const selected = document.querySelectorAll(".card-select.checked");
    if (selected.length === 0) return;
    const ok = await showConfirm(`${selected.length}件のタスクを削除しますか？`);
    if (!ok) return;
    const ids = new Set([...selected].map((s) => s.dataset.taskId));
    for (const p of state.projects) { p.tasks = p.tasks.filter((t) => !ids.has(t.id)); }
    saveData();
    render();
  });

  // Bulk delete - list
  document.getElementById("deleteSelectedList").addEventListener("click", async () => {
    const selected = document.querySelectorAll(".list-select-check.checked");
    if (selected.length === 0) return;
    const ok = await showConfirm(`${selected.length}件のタスクを削除しますか？`);
    if (!ok) return;
    const ids = new Set([...selected].map((s) => s.dataset.taskId));
    for (const p of state.projects) { p.tasks = p.tasks.filter((t) => !ids.has(t.id)); }
    saveData();
    render();
  });

  // Bulk delete - gantt
  document.getElementById("deleteSelectedGantt").addEventListener("click", async () => {
    const selected = document.querySelectorAll(".gantt-sidebar-row .gantt-select-check.checked");
    if (selected.length === 0) return;
    const ok = await showConfirm(`${selected.length}件のタスクを削除しますか？`);
    if (!ok) return;
    const ids = new Set([...selected].map((s) => s.dataset.taskId));
    for (const p of state.projects) { p.tasks = p.tasks.filter((t) => !ids.has(t.id)); }
    saveData();
    render();
  });

  // Task form submit
  document.getElementById("taskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("taskId").value;
    const type = document.getElementById("taskType").value;
    const parentId = document.getElementById("taskParentId").value;
    const projectId = document.getElementById("taskProject").value;

    if (type === "subtask" || parentId) {
      // Save subtask
      const name = document.getElementById("taskName").value.trim();
      const status = document.getElementById("taskStatus").value;
      const dueDate = document.getElementById("taskDue").value;

      if (id) {
        // Edit existing subtask
        const found = findTask(id);
        if (found && found.parent) {
          found.task.name = name;
          found.task.status = status;
          found.task.dueDate = dueDate;
        }
      } else {
        // New subtask
        const parentFound = findTask(parentId);
        if (parentFound) {
          const parent = parentFound.parent ? parentFound.parent : parentFound.task;
          parent.subtasks.push({ id: genId(), name, status, dueDate });
        }
      }
    } else {
      // Save task
      const recType = document.getElementById("taskRecurrence").value;
      const recurrence = recType === "none" ? { type: "none" } : {
        type: recType,
        interval: parseInt(document.getElementById("recurrenceInterval").value) || 1,
        endType: document.getElementById("recurrenceEndType").value,
        endCount: parseInt(document.getElementById("recurrenceCount").value) || 5,
        endDate: document.getElementById("recurrenceUntil").value,
      };

      const taskData = {
        name: document.getElementById("taskName").value.trim(),
        urgency: parseInt(document.getElementById("taskUrgency").value) || 3,
        importance: parseInt(document.getElementById("taskImportance").value) || 3,
        status: document.getElementById("taskStatus").value,
        startDate: document.getElementById("taskStart").value,
        dueDate: document.getElementById("taskDue").value,
        estimate: parseFloat(document.getElementById("taskEstimate").value) || 0,
        progress: parseInt(document.getElementById("taskProgress").value) || 0,
        memo: document.getElementById("taskMemo").value.trim(),
        recurrence,
      };

      if (id) {
        // Edit existing
        const found = findTask(id);
        if (found && !found.parent) {
          const oldGroupId = found.task.recurrenceGroupId;

          // Check if project changed
          if (found.project.id !== projectId) {
            // Remove old instances from old project
            if (oldGroupId) {
              found.project.tasks = found.project.tasks.filter(
                (t) => t.recurrenceGroupId !== oldGroupId || t.id === id
              );
            }
            found.project.tasks = found.project.tasks.filter((t) => t.id !== id);
            const newProj = findProject(projectId);
            if (newProj) {
              const baseTask = { ...found.task, ...taskData, subtasks: found.task.subtasks };
              if (recurrence.type !== "none") {
                baseTask.recurrenceGroupId = baseTask.recurrenceGroupId || genId();
                baseTask.recurrenceIndex = 1;
              } else {
                delete baseTask.recurrenceGroupId;
                delete baseTask.recurrenceIndex;
              }
              newProj.tasks.push(baseTask);
              if (recurrence.type !== "none") {
                regenerateRecurrence(baseTask, newProj);
              }
            }
          } else {
            Object.assign(found.task, taskData);
            // Handle recurrence changes
            if (recurrence.type !== "none") {
              found.task.recurrenceGroupId = found.task.recurrenceGroupId || genId();
              found.task.recurrenceIndex = 1;
              regenerateRecurrence(found.task, found.project);
            } else if (oldGroupId) {
              // Recurrence removed — delete old instances
              found.project.tasks = found.project.tasks.filter(
                (t) => t.recurrenceGroupId !== oldGroupId || t.id === id
              );
              delete found.task.recurrenceGroupId;
              delete found.task.recurrenceIndex;
            }
          }
        }
      } else {
        // New task
        const project = findProject(projectId);
        if (project) {
          const newTask = { id: genId(), ...taskData, subtasks: [] };
          if (recurrence.type !== "none") {
            newTask.recurrenceGroupId = genId();
            newTask.recurrenceIndex = 1;
          }
          project.tasks.push(newTask);
          if (recurrence.type !== "none") {
            const instances = generateRecurrenceTasks(newTask);
            project.tasks.push(...instances);
          }
        }
      }
    }

    // Also add inbox items from modal textarea
    const inboxAddInput = document.getElementById("inboxAddInput");
    if (inboxAddInput.value.trim()) {
      addInboxLines(inboxAddInput.value);
      inboxAddInput.value = "";
    }

    // Remove inbox item that was assigned to this task
    if (pendingInboxAssignId) {
      const idx = state.inbox.findIndex(item => item.id === pendingInboxAssignId);
      if (idx !== -1) state.inbox.splice(idx, 1);
      pendingInboxAssignId = null;
    }

    saveData();
    closeModal(document.getElementById("taskModal"));
    render();
  });

  // Task delete
  document.getElementById("deleteTaskBtn").addEventListener("click", async () => {
    const id = document.getElementById("taskId").value;
    if (!id) return;

    const found = findTask(id);
    const hasGroup = found && !found.parent && found.task.recurrenceGroupId;

    if (hasGroup) {
      const ok = await showConfirm("この繰り返しタスクを全て削除しますか？（このタスクと全ての繰り返し回を削除）");
      if (!ok) return;
      const groupId = found.task.recurrenceGroupId;
      for (const p of state.projects) {
        p.tasks = p.tasks.filter((t) => t.recurrenceGroupId !== groupId);
      }
    } else {
      const ok = await showConfirm("このタスクを削除しますか？");
      if (!ok) return;
      for (const p of state.projects) {
        p.tasks = p.tasks.filter((t) => {
          t.subtasks = t.subtasks.filter((st) => st.id !== id);
          return t.id !== id;
        });
      }
    }

    saveData();
    closeModal(document.getElementById("taskModal"));
    render();
  });

  // Add subtask from modal
  document.getElementById("addSubtaskBtn").addEventListener("click", () => {
    const parentId = document.getElementById("taskId").value;
    const projectId = document.getElementById("taskProject").value;
    closeModal(document.getElementById("taskModal"));

    // Open fresh modal for subtask
    const modal = document.getElementById("taskModal");
    const form = document.getElementById("taskForm");
    form.reset();
    document.getElementById("taskId").value = "";
    document.getElementById("taskParentId").value = parentId;
    document.getElementById("taskProjectId").value = projectId;
    document.getElementById("taskType").value = "subtask";
    document.getElementById("modalTitle").textContent = "サブタスク追加";
    document.getElementById("deleteTaskBtn").hidden = true;
    document.getElementById("addSubtaskBtn").hidden = true;
    document.getElementById("progressValue").textContent = "0";

    const projSelect = document.getElementById("taskProject");
    projSelect.innerHTML = state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    projSelect.value = projectId;

    modal.classList.add("open");
    document.getElementById("taskName").focus();
  });

  // Task modal close
  document.getElementById("modalClose").addEventListener("click", () => closeModal(document.getElementById("taskModal")));
  document.getElementById("taskModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("taskModal")) closeModal(document.getElementById("taskModal"));
  });

  // Project form submit
  document.getElementById("projectForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("projectId").value;
    const name = document.getElementById("projectName").value.trim();
    const description = document.getElementById("projectDesc").value.trim();
    const color = getSelectedColor();

    if (id) {
      const p = findProject(id);
      if (p) {
        p.name = name;
        p.description = description;
        p.color = color;
      }
    } else {
      state.projects.push({ id: genId(), name, color, description, tasks: [] });
    }

    saveData();
    closeModal(document.getElementById("projectModal"));
    render();
  });

  // Project delete
  document.getElementById("deleteProjectBtn").addEventListener("click", async () => {
    const id = document.getElementById("projectId").value;
    if (!id) return;
    const p = findProject(id);
    if (!p) return;
    const taskCount = p.tasks.length;
    const ok = await showConfirm(`「${p.name}」を削除しますか？（${taskCount}件のタスクも削除されます）`);
    if (!ok) return;

    state.projects = state.projects.filter((p) => p.id !== id);
    if (state.selectedProjectId === id) state.selectedProjectId = null;
    saveData();
    closeModal(document.getElementById("projectModal"));
    render();
  });

  // Project modal close
  document.getElementById("projectModalClose").addEventListener("click", () => closeModal(document.getElementById("projectModal")));
  document.getElementById("projectModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("projectModal")) closeModal(document.getElementById("projectModal"));
  });

  // Color picker
  document.getElementById("colorPicker").addEventListener("click", (e) => {
    const swatch = e.target.closest(".color-swatch");
    if (!swatch) return;
    document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
    swatch.classList.add("active");
  });

  // Progress slider
  document.getElementById("taskProgress").addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    document.getElementById("progressValue").textContent = val;
    updateProgressButtons(val);
  });

  // Urgency/Importance → Priority score
  document.getElementById("taskUrgency").addEventListener("change", updatePriorityScore);
  document.getElementById("taskImportance").addEventListener("change", updatePriorityScore);


  // Progress buttons
  document.getElementById("progressButtons").addEventListener("click", (e) => {
    const btn = e.target.closest(".progress-btn");
    if (!btn) return;
    const val = parseInt(btn.dataset.value);
    document.getElementById("taskProgress").value = val;
    document.getElementById("progressValue").textContent = val;
    updateProgressButtons(val);
  });

  // Filters
  document.getElementById("filterPriority").addEventListener("change", render);

  // Calendar sync - all tasks
  document.getElementById("syncCalendarBtn").addEventListener("click", async () => {
    const btn = document.getElementById("syncCalendarBtn");
    const status = document.getElementById("syncStatus");
    btn.classList.add("syncing");
    btn.textContent = "同期中...";
    status.textContent = "";
    status.className = "sync-status";

    try {
      const results = await syncAllToCalendar(state.projects);
      status.textContent = `✓ ${results.success}件同期 / ${results.skipped}件スキップ(日付なし)`;
      status.className = "sync-status success";
    } catch (e) {
      status.textContent = `✗ エラー: ${e.message}`;
      status.className = "sync-status error";
    }

    btn.classList.remove("syncing");
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>カレンダーに同期`;
  });

  // Calendar sync - single task from modal
  document.getElementById("syncTaskBtn").addEventListener("click", async () => {
    const taskId = document.getElementById("taskId").value;
    if (!taskId) return;
    const found = findTask(taskId);
    if (!found || found.parent) return;

    const btn = document.getElementById("syncTaskBtn");
    btn.textContent = "同期中...";

    const res = await syncTaskToCalendar(found.task, found.project.name, found.project.color);
    if (res.success) {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> 同期済み`;
      btn.classList.add("synced");
    } else {
      btn.textContent = `エラー: ${res.reason}`;
    }
  });

  // Sync Now (force pull from Firebase)
  document.getElementById("syncNowBtn").addEventListener("click", async () => {
    const btn = document.getElementById("syncNowBtn");
    btn.disabled = true;
    btn.textContent = "反映中...";
    try {
      if (typeof forceSync === "function") {
        await forceSync();
      }
    } catch (e) {
      console.warn("Sync error:", e);
    }
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> 反映`;
  });

  // Backup (download JSON)
  document.getElementById("backupBtn").addEventListener("click", () => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taskflow_backup_${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modals = ["confirmDialog", "taskModal", "projectModal"];
      for (const id of modals) {
        const m = document.getElementById(id);
        if (m.classList.contains("open")) { m.classList.remove("open"); break; }
      }
    }
  });

  render();
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// === Hamburger Menu ===
function initHamburger() {
  const btn = document.getElementById("hamburgerBtn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  btn.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    overlay.classList.toggle("open", isOpen);
  });

  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  });

  // Close sidebar when a nav button is clicked (mobile)
  sidebar.querySelectorAll(".nav-btn").forEach(navBtn => {
    navBtn.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove("open");
        overlay.classList.remove("open");
      }
    });
  });
}

// Start
document.addEventListener("DOMContentLoaded", async () => {
  init();
  initInbox();
  initHamburger();
  if (typeof initFirebaseSync === "function") initFirebaseSync();
});
