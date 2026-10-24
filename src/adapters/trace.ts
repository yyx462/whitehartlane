// The analyzable trace (OPTIMUM §8's fold, given a queryable shape): a
// fixed-column TSV line per event — one grammar across rail and any
// outer loop, sortable/joinable without a translator (`sort -k3 -gr`,
// `join -1 6`, `column -t`). Two files, never one mixed stream:
//   sessions/<sid>/events.tsv        — the SPARSE lineage (job.born,
//                                       job.retired, mints, corrections)
//   sessions/<sid>/jobs/<jid>/events.tsv — the run trace (everything a
//                                       job did; copy the dir, keep the
// story). job.born/job.retired appear in BOTH — two tiny lines per run
// is the price of a self-contained job dir.
// The JSONL trace in store.ts remains the orchestrator's internal fold
// input; this layer is the surface readers query. A tear in the last
// line (short write, crash mid-append) is skipped like the JSONL
// reader skips it — and `seq` makes the loss VISIBLE: a gap in the
// sequence numbers is a lost line, not a never-written one.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// local home resolution (the project.ts pattern): the trace layer never
// imports store.ts — the cycle would bind the reader to the writer
function homeRoot(): string {
  if (process.env.AGENTIC_OS_HOME) return process.env.AGENTIC_OS_HOME
  const next = join(homedir(), ".local", "share", "whitehartlane")
  const old = join(homedir(), ".local", "share", "agentic-os")
  return existsSync(old) && !existsSync(next) ? old : next
}

// eleven columns, fixed forever — a writer cannot add a twelfth without
// changing this declaration, and anything extra rides inside `detail`
export const TRACE_COLUMNS = [
  "seq",
  "ts_ms",
  "dur_ms",
  "actor",
  "kind",
  "jid",
  "task",
  "stage",
  "obj",
  "verdict",
  "detail",
] as const

export type TraceRow = {
  seq: number
  ts_ms: number
  dur_ms: number
  actor: string
  kind: string
  jid: string
  task: string
  stage: string
  obj: string
  verdict: string
  detail: string
}

// lineage kinds go to the session file as well as the job file
const LINEAGE_KINDS = new Set(["job.born", "job.retired", "job.minted", "trace.torn", "trace.gap"])

// end kinds carry their bracket's duration: the partner is the started
// event of the same stage/obj in the same file — dur_ms is derivable by
// the reader, but carrying it on the line is what makes
// `sort -k3 -gr | head` a bottleneck finder (the 1869s fixer was a
// sentence in a log before; now it is a number in a column)
const BRACKET_OF: Record<string, string> = {
  "unit.finished": "stage.started",
  "gate.settled": "gate.started",
  "pr.merged": "pr.merge-requested",
  "job.retired": "job.born",
}

export function sessionTracePath(sid: string): string {
  return join(homeRoot(), "sessions", sid, "events.tsv")
}

export function jobTracePath(sid: string, jid: string): string {
  return join(homeRoot(), "sessions", sid, "jobs", jid, "events.tsv")
}

function esc(v: string): string {
  return v.replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\n", "\\n").replaceAll("\r", "\\r")
}

function unesc(v: string): string {
  // ONE pass, left to right: "\\\\" is a literal backslash, "\t" a tab —
  // sequential replaceAll pairs re-escape what an earlier pair emitted
  // (the round-trip test caught exactly that)
  return v.replace(/\\(.)/gs, (_, c: string) => (c === "t" ? "\t" : c === "n" ? "\n" : c === "r" ? "\r" : c))
}

function headerLine(): string {
  return `#columns:${TRACE_COLUMNS.join("\t")}`
}

function nextSeq(file: string): number {
  if (!existsSync(file)) return 1
  let seq = 0
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue
    const first = line.split("\t", 1)[0]
    const n = Number(first)
    if (Number.isFinite(n) && n > seq) seq = n
  }
  return seq + 1
}

function appendRow(file: string, row: TraceRow): void {
  mkdirSync(dirname(file), { recursive: true })
  const existed = existsSync(file)
  const body = [
    String(row.seq),
    String(row.ts_ms),
    row.dur_ms ? String(row.dur_ms) : "",
    row.actor,
    row.kind,
    row.jid,
    row.task,
    row.stage,
    row.obj,
    row.verdict,
    row.detail,
  ]
    .map(esc)
    .join("\t")
  // one append per line — the torn-tail contract in the reader mirrors
  // what a single write can and cannot tear
  appendFileSync(file, existed ? `${body}\n` : `${headerLine()}\n${body}\n`)
}

// the bracket partner's ts, searched backwards in the same file — small
// files, honest linear scan; cross-process by design (the writer of the
// end event is often not the writer of the start event)
function bracketStart(file: string, startKind: string, stage: string, obj: string): number | null {
  if (!existsSync(file)) return null
  const lines = readFileSync(file, "utf8").split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line || line.startsWith("#")) continue
    const cols = line.split("\t")
    if (cols.length !== TRACE_COLUMNS.length) continue
    if (cols[4] !== startKind) continue
    if (stage && cols[7] !== stage) continue
    if (!stage && obj && cols[8] !== obj) continue
    const ts = Number(cols[1])
    if (Number.isFinite(ts)) return ts
  }
  return null
}

