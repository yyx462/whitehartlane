"use strict";

const REFRESH_MS = 5000;
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const enc = encodeURIComponent;

const viewEl = $("#view");
const toastEl = $("#toast");
const clockEl = $("#clock");

const DAG_TABS = ["runs", "shape", "source", "config"];
const RUN_TABS = ["overview", "shape", "source"];

const state = {
  route: null,
  summary: null,
  allJobs: [],
  allRunsFilter: null,
  dags: [],
  dagsSort: { sort: "last", order: "desc" },
  dag: null,
  run: null,
  toastTimer: null,
};

let ticking = false;

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  let body = {};
  try { body = await res.json(); } catch { /* empty body */ }
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

function createdElapsed(created) {
  return Math.max(Date.now() - new Date(created).getTime(), 0);
}

function showToast(text, kind) {
  toastEl.textContent = text;
  toastEl.className = `toast ${kind || ""}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 6000);
}

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

function paneEmpty(s) {
  return `<div class="empty">${s}</div>`;
}

function emptyRow(cols, s) {
  return `<tr><td colspan="${cols}" class="empty">${s}</td></tr>`;
}

function kvRow(k, v, cls) {
  return `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ""}>${v}</dd>`;
}

/* ---------------- routing ---------------- */

function runsHref(sid, jid, tab) {
  return `#/runs/${enc(sid)}/${enc(jid)}${tab ? `/${tab}` : ""}`;
}

function dagHref(pid, dagId, tab) {
  return `#/dags/${enc(pid)}/${enc(dagId)}${tab ? `/${tab}` : ""}`;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").map(decodeURIComponent);
  if (parts[0] === "runs" && parts.length >= 3 && parts[1] && parts[2]) {
    return { view: "run", sid: parts[1], jid: parts[2], tab: RUN_TABS.includes(parts[3]) ? parts[3] : "overview" };
  }
  if (parts[0] === "dags" && parts.length >= 3 && parts[1] && parts[2]) {
    return { view: "dag", pid: parts[1], dagId: parts[2], tab: DAG_TABS.includes(parts[3]) ? parts[3] : "runs" };
  }
  if (parts[0] === "dags") return { view: "dags" };
  return { view: "runs" };
}

function updateNav(r) {
  const navKey = r.view === "run" ? "runs" : r.view === "dag" ? "dags" : r.view;
  $$(".mainnav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === navKey));
}

function onRoute() {
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", "#/runs");
  }
  const r = parseRoute();
  const prev = state.route;
  state.route = r;
  updateNav(r);
  if (prev && prev.view === "dag" && r.view === "dag" && state.dag &&
      prev.pid === r.pid && prev.dagId === r.dagId) {
    const changed = state.dag.tab !== r.tab;
    state.dag.tab = r.tab;
    renderDagTabs();
    if (changed) enterDagTab();
    return;
  }
  state.dag = null;
  if (prev && prev.view === "run" && r.view === "run" && state.run &&
      prev.sid === r.sid && prev.jid === r.jid) {
    const changed = state.run.tab !== r.tab;
    state.run.tab = r.tab;
    renderRunTabs();
    if (changed) enterRunTab();
    return;
  }
  state.run = null;
  const mounts = { runs: mountRuns, dags: mountDags, dag: mountDag, run: mountRun };
  (mounts[r.view] || mountRuns)(r);
  tick();
}

function dagHere(d, tab) {
  const r = state.route;
  return !!r && r.view === "dag" && r.pid === d.pid && r.dagId === d.dagId &&
    (r.tab || "runs") === tab && state.dag === d;
}

function runHere(rn, tab) {
  const r = state.route;
  return !!r && r.view === "run" && r.sid === rn.sid && r.jid === rn.jid &&
    (r.tab || "overview") === tab && state.run === rn;
}

function isUngroupedDag(d) {
  return d.pid === "-" || d.dagId === "(ungrouped)";
}

function findGroup(pid, dagId) {
  return state.dags.find((g) => (g.project || "-") === pid && g.dag_id === dagId) || null;
}

function dagsUrl() {
  return `/api/dags?sort=${state.dagsSort.sort}&order=${state.dagsSort.order}`;
}

/* ---------------- view: all runs ---------------- */

function statCard(filter, label, id, dot) {
  return `<button class="stat${filter ? " chipable" : ""}"${filter ? ` data-filter="${filter}"` : ""}>
    <span class="stat-label">${dot ? `<i class="dot ${dot}"></i>` : ""}${label}</span>
    <span class="stat-value" id="${id}">–</span>
  </button>`;
}

function mountRuns() {
  state.allJobs = [];
  viewEl.innerHTML = `
    <section class="stats" id="ar-stats">
      ${statCard("", "sessions", "ar-sessions")}
      ${statCard("", "jobs", "ar-jobs")}
      ${statCard("", "dags", "ar-dags")}
      ${statCard("running", "running", "ar-running", "running")}
      ${statCard("retired", "retired", "ar-retired", "retired")}
      ${statCard("aborted", "aborted", "ar-aborted", "aborted")}
      ${statCard("orphaned", "orphaned", "ar-orphaned", "orphaned")}
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>All runs</h2>
        <span id="ar-note" class="muted small"></span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>state</th>
              <th>run</th>
              <th>workflow</th>
              <th>task</th>
              <th class="num">panes</th>
              <th>outcome</th>
              <th class="num">age</th>
            </tr>
          </thead>
          <tbody id="ar-body"><tr><td colspan="7" class="empty">loading…</td></tr></tbody>
        </table>
      </div>
    </section>`;
  $$("#ar-stats .stat.chipable").forEach((el) => {
    el.addEventListener("click", () => {
      const f = el.dataset.filter;
      state.allRunsFilter = state.allRunsFilter === f ? null : f;
      renderRunsView();
    });
  });
  renderRunsView();
}

