import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { PERMISSION_CAP } from "../src/permission.ts"
import { Rail, type RailLedger, type RunnerResult } from "../src/rail.ts"
import type { JobRecord } from "../src/store.ts"

// The rail is driven through fake shep/herdr runners — the same seam a
// future migration (panes as remote machines) would swap. No real CLI
// runs; no OS disk is touched (the ledger is injected).
type Call = { tool: "shep" | "herdr"; args: string[] }

function fakeLedger(): RailLedger & { events: { kind: string; payload: Record<string, unknown> }[]; attached: string[]; killed: string[] } {
  const events: { kind: string; payload: Record<string, unknown> }[] = []
  const attached: string[] = []
  const killed: string[] = []
  const job = {
    id: "j-test",
    sid: "s-test",
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "test",
    dir: "/tmp/agentic-os-test",
    state: "running",
    created: new Date().toISOString(),
    panes: [],
  } as JobRecord
  return {
    job,
    events,
    attached,
    killed,
    emit: (kind, payload) => events.push({ kind, payload }),
    attach: (label) => attached.push(label),
    kill: (label) => killed.push(label),
    finish: () => {},
    abort: () => {},
    pause: () => {},
    setSession: () => {},
  }
}

function makeRail(opts: {
  taskDir: string
  blocked?: string[]
  term?: string
  promptFails?: number
  judge?: (input: { path: string; ask: string; context?: string }) => number
  logs?: string[]
  failSub?: string
}) {
  const calls: Call[] = []
  const blocked = new Set(opts.blocked ?? [])
  let promptFailures = opts.promptFails ?? 0
  const herdrRunner = (args: string[]): RunnerResult => {
    calls.push({ tool: "herdr", args })
    if (args[0] === "agent" && args[1] === "get") {
      const status = blocked.has(args[2]!) ? "blocked" : "idle"
      return { status: 0, stdout: `{"result":{"agent":"${args[2]}","agent_status":"${status}"}}` }
    }
    if (args[0] === "agent" && args[1] === "read") {
      return { status: 0, stdout: opts.term ?? "" }
    }
    if (args[0] === "agent" && args[1] === "prompt") {
      if (promptFailures > 0) {
        promptFailures--
        return { status: 1, stdout: "" }
      }
      return { status: 0, stdout: "" }
    }
    if (opts.failSub && args[0] === "agent" && args[1] === opts.failSub) {
      return { status: 1, stdout: "" }
    }
    return { status: 0, stdout: "" }
  }
  const shepRunner = (args: string[]): RunnerResult => {
    calls.push({ tool: "shep", args })
    return { status: 0, stdout: "" }
  }
  const rail = new Rail({
    argvDir: opts.taskDir,
    ledger: fakeLedger() as RailLedger,
    judge: opts.judge,
    log: opts.logs ? (msg) => opts.logs!.push(msg) : () => {},
    shepRunner,
    herdrRunner,
  })
  return {
    rail,
    calls,
    blocked,
    sent: (keys: string[]) =>
      calls.filter((c) => c.tool === "herdr" && c.args[0] === "agent" && c.args[1] === "send-keys" && c.args[3] === keys[0] && c.args[2]),
    prompts: () => calls.filter((c) => c.tool === "herdr" && c.args[0] === "agent" && c.args[1] === "prompt"),
  }
}

function askFor(path: string): string {
  return `Permission required\nwrite to ${path}\nthe agent wants to touch this file`
}

test("a dialog inside the worker's booked cwd is allowed, granted durably, and entered", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-allow-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "do the thing", "utf8"))
  // the dialog's subject exists on disk (addWorkerRoot realpaths its dir)
  mkdirSync(join(taskDir, "sub"), { recursive: true })
  const one = makeRail({ taskDir, term: askFor(`${taskDir}/sub/file.txt`) })
  assert.equal(one.rail.spawnWorker("w-france", "opencode", briefPath, taskDir), true)
  one.blocked.add(one.rail.scopedName("w-france"))
  assert.equal(one.rail.answerPermission("w-france"), "allow")
  const enter = one.calls.find((c) => c.tool === "herdr" && c.args[1] === "send-keys" && c.args[3] === "enter")
  assert.ok(enter, "enter was sent")
  // durable: the granted root landed in the worker cwd's opencode.json
  const cfg = JSON.parse(readFileSync(join(taskDir, "opencode.json"), "utf8")) as {
    permission: { external_directory: Record<string, string> }
  }
  assert.equal(cfg.permission.external_directory[`${taskDir}/sub/**`], "allow")
  const ledger = one.rail.ledger as ReturnType<typeof fakeLedger>
  assert.equal(ledger.events.at(-1)?.kind, "permission")
  assert.equal(ledger.events.at(-1)?.payload.decision, "allow")
})

