"use strict";

const $ = (sel) => document.querySelector(sel);

const REFRESH_MS = 5000;

const ui = {
  stats: {
    sessions: $("#st-sessions"),
    jobs: $("#st-jobs"),
    dags: $("#st-dags"),
    running: $("#st-running"),
    retired: $("#st-retired"),
    aborted: $("#st-aborted"),
    orphaned: $("#st-orphaned"),
  },
  dagList: $("#dag-list"),
  dagsNote: $("#dags-note"),
  viewTitle: $("#view-title"),
  jobsBody: $("#jobs-body"),
  jobsTable: $("#jobs-table"),
  runsBody: $("#runs-body"),
  runsTable: $("#runs-table"),
  chartBlock: $("#chart-block"),
  durChart: $("#dur-chart"),
  filterNote: $("#jobs-filter-note"),
  detail: $("#detail"),
  backdrop: $("#backdrop"),
  dTitle: $("#d-title"),
  dSub: $("#d-sub"),
  dReceipt: $("#d-receipt"),
  dReport: $("#d-report"),
  dReportTable: $("#d-report-table"),
  dReportRows: $("#d-report-rows"),
  dEvents: $("#d-events"),
  dEvCount: $("#d-ev-count"),
  dClose: $("#d-close"),
  gMeta: $("#g-meta"),
  graphView: $("#graph-view"),
  sMeta: $("#s-meta"),
  sourceView: $("#source-view"),
  toast: $("#toast"),
  runForm: $("#run-form"),
  runFolder: $("#run-folder"),
  runBtn: $("#run-btn"),
  clock: $("#clock"),
};

const state = {
  jobs: [],
  dags: [],
  group: null, // groupKey string or null = all
  filter: null,
  selected: null, // { sid, jid }
  activeTab: "overview",
  graphCache: {}, // key -> shape
  sourceCache: {}, // key -> source
  toastTimer: null,
};

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  let body = {};
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const msg = body.stderr?.join("\n") || body.reason || body.error || res.statusText;
    const err = new Error(msg);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