function renderRunsView() {
  if (!$("#ar-stats")) return;
  const s = state.summary;
  const by = (s && s.jobsByState) || {};
  $("#ar-sessions").textContent = s ? (s.sessionsTotal ?? "–") : "–";
  $("#ar-jobs").textContent = s ? (s.jobsTotal ?? "–") : "–";
  $("#ar-dags").textContent = s ? (s.dagsTotal ?? "–") : "–";
  $("#ar-running").textContent = by.running ?? 0;
  $("#ar-retired").textContent = by.retired ?? 0;
  $("#ar-aborted").textContent = by.aborted ?? 0;
  $("#ar-orphaned").textContent = by.orphaned ?? 0;
  $$("#ar-stats .stat.chipable").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === state.allRunsFilter);
  });
  const jobs = state.allRunsFilter
    ? state.allJobs.filter((j) => j.state === state.allRunsFilter)
    : state.allJobs;
  $("#ar-note").textContent = state.allRunsFilter
    ? `filtered by state = ${state.allRunsFilter} (${jobs.length})`
    : `${jobs.length} jobs · newest first`;
  const body = $("#ar-body");
  if (!jobs.length) {
    body.innerHTML = emptyRow(7, state.allRunsFilter ? `no jobs in state ${esc(state.allRunsFilter)}` : "no jobs");
    return;
  }
  body.innerHTML = jobs.map((j) => {
    const dead = j.panes?.dead ?? 0;
    const total = j.panes?.total ?? 0;
    return `<tr data-href="${runsHref(j.sid, j.id)}">
      <td>${chip(j.state, j.state)}</td>
      <td><span class="wf">${esc(j.sid)}/${esc(j.id)}</span></td>
      <td>${esc(j.workflow)}</td>
      <td class="task-cell" title="${esc(j.task || "")}">${esc(j.task || "–")}</td>
      <td class="num panes-cell"><span class="dead">${dead}</span>/<span class="alive">${total}</span></td>
      <td>${chip(j.outcome, j.outcome)}</td>
      <td class="num age-cell" title="created ${esc(fmtTs(j.created))}">${esc(jobAge(j))}</td>
    </tr>`;
  }).join("");
}

/* ---------------- view: dag list ---------------- */

