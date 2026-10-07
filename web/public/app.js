"use strict";

const $ = (sel) => document.querySelector(sel);

const REFRESH_MS = 5000;

const ui = {
  stats: {
    sessions: $("#st-sessions"),
    jobs: $("#st-jobs"),
    running: $("#st-running"),
    retired: $("#st-retired"),
    aborted: $("#st-aborted"),
    orphaned: $("#st-orphaned"),
  },
  jobsBody: $("#jobs-body"),
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
  toast: $("#toast"),
  runForm: $("#run-form"),
  runFolder: $("#run-folder"),
  runBtn: $("#run-btn"),
  clock: $("#clock"),
};

const state = {
  jobs: [],
  filter: null,
  selected: null, // { sid, jid }
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
  if (ms < 0) ms = 0;
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
  const by = summary.jobsByState || {};
  ui.stats.running.textContent = by.running ?? 0;
  ui.stats.retired.textContent = by.retired ?? 0;
  ui.stats.aborted.textContent = by.aborted ?? 0;
  ui.stats.orphaned.textContent = by.orphaned ?? 0;
  document.querySelectorAll(".stat.chipable").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === state.filter);
  });
}

/* ---------------- jobs table ---------------- */

function chip(kind, label) {
  return `<span class="chip ${esc(kind)}">${esc(label)}</span>`;
}

function renderJobs() {
  const jobs = state.filter
    ? state.jobs.filter((j) => j.state === state.filter)
    : state.jobs;
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
    const alive = Math.max(total - dead, 0);
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

/* ---------------- detail drawer ---------------- */

function kvRow(k, v, cls) {
  return `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ""}>${v}</dd>`;
}

function renderDetail(job, report, events) {
  ui.dTitle.innerHTML = `${esc(job.id)} ${chip(job.state, job.state)}`;
  ui.dSub.textContent = `${job.workflow} · sid ${job.sid}`;

  const meta =
    kvRow("task", esc(job.task || "–")) +
    kvRow("stood up by", esc(job.stoodUpBy || "–")) +
    kvRow("pid", esc(job.pid ?? "–")) +
    kvRow("created", esc(fmtTs(job.created))) +
    kvRow("finished", esc(fmtTs(job.finished))) +
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

async function openDetail(sid, jid) {
  state.selected = { sid, jid };
  ui.detail.classList.remove("hidden");
  ui.detail.setAttribute("aria-hidden", "false");
  ui.backdrop.classList.remove("hidden");
  await refreshDetail();
  renderJobs();
}

function closeDetail() {
  state.selected = null;
  ui.detail.classList.add("hidden");
  ui.detail.setAttribute("aria-hidden", "true");
  ui.backdrop.classList.add("hidden");
  renderJobs();
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
    const [summary, jobsRes] = await Promise.all([
      fetchJSON("/api/summary"),
      fetchJSON("/api/jobs"),
    ]);
    state.jobs = jobsRes.jobs || [];
    renderStats(summary);
    renderJobs();
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

ui.jobsBody.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-jid]");
  if (!tr) return;
  openDetail(tr.dataset.sid, tr.dataset.jid);
});

document.querySelectorAll(".stat.chipable").forEach((el) => {
  el.addEventListener("click", () => {
    const f = el.dataset.filter;
    state.filter = state.filter === f ? null : f;
    renderJobs();
    renderStatsActive();
  });
});

function renderStatsActive() {
  document.querySelectorAll(".stat.chipable").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === state.filter);
  });
}

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
