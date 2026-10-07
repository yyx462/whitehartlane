#!/usr/bin/env node
// agentic-os window — backend server. Node stdlib only, no npm.
// Serves web/public/ statically and a JSON API over the OS disk
// (~/.local/share/agentic-os): sessions, Jobs, panes, events, reports.
// The only write action is POST /api/run, which spawns the run door
// (agentic-os run <folder>) detached and returns its first stdout lines.
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const OS_ROOT = path.join(process.env.HOME, ".local/share/agentic-os");
const SESSIONS_DIR = path.join(OS_ROOT, "sessions");
const RUN_DOOR =
  "/Users/sagebot/projects/Agentic-Workspace/agentic-os/coworker/bin/agentic-os";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");

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
  return {
    id: job.id,
    sid: job.sid,
    workflow: job.workflow || null,
    stoodUpBy: job.stoodUpBy || null,
    state: job.state || "unknown",
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
    abort: job.abort || null, // {reason,panesRemaining,finished}
    orphan: job.orphan || null, // {reason,panesRemaining,at}
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
    g.runs.push({
      sid: job.sid,
      jid: job.id,
      state: job.state || "unknown",
      workflow: job.workflow || null,
      created: job.created || null,
      finished: finishedOf(job),
      durationMs: durationMsOf(job),
      labels: dag?.labels || {},
    });
  }
  const dags = [...groups.values()].map((g) => {
    g.runs.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
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

const shapeCache = new Map(); // dag.mjs path -> {mtimeMs, payload}

async function dagShape(job, sid, jid) {
  const runDir = runDirOf(job, sid, jid);
  const dagFile = path.join(runDir, "dag.mjs");

  // lab job: the staged dag.mjs IS data — import() it
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(dagFile).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (mtimeMs >= 0) {
    const hit = shapeCache.get(dagFile);
    if (hit && hit.mtimeMs === mtimeMs) return hit.payload;
    let payload;
    try {
      const mod = await import(pathToFileURL(dagFile).href + "?v=" + mtimeMs);
      const dag = mod.dag || mod.default?.dag || null;
      const steps = Array.isArray(dag?.steps) ? dag.steps : [];
      const nodes = [];
      const edges = [];
      for (const s of steps) {
        if (!s || typeof s.id !== "string") continue;
        nodes.push({ id: s.id, does: s.does ?? null });
        const after = Array.isArray(s.after) ? s.after : s.after ? [s.after] : [];
        for (const a of after) {
          if (typeof a === "string") edges.push({ from: a, to: s.id });
        }
      }
      payload = {
        kind: "lab",
        dagName: typeof dag?.name === "string" ? dag.name : null,
        nodes,
        edges,
      };
    } catch (e) {
      payload = {
        kind: "lab",
        dagName: null,
        nodes: [],
        edges: [],
        error: "dag.mjs import failed: " + (e && e.message ? e.message : String(e)),
      };
    }
    shapeCache.set(dagFile, { mtimeMs, payload });
    return payload;
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
      does: "member",
    }));
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
      edges.push({ from: nodes[i - 1].id, to: nodes[i].id });
    }
    return { kind: "coworker", nodes, edges };
  }

  return { kind: "none", nodes: [], edges: [] };
}

// ---- v2: source viewer -------------------------------------------------

// pull `key = "cmd"` pairs out of the [hooks] table and return the first
// absolute path token of each command (hook commands are absolute paths)
function hookPaths(tomlText) {
  const out = [];
  let inHooks = false;
  for (const raw of tomlText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inHooks = /^\[\s*hooks\s*\]/.test(line);
      continue;
    }
    if (!inHooks) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"(.*)"\s*$/);
    if (!m) continue;
    const key = m[1];
    for (const tok of m[2].split(/\s+/)) {
      if (tok.startsWith("/") || tok.startsWith("~/")) {
        out.push({ key, path: tok.replace(/^~(?=\/)/, process.env.HOME || "~") });
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
    const child = spawn(RUN_DOOR, ["run", folder], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
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

async function handleApi(req, res, pathname) {
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
    const jobs = listAllJobs().map(flattenJob);
    return sendJson(res, 200, { count: jobs.length, jobs });
  }

  if (req.method === "GET" && pathname === "/api/dags") {
    const dags = buildDags();
    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      count: dags.length,
      dags,
    });
  }

  let m = pathname.match(/^\/api\/dag-shape\/([^/]+)\/([^/]+)$/);
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

  m = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const sid = m[1];
    if (!ID_RE.test(sid)) return sendError(res, 400, "bad sid");
    const events = readEvents(sid);
    if (events === null) return sendError(res, 404, "no such session: " + sid);
    return sendJson(res, 200, { sid, count: events.length, events });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    // all sessions merged, oldest first
    const all = [];
    for (const s of readSessions()) {
      const ev = readEvents(s.id);
      if (ev) all.push(...ev);
    }
    all.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    return sendJson(res, 200, { count: all.length, events: all });
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, port: PORT, osRoot: OS_ROOT, runDoor: RUN_DOOR });
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

  return sendError(res, 404, "no such api: " + req.method + " " + pathname);
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    return sendError(res, 400, "bad url");
  }
  try {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return await handleApi(req, res, pathname);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendError(res, 405, "method not allowed");
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    log("error", pathname, e && e.stack ? e.stack : e);
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
