"use strict";

const REFRESH_MS = 5000;
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const enc = encodeURIComponent;

const viewEl = $("#view");
const toastEl = $("#toast");
const clockEl = $("#clock");

const LEFT_TABS = ["diagram", "runs", "config"];
const RIGHT_TABS = ["receipt", "report", "events"];
const STATUSES = ["success", "failed", "aborted", "running", "paused", "orphaned"];
const SPLIT_KEY = "ui4-split-pct";
const RESIZE_KEY = "ui4-split-resized";

const SORT_NAMES = {
  dag: "spur name",
  start: "latest run start",
  end: "latest run end",
  duration: "latest duration",
  status: "status",
};

const RUN_SORT_NAMES = {
  state: "state",
  created: "created",
  duration: "duration",
  status: "status",
};

const state = {
  route: null,
  seq: 0,
  dags: [],
  dagsSort: null,
  jobs: [],
  jobsSort: null,
  jobsLoaded: false,
  home: null,
  split: null,
  opsBusy: {},
  toastTimer: null,
};

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
    err.status = res.status;
    throw err;
  }
  return body;
}

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtTs(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtShortTs(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function dtHtml(iso) {
  if (!iso) return `<span class="muted">–</span>`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `<span class="dt mono small" title="${esc(fmtTs(iso))}">` +
    `<span>${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}</span> ` +
    `<span class="dt-t">${pad2(d.getHours())}:${pad2(d.getMinutes())}</span></span>`;
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

function createdElapsed(created) {
  return Math.max(Date.now() - new Date(created).getTime(), 0);
}

function fmtAxisMs(ms) {
  if (ms < 120000) return `${Math.round(ms / 1000)}s`;
  if (ms < 7200000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function showToast(text, kind) {
  toastEl.textContent = text;
  toastEl.className = `toast ${kind || ""}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 6000);
}

function paneEmpty(s) { return `<div class="empty">${s}</div>`; }
function emptyRow(cols, s) { return `<tr><td colspan="${cols}" class="empty">${s}</td></tr>`; }

function stOf(x) { return STATUSES.includes(x) ? x : "failed"; }

function stChip(status, label) {
  const s = stOf(status);
  return `<span class="chip st-${s}">${esc(label || s)}</span>`;
}

function kindChip(kind) {
  if (!kind) return `<span class="muted small">–</span>`;
  return `<span class="chip kind" title="workflow of latest run">${esc(kind)}</span>`;
}

function labelChips(labels) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return `<span class="muted">–</span>`;
  return entries.map(([k, v]) =>
    `<span class="chip label" title="${esc(k)}=${esc(v)}">${esc(k)}=${esc(v)}</span>`
  ).join(" ");
}

function splitKey(key) {
  const i = String(key).indexOf("/");
  return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

function current(sp, seq) {
  return seq === state.seq && state.split === sp;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const qi = raw.indexOf("?");
  const path = qi === -1 ? raw : raw.slice(0, qi);
  const q = new URLSearchParams(qi === -1 ? "" : raw.slice(qi + 1));
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q };
}

function parseRoute() {
  const { parts, q } = parseHash();
  if (parts[0] === "home") return { view: "home" };
  if (parts[0] === "spur-status") {
    return {
      view: "spur-status",
      dag: q.get("dag") || q.get("spur") || null,
      run: q.get("run") || null,
      tab: LEFT_TABS.includes(q.get("tab")) ? q.get("tab") : "diagram",
      rtab: RIGHT_TABS.includes(q.get("rtab")) ? q.get("rtab") : "receipt",
      legacy: q.get("legacy") === "1",
    };
  }
  if (parts[0] === "spur-runs") return { view: "spur-runs" };
  if (parts[0] === "spurs") return { view: "spurs" };
  return { view: "home" };
}

function canonicalize() {
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", "#/home");
    return;
  }
  const { parts } = parseHash();
  const raw = location.hash.replace(/^#\/?/, "");
  // v4 flat-list hash with a query -> the v5 detail view kept the query
  if (parts[0] === "spur-runs" && raw.includes("?")) {
    history.replaceState(null, "", `#/spur-status${raw.slice("spur-runs".length)}`);
    return;
  }
  // v6 "dag" words -> spurs (old bookmarks keep working, forever)
  if (parts[0] === "dag-runs") {
    // v4 flat-list hashes carried a query — they always meant the detail view
    const base = raw.includes("?") ? "spur-status" : "spur-runs";
    history.replaceState(null, "", `#/${base}${raw.slice("dag-runs".length)}`);
    return;
  }
  if (parts[0] === "dag-status") {
    history.replaceState(null, "", "#/spur-status" + raw.slice("dag-status".length));
    return;
  }
  if (parts[0] === "dags") {
    history.replaceState(null, "", "#/spurs" + raw.slice("dags".length));
    return;
  }
  if (parts[0] === "runs") {
    if (parts[1] && parts[2]) {
      const tabMap = { overview: "receipt", shape: "report", source: "report" };
      const rtab = tabMap[parts[3]] || null;
      history.replaceState(null, "",
        `#/spur-status?run=${enc(parts[1])}/${enc(parts[2])}${rtab ? `&rtab=${rtab}` : ""}`);
    } else {
      history.replaceState(null, "", "#/spur-status");
    }
    return;
  }
  if (parts[0] === "spurs" && parts[1] && parts[2]) {
    const tabMap = { shape: "diagram", source: "diagram", config: "config" };
    const tab = tabMap[parts[3]] || null;
    history.replaceState(null, "",
      `#/spur-status?dag=${enc(parts[1])}/${enc(parts[2])}${tab ? `&tab=${tab}` : ""}`);
  }
}

function splitHref(over) {
  const r = state.route || {};
  const merged = {
    dag: r.dag || null,
    run: r.run || null,
    tab: r.view === "spur-status" ? r.tab : null,
    rtab: r.view === "spur-status" ? r.rtab : null,
    legacy: r.legacy ? "1" : null,
    ...over,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v == null || v === "" || v === false) continue;
    params.set(k, v === true ? "1" : String(v));
  }
  const qs = params.toString();
  return "#/spur-status" + (qs ? `?${qs}` : "");
}

function applyRouteOver(over) {
  const r = state.route;
  if (!r || r.view !== "spur-status") return;
  if ("dag" in over) r.dag = over.dag || null;
  if ("run" in over) r.run = over.run || null;
  if ("legacy" in over) r.legacy = over.legacy === true || over.legacy === "1";
  history.replaceState(null, "", splitHref({}));
}

function setHash(h) {
  if (location.hash === h) onRoute();
  else location.hash = h;
}

function renderNav(r) {
  $$(".mainnav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === (r.view === "home" ? "home" : "spurs")));
  const subnav = $("#subnav");
  if (subnav) {
    subnav.classList.toggle("idle", r.view === "home");
    const sub = r.view === "spur-status" ? "spur-status" : r.view === "spur-runs" ? "spur-runs" : "spurs";
    $$("#subnav a").forEach((a) =>
      a.classList.toggle("active", a.dataset.subnav === sub));
  }
}

function onRoute() {
  canonicalize();
  const r = parseRoute();
  const seq = ++state.seq;
  const prev = state.route;
  state.route = r;
  renderNav(r);
  if (r.view === "spur-status") {
    if (prev && prev.view === "spur-status" && state.split) {
      state.split.route = r;
      updateSplit(seq);
    } else {
      mountSplit(r, seq);
    }
    return;
  }
  closeEventsStream();
  state.split = null;
  if (r.view === "home") { mountHome(seq); return; }
  if (r.view === "spurs") { mountDags(seq); return; }
  if (r.view === "spur-runs") { mountDagRunsList(seq); return; }
}

function dagsUrl() {
  return state.dagsSort
    ? `/api/dags?sort=${state.dagsSort.sort}&order=${state.dagsSort.order}`
    : "/api/dags";
}

async function fetchDags(seq) {
  try {
    const res = await fetchJSON(dagsUrl());
    if (seq !== state.seq) return;
    state.dags = res.dags || [];
  } catch (err) {
    if (seq === state.seq) showToast(`spurs failed: ${err.message}`, "err");
  }
}

function jobsUrl() {
  return state.jobsSort
    ? `/api/jobs?sort=${state.jobsSort.sort}&order=${state.jobsSort.order}`
    : "/api/jobs";
}

async function fetchJobs(seq) {
  try {
    const res = await fetchJSON(jobsUrl());
    if (seq !== state.seq) return;
    state.jobs = res.jobs || [];
    state.jobsLoaded = true;
  } catch (err) {
    if (seq === state.seq) showToast(`jobs failed: ${err.message}`, "err");
  }
}

function legacyJobs() {
  return state.jobs
    .filter((j) => j.legacy)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

function dagJobs() {
  return state.jobs.filter((j) => j.dag && !j.legacy);
}

function findGroupKey(dk) {
  if (!dk) return null;
  const [pid, dagId] = splitKey(dk);
  return state.dags.find((g) => g.project === pid && g.dag_id === dagId) || null;
}

function mountHome(seq) {
  viewEl.className = "view";
  viewEl.innerHTML = paneEmpty("loading home…");
  loadHome(seq);
}

async function loadHome(seq) {
  try {
    const res = await fetchJSON("/api/home");
    if (seq !== state.seq || !state.route || state.route.view !== "home") return;
    state.home = res;
    renderHome();
  } catch (err) {
    if (seq === state.seq && state.route && state.route.view === "home") {
      viewEl.innerHTML = paneEmpty(`home failed: ${esc(err.message)}`);
    }
  }
}

function kpiCard(label, value, sub, cls) {
  return `<div class="kpi">
    <span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value ${cls || ""}">${esc(String(value ?? "–"))}</span>
    ${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ""}
  </div>`;
}

function niceStep(max) {
  const raw = Math.max(max / 4, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) { if (m * pow >= raw) return m * pow; }
  return 10 * pow;
}

function svgRunsPerDay(days) {
  if (!days.length) return paneEmpty("no data");
  const W = 880, H = 224, padL = 40, padR = 12, padT = 12, padB = 28;
  const iw = W - padL - padR, ih = H - padT - padB;
  const totals = days.map((d) => (d.success || 0) + (d.failed || 0) + (d.aborted || 0) + (d.running || 0) + (d.paused || 0) + (d.orphaned || 0));
  const max = Math.max(...totals, 1);
  const step = niceStep(max);
  const top = Math.max(Math.ceil(max / step) * step, step);
  const y = (v) => padT + ih - (v / top) * ih;
  const bw = iw / days.length;
  const barW = Math.min(Math.round(bw * 0.6), 36);
  let g = "";
  for (let v = 0; v <= top; v += step) {
    g += `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="c-grid"></line>` +
      `<text x="${padL - 6}" y="${y(v) + 3}" class="c-yaxis" text-anchor="end">${v}</text>`;
  }
  const segKeys = ["success", "failed", "aborted", "running", "paused", "orphaned"];
  let bars = "";
  days.forEach((d, i) => {
    const cx = padL + i * bw + bw / 2;
    const x = cx - barW / 2;
    let acc = 0;
    for (const k of segKeys) {
      const v = d[k] || 0;
      if (!v) continue;
      const y1 = y(acc + v);
      const h = Math.max(y(acc) - y1, 1.5);
      acc += v;
      bars += `<rect x="${x}" y="${y1}" width="${barW}" height="${h}" rx="2" class="c-seg ${k}"><title>${esc(d.day)} · ${k}: ${v} · day total ${totals[i]}</title></rect>`;
    }
    bars += `<text x="${cx}" y="${H - 8}" class="c-xaxis" text-anchor="middle">${esc(d.day.slice(5))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="runs per day">${g}${bars}</svg>`;
}

function verColor(v) {
  let h = 0;
  for (const c of String(v || "?")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 62%)`;
}

function svgDurationTrend(t) {
  const pts = (t.points || []).filter((p) => p.durationMs != null);
  if (!pts.length) return paneEmpty("no completed runs yet");
  const W = 880, H = 212, padL = 46, padR = 20, padT = 32, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(...pts.map((p) => p.durationMs));
  const step = niceStep(max);
  const top = Math.max(Math.ceil(max / step) * step, step);
  const y = (v) => padT + ih - (v / top) * ih;
  const n = pts.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  let grid = "";
  for (let v = 0; v <= top; v += step) {
    grid += `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="c-grid"></line>` +
      `<text x="${padL - 6}" y="${y(v) + 3}" class="c-yaxis" text-anchor="end">${fmtAxisMs(v)}</text>`;
  }
  const path = pts.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.durationMs).toFixed(1)}`).join(" ");
  const dots = pts.map((p, i) => {
    const cx = x(i), cy = y(p.durationMs);
    const chipY = i % 2 === 0 ? Math.max(cy - 30, 2) : Math.min(cy + 12, H - 20);
    return `<circle cx="${cx}" cy="${cy}" r="4.5" class="c-dot ${stOf(p.status)}" stroke="#0b0e14" stroke-width="1.5"><title>${esc(p.jid)} · ${esc(humanAge(p.durationMs))} · ${esc(p.status)} · version ${esc(p.version || "–")}</title></circle>` +
      `<rect x="${cx - 31}" y="${chipY}" width="62" height="15" rx="4" style="fill:${verColor(p.version)}" opacity="0.24"></rect>` +
      `<text x="${cx}" y="${chipY + 11}" text-anchor="middle" class="c-vchip">${esc(String(p.version || "?").slice(0, 7))}</text>` +
      `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="c-xaxis">${esc(String(p.jid || "").replace(/^j-/, ""))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="duration trend ${esc(t.dag_id)}">${grid}<path d="${path}" class="c-line"></path>${dots}</svg>`;
}

function mixHtml(mix) {
  const total = (mix.allow || 0) + (mix.deny || 0) + (mix.denyUnneeded || 0);
  if (!total) return paneEmpty("no permission events in session traces yet");
  const seg = (n, cls, label) => n
    ? `<div class="seg ${cls}" style="width:${((n / total) * 100).toFixed(2)}%" title="${label}: ${n}/${total}"></div>`
    : "";
  return `<div class="mixbar-track"><div class="mixbar">` +
    seg(mix.allow, "allow", "allow") +
    seg(mix.deny, "deny", "deny") +
    seg(mix.denyUnneeded, "denyUnneeded", "deny-unneeded") +
    `</div></div>
    <div class="legend mixbar-legend">
      <span class="li"><span class="sw" style="background:var(--success)"></span>allow ${mix.allow || 0}</span>
      <span class="li"><span class="sw" style="background:var(--failed)"></span>deny ${mix.deny || 0}</span>
      <span class="li"><span class="sw" style="background:var(--orphaned);opacity:.75"></span>deny-unneeded ${mix.denyUnneeded || 0}</span>
      <span class="li muted">of ${total} permission events</span>
    </div>`;
}

function renderHome() {
  const h = state.home;
  if (!h) return;
  const k = h.kpis || {};
  const trend = h.durationTrend || [];
  viewEl.innerHTML = `
    <section class="kpis">
      ${kpiCard("jobs · 24h", k.jobs24h ?? "–", "all jobs started in window")}
      ${kpiCard("success rate · 24h", k.successRate24h == null ? "–" : `${k.successRate24h}%`, "terminal runs in window", k.successRate24h >= 50 ? "green" : "")}
      ${kpiCard("avg duration · 24h", k.avgDuration24h != null ? humanAge(k.avgDuration24h) : "–", "mean of completed")}
      ${kpiCard("running now", k.runningNow ?? 0, "", "blue")}
      ${kpiCard("orphaned now", k.orphanedNow ?? 0, k.orphanedNow ? "action item" : "clean", "amber")}
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Runs per day</h2>
        <span class="muted small">last 14 days · stacked by status</span>
        <span class="grow"></span>
        <span class="muted small">generated ${esc(fmtShortTs(h.generatedAt))}</span>
      </div>
      <div class="chart-wrap">${svgRunsPerDay(h.runsPerDay || [])}</div>
      <div class="legend">${STATUSES.map((s) =>
        `<span class="li"><span class="sw" style="background:var(--${s})"></span>${s}</span>`).join("")}</div>
    </section>
    ${trend.length ? trend.map((t) => `
      <section class="panel">
        <div class="panel-head">
          <h2>Duration trend — ${esc(t.dag_id)}</h2>
          <span class="muted small">${esc(t.project || "")} · version-hash chips on the points — did the new version slow us down?</span>
        </div>
        <div class="chart-wrap">${svgDurationTrend(t)}</div>
      </section>`).join("")
      : `<section class="panel">${paneEmpty("no duration trend yet")}</section>`}
    <section class="panel">
      <div class="panel-head">
        <h2>Permission mix</h2>
        <span class="muted small">the governance bar — allow / deny / deny-unneeded</span>
      </div>
      ${mixHtml(h.permissionMix || {})}
    </section>`;
}

function mountDags(seq) {
  viewEl.className = "view wide";
  viewEl.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Spurs</h2>
        <span id="dl-note" class="muted small"></span>
        <span class="grow"></span>
        <span id="dl-sort" class="muted small"></span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <colgroup>
            <col style="width:27%" /><col style="width:9%" /><col style="width:16%" />
            <col style="width:16%" /><col style="width:12%" /><col style="width:12%" /><col style="width:8%" />
          </colgroup>
          <thead><tr>
            <th class="sortable" data-dsort="dag">spur</th>
            <th>kind</th>
            <th class="sortable" data-dsort="start">latest run start</th>
            <th class="sortable" data-dsort="end">latest run end</th>
            <th class="sortable num" data-dsort="duration">latest duration</th>
            <th class="sortable" data-dsort="status">status</th>
            <th class="ctr">run</th>
          </tr></thead>
          <tbody id="dl-body">${emptyRow(7, "loading…")}</tbody>
        </table>
      </div>
      <div class="legacy-note" id="dl-legacy"></div>
    </section>`;
  $$("#view th[data-dsort]").forEach((th) => {
    th.addEventListener("click", () => cycleDagsSort(th.dataset.dsort));
  });
  renderDags();
  renderDagsLegacyNote();
  fetchDags(seq).then(() => { if (seq === state.seq) renderDags(); });
  fetchJobs(seq).then(() => { if (seq === state.seq) renderDagsLegacyNote(); });
}

function cycleDagsSort(key) {
  const cur = state.dagsSort;
  if (!cur || cur.sort !== key) state.dagsSort = { sort: key, order: "asc" };
  else if (cur.order === "asc") state.dagsSort = { sort: key, order: "desc" };
  else state.dagsSort = null;
  const seq = state.seq;
  fetchDags(seq).then(() => { if (seq === state.seq) renderDags(); });
}

function latestDurText(g) {
  const lr = g.latestRun;
  if (!lr) return "–";
  if (lr.durationMs != null) return humanAge(lr.durationMs);
  if (lr.status === "running" && lr.start) {
    return `${humanAge(createdElapsed(lr.start))} so far`;
  }
  return "–";
}

function renderDags() {
  const body = $("#dl-body");
  if (!body) return;
  const sort = state.dagsSort;
  $$("#view th[data-dsort]").forEach((th) => {
    const isActive = sort ? sort.sort === th.dataset.dsort : th.dataset.dsort === "start";
    const order = sort ? sort.order : "desc";
    const arrow = !isActive ? "" : order === "asc"
      ? `<span class="arrow">↑</span>`
      : `<span class="arrow">↓</span>`;
    th.innerHTML = esc(SORT_NAMES[th.dataset.dsort] || th.dataset.dsort) + arrow;
  });
  const sortNote = $("#dl-sort");
  if (sortNote) {
    sortNote.textContent = sort
      ? `sort: ${SORT_NAMES[sort.sort]} ${sort.order === "asc" ? "↑ asc" : "↓ desc"}`
      : "sort: latest run start ↓ (default)";
  }
  const note = $("#dl-note");
  if (note) note.textContent = `${state.dags.length} spur${state.dags.length === 1 ? "" : "s"}`;
  if (!state.dags.length) {
    body.innerHTML = emptyRow(7, "no spurs yet");
    return;
  }
  body.innerHTML = state.dags.map((g) => {
    const dk = `${g.project}/${g.dag_id}`;
    const lr = g.latestRun;
    const params = new URLSearchParams({ dag: dk });
    return `<tr class="row" data-href="#/dag-status?${params.toString()}">
      <td><div class="clamp">
        <span class="cell-name">${esc(g.project_name || g.dag_id)}</span>
        <span class="cell-sub">${esc(g.dag_id)}</span>
      </div></td>
      <td>${kindChip(g.kind)}</td>
      <td>${dtHtml(lr && lr.start)}</td>
      <td>${lr && lr.status === "running" ? `<span class="dt mono small muted" title="still running">…</span>` : dtHtml(lr && lr.end)}</td>
      <td class="num"><span class="dur-cell">${esc(latestDurText(g))}</span></td>
      <td>${lr ? stChip(lr.status) : `<span class="muted">–</span>`}</td>
      <td class="ctr"><button class="trig" data-trig data-pid="${esc(g.project)}" data-dag="${esc(g.dag_id)}" title="Trigger run (runs the saved source)">▶</button></td>
    </tr>`;
  }).join("");
}

function renderDagsLegacyNote() {
  const el = $("#dl-legacy");
  if (!el) return;
  const n = state.jobs.filter((j) => j.legacy).length;
  el.innerHTML = n
    ? `<span>${n} legacy run${n === 1 ? "" : "s"} before spur identity —</span><a href="#/spur-status?legacy=1">open them in Spur Status →</a>`
    : `<span>no legacy runs</span>`;
}

// ----- Spur Runs: the flat, sortable list of every spur run -----

function mountDagRunsList(seq) {
  viewEl.className = "view wide";
  viewEl.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2>Spur Runs</h2>
        <span id="jrl-note" class="muted small"></span>
        <span class="grow"></span>
        <span id="jrl-sort" class="muted small"></span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <colgroup>
            <col style="width:24%" /><col style="width:12%" /><col style="width:9%" />
            <col style="width:10%" /><col style="width:13%" /><col style="width:11%" /><col style="width:12%" />
          </colgroup>
          <thead><tr>
            <th>spur</th>
            <th>run</th>
            <th class="sortable" data-jsort="status">status</th>
            <th>kind</th>
            <th class="sortable" data-jsort="created">created</th>
            <th class="sortable num" data-jsort="duration">duration</th>
            <th class="ctr">ops</th>
          </tr></thead>
          <tbody id="jrl-body">${emptyRow(7, "loading…")}</tbody>
        </table>
      </div>
      <div class="legacy-note">every run of every spur, flat — click a row for its Spur Status · ops act on the run (see Spurs for a per-spur view)</div>
    </section>`;
  $$("#view th[data-jsort]").forEach((th) => {
    th.addEventListener("click", () => cycleJobsSort(th.dataset.jsort));
  });
  renderDagRunsList();
  fetchJobs(seq).then(() => { if (seq === state.seq) renderDagRunsList(); });
}

function cycleJobsSort(key) {
  const cur = state.jobsSort;
  if (!cur || cur.sort !== key) state.jobsSort = { sort: key, order: "asc" };
  else if (cur.order === "asc") state.jobsSort = { sort: key, order: "desc" };
  else state.jobsSort = null;
  const seq = state.seq;
  fetchJobs(seq).then(() => { if (seq === state.seq) renderDagRunsList(); });
}

function renderDagRunsList() {
  const body = $("#jrl-body");
  if (!body) return;
  const sort = state.jobsSort;
  $$("#view th[data-jsort]").forEach((th) => {
    const isActive = sort ? sort.sort === th.dataset.jsort : th.dataset.jsort === "created";
    const order = sort ? sort.order : "desc";
    const arrow = !isActive ? "" : order === "asc"
      ? `<span class="arrow">↑</span>`
      : `<span class="arrow">↓</span>`;
    th.innerHTML = esc(RUN_SORT_NAMES[th.dataset.jsort] || th.dataset.jsort) + arrow;
  });
  const sortNote = $("#jrl-sort");
  if (sortNote) {
    sortNote.textContent = sort
      ? `sort: ${RUN_SORT_NAMES[sort.sort]} ${sort.order === "asc" ? "↑ asc" : "↓ desc"}`
      : "sort: created ↓ (default)";
  }
  const runs = dagJobs();
  const note = $("#jrl-note");
  if (note) note.textContent = `${runs.length} spur run${runs.length === 1 ? "" : "s"}`;
  if (!runs.length) {
    body.innerHTML = emptyRow(7, "no spur runs yet — trigger one from Spurs");
    return;
  }
  body.innerHTML = runs.map((j) => {
    const jid = j.jid || j.id;
    const dk = `${j.dag.project}/${j.dag.dag_id}`;
    const params = new URLSearchParams({ dag: dk, run: `${j.sid}/${jid}` });
    return `<tr class="row" data-href="#/dag-status?${params.toString()}">
      <td><div class="clamp">
        <span class="cell-name">${esc(j.dag.project_name || j.dag.dag_id)}</span>
        <span class="cell-sub">${esc(j.dag.dag_id)}</span>
      </div></td>
      <td class="mono small">${esc(jid)}<span class="cell-sub" title="${esc(j.sid)}">${esc(j.sid)}</span></td>
      <td>${stChip(j.status || j.state)}</td>
      <td>${kindChip(j.workflow)}</td>
      <td>${dtHtml(j.created)}</td>
      <td class="num"><span class="dur-cell">${esc(runDurText(j))}</span></td>
      <td class="ctr ops">${opsButtonsHtml(stOf(j.status || j.state), j.sid, jid)}</td>
    </tr>`;
  }).join("");
}

function mountSplit(r, seq) {
  viewEl.className = "view wide";
  viewEl.innerHTML = `
    <div class="split-bar">
      <span class="small" style="font-weight:700">Spur Status</span>
      <span class="grow"></span>
      <span id="split-note" class="muted"></span>
      <button class="btn ghost" id="split-reset" title="reset divider to 45% / 55%">Reset</button>
    </div>
    <div class="split" id="split">
      <section class="split-pane" id="split-left">${paneEmpty("loading…")}</section>
      <div class="split-grip" id="split-grip" role="separator" aria-orientation="vertical" aria-label="Resize panes"></div>
      <section class="split-pane" id="split-right">${paneEmpty("loading…")}</section>
    </div>`;
  state.split = {
    route: r,
    dagKey: null,
    runKey: null,
    leftKey: null,
    defn: null, defnKey: null, defnError: null,
    program: null,
    job: null, jobError: null, jobLoadedKey: null,
    tree: null, treeError: null, treeLoadedKey: null,
    report: null, reportNote: null,
    filePath: null, fileData: null, fileLoading: false, fileCache: {},
    events: null, eventsError: null, eventsLoadedKey: null,
    es: null, esKey: null,
    resizeCount: Number(sessionStorage.getItem(RESIZE_KEY) || 0),
  };
  initSplitLayout();
  updateSplit(seq);
}

function initSplitLayout() {
  const root = $("#split");
  const left = $("#split-left");
  const grip = $("#split-grip");
  const note = $("#split-note");
  const sp = state.split;
  let pct = parseFloat(localStorage.getItem(SPLIT_KEY));
  if (!(pct >= 20 && pct <= 80)) pct = 45;
  const apply = () => { left.style.flex = `0 0 ${pct}%`; };
  const noteUpdate = () => {
    if (note) {
      note.textContent = `divider ${Math.round(pct)}% · resized ${sp.resizeCount}×`;
      if (sp.resizeCount > 0) note.classList.add("did");
    }
  };
  apply();
  noteUpdate();
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    try { grip.setPointerCapture(e.pointerId); } catch { /* ok */ }
    const move = (ev) => {
      const box = root.getBoundingClientRect();
      const w = Math.min(box.width - 300, Math.max(300, ev.clientX - box.left));
      pct = (w / box.width) * 100;
      apply();
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      localStorage.setItem(SPLIT_KEY, String(pct));
      sp.resizeCount += 1;
      sessionStorage.setItem(RESIZE_KEY, String(sp.resizeCount));
      noteUpdate();
      root.dispatchEvent(new CustomEvent("pl-resized"));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  $("#split-reset").addEventListener("click", () => {
    localStorage.removeItem(SPLIT_KEY);
    pct = 45;
    apply();
    sp.resizeCount += 1;
    sessionStorage.setItem(RESIZE_KEY, String(sp.resizeCount));
    noteUpdate();
    root.dispatchEvent(new CustomEvent("pl-resized"));
  });
  root.addEventListener("pl-resized", () => {
    redrawEdges();
  });
}

async function updateSplit(seq) {
  const sp = state.split;
  if (!sp) return;
  const r = sp.route;
  // the selection highlight never waits on a fetch
  $$(".runsel").forEach((b) => b.classList.toggle("active", b.dataset.run === (r.run || "")));
  if (r.run && !r.dag && !r.legacy) {
    const [sid, jid] = splitKey(r.run);
    const dk = await resolveRunDag(seq, sid, jid);
    if (!current(sp, seq)) return;
    if (dk === undefined) return;
    if (dk) applyRouteOver({ dag: dk });
    else applyRouteOver({ legacy: "1" });
  }
  await fetchDags(seq);
  if (!current(sp, seq)) return;
  if (r.legacy && !state.jobsLoaded) {
    await fetchJobs(seq);
    if (!current(sp, seq)) return;
  }
  autoSelectSplit();
  if (!current(sp, seq)) return;
  if (r.dag !== sp.dagKey) {
    sp.dagKey = r.dag;
    sp.defn = null; sp.defnKey = null; sp.defnError = null;
    sp.program = null;
  }
  if (r.run !== sp.runKey) {
    sp.runKey = r.run;
    sp.job = null; sp.jobError = null; sp.jobLoadedKey = null;
    sp.tree = null; sp.treeError = null; sp.treeLoadedKey = null;
    sp.report = null; sp.reportNote = null;
    sp.filePath = null; sp.fileData = null; sp.fileLoading = false; sp.fileCache = {};
    sp.events = null; sp.eventsError = null; sp.eventsLoadedKey = null;
    sp.shape = null; sp.shapeKey = null;
    sp.evSel = null; sp.evSideHtml = null; sp.evSideMember = null; sp.msgCache = {};
    closeEventsStream();
    closeNodePopup();
  }
  const lk = `${r.legacy ? "legacy" : r.dag}|${r.legacy ? "" : r.tab}`;
  if (lk !== sp.leftKey) {
    sp.leftKey = lk;
    renderLeft();
  }
  // the stream lives only while the events tab shows its run
  if (r.rtab !== "events" || !r.run) closeEventsStream();
  renderRight();
}

async function resolveRunDag(seq, sid, jid) {
  try {
    const res = await fetchJSON(`/api/job/${enc(sid)}/${enc(jid)}`);
    if (seq !== state.seq) return undefined;
    const d = res.job && res.job.dag;
    if (d && d.project && d.project !== "-" && d.dag_id) return `${d.project}/${d.dag_id}`;
    return null;
  } catch {
    return null;
  }
}

function autoSelectSplit() {
  const r = state.split.route;
  if (r.legacy) {
    if (!r.run) {
      const list = legacyJobs();
      if (list.length) applyRouteOver({ run: `${list[0].sid}/${list[0].id}` });
    }
    return;
  }
  if (!r.dag && state.dags.length) {
    const g = state.dags[0];
    applyRouteOver({ dag: `${g.project}/${g.dag_id}` });
  }
  if (r.dag && !findGroupKey(r.dag) && state.dags.length) {
    const g = state.dags[0];
    applyRouteOver({ dag: `${g.project}/${g.dag_id}`, run: null });
  }
  if (r.dag && !r.run) {
    const g = findGroupKey(r.dag);
    if (g && g.latestRun) applyRouteOver({ run: `${g.latestRun.sid}/${g.latestRun.jid}` });
  }
}

function renderLeft() {
  const sp = state.split;
  const r = sp.route;
  const left = $("#split-left");
  if (!left) return;
  if (r.legacy) {
    left.innerHTML = `
      <div class="sp-head">
        <div class="sp-title-row"><h2>Legacy runs</h2><span class="chip kind">no dag</span></div>
        <div class="sp-sub-row">Jobs from before spur identity — they live in /api/jobs only and are never rendered as spurs. Pick one to inspect on the right.</div>
      </div>
      <div class="sp-body"><div id="legacy-list" class="runsel-list">${paneEmpty("loading…")}</div></div>`;
    renderLegacyList();
    return;
  }
  const g = findGroupKey(r.dag);
  const [pid, dagId] = splitKey(r.dag || "");
  const opts = state.dags.map((x) => {
    const key = `${x.project}/${x.dag_id}`;
    return `<option value="${esc(key)}"${key === r.dag ? " selected" : ""}>${esc(x.project_name || x.dag_id)}</option>`;
  }).join("");
  left.innerHTML = `
    <div class="sp-head">
      <div class="sp-title-row">
        ${g ? `<h2>${esc(g.project_name || g.dag_id)}</h2>` : `<h2 class="muted">…</h2>`}
        ${g ? kindChip(g.kind) : ""}
        ${g ? `<button class="trig" data-trig data-pid="${esc(pid)}" data-dag="${esc(dagId)}" title="Trigger run (runs the saved source)">▶</button>` : ""}
        ${state.dags.length ? `<select class="dagpick" id="dag-select" title="switch spur">${opts}</select>` : ""}
      </div>
      <div class="sp-sub-row mono">spur id <b>${esc(dagId)}</b>${g && g.source ? ` · <span title="${esc(g.source)}">${esc(shortenPath(g.source))}</span>` : ""}${g ? ` · ${g.runCount ?? (g.runs || []).length} runs` : ""}</div>
    </div>
    <nav class="sp-tabs">${LEFT_TABS.map((t) =>
      `<a class="sp-tab${t === r.tab ? " active" : ""}" href="${splitHref({ tab: t })}">${t}</a>`).join("")}</nav>
    <div class="sp-body" id="left-body">${paneEmpty("loading…")}</div>`;
  renderLeftBody();
}

function shortenPath(p) {
  const s = String(p || "");
  return s.length > 64 ? s.slice(0, 30) + "…" + s.slice(-30) : s;
}

function renderLeftBody() {
  const sp = state.split;
  const r = sp.route;
  if (r.legacy) { renderLegacyList(); return; }
  if (r.tab === "runs") renderRunsList();
  else if (r.tab === "diagram") renderDiagramBody();
  else if (r.tab === "config") renderConfigBody();
}

function runDurText(x) {
  if (x.durationMs != null) return humanAge(x.durationMs);
  const st = stOf(x.status || x.state);
  if ((st === "running" || st === "paused") && x.created) {
    return `${humanAge(createdElapsed(x.created))} so far`;
  }
  return "–";
}

function runSelHtml(key, status, created, dur) {
  const active = state.split.route.run === key;
  return `<button class="runsel${active ? " active" : ""}" data-run="${esc(key)}">
    ${stChip(status)}
    <span class="rs-time mono">${esc(fmtShortTs(created))}</span>
    <span class="rs-dur mono">${esc(dur)}</span>
  </button>`;
}

function renderRunsList() {
  const sp = state.split;
  const body = $("#left-body");
  if (!body) return;
  const g = findGroupKey(sp.route.dag);
  const runs = g ? (g.runs || []) : [];
  body.innerHTML = runs.length
    ? `<div class="runsel-list">${runs.map((run) =>
        runSelHtml(`${run.sid}/${run.jid || run.id}`, run.status || run.state, run.created, runDurText(run))).join("")}</div>`
    : paneEmpty("no runs yet — trigger one");
}

function renderLegacyList() {
  const el = $("#legacy-list");
  if (!el) return;
  const list = legacyJobs();
  el.innerHTML = list.length
    ? list.map((j) => runSelHtml(`${j.sid}/${j.id}`, j.status || j.state, j.created, runDurText(j))).join("")
    : paneEmpty("no legacy jobs");
}

function diagramStoreKey(dk) { return `ui4-diagram:${dk}`; }

function loadPositions(dk) {
  try {
    const raw = JSON.parse(localStorage.getItem(diagramStoreKey(dk)) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

function savePositions(dk, pos) {
  try { localStorage.setItem(diagramStoreKey(dk), JSON.stringify(pos)); } catch { /* quota */ }
}

function layoutGraph(nodes, edges) {
  const BW = 168, BH = 54, VGAP = 64, HGAP = 32;
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
  return pos;
}

function shortenCmd(cmd, max = 36) {
  const s = String(cmd || "");
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(-half);
}

function hookStripHtml(hooks) {
  if (!hooks || !hooks.length) return "";
  const chips = hooks.map((h) =>
    `<span class="hchip ${esc(h.section || "hooks")}" title="${esc(h.section || "hook")} · ${esc(h.command || "")}">` +
    `<span class="hsec">${esc(h.section || "hook")}</span>${esc(h.name)}` +
    (h.command ? `<span class="muted">· ${esc(shortenCmd(h.command))}</span>` : "") +
    `</span>`).join("");
  return `<div class="hookstrip">${chips}</div>`;
}

// hooks LIVE in the diagram now: a labeled rail across the top of the
// canvas, so "where is the hook" answers itself at a glance
function hooksRailHtml(hooks) {
  if (!hooks || !hooks.length) return "";
  return `<div class="g-hooks"><span class="g-hooks-label">hooks · detectors · gates</span>${hookStripHtml(hooks)}</div>`;
}

function renderDiagramBody() {
  const sp = state.split;
  const body = $("#left-body");
  if (!body) return;
  const dk = sp.route.dag;
  if (!dk) { body.innerHTML = paneEmpty("no spur selected"); return; }
  if (sp.defnKey !== dk) {
    sp.defnKey = dk;
    sp.defn = null;
    sp.defnError = null;
    body.innerHTML = paneEmpty("loading definition…");
    const seq = state.seq;
    const [pid, dagId] = splitKey(dk);
    fetchJSON(`/api/dag-definition/${enc(pid)}/${enc(dagId)}`)
      .then((res) => {
        if (!current(sp, seq) || sp.defnKey !== dk) return;
        sp.defn = res;
        if (sp.route.tab === "diagram") renderDiagramBody();
      })
      .catch((err) => {
        if (!current(sp, seq) || sp.defnKey !== dk) return;
        sp.defnError = err.message;
        if (sp.route.tab === "diagram") renderDiagramBody();
      });
    return;
  }
  if (sp.defnError) { body.innerHTML = paneEmpty(`definition failed: ${esc(sp.defnError)}`); return; }
  if (!sp.defn) { body.innerHTML = paneEmpty("loading definition…"); return; }
  drawDiagram(body, sp.defn, dk);
}

function drawDiagram(body, defn, dk) {
  const nodes = defn.nodes || [];
  const edges = (defn.edges || []).filter((e) =>
    nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const saved = loadPositions(dk);
  const defaults = layoutGraph(nodes, edges);
  const pos = {};
  nodes.forEach((n) => {
    const s = saved[n.id];
    pos[n.id] = Array.isArray(s) && s.length === 2 ? { x: Math.max(0, s[0]), y: Math.max(0, s[1]) } : defaults[n.id];
  });
  const W = Math.max(...nodes.map((n) => pos[n.id].x + 190), 300) + 24;
  const H = Math.max(...nodes.map((n) => pos[n.id].y + 100), 200) + 24;
  const staleBar = defn.stale ? `
    <div class="stale-bar" title="${esc(defn.stale.reason)}">
      <b>source folder gone</b> — showing the staged copy of run <span class="mono">${esc(defn.stale.fromRun)}</span>
      <span class="muted small">(sid ${esc(defn.stale.fromSid)} · ${esc(defn.stale.runDir)})</span>.
      This dag cannot be triggered or edited until a live source folder is back: <span class="mono small">${esc(defn.stale.reason)}</span>
    </div>` : "";
  body.innerHTML = `
    ${staleBar}
    <div class="shape-meta">kind: ${esc(defn.kind)} · ${nodes.length} node${nodes.length === 1 ? "" : "s"} · ${edges.length} edge${edges.length === 1 ? "" : "s"} · ${defn.stale ? "staged copy (read-only)" : "live from the dag source"} — drag to arrange (saved per dag) · click a node for its full brief${state.split.route.run ? " · ×N badges = relayed messages of the selected run" : ""}</div>
    <div class="diagram-view">
      ${hooksRailHtml(defn.hooks)}
      <div class="g-canvas" style="width:${W}px;height:${H}px" id="d-canvas">
        <svg class="d-svg" id="d-svg" width="${W}" height="${H}">
          <defs>
            <marker id="d-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f9cf9"></path>
            </marker>
          </defs>
        </svg>
        ${nodes.map((n) =>
          `<div class="g-node" data-node="${esc(n.id)}" style="left:${pos[n.id].x}px;top:${pos[n.id].y}px" title="${esc(n.id)} — click for the full brief">` +
          `<div class="g-id">${esc(n.id)}</div>` +
          (n.does ? `<div class="g-does">${esc(n.does)}</div>` : "") +
          (n.brief || n.does ? `<div class="g-open">brief ⌄</div>` : "") +
          `</div>`).join("")}
      </div>
    </div>
    <div id="node-pop-slot"></div>`;
  redrawEdges();
  bindNodeDrag(dk);
  // the selected run's live shape (×N relayed messages), on the 5s loop
  loadShape(state.seq);
}

// ----- live shape overlay (the diagram is a loop, not a one-shot) -----

// message tallies of the selected run, keyed "from->to"; a run that
// hasn't relayed yet (or a lab dag) yields an empty map harmlessly
function shapeTally() {
  const sp = state.split;
  const t = new Map();
  if (!sp || !sp.shape) return t;
  for (const e of sp.shape.edges || []) {
    if (e.messages > 0) t.set(`${e.from}->${e.to}`, e.messages);
  }
  return t;
}

function memberMailTotals(id) {
  const sp = state.split;
  let sent = 0, recv = 0;
  for (const e of (sp && sp.shape ? sp.shape.edges : []) || []) {
    if (e.from === id) sent += e.messages || 0;
    if (e.to === id) recv += e.messages || 0;
  }
  return { sent, recv };
}

async function loadShape(seq) {
  const sp = state.split;
  if (!sp) return;
  const runKey = sp.route.run;
  if (!runKey || sp.route.legacy) return;
  const [sid, jid] = splitKey(runKey);
  try {
    const res = await fetchJSON(`/api/dag-shape/${enc(sid)}/${enc(jid)}`);
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.shape = res;
    sp.shapeKey = runKey;
  } catch {
    sp.shape = null;
  }
  if (sp.route.tab === "diagram" && $("#d-canvas")) redrawEdges();
}

function nodeBox(canvas, id) {
  const el = canvas.querySelector(`[data-node="${CSS.escape(id)}"]`);
  if (!el) return null;
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

function borderPoint(box, towards) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = towards.x - cx, dy = towards.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const hw = box.w / 2 + 3, hh = box.h / 2 + 3;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

function redrawEdges() {
  const svg = $("#d-svg");
  const canvas = $("#d-canvas");
  const sp = state.split;
  if (!svg || !canvas || !sp || !sp.defn) return;
  svg.querySelectorAll("line.d-edge").forEach((el) => el.remove());
  canvas.querySelectorAll(".g-badge").forEach((el) => el.remove());
  // the drawn set = definition edges + the run's relay LOOP edges (a
  // from->to pair with traffic but no chain edge — e.g. frontend
  // answering back) so the exchange shows ×N in BOTH directions
  const all = [...(sp.defn.edges || [])];
  const seen = new Set(all.map((e) => `${e.from}->${e.to}`));
  for (const e of (sp.shape && sp.shape.edges) || []) {
    const k = `${e.from}->${e.to}`;
    if (!seen.has(k)) { seen.add(k); all.push({ from: e.from, to: e.to, loop: true }); }
  }
  const tally = shapeTally();
  for (const e of all) {
    const a = nodeBox(canvas, e.from), b = nodeBox(canvas, e.to);
    if (!a || !b) continue;
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = borderPoint(a, bc), p2 = borderPoint(b, ac);
    const n = tally.get(`${e.from}->${e.to}`) || 0;
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
    ln.setAttribute("x1", p1.x.toFixed(1));
    ln.setAttribute("y1", p1.y.toFixed(1));
    ln.setAttribute("x2", p2.x.toFixed(1));
    ln.setAttribute("y2", p2.y.toFixed(1));
    ln.setAttribute("class", "d-edge" + (n > 0 ? " has-msg" : "") + (e.loop ? " loop" : ""));
    ln.setAttribute("marker-end", "url(#d-arrow)");
    const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
    t.textContent = `${e.from} → ${e.to}` + (n > 0 ? ` · ${n} message${n === 1 ? "" : "s"} relayed` : "");
    ln.appendChild(t);
    svg.appendChild(ln);
    if (n > 0) {
      const badge = document.createElement("div");
      badge.className = "g-badge";
      badge.textContent = `×${n}`;
      badge.title = `${e.from} → ${e.to}: ${n} message${n === 1 ? "" : "s"} relayed by the selected run`;
      // a pair with traffic both ways shares one midpoint — split the
      // badges apart so both stay readable (chain above, reply below)
      const yOff = e.loop ? 16 : -10;
      badge.style.left = ((p1.x + p2.x) / 2).toFixed(1) + "px";
      badge.style.top = ((p1.y + p2.y) / 2 + yOff).toFixed(1) + "px";
      canvas.appendChild(badge);
    }
  }
}

function bindNodeDrag(dk) {
  const canvas = $("#d-canvas");
  if (!canvas) return;
  $$(".g-node", canvas).forEach((node) => {
    node.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { node.setPointerCapture(e.pointerId); } catch { /* ok */ }
      node.classList.add("dragging");
      const startX = e.clientX, startY = e.clientY;
      const ox = node.offsetLeft, oy = node.offsetTop;
      let moved = false;
      const move = (ev) => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
        node.style.left = Math.max(0, ox + ev.clientX - startX) + "px";
        node.style.top = Math.max(0, oy + ev.clientY - startY) + "px";
        redrawEdges();
      };
      const up = () => {
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.classList.remove("dragging");
        if (moved) {
          const all = {};
          $$(".g-node", canvas).forEach((n) => { all[n.dataset.node] = [n.offsetLeft, n.offsetTop]; });
          savePositions(dk, all);
        } else {
          // a press without movement is a click — open the node's brief
          openNodePopup(node.dataset.node);
        }
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
    });
  });
}

// ----- node detail popup: the box stays a box, the prompt gets a stage -----

function closeNodePopup() {
  const slot = $("#node-pop-slot");
  if (slot) slot.innerHTML = "";
}

function openNodePopup(id) {
  const sp = state.split;
  const slot = $("#node-pop-slot");
  if (!slot || !sp || !sp.defn) return;
  const n = (sp.defn.nodes || []).find((x) => x.id === id);
  if (!n) return;
  const mail = memberMailTotals(id);
  const runKey = sp.route.run;
  const brief = n.brief || n.does || null;
  slot.innerHTML = `
    <div class="node-pop" id="node-pop">
      <div class="node-pop-head">
        <span class="node-pop-id mono">${esc(id)}</span>
        <span class="chip kind">${esc(sp.defn.kind || "node")}</span>
        <span class="grow"></span>
        <button class="btn ghost" id="node-pop-close" title="close (Esc)">✕</button>
      </div>
      ${n.does ? `<div class="node-pop-does">${esc(n.does)}</div>` : ""}
      ${runKey ? `<div class="node-pop-mail">${mail.sent || mail.recv
        ? `<span class="ok">↗ ${mail.sent} sent</span> · <span class="ok">↘ ${mail.recv} received</span> <span class="muted small">— relayed messages in the selected run</span>`
        : `<span class="muted small">no relayed messages in the selected run${sp.shape ? "" : " (shape not loaded)"}</span>`}</div>` : ""}
      ${brief
        ? `<div class="node-pop-body"><div class="node-pop-label">full brief</div><pre>${esc(brief)}</pre></div>`
        : `<div class="node-pop-body"><span class="muted small">no brief recorded for this node</span></div>`}
    </div>`;
  $("#node-pop-close").addEventListener("click", closeNodePopup);
  const pop = $("#node-pop");
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function programNameOk(name) {
  return typeof name === "string" && !!name && !name.includes("..") &&
    !name.startsWith("/") && !name.includes("\\") &&
    /^(workflow\.toml|task\.txt|roots\.txt|project\.json|members\/[^\/]+\.md|hooks\/[^\/]+)$/.test(name);
}

function isDirty(p, name) {
  return name in p.texts && p.texts[name] !== p.orig[name];
}

function renderConfigBody() {
  const sp = state.split;
  const body = $("#left-body");
  if (!body) return;
  const dk = sp.route.dag;
  if (!dk) { body.innerHTML = paneEmpty("no spur selected"); return; }
  if (!sp.program || sp.program.dagKey !== dk) {
    sp.program = { dagKey: dk, files: null, picked: null, texts: {}, orig: {}, loadError: null, error: null, unlocked: false };
  }
  const p = sp.program;
  if (p.error) { body.innerHTML = paneEmpty(`config unavailable: ${esc(p.error)}`); return; }
  if (!p.files) {
    body.innerHTML = paneEmpty("loading program files…");
    const seq = state.seq;
    fetchJSON(`/api/program?dag=${enc(dk)}`)
      .then((res) => {
        if (!current(sp, seq) || !sp.program || sp.program.dagKey !== dk) return;
        p.files = res.files || [];
        renderConfigBody();
      })
      .catch((err) => {
        if (!current(sp, seq) || !sp.program || sp.program.dagKey !== dk) return;
        p.error = err.message;
        renderConfigBody();
      });
    return;
  }
  const listHtml = p.files.map((f) => {
    const dirty = p.picked === f.name && isDirty(p, f.name);
    return `<button class="cfg-file${p.picked === f.name ? " active" : ""}" data-cfgpick="${esc(f.name)}">` +
      `<span>${esc(f.name)}</span>` +
      `<span class="cfg-fmeta">${dirty ? `<span class="dirty-dot">●</span> ` : ""}${f.bytes} B</span></button>`;
  }).join("");
  let edHtml;
  if (!p.picked) {
    edHtml = paneEmpty("pick a program file");
  } else if (!(p.picked in p.orig)) {
    edHtml = paneEmpty(p.loadError ? `failed to load ${esc(p.picked)}: ${esc(p.loadError)}` : `loading ${esc(p.picked)}…`);
  } else {
    const dirty = isDirty(p, p.picked);
    edHtml = `
      <div class="cfg-edhead">
        <span class="cfg-name mono">${esc(p.picked)}</span>
        <span class="muted small" id="cfg-meta">${(p.orig[p.picked] || "").length} B${p.unlocked && dirty ? ` · <span class="dirty-dot">edited — not saved</span>` : p.unlocked ? "" : " · read-only"}</span>
      </div>
      <textarea id="cfg-text" class="mono" spellcheck="false"${p.unlocked ? "" : " disabled"}></textarea>
      <div class="cfg-actions">
        ${p.unlocked
          ? `<button class="btn primary" id="cfg-save">Save</button>
             <button class="btn" id="cfg-rwe">Run with edits</button>
             <button class="btn ghost" id="cfg-revert">Revert</button>
             <button class="btn ghost" id="cfg-lock">Done</button>`
          : `<button class="btn warn" id="cfg-edit">Edit</button>`}
        <span class="cfg-hint">${p.unlocked
          ? `<b>Save</b> writes the file into the spur's source folder (persists) · <b>Run with edits</b> = one-time copy-run, nothing saved · <b>Done</b> locks again`
          : `Program files are read-only — press <b>Edit</b> to unlock this textarea.`}</span>
      </div>`;
  }
  body.innerHTML = `<div class="cfg-files">${listHtml || paneEmpty("no files")}</div>${edHtml}`;
  const ta = $("#cfg-text");
  if (ta) {
    ta.value = p.texts[p.picked] ?? p.orig[p.picked];
    if (p.unlocked) {
      ta.addEventListener("input", () => {
        p.texts[p.picked] = ta.value;
        updateCfgMeta();
      });
      $("#cfg-save").addEventListener("click", cfgSave);
      $("#cfg-rwe").addEventListener("click", cfgRunWithEdits);
      $("#cfg-revert").addEventListener("click", () => {
        p.texts[p.picked] = p.orig[p.picked];
        renderConfigBody();
      });
      $("#cfg-lock").addEventListener("click", () => {
        p.unlocked = false;
        renderConfigBody();
      });
    } else {
      $("#cfg-edit").addEventListener("click", () => {
        p.unlocked = true;
        renderConfigBody();
      });
    }
  }
  $$("[data-cfgpick]", body).forEach((b) => {
    b.addEventListener("click", () => pickCfgFile(b.dataset.cfgpick));
  });
}

function updateCfgMeta() {
  const p = state.split && state.split.program;
  if (!p || !(p.picked in p.orig)) return;
  const meta = $("#cfg-meta");
  if (meta) {
    meta.innerHTML = `${(p.texts[p.picked] || "").length} B${isDirty(p, p.picked) ? ` · <span class="dirty-dot">edited — not saved</span>` : ""}`;
  }
}

async function pickCfgFile(name) {
  const sp = state.split;
  const p = sp.program;
  if (!p || p.picked === name) return;
  p.picked = name;
  p.loadError = null;
  if (!(name in p.orig)) {
    renderConfigBody();
    const seq = state.seq;
    try {
      const res = await fetchJSON(`/api/program?dag=${enc(sp.route.dag)}&name=${enc(name)}`);
      if (!current(sp, seq)) return;
      p.orig[name] = res.text;
      if (!(name in p.texts)) p.texts[name] = res.text;
    } catch (err) {
      if (!current(sp, seq)) return;
      p.loadError = err.message;
    }
  }
  if (state.split.route.tab === "config") renderConfigBody();
}

async function cfgSave() {
  const sp = state.split;
  const p = sp.program;
  const name = p.picked;
  const ta = $("#cfg-text");
  if (!ta || !programNameOk(name)) {
    showToast(`refused: ${name} is not an editable program file`, "err");
    return;
  }
  const text = ta.value;
  p.texts[name] = text;
  if (!confirm(`Save ${name} into the spur's source folder?\n\nThis is a real write to disk.`)) return;
  const btn = $("#cfg-save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetchJSON("/api/program", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dag: sp.route.dag, name, text }),
    });
    p.orig[name] = text;
    const f = (p.files || []).find((x) => x.name === name);
    if (f && res.bytes != null) f.bytes = res.bytes;
    showToast(`saved ${name} → source (${res.bytes ?? "?"} bytes) — persisted; ▶ Trigger run to use it`, "ok");
  } catch (err) {
    showToast(`save failed:\n${err.message}`, "err");
  }
  if (state.split && state.split.route.tab === "config") renderConfigBody();
}

async function cfgRunWithEdits() {
  const sp = state.split;
  const p = sp.program;
  const changed = (p.files || []).filter((f) => isDirty(p, f.name))
    .map((f) => ({ name: f.name, text: p.texts[f.name] }));
  if (!changed.length) {
    showToast("no unsaved edits — use ▶ Trigger run to run the saved source", "err");
    return;
  }
  if (changed.some((f) => !programNameOk(f.name))) {
    showToast("refused: a file name is outside the editable whitelist", "err");
    return;
  }
  if (!confirm(`Run once with ${changed.length} edited file${changed.length === 1 ? "" : "s"}?\n\nA one-time copy of the dag will run with your edits. Nothing is saved.`)) return;
  const btn = $("#cfg-rwe");
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    const res = await fetchJSON(`/api/dags/${enc(splitKey(sp.route.dag)[0])}/${enc(splitKey(sp.route.dag)[1])}/run-with-edits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: changed }),
    });
    const jobLine = (res.lines || []).find((l) => l.startsWith("job:")) || "";
    showToast([`one-time copy-run with ${changed.length} edited file${changed.length === 1 ? "" : "s"} — nothing saved`, jobLine || res.reason || ""]
      .filter(Boolean).join("\n"), "ok");
  } catch (err) {
    showToast(`run with edits failed:\n${err.message}`, "err");
  }
  if (state.split && state.split.route.tab === "config") renderConfigBody();
}

function fallbackRun(sid, jid) {
  for (const g of state.dags) {
    for (const run of g.runs || []) {
      if (run.sid === sid && (run.jid || run.id) === jid) return run;
    }
  }
  for (const j of state.jobs) {
    if (j.sid === sid && j.id === jid) return j;
  }
  return null;
}

function renderRight() {
  const sp = state.split;
  const r = sp.route;
  const right = $("#split-right");
  if (!right) return;
  right.innerHTML = `
    <div class="sp-head" id="right-head"></div>
    <nav class="sp-tabs">${RIGHT_TABS.map((t) =>
      `<a class="sp-tab${t === r.rtab ? " active" : ""}" href="${splitHref({ rtab: t })}">${t}</a>`).join("")}</nav>
    <div class="sp-body" id="right-body"></div>`;
  renderRightHead();
  renderRightBody();
}

function renderRightHead() {
  const sp = state.split;
  const r = sp.route;
  const head = $("#right-head");
  if (!head) return;
  if (!r.run) {
    head.innerHTML = `<div class="sp-title-row"><h2 class="muted" style="font-size:15px">no run selected</h2></div>
      <div class="sp-sub-row">${r.legacy ? "pick a legacy run on the left" : "no runs yet — trigger one from the left"}</div>`;
    return;
  }
  const [sid, jid] = splitKey(r.run);
  const fb = fallbackRun(sid, jid);
  const job = sp.job && sp.job.sid === sid && sp.job.id === jid ? sp.job : fb;
  const status = job ? (job.status || job.state) : null;
  const legacy = r.legacy || !r.dag;
  head.innerHTML = `
    <div class="sp-title-row">
      <h2 class="mono" style="font-size:15px">${esc(jid)}</h2>
      ${status ? stChip(status) : `<span class="muted small">…</span>`}
      ${legacy ? `<span class="chip kind" title="before spur identity">legacy</span>` : ""}
      <span class="grow"></span>
      ${status ? opsButtonsHtml(stOf(status), sid, jid) : ""}
    </div>
    <div class="sp-sub-row mono">sid <b>${esc(sid)}</b>${job && job.created ? ` · ${esc(fmtShortTs(job.created))} → ${job.finished ? esc(fmtShortTs(job.finished)) : "…"}` : ""}${job && job.durationMs != null ? ` · ${esc(humanAge(job.durationMs))}` : ""}</div>`;
}

function renderRightBody() {
  const sp = state.split;
  const r = sp.route;
  const body = $("#right-body");
  if (!body) return;
  if (!r.run) {
    body.innerHTML = paneEmpty(r.legacy ? "pick a legacy run on the left" : "no runs yet — trigger one from the left");
    return;
  }
  if (r.rtab === "receipt") {
    if (sp.jobLoadedKey !== r.run) {
      body.innerHTML = paneEmpty("loading run…");
      loadJob(state.seq);
      return;
    }
    body.innerHTML = receiptBodyHtml();
    return;
  }
  if (r.rtab === "report") {
    if (sp.treeLoadedKey !== r.run) {
      body.innerHTML = paneEmpty("loading run dir…");
      loadRunDir(state.seq);
      return;
    }
    body.innerHTML = reportBodyHtml();
    return;
  }
  if (r.rtab === "events") {
    const runKey = r.run;
    const st = splitRunState(runKey);
    const streaming = !!sp.es && sp.esKey === runKey;
    if (st === "running" || streaming) {
      // live run: EventSource owns updates — no polling, appends only
      openEventsStream(runKey);
      const box0 = evScrollEl();
      const nearBottom = !box0 || box0.scrollHeight === 0 ||
        box0.scrollTop + box0.clientHeight >= box0.scrollHeight - 60;
      const have = Array.isArray(sp.events);
      body.innerHTML = eventsShellHtml(have);
      const box = evScrollEl();
      if (box && nearBottom && have) box.scrollTop = box.scrollHeight;
      return;
    }
    // finished (or not yet known) run: one-shot immutable history, as v4
    if (sp.eventsLoadedKey !== runKey) {
      body.innerHTML = paneEmpty("loading events…");
      loadEvents(state.seq);
      return;
    }
    const box0 = evScrollEl();
    const nearBottom = !box0 || box0.scrollHeight === 0 ||
      box0.scrollTop + box0.clientHeight >= box0.scrollHeight - 60;
    const wasTop = box0 ? box0.scrollTop : 0;
    body.innerHTML = eventsBodyHtml();
    const box = evScrollEl();
    if (box) box.scrollTop = nearBottom ? box.scrollHeight : wasTop;
  }
}

async function loadJob(seq) {
  const sp = state.split;
  const runKey = sp.route.run;
  if (!runKey) return;
  const [sid, jid] = splitKey(runKey);
  try {
    const res = await fetchJSON(`/api/job/${enc(sid)}/${enc(jid)}`);
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.job = res.job;
    sp.jobError = null;
    sp.jobLoadedKey = runKey;
  } catch (err) {
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.jobError = err.message;
    sp.jobLoadedKey = runKey;
  }
  if (sp.route.rtab === "receipt") {
    renderRightHead();
    renderRightBody();
  } else if (sp.route.rtab === "events" && sp.evSideMember) {
    // pane facts just landed — refresh the member card holding them
    renderMemberCard(sp.evSideMember);
  }
}

function receiptBodyHtml() {
  const sp = state.split;
  if (sp.jobError && !sp.job) return paneEmpty(`failed to load run: ${esc(sp.jobError)}`);
  const job = sp.job;
  if (!job) return paneEmpty("loading run…");
  const dur = job.durationMs != null
    ? humanAge(job.durationMs)
    : (job.state === "running" ? `${humanAge(createdElapsed(job.created))} so far` : "–");
  let outcome;
  if (job.receipt) {
    const rc = job.receipt;
    outcome = `
      <dt>receipt</dt><dd class="${rc.status === "ok" ? "ok" : "warn"}">${esc(rc.status || "–")}</dd>
      <dt>panes</dt><dd>${rc.panesRemaining} remaining / ${rc.panesTotal} total</dd>
      <dt>units</dt><dd><span class="ok">${rc.unitsDone ?? 0} done</span> · <span class="bad">${rc.unitsFailed ?? 0} failed</span></dd>
      <dt>report</dt><dd>${esc(rc.report || "–")}</dd>
      <dt>receipt finished</dt><dd>${esc(fmtTs(rc.finished))}</dd>`;
  } else if (job.abort) {
    outcome = `
      <dt>abort</dt><dd class="bad">${esc(job.abort.reason || "–")}</dd>
      ${job.abort.actor ? `<dt>aborted by</dt><dd>${esc(job.abort.actor)} <span class="muted small">— the actor on the trace's job.aborted event (who called it)</span></dd>` : `<dt>aborted by</dt><dd class="muted">not booked on the trace</dd>`}
      <dt>panes remaining</dt><dd>${esc(job.abort.panesRemaining ?? "–")}</dd>
      <dt>finished</dt><dd>${esc(fmtTs(job.abort.finished))}</dd>`;
  } else if (job.orphan) {
    outcome = `
      <dt>orphaned</dt><dd class="warn">${esc(job.orphan.reason || "–")}</dd>
      <dt>at</dt><dd>${esc(fmtTs(job.orphan.at))}</dd>`;
  } else if (job.pause) {
    outcome = `
      <dt>paused</dt><dd class="warn">${esc(job.pause.reason || "–")}</dd>
      ${job.pause.actor ? `<dt>paused by</dt><dd>${esc(job.pause.actor)}</dd>` : ""}
      <dt>panes remaining</dt><dd>${esc(job.pause.panesRemaining ?? "–")}</dd>
      <dt>paused at</dt><dd>${esc(fmtTs(job.pause.at))}</dd>`;
  } else {
    outcome = `<dt>receipt</dt><dd class="warn">none yet — job in flight</dd>`;
  }
  if (job.continues) {
    outcome += `<dt>continued</dt><dd><span class="cont-badge" title="times this run was continued back">x${esc(job.continues)}</span></dd>`;
  }
  const dagRow = job.dag && job.dag.project_name !== "-"
    ? `<dt>spur</dt><dd>${esc(job.dag.project_name)} / ${esc(job.dag.dag_id)}</dd>
       <dt>version</dt><dd>${esc(job.dag.content_hash || "–")}</dd>`
    : `<dt>spur</dt><dd class="muted">none — legacy run (before spur identity)</dd>`;
  const labels = job.labels || {};
  return `
    <section class="d-section">
      <h3>run</h3>
      <dl class="kv">
        <dt>status</dt><dd>${stChip(job.status || job.state)} <span class="muted small">state: ${esc(job.state)}</span></dd>
        <dt>task</dt><dd>${esc(job.task || "–")}</dd>
        <dt>workflow</dt><dd>${esc(job.workflow)}</dd>
        <dt>stood up by</dt><dd>${esc(job.stoodUpBy || "–")}</dd>
        <dt>pid</dt><dd>${esc(job.pid ?? "–")}</dd>
        <dt>created</dt><dd>${esc(fmtTs(job.created))}</dd>
        <dt>finished</dt><dd>${esc(job.finished ? fmtTs(job.finished) : "–")}</dd>
        <dt>duration</dt><dd>${esc(dur)}</dd>
        ${dagRow}
        <dt>panes</dt><dd><span class="bad">${job.panes?.dead ?? 0}</span> dead / ${job.panes?.total ?? 0} total</dd>
        <dt>dir</dt><dd>${esc(job.dir || "–")}</dd>
        ${Object.keys(labels).length ? `<dt>labels</dt><dd>${labelChips(labels)}</dd>` : ""}
      </dl>
    </section>
    <section class="d-section">
      <h3>outcome</h3>
      <dl class="kv">${outcome}</dl>
    </section>`;
}

async function loadRunDir(seq) {
  const sp = state.split;
  const runKey = sp.route.run;
  if (!runKey) return;
  const [sid, jid] = splitKey(runKey);
  try {
    const res = await fetchJSON(`/api/run-dir/${enc(sid)}/${enc(jid)}`);
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.tree = res.tree || [];
    sp.treeError = null;
    sp.treeLoadedKey = runKey;
  } catch (err) {
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.treeError = err.message;
    sp.treeLoadedKey = runKey;
  }
  try {
    const res = await fetchJSON(`/api/run-dir/${enc(sid)}/${enc(jid)}?path=${enc("report.json")}`);
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    if (res.binary) { sp.report = null; sp.reportNote = "report.json is binary"; }
    else {
      try { sp.report = JSON.parse(res.text); sp.reportNote = null; }
      catch { sp.report = null; sp.reportNote = "report.json is not valid JSON"; }
    }
  } catch (err) {
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.report = null;
    sp.reportNote = `no report.json in this run dir (${err.message})`;
  }
  if (sp.route.rtab === "report") renderRightBody();
}

function treeNodeHtml(node, rel, depth) {
  const path = rel ? `${rel}/${node.name}` : node.name;
  if (node.type === "dir") {
    const kids = (node.children || []).map((c) => treeNodeHtml(c, path, depth + 1)).join("");
    return `<details${depth < 1 ? " open" : ""}><summary>${esc(node.name)}/</summary><ul>${kids}</ul></details>`;
  }
  if (node.type === "link") {
    return `<div class="trow" style="cursor:default"><span class="ticon link">↗</span><span class="tname">${esc(node.name)}</span><span class="tmeta">link — not followed</span></div>`;
  }
  const active = state.split.filePath === path ? " active" : "";
  return `<button class="trow${active}" data-file="${esc(path)}"><span class="ticon">·</span><span class="tname">${esc(node.name)}</span><span class="tmeta">${node.bytes != null ? `${node.bytes} B` : ""}</span></button>`;
}

function reportPrettyHtml() {
  const sp = state.split;
  const rep = sp.report;
  if (!rep || typeof rep !== "object") {
    return `<div class="report-pretty"><h3 style="margin:0 0 8px" class="d-section-title">report.json</h3><span class="muted small">${esc(sp.reportNote || "no report parsed")}</span></div>`;
  }
  const table = Array.isArray(rep.table) ? rep.table : [];
  const kvRows = [];
  for (const [k, v] of Object.entries(rep)) {
    if (k === "table") continue;
    kvRows.push(`<dt>${esc(k)}</dt><dd>${esc(typeof v === "string" ? v : JSON.stringify(v))}</dd>`);
  }
  return `<div class="report-pretty">
    <div class="d-section"><h3>report.json</h3>
      <dl class="kv">${kvRows.join("")}</dl>
      ${table.length ? `<table class="mini-table"><thead><tr><th>unit</th><th>result</th></tr></thead><tbody>${table.map((row) =>
        `<tr><td>${esc(row.unit)}</td><td class="${String(row.result).startsWith("ok") ? "ok" : "bad"}">${esc(row.result)}</td></tr>`).join("")}</tbody></table>` : ""}
    </div>
  </div>`;
}

function filePanelHtml() {
  const sp = state.split;
  if (!sp.filePath) {
    return `<div class="file-view"><div class="empty">click a file to view it</div></div>`;
  }
  if (sp.fileLoading && !sp.fileData) {
    return `<div class="file-view"><div class="empty">loading ${esc(sp.filePath)}…</div></div>`;
  }
  const d = sp.fileData || {};
  const notes = [];
  if (d.binary) notes.push("binary file — no text preview");
  if (d.truncated) notes.push(`truncated at ${d.text ? d.text.length + " chars" : "cap"}`);
  if (d.error) notes.push(d.error);
  return `<div class="file-view">
    <div class="file-view-head">
      <span class="fpath">${esc(sp.filePath)}</span>
      ${d.bytes != null ? `<span class="tmeta">${d.bytes} B</span>` : ""}
      ${notes.map((n) => `<span class="fnote">${esc(n)}</span>`).join("")}
    </div>
    ${d.binary ? "" : `<pre>${esc(d.text ?? "")}</pre>`}
  </div>`;
}

function reportBodyHtml() {
  const sp = state.split;
  const treeHtml = sp.tree
    ? `<div class="tree">${sp.tree.map((n) => treeNodeHtml(n, "", 0)).join("") || '<span class="muted small">empty run dir</span>'}</div>`
    : paneEmpty("loading run dir…");
  return `
    <div class="rpt-report">${reportPrettyHtml()}</div>
    <div class="rpt-browse">
      <div id="tree-panel">${treeHtml}</div>
      <div id="file-panel">${filePanelHtml()}</div>
    </div>`;
}

async function loadFile(path) {
  const sp = state.split;
  const runKey = sp.route.run;
  if (!runKey) return;
  sp.filePath = path;
  const hit = sp.fileCache[path];
  if (hit) {
    sp.fileData = hit;
    sp.fileLoading = false;
    const panel = $("#file-panel");
    if (panel) panel.innerHTML = filePanelHtml();
    return;
  }
  sp.fileData = null;
  sp.fileLoading = true;
  const panel = $("#file-panel");
  if (panel) panel.innerHTML = filePanelHtml();
  const [sid, jid] = splitKey(runKey);
  const seq = state.seq;
  try {
    const res = await fetchJSON(`/api/run-dir/${enc(sid)}/${enc(jid)}?path=${enc(path)}`);
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.fileCache[path] = res;
    sp.fileData = res;
    sp.fileLoading = false;
  } catch (err) {
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.fileData = { error: err.message };
    sp.fileLoading = false;
  }
  const p2 = $("#file-panel");
  if (p2) p2.innerHTML = filePanelHtml();
}

async function loadEvents(seq) {
  const sp = state.split;
  const runKey = sp.route.run;
  if (!runKey) return;
  const [sid, jid] = splitKey(runKey);
  // a finished run's events are immutable history — fetch once, never churn
  if (sp.eventsLoadedKey === runKey && splitRunState(runKey) !== "running") return;
  try {
    const res = await fetchJSON(`/api/events?sid=${enc(sid)}&jid=${enc(jid)}`);
    if (!current(sp, seq)) return;
    sp.events = res.events || [];
    sp.eventsError = null;
    sp.eventsLoadedKey = runKey;
  } catch (err) {
    if (!current(sp, seq)) return;
    sp.eventsError = err.message;
    sp.eventsLoadedKey = runKey;
  }
  if (sp.route.rtab === "events") {
    // stream-like: remember where the reader was; stick to the tail
    // only if they were at the tail, never yank them to the top
    const el = evScrollEl();
    const was = el ? { top: el.scrollTop, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40 } : null;
    renderRightBody();
    if (el && was) el.scrollTop = was.atBottom ? el.scrollHeight : was.top;
  }
}

// the selected run's status vocabulary, from whichever list holds it
function splitRunState(key) {
  const sp = state.split;
  if (!sp) return null;
  const g = findGroupKey(sp.route.dag);
  const run = g && (g.runs || []).find((x) => `${x.sid}/${x.jid || x.id}` === key);
  if (run) return stOf(run.status || run.state);
  const j = (legacyJobs() || []).find((x) => `${x.sid}/${x.id}` === key);
  return j ? stOf(j.status || j.state) : null;
}

// ----- events: a labeled table (columns + per-kind color), split with a
// detail side — click a row for the full event, a chip (member, pane,
// message file) to trace WHO said WHAT

const EV_KIND_PALETTE = {
  "job.born": "#a78bfa",
  admit: "#38bdf8",
  "pane.born": "#34d399",
  "pane.died": "#f87171",
  relay: "#93c5fd",
  permission: "#fbbf24",
  reprompt: "#c4b5fd",
  "job.retired": "#34d399",
  "job.aborted": "#f472b6",
  "job.paused": "#a5b4fc",
  "job.continued": "#38bdf8",
  "job.orphaned": "#fbbf24",
};

// every event kind gets a color — named kinds by hand, unknown kinds a
// stable hash so a new kind is still readable at a glance
function kindColor(kind) {
  const key = String(kind || "?");
  if (EV_KIND_PALETTE[key]) return EV_KIND_PALETTE[key];
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 68%)`;
}

function entChip(type, name, title) {
  return `<button class="ev-ent" data-ev-ent="${esc(type)}:${esc(name)}" title="${esc(title || name)}">${esc(name)}</button>`;
}

function evDetailHtml(ev) {
  const bits = [];
  if (ev.from && ev.to) bits.push(`${entChip("member", ev.from, `member ${ev.from} — click to trace its mail`)} → ${entChip("member", ev.to, `member ${ev.to} — click to trace its mail`)}`);
  if (ev.file) bits.push(entChip("msg", ev.file, `relay message ${ev.file} — click to read it`));
  if (ev.member) bits.push(entChip("member", ev.member, `member ${ev.member} — click to trace its mail`));
  if (ev.label) bits.push(entChip("pane", ev.label, `pane ${ev.label} — click for the pane card`));
  else if (ev.pane) bits.push(`<span class="ev-txt mono">${esc(ev.pane)}</span>`);
  if (ev.decision) {
    bits.push(`<span class="ev-dec d-${esc(ev.decision)}" title="permission decision">${esc(ev.decision)}</span>`);
    if (ev.path) bits.push(`<span class="ev-txt mono" title="${esc(ev.path)}">${esc(shortenCmd(ev.path, 56))}</span>`);
    if (ev.ask != null) bits.push(`<span class="ev-txt muted">ask ${esc(ev.ask)}</span>`);
  }
  if (ev.nudge != null) bits.push(`<span class="ev-txt muted">nudge ${esc(ev.nudge)}</span>`);
  if (ev.reason) bits.push(`<span class="ev-txt ev-reason" title="reason">${esc(ev.reason)}</span>`);
  if (ev.workflow) bits.push(`<span class="ev-txt muted">${esc(ev.workflow)}</span>`);
  if (ev.parent) bits.push(`<span class="ev-txt muted">parent ${esc(ev.parent)}</span>`);
  if (ev.unit) bits.push(`<span class="ev-txt muted">${esc(ev.unit)}</span>`);
  if (ev.task) bits.push(`<span class="ev-txt ev-task" title="${esc(ev.task)}">${esc(shortenCmd(ev.task, 64))}</span>`);
  return bits.join(" ");
}

function evLine(ev, i) {
  const sel = state.split && state.split.evSel === i ? " sel" : "";
  return `<div class="ev-line${sel}" data-evi="${i}">` +
    `<span class="ev-ts">${esc(fmtShortTs(ev.ts))}</span>` +
    `<span class="ev-kind" style="color:${kindColor(ev.kind)}">${esc(ev.kind || "?")}</span>` +
    `<span class="ev-actor">${esc(ev.actor || "")}</span>` +
    `<span class="ev-run mono">${ev.jid ? esc(ev.jid) : ""}</span>` +
    `<span class="ev-detail">${evDetailHtml(ev)}</span>` +
    `</div>`;
}

function evHeadHtml() {
  return `<div class="ev-head">` +
    `<span>time</span><span>event</span><span>actor</span><span>run</span>` +
    `<span>detail — click a row for the full record, a chip to trace it</span></div>`;
}

function evSplitShell(linesHtml, sideHtml) {
  return `<div class="ev-wrap">
    <div class="ev-split">
      <div class="ev-log">
        ${evHeadHtml()}
        <div class="events tall" id="ev-box">${linesHtml}</div>
      </div>
      <aside class="ev-side" id="ev-side">${sideHtml}</aside>
    </div>
  </div>`;
}

const EV_SIDE_EMPTY = `<div class="ev-side-hint">
  <b>trace pane</b>
  <div>Click an event row for its full record — every field, transcript pointers included.</div>
  <div>Click a <span class="ev-ent">member</span> chip to see its mail (what it sent and received).</div>
  <div>Click a <span class="ev-ent">1-backend.json</span> chip to read the relayed message itself.</div>
</div>`;

function eventsBodyHtml() {
  const sp = state.split;
  if (sp.eventsError && !sp.events) return paneEmpty(`events failed: ${esc(sp.eventsError)}`);
  if (!sp.events) return paneEmpty("loading events…");
  return evSplitShell(sp.events.map((ev, i) => evLine(ev, i)).join("") ||
    '<span class="muted" data-ev-empty>no events</span>', sp.evSideHtml || EV_SIDE_EMPTY);
}

function eventsShellHtml(have) {
  const sp = state.split;
  const empty = `<span class="muted" data-ev-empty>${sp.es ? "connecting to live events…" : "loading events…"}</span>`;
  const lines = have ? (sp.events.map((ev, i) => evLine(ev, i)).join("") || empty) : empty;
  return `<div class="ev-live"><span class="ev-dot"></span>live` +
    `<span id="ev-reconnecting" class="hidden"> — reconnecting…</span></div>` +
    evSplitShell(lines, sp.evSideHtml || EV_SIDE_EMPTY);
}

// the log column's scroll element — the stick-to-tail law lives here now
function evScrollEl() { return $("#ev-box"); }

// ----- the trace side pane: full records, member mail, message bodies -----

function setEvSide(html) {
  const sp = state.split;
  if (!sp) return;
  sp.evSideHtml = html;
  const el = $("#ev-side");
  if (el) { el.innerHTML = html; el.scrollTop = 0; }
}

function fmtJson(v) {
  try {
    const s = JSON.stringify(v, null, 2);
    return s && s.length > 4000 ? s.slice(0, 4000) + "\n…" : (s ?? "–");
  } catch { return "–"; }
}

function objRows(v) {
  return `<pre class="ev-json">${esc(fmtJson(v))}</pre>`;
}

function selectEvent(i) {
  const sp = state.split;
  if (!sp || !Array.isArray(sp.events)) return;
  sp.evSel = i;
  $$("#ev-box .ev-line").forEach((el) => el.classList.toggle("sel", Number(el.dataset.evi) === i));
  const ev = sp.events[i];
  if (!ev) return;
  const skip = new Set(["ts", "kind", "sid"]);
  const rows = [];
  for (const [k, v] of Object.entries(ev)) {
    if (skip.has(k)) continue;
    const val = v != null && typeof v === "object" ? objRows(v) : esc(v ?? "–");
    rows.push(`<dt>${esc(k)}</dt><dd>${val}</dd>`);
  }
  let extra = "";
  if (ev.file) {
    extra = `<div id="ev-msg" class="ev-msg"><div class="muted small">loading ${esc(ev.file)}…</div></div>`;
  } else if (ev.member) {
    extra = `<button class="btn" id="ev-side-member" data-ev-ent="member:${esc(ev.member)}" style="margin-top:10px">trace ${esc(ev.member)}'s mail</button>`;
  }
  setEvSide(`
    <div class="ev-side-head">
      <span class="ev-side-kind" style="color:${kindColor(ev.kind)}">${esc(ev.kind || "?")}</span>
      <span class="muted small">${esc(fmtTs(ev.ts))}</span>
    </div>
    <dl class="kv ev-side-kv">${rows.join("")}</dl>
    ${extra}`);
  // only now does #ev-msg exist for the renderer to fill
  if (ev.file) loadMessage(ev.file);
}

// every relay message this member sent or received, straight from the
// run's own events (no extra fetch — the trace IS the source)
function memberMail(name) {
  const sp = state.split;
  const out = [];
  (sp.events || []).forEach((ev, i) => {
    if (ev.kind !== "relay") return;
    if (ev.from === name || ev.to === name) out.push({ i, ev });
  });
  return out;
}

function renderMemberCard(name) {
  const sp = state.split;
  if (!sp) return;
  sp.evSideMember = name;
  const mail = memberMail(name);
  // panes of this member: labels look like "<member>-<suffix>"
  const panes = [];
  if (sp.job && Array.isArray(sp.job.panes && sp.job.panes.rows)) {
    for (const p of sp.job.panes.rows) {
      if ((p.label || "").split("-")[0] === name || p.label === name) panes.push(p);
    }
  }
  const mailHtml = mail.length ? mail.map(({ i, ev }) =>
    `<button class="ev-mailrow" data-ev-ent="msg:${esc(ev.file)}" data-evi="${i}" title="${esc(fmtTs(ev.ts))} — click to read the message">` +
    `<span class="mono muted small">${esc(fmtShortTs(ev.ts))}</span>` +
    `<span class="ev-maildir">${esc(ev.from)} → ${esc(ev.to)}</span>` +
    `<span class="mono">${esc(ev.file)}</span></button>`).join("")
    : `<div class="muted small" style="padding:6px 0">no relayed messages ${esc(name)} was part of</div>`;
  const panesHtml = panes.length ? panes.map((p) => `
    <div class="ev-paneinfo">
      <div><span class="mono">${esc(p.label || "–")}</span>${p.pane ? ` <span class="muted small mono">pane ${esc(p.pane)}</span>` : ""}</div>
      <div class="muted small">${esc(fmtTs(p.born))} → ${p.died ? esc(fmtTs(p.died)) : '<span class="ok">alive</span>'}</div>
      ${p.tool ? `<div class="muted small mono">${esc(p.tool)} · ${esc(p.cwd || "")}</div>` : ""}
    </div>`).join("") : "";
  setEvSide(`
    <div class="ev-side-head">
      <span class="ev-side-kind">member</span>
      <b class="mono" style="font-size:14px">${esc(name)}</b>
    </div>
    <div class="node-pop-label">mail — relayed messages (${mail.length})</div>
    ${mailHtml}
    ${panesHtml ? `<div class="node-pop-label" style="margin-top:12px">panes of this member</div>${panesHtml}` : ""}
    ${!panesHtml && sp.route.run ? `<div class="muted small" style="margin-top:10px">pane records load with the run — open the receipt tab once if this stays empty</div>` : ""}`);
  // pane rows come from /api/job — load it quietly if we don't have it yet
  if (!sp.job && sp.route.run && sp.jobLoadedKey !== sp.route.run) loadJob(state.seq);
}

function renderPaneCard(label) {
  const sp = state.split;
  if (!sp) return;
  const member = String(label).split("-")[0];
  setEvSide(`
    <div class="ev-side-head">
      <span class="ev-side-kind">pane</span>
      <b class="mono" style="font-size:14px">${esc(label)}</b>
    </div>
    <div class="muted small" style="margin:6px 0 10px">a pane of member <button class="ev-ent" data-ev-ent="member:${esc(member)}">${esc(member)}</button> — click it for the mail</div>
    <div class="muted small">full pane facts (born/died, transcript pointer) live on the pane's birth event — click the matching <span class="mono">pane.born</span> row in the log.</div>`);
}

async function loadMessage(file) {
  const sp = state.split;
  if (!sp || !sp.route.run) return;
  const runKey = sp.route.run;
  const [sid, jid] = splitKey(runKey);
  const box = $("#ev-msg");
  if (!box) return;
  if (!sp.msgCache) sp.msgCache = {};
  const render = (d) => {
    const el = $("#ev-msg");
    if (!el || sp.route.run !== runKey) return;
    if (d.__error) { el.innerHTML = `<div class="bad small">${esc(d.__error)}</div>`; return; }
    let head = "";
    try {
      const j = JSON.parse(d.text);
      head = `<div class="ev-msg-head"><span class="ok">${esc(j.from)}</span> → <span class="ok">${esc(j.to)}</span>${j.type ? ` · <span class="muted">${esc(j.type)}</span>` : ""}</div>`;
    } catch { /* not json — the raw text shows */ }
    el.innerHTML = `${head}<pre class="ev-msg-body">${esc(d.text ?? "")}</pre>`;
  };
  const hit = sp.msgCache[file];
  if (hit) { render(hit); return; }
  box.innerHTML = `<div class="muted small">loading messages/${esc(file)}…</div>`;
  try {
    const res = await fetchJSON(`/api/run-dir/${enc(sid)}/${enc(jid)}?path=${enc("messages/" + file)}`);
    if (sp.route.run !== runKey) return;
    sp.msgCache[file] = res;
    render(res);
  } catch (err) {
    if (sp.route.run !== runKey) return;
    const d = { __error: `could not load ${file}: ${err.message}` };
    sp.msgCache[file] = d;
    render(d);
  }
}

// entity chips and rows funnel through here (delegated from bodyClick)
function handleEvEnt(ref) {
  const i = ref.indexOf(":");
  if (i === -1) return;
  const type = ref.slice(0, i);
  const name = ref.slice(i + 1);
  if (type === "member") renderMemberCard(name);
  else if (type === "pane") renderPaneCard(name);
  else if (type === "msg") {
    const ev = state.split && state.split.events || [];
    const rel = ev.find((e) => e.kind === "relay" && e.file === name);
    const head = rel
      ? `<div class="ev-side-head"><span class="ev-side-kind" style="color:${kindColor("relay")}">relay</span><span class="muted small">${esc(fmtTs(rel.ts))}</span></div>`
      : `<div class="ev-side-head"><span class="ev-side-kind" style="color:${kindColor("relay")}">relay message</span></div>`;
    setEvSide(`${head}<div id="ev-msg" class="ev-msg"><div class="muted small">loading ${esc(name)}…</div></div>`);
    loadMessage(name);
  }
}

// ----- live events stream (running runs) -----

function setEventsReconnecting(on) {
  const el = $("#ev-reconnecting");
  if (el) el.classList.toggle("hidden", !on);
}

function closeEventsStream() {
  const sp = state.split;
  if (!sp || !sp.es) return;
  try { sp.es.close(); } catch { /* already closed */ }
  sp.es = null;
  sp.esKey = null;
  setEventsReconnecting(false);
}

function openEventsStream(runKey) {
  const sp = state.split;
  if (!sp || (sp.es && sp.esKey === runKey)) return;
  closeEventsStream();
  const [sid, jid] = splitKey(runKey);
  sp.esKey = runKey;
  sp.events = null;
  sp.eventsError = null;
  const es = new EventSource(`/api/events/stream?sid=${enc(sid)}&jid=${enc(jid)}`);
  sp.es = es;
  es.addEventListener("open", () => {
    if (sp.es === es) setEventsReconnecting(false);
  });
  es.addEventListener("snapshot", (e) => {
    if (sp.es !== es || sp.esKey !== runKey) return;
    let data = {};
    try { data = JSON.parse(e.data); } catch { /* bad frame */ }
    if (!current(sp, state.seq) || sp.route.run !== runKey || sp.route.rtab !== "events") return;
    sp.events = Array.isArray(data.events) ? data.events : [];
    paintEventsFromState();
  });
  es.addEventListener("append", (e) => {
    if (sp.es !== es || sp.esKey !== runKey) return;
    let ev = null;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (!sp.events) sp.events = [];
    sp.events.push(ev);
    appendEventLine(ev);
  });
  es.addEventListener("error", () => {
    if (sp.es === es) setEventsReconnecting(true);
  });
}

// full repaint from sp.events — first snapshot paint and reconnect
// replaces (server sends a fresh snapshot on reconnect, which dedupes
// anything missed while the wire was down). Scroll law: stick to the
// tail only if the reader was at the tail, else hold their position.
function paintEventsFromState() {
  const sp = state.split;
  const box = evScrollEl();
  if (!box) return;
  const nearBottom = box.scrollHeight === 0 ||
    box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
  const wasTop = box.scrollTop;
  box.innerHTML = (sp.events || []).map((ev, i) => evLine(ev, i)).join("") ||
    '<span class="muted" data-ev-empty>no events</span>';
  box.scrollTop = nearBottom ? box.scrollHeight : wasTop;
}

// append-only growth: touch nothing above, snap to the new tail only
// if the reader was already at the tail — never move a reading position
function appendEventLine(ev) {
  const box = evScrollEl();
  if (!box) return;
  const atTail = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const ghost = box.querySelector("[data-ev-empty]");
  if (ghost) ghost.remove();
  box.insertAdjacentHTML("beforeend", evLine(ev, (state.split.events || []).length - 1));
  if (atTail) box.scrollTop = box.scrollHeight;
}

// the run finished while we watched: close the stream, pin the final
// history with one immutable snapshot fetch (snapshot-equivalent)
async function finalizeEventsStream(seq) {
  const sp = state.split;
  const runKey = sp.route.run;
  if (!runKey) return;
  closeEventsStream();
  const [sid, jid] = splitKey(runKey);
  try {
    const res = await fetchJSON(`/api/events?sid=${enc(sid)}&jid=${enc(jid)}`);
    if (!current(sp, seq) || sp.route.run !== runKey || sp.route.rtab !== "events") return;
    sp.events = res.events || [];
    sp.eventsError = null;
    sp.eventsLoadedKey = runKey;
  } catch (err) {
    if (!current(sp, seq) || sp.route.run !== runKey) return;
    sp.eventsError = err.message;
    sp.eventsLoadedKey = runKey;
  }
  if (sp.route.rtab === "events") paintEventsFromState();
}

// called from the 5s tick while the events tab is open — upgrades a
// not-yet-known run to live once it's seen running, and closes the
// stream the moment the run is terminal
function maintainEventsStream(seq) {
  const sp = state.split;
  if (!sp || !sp.route.run) return;
  const runKey = sp.route.run;
  const st = splitRunState(runKey);
  const streaming = !!sp.es && sp.esKey === runKey;
  if (streaming && st && st !== "running") finalizeEventsStream(seq);
  else if (!streaming && st === "running") openEventsStream(runKey);
}

function refreshSplit() {
  const sp = state.split;
  if (!sp) return;
  const r = sp.route;
  if (r.legacy) {
    renderLegacyList();
  } else if (r.tab === "runs") {
    renderRunsList();
  } else if (r.tab === "config") {
    if (!(sp.program && sp.program.unlocked)) renderConfigBody();
  } else if (r.tab === "diagram" && r.run && sp.defn && $("#d-canvas")) {
    // the diagram is on the loop: the selected run's ×N relay badges
    // refresh every tick — no full re-render, drag positions survive
    loadShape(state.seq);
  }
  if (!r.run) return;
  if (r.rtab === "receipt") loadJob(state.seq, true);
  else if (r.rtab === "events") {
    // the stream owns a running run's growth — the tick only tends the
    // lifecycle (open once it's known running, finalize once terminal)
    maintainEventsStream(state.seq);
  }
}

async function triggerDag(pid, dagId, btns) {
  (btns || []).forEach((b) => { b.disabled = true; });
  showToast(`triggering ${pid}/${dagId}…`);
  try {
    const res = await fetchJSON(`/api/dags/${enc(pid)}/${enc(dagId)}/trigger`, { method: "POST" });
    const jobLine = (res.lines || []).find((l) => l.startsWith("job:")) || "";
    showToast(["trigger ok", jobLine || res.reason || ""].filter(Boolean).join("\n"), "ok");
  } catch (err) {
    showToast(`trigger failed:\n${err.message}`, "err");
  }
  (btns || []).forEach((b) => { b.disabled = false; });
  tick();
}

// ----- run ops: pause / abort / continue -----

// the two op buttons for one run, driven by its mapped status:
// running -> Pause+Abort · paused -> Resume+Abort · aborted|orphaned ->
// Continue+Abort (both parks rebirth the same way)
// retired (success/failed) -> both present, disabled and greyed (parked, not broken)
function opsButtonsHtml(st, sid, jid) {
  const key = `${sid}/${jid}`;
  const busy = state.opsBusy[key];
  const retired = st === "success" || st === "failed";
  const slot = st === "running" ? ["pause", "Pause"]
    : st === "paused" ? ["continue", "Resume"]
    : ["continue", "Continue"];
  const dis = retired || busy ? " disabled" : "";
  const titles = {
    pause: "drains to a unit boundary, then parks",
    abort: "kills now — booked sessions survive; a Continue can bring it back",
    continue: "resumes from booked sessions",
  };
  const pTitle = retired ? "retired — parked" : titles[slot[0]];
  const aTitle = retired ? "retired — parked" : titles.abort;
  const pLabel = busy && slot[0] === "pause" ? "Pausing…"
    : busy && slot[0] === "continue" ? "Continuing…" : slot[1];
  const aLabel = busy ? "Aborting…" : "Abort";
  return `<span class="ops-pair">` +
    `<button class="btn ops${retired ? " retired" : ""}" data-ops="${slot[0]}" data-sid="${esc(sid)}" data-jid="${esc(jid)}"${dis} title="${esc(pTitle)}">${pLabel}</button>` +
    `<button class="btn ops danger${retired ? " retired" : ""}" data-ops="abort" data-sid="${esc(sid)}" data-jid="${esc(jid)}"${dis} title="${esc(aTitle)}">${aLabel}</button>` +
    `</span>`;
}

// repaint whatever surface is currently showing op buttons so a busy
// run keeps its pending state across the 5s tick
function repaintOps() {
  if (state.route && state.route.view === "spur-runs") renderDagRunsList();
  if (state.split) renderRightHead();
}

const OPS_CONFIRMS = {
  pause: (jid) => `Pause run ${jid}? It drains to a unit boundary, then parks.`,
  abort: (jid) => `Abort run ${jid}? Kills now — booked sessions survive; a Continue can bring it back.`,
  continue: (jid) => `Continue run ${jid}? It resumes from booked sessions.`,
};

async function runOps(verb, sid, jid) {
  if (!OPS_CONFIRMS[verb]) return;
  if (!confirm(OPS_CONFIRMS[verb](jid))) return;
  const key = `${sid}/${jid}`;
  state.opsBusy[key] = verb;
  repaintOps();
  try {
    const res = await fetchJSON(`/api/job/${enc(sid)}/${enc(jid)}/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const head = verb === "pause" ? "pause signalled — it drains to a boundary, then the row flips to paused"
      : verb === "abort" ? "abort signalled"
      : "continue signalled";
    showToast([head, ...(res.lines || [])].filter(Boolean).join("\n"), "ok");
  } catch (err) {
    showToast(`${verb} failed:\n${err.message}`, "err");
  }
  delete state.opsBusy[key];
  repaintOps();
  tick();
}

function bodyClick(e) {
  const evEnt = e.target.closest("[data-ev-ent]");
  if (evEnt) {
    e.preventDefault();
    e.stopPropagation();
    handleEvEnt(evEnt.dataset.evEnt);
    return;
  }
  const evRow = e.target.closest("[data-evi]");
  if (evRow && !e.target.closest("button")) {
    e.preventDefault();
    selectEvent(Number(evRow.dataset.evi));
    return;
  }
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
  const ops = e.target.closest("[data-ops]");
  if (ops && !ops.disabled) {
    e.preventDefault();
    e.stopPropagation();
    runOps(ops.dataset.ops, ops.dataset.sid, ops.dataset.jid);
    return;
  }
  const fbtn = e.target.closest("[data-file]");
  if (fbtn) {
    $$(".tree .trow.active").forEach((x) => x.classList.remove("active"));
    fbtn.classList.add("active");
    loadFile(fbtn.dataset.file);
    return;
  }
  const rbtn = e.target.closest("[data-run]");
  if (rbtn) {
    e.preventDefault();
    const key = rbtn.dataset.run;
    // instant highlight: the selection is a fact the moment it is
    // clicked — data loads may land whenever they like
    $$(".runsel").forEach((b) => b.classList.toggle("active", b.dataset.run === key));
    if (state.split && state.split.route.run !== key) setHash(splitHref({ run: key }));
    return;
  }
  const row = e.target.closest("[data-href]");
  if (row && !e.target.closest("a, button, input, textarea, select")) {
    setHash(row.dataset.href);
  }
}

function onDocChange(e) {
  if (e.target.id === "dag-select") {
    setHash(splitHref({ dag: e.target.value || null, run: null }));
  }
}

let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const r = state.route;
    const seq = state.seq;
    if (r.view === "home") {
      const res = await fetchJSON("/api/home");
      if (seq !== state.seq || state.route.view !== "home") return;
      state.home = res;
      renderHome();
    } else if (r.view === "spurs") {
      await Promise.all([fetchDags(seq), fetchJobs(seq)]);
      if (seq !== state.seq || state.route.view !== "spurs") return;
      renderDags();
      renderDagsLegacyNote();
    } else if (r.view === "spur-runs") {
      await fetchJobs(seq);
      if (seq !== state.seq || state.route.view !== "spur-runs") return;
      renderDagRunsList();
    } else if (r.view === "spur-status" && state.split) {
      await fetchDags(seq);
      if (!current(state.split, seq)) return;
      if (state.split.route.legacy) {
        await fetchJobs(seq);
        if (!current(state.split, seq)) return;
      }
      refreshSplit();
    }
  } catch (err) {
    showToast(`refresh failed: ${err.message}`, "err");
  } finally {
    ticking = false;
  }
}

window.addEventListener("hashchange", onRoute);
document.body.addEventListener("click", bodyClick);
document.addEventListener("change", onDocChange);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNodePopup();
});

function updateClock() {
  clockEl.textContent = new Date().toLocaleTimeString();
}
updateClock();
setInterval(updateClock, 1000);

onRoute();
tick();
setInterval(tick, REFRESH_MS);
