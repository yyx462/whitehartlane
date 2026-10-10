#!/usr/bin/env node
// agentic-os window — backend server. Node stdlib only, no npm.
// Serves web/public/ statically and a JSON API over the OS disk
// (~/.local/share/agentic-os): sessions, Jobs, panes, events, reports.
// The write actions are POST /api/run (spawns the run door detached and
// returns its first stdout lines), the rail verbs (pause|abort|continue
// via the door), and POST delete (removes a job dir outright).
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
// bind the tailnet by default (Tailscale 100.x reach); set HOST=127.0.0.1 to go local-only
const HOST = process.env.HOST || "0.0.0.0";
const OS_ROOT = process.env.AGENTIC_OS_ROOT ||
  path.join(process.env.HOME, ".local/share/agentic-os");
const SESSIONS_DIR = path.join(OS_ROOT, "sessions");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
// the run door — resolved, never hard-wired to one worktree: a merged and
// removed worktree must not leave the door dangling (ui-pause did exactly
// that). Env override first, then this checkout, then known fallbacks.
const RUN_DOOR =
  [
    process.env.AGENTIC_OS_DOOR,
    path.resolve(HERE, "..", "bin", "agentic-os"),
    "/Users/sagebot/projects/Agentic-Workspace/agentic-os/master/bin/agentic-os",
    "/Users/sagebot/projects/Agentic-Workspace/agentic-os/ui-pause/bin/agentic-os",
  ].find((p) => p && fs.existsSync(p)) || null;

// launchd runs this server on macOS's minimal PATH (no node, no
// ~/.local/bin): spawning the door script directly hits its
// `#!/usr/bin/env node` shebang and dies with "env: node: No such file
// or directory" (the j-389b25 abort from the window UI). So the door
// runs on the node binary running THIS server — absolute, no PATH
// lookup — and gets a PATH that provably reaches the shep/herdr CLIs
// it shells out to.
const CHILD_PATH = [
  path.dirname(process.execPath),
  path.join(os.homedir(), ".local", "bin"),
  process.env.PATH,
].filter(Boolean).join(path.delimiter);

