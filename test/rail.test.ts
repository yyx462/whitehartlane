import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { PERMISSION_CAP } from "../src/core/permission.ts"
import { Rail, type RailLedger, type RunnerResult } from "../src/adapters/rail.ts"
import type { JobRecord } from "../src/adapters/store.ts"

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
  term?: string | (() => string)
  home?: string
  promptFails?: number
  judge?: (input: { path: string; ask: string; context?: string }) => number
  logs?: string[]
  failSub?: string
  herdrRunner?: (args: string[]) => RunnerResult
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
      return { status: 0, stdout: typeof opts.term === "function" ? opts.term() : (opts.term ?? "") }
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
    home: opts.home,
    log: opts.logs ? (msg) => opts.logs!.push(msg) : () => {},
    shepRunner,
    herdrRunner: opts.herdrRunner ?? herdrRunner,
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

test("the sweep answers every blocked pane the rail holds — one tick, unscoped names out (zen 6, rail-owned)", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-sweep-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "do the thing", "utf8"))
  mkdirSync(join(taskDir, "sub"), { recursive: true })
  const one = makeRail({ taskDir, term: askFor(`${taskDir}/sub/file.txt`) })
  assert.equal(one.rail.spawnWorker("w-france", "opencode", briefPath, taskDir), true)
  assert.equal(one.rail.spawnWorker("w-japan", "opencode", briefPath, taskDir), true)
  one.blocked.add(one.rail.scopedName("w-france"))
  one.blocked.add(one.rail.scopedName("w-japan"))
  const { answered, capped } = one.rail.tickPrivilege()
  assert.deepEqual([...answered].sort(), ["w-france", "w-japan"])
  assert.equal(capped.size, 0)
  const ledger = one.rail.ledger as ReturnType<typeof fakeLedger>
  assert.equal(ledger.events.filter((e) => e.kind === "permission").length, 2)
})

test("a capped worker is reported to the engine, not retired by the sweep", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-sweep-cap-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "wandering worker", "utf8"))
  // a hard-deny re-ask loop: same secret every time, never escalates
  const one = makeRail({ taskDir, term: askFor(`/Users/tester/.ssh/id_rsa`) })
  assert.equal(one.rail.spawnWorker("w-peru", "opencode", briefPath, taskDir), true)
  one.blocked.add(one.rail.scopedName("w-peru"))
  let last: { answered: Set<string>; capped: Set<string> } | null = null
  for (let i = 0; i < PERMISSION_CAP; i++) last = one.rail.tickPrivilege()
  assert.ok(last)
  assert.deepEqual([...last.capped], ["w-peru"])
  // the engine owns a capped worker's death — the sweep never retires it
  const retired = one.calls.filter((c) => c.tool === "shep" && c.args[0] === "retire")
  assert.equal(retired.length, 0)
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