function fmtTs(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtShortTs(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function humanAge(ms) {
  if (ms == null || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function jobAge(job) {
  const start = new Date(job.created).getTime();
  const end = job.finished ? new Date(job.finished).getTime() : Date.now();
  return humanAge(end - start);
}

function runElapsed(r) {
  const start = new Date(r.created).getTime();
  const end = r.finished ? new Date(r.finished).getTime() : Date.now();
  return Math.max(end - start, 0);
}

function showToast(text, kind) {
  ui.toast.textContent = text;
  ui.toast.className = `toast ${kind || ""}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 6000);
}

/* ---------------- stats ---------------- */

function renderStats(summary) {
  ui.stats.sessions.textContent = summary.sessionsTotal ?? "–";
  ui.stats.jobs.textContent = summary.jobsTotal ?? "–";
  ui.stats.dags.textContent = summary.dagsTotal ?? "–";
  const by = summary.jobsByState || {};
  ui.stats.running.textContent = by.running ?? 0;
  ui.stats.retired.textContent = by.retired ?? 0;
  ui.stats.aborted.textContent = by.aborted ?? 0;
  ui.stats.orphaned.textContent = by.orphaned ?? 0;
  renderStatsActive();
}

function renderStatsActive() {
  document.querySelectorAll(".stat.chipable").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === state.filter);
  });
}

/* ---------------- dags sidebar ---------------- */

function groupKey(g) {
  return g.project_name === "-" ? "ungrouped" : `${g.project || g.project_name}/${g.dag_id}`;
}

function groupLabel(g) {
  return g.project_name === "-" ? "(ungrouped)" : g.project_name;
}

function currentGroup() {
  if (!state.group) return null;
  return state.dags.find((g) => groupKey(g) === state.group) || null;
}

function renderDags() {
  const total = state.dags.reduce((n, g) => n + g.runs.length, 0);
  ui.dagsNote.textContent = `${state.dags.length} group${state.dags.length === 1 ? "" : "s"}`;
  const allActive = state.group === null ? " active" : "";
  let html =
    `<button class="dag-item all${allActive}" data-group="">` +
    `<span class="dag-main"><span class="dag-name">all runs</span></span>` +
    `<span class="dag-count">${total}</span></button>`;
  html += state.dags.map((g) => {
    const ungrouped = g.project_name === "-";
    const active = state.group === groupKey(g) ? " active" : "";
    const versions = g.versions.length > 1
      ? `<span class="dag-versions">${g.versions.map((v) =>
          `<span class="vchip" title="content_hash ${esc(v)}">${esc(v.slice(0, 7))}</span>`
        ).join("")}</span>`
      : "";
    const sub = ungrouped ? "" : `<span class="dag-id">${esc(g.dag_id)}</span>`;
    return `<button class="dag-item${ungrouped ? " ungrouped" : ""}${active}" data-group="${esc(groupKey(g))}" title="${esc(g.source || "no source folder")}">
      <span class="dag-main"><span class="dag-name">${esc(groupLabel(g))}</span>${sub}</span>
      <span class="dag-count">${g.runs.length}</span>
      ${versions}
    </button>`;
  }).join("");
  ui.dagList.innerHTML = html;
}

/* ---------------- group view: chart + runs table ---------------- */

function chip(kind, label) {
  return `<span class="chip ${esc(kind)}">${esc(label)}</span>`;
}

function labelChips(labels) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return `<span class="muted">–</span>`;
  return entries.map(([k, v]) =>
    `<span class="chip label" title="${esc(k)}=${esc(v)}">${esc(k)}=${esc(v)}</span>`
  ).join(" ");
}

function renderDurChart(runs) {
  const rows = runs.map((r) => {
    const running = r.state === "running" && r.durationMs == null;
    const ms = running ? runElapsed(r) : r.durationMs;
    return { r, running, ms: ms ?? 0 };
  });
  const max = Math.max(...rows.map((x) => x.ms), 1);
  ui.durChart.innerHTML = rows.map(({ r, running, ms }) => {
    const pct = Math.max((ms / max) * 100, 1.5);
    const val = running ? `${humanAge(ms)} so far` : humanAge(ms);
    return `<div class="dur-row" data-sid="${esc(r.sid)}" data-jid="${esc(r.jid)}" title="${esc(r.sid)}/${esc(r.jid)}">
      <span class="dur-label mono">${esc(r.jid)}</span>
      <div class="dur-track"><div class="dur-bar ${esc(r.state)}${running ? " striped" : ""}" style="width:${pct}%"></div></div>
      <span class="dur-val mono">${esc(val)}</span>
    </div>`;
  }).join("");
}

function renderGroupView(g) {
  const runs = state.filter ? g.runs.filter((r) => r.state === state.filter) : g.runs;
  ui.viewTitle.textContent = `${groupLabel(g)} · runs`;
  ui.runsTable.classList.remove("hidden");
  ui.jobsTable.classList.add("hidden");
  ui.chartBlock.classList.remove("hidden");
  ui.filterNote.textContent =
    `${runs.length} run${runs.length === 1 ? "" : "s"} · newest first` +
    (state.filter ? ` · state = ${state.filter}` : "");
  renderDurChart(g.runs);
  if (!runs.length) {
    ui.runsBody.innerHTML = `<tr><td colspan="6" class="empty">no runs${state.filter ? ` in state ${esc(state.filter)}` : ""}</td></tr>`;
    return;
  }
  const sel = state.selected;
  ui.runsBody.innerHTML = runs.map((r) => {
    const running = r.state === "running" && r.durationMs == null;
    const dur = running ? `${humanAge(runElapsed(r))} so far` : (r.durationMs != null ? humanAge(r.durationMs) : "–");
    const selected = sel && sel.sid === r.sid && sel.jid === r.jid ? " selected" : "";
    return `<tr data-sid="${esc(r.sid)}" data-jid="${esc(r.jid)}" class="${selected.trim()}">
      <td>${chip(r.state, r.state)}</td>
      <td><span class="wf">${esc(r.sid)}/${esc(r.jid)}</span></td>
      <td class="labels-cell">${labelChips(r.labels)}</td>
      <td class="age-cell" title="${esc(r.workflow)}">${esc(fmtShortTs(r.created))}</td>
      <td class="age-cell">${esc(r.finished ? fmtShortTs(r.finished) : "–")}</td>
      <td class="num age-cell">${esc(dur)}</td>
    </tr>`;
  }).join("");
}

function renderAllView() {
  const jobs = state.filter ? state.jobs.filter((j) => j.state === state.filter) : state.jobs;
  ui.viewTitle.textContent = "Jobs";
  ui.runsTable.classList.add("hidden");
  ui.jobsTable.classList.remove("hidden");
  ui.chartBlock.classList.add("hidden");
  ui.filterNote.textContent = state.filter
    ? `filtered by state = ${state.filter} (${jobs.length})`
    : `${jobs.length} jobs · newest first`;
  if (!jobs.length) {
    ui.jobsBody.innerHTML = `<tr><td colspan="6" class="empty">no jobs</td></tr>`;
    return;
  }
  ui.jobsBody.innerHTML = jobs.map((j) => {
    const dead = j.panes?.dead ?? 0;
    const total = j.panes?.total ?? 0;
    const sel = state.selected && state.selected.jid === j.id && state.selected.sid === j.sid
      ? " selected" : "";
    const task = j.task || "–";
    return `<tr data-sid="${esc(j.sid)}" data-jid="${esc(j.id)}" class="${sel.trim()}">
      <td>${chip(j.state, j.state)}</td>
      <td><span class="wf">${esc(j.workflow)}</span></td>
      <td class="task-cell" title="${esc(task)}">${esc(task)}</td>
      <td class="num panes-cell"><span class="dead">${dead}</span>/<span class="alive">${total}</span></td>
      <td>${chip(j.outcome, j.outcome)}</td>
      <td class="num age-cell" title="created ${esc(fmtTs(j.created))}">${esc(jobAge(j))}</td>
    </tr>`;
  }).join("");
}

function renderView() {
  const g = currentGroup();
  if (g) renderGroupView(g);
  else renderAllView();
}

/* ---------------- detail drawer: tabs ---------------- */

function activateTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".d-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  ["overview", "graph", "source"].forEach((t) => {
    $(`#tab-${t}`).classList.toggle("hidden", t !== name);
  });
  if (name === "graph") loadGraph();
  if (name === "source") loadSource();
}

function detailKey() {
  return state.selected ? `${state.selected.sid}/${state.selected.jid}` : null;
}

/* ---------------- graph tab ---------------- */

function layoutGraph(shape) {
  const BW = 150, BH = 50, VGAP = 58, HGAP = 28;
  const nodes = shape.nodes || [];
  const edges = shape.edges || [];
  const level = {};
  nodes.forEach((n) => { level[n.id] = 0; });
  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    edges.forEach((e) => {
      if (level[e.to] != null && level[e.from] != null && level[e.to] < level[e.from] + 1) {
        level[e.to] = level[e.from] + 1;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const byLevel = {};
  nodes.forEach((n) => { (byLevel[level[n.id]] ||= []).push(n); });
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  const maxRow = Math.max(...levels.map((lv) => byLevel[lv].length), 1);
  const width = maxRow * BW + (maxRow - 1) * HGAP + HGAP * 2;
  const height = levels.length * BH + (levels.length - 1) * VGAP + VGAP;
  const pos = {};
  levels.forEach((lv) => {
    const row = byLevel[lv];
    const rowW = row.length * BW + (row.length - 1) * HGAP;
    const x0 = (width - rowW) / 2;
    row.forEach((n, i) => { pos[n.id] = { x: x0 + i * (BW + HGAP), y: VGAP / 2 + lv * (BH + VGAP) }; });
  });
  return { BW, BH, width, height, pos, edges };
}

function renderGraph(shape) {
  ui.gMeta.textContent = `kind: ${shape.kind}${shape.dagName ? ` · ${shape.dagName}` : ""}`;
  if (!shape.nodes || !shape.nodes.length) {
    ui.graphView.innerHTML = `<div class="empty">no dag shape for this run (kind: ${esc(shape.kind)})</div>`;
    return;
  }
  const { BW, BH, width, height, pos, edges } = layoutGraph(shape);
  const lines = edges
    .filter((e) => pos[e.from] && pos[e.to])
    .map((e) => {
      const a = pos[e.from], b = pos[e.to];
      return `<line x1="${a.x + BW / 2}" y1="${a.y + BH}" x2="${b.x + BW / 2}" y2="${b.y}" marker-end="url(#g-arrow)" />`;
    }).join("");
  const boxes = (shape.nodes || []).map((n) => {
    const p = pos[n.id];
    return `<div class="g-node" style="left:${p.x}px;top:${p.y}px">
      <div class="g-id">${esc(n.id)}</div>
      <div class="g-does">${esc(n.does || "")}</div>
    </div>`;
  }).join("");
  ui.graphView.innerHTML =
    `<svg class="g-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f9cf9"></path>
        </marker>
      </defs>
      ${lines}
    </svg>
    <div class="g-canvas" style="width:${width}px;height:${height}px">${boxes}</div>`;
}

async function loadGraph() {
  if (!state.selected) {
    ui.graphView.innerHTML = `<div class="empty">open a job to see its dag</div>`;
    return;
  }
  const key = detailKey();
  ui.gMeta.textContent = "";
  if (state.graphCache[key]) { renderGraph(state.graphCache[key]); return; }
  ui.graphView.innerHTML = `<div class="empty">loading…</div>`;
  const { sid, jid } = state.selected;
  try {
    const shape = await fetchJSON(`/api/dag-shape/${encodeURIComponent(sid)}/${encodeURIComponent(jid)}`);
    if (detailKey() !== key) return;
    state.graphCache[key] = shape;
    renderGraph(shape);
  } catch (err) {
    if (detailKey() === key) ui.graphView.innerHTML = `<div class="empty">no dag shape: ${esc(err.message)}</div>`;
  }
}

/* ---------------- source tab ---------------- */

function renderSource(data) {
  ui.sMeta.textContent = `${data.files.length} file${data.files.length === 1 ? "" : "s"}`;
  const missing = (data.hooks || []).filter((h) => !h.found);
  const files = (data.files || []).map((f, i) => {
    const cut = f.truncated
      ? `<div class="src-cut">… truncated at 4000 chars — full file at ${esc(f.path)}</div>`
      : "";
    return `<details class="src-file"${i === 0 ? " open" : ""}>
      <summary><span class="src-name">${esc(f.name)}</span><span class="src-path mono">${esc(f.path)}</span></summary>
      <pre class="src-text mono">${esc(f.text)}</pre>${cut}
    </details>`;
  }).join("");
  const missingRows = missing.length
    ? `<div class="src-missing">
        ${missing.map((h) => `<div class="src-missing-row" title="${esc(h.path)}">
          <span class="chip aborted">missing</span>
          <span class="mono">hook ${esc(h.key)}</span>
          <span class="src-path mono">${esc(h.path)}</span>
        </div>`).join("")}
      </div>`
    : "";
  const dirRow = data.runDir
    ? `<div class="src-dir mono" title="run dir">${esc(data.runDir)}</div>` : "";
  ui.sourceView.innerHTML =
    dirRow + (files || `<div class="empty">no source files</div>`) + missingRows;
}

async function loadSource() {
  if (!state.selected) {
    ui.sourceView.innerHTML = `<div class="empty">open a job to see its source</div>`;
    return;
  }
  const key = detailKey();
  ui.sMeta.textContent = "";
  if (state.sourceCache[key]) { renderSource(state.sourceCache[key]); return; }
  ui.sourceView.innerHTML = `<div class="empty">loading…</div>`;
  const { sid, jid } = state.selected;
  try {
    const data = await fetchJSON(`/api/source/${encodeURIComponent(sid)}/${encodeURIComponent(jid)}`);
    if (detailKey() !== key) return;
    state.sourceCache[key] = data;
    renderSource(data);
  } catch (err) {
    if (detailKey() === key) ui.sourceView.innerHTML = `<div class="empty">no source: ${esc(err.message)}</div>`;
  }
}

/* ---------------- detail drawer ---------------- */

function kvRow(k, v, cls) {
  return `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ""}>${v}</dd>`;
}

function renderDetail(job, report, events) {
  ui.dTitle.innerHTML = `${esc(job.id)} ${chip(job.state, job.state)}`;
  const dagBits = job.dag
    ? `${job.dag.project_name === "-" ? "(ungrouped)" : job.dag.project_name} · ${job.dag.dag_id} · ${esc(job.dag.content_hash || "")}`
    : "";
  ui.dSub.textContent = `${job.workflow} · sid ${job.sid}${dagBits ? ` · ${dagBits}` : ""}`;

  const meta =
    kvRow("task", esc(job.task || "–")) +
    kvRow("stood up by", esc(job.stoodUpBy || "–")) +
    kvRow("pid", esc(job.pid ?? "–")) +
    kvRow("created", esc(fmtTs(job.created))) +
    kvRow("finished", esc(fmtTs(job.finished))) +
    kvRow("duration", esc(job.durationMs != null ? humanAge(job.durationMs) : (job.state === "running" ? `${humanAge(runElapsed(job))} so far` : "–"))) +
    (job.dag
      ? kvRow("dag", `${esc(job.dag.project_name === "-" ? "(ungrouped)" : job.dag.project_name)} / ${esc(job.dag.dag_id)}`) +
        kvRow("content hash", esc(job.dag.content_hash || "–"))
      : "") +
    kvRow("panes", `<span class="bad">${job.panes?.dead ?? 0}</span> dead / ${job.panes?.total ?? 0} total`) +
    kvRow("dir", esc(job.dir || "–"));

  let receipt = "";
  if (job.receipt) {
    const r = job.receipt;
    receipt =
      kvRow("status", esc(r.status || "–"), r.status === "ok" ? "ok" : "warn") +
      kvRow("panes", `${r.panesRemaining} remaining / ${r.panesTotal} total`) +
      kvRow("units", `<span class="ok">${r.unitsDone ?? 0} done</span> · <span class="bad">${r.unitsFailed ?? 0} failed</span>`) +
      kvRow("report", esc(r.report || "–")) +
      kvRow("finished", esc(fmtTs(r.finished)));
  } else if (job.abort) {
    receipt = kvRow("aborted", esc(job.abort.reason || "–"), "bad") +
      kvRow("panes remaining", esc(job.abort.panesRemaining ?? "–")) +
      kvRow("finished", esc(fmtTs(job.abort.finished)));
  } else if (job.orphan) {
    receipt = kvRow("orphaned", esc(job.orphan.reason || "–"), "warn") +
      kvRow("at", esc(fmtTs(job.orphan.at)));
  } else {
    receipt = kvRow("status", "no receipt yet — job is in flight", "warn");
  }
  ui.dReceipt.innerHTML = `<dl class="kv">${meta}${receipt}</dl>`;

  if (report) {
    ui.dReport.innerHTML =
      kvRow("kind", esc(report.kind || "–")) +
      kvRow("status", esc(report.status || "–"), report.status === "ok" ? "ok" : "warn") +
      kvRow("where", esc(report.where || "–")) +
      kvRow("counts", esc(JSON.stringify(report.counts ?? {})));
    const table = report.table || [];
    if (table.length) {
      ui.dReportTable.classList.remove("hidden");
      ui.dReportRows.innerHTML = table.map((row) =>
        `<tr><td>${esc(row.unit)}</td><td class="${
          String(row.result).startsWith("ok") ? "ok" : "bad"
        }">${esc(row.result)}</td></tr>`).join("");
    } else {
      ui.dReportTable.classList.add("hidden");
    }
  } else {
    ui.dReport.innerHTML = kvRow("report", job.hasReport ? "parsing…" : "none yet", "muted");
    ui.dReportTable.classList.add("hidden");
  }

  renderEvents(events);
}

function renderEvents(events) {
  const el = ui.dEvents;
  const nearBottom =
    el.scrollTop + el.clientHeight >= el.scrollHeight - 40 || el.scrollHeight === 0;
  el.innerHTML = (events || []).map((ev) => {
    const extraBits = [];
    if (ev.jid) extraBits.push(ev.jid);
    if (ev.label) extraBits.push(ev.label);
    else if (ev.pane) extraBits.push(ev.pane);
    if (ev.workflow) extraBits.push(ev.workflow);
    const kindClass = `k-${ev.kind}`;
    return `<div class="ev-line"><span class="ev-ts">${esc(fmtShortTs(ev.ts))}</span>  ` +
      `<span class="ev-kind ${esc(kindClass)}">${esc(ev.kind)}</span>  ` +
      `<span class="ev-extra">${esc(ev.actor || "")}${extraBits.length ? " · " + esc(extraBits.join(" · ")) : ""}</span></div>`;
  }).join("");
  ui.dEvCount.textContent = events ? `(${events.length})` : "";
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function openDetail(sid, jid) {
  state.selected = { sid, jid };
  ui.detail.classList.remove("hidden");
  ui.detail.setAttribute("aria-hidden", "false");
  ui.backdrop.classList.remove("hidden");
  activateTab("overview");
  refreshDetail();
  renderView();
}

function closeDetail() {
  state.selected = null;
  ui.detail.classList.add("hidden");
  ui.detail.setAttribute("aria-hidden", "true");
  ui.backdrop.classList.add("hidden");
  renderView();
}

async function refreshDetail() {
  if (!state.selected) return;
  const { sid, jid } = state.selected;
  try {
    const [jobRes, evRes] = await Promise.all([
      fetchJSON(`/api/job/${encodeURIComponent(sid)}/${encodeURIComponent(jid)}`),
      fetchJSON(`/api/events/${encodeURIComponent(sid)}`),
    ]);
    if (!state.selected || state.selected.jid !== jid) return;
    renderDetail(jobRes.job, jobRes.report, evRes.events);
  } catch (err) {
    showToast(`detail fetch failed: ${err.message}`, "err");
  }
}

/* ---------------- polling ---------------- */

async function refresh() {
  try {
    const [summary, jobsRes, dagsRes] = await Promise.all([
      fetchJSON("/api/summary"),
      fetchJSON("/api/jobs"),
      fetchJSON("/api/dags"),
    ]);
    state.jobs = jobsRes.jobs || [];
    state.dags = dagsRes.dags || [];
    if (state.group && !currentGroup()) state.group = null;
    renderStats(summary);
    renderDags();
    renderView();
    if (state.selected) refreshDetail();
  } catch (err) {
    showToast(`refresh failed: ${err.message}`, "err");
  }
}

/* ---------------- run box ---------------- */

async function handleRun(e) {
  e.preventDefault();
  const folder = ui.runFolder.value.trim();
  if (!folder) {
    showToast("enter an absolute folder path containing workflow.toml", "err");
    return;
  }
  ui.runBtn.disabled = true;
  ui.runBtn.textContent = "…";
  try {
    const res = await fetchJSON("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    const jobLine = (res.lines || []).find((l) => l.startsWith("job:")) || "";
    showToast([`run ok (exit ${res.exitCode ?? 0})`, ...(res.lines || [jobLine])]
      .filter(Boolean).join("\n"), "ok");
    await refresh();
  } catch (err) {
    showToast(`run refused:\n${err.message}`, "err");
  } finally {
    ui.runBtn.disabled = false;
    ui.runBtn.textContent = "Run";
  }
}

/* ---------------- wiring ---------------- */

ui.dagList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-group]");
  if (!item) return;
  state.group = item.dataset.group || null;
  renderDags();
  renderView();
});

function rowClick(e) {
  const tr = e.target.closest("tr[data-jid]");
  if (!tr) return;
  openDetail(tr.dataset.sid, tr.dataset.jid);
}
ui.jobsBody.addEventListener("click", rowClick);
ui.runsBody.addEventListener("click", rowClick);

document.querySelectorAll(".stat.chipable").forEach((el) => {
  el.addEventListener("click", () => {
    const f = el.dataset.filter;
    state.filter = state.filter === f ? null : f;
    renderView();
    renderStatsActive();
  });
});

document.querySelectorAll(".d-tab").forEach((b) => {
  b.addEventListener("click", () => activateTab(b.dataset.tab));
});

ui.dClose.addEventListener("click", closeDetail);
ui.backdrop.addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
});
ui.runForm.addEventListener("submit", handleRun);

ui.clock.textContent = new Date().toLocaleTimeString();
setInterval(() => {
  ui.clock.textContent = new Date().toLocaleTimeString();
}, 1000);

refresh();
setInterval(refresh, REFRESH_MS);