/** spawn the run door on this server's own node; args follow the script path */
function spawnDoor(args, extraOpts = {}) {
  return spawn(process.execPath, [RUN_DOOR, ...args], {
    env: { ...process.env, PATH: CHILD_PATH },
    ...extraOpts,
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

// ids on the OS disk look like s-fcbcbd / j-511086 — lock ids to a safe
// charset so no path can ever escape the sessions tree.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readSessions() {
  let entries = [];
  try {
    entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && ID_RE.test(e.name))
    .map((e) => {
      const id = e.name;
      const sdir = path.join(SESSIONS_DIR, id);
      const session = readJson(path.join(sdir, "session.json")) || { id };
      const jobs = listJobsOfSession(id);
      return {
        id,
        created: session.created || null,
        cwd: session.cwd || null,
        host: session.host || null,
        jobCounts: countBy(jobs, (j) => j.state),
        jobsTotal: jobs.length,
      };
    })
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function listJobsOfSession(sid) {
  const jdir = path.join(SESSIONS_DIR, sid, "jobs");
  let entries = [];
  try {
    entries = fs.readdirSync(jdir, { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const job = readJson(path.join(jdir, e.name, "job.json"));
    if (job && job.id) jobs.push(job);
  }
  return jobs.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function outcomeOf(job) {
  if (job.receipt) return "receipt";
  if (job.abort) return "abort";
  if (job.orphan) return "orphan";
  return "inflight";
}

function finishedOf(job) {
  return job.finished || job.receipt?.finished || null;
}

function durationMsOf(job) {
  const created = Date.parse(job.created || "");
  const finished = Date.parse(finishedOf(job) || "");
  if (!isFinite(created) || !isFinite(finished) || finished < created) return null;
  return finished - created;
}

function jobFileOf(sid, jid) {
  return path.join(SESSIONS_DIR, sid, "jobs", jid, "job.json");
}

// v5.1: WHO booked the verb — "an abort arrived, but from where?" The
// trace's job.aborted / job.paused event carries the actor (orchestrator,
// sweep, a human's CLI call). One lookup, oldest-match-wins, per job
// that actually has the booked block.
function verbActorOf(job, kind) {
  if (!job || !job.sid || !job.id) return null;
  const events = readEvents(job.sid);
  if (!events) return null;
  for (const e of events) {
    if (e && e.kind === kind && e.jid === job.id) return e.actor || null;
  }
  return null;
}

// ---- v4: status vocabulary (one mapping, server-side, used everywhere) --
//   retired + report.status done               -> "success"
//   retired + report failed / any failed rows  -> "failed"
//   aborted (v5.1: its own word, not "failed") -> "aborted"
//   running                                    -> "running"
//   paused (v5)                                -> "paused"
//   orphaned                                   -> "orphaned"
// The raw state always travels alongside (detail views show reasons).
// v5: paused is an intentional park — never red, never "running". The
// drain may take up to the ceiling, so the state flips a beat after
// the POST /pause returns; until the booking lands it reads running.
// v5.1: aborted is a park, not a failure — Continue accepts it like
// paused/orphaned, so it gets its own color instead of borrowing
// "failed". The raw state is authoritative; the booked blocks
// (pause/orphan/abort) are only fallbacks for a missing state.

function reportOf(job) {
  if (!job?.dir) return null;
  return readJson(path.join(job.dir, "report.json"));
}

function reportHasFailures(report) {
  if (!report) return false;
  if (report.status === "failed") return true;
  const c = report.counts || {};
  if (Number(c.failed) > 0) return true;
  const table = Array.isArray(report.table) ? report.table : [];
  return table.some(
    (r) => r && typeof r.result === "string" && /fail/i.test(r.result),
  );
}

function statusOf(job, report) {
  const st = job?.state || "";
  if (st === "running") return "running";
  if (st === "paused") return "paused";
  if (st === "orphaned") return "orphaned";
  if (st === "aborted") return "aborted";
  if (st === "retired") {
    if (report) {
      return reportHasFailures(report) || report.status !== "done"
        ? "failed"
        : "success";
    }
    return job?.receipt?.status === "done" ? "success" : "failed";
  }
  if (job?.pause) return "paused";
  if (job?.orphan) return "orphaned";
  if (job?.abort) return "aborted";
  return "unknown"; // unknown states never masquerade as running
}

// semantic order for ?sort=status
// (running -> paused -> orphaned -> aborted -> failed -> success; unknown last)
const STATUS_RANK = {
  running: 0,
  paused: 1,
  orphaned: 2,
  aborted: 3,
  failed: 4,
  success: 5,
};

// the staged program dir: job.dir when it is a dir, else the canonical
// sessions/<sid>/jobs/<jid>/run
function runDirOf(job, sid, jid) {
  const canonical = path.join(SESSIONS_DIR, sid, "jobs", jid, "run");
  const cands = [job?.dir, canonical];
  for (const c of cands) {
    try {
      if (c && fs.statSync(c).isDirectory()) return c;
    } catch {}
  }
  return canonical;
}

function flattenJob(job) {
  const panes = Array.isArray(job.panes) ? job.panes : [];
  const reportPath = path.join(job.dir || "", "report.json");
  const report = reportOf(job);
  return {
    id: job.id,
    sid: job.sid,
    workflow: job.workflow || null,
    stoodUpBy: job.stoodUpBy || null,
    state: job.state || "unknown", // raw state, kept alongside the mapping
    status: statusOf(job, report), // v4 vocabulary: success|failed|running|paused|orphaned
    reportStatus: report?.status ?? null,
    legacy: !job.dag, // v4: no dag block -> legacy, never shown as a dag
    task: job.task || null,
    dir: job.dir || null,
    pid: job.pid ?? null,
    created: job.created || null,
    finished: finishedOf(job),
    durationMs: durationMsOf(job), // finished - created, null while running
    dag: job.dag || null, // {project,project_name,dag_id,content_hash,source,labels} | null
    outcome: outcomeOf(job), // receipt | abort | orphan | inflight
    panes: {
      dead: panes.filter((p) => p && p.died).length,
      total: panes.length,
      rows: panes.map((p) => ({
        label: p.label || null,
        unit: p.unit || null,
        parent: p.parent || null,
        pane: p.pane || null,
        born: p.born || null,
        died: p.died || null,
        tool: p.transcript?.tool || null,
        cwd: p.transcript?.cwd || null,
      })),
    },
    receipt: job.receipt || null, // {panesRemaining,panesTotal,unitsDone,unitsFailed,status,report,finished}
    spawner: job.spawner || null, // ADR 0006: {tool,session_id,since} — the levy checkpoint
    woke: job.woke || null, // ADR 0006: {at,message} — the end-of-job wake, booked once
    abort: job.abort
      ? { ...job.abort, actor: verbActorOf(job, "job.aborted") } // {reason,panesRemaining,finished,actor}
      : null,
    orphan: job.orphan || null, // {reason,panesRemaining,at}
    pause: job.pause
      ? { ...job.pause, actor: verbActorOf(job, "job.paused") } // v5: {reason,panesRemaining,at,actor}
      : null,
    continues: job.continues ?? null, // v5: soft continued ×N counter (no cap)
    hasReport: job.dir ? fs.existsSync(reportPath) : false,
  };
}

function listAllJobs() {
  const out = [];
  for (const s of fs.existsSync(SESSIONS_DIR)
    ? fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    : []) {
    if (!s.isDirectory() || !ID_RE.test(s.name)) continue;
    out.push(...listJobsOfSession(s.name));
  }
  // newest first
  return out.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function countBy(items, fn) {
  const m = {};
  for (const it of items) {
    const k = fn(it) ?? "unknown";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

// ---- v2: DAG groups (Airflow-like) ------------------------------------

const UNGROUPED = "(ungrouped)";

function dagOf(job) {
  return job && job.dag && typeof job.dag === "object" ? job.dag : null;
}

function buildDags() {
  const groups = new Map();
  for (const job of listAllJobs()) {
    const dag = dagOf(job);
    const key = dag ? `${dag.project || "?"}|${dag.dag_id || "?"}` : UNGROUPED;
    let g = groups.get(key);
    if (!g) {
      g = {
        project: dag ? dag.project || null : null,
        project_name: dag ? dag.project_name || dag.dag_id || "-" : "-",
        dag_id: dag ? dag.dag_id || "(unknown)" : UNGROUPED,
        source: dag ? dag.source || null : null,
        versions: [],
        runs: [],
      };
      groups.set(key, g);
    }
    if (dag && dag.content_hash && !g.versions.includes(dag.content_hash)) {
      g.versions.push(dag.content_hash);
    }
    const report = reportOf(job);
    g.runs.push({
      sid: job.sid,
      jid: job.id,
      state: job.state || "unknown", // raw
      status: statusOf(job, report), // v4 vocabulary
      workflow: job.workflow || null,
      created: job.created || null,
      finished: finishedOf(job),
      durationMs: durationMsOf(job),
      version: dag?.content_hash || null,
      labels: dag?.labels || {},
    });
  }
  const dags = [...groups.values()].map((g) => {
    g.runs.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    // v3 summary fields (runs/versions kept for the detail views)
    g.runCount = g.runs.length;
    g.versionCount = g.versions.length;
    g.created = g.runs.reduce(
      (min, r) => (!r.created || (min && r.created > min) ? min : r.created || min),
      null,
    );
    const last = g.runs[0] || null;
    // v4: the workflow of the latest run names the dag's kind
    g.kind = last?.workflow || null; // fan-out | lab | coworker
    g.labels = last?.labels || {};
    // v4: latest run with the mapped status (start/end/durationMs/status)
    g.latestRun = last
      ? {
          jid: last.jid,
          sid: last.sid,
          start: last.created,
          end: last.finished,
          durationMs: last.durationMs,
          status: last.status,
        }
      : null;
    g.lastRun = last
      ? {
          jid: last.jid,
          state: last.state,
          durationMs: last.durationMs,
          finished: last.finished,
          created: last.created,
          sid: last.sid,
        }
      : null;
    return g;
  });
  // real dags first, ordered by their newest run; ungrouped pinned last
  const real = dags
    .filter((g) => g.dag_id !== UNGROUPED)
    .sort((a, b) =>
      ((b.runs[0]?.created || "")).localeCompare(a.runs[0]?.created || ""),
    );
  const rest = dags.filter((g) => g.dag_id === UNGROUPED);
  return [...real, ...rest];
}

// ---- v2: dag shape (flow diagram data) --------------------------------

// import() a dag.mjs (staged or LIVE source — same shape) into
// {dagName, nodes:[{id,does}], edges:[{from,to,messages:0}]} or
// {…, error}. Cached by mtime so config edits show up immediately.
const labGraphCache = new Map(); // dag.mjs path -> {mtimeMs, graph}

async function labGraph(dagFile) {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(dagFile).mtimeMs;
  } catch {
    return null; // no dag.mjs there
  }
  const hit = labGraphCache.get(dagFile);
  if (hit && hit.mtimeMs === mtimeMs) return hit.graph;
  let graph;
  try {
    const mod = await import(pathToFileURL(dagFile).href + "?v=" + mtimeMs);
    const dag = mod.dag || mod.default?.dag || null;
    const steps = Array.isArray(dag?.steps) ? dag.steps : [];
    const nodes = [];
    const edges = [];
    for (const s of steps) {
      if (!s || typeof s.id !== "string") continue;
      nodes.push({ id: s.id, does: s.does ?? null, brief: s.does ?? null });
      const after = Array.isArray(s.after) ? s.after : s.after ? [s.after] : [];
      for (const a of after) {
        if (typeof a === "string") edges.push({ from: a, to: s.id, messages: 0 });
      }
    }
    graph = {
      dagName: typeof dag?.name === "string" ? dag.name : null,
      nodes,
      edges,
    };
  } catch (e) {
    graph = {
      dagName: null,
      nodes: [],
      edges: [],
      error: "dag.mjs import failed: " + (e && e.message ? e.message : String(e)),
    };
  }
  labGraphCache.set(dagFile, { mtimeMs, graph });
  return graph;
}

// v3: tally relay message files per from->to pair in a staged run dir
function messageTallies(messagesDir) {
  const tallies = new Map(); // "from\u0000to" -> count
  let names = [];
  try {
    names = fs.readdirSync(messagesDir);
  } catch {
    return tallies;
  }
  for (const f of names) {
    if (!f.endsWith(".json")) continue;
    const d = readJson(path.join(messagesDir, f));
    if (!d || typeof d.from !== "string" || typeof d.to !== "string") continue;
    const k = d.from + "\u0000" + d.to;
    tallies.set(k, (tallies.get(k) || 0) + 1);
  }
  return tallies;
}

// v3→v5.1: one described line per member brief — the node says what it
// does, not just that it exists. The brief is hard-wrapped markdown, so
// the old "first raw line" was a mid-sentence fragment nobody could
// read ("…coworker job (v4.1). You"). Join the first paragraph, then
// take its first sentence — a complete, readable thought.
function memberDoes(file) {
  const text = memberBrief(file);
  if (!text) return null;
  const para = text
    .split(/\r?\n\s*\r?\n/)[0]
    .replace(/^#{1,6}\s*/m, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!para) return null;
  // first sentence — a terminator only counts when a space or the end
  // follows it, so "v4.1" does not cut the sentence at its decimal
  const m = para.match(/^.*?[.!?](?=\s|$)/);
  let s = m ? m[0] : para;
  if (s.length > 160) {
    const cut = s.slice(0, 160);
    s = cut.slice(0, cut.lastIndexOf(" ")) + "…";
  }
  return s || null;
}

// v5.1: the FULL member brief — the diagram box shows the sentence, the
// click-popup shows the whole prompt (capped, never a copy, still the
// source file's own bytes).
function memberBrief(file, cap = 12000) {
  try {
    const t = fs.readFileSync(file, "utf8");
    return t.length > cap ? t.slice(0, cap) + "\n… (truncated)" : t;
  } catch {
    return null;
  }
}

async function dagShape(job, sid, jid) {
  const runDir = runDirOf(job, sid, jid);

  // lab job: the staged dag.mjs IS data — import() it (cached by mtime)
  const lab = await labGraph(path.join(runDir, "dag.mjs"));
  if (lab) {
    return {
      kind: "lab",
      dagName: lab.dagName,
      nodes: lab.nodes,
      edges: lab.edges,
      hooks: stagedHooks(runDir),
      ...(lab.error ? { error: lab.error } : {}),
    };
  }

  // coworker job: members as nodes, relay edges between consecutive members
  const membersDir = path.join(runDir, "members");
  let memberFiles = [];
  try {
    memberFiles = fs
      .readdirSync(membersDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {}
  if (memberFiles.length) {
    const nodes = memberFiles.map((f) => ({
      id: f.replace(/\.md$/, ""),
      does: memberDoes(path.join(membersDir, f)) || "member",
      brief: memberBrief(path.join(membersDir, f)) || null,
    }));
    const tallies = messageTallies(path.join(runDir, "messages"));
    const edgeCount = (from, to) => tallies.get(from + "\u0000" + to) || 0;
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
      edges.push({
        from: nodes[i - 1].id,
        to: nodes[i].id,
        messages: edgeCount(nodes[i - 1].id, nodes[i].id),
      });
    }
    // the relay LOOP: a from->to direction with messages but no chain edge
    // (e.g. frontend answering back) gets its own edge, so the exchange
    // renders as ×N in both directions
    const ids = new Set(nodes.map((n) => n.id));
    for (const [k, n] of tallies) {
      const [from, to] = k.split("\u0000");
      if (ids.has(from) && ids.has(to) && !edges.some((e) => e.from === from && e.to === to)) {
        edges.push({ from, to, messages: n });
      }
    }
    return { kind: "coworker", nodes, edges, hooks: stagedHooks(runDir) };
  }

  return { kind: "none", nodes: [], edges: [], hooks: [] };
}

// ---- v2: source viewer -------------------------------------------------

// parse `key = "value"` entries out of the named top-level TOML tables
// ([workflow] style headers, quoted or bare values, trailing # comments).
// Used for hook chips ([hooks], [detectors], [gates]) and hook paths.
function tomlEntries(tomlText, sections) {
  const want = new Set(sections);
  const out = [];
  let section = null;
  for (const raw of String(tomlText || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const m = line.match(/^\[\s*([A-Za-z0-9_$-]+)\s*\]/);
      section = m ? m[1] : null;
      continue;
    }
    if (!section || !want.has(section)) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    let value = m[2].replace(/\s+#.*$/, "").trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ section, name: m[1], value });
  }
  return out;
}

// v3: hook chips from the staged workflow.toml — every entry of the
// [hooks], [detectors] and [gates] tables as {name, command, section}
function stagedHooks(runDir) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(runDir, "workflow.toml"), "utf8");
  } catch {
    return [];
  }
  return tomlEntries(text, ["hooks", "detectors", "gates"]).map((e) => ({
    name: e.name,
    command: e.value,
    section: e.section,
  }));
}

// pull `key = "cmd"` pairs out of the [hooks] table and return the first
// absolute path token of each command (hook commands are absolute paths)
function hookPaths(tomlText) {
  const out = [];
  for (const { name, value } of tomlEntries(tomlText, ["hooks"])) {
    for (const tok of value.split(/\s+/)) {
      if (tok.startsWith("/") || tok.startsWith("~/")) {
        out.push({ key: name, path: tok.replace(/^~(?=\/)/, process.env.HOME || "~") });
        break;
      }
    }
  }
  return out;
}

function cappedRead(file, cap = 4000) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(cap);
      const n = fs.readSync(fd, buf, 0, cap, 0);
      return { text: buf.subarray(0, n).toString("utf8"), truncated: n === cap };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

// v4: recursive listing for the run-dir browser. Symlinks are listed but
// never followed; depth-capped; dirs first, then files, then links.
function treeOf(dir, depth) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) {
      out.push({ name: e.name, type: "link" });
      continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push({
        name: e.name,
        type: "dir",
        children: depth < 8 ? treeOf(p, depth + 1) : [],
      });
    } else if (e.isFile()) {
      try {
        const st = fs.statSync(p);
        out.push({
          name: e.name,
          type: "file",
          bytes: st.size,
          mtime: st.mtime.toISOString(),
        });
      } catch {}
    }
  }
  const rank = { dir: 0, file: 1, link: 2 };
  return out.sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name));
}

function sourceOf(job, sid, jid) {
  const runDir = runDirOf(job, sid, jid);
  const files = [];
  const seenPath = new Set();
  const seenName = new Set();
  const push = (name, p) => {
    const rp = path.resolve(p);
    if (seenPath.has(rp)) return;
    let nm = name;
    for (let i = 2; seenName.has(nm); i++) nm = name + "~" + i;
    seenName.add(nm);
    seenPath.add(rp);
    const r = cappedRead(rp);
    files.push({
      name: nm,
      path: rp,
      text: r ? r.text : null,
      truncated: r ? r.truncated : false,
      missing: !r,
    });
  };

  const dagFile = path.join(runDir, "dag.mjs");
  if (fs.existsSync(dagFile)) push("dag.mjs", dagFile);

  const wfFile = path.join(runDir, "workflow.toml");
  let wfText = "";
  try {
    wfText = fs.readFileSync(wfFile, "utf8");
  } catch {}
  if (wfText) push("workflow.toml", wfFile);

  const hooks = [];
  for (const { key, path: p } of hookPaths(wfText)) {
    let isFile = false;
    try {
      isFile = fs.statSync(p).isFile();
    } catch {}
    hooks.push({ key, path: p, found: isFile });
    if (isFile) push(path.basename(p), p);
  }

  return { sid, jid, runDir, files, hooks };
}

// v5.2: one definition shape from any program folder — the live SOURCE,
// or (when the source dangles) a run's staged copy. Same shape either
// way; the endpoint's `stale` marker is the only difference the caller
// ever sees.
async function definitionFromFolder(folder) {
  const hooks = stagedHooks(folder);
  const lab = await labGraph(path.join(folder, "dag.mjs"));
  if (lab) {
    return {
      kind: "lab",
      dagName: lab.dagName,
      nodes: lab.nodes,
      edges: lab.edges.map(({ from, to }) => ({ from, to })),
      hooks,
      ...(lab.error ? { error: lab.error } : {}),
    };
  }
  const membersDir = path.join(folder, "members");
  let memberFiles = [];
  try {
    memberFiles = fs
      .readdirSync(membersDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {}
  if (memberFiles.length) {
    const nodes = memberFiles.map((f) => ({
      id: f.replace(/\.md$/, ""),
      does: memberDoes(path.join(membersDir, f)) || "member",
      brief: memberBrief(path.join(membersDir, f)) || null,
    }));
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
      edges.push({ from: nodes[i - 1].id, to: nodes[i].id });
    }
    return { kind: "coworker", nodes, edges, hooks };
  }
  return null;
}

// the staged definition of one dag, newest-run-first: sessions/<sid>/
// jobs/<jid>/run keeps the program bytes the door copied at run time —
// they outlive the source worktree, so the display never has to dangle
async function stagedDefinition(g) {
  for (const r of g.runs || []) {
    const job = readJson(jobFileOf(r.sid, r.jid));
    if (!job) continue;
    const runDir = runDirOf(job, r.sid, r.jid);
    try {
      if (!fs.statSync(runDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const def = await definitionFromFolder(runDir);
    if (def) return { ...def, runDir, sid: r.sid, jid: r.jid };
  }
  return null;
}

// ---- v3: sorting, trigger, program editing -----------------------------

// compare two non-null keys — numbers numerically, strings lexically
function cmpKey(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// in-place sort by keyFn; dir +1 asc / -1 desc; nulls always last
function applySort(list, keyFn, dir) {
  list.sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    const an = ka === null || ka === undefined;
    const bn = kb === null || kb === undefined;
    if (an || bn) return an === bn ? 0 : an ? 1 : -1; // nulls always last
    return cmpKey(ka, kb) * dir;
  });
}

function sortDirOf(order) {
  if (order === null || order === "") return -1; // default desc (newest/biggest first)
  if (order === "asc") return 1;
  if (order === "desc") return -1;
  return null; // invalid
}

// find a dag group by "<pid>/<dag_id>" — the group knows its source folder
function findDagGroup(dagRef) {
  if (typeof dagRef !== "string") return null;
  const i = dagRef.indexOf("/");
  if (i <= 0 || i === dagRef.length - 1) return null;
  const pid = dagRef.slice(0, i);
  const dagId = dagRef.slice(i + 1);
  for (const g of buildDags()) {
    if (g.dag_id !== UNGROUPED && g.project === pid && g.dag_id === dagId) return g;
  }
  return null;
}

// a runnable source folder must exist and carry a workflow.toml
function sourceFolderError(folder) {
  let st = null;
  try {
    st = fs.statSync(folder);
  } catch {
    return "folder does not exist: " + folder;
  }
  if (!st.isDirectory()) return "not a directory: " + folder;
  if (!fs.existsSync(path.join(folder, "workflow.toml"))) {
    return "no workflow.toml in folder: " + folder;
  }
  return null;
}

// editable program files — whitelisted shapes only, and the resolved path
// must stay inside the dag's source folder (no .., no symlink escape)
const PROGRAM_NAME_RE =
  /^(?:workflow\.toml|task\.txt|roots\.txt|project\.json|members\/[A-Za-z0-9._-]+\.md|hooks\/[A-Za-z0-9._-]+)$/;

function programPath(source, name) {
  if (typeof name !== "string" || !PROGRAM_NAME_RE.test(name)) return null;
  let root;
  try {
    root = fs.realpathSync(source);
  } catch {
    return null;
  }
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) return null;
  // the deepest existing ancestor must still be inside the root — this
  // catches a members or hooks symlink that points elsewhere
  let probe = target;
  while (probe !== root && !fs.existsSync(probe)) probe = path.dirname(probe);
  try {
    const real = fs.realpathSync(probe);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
  } catch {
    return null;
  }
  return target;
}

// list the editable files that exist in a source folder
function programList(source) {
  const out = [];
  const stat = (name) => {
    const p = programPath(source, name);
    if (!p) return;
    try {
      const st = fs.statSync(p);
      if (st.isFile()) out.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
    } catch {}
  };
  for (const top of ["workflow.toml", "task.txt", "roots.txt", "project.json"]) stat(top);
  for (const dir of ["members", "hooks"]) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(source, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (dir === "members" && !e.name.endsWith(".md")) continue;
      stat(dir + "/" + e.name);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// one-shot run dirs: copied, edited, run, then swept a bit later (the
// door stages its own copy into the job dir; the temp copy is scratch)
const tempRunDirs = new Set();
function scheduleRm(dir, ms) {
  tempRunDirs.add(dir);
  setTimeout(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    tempRunDirs.delete(dir);
  }, ms).unref();
}
process.on("exit", () => {
  for (const d of tempRunDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});


function readEvents(sid) {
  const file = path.join(SESSIONS_DIR, sid, "events.jsonl");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const events = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* skip torn tail line */
    }
  }
  // oldest first (append order; sort by ts to be safe)
  events.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return events;
}

// ---- v4.1: events as a stream (SSE) ------------------------------------
//
// GET /api/events/stream?sid=<sid>&jid=<jid> — text/event-stream:
//   event: snapshot  data: {sid, jid, count, events:[...]}  on connect
//   event: append    data: <one event object>                as it lands
//   `: ping` heartbeat every 15s; the watcher dies with its last sub.
//
// One watcher per session's events.jsonl, fanned out to all subscribers
// of that file; jid filtering happens per subscriber, server-side. The
// one-shot GET /api/events stays the first-paint / finished-run path.

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

function sseSend(res, event, obj) {
  res.write("event: " + event + "\ndata: " + JSON.stringify(obj) + "\n\n");
}

// dedupe key for the connect seam: an event that lands between the
// snapshot read and the watcher's not-yet-parsed bytes would otherwise
// be delivered twice (ts is ms-precise write time; collisions do not
// happen in practice for distinct lines)
function evKey(e) {
  return (e.ts || "") + "|" + (e.kind || "") + "|" + (e.jid || "") +
    "|" + (e.label || e.pane || "");
}

const eventWatchers = new Map(); // sid -> watcher

// read only NEW bytes [offset, eof): complete lines only — a torn
// trailing line waits for its newline. Truncation resets and re-reads.
function readNewEvents(file, offset) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { events: [], offset }; // file gone for now; keep position
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < offset) offset = 0; // truncated/rotated: re-read from start
    if (size === offset) return { events: [], offset };
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) return { events: [], offset }; // no complete line yet
    const events = [];
    for (const line of buf.subarray(0, lastNl).toString("utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        events.push(JSON.parse(t));
      } catch {
        /* skip torn/partial line */
      }
    }
    return { events, offset: offset + lastNl + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

function ensureEventWatcher(sid) {
  let w = eventWatchers.get(sid);
  if (w) return w;
  const sdir = path.join(SESSIONS_DIR, sid);
  const file = path.join(sdir, "events.jsonl");
  w = { sid, file, offset: 0, subs: new Set(), fsWatcher: null, safety: null };
  // start at EOF: history travels in the snapshot, only NEW bytes stream
  try {
    w.offset = fs.statSync(file).size;
  } catch {
    /* no events.jsonl yet: every future line is new */
  }
  const poll = () => {
    const { events, offset } = readNewEvents(w.file, w.offset);
    w.offset = offset;
    for (const e of events) {
      for (const sub of w.subs) {
        if (sub.jid && e.jid !== sub.jid) continue; // per-subscriber jid filter
        if (!sub.seedKeys || !sub.seedKeys.has(evKey(e))) {
          sseSend(sub.res, "append", e);
        }
      }
    }
    // the connect seam has passed once a poll ran: drop the seed sets
    if (events.length) for (const sub of w.subs) sub.seedKeys = null;
  };
  w.poll = poll;
  try {
    // watch the session DIR (not the file): survives create + replace
    w.fsWatcher = fs.watch(sdir, { persistent: false }, (evt, name) => {
      if (!name || name === "events.jsonl") poll();
    });
  } catch {
    /* dir vanished; the safety poll keeps trying */
  }
  // safety net: fs.watch can drop events (esp. over network fs) — a
  // cheap unref'd 2s poll guarantees liveness without busy work
  w.safety = setInterval(poll, 2000);
  w.safety.unref();
  eventWatchers.set(sid, w);
  log("event watcher up:", sid);
  return w;
}

function destroyEventWatcher(sid) {
  const w = eventWatchers.get(sid);
  if (!w) return;
  eventWatchers.delete(sid);
  if (w.fsWatcher) {
    try {
      w.fsWatcher.close();
    } catch {}
  }
  if (w.safety) clearInterval(w.safety);
  log("event watcher down:", sid);
}

// ---- v4: home (the Home page in one call) ------------------------------

function dayKeyOf(iso) {
  const t = Date.parse(iso || "");
  if (!isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10); // UTC day
}

// {allow, deny, denyUnneeded} from trace `permission` events — the trace
// IS the session's events.jsonl
function permissionMixAll() {
  const mix = { allow: 0, deny: 0, denyUnneeded: 0 };
  for (const s of readSessions()) {
    const events = readEvents(s.id);
    if (!events) continue;
    for (const e of events) {
      if (e.kind !== "permission") continue;
      if (e.decision === "allow") mix.allow++;
      else if (e.decision === "deny") mix.deny++;
      else if (e.decision === "deny-unneeded") mix.denyUnneeded++;
    }
  }
  return mix;
}

function buildHome() {
  const now = Date.now();
  const rows = listAllJobs().map((job) => ({
    created: job.created || null,
    durationMs: durationMsOf(job),
    status: statusOf(job, reportOf(job)),
  }));
  const in24 = rows.filter((r) => {
    const t = Date.parse(r.created || "");
    return isFinite(t) && t >= now - 24 * 3600 * 1000;
  });
  const terminal24 = in24.filter(
    (r) => r.status === "success" || r.status === "failed" || r.status === "aborted",
  );
  const ok24 = terminal24.filter((r) => r.status === "success");
  const dur24 = terminal24.map((r) => r.durationMs).filter((d) => d != null);

  const kpis = {
    jobs24h: in24.length,
    // % of terminal (success|failed) jobs started in the last 24h that
    // succeeded; null when nothing terminal ran in the window
    successRate24h: terminal24.length
      ? Math.round((ok24.length / terminal24.length) * 1000) / 10
      : null,
    avgDuration24h: dur24.length
      ? Math.round(dur24.reduce((a, b) => a + b, 0) / dur24.length)
      : null,
    runningNow: rows.filter((r) => r.status === "running").length,
    orphanedNow: rows.filter((r) => r.status === "orphaned").length,
  };

  // 14 day buckets (UTC day of created), oldest -> newest, zero-filled
  const days = [];
  for (let i = 13; i >= 0; i--) {
    days.push(new Date(now - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
  }
  const runsPerDay = days.map((day) => ({
    day,
    success: 0,
    failed: 0,
    aborted: 0,
    running: 0,
    paused: 0,
    orphaned: 0,
  }));
  const byDay = new Map(runsPerDay.map((d) => [d.day, d]));
  for (const r of rows) {
    const day = dayKeyOf(r.created);
    const b = day ? byDay.get(day) : null;
    if (b && r.status in b) b[r.status]++;
  }

  const durationTrend = buildDags()
    .filter((g) => g.dag_id !== UNGROUPED)
    .map((g) => ({
      dag_id: g.dag_id,
      project: g.project,
      points: [...g.runs]
        .sort((a, b) => (a.created || "").localeCompare(b.created || ""))
        .map((r) => ({
          jid: r.jid,
          durationMs: r.durationMs,
          version: r.version ?? null,
          status: r.status,
        })),
    }));

  return {
    generatedAt: new Date().toISOString(),
    kpis,
    runsPerDay,
    durationTrend,
    permissionMix: permissionMixAll(),
  };
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "cache-control": "no-store",
  });
  res.end(buf);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    return sendError(res, 403, "forbidden");
  }
  let st = null;
  try {
    st = fs.statSync(file);
  } catch {
    return sendError(res, 404, "not found: " + urlPath);
  }
  if (st.isDirectory()) {
    const idx = path.join(file, "index.html");
    if (!fs.existsSync(idx)) return sendError(res, 404, "not found: " + urlPath);
    return streamFile(res, idx);
  }
  return streamFile(res, file);
}

function streamFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": fs.statSync(file).size,
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Spawn the run door detached, collect its first stdout lines (job:,
// workflow:, log:, trace:) or stderr, then let it go. The CLI itself
// daemonizes the orchestrator and exits, so a short cap is enough.
function spawnRun(folder) {
  return new Promise((resolve) => {
    const child = spawnDoor(["run", folder], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    let settled = false;
    const cap = 4000; // ms
    const timer = setTimeout(() => finish("timeout"), cap);
    function finish(reason) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // if the CLI is somehow still hanging, drop our pipes; never kill a
      // child that may already have printed job: (orchestrator is detached)
      if (reason === "timeout" && out.length === 0) {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
      resolve({
        lines: out,
        stderr: err,
        exitCode: child.exitCode,
        reason,
      });
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      for (const line of d.split(/\r?\n/)) {
        if (line.trim()) out.push(line.trimEnd());
      }
      // the door prints 4 lines (job:, workflow:, log:, trace:) then exits
      if (out.some((l) => l.startsWith("job:"))) {
        // give it a beat for the remaining lines / exit, then answer
        setTimeout(() => finish("lines"), 300);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => err.push(...d.split(/\r?\n/).filter((l) => l.trim())));
    child.on("error", (e) => {
      err.push(String(e && e.message ? e.message : e));
      finish("error");
    });
    child.on("close", () => finish("exit"));
    child.unref();
  });
}

// v5: run one rail verb (pause|abort|continue) against a Job. These are
// one-shot CLI calls: refusals land on stderr with a non-zero exit (the
// CLI's words are the truth — surfaced verbatim), success on stdout.
// Unlike `run` the child is NOT detached and is never killed on cap —
// abort/continue may spend tens of seconds retiring straggler panes
// (shep retire, 30s each); on cap we answer with what we have and let
// the one-shot CLI finish on its own.
function spawnVerb(verb, jid, extraArgs = [], capMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawnDoor([verb, jid, ...extraArgs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    let settled = false;
    const timer = setTimeout(() => finish("timeout"), capMs);
    function finish(reason) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        lines: out,
        stderr: err,
        exitCode: child.exitCode,
        reason,
      });
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      for (const line of d.split(/\r?\n/)) {
        if (line.trim()) out.push(line.trimEnd());
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      for (const line of d.split(/\r?\n/)) {
        if (line.trim()) err.push(line.trimEnd());
      }
    });
    child.on("error", (e) => {
      err.push(String(e && e.message ? e.message : e));
      finish("error");
    });
    child.on("close", () => finish("exit"));
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const q = url.searchParams;

  if (req.method === "GET" && pathname === "/api/summary") {
    const sessions = readSessions();
    const jobs = listAllJobs().map(flattenJob);
    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      sessionsTotal: sessions.length,
      jobsTotal: jobs.length,
      dagsTotal: buildDags().filter((d) => d.dag_id !== "(ungrouped)").length,
      jobsByState: countBy(jobs, (j) => j.state),
      jobsByOutcome: countBy(jobs, (j) => j.outcome),
      sessions,
    });
  }

  if (req.method === "GET" && pathname === "/api/jobs") {
    let jobs = listAllJobs().map(flattenJob);
    const group = q.get("group");
    if (group !== null) {
      const ref = group;
      const i = ref.indexOf("/");
      if (i <= 0 || i === ref.length - 1) {
        return sendError(res, 400, "bad group, want <pid>/<dag_id>");
      }
      const pid = ref.slice(0, i);
      const dagId = ref.slice(i + 1);
      jobs = jobs.filter(
        (j) => j.dag && j.dag.project === pid && j.dag.dag_id === dagId,
      );
    }
    const sort = q.get("sort");
    if (sort !== null && sort !== "") {
      const keyFn = {
        state: (j) => j.state || "",
        created: (j) => j.created || "",
        duration: (j) => j.durationMs,
        status: (j) => STATUS_RANK[j.status] ?? 9,
      }[sort];
      if (!keyFn) {
        return sendError(res, 400, "bad sort, want state|created|duration|status");
      }
      const dir = sortDirOf(q.get("order"));
      if (dir === null) return sendError(res, 400, "bad order, want asc|desc");
      applySort(jobs, keyFn, dir);
    }
    return sendJson(res, 200, { count: jobs.length, jobs });
  }

  if (req.method === "GET" && pathname === "/api/home") {
    return sendJson(res, 200, buildHome());
  }

  if (req.method === "GET" && pathname === "/api/dags") {
    // v4: sort by the latest run (start/end/duration/status) or dag name;
    // v3 keys runs|last|created keep working. The (ungrouped) group is
    // EXCLUDED — legacy runs are reached via /api/jobs only.
    const sort = q.get("sort") || "last";
    const keyFn = {
      start: (g) => g.latestRun?.start ?? null,
      end: (g) => g.latestRun?.end ?? null,
      duration: (g) => g.latestRun?.durationMs ?? null,
      status: (g) => (g.latestRun?.status != null ? STATUS_RANK[g.latestRun.status] ?? 9 : null),
      dag: (g) => g.dag_id,
      runs: (g) => g.runCount,
      last: (g) => g.lastRun?.created ?? null,
      created: (g) => g.created ?? null,
    }[sort];
    if (!keyFn) {
      return sendError(
        res,
        400,
        "bad sort, want start|end|duration|status|dag|runs|last|created",
      );
    }
    const dir = sortDirOf(q.get("order"));
    if (dir === null) return sendError(res, 400, "bad order, want asc|desc");
    const dags = buildDags().filter((g) => g.dag_id !== UNGROUPED);
    applySort(dags, keyFn, dir);
    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      sort,
      order: dir === 1 ? "asc" : "desc",
      count: dags.length,
      dags,
    });
  }

  // v4: the dag's definition, parsed LIVE from its SOURCE folder (not a
  // run's staged copy) — config edits show up immediately. Lab programs:
  // import() the source dag.mjs; coworker programs: members/*.md as nodes
  // with relay chain edges. PLUS hooks from the source workflow.toml.
  // v5.2: if the source folder is GONE (merged-and-removed worktree, a
  // moved folder — the dangling-pointer case), fall back READ-ONLY to
  // the newest run's staged copy and mark it `stale`. Zero writes: the
  // copies already exist per run. Trigger / run-with-edits / program
  // edits keep refusing — they act on the source, which is not there.
  let m = pathname.match(/^\/api\/dag-definition\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const pid = safeDecode(res, m[1]);
    const dagId = safeDecode(res, m[2]);
    if (pid === null || dagId === null) return;
    const g = findDagGroup(pid + "/" + dagId);
    if (!g) return sendError(res, 404, "no such dag: " + pid + "/" + dagId);
    if (!g.source) return sendError(res, 400, "dag has no source folder");
    const base = {
      project: g.project,
      dag_id: g.dag_id,
      source: g.source,
    };

    const srcErr = sourceFolderError(g.source);
    if (!srcErr) {
      const def = await definitionFromFolder(g.source);
      if (def) return sendJson(res, 200, { ...base, ...def });
      return sendJson(res, 200, {
        ...base,
        kind: g.kind || "none",
        nodes: [],
        edges: [],
        hooks: stagedHooks(g.source),
      });
    }

    // the source dangles — serve the newest staged copy, marked
    const staged = await stagedDefinition(g);
    if (staged) {
      return sendJson(res, 200, {
        ...base,
        kind: staged.kind,
        dagName: staged.dagName,
        nodes: staged.nodes,
        edges: staged.edges,
        hooks: staged.hooks,
        ...(staged.error ? { error: staged.error } : {}),
        stale: {
          reason: srcErr,
          fromSid: staged.sid,
          fromRun: staged.jid,
          runDir: staged.runDir,
        },
      });
    }
    return sendError(res, 400, srcErr + " — and no run of this dag kept a staged copy");
  }

  // v4: the read-only run-dir browser — the run dir's file tree, and
  // ?path=<rel> for one file's text (capped at 8000 chars). report.json is
  // fetched by name and rendered by the frontend. No secrets by design.
  m = pathname.match(/^\/api\/run-dir\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const [, sid, jid] = m;
    if (!ID_RE.test(sid) || !ID_RE.test(jid)) return sendError(res, 400, "bad id");
    const job = readJson(jobFileOf(sid, jid));
    if (!job) return sendError(res, 404, "no such job: " + sid + "/" + jid);
    const runDir = runDirOf(job, sid, jid);
    let root = null;
    try {
      root = fs.realpathSync(runDir);
    } catch {
      return sendError(res, 404, "run dir not found: " + runDir);
    }
    const rel = q.get("path");
    if (rel === null || rel === "") {
      return sendJson(res, 200, { sid, jid, runDir, tree: treeOf(root, 0) });
    }
    if (rel.includes("\u0000")) return sendError(res, 400, "bad path");
    const target = path.resolve(root, "." + path.sep + rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return sendError(res, 403, "path escapes run dir");
    }
    let st = null;
    try {
      st = fs.statSync(target);
    } catch {
      return sendError(res, 404, "no such file: " + rel);
    }
    if (st.isDirectory()) return sendError(res, 400, "path is a directory: " + rel);
    const r = cappedRead(target, 8000);
    if (!r) return sendError(res, 404, "no such file: " + rel);
    const binary = r.text.includes("\u0000");
    return sendJson(res, 200, {
      sid,
      jid,
      runDir,
      path: rel,
      bytes: st.size,
      truncated: r.truncated,
      binary,
      text: binary ? null : r.text,
    });
  }

  m = pathname.match(/^\/api\/dag-shape\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const [, sid, jid] = m;
    if (!ID_RE.test(sid) || !ID_RE.test(jid)) return sendError(res, 400, "bad id");
    const job = readJson(jobFileOf(sid, jid));
    if (!job) return sendError(res, 404, "no such job: " + sid + "/" + jid);
    const shape = await dagShape(job, sid, jid);
    return sendJson(res, 200, { sid, jid, ...shape });
  }

  m = pathname.match(/^\/api\/source\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const [, sid, jid] = m;
    if (!ID_RE.test(sid) || !ID_RE.test(jid)) return sendError(res, 400, "bad id");
    const job = readJson(jobFileOf(sid, jid));
    if (!job) return sendError(res, 404, "no such job: " + sid + "/" + jid);
    return sendJson(res, 200, sourceOf(job, sid, jid));
  }

  m = pathname.match(/^\/api\/job\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const [, sid, jid] = m;
    if (!ID_RE.test(sid) || !ID_RE.test(jid)) return sendError(res, 400, "bad id");
    const jobFile = jobFileOf(sid, jid);
    const job = readJson(jobFile);
    if (!job) return sendError(res, 404, "no such job: " + sid + "/" + jid);
    const report = job.dir
      ? readJson(path.join(job.dir, "report.json"))
      : readJson(path.join(SESSIONS_DIR, sid, "jobs", jid, "run", "report.json"));
    return sendJson(res, 200, { job: flattenJob(job), report });
  }

  // v5 (ADR 5): the rail verbs — pause parks a live run (SIGTERM, drains
  // to a unit boundary, books paused), abort kills it (SIGKILL, booked
  // sessions survive), continue rebirths a paused|aborted|orphaned run.
  // The CLI is the truth: server-side we only check the Job exists, the
  // CLI's own refusal line rides back verbatim as an honest 4xx.
  m = pathname.match(/^\/api\/job\/([^/]+)\/([^/]+)\/(pause|abort|continue)$/);
  if (req.method === "POST" && m) {
    const [, sid, jid, verb] = m;
    if (!ID_RE.test(sid) || !ID_RE.test(jid)) return sendError(res, 400, "bad id");
    const job = readJson(jobFileOf(sid, jid));
    if (!job) return sendError(res, 404, "no such job: " + sid + "/" + jid);
    const raw = await readBody(req);
    let body = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return sendError(res, 400, "invalid JSON body");
      }
    }
    const extraArgs = [];
    if (verb === "pause" && body?.wait != null) {
      if (typeof body.wait !== "string" || !body.wait.trim() || body.wait.length > 16) {
        return sendError(res, 400, "'wait' wants a duration like 2m or 90s");
      }
      extraArgs.push("--wait", body.wait.trim());
    }
    const r = await spawnVerb(verb, jid, extraArgs);
    if (r.reason === "error") {
      return sendJson(res, 500, {
        ok: false,
        error: r.stderr[0] || "could not run the door: " + RUN_DOOR,
        ...r,
      });
    }
    if (r.reason === "timeout") {
      return sendJson(res, 504, {
        ok: false,
        verb,
        sid,
        jid,
        error: "door still running — the verb was signalled, watch the run",
        ...r,
      });
    }
    if (r.exitCode !== 0) {
      // the CLI's refusal, verbatim — stderr first (refusals print
      // there), else its last stdout word
      const line = r.stderr[0] || r.lines[r.lines.length - 1] ||
        `door exited ${r.exitCode} without a word`;
      return sendJson(res, 409, {
        ok: false,
        verb,
        sid,
        jid,
        error: line,
        ...r,
      });
    }
    return sendJson(res, 200, {
      ok: true,
      verb,
      sid,
      jid,
      ...r,
    });
  }

  // v6: delete — pure spur file removing, the "I no longer need this"
  // verb. No CLI door, no booking: the job dir (job.json + the staged
  // run/) leaves the disk for good. Refused while the run is live
  // (running, or a pause still draining — both read "running"); the
  // parks (paused|aborted|orphaned) and retired (success|failed) are
  // fair game. Not revertable — the UI confirms louder than the rail
  // verbs for exactly this reason.
  m = pathname.match(/^\/api\/job\/([^/]+)\/([^/]+)\/delete$/);
  if (req.method === "POST" && m) {
    const [, sid, jid] = m;
    if (!ID_RE.test(sid) || !ID_RE.test(jid)) return sendError(res, 400, "bad id");
    const job = readJson(jobFileOf(sid, jid));
    if (!job) return sendError(res, 404, "no such job: " + sid + "/" + jid);
    if (statusOf(job, reportOf(job)) === "running") {
      return sendError(res, 409, "refusing: run is live — abort or pause it first");
    }
    const jobDir = path.join(SESSIONS_DIR, sid, "jobs", jid);
    // the staged run dir rides inside the job dir (jobs/<jid>/run); a
    // job.dir pointing elsewhere under the sessions root is swept too,
    // but nothing outside it is ever touched
    const extraDir = typeof job.dir === "string" &&
      job.dir.startsWith(SESSIONS_DIR + path.sep) &&
      !job.dir.startsWith(jobDir + path.sep) ? job.dir : null;
    const removed = [];
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      removed.push(jobDir);
      if (extraDir && fs.existsSync(extraDir)) {
        fs.rmSync(extraDir, { recursive: true, force: true });
        removed.push(extraDir);
      }
    } catch (e) {
      return sendError(res, 500, "delete failed: " + (e && e.message ? e.message : e));
    }
    log("job deleted:", sid, jid, "removed:", removed.join(" ,"));
    return sendJson(res, 200, { ok: true, verb: "delete", sid, jid, removed });
  }

  // v4.1: the live events stream — one snapshot on connect, then one
  // append per new event as it lands in the session's events.jsonl.
  // Must run BEFORE the /api/events/:sid regex (that would eat "stream").
  if (req.method === "GET" && pathname === "/api/events/stream") {
    const sid = q.get("sid");
    const jid = q.get("jid");
    if (!sid || !ID_RE.test(sid)) return sendError(res, 400, "bad or missing sid");
    if (jid && !ID_RE.test(jid)) return sendError(res, 400, "bad jid");
    const sdir = path.join(SESSIONS_DIR, sid);
    if (!fs.existsSync(sdir)) return sendError(res, 404, "no such session: " + sid);

    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders();
    res.on("error", () => {}); // torn sockets surface via "close"

    const watcher = ensureEventWatcher(sid);
    const sub = { res, jid: jid || null, seedKeys: null };

    // snapshot: the run's current events — same ?sid/&jid scope as the
    // one-shot GET /api/events (the selected run's own history only)
    const all = readEvents(sid) || [];
    const scoped = jid ? all.filter((e) => e.jid === jid) : all;
    // seed dedupe keys from the tail: events sitting in the watcher's
    // un-parsed byte window are already inside this snapshot
    sub.seedKeys = new Set(scoped.slice(-100).map(evKey));
    watcher.subs.add(sub);
    sseSend(res, "snapshot", {
      sid,
      jid: jid || null,
      count: scoped.length,
      events: scoped,
    });

    const ping = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 15000);
    log("sse open:", sid, jid || "(all)", "subs:", watcher.subs.size);
    res.on("close", () => {
      clearInterval(ping);
      watcher.subs.delete(sub);
      log("sse close:", sid, jid || "(all)", "subs:", watcher.subs.size);
      if (!watcher.subs.size) destroyEventWatcher(sid); // no leaked watchers
    });
    return; // the stream stays open
  }

  m = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const sid = m[1];
    if (!ID_RE.test(sid)) return sendError(res, 400, "bad sid");
    const events = readEvents(sid);
    if (events === null) return sendError(res, 404, "no such session: " + sid);
    return sendJson(res, 200, { sid, count: events.length, events });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    // events, oldest first; scope with ?sid= and ?jid= — a run's events
    // are its own history, never every run's noise
    const u = new URL(req.url, "http://localhost");
    const sid = u.searchParams.get("sid");
    const jid = u.searchParams.get("jid");
    const all = [];
    for (const s of readSessions()) {
      if (sid && s.id !== sid) continue;
      const ev = readEvents(s.id);
      if (ev) all.push(...ev);
    }
    const scoped = jid ? all.filter((e) => e.jid === jid) : all;
    scoped.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    return sendJson(res, 200, { count: scoped.length, events: scoped });
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, port: PORT, osRoot: OS_ROOT, runDoor: RUN_DOOR, doorNode: process.execPath });
  }

  if (req.method === "POST" && pathname === "/api/run") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendError(res, 400, "invalid JSON body");
    }
    const folder = typeof body?.folder === "string" ? body.folder.trim() : "";
    if (!folder || folder.length > 4096) return sendError(res, 400, "missing 'folder' (string)");
    let st = null;
    try {
      st = fs.statSync(folder);
    } catch {
      return sendError(res, 400, "folder does not exist: " + folder);
    }
    if (!st.isDirectory()) return sendError(res, 400, "not a directory: " + folder);
    if (!fs.existsSync(path.join(folder, "workflow.toml"))) {
      return sendError(res, 400, "no workflow.toml in folder: " + folder);
    }
    const r = await spawnRun(folder);
    const ok = r.lines.some((l) => l.startsWith("job:"));
    return sendJson(
      res,
      ok ? 200 : 500,
      Object.assign({ ok, folder }, r),
    );
  }

  // v3: trigger a dag on its source folder — same door as /api/run, but
  // the folder comes from the group, not the caller
  m = pathname.match(/^\/api\/dags\/([^/]+)\/([^/]+)\/trigger$/);
  if (req.method === "POST" && m) {
    const pid = safeDecode(res, m[1]);
    const dagId = safeDecode(res, m[2]);
    if (pid === null || dagId === null) return;
    const g = findDagGroup(pid + "/" + dagId);
    if (!g) return sendError(res, 404, "no such dag: " + pid + "/" + dagId);
    if (!g.source) return sendError(res, 400, "dag has no source folder");
    const err = sourceFolderError(g.source);
    if (err) return sendError(res, 400, err);
    const r = await spawnRun(g.source);
    const ok = r.lines.some((l) => l.startsWith("job:"));
    return sendJson(
      res,
      ok ? 200 : 500,
      Object.assign(
        { ok, dag: { project: g.project, dag_id: g.dag_id }, source: g.source },
        r,
      ),
    );
  }

  // v3: run-with-edits — copy the source folder to a temp dir, apply the
  // edited files, run the door on the COPY. project.json travels with the
  // copy, so the run still groups under the same dag. Nothing is saved.
  m = pathname.match(/^\/api\/dags\/([^/]+)\/([^/]+)\/run-with-edits$/);
  if (req.method === "POST" && m) {
    const pid = safeDecode(res, m[1]);
    const dagId = safeDecode(res, m[2]);
    if (pid === null || dagId === null) return;
    const g = findDagGroup(pid + "/" + dagId);
    if (!g) return sendError(res, 404, "no such dag: " + pid + "/" + dagId);
    if (!g.source) return sendError(res, 400, "dag has no source folder");
    const err = sourceFolderError(g.source);
    if (err) return sendError(res, 400, err);
    let body;
    try {
      body = JSON.parse(await readBody(req, 512 * 1024));
    } catch {
      return sendError(res, 400, "invalid JSON body");
    }
    const files = Array.isArray(body?.files) ? body.files : null;
    if (!files || !files.length || files.length > 32) {
      return sendError(res, 400, "'files' must be a non-empty array (max 32) of {name,text}");
    }
    const edits = [];
    for (const f of files) {
      if (!f || typeof f.name !== "string" || typeof f.text !== "string") {
        return sendError(res, 400, "each file needs {name, text}");
      }
      if (Buffer.byteLength(f.text) > 200 * 1024) {
        return sendError(res, 400, "file too large (200KB cap): " + f.name);
      }
      edits.push({ name: f.name, text: f.text });
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-edit-"));
    try {
      fs.cpSync(g.source, tmp, { recursive: true });
      for (const f of edits) {
        const p = programPath(tmp, f.name);
        if (!p) {
          return sendError(res, 400, "not an editable program file: " + f.name);
        }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, f.text);
      }
    } catch (e) {
      scheduleRm(tmp, 0);
      return sendError(res, 500, "staging edits failed: " + (e?.message || e));
    }
    const r = await spawnRun(tmp);
    scheduleRm(tmp, 10 * 60 * 1000); // scratch; the door stages its own copy
    const ok = r.lines.some((l) => l.startsWith("job:"));
    return sendJson(
      res,
      ok ? 200 : 500,
      Object.assign(
        {
          ok,
          dag: { project: g.project, dag_id: g.dag_id },
          source: g.source,
          edits: edits.map((f) => f.name),
          ephemeral: true,
        },
        r,
      ),
    );
  }

  // v3: program files — list / read / save inside the dag's source folder
  if (pathname === "/api/program") {
    if (req.method === "GET") {
      const g = findDagGroup(q.get("dag") || "");
      if (!g) return sendError(res, 404, "no such dag: " + (q.get("dag") || "(none)"));
      if (!g.source) return sendError(res, 400, "dag has no source folder");
      const name = q.get("name");
      if (name === null || name === "") {
        return sendJson(res, 200, {
          dag: { project: g.project, dag_id: g.dag_id, project_name: g.project_name },
          source: g.source,
          files: programList(g.source),
        });
      }
      const p = programPath(g.source, name);
      if (!p) return sendError(res, 400, "not an editable program file: " + name);
      let text = null;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        return sendError(res, 404, "no such file: " + name);
      }
      return sendJson(res, 200, {
        dag: { project: g.project, dag_id: g.dag_id, project_name: g.project_name },
        name,
        text,
        bytes: Buffer.byteLength(text),
      });
    }
    if (req.method === "PUT") {
      let body;
      try {
        body = JSON.parse(await readBody(req, 512 * 1024));
      } catch {
        return sendError(res, 400, "invalid JSON body");
      }
      const dagRef = typeof body?.dag === "string" ? body.dag : "";
      const g = findDagGroup(dagRef);
      if (!g) return sendError(res, 404, "no such dag: " + (dagRef || "(none)"));
      if (!g.source) return sendError(res, 400, "dag has no source folder");
      if (typeof body?.name !== "string" || typeof body?.text !== "string") {
        return sendError(res, 400, "need {dag, name, text}");
      }
      if (Buffer.byteLength(body.text) > 200 * 1024) {
        return sendError(res, 400, "text too large (200KB cap)");
      }
      const p = programPath(g.source, body.name);
      if (!p) return sendError(res, 400, "not an editable program file: " + body.name);
      const existed = fs.existsSync(p);
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmpWrite = p + ".tmp-" + process.pid;
        fs.writeFileSync(tmpWrite, body.text);
        fs.renameSync(tmpWrite, p);
      } catch (e) {
        return sendError(res, 500, "save failed: " + (e?.message || e));
      }
      log("program saved:", dagRef, body.name, existed ? "(overwrote)" : "(new)");
      return sendJson(res, 200, {
        ok: true,
        dag: { project: g.project, dag_id: g.dag_id },
        name: body.name,
        bytes: Buffer.byteLength(body.text),
        created: !existed,
      });
    }
  }

  return sendError(res, 404, "no such api: " + req.method + " " + pathname);
}

// decode one path segment for v3 dag routes ("p-fd72b2", "ui-window");
// answers the response itself and returns null on a bad escape
function safeDecode(res, seg) {
  try {
    const d = decodeURIComponent(seg);
    if (d.includes("/") || d.length > 128 || d.includes("\u0000")) {
      sendError(res, 400, "bad dag path segment");
      return null;
    }
    return d;
  } catch {
    sendError(res, 400, "bad percent-encoding");
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return sendError(res, 400, "bad url");
  }
  try {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendError(res, 405, "method not allowed");
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    log("error", url.pathname, e && e.stack ? e.stack : e);
    if (!res.headersSent) sendError(res, 500, "internal error");
  }
});

server.listen(PORT, HOST, () => {
  log(
    "agentic-os window server up:",
    "http://" + HOST + ":" + PORT,
    "| public:",
    PUBLIC_DIR,
    "| os disk:",
    SESSIONS_DIR,
  );
});