test(`a deny pattern ends in "capped" at ${PERMISSION_CAP} denies and the caller finished_by`, async () => {
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

test("mixed path forms of one ask share a ladder (j-2b508e)", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-forms-"))
  const home = await mkdtemp(join(tmpdir(), "rail-home-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(briefPath, "work in the g0-shared worktree; never touch master/", "utf8"))
  const full = join(home, "projects", "acme", "whl", "marketplace-port", "units")
  mkdirSync(full, { recursive: true })
  let form = 0
  const one = makeRail({
    taskDir,
    home,
    // ask #1 renders the full path, ask #2 the home-stripped form —
    // the same directory in two renderings, exactly as the terminal
    // wobbled in j-2b508e
    term: () =>
      `Permission required\n\nthe agent wants to read ${
        ++form === 1 ? `${full}/` : "/projects/acme/whl/marketplace-port/units/"
      }`,
    judge: () => 0,
  })
  assert.equal(one.rail.spawnWorker("w-g0", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-g0")
  one.blocked.add(label)
  assert.equal(one.rail.answerPermission("w-g0"), "deny", "the judge reads the brief: master/ is not needed")
  one.blocked.add(label) // the pane blocks again — same ask, stripped form
  assert.equal(one.rail.answerPermission("w-g0"), "allow", "the second form escalates on the first's ladder")
  const enter = one.calls.filter((c) => c.tool === "herdr" && c.args[1] === "send-keys" && c.args[3] === "enter")
  assert.equal(enter.length, 1, "enter sent exactly once — on the escalation")
  const ledger = one.rail.ledger as ReturnType<typeof fakeLedger>
  assert.equal(ledger.events.filter((e) => e.kind === "permission").at(-1)?.payload.path, full)
})

test("a top-level temp allow grants the temp root itself, never the whole disk (j-b6067c)", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-top-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "style the page", "utf8"))
  const one = makeRail({ taskDir, term: askFor("/tmp") })
  assert.equal(one.rail.spawnWorker("w-styler", "opencode", briefPath, taskDir), true)
  const label = one.rail.scopedName("w-styler")
  one.blocked.add(label)
  assert.equal(one.rail.answerPermission("w-styler"), "allow", "temp scratch is no boundary")
  const enter = one.calls.find((c) => c.tool === "herdr" && c.args[1] === "send-keys" && c.args[3] === "enter")
  assert.ok(enter, "enter was sent")
  // durable for the next session: /tmp itself, both spellings — and
  // never "/" or "" (one /tmp allow must not whitelist the disk)
  const cfg = JSON.parse(readFileSync(join(taskDir, "opencode.json"), "utf8")) as {
    permission: { external_directory: Record<string, string> }
  }
  const ext = cfg.permission.external_directory
  assert.equal(ext["/tmp/**"], "allow")
  assert.ok(!("/​**" in ext), "the whole disk is never granted")
  assert.ok(!("" in ext), "no degenerate empty root lands in the config")
})

test("retireAll closes the fleet tab it opened (close what we opened)", () => {
  const calls: { tool: string; args: string[] }[] = []
  const herdrRunner = (args: string[]): RunnerResult => {
    calls.push({ tool: "herdr", args })
    const a = args.join(" ")
    if (args[0] === "tab" && args[1] === "create") {
      return {
        status: 0,
        stdout: JSON.stringify({ result: { root_pane: { pane_id: "wX:root" }, tab: { tab_id: "wX:t9" } } }),
      }
    }
    if (args[0] === "pane" && args[1] === "split") return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "wX:s1" } } }) }
    return { status: 0, stdout: "" }
  }
  const rail = new Rail({
    argvDir: mkdtempSync(join(tmpdir(), "rail-fleet-")),
    ledger: null,
    log: () => {},
    shepRunner: () => ({ status: 0, stdout: "" }) as RunnerResult,
    herdrRunner,
  })
  rail.setLayout({ tab: "new", orchestrator: "left" }, "/tmp/sess/jobs/j-fleet1/run")
  const labelCall = calls.find((c) => c.args[0] === "tab" && c.args[1] === "create")
  assert.ok(labelCall, "tab created")
  assert.match(labelCall!.args[3], /fan-out-j-fleet1/, "label carries the job id, not 'run'")
  rail.retireAll()
  const close = calls.find((c) => c.args[0] === "tab" && c.args[1] === "close" && c.args[2] === "wX:t9")
  assert.ok(close, "fleet tab closed at retireAll")
  // idempotent: a second retireAll does not close again
  calls.length = 0
  rail.retireAll()
  assert.ok(!calls.some((c) => c.args[0] === "tab" && c.args[1] === "close"), "close once")
})