// map an OsEvent-shaped payload onto the fixed columns — the dialect
// unification point: whatever the emitter called it, the trace answers
// in eleven names
export function rowOf(event: Record<string, unknown>): TraceRow {
  const e = event as Record<string, any>
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) {
    if (k === "ts" || k === "sid" || k === "actor" || k === "kind" || k === "jid" || k === "task" || k === "stage" || k === "obj") continue
    if (k === "unit" || k === "pass" || k === "verdict" || k === "dur_ms") continue
    if (v === undefined) continue
    rest[k] = v
  }
  let verdict = ""
  if (typeof e.verdict === "string") verdict = e.verdict
  else if (e.pass === true) verdict = "ok"
  else if (e.pass === false) verdict = "fail"
  else if (e.status === "ok") verdict = "ok"
  else if (e.status === "FAILED" || e.status === "grade-fault") verdict = "fail"
  if (rest.status !== undefined && (rest.status === "ok" || rest.status === "FAILED" || rest.status === "grade-fault" || rest.status === "info")) delete rest.status
  if (rest.pass !== undefined) delete rest.pass
  return {
    seq: 0,
    ts_ms: e.ts_ms ?? (e.ts ? Date.parse(String(e.ts)) : Date.now()),
    dur_ms: typeof e.dur_ms === "number" ? e.dur_ms : 0,
    actor: String(e.actor ?? ""),
    kind: String(e.kind ?? ""),
    jid: e.jid ? String(e.jid) : "",
    task: e.task ? String(e.task) : "",
    stage: String(e.stage ?? e.unit ?? ""),
    obj: String(e.obj ?? ""),
    verdict,
    detail: Object.keys(rest).length ? JSON.stringify(rest) : "",
  }
}

// the router: run-level events → the job file only; lineage events →
// session file AND job file. Failures never break the run (the JSONL
// trace remains the internal store); the surface is best-effort by
// construction, so a read-only disk degrades the view, not the job.
export function emitTrace(sid: string, event: Record<string, unknown>): void {
  try {
    const row = rowOf(event)
    const jid = row.jid
    const lineage = LINEAGE_KINDS.has(row.kind)
    const home = homeRoot()
    if (jid) {
      const jobFile = jobTracePath(sid, jid)
      const partner = BRACKET_OF[row.kind]
      if (partner && !row.dur_ms) {
        const start = bracketStart(jobFile, partner, row.stage, row.obj)
        if (start !== null) row.dur_ms = Math.max(0, row.ts_ms - start)
      }
      row.seq = nextSeq(jobFile)
      appendRow(jobFile, row)
      if (lineage) {
        const sessFile = join(home, "sessions", sid, "events.tsv")
        row.seq = nextSeq(sessFile)
        appendRow(sessFile, row)
      }
    } else {
      const sessFile = join(home, "sessions", sid, "events.tsv")
      row.seq = nextSeq(sessFile)
      appendRow(sessFile, row)
    }
  } catch {
    /* the trace surface never gates the run */
  }
}

export type TraceRead = { rows: TraceRow[]; tornTail: boolean; gaps: number[] }

// the reader contract: a torn FINAL line is dropped (a crash mid-append
// left it; the next append buries it), a torn INTERIOR line is a fact —
// recorded as a gap. Seq gaps make lost lines visible: without them a
// vanished line is indistinguishable from a never-written one.
export function readTrace(file: string): TraceRead {
  const rows: TraceRow[] = []
  const gaps: number[] = []
  let tornTail = false
  if (!existsSync(file)) return { rows, tornTail, gaps }
  const lines = readFileSync(file, "utf8").split("\n")
  let expected = 1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.startsWith("#")) continue
    const cols = line.split("\t").map(unesc)
    if (cols.length !== TRACE_COLUMNS.length || !Number.isFinite(Number(cols[0]))) {
      if (i === lines.length - 1) tornTail = true
      else gaps.push(-1)
      continue
    }
    const seq = Number(cols[0])
    if (seq !== expected) gaps.push(seq - 1)
    expected = seq + 1
    rows.push({
      seq,
      ts_ms: Number(cols[1]),
      dur_ms: Number(cols[2]) || 0,
      actor: cols[3],
      kind: cols[4],
      jid: cols[5],
      task: cols[6],
      stage: cols[7],
      obj: cols[8],
      verdict: cols[9],
      detail: cols[10] ?? "",
    })
  }
  return { rows, tornTail, gaps }
}

export function renderTraceTable(file: string): string {
  const { rows, tornTail, gaps } = readTrace(file)
  const lines = [TRACE_COLUMNS.join("\t")]
  for (const r of rows) {
    lines.push(
      [
        r.seq,
        r.ts_ms,
        r.dur_ms || "",
        r.actor,
        r.kind,
        r.jid,
        r.task,
        r.stage,
        r.obj,
        r.verdict,
        r.detail,
      ].join("\t"),
    )
  }
  if (tornTail) lines.push(`# torn tail: last line was cut mid-write (skipped)`)
  for (const g of gaps) lines.push(`# gap: seq ${g} lost`)
  return lines.join("\n")
}