function mountDags() {
  viewEl.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>DAGs</h2>
        <span id="dl-note" class="muted small"></span>
        <div class="sortbar">
          <span class="sort-label">sort</span>
          <button class="sort-btn" data-dsort="last">last run</button>
          <button class="sort-btn" data-dsort="runs">runs</button>
          <button class="sort-btn" data-dsort="created">created</button>
          <button class="sort-btn" id="dl-dir" title="toggle order">↓ desc</button>
        </div>
      </div>
      <div class="dagtable" id="dl-rows"><div class="empty">loading…</div></div>
    </section>`;
  $$("[data-dsort]").forEach((b) => {
    b.addEventListener("click", () => {
      const s = b.dataset.dsort;
      if (state.dagsSort.sort === s) {
        state.dagsSort.order = state.dagsSort.order === "desc" ? "asc" : "desc";
      } else {
        state.dagsSort = { sort: s, order: "desc" };
      }
      tick();
    });
  });
  $("#dl-dir").addEventListener("click", () => {
    state.dagsSort.order = state.dagsSort.order === "desc" ? "asc" : "desc";
    tick();
  });
  renderDagsView();
}

function renderDagsView() {
  if (!$("#dl-rows")) return;
  const { sort, order } = state.dagsSort;
  $$("[data-dsort]").forEach((b) => b.classList.toggle("active", b.dataset.dsort === sort));
  const dirBtn = $("#dl-dir");
  dirBtn.textContent = order === "desc" ? "↓ desc" : "↑ asc";
  $("#dl-note").textContent =
    `${state.dags.length} dag group${state.dags.length === 1 ? "" : "s"} · ${sort} ${order}`;
  const rowsEl = $("#dl-rows");
  if (!state.dags.length) {
    rowsEl.innerHTML = paneEmpty("no dags yet");
    return;
  }
  rowsEl.innerHTML = state.dags.map((g) => {
    const ungrouped = g.project_name === "-";
    const pid = g.project || "-";
    const href = dagHref(pid, g.dag_id);
    const last = g.lastRun || null;
    const lastDur = last
      ? (last.durationMs != null
        ? humanAge(last.durationMs)
        : last.state === "running" ? `${humanAge(createdElapsed(last.created))} so far` : "–")
      : "–";
    const versions = (g.versions || []).length > 1
      ? g.versions.map((v) => `<span class="vchip" title="content_hash ${esc(v)}">${esc(v.slice(0, 7))}</span>`).join("")
      : "";
    return `<div class="dagrow${ungrouped ? " ungrouped" : ""}" data-href="${href}">
      <span class="dr-name-wrap"><a class="dr-name" href="${href}">${esc(ungrouped ? "(ungrouped)" : g.project_name)}</a></span>
      <span class="dr-id mono" title="dag_id">${esc(g.dag_id)}</span>
      <span class="dr-count mono" title="runs">${g.runCount ?? (g.runs || []).length}</span>
      <span class="dr-state">${last ? chip(last.state, last.state) : `<span class="muted">–</span>`}</span>
      <span class="dr-dur mono">${esc(lastDur)}</span>
      <span class="dr-vers">${versions}</span>
      ${ungrouped
        ? `<span></span>`
        : `<button class="dr-trig" data-trig data-pid="${esc(pid)}" data-dag="${esc(g.dag_id)}" title="Trigger run (runs the saved source)">▶</button>`}
    </div>`;
  }).join("");
}

/* ---------------- view: dag page ---------------- */

function mountDag(r) {
  state.dag = {
    pid: r.pid,
    dagId: r.dagId,
    tab: r.tab,
    group: findGroup(r.pid, r.dagId),
    runsSort: { key: "time", dir: "desc" },
    groupJobs: null,
    runsError: null,
    shape: null,
    shapeKey: null,
    shapeError: null,
    shapeFetching: false,
    source: null,
    sourceKey: null,
    sourceError: null,
    program: null,
  };
  viewEl.innerHTML = `
    <div class="crumbs"><a href="#/dags">DAGs</a><span class="crumb-sep">/</span><span class="mono">${esc(r.pid)}</span></div>
    <section class="pagehead panel" id="dag-head"></section>
    <nav class="ptabs" id="dag-tabs"></nav>
    <div id="dag-pane"><div class="empty">loading…</div></div>`;
  renderDagTabs();
  renderDagHead();
  enterDagTab();
}

function renderDagTabs() {
  const d = state.dag;
  if (!$("#dag-tabs")) return;
  const tabs = isUngroupedDag(d) ? DAG_TABS.filter((t) => t !== "config") : DAG_TABS;
  $("#dag-tabs").innerHTML = tabs.map((t) =>
    `<a class="ptab${t === d.tab ? " active" : ""}" href="${dagHref(d.pid, d.dagId, t)}">${t}</a>`
  ).join("");
}

function renderDagHead() {
  const d = state.dag;
  const head = $("#dag-head");
  if (!head) return;
  const g = d.group;
  const ungrouped = isUngroupedDag(d);
  const name = ungrouped ? "(ungrouped)" : (g ? g.project_name : "…");
  const last = g && g.lastRun;
  const labels = (g && g.runs && g.runs[0] && g.runs[0].labels) || {};
  head.innerHTML = `
    <div class="ph-main">
      <div class="ph-title">
        <h2>${esc(name)}</h2>
        <span class="ph-id mono">${esc(d.dagId)}</span>
        ${last ? chip(last.state, last.state) : ""}
      </div>
      <div class="ph-sub mono small">pid <b>${esc(g ? (g.project || "–") : d.pid)}</b>${g && g.source ? ` · source <span class="src-line">${esc(g.source)}</span>` : ""}${last && last.durationMs != null ? ` · last ${esc(humanAge(last.durationMs))}` : (last && last.state === "running" ? ` · ${esc(humanAge(createdElapsed(last.created)))} so far` : "")}</div>
      ${Object.keys(labels).length ? `<div class="ph-labels">${labelChips(labels)}</div>` : ""}
    </div>
    ${ungrouped ? "" : `<div class="ph-actions"><button class="btn primary" data-trig data-pid="${esc(d.pid)}" data-dag="${esc(d.dagId)}" title="Run the door on the saved source folder">▶ Trigger run</button></div>`}`;
}

function enterDagTab() {
  const d = state.dag;
  if (d.tab === "runs") {
    renderRunsPane();
    if (!isUngroupedDag(d)) dagLoadRuns();
  } else if (d.tab === "shape") {
    renderDagShapePane();
  } else if (d.tab === "source") {
    renderDagSourcePane();
  } else if (d.tab === "config") {
    if (!d.program) loadProgram();
    else renderConfigPane();
  }
}

function sortRunsClient(runs, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  return runs.slice().sort((a, b) => {
    let c = 0;
    if (key === "state") {
      c = String(a.state).localeCompare(String(b.state));
    } else if (key === "duration") {
      if (a.durationMs == null && b.durationMs == null) c = 0;
      else if (a.durationMs == null) return 1;
      else if (b.durationMs == null) return -1;
      else c = a.durationMs - b.durationMs;
    } else {
      c = new Date(a.created).getTime() - new Date(b.created).getTime();
    }
    if (c === 0) c = new Date(b.created).getTime() - new Date(a.created).getTime();
    return c * mul;
  });
}

function barMs(r) {
  if (r.state === "running" && r.durationMs == null) return createdElapsed(r.created);
  return r.durationMs ?? 0;
}

function runRowHtml(r, maxMs) {
  const jid = r.jid || r.id;
  const sid = r.sid;
  const labels = r.labels || (r.dag && r.dag.labels) || {};
  const running = r.state === "running" && r.durationMs == null;
  const ms = running ? createdElapsed(r.created) : r.durationMs;
  const dur = ms != null ? (running ? `${humanAge(ms)} so far` : humanAge(ms)) : "–";
  const pct = ms != null ? Math.max((ms / maxMs) * 100, 1.5) : 0;
  return `<tr data-href="${runsHref(sid, jid)}">
    <td>${chip(r.state, r.state)}</td>
    <td><span class="wf">${esc(sid)}/${esc(jid)}</span></td>
    <td class="labels-cell">${labelChips(labels)}</td>
    <td class="age-cell" title="${esc(r.workflow || "")}">${esc(fmtShortTs(r.created))}</td>
    <td class="age-cell">${esc(r.finished ? fmtShortTs(r.finished) : "–")}</td>
    <td class="num"><div class="cellbar">
      ${ms != null ? `<div class="dur-track"><div class="dur-bar ${esc(r.state)}${running ? " striped" : ""}" style="width:${pct}%"></div></div>` : ""}
      <span class="dur-val mono">${esc(dur)}</span>
    </div></td>
  </tr>`;
}

function renderRunsPane() {
  const d = state.dag;
  const pane = $("#dag-pane");
  if (!pane) return;
  const ungrouped = isUngroupedDag(d);
  const runs = ungrouped
    ? (d.group ? sortRunsClient(d.group.runs || [], d.runsSort.key, d.runsSort.dir) : null)
    : d.groupJobs;
  const sort = d.runsSort;
  const notes = [];
  if (d.runsError) notes.push(`error: ${d.runsError}`);
  if (runs) notes.push(`${runs.length} run${runs.length === 1 ? "" : "s"}`);
  const maxMs = runs && runs.length ? Math.max(...runs.map(barMs), 1) : 1;
  pane.innerHTML = `
    <section class="panel">
      <div class="pane-toolbar">
        <span class="muted small">${esc(notes.join(" · ") || "loading…")}</span>
        <div class="sortbar">
          <span class="sort-label">sort</span>
          ${[["state", "state"], ["time", "time"], ["duration", "duration"]].map(([k, label]) =>
            `<button class="sort-btn${sort.key === k ? " active" : ""}" data-rsort="${k}">${label}</button>`).join("")}
          <button class="sort-btn" data-rdir>${sort.dir === "desc" ? "↓ desc" : "↑ asc"}</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>state</th>
              <th>run</th>
              <th>labels</th>
              <th>created</th>
              <th>finished</th>
              <th class="num">duration</th>
            </tr>
          </thead>
          <tbody>
            ${runs === null ? emptyRow(6, "loading…")
              : !runs.length ? emptyRow(6, "no runs yet — trigger one")
              : runs.map((r) => runRowHtml(r, maxMs)).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
  $$("[data-rsort]", pane).forEach((b) => {
    b.addEventListener("click", () => {
      d.runsSort.key = b.dataset.rsort;
      if (ungrouped) renderRunsPane();
      else dagLoadRuns();
    });
  });
  $("[data-rdir]", pane).addEventListener("click", () => {
    d.runsSort.dir = d.runsSort.dir === "desc" ? "asc" : "desc";
    if (ungrouped) renderRunsPane();
    else dagLoadRuns();
  });
}

async function dagLoadRuns() {
  const d = state.dag;
  if (isUngroupedDag(d)) {
    renderRunsPane();
    return;
  }
  const serverSort = d.runsSort.key === "time" ? "created" : d.runsSort.key;
  try {
    const res = await fetchJSON(`/api/jobs?group=${enc(d.pid)}/${enc(d.dagId)}&sort=${serverSort}&order=${d.runsSort.dir}`);
    d.groupJobs = res.jobs || [];
    d.runsError = null;
  } catch (err) {
    d.runsError = err.message;
    if (d.groupJobs == null) d.groupJobs = [];
  }
  if (dagHere(d, "runs")) renderRunsPane();
}

function dagLastRun() {
  return (state.dag.group && state.dag.group.lastRun) || null;
}

function renderDagShapePane() {
  const d = state.dag;
  const pane = $("#dag-pane");
  if (!pane) return;
  const last = dagLastRun();
  if (!last) {
    pane.innerHTML = paneEmpty(d.group ? "no runs yet — trigger one to see the shape" : "loading…");
    return;
  }
  shapePane(pane, d, last.sid, last.jid, last.state === "running", () => dagHere(d, "shape"));
}

function renderDagSourcePane() {
  const d = state.dag;
  const pane = $("#dag-pane");
  if (!pane) return;
  const last = dagLastRun();
  if (!last) {
    pane.innerHTML = paneEmpty(d.group ? "no runs yet" : "loading…");
    return;
  }
  sourcePane(pane, d, last.sid, last.jid, () => dagHere(d, "source"));
}

/* ---------------- shape + source (shared) ---------------- */

function layoutGraph(shape) {
  const BW = 170, BH = 54, VGAP = 64, HGAP = 32;
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
    row.forEach((n, i) => {
      pos[n.id] = { x: x0 + i * (BW + HGAP), y: VGAP / 2 + lv * (BH + VGAP) };
    });
  });
  return { BW, BH, width, height, pos };
}