test("the fleet tab opens beside its levy — the spawner pane names the workspace (j-5701b2)", () => {
  const mk = (spawnerPane: string | undefined) => {
    const calls: { tool: string; args: string[] }[] = []
    const herdrRunner = (args: string[]): RunnerResult => {
      calls.push({ tool: "herdr", args })
      if (args[0] === "tab" && args[1] === "create") {
        return { status: 0, stdout: JSON.stringify({ result: { root_pane: { pane_id: "wX:root" }, tab: { tab_id: "wX:t9" } } }) }
      }
      if (args[0] === "pane" && args[1] === "split") return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "wX:s1" } } }) }
      return { status: 0, stdout: "" }
    }
    const ledger = fakeLedger()
    if (spawnerPane) ledger.job.spawner = { tool: "opencode", session_id: "ses_levy", since: new Date().toISOString(), pane: spawnerPane }
    const rail = new Rail({
      argvDir: mkdtempSync(join(tmpdir(), "rail-fleet-")),
      ledger,
      log: () => {},
      shepRunner: () => ({ status: 0, stdout: "" }) as RunnerResult,
      herdrRunner,
    })
    return { rail, calls }
  }

  // levy pane booked → the tab is scoped to ITS workspace, not herdr's current one
  const beside = mk("wK:pGT")
  beside.rail.setLayout({ tab: "new", orchestrator: "left" }, "/tmp/sess/jobs/j-beside/run")
  const scoped = beside.calls.find((c) => c.args[0] === "tab" && c.args[1] === "create")!
  assert.deepEqual(scoped.args.slice(-2), ["--workspace", "wK"], "tab created in the levy's workspace")

  // no spawner pane (rail spawner / --unattended) → unscoped, the old behavior
  const orphan = mk(undefined)
  orphan.rail.setLayout({ tab: "new", orchestrator: "left" }, "/tmp/sess/jobs/j-orphan/run")
  const unscoped = orphan.calls.find((c) => c.args[0] === "tab" && c.args[1] === "create")!
  assert.ok(!unscoped.args.includes("--workspace"), "no spawner pane — no workspace pin")

  // a stale workspace id must not cost the layout: scoped fails → retried unscoped
  const staleCalls: { tool: string; args: string[] }[] = []
  let createCount = 0
  const staleRail = new Rail({
    argvDir: mkdtempSync(join(tmpdir(), "rail-fleet-")),
    ledger: (() => { const l = fakeLedger(); l.job.spawner = { tool: "opencode", session_id: "ses_levy", since: new Date().toISOString(), pane: "wZ:p1" }; return l })(),
    log: () => {},
    shepRunner: () => ({ status: 0, stdout: "" }) as RunnerResult,
    herdrRunner: (args: string[]): RunnerResult => {
      staleCalls.push({ tool: "herdr", args })
      if (args[0] === "tab" && args[1] === "create") {
        createCount += 1
        if (createCount === 1) return { status: 1, stdout: "" } // the scoped create bounces
        return { status: 0, stdout: JSON.stringify({ result: { root_pane: { pane_id: "wX:root" }, tab: { tab_id: "wX:t9" } } }) }
      }
      if (args[0] === "pane" && args[1] === "split") return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "wX:s1" } } }) }
      return { status: 0, stdout: "" }
    },
  })
  staleRail.setLayout({ tab: "new", orchestrator: "left" }, "/tmp/sess/jobs/j-stale/run")
  const creates = staleCalls.filter((c) => c.args[0] === "tab" && c.args[1] === "create")
  assert.equal(creates.length, 2, "scoped create failed once, retried")
  assert.ok(creates[1] && !creates[1].args.includes("--workspace"), "the retry is unscoped")
})

test("a fatal engine closes the fleet tab on the way down (j-5701b2)", async () => {
  const calls: { tool: string; args: string[] }[] = []
  const herdrRunner = (args: string[]): RunnerResult => {
    calls.push({ tool: "herdr", args })
    if (args[0] === "tab" && args[1] === "create") {
      return { status: 0, stdout: JSON.stringify({ result: { root_pane: { pane_id: "wX:root" }, tab: { tab_id: "wX:t9" } } }) }
    }
    if (args[0] === "pane" && args[1] === "split") return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "wX:s1" } } }) }
    return { status: 0, stdout: "" }
  }
  const rail = new Rail({
    argvDir: mkdtempSync(join(tmpdir(), "rail-fleet-")),
    ledger: null,
    log: () => {},
    shepRunner: () => ({ status: 0, stdout: "" }) as RunnerResult,
    herdrRunner,
  })
  rail.setLayout({ tab: "new", orchestrator: "left" }, "/tmp/sess/jobs/j-fatal/run")
  const rc = await rail.run(() => {
    throw new Error("spawnSync /bin/sh ETIMEDOUT")
  })
  assert.equal(rc, 1, "the fatal still exits 1")
  const close = calls.find((c) => c.args[0] === "tab" && c.args[1] === "close" && c.args[2] === "wX:t9")
  assert.ok(close, "close what we opened — even on a fatal")
})