test("a secrets-shaped dialog is denied outright and never escalates", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-deny-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "harmless brief", "utf8"))
  const secret = `/Users/tester/.ssh/id_rsa`
  const one = makeRail({ taskDir, term: askFor(secret) })
  assert.equal(one.rail.spawnWorker("w-japan", "opencode", briefPath, taskDir), true)
  one.blocked.add(one.rail.scopedName("w-japan"))
  assert.equal(one.rail.answerPermission("w-japan"), "deny")
  const esc = one.calls.find((c) => c.tool === "herdr" && c.args[1] === "send-keys" && c.args[3] === "esc")
  assert.ok(esc, "esc was sent")
  // a repeat ask for the same secret never escalates (hard-deny)
  assert.equal(one.rail.answerPermission("w-japan"), "deny")
  assert.equal(one.sent(["enter"]).length, 0, "no enter for a hard-deny")
})

test("a gray-zone path is denied, then a repeated ask escalates to allow", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-escalate-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "needs a session shot maybe", "utf8"))
  const gray = `/Users/tester/elsewhere/notes.txt`
  const one = makeRail({
    taskDir,
    term: askFor(gray),
    judge: () => 0, // the tuned judge is sure it is NOT needed
  })
  assert.equal(one.rail.spawnWorker("w-peru", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-peru")
  one.blocked.add(label)
  assert.equal(one.rail.answerPermission("w-peru"), "deny")
  one.blocked.add(label) // the pane blocks again on the same path
  assert.equal(one.rail.answerPermission("w-peru"), "allow")
  const enter = one.calls.filter((c) => c.tool === "herdr" && c.args[1] === "send-keys" && c.args[3] === "enter")
  assert.equal(enter.length, 1, "enter sent exactly once — on the escalation")
})

test(`a deny pattern ends in "capped" at ${PERMISSION_CAP} denies and the caller settles`, async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-cap-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "wandering worker", "utf8"))
  // a hard-deny re-ask loop: same secret every time, never escalates
  const one = makeRail({
    taskDir,
    term: askFor(`/Users/tester/.ssh/id_rsa`),
  })
  assert.equal(one.rail.spawnWorker("w-egypt", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-egypt")
  let last = "none"
  for (let i = 0; i < PERMISSION_CAP; i++) {
    one.blocked.add(label)
    one.calls.length = 0
    last = one.rail.answerPermission("w-egypt")
  }
  assert.equal(last, "capped")
  const ledger = one.rail.ledger as ReturnType<typeof fakeLedger>
  assert.equal(ledger.events.filter((e) => e.kind === "permission").length, PERMISSION_CAP)
})

test("allows never spend the cap — a needed outside-roots path is work, not wandering", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-allow-cap-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(briefPath, "review the shots with vista", "utf8"))
  // the j-5b245e shape: a vista reviewer asking for its session shots —
  // every verdict is allow, past the old cap of 6, and it must live
  const one = makeRail({
    taskDir,
    term: askFor(`/Users/tester/.vista/sessions/abc/views/shot.png`),
    judge: () => 1, // the judge is certain the path is needed (thresholds are always < 1)
  })
  assert.equal(one.rail.spawnWorker("w-spurs", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-spurs")
  let last = "none"
  for (let i = 0; i < PERMISSION_CAP + 4; i++) {
    one.blocked.add(label)
    last = one.rail.answerPermission("w-spurs")
  }
  assert.equal(last, "allow", "ten allows in — still not capped")
})