function hookChipsHtml(hooks) {
  if (!hooks || !hooks.length) return "";
  const chips = hooks.map((h) =>
    `<span class="hchip ${esc(h.section || "hooks")}" title="${esc(h.section || "hooks")} · ${esc(h.command || "")}"><span class="hsec">${esc(h.section || "hook")}</span>${esc(h.name)}</span>`
  ).join("");
  return `<div class="hookchips">${chips}</div>`;
}

function drawShape(pane, shape, err) {
  if (err) {
    pane.innerHTML = paneEmpty(`no dag shape: ${esc(err)}`);
    return;
  }
  if (!shape) {
    pane.innerHTML = paneEmpty("no shape");
    return;
  }
  const meta = `kind: ${esc(shape.kind)}${shape.dagName ? ` · ${esc(shape.dagName)}` : ""}`;
  if (!shape.nodes || !shape.nodes.length) {
    pane.innerHTML = `<div class="shape-meta small muted">${meta}</div>` +
      paneEmpty(`no dag shape for this run (kind: ${esc(shape.kind)})`);
    return;
  }
  const { BW, BH, width, height, pos } = layoutGraph(shape);
  const edges = (shape.edges || []).filter((e) => pos[e.from] && pos[e.to]);
  const pairCount = {};
  edges.forEach((e) => {
    const k = [e.from, e.to].sort().join("|");
    pairCount[k] = (pairCount[k] || 0) + 1;
  });
  const paths = edges.map((e) => {
    const a = pos[e.from], b = pos[e.to];
    const ax = a.x + BW / 2, ay = a.y + BH;
    const bx = b.x + BW / 2, by = b.y;
    const k = [e.from, e.to].sort().join("|");
    const bow = pairCount[k] > 1 ? (e.from < e.to ? 1 : -1) * Math.max(30, BW * 0.2) : 0;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const cx = (ax + bx) / 2 + nx * bow;
    const cy = (ay + by) / 2 + ny * bow;
    const midx = 0.25 * ax + 0.5 * cx + 0.25 * bx;
    const midy = 0.25 * ay + 0.5 * cy + 0.25 * by;
    const msg = e.messages != null
      ? `<text class="edge-msg" x="${midx + nx * 11}" y="${midy + ny * 11 + 3}" text-anchor="middle"><title>${esc(e.from)} → ${esc(e.to)} · ${e.messages} relay message${e.messages === 1 ? "" : "s"}</title>×${e.messages}</text>`
      : "";
    return `<path d="M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}" marker-end="url(#g-arrow)"></path>${msg}`;
  }).join("");
  const boxes = (shape.nodes || []).map((n) => {
    const p = pos[n.id];
    return `<div class="g-node" style="left:${p.x}px;top:${p.y}px" title="${esc(n.does || n.id)}">
      <div class="g-id">${esc(n.id)}</div>
      ${n.does ? `<div class="g-does">${esc(n.does)}</div>` : ""}
    </div>`;
  }).join("");
  const hooks = shape.hooks || [];
  pane.innerHTML = `
    <div class="shape-meta small muted">${meta}${hooks.length ? ` · ${hooks.length} hook${hooks.length === 1 ? "" : "s"} <span title="hooks = side-effect · detectors = signal · gates = human-veto">(chips below)</span>` : ""}</div>
    <div class="graph-view">
      <svg class="g-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f9cf9"></path>
          </marker>
        </defs>
        ${paths}
      </svg>
      <div class="g-canvas" style="width:${width}px;height:${height}px">${boxes}</div>
    </div>
    ${hookChipsHtml(hooks)}`;
}

