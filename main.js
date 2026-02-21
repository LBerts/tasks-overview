'use strict';

var obsidian = require('obsidian');

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_TYPE = "tasks-overview";

const PRIORITY_ORDER = ["highest", "high", "medium", "normal", "low", "lowest"];
const PRIORITY_META = {
  highest: { label: "🔺 Highest", color: "#ef4444" },
  high:    { label: "⏫ High",    color: "#f97316" },
  medium:  { label: "🔼 Medium",  color: "#eab308" },
  normal:  { label: "Normal",     color: "" },
  low:     { label: "🔽 Low",     color: "#64748b" },
  lowest:  { label: "⏬ Lowest",  color: "#94a3b8" },
};

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseTask(line, filePath, lineNumber) {
  const match = line.match(/^(\s*[-*]\s+\[([ xX])\]\s+)(.+)$/);
  if (!match) return null;

  const completed = match[2].toLowerCase() === "x";
  const raw = match[3];

  const dueM     = raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  const doneM    = raw.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
  const recurM   = raw.match(/🔁\s*([^📅⏳🛫✅➕🔺⏫🔼🔽⏬\n]+)/);
  const tags     = raw.match(/#[\w/]+/g) || [];

  let priority = "normal";
  if (/🔺/.test(raw)) priority = "highest";
  else if (/⏫/.test(raw)) priority = "high";
  else if (/🔼/.test(raw)) priority = "medium";
  else if (/🔽/.test(raw)) priority = "low";
  else if (/⏬/.test(raw)) priority = "lowest";

  const text = raw
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/⏳\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/🛫\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/➕\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/🔁\s*[^📅⏳🛫✅➕🔺⏫🔼🔽⏬\n]*/g, "")
    .replace(/[🔺⏫🔼🔽⏬]/g, "")
    .trim();

  const fileName = filePath.split("/").pop().replace(/\.md$/, "");

  return {
    rawLine: line.trim(),
    text, completed, priority,
    dueDate:    dueM   ? dueM[1]   : null,
    doneDate:   doneM  ? doneM[1]  : null,
    recurrence: recurM ? recurM[1].trim() : null,
    filePath, fileName, lineNumber, tags,
  };
}

function dueDateStatus(d) {
  if (!d) return "none";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(d + "T00:00:00");
  const diff = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "soon";
  return "future";
}