test("C03 regression: the fleet layout pre-splits nothing — no pane is born before a worker needs it", () => {
  const mk = () => {
    const calls: { tool: string; args: string[] }[] = []
    const herdrRunner = (args: string[]): RunnerResult => {
      calls.push({ tool: "herdr", args })
      if (args[0] === "tab" && args[1] === "create") {
        return { status: 0, stdout: JSON.stringify({ result: { root_pane: { pane_id: "wX:root" }, tab: { tab_id: "wX:t9" } } }) }
      }
      if (args[0] === "pane" && args[1] === "split") return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "wX:s1" } } }) }
      return { status: 0, stdout: "" }
    }
    const ledger = fakeLedger()
    ledger.job.spawner = { tool: "opencode", session_id: "ses_levy", since: new Date().toISOString(), pane: "wK:pGT" }
    const rail = new Rail({
      argvDir: mkdtempSync(join(tmpdir(), "rail-c03-")),
      ledger,
      log: () => {},
      shepRunner: () => ({ status: 0, stdout: "" }) as RunnerResult,
      herdrRunner,
    })
    return { rail, calls }
  }
  const one = mk()
  one.rail.setLayout({ tab: "new", orchestrator: "left" }, "/tmp/sess/jobs/j-c03/run")
  const splits = one.calls.filter((c) => c.args[0] === "pane" && c.args[1] === "split")
  assert.equal(splits.length, 0, "v2 layout anchors the column on the tab root — the never-populated viewer lane must not return")
  assert.ok(one.calls.some((c) => c.args[0] === "tab" && c.args[1] === "create"), "the fleet tab itself opens")
})

test("an empty live-anchor list re-seeds the column from the fleet tab itself (#165, j-214576)", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "rail-reseed-"))
  const briefPath = join(taskDir, "brief.md")
  await import("node:fs/promises").then((fs) => fs.writeFile(briefPath, "do the thing", "utf8"))
  const calls: { tool: string; args: string[] }[] = []
  let splits = 0
  const herdrRunner = (args: string[]): RunnerResult => {
    calls.push({ tool: "herdr", args })
    if (args[0] === "tab" && args[1] === "create")
      return { status: 0, stdout: JSON.stringify({ result: { root_pane: { pane_id: "wX:root" }, tab: { tab_id: "wX:t9" } } }) }
    if (args[0] === "pane" && args[1] === "split") {
      splits++
      return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: splits === 1 ? "wX:w1" : "wX:w2" } } }) }
    }
    if (args[0] === "pane" && args[1] === "list")
      return {
        status: 0,
        stdout: JSON.stringify({ result: { panes: [
          { pane_id: "wK:stranger", tab_id: "wK:t1" }, // another tab's pane — must be skipped
          { pane_id: "wX:stray", tab_id: "wX:t9" },    // ours, alive
        ] } }),
      }
    return { status: 0, stdout: "" }
  }
  const one = makeRail({ taskDir, herdrRunner })
  one.rail.setLayout({ tab: "new", orchestrator: "left" }, join(taskDir, "run"))
  // stage 1's worker: born from the root (which closes) — the only live pane
  assert.equal(one.rail.spawnWorker("alpha", "opencode", briefPath, taskDir), true)
  // between stages the worker settles and is retired — live-anchor list empties
  one.rail.retire("alpha")
  // stage 2's worker must STILL be born: the column re-seeds inside our own tab
  assert.equal(one.rail.spawnWorker("beta", "opencode", briefPath, taskDir), true)
  assert.ok(calls.some((c) => c.tool === "herdr" && c.args[0] === "pane" && c.args[1] === "list"), "pane list consulted on empty anchors")
  const seedSplit = calls.filter((c) => c.tool === "herdr" && c.args[0] === "pane" && c.args[1] === "split").at(-1)!
  assert.ok(seedSplit.args.includes("wX:stray"), "re-seeded from a live pane in OUR fleet tab, not a stranger's")
})