function shapePane(pane, cache, sid, jid, live, isCurrent) {
  const key = `${sid}/${jid}`;
  if (cache.shapeKey !== key) {
    cache.shapeKey = key;
    cache.shape = null;
    cache.shapeError = null;
  }
  const draw = () => drawShape(pane, cache.shape, cache.shapeError);
  if (!cache.shape && !cache.shapeError) {
    pane.innerHTML = paneEmpty("loading shape…");
    fetchJSON(`/api/dag-shape/${enc(sid)}/${enc(jid)}`)
      .then((s) => { cache.shape = s; })
      .catch((err) => { cache.shapeError = err.message; })
      .finally(() => { if (isCurrent()) draw(); });
    return;
  }
  if (live && cache.shape && !cache.shapeFetching) {
    cache.shapeFetching = true;
    fetchJSON(`/api/dag-shape/${enc(sid)}/${enc(jid)}`)
      .then((s) => { cache.shape = s; cache.shapeError = null; })
      .catch((err) => { cache.shapeError = err.message; })
      .finally(() => {
        cache.shapeFetching = false;
        if (isCurrent()) draw();
      });
  }
  draw();
}

function sourcePane(pane, cache, sid, jid, isCurrent) {
  const key = `${sid}/${jid}`;
  if (cache.sourceKey !== key) {
    cache.sourceKey = key;
    cache.source = null;
    cache.sourceError = null;
  }
  if (!cache.source && !cache.sourceError) {
    pane.innerHTML = paneEmpty("loading source…");
    fetchJSON(`/api/source/${enc(sid)}/${enc(jid)}`)
      .then((s) => { cache.source = s; })
      .catch((err) => { cache.sourceError = err.message; })
      .finally(() => { if (isCurrent()) renderSourceInto(pane, cache.source, cache.sourceError); });
    return;
  }
  renderSourceInto(pane, cache.source, cache.sourceError);
}

function renderSourceInto(pane, data, err) {
  if (err) {
    pane.innerHTML = paneEmpty(`no source: ${esc(err)}`);
    return;
  }
  if (!data) {
    pane.innerHTML = paneEmpty("no source");
    return;
  }
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
  pane.innerHTML =
    `<div class="shape-meta small muted">${(data.files || []).length} file${(data.files || []).length === 1 ? "" : "s"} staged for this run</div>
    <div class="source-view">${dirRow}${files || paneEmpty("no source files")}${missingRows}</div>`;
}

/* ---------------- dag page: config tab ---------------- */

function programNameOk(name) {
  return typeof name === "string" && !!name && !name.includes("..") &&
    !name.startsWith("/") && !name.includes("\\") &&
    /^(workflow\.toml|task\.txt|roots\.txt|project\.json|members\/[^\/]+\.md|hooks\/[^\/]+)$/.test(name);
}

function isDirty(p, name) {
  return name in p.texts && p.texts[name] !== p.orig[name];
}

async function loadProgram() {
  const d = state.dag;
  d.program = { files: null, picked: null, texts: {}, orig: {}, error: null, loadError: null };
  renderConfigPane();
  try {
    const res = await fetchJSON(`/api/program?dag=${enc(d.pid)}/${enc(d.dagId)}`);
    d.program.files = res.files || [];
  } catch (err) {
    d.program.error = err.message;
  }
  if (dagHere(d, "config")) renderConfigPane();
}