test("a failing action call logs its rc; a failing read stays quiet", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-rc-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "brief", "utf8"))
  mkdirSync(join(taskDir, "sub"), { recursive: true })
  const logs: string[] = []
  const one = makeRail({
    taskDir,
    term: askFor(`${taskDir}/sub/file.txt`),
    logs,
    failSub: "send-keys",
  })
  assert.equal(one.rail.spawnWorker("w-ghana", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-ghana")
  one.blocked.add(label)
  // send-keys fails (rc=1) — the enter that clears the dialog never
  // lands; the log must say so instead of swallowing the exit code
  assert.equal(one.rail.answerPermission("w-ghana"), "allow")
  assert.ok(logs.some((m) => m.includes("herdr agent send-keys") && m.includes("rc=1")))
})

test("an unblocked pane answers \"none\" and reads no terminal", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-none-"))
  const one = makeRail({ taskDir, term: askFor(`${taskDir}/file.txt`) })
  assert.equal(one.rail.answerPermission("w-nowhere"), "none")
  assert.equal(one.calls.filter((c) => c.tool === "herdr" && c.args[1] === "read").length, 0)
})

test("a verdict note that cannot land queues, then flushes when the pane can take it", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-note-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "brief", "utf8"))
  // promptFails: 1 → the deny note cannot land the first time
  const one = makeRail({
    taskDir,
    term: askFor(`/Users/tester/.kube/config`),
    promptFails: 1,
  })
  assert.equal(one.rail.spawnWorker("w-chile", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-chile")
  one.blocked.add(label)
  assert.equal(one.rail.answerPermission("w-chile"), "deny")
  // the pane is idle now and prompts succeed — flush delivers the note
  one.blocked.delete(label)
  assert.equal(one.rail.flushPendingNotes(), 1)
  const note = one.prompts().at(-1)
  assert.ok(note)
  assert.ok(note.args[3]!.startsWith("[permission] denied:"))
  assert.equal(one.rail.flushPendingNotes(), 0)
})

test("spawnWorker books the pane (shep path) and retire clears it", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-book-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "brief", "utf8"))
  const one = makeRail({ taskDir })
  assert.equal(one.rail.spawnWorker("w-france", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-france")
  assert.ok(one.rail.mine.has(label))
  const ledger = one.rail.ledger as ReturnType<typeof fakeLedger>
  assert.deepEqual(ledger.attached, [label])
  one.rail.retire("w-france")
  assert.equal(one.rail.mine.has(label), false)
  assert.deepEqual(ledger.killed, [label])
  const retire = one.calls.find((c) => c.tool === "shep" && c.args[0] === "retire")
  assert.ok(retire)
})

test("a failed shep spawn is a reject: no pane booked, ghost cleared", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-reject-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "brief", "utf8"))
  const calls: Call[] = []
  const rail = new Rail({
    argvDir: taskDir,
    ledger: fakeLedger() as RailLedger,
    log: () => {},
    shepRunner: (args) => {
      calls.push({ tool: "shep", args })
      return { status: 1, stdout: "" }
    },
    herdrRunner: (args) => {
      calls.push({ tool: "herdr", args })
      return { status: 0, stdout: "" }
    },
  })
  assert.equal(rail.spawnWorker("w-dead", "opencode", briefPath, taskDir), false)
  const label = rail.scopedName("w-dead")
  assert.equal(rail.mine.has(label), false)
  assert.ok(calls.some((c) => c.tool === "shep" && c.args[0] === "retire"), "ghost cleared")
  const ledger = rail.ledger as ReturnType<typeof fakeLedger>
  assert.equal(ledger.events.at(-1)?.kind, "reject")
})

test("writePermissions stages the per-run opencode.json", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-perms-"))
  const rail = new Rail({ argvDir: taskDir, ledger: null, log: () => {} })
  rail.writePermissions()
  assert.equal(existsSync(join(taskDir, "opencode.json")), true)
  const cfg = JSON.parse(readFileSync(join(taskDir, "opencode.json"), "utf8")) as {
    permission: { external_directory: Record<string, string> }
  }
  assert.equal(cfg.permission.external_directory["*"], "ask")
})