function fmtDate(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(d + "T00:00:00");
  const diff = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return due.toLocaleDateString("en", { weekday: "short" });
  return due.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function applySort(tasks, sortBy, sortDir) {
  const dir = sortDir === "desc" ? -1 : 1;
  return [...tasks].sort((a, b) => {
    if (sortBy === "alpha") return dir * a.text.localeCompare(b.text);
    if (sortBy === "priority") {
      const ai = PRIORITY_ORDER.indexOf(a.priority);
      const bi = PRIORITY_ORDER.indexOf(b.priority);
      return dir * (ai - bi);
    }
    return 0;
  });
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

class CreateTaskModal extends obsidian.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    this.titleEl.setText("New task");
    const { contentEl } = this;

    // Description
    const descField = contentEl.createDiv("tb-modal-field");
    descField.createEl("label", { text: "Description", cls: "tb-modal-label" });
    const descInput = descField.createEl("textarea", {
      cls: "tb-modal-textarea",
      placeholder: "What needs to be done?",
    });
    descInput.rows = 2;
    setTimeout(() => descInput.focus(), 50);

    // Priority + Due date row
    const row = contentEl.createDiv("tb-modal-row");

    const priField = row.createDiv("tb-modal-field");
    priField.createEl("label", { text: "Priority", cls: "tb-modal-label" });
    const priSelect = priField.createEl("select", { cls: "tb-modal-select" });
    for (const [value, label] of [
      ["", "Normal"], ["🔺", "🔺 Highest"], ["⏫", "⏫ High"],
      ["🔼", "🔼 Medium"], ["🔽", "🔽 Low"], ["⏬", "⏬ Lowest"],
    ]) priSelect.createEl("option", { value, text: label });

    const dueField = row.createDiv("tb-modal-field");
    dueField.createEl("label", { text: "Due date", cls: "tb-modal-label" });
    const dueInput = dueField.createEl("input", { cls: "tb-modal-input", type: "date" });

    // Note picker
    const noteField = contentEl.createDiv("tb-modal-field");
    noteField.createEl("label", { text: "Save to note", cls: "tb-modal-label" });
    const noteSelect = noteField.createEl("select", { cls: "tb-modal-select" });
    const files = this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
      noteSelect.createEl("option", { value: file.path, text: file.path.replace(/\.md$/, "") });
    }

    // Buttons
    const btns = contentEl.createDiv("tb-modal-btns");
    const cancelBtn = btns.createEl("button", { text: "Cancel", cls: "tb-modal-btn-cancel" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = btns.createEl("button", { text: "Create task", cls: "tb-modal-btn-save" });
    const doSubmit = () => {
      const desc = descInput.value.trim();
      if (!desc) { descInput.addClass("tb-modal-error"); descInput.focus(); return; }
      const today = new Date().toISOString().split("T")[0];
      let line = `- [ ] ${desc}`;
      if (priSelect.value) line += ` ${priSelect.value}`;
      if (dueInput.value) line += ` 📅 ${dueInput.value}`;
      line += ` ➕ ${today}`;
      this.onSubmit(noteSelect.value, line);
      this.close();
    };
    saveBtn.onclick = doSubmit;
    descInput.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doSubmit(); });
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const STYLES = `
.tb-root { display:flex; flex-direction:column; height:100%; background:var(--background-primary); font-family:var(--font-interface); }

/* Every control row follows the same pattern: label + controls */
.tb-row {
  display:flex; align-items:center; gap:8px;
  padding:5px 12px 6px;
  border-bottom:1px solid var(--background-modifier-border);
  flex-shrink:0;
}
.tb-row-label {
  font-size:11px; font-weight:600; color:var(--text-faint);
  text-transform:uppercase; letter-spacing:.04em;
  white-space:nowrap; width:52px; flex-shrink:0;
}
/* First row (no-label) has a bit more top padding */
.tb-row-first { padding-top:9px; padding-bottom:9px; }

/* Pill buttons — used in every row */
.tb-pill {
  padding:3px 10px; border:none; border-radius:10px;
  font-size:12px; font-family:var(--font-interface);
  color:var(--text-muted); background:var(--background-secondary);
  cursor:pointer; transition:all .15s; white-space:nowrap;
}
.tb-pill:hover { color:var(--text-normal); background:var(--background-modifier-hover); }
.tb-pill.active { background:var(--interactive-accent); color:#fff; }

/* Direction toggle (small, accent) */
.tb-dir { background:none; border:none; font-size:13px; color:var(--interactive-accent); cursor:pointer; padding:1px 4px; border-radius:4px; transition:background .15s; margin-left:2px; }
.tb-dir:hover { background:var(--background-modifier-hover); }

/* New task button */
.tb-new-btn {
  display:flex; align-items:center; gap:5px;
  background:var(--interactive-accent); border:none; color:#fff;
  cursor:pointer; padding:4px 11px 4px 8px;
  border-radius:7px; font-family:var(--font-interface); transition:opacity .15s;
}
.tb-new-btn:hover { opacity:.85; }
.tb-new-btn-plus { font-size:18px; font-weight:300; line-height:1; }
.tb-new-btn-text { font-size:12px; font-weight:500; }

/* Done toggle */
.tb-done-label {
  display:flex; align-items:center; gap:5px;
  font-size:12px; color:var(--text-muted);
  cursor:pointer; user-select:none; margin-left:auto;
}
.tb-done-label input { accent-color:var(--interactive-accent); cursor:pointer; }

/* Spacer pushes done toggle to right */
.tb-spacer { flex:1; }

/* Board */
.tb-board { flex:1; overflow-y:auto; padding:8px 10px 16px; display:flex; flex-direction:column; gap:2px; }
.tb-empty { text-align:center; color:var(--text-faint); font-size:13px; margin-top:48px; }

/* Group */
.tb-group { margin-bottom:6px; }
.tb-group-header { display:flex; align-items:center; gap:6px; padding:10px 8px 3px; }
.tb-group-title {
  font-size:11px; font-weight:700; color:var(--text-muted);
  text-transform:uppercase; letter-spacing:.05em;
  flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.tb-group-title.clickable { cursor:pointer; }
.tb-group-title.clickable:hover { color:var(--interactive-accent); }
.tb-group-count {
  font-size:11px; color:var(--text-faint);
  background:var(--background-secondary);
  border-radius:10px; padding:1px 8px; min-width:22px; text-align:center;
}

/* Card */
.tb-card {
  display:flex; align-items:flex-start; gap:8px;
  padding:7px 8px 7px 10px; border-radius:8px;
  background:var(--background-secondary);
  position:relative; overflow:hidden;
  transition:background .12s;
}
.tb-card:hover { background:var(--background-modifier-hover); }
.tb-card.done { opacity:.38; }
.tb-priority-bar { position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:8px 0 0 8px; }

/* Checkbox */
.tb-check {
  width:16px; height:16px; min-width:16px; border-radius:4px;
  border:1.5px solid var(--background-modifier-border-focus);
  background:var(--background-primary);
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  font-size:10px; color:#fff; padding:0; margin-top:2px;
  transition:all .12s; flex-shrink:0;
}
.tb-check:hover { border-color:var(--interactive-accent); }
.tb-check.done { background:var(--interactive-accent); border-color:var(--interactive-accent); }

/* Card body */
.tb-card-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.tb-card-text { font-size:13px; line-height:1.4; color:var(--text-normal); word-break:break-word; }
.tb-card.done .tb-card-text { text-decoration:line-through; color:var(--text-muted); }
.tb-card-meta { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }

/* Due date chip */
.tb-chip { font-size:11px; padding:1px 7px; border-radius:10px; font-weight:500; }
.tb-chip-overdue { background:rgba(239,68,68,.15); color:#f87171; }
.tb-chip-today   { background:rgba(251,191,36,.15); color:#fbbf24; }
.tb-chip-soon    { background:rgba(52,211,153,.12); color:#34d399; }
.tb-chip-future  { background:var(--background-modifier-border); color:var(--text-muted); }

.tb-recur { font-size:11px; color:var(--text-faint); }
.tb-tag   { font-size:11px; color:var(--text-faint); }

/* Card action buttons — appear on hover */
.tb-card-actions { display:flex; gap:1px; opacity:0; transition:opacity .12s; align-self:center; flex-shrink:0; }
.tb-card:hover .tb-card-actions { opacity:1; }
.tb-card-btn {
  background:none; border:none; color:var(--text-faint);
  cursor:pointer; font-size:13px; padding:3px 5px;
  border-radius:5px; line-height:1;
  transition:color .12s, background .12s;
}
.tb-card-btn:hover { color:var(--interactive-accent); background:var(--background-modifier-hover); }

/* ── Create Task Modal ── */
.tb-modal-field { margin-bottom:12px; }
.tb-modal-label { display:block; font-size:12px; color:var(--text-muted); margin-bottom:5px; }
.tb-modal-row { display:flex; gap:12px; }
.tb-modal-row .tb-modal-field { flex:1; }
.tb-modal-textarea {
  width:100%; box-sizing:border-box; resize:vertical;
  font-family:var(--font-interface); font-size:14px;
  padding:8px 10px; border-radius:6px;
  border:1px solid var(--background-modifier-border);
  background:var(--background-secondary); color:var(--text-normal);
}
.tb-modal-textarea:focus, .tb-modal-input:focus, .tb-modal-select:focus {
  outline:none; border-color:var(--interactive-accent);
}
.tb-modal-textarea.error { border-color:#f87171; }
.tb-modal-input, .tb-modal-select {
  width:100%; box-sizing:border-box; padding:6px 8px; border-radius:6px;
  border:1px solid var(--background-modifier-border);
  background:var(--background-secondary); color:var(--text-normal);
  font-family:var(--font-interface); font-size:13px; cursor:pointer;
}
.tb-modal-btns { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
.tb-modal-btn-cancel {
  padding:7px 16px; border:1px solid var(--background-modifier-border);
  background:transparent; border-radius:6px; color:var(--text-muted);
  cursor:pointer; font-family:var(--font-interface); font-size:13px;
}
.tb-modal-btn-cancel:hover { color:var(--text-normal); background:var(--background-modifier-hover); }
.tb-modal-btn-save {
  padding:7px 16px; border:none; background:var(--interactive-accent);
  border-radius:6px; color:#fff; cursor:pointer;
  font-family:var(--font-interface); font-size:13px; font-weight:500;
}
.tb-modal-btn-save:hover { opacity:.85; }
`;

// ─── View ─────────────────────────────────────────────────────────────────────

class TasksBoardView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tasks = [];
    // View mode
    this.mode = "duedate";
    // Filters
    this.filterThisMonth = false;
    this.filterThisYear  = false;
    this.filterNoDate    = false;
    this.showDone        = false;
    // Sort
    this.sortBy  = "alpha";
    this.sortDir = "asc";
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return "Tasks Overview"; }
  getIcon()        { return "check-square-2"; }

  async onOpen()  { await this.loadTasks(); this.render(); }
  async onClose() { this.contentEl.empty(); }
  async refresh() { await this.loadTasks(); this.render(); }

  async loadTasks() {
    const tasks = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      content.split("\n").forEach((line, i) => {
        const t = parseTask(line, file.path, i);
        if (t) tasks.push(t);
      });
    }
    this.tasks = tasks;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("tb-root");
    this.renderTopRow(el);
    this.renderViewRow(el);
    this.renderFilterRow(el);
    this.renderSortRow(el);
    this.renderBoard(el);
  }

  // Row 0: New task + Show done (no label — full-width controls)
  renderTopRow(root) {
    const row = root.createDiv("tb-row tb-row-first");

    const newBtn = row.createEl("button", { cls: "tb-new-btn", title: "Create new task (Cmd+P → Create new task)" });
    newBtn.createSpan({ cls: "tb-new-btn-plus", text: "+" });
    newBtn.createSpan({ cls: "tb-new-btn-text", text: "New task" });
    newBtn.onclick = () => this.openCreateModal();

    row.createDiv("tb-spacer");

    const doneLabel = row.createEl("label", { cls: "tb-done-label" });
    const doneCheck = doneLabel.createEl("input", { type: "checkbox" });
    doneCheck.checked = this.showDone;
    doneLabel.createSpan({ text: "Show done" });
    doneLabel.onclick = e => {
      e.stopPropagation();
      this.showDone = doneCheck.checked;
      this.render();
    };
  }

  // Row 1: View — Due Date / Priority / Page
  renderViewRow(root) {
    const row = root.createDiv("tb-row");
    row.createSpan({ cls: "tb-row-label", text: "View" });
    for (const { mode, label } of [
      { mode: "duedate",  label: "Due Date" },
      { mode: "priority", label: "Priority" },
      { mode: "page",     label: "Page" },
    ]) {
      const btn = row.createEl("button", { cls: "tb-pill", text: label });
      if (mode === this.mode) btn.addClass("active");
      btn.onclick = () => { this.mode = mode; this.render(); };
    }
  }

  // Row 2: Due date — This month / This year / No date
  renderFilterRow(root) {
    const row = root.createDiv("tb-row");
    row.createSpan({ cls: "tb-row-label", text: "Due date" });

    for (const { key, label } of [
      { key: "thisMonth", label: "This month" },
      { key: "thisYear",  label: "This year" },
      { key: "noDate",    label: "No date" },
    ]) {
      const active = this[key === "thisMonth" ? "filterThisMonth" : key === "thisYear" ? "filterThisYear" : "filterNoDate"];
      const btn = row.createEl("button", { cls: "tb-pill", text: label });
      if (active) btn.addClass("active");
      btn.onclick = () => {
        if (key === "thisMonth") this.filterThisMonth = !this.filterThisMonth;
        else if (key === "thisYear") this.filterThisYear = !this.filterThisYear;
        else this.filterNoDate = !this.filterNoDate;
        this.render();
      };
    }
  }

  // Row 3: Sort — A–Z / Priority + direction arrow
  renderSortRow(root) {
    const row = root.createDiv("tb-row");
    row.createSpan({ cls: "tb-row-label", text: "Sort" });

    for (const { key, label } of [
      { key: "alpha",    label: "A–Z" },
      { key: "priority", label: "Priority" },
    ]) {
      const btn = row.createEl("button", { cls: "tb-pill", text: label });
      if (key === this.sortBy) btn.addClass("active");
      btn.onclick = () => {
        if (this.sortBy === key) this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        else { this.sortBy = key; this.sortDir = "asc"; }
        this.render();
      };
    }

    const dirBtn = row.createEl("button", {
      cls: "tb-dir",
      text: this.sortDir === "asc" ? "↑" : "↓",
      title: "Toggle direction",
    });
    dirBtn.onclick = () => { this.sortDir = this.sortDir === "asc" ? "desc" : "asc"; this.render(); };
  }

  // ── Board ────────────────────────────────────────────────────────────────────

  renderBoard(root) {
    const board = root.createDiv("tb-board");

    // 1. Filter by done
    let tasks = this.showDone ? this.tasks : this.tasks.filter(t => !t.completed);

    // 2. Filter by due date (OR logic)
    if (this.filterThisMonth || this.filterThisYear || this.filterNoDate) {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      tasks = tasks.filter(t => {
        if (this.filterNoDate && !t.dueDate) return true;
        if (t.dueDate) {
          const d = new Date(t.dueDate + "T00:00:00");
          if (this.filterThisMonth && d.getFullYear() === y && d.getMonth() === m) return true;
          if (this.filterThisYear  && d.getFullYear() === y) return true;
        }
        return false;
      });
    }

    // 3. Sort
    tasks = applySort(tasks, this.sortBy, this.sortDir);

    // 4. Render by mode
    if (this.mode === "duedate")       this.renderByDueDate(board, tasks);
    else if (this.mode === "priority") this.renderByPriority(board, tasks);
    else                               this.renderByPage(board, tasks);
  }

  renderByDueDate(board, tasks) {
    const buckets = {
      overdue: { label: "🔴 Overdue",   tasks: [] },
      today:   { label: "🟡 Today",     tasks: [] },
      soon:    { label: "🟢 This week", tasks: [] },
      future:  { label: "📅 Later",     tasks: [] },
      none:    { label: "—  No date",   tasks: [] },
    };
    for (const t of tasks) buckets[dueDateStatus(t.dueDate)].tasks.push(t);
    let any = false;
    for (const { label, tasks: g } of Object.values(buckets)) {
      if (g.length) { this.renderGroup(board, label, g); any = true; }
    }
    if (!any) board.createDiv({ cls: "tb-empty", text: "No tasks found" });
  }

  renderByPriority(board, tasks) {
    let any = false;
    for (const key of PRIORITY_ORDER) {
      const g = tasks.filter(t => t.priority === key);
      if (g.length) { this.renderGroup(board, PRIORITY_META[key].label, g); any = true; }
    }
    if (!any) board.createDiv({ cls: "tb-empty", text: "No tasks found" });
  }

  renderByPage(board, tasks) {
    const map = new Map();
    for (const t of tasks) {
      if (!map.has(t.filePath)) map.set(t.filePath, []);
      map.get(t.filePath).push(t);
    }
    const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (!sorted.length) { board.createDiv({ cls: "tb-empty", text: "No tasks found" }); return; }
    for (const [filePath, g] of sorted) this.renderGroup(board, g[0].fileName, g, filePath);
  }

  renderGroup(board, label, tasks, filePath) {
    const group = board.createDiv("tb-group");
    const hdr = group.createDiv("tb-group-header");
    const title = hdr.createSpan({ cls: "tb-group-title", text: label });
    if (filePath) {
      title.addClass("clickable");
      title.onclick = () => this.openFile(filePath, 0);
    }
    const pending = tasks.filter(t => !t.completed).length;
    hdr.createSpan({ cls: "tb-group-count", text: String(pending) });
    for (const task of tasks) this.renderCard(group, task);
  }

  renderCard(parent, task) {
    const card = parent.createDiv("tb-card");
    if (task.completed) card.addClass("done");

    // Priority accent bar
    const color = PRIORITY_META[task.priority]?.color;
    if (color) {
      const bar = card.createDiv("tb-priority-bar");
      bar.style.background = color;
    }

    // Checkbox
    const check = card.createEl("button", { cls: "tb-check" });
    if (task.completed) { check.addClass("done"); check.textContent = "✓"; }
    check.onclick = () => this.toggleTask(task);

    // Body
    const body = card.createDiv("tb-card-body");
    body.createSpan({ cls: "tb-card-text", text: task.text });

    const meta = body.createDiv("tb-card-meta");
    if (task.dueDate) {
      const status = dueDateStatus(task.dueDate);
      meta.createSpan({ cls: `tb-chip tb-chip-${status}`, text: fmtDate(task.dueDate) });
    }
    if (task.recurrence) meta.createSpan({ cls: "tb-recur", text: `↻ ${task.recurrence}`, title: "Recurring" });
    for (const tag of task.tags) meta.createSpan({ cls: "tb-tag", text: tag });

    // Action buttons
    const actions = card.createDiv("tb-card-actions");
    const editBtn = actions.createEl("button", { cls: "tb-card-btn", text: "✎", title: "Edit task" });
    editBtn.onclick = e => { e.stopPropagation(); this.editTask(task); };
    const openBtn = actions.createEl("button", { cls: "tb-card-btn", text: "↗", title: `Open in ${task.fileName}` });
    openBtn.onclick = e => { e.stopPropagation(); this.openFile(task.filePath, task.lineNumber); };
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async toggleTask(task) {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!file) return;
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    if (!lines[task.lineNumber]) return;
    const today = new Date().toISOString().split("T")[0];
    lines[task.lineNumber] = task.completed
      ? lines[task.lineNumber].replace(/\[x\]/i, "[ ]").replace(/✅\s*\d{4}-\d{2}-\d{2}/g, "").trimEnd()
      : lines[task.lineNumber].replace(/\[ \]/, "[x]") + ` ✅ ${today}`;
    await this.app.vault.modify(file, lines.join("\n"));
    await this.refresh();
  }

  async editTask(task) {
    const tasksPlugin = this.app.plugins.plugins["obsidian-tasks-plugin"];

    // Best path: use editTaskLineModal (Tasks >= 7.21.0) — passes full raw line
    if (tasksPlugin?.apiV1?.editTaskLineModal) {
      const newLine = await tasksPlugin.apiV1.editTaskLineModal(task.rawLine);
      if (!newLine) return; // cancelled
      const file = this.app.vault.getAbstractFileByPath(task.filePath);
      if (!file) return;
      const content = await this.app.vault.read(file);
      const lines = content.split("\n");
      lines[task.lineNumber] = newLine;
      await this.app.vault.modify(file, lines.join("\n"));
      await this.refresh();
      return;
    }

    // Fallback: open file at line
    await this.openFile(task.filePath, task.lineNumber);
  }

  async openFile(filePath, lineNumber) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (view?.editor) {
      view.editor.setCursor({ line: lineNumber, ch: 0 });
      view.editor.scrollIntoView({ from: { line: lineNumber, ch: 0 }, to: { line: lineNumber, ch: 0 } }, true);
    }
  }

  openCreateModal() {
    new CreateTaskModal(this.app, async (filePath, taskLine) => {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file) return;
      const content = await this.app.vault.read(file);
      const sep = content.endsWith("\n") ? "" : "\n";
      await this.app.vault.modify(file, content + sep + taskLine + "\n");
      await this.refresh();
    }).open();
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class TasksBoardPlugin extends obsidian.Plugin {
  async onload() {
    const style = document.createElement("style");
    style.id = "tasks-overview-styles";
    style.textContent = STYLES;
    document.head.appendChild(style);
    this.register(() => style.remove());

    this.registerView(VIEW_TYPE, leaf => new TasksBoardView(leaf, this));
    this.addRibbonIcon("check-square-2", "Tasks Overview", () => this.activateView());

    this.addCommand({ id: "open-tasks-overview", name: "Open Tasks Overview",
      callback: () => this.activateView() });

    this.addCommand({ id: "create-task", name: "Create new task",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (leaves.length) { leaves[0].view.openCreateModal(); return; }
        this.activateView().then(() => {
          setTimeout(() => {
            const l = this.app.workspace.getLeavesOfType(VIEW_TYPE);
            if (l.length) l[0].view.openCreateModal();
          }, 300);
        });
      }
    });

    const refresh = () => this.refreshViews();
    this.registerEvent(this.app.vault.on("modify", refresh));
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) { await leaf.setViewState({ type: VIEW_TYPE, active: true }); this.app.workspace.revealLeaf(leaf); }
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))
      leaf.view.refresh();
  }
}

module.exports = TasksBoardPlugin;