function renderConfigPane() {
  const d = state.dag;
  const pane = $("#dag-pane");
  if (!pane) return;
  const p = d.program;
  if (!p) {
    pane.innerHTML = paneEmpty("loading…");
    return;
  }
  if (p.error) {
    pane.innerHTML = paneEmpty(`program editor unavailable: ${esc(p.error)}`);
    return;
  }
  const files = p.files || [];
  const listHtml = files.map((f) => {
    const dirty = p.picked === f.name && isDirty(p, f.name);
    return `<button class="cfg-file${p.picked === f.name ? " active" : ""}" data-cfgpick="${esc(f.name)}">
      <span class="cfg-fname mono">${esc(f.name)}</span>
      <span class="cfg-fmeta mono">${dirty ? `<span class="dirty-dot">● </span>` : ""}${f.bytes} B</span>
    </button>`;
  }).join("") || paneEmpty("no editable files");
  let editorHtml;
  if (!p.picked) {
    editorHtml = paneEmpty("pick a file to edit");
  } else if (!(p.picked in p.orig)) {
    editorHtml = paneEmpty(p.loadError ? `failed to load ${esc(p.picked)}: ${esc(p.loadError)}` : `loading ${esc(p.picked)}…`);
  } else {
    const dirty = isDirty(p, p.picked);
    editorHtml = `
      <div class="cfg-edhead">
        <span class="cfg-name mono">${esc(p.picked)}</span>
        <span class="muted small" id="cfg-edmeta">${(p.orig[p.picked] || "").length} B${dirty ? ` · <span class="dirty-dot">edited — not saved</span>` : ""}</span>
      </div>
      <textarea id="cfg-text" class="mono" spellcheck="false"></textarea>
      <div class="cfg-actions">
        <button class="btn primary" id="cfg-save">Save</button>
        <button class="btn" id="cfg-rwe">Run with edits</button>
        <button class="btn ghost" id="cfg-revert">Revert</button>
        <span class="muted small cfg-hint"><b>Save</b> = PUT this file into the dag's source folder (persists) · <b>Run with edits</b> = one-time run on a temp copy with your edits, nothing is saved · <b>▶ Trigger run</b> (header) always runs the saved source</span>
      </div>`;
  }
  pane.innerHTML = `<div class="cfg"><aside class="cfg-list">${listHtml}</aside><div class="cfg-editor">${editorHtml}</div></div>`;
  const ta = $("#cfg-text");
  if (ta) {
    ta.value = p.texts[p.picked] ?? p.orig[p.picked];
    ta.addEventListener("input", () => {
      p.texts[p.picked] = ta.value;
      updateCfgDirty();
    });
    $("#cfg-save").addEventListener("click", cfgSave);
    $("#cfg-rwe").addEventListener("click", cfgRunWithEdits);
    $("#cfg-revert").addEventListener("click", () => {
      p.texts[p.picked] = p.orig[p.picked];
      renderConfigPane();
    });
  }
  $$("[data-cfgpick]", pane).forEach((b) => {
    b.addEventListener("click", () => pickProgramFile(b.dataset.cfgpick));
  });
}

function updateCfgDirty() {
  const d = state.dag;
  const p = d.program;
  const meta = $("#cfg-edmeta");
  if (meta && p.picked in p.orig) {
    const dirty = isDirty(p, p.picked);
    meta.innerHTML = `${(p.texts[p.picked] || "").length} B${dirty ? ` · <span class="dirty-dot">edited — not saved</span>` : ""}`;
  }
  const item = $(`.cfg-file[data-cfgpick="${CSS.escape(p.picked)}"] .cfg-fmeta`);
  const f = (p.files || []).find((x) => x.name === p.picked);
  if (item && f) {
    item.innerHTML = `${isDirty(p, p.picked) ? `<span class="dirty-dot">● </span>` : ""}${f.bytes} B`;
  }
}

async function pickProgramFile(name) {
  const d = state.dag;
  const p = d.program;
  if (!p || p.picked === name) return;
  p.picked = name;
  p.loadError = null;
  if (!(name in p.orig)) {
    renderConfigPane();
    try {
      const res = await fetchJSON(`/api/program?dag=${enc(d.pid)}/${enc(d.dagId)}&name=${enc(name)}`);
      p.orig[name] = res.text;
      if (!(name in p.texts)) p.texts[name] = res.text;
    } catch (err) {
      p.loadError = err.message;
    }
  }
  if (dagHere(d, "config")) renderConfigPane();
}

async function cfgSave() {
  const d = state.dag;
  const p = d.program;
  const name = p.picked;
  const text = $("#cfg-text").value;
  if (!programNameOk(name)) {
    showToast(`refused: ${name} is not an editable program file`, "err");
    return;
  }
  p.texts[name] = text;
  const btn = $("#cfg-save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetchJSON("/api/program", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dag: `${d.pid}/${d.dagId}`, name, text }),
    });
    p.orig[name] = text;
    const f = (p.files || []).find((x) => x.name === name);
    if (f && res.bytes != null) f.bytes = res.bytes;
    showToast(`saved ${name} → source (${res.bytes ?? "?"} bytes) — the file is persisted; Trigger run to use it`, "ok");
  } catch (err) {
    showToast(`save failed:\n${err.message}`, "err");
  }
  if (dagHere(d, "config")) renderConfigPane();
}

async function cfgRunWithEdits() {
  const d = state.dag;
  const p = d.program;
  const changed = (p.files || []).filter((f) => isDirty(p, f.name))
    .map((f) => ({ name: f.name, text: p.texts[f.name] }));
  if (!changed.length) {
    showToast("no unsaved edits in the editor — use ▶ Trigger run to run the saved source", "err");
    return;
  }
  if (changed.some((f) => !programNameOk(f.name))) {
    showToast("refused: a file name is outside the editable whitelist", "err");
    return;
  }
  const btn = $("#cfg-rwe");
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    const res = await fetchJSON(`/api/dags/${enc(d.pid)}/${enc(d.dagId)}/run-with-edits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: changed }),
    });
    const jobLine = (res.lines || []).find((l) => l.startsWith("job:")) || "";
    showToast([`one-time run on a temp copy with ${changed.length} edited file${changed.length === 1 ? "" : "s"} — nothing was saved`, jobLine || res.reason || ""]
      .filter(Boolean).join("\n"), "ok");
  } catch (err) {
    showToast(`run with edits failed:\n${err.message}`, "err");
  }
  if (dagHere(d, "config")) renderConfigPane();
}

/* ---------------- view: run page ---------------- */

function mountRun(r) {
  state.run = {
    sid: r.sid,
    jid: r.jid,
    tab: r.tab,
    job: null,
    report: null,
    events: null,
    detailError: null,
    shape: null,
    shapeKey: null,
    shapeError: null,
    shapeFetching: false,
    source: null,
    sourceKey: null,
    sourceError: null,
  };
  viewEl.innerHTML = `
    <div class="crumbs"><a href="#/runs">All runs</a><span class="crumb-sep">/</span><span class="mono">${esc(r.sid)}</span></div>
    <section class="pagehead panel" id="run-head"></section>
    <nav class="ptabs" id="run-tabs"></nav>
    <div id="run-pane"><div class="empty">loading…</div></div>`;
  renderRunTabs();
  renderRunHead();
  enterRunTab();
  runLoadDetail();
}

function renderRunTabs() {
  const rn = state.run;
  if (!$("#run-tabs")) return;
  $("#run-tabs").innerHTML = RUN_TABS.map((t) =>
    `<a class="ptab${t === rn.tab ? " active" : ""}" href="${runsHref(rn.sid, rn.jid, t)}">${t}</a>`
  ).join("");
}

function renderRunHead() {
  const rn = state.run;
  const head = $("#run-head");
  if (!head) return;
  if (!rn.job) {
    head.innerHTML = `<div class="ph-loading muted small">${rn.detailError ? esc(`failed to load run: ${rn.detailError}`) : "loading run…"}</div>`;
    return;
  }
  const job = rn.job;
  const dur = job.durationMs != null
    ? humanAge(job.durationMs)
    : (job.state === "running" ? `${humanAge(createdElapsed(job.created))} so far` : "–");
  const dagBits = job.dag && job.dag.project_name !== "-"
    ? `<a class="chip label" href="${dagHref(job.dag.project || "-", job.dag.dag_id)}" title="open the dag page">${esc(job.dag.project_name)} / ${esc(job.dag.dag_id)}</a>`
    : "";
  const labels = job.labels || (job.dag && job.dag.labels) || {};
  head.innerHTML = `
    <div class="ph-main">
      <div class="ph-title">
        <h2 class="mono">${esc(job.id)}</h2>
        ${chip(job.state, job.state)}
        ${dagBits}
      </div>
      <div class="ph-sub mono small">${esc(job.workflow)} · sid ${esc(job.sid)} · pid ${esc(job.pid ?? "–")} · ${esc(fmtShortTs(job.created))} → ${esc(job.finished ? fmtShortTs(job.finished) : "…")} · ${esc(dur)}</div>
      ${job.task ? `<div class="ph-task">${esc(job.task)}</div>` : ""}
      ${Object.keys(labels).length ? `<div class="ph-labels">${labelChips(labels)}</div>` : ""}
    </div>`;
}

function enterRunTab() {
  const rn = state.run;
  if (rn.tab === "overview") {
    renderOverviewPane();
  } else if (rn.tab === "shape") {
    shapePane($("#run-pane"), rn, rn.sid, rn.jid, rn.job ? rn.job.state === "running" : false, () => runHere(rn, "shape"));
  } else if (rn.tab === "source") {
    sourcePane($("#run-pane"), rn, rn.sid, rn.jid, () => runHere(rn, "source"));
  }
}

function renderOverviewPane() {
  const rn = state.run;
  const pane = $("#run-pane");
  if (!pane) return;
  if (!rn.job) {
    pane.innerHTML = paneEmpty(rn.detailError ? `failed to load run: ${esc(rn.detailError)}` : "loading…");
    return;
  }
  const job = rn.job;
  const oldEvents = $("#rn-events");
  const nearBottom = !oldEvents || oldEvents.scrollHeight === 0 ||
    oldEvents.scrollTop + oldEvents.clientHeight >= oldEvents.scrollHeight - 40;
  const meta =
    kvRow("task", esc(job.task || "–")) +
    kvRow("stood up by", esc(job.stoodUpBy || "–")) +
    kvRow("pid", esc(job.pid ?? "–")) +
    kvRow("created", esc(fmtTs(job.created))) +
    kvRow("finished", esc(fmtTs(job.finished))) +
    kvRow("duration", esc(job.durationMs != null
      ? humanAge(job.durationMs)
      : (job.state === "running" ? `${humanAge(createdElapsed(job.created))} so far` : "–"))) +
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
  let reportHtml = "";
  if (rn.report) {
    const rep = rn.report;
    const table = rep.table || [];
    reportHtml =
      `<dl class="kv">` +
      kvRow("kind", esc(rep.kind || "–")) +
      kvRow("status", esc(rep.status || "–"), rep.status === "ok" ? "ok" : "warn") +
      kvRow("where", esc(rep.where || "–")) +
      kvRow("counts", esc(JSON.stringify(rep.counts ?? {}))) +
      `</dl>` +
      (table.length
        ? `<table class="mini-table"><thead><tr><th>unit</th><th>result</th></tr></thead><tbody>${table.map((row) =>
            `<tr><td>${esc(row.unit)}</td><td class="${String(row.result).startsWith("ok") ? "ok" : "bad"}">${esc(row.result)}</td></tr>`).join("")}</tbody></table>`
        : "");
  } else {
    reportHtml = `<dl class="kv">${kvRow("report", job.hasReport ? "parsing…" : "none yet", "muted")}</dl>`;
  }
  pane.innerHTML = `
    <section class="panel"><div class="pane-body">
      <section class="d-section">
        <h3>receipt</h3>
        <dl class="kv">${meta}${receipt}</dl>
      </section>
      <section class="d-section">
        <h3>report</h3>
        ${reportHtml}
      </section>
      <section class="d-section">
        <h3>events <span class="muted small">(${(rn.events || []).length})</span></h3>
        <div id="rn-events" class="events mono"></div>
      </section>
    </div></section>`;
  const evEl = $("#rn-events");
  evEl.innerHTML = (rn.events || []).map((ev) => {
    const extraBits = [];
    if (ev.jid) extraBits.push(ev.jid);
    if (ev.label) extraBits.push(ev.label);
    else if (ev.pane) extraBits.push(ev.pane);
    if (ev.workflow) extraBits.push(ev.workflow);
    return `<div class="ev-line"><span class="ev-ts">${esc(fmtShortTs(ev.ts))}</span>  ` +
      `<span class="ev-kind k-${esc(ev.kind)}">${esc(ev.kind)}</span>  ` +
      `<span class="ev-extra">${esc(ev.actor || "")}${extraBits.length ? " · " + esc(extraBits.join(" · ")) : ""}</span></div>`;
  }).join("");
  if (nearBottom) evEl.scrollTop = evEl.scrollHeight;
}

async function runLoadDetail() {
  const rn = state.run;
  try {
    const [jobRes, evRes] = await Promise.all([
      fetchJSON(`/api/job/${enc(rn.sid)}/${enc(rn.jid)}`),
      fetchJSON(`/api/events/${enc(rn.sid)}`),
    ]);
    rn.job = jobRes.job;
    rn.report = jobRes.report;
    rn.events = evRes.events;
    rn.detailError = null;
  } catch (err) {
    rn.detailError = err.message;
  }
  if (state.run !== rn) return;
  renderRunHead();
  if (rn.tab === "overview") renderOverviewPane();
}

function renderRunShapePane() {
  const rn = state.run;
  const pane = $("#run-pane");
  if (!pane) return;
  shapePane(pane, rn, rn.sid, rn.jid, rn.job ? rn.job.state === "running" : false, () => runHere(rn, "shape"));
}

/* ---------------- actions ---------------- */

async function triggerDag(pid, dagId, btns) {
  (btns || []).forEach((b) => { b.disabled = true; });
  showToast(`triggering ${pid}/${dagId}…`);
  try {
    const res = await fetchJSON(`/api/dags/${enc(pid)}/${enc(dagId)}/trigger`, { method: "POST" });
    const jobLine = (res.lines || []).find((l) => l.startsWith("job:")) || "";
    showToast([`trigger ok (exit ${res.exitCode ?? 0})`, jobLine || res.reason || ""].filter(Boolean).join("\n"), "ok");
  } catch (err) {
    showToast(`trigger failed:\n${err.message}`, "err");
  }
  (btns || []).forEach((b) => { b.disabled = false; });
  tick();
}

function bodyClick(e) {
  const trig = e.target.closest("[data-trig]");
  if (trig) {
    e.preventDefault();
    e.stopPropagation();
    const pid = trig.dataset.pid;
    const dagId = trig.dataset.dag;
    const btns = $$(`[data-trig][data-pid="${CSS.escape(pid)}"][data-dag="${CSS.escape(dagId)}"]`);
    triggerDag(pid, dagId, btns);
    return;
  }
  const row = e.target.closest("[data-href]");
  if (row && !e.target.closest("a, button, input, textarea, select")) {
    location.hash = row.dataset.href;
  }
}

/* ---------------- refresh loop ---------------- */

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const r = state.route;
    const wants = [fetchJSON("/api/summary"), fetchJSON(dagsUrl())];
    if (r.view === "runs") wants.push(fetchJSON("/api/jobs"));
    const [summary, dagsRes, jobsRes] = await Promise.all(wants);
    state.summary = summary;
    state.dags = dagsRes.dags || [];
    if (jobsRes) state.allJobs = jobsRes.jobs || [];
    if (state.route !== r) return;
    if (r.view === "runs") {
      renderRunsView();
    } else if (r.view === "dags") {
      renderDagsView();
    } else if (r.view === "dag" && state.dag) {
      state.dag.group = findGroup(r.pid, r.dagId);
      renderDagHead();
      if (r.tab === "runs") {
        if (isUngroupedDag(state.dag)) renderRunsPane();
        else await dagLoadRuns();
      } else if (r.tab === "shape") {
        renderDagShapePane();
      }
    } else if (r.view === "run" && state.run) {
      await runLoadDetail();
      if (state.route === r && r.tab === "shape") renderRunShapePane();
    }
  } catch (err) {
    showToast(`refresh failed: ${err.message}`, "err");
  } finally {
    ticking = false;
  }
}

/* ---------------- boot ---------------- */

window.addEventListener("hashchange", onRoute);
document.body.addEventListener("click", bodyClick);

function updateClock() {
  clockEl.textContent = new Date().toLocaleTimeString();
}
updateClock();
setInterval(updateClock, 1000);

onRoute();
tick();
setInterval(tick, REFRESH_MS);
