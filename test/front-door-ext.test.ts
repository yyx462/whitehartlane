import assert from "node:assert/strict"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { copyExample } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-ext-"))

async function waitFor(path: string, ms = 3000): Promise<string> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(path)) return readFileSync(path, "utf8")
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${path}`)
}

type Handler = (event: never, ctx: never) => unknown
type Tool = {
  name: string
  execute: (
    id: string,
    params: { task: string },
    signal: unknown,
    onUpdate: unknown,
    ctx: { cwd: string; hasUI: boolean },
  ) => Promise<{ content: { type: string; text: string }[]; details: unknown }>
}

class FakePi {
  handlers = new Map<string, Handler[]>()
  tools = new Map<string, Tool>()
  commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>()
  sent: { customType: string; content: string }[] = []
  sentUser: string[] = []
  flags = new Map<string, boolean | string>()

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return () => {}
  }

  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  registerCommand(name: string, def: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) {
    this.commands.set(name, def)
  }

  registerFlag(name: string, _options: unknown) {
    // value is set directly on this.flags by tests
  }

  getFlag(name: string) {
    return this.flags.get(name)
  }

  sendMessage(message: { customType: string; content: string }) {
    this.sent.push(message)
    return Promise.resolve()
  }

  sendUserMessage(content: string) {
    this.sentUser.push(content)
    return Promise.resolve()
  }
}

async function loadExtension() {
  const mod = await import("../.pi/extensions/front-door.ts")
  const pi = new FakePi()
  mod.default(pi as never)
  return pi
}

async function stubPicker(output: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pick-"))
  const path = join(dir, "pick")
  writeFileSync(path, `#!/usr/bin/env bash\nprintf '%s\\n' '${output}'\n`)
  chmodSync(path, 0o755)
  process.env.AGENTIC_OS_PICK = path
  return dir
}

async function stubOrchestrator(): Promise<{ marker: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "orch-"))
  const marker = join(dir, "spawned.txt")
  const path = join(dir, "orchestrator")
  writeFileSync(
    path,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$1" > '${marker}'\n`,
  )
  chmodSync(path, 0o755)
  process.env.AGENTIC_OS_ORCHESTRATOR = path
  return { marker, dir }
}

function fakeCtx(cwd: string) {
  return {
    cwd,
    hasUI: false,
    sessionManager: {
      getSessionId: () => "ext-test-pi-session",
      getSessionFile: () => "/tmp/ext-test-session.jsonl",
    },
  }
}

test.afterEach(() => {
  delete process.env.AGENTIC_OS_PICK
  delete process.env.AGENTIC_OS_ORCHESTRATOR
  delete process.env.AGENTIC_OS_GLOBAL
  delete process.env.AGENTIC_OS_WORKFLOW
})

test("the extension registers the stand_up tool", async () => {
  const pi = await loadExtension()
  assert.ok(pi.tools.has("stand_up"))
})

test("a high-confidence fan-out pick stands the orchestrator up", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  const { marker } = await stubOrchestrator()
  const dir = await copyExample("ext-fanout-")

  const result = await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "look up three capitals" },
    undefined,
    undefined,
    fakeCtx(dir),
  )

  assert.match(result.content[0].text, /stood up: fan-out — 3 units \(france, japan, peru\)/)
  assert.match(result.content[0].text, /report will arrive in this chat/)
  const runDir = (await waitFor(marker)).trim()
  assert.match(runDir, /\/sessions\/s-[^/]+\/jobs\/j-[^/]+\/run$/)
  assert.ok(existsSync(join(runDir, "workflow.toml")), "manifest snapshot materialized")
  assert.ok(existsSync(join(runDir, "hooks", "units.sh")), "hooks copied alongside")
})

test("a direct pick makes the chat the worker", async () => {
  const pi = await loadExtension()
  await stubPicker("direct 1")
  const dir = await mkdtemp(join(tmpdir(), "ext-direct-"))

  const result = await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "rename the helper" },
    undefined,
    undefined,
    fakeCtx(dir),
  )

  assert.match(result.content[0].text, /direct — this chat is the worker/)
  assert.match(result.content[0].text, /Do the task now, normally/)
})

test("a low-confidence pick without UI defaults to direct and says so", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 0.5")
  const dir = await copyExample("ext-lowconf-")

  const result = await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "ambiguous task" },
    undefined,
    undefined,
    fakeCtx(dir),
  )

  assert.match(result.content[0].text, /direct — this chat is the worker/)
  assert.match(result.content[0].text, /low confidence — defaulted to direct/)
})

test("fan-out with no manifest anywhere falls back to direct", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  process.env.AGENTIC_OS_GLOBAL = "0"
  const dir = await mkdtemp(join(tmpdir(), "ext-nomanifest-"))

  const result = await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "look up three capitals" },
    undefined,
    undefined,
    fakeCtx(dir),
  )

  assert.match(result.content[0].text, /cannot fan-out: no workflow\.toml/)
  assert.match(result.content[0].text, /runs direct/)
})

test("fan-out without a local manifest stands up ad-hoc from the global default", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  const { marker } = await stubOrchestrator()
  const dir = await mkdtemp(join(tmpdir(), "ext-adhoc-"))

  const result = await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "compare three web frameworks" },
    undefined,
    undefined,
    fakeCtx(dir),
  )

  assert.match(result.content[0].text, /stood up: fan-out \(ad-hoc\)/)
  assert.match(result.content[0].text, /planner will decompose the task/)
  const runDir = (await waitFor(marker)).trim()
  assert.match(runDir, /\/sessions\/s-[^/]+\/jobs\/j-[^/]+\/run$/)
  assert.ok(!runDir.includes(".agentic-os"), "no runs materialize in the cwd anymore")
  assert.equal(readFileSync(join(runDir, "task.txt"), "utf8").trim(), "compare three web frameworks")
  const manifest = readFileSync(join(runDir, "workflow.toml"), "utf8")
  assert.match(manifest, /units = "bash .*\/run\/hooks\/units\.sh"/)
  assert.match(manifest, /name = "ad-hoc"/)
  assert.ok(existsSync(join(runDir, "hooks", "units.sh")), "builtin hooks copied into the run")
})

test("/standup routes fan-out with no model in the loop", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  const { marker } = await stubOrchestrator()
  const dir = await copyExample("ext-cmd-")

  await pi.commands.get("standup")!.handler("look up three capitals", fakeCtx(dir))

  const cmdDir = (await waitFor(marker)).trim()
  assert.match(cmdDir, /\/sessions\/s-[^/]+\/jobs\/j-[^/]+\/run$/)
  const message = pi.sent.find((m) => m.customType === "agentic-os-route")
  assert.ok(message)
  assert.match(message!.content, /stood up: fan-out — 3 units/)
})

test("/standup direct warns and then submits the task itself", async () => {
  const pi = await loadExtension()
  await stubPicker("direct 1")
  const dir = await mkdtemp(join(tmpdir(), "ext-cmd-direct-"))

  await pi.commands.get("standup")!.handler("rename the helper", fakeCtx(dir))

  const message = pi.sent.find((m) => m.customType === "agentic-os-route")
  assert.ok(message)
  assert.match(message!.content, /this chat is the worker/)
  assert.match(message!.content, /Submitting it as a direct message now/)
  assert.deepEqual(pi.sentUser, ["rename the helper"])
})

test("/standup fan-out with no manifest anywhere falls back to submitting direct", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  process.env.AGENTIC_OS_GLOBAL = "0"
  const dir = await mkdtemp(join(tmpdir(), "ext-cmd-fallback-"))

  await pi.commands.get("standup")!.handler("look up three capitals", fakeCtx(dir))

  const message = pi.sent.find((m) => m.customType === "agentic-os-route")
  assert.ok(message)
  assert.match(message!.content, /cannot fan-out: no workflow\.toml/)
  assert.match(message!.content, /Submitting it as a direct message now/)
  assert.deepEqual(pi.sentUser, ["look up three capitals"])
})

test("/standup with no task sends nothing", async () => {
  const pi = await loadExtension()
  await pi.commands.get("standup")!.handler("", fakeCtx("/tmp"))
  assert.deepEqual(pi.sent, [])
})

test("the front-door guideline is pushed once, not once per turn", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("before_agent_start")![0]
  const options = { promptGuidelines: [] as string[] }

  await handler({ prompt: "one", systemPromptOptions: options } as never, {} as never)
  await handler({ prompt: "two", systemPromptOptions: options } as never, {} as never)

  const pushed = options.promptGuidelines.filter((g) => g.includes("front door of agentic-os"))
  assert.equal(pushed.length, 1)
})

test("an unrouted prompt gets the routing order prepended until stand_up runs", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("before_agent_start")![0]
  await stubPicker("direct 1") // no orchestrator may be stood up by this test

  const event1 = { prompt: "look up capitals", systemPromptOptions: { promptGuidelines: [] } }
  await handler(event1 as never, {} as never)

  await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "look up capitals" },
    undefined,
    undefined,
    fakeCtx("/tmp"),
  )

  const event2 = { prompt: "another task", systemPromptOptions: { promptGuidelines: [] } }
  await handler(event2 as never, {} as never)
  assert.equal(event2.prompt, "another task")
})

test("--route routes the prompt itself and suppresses the turn on fan-out", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  const { marker } = await stubOrchestrator()
  const dir = await copyExample("ext-flag-route-")
  pi.flags.set("route", true)

  const handler = pi.handlers.get("before_agent_start")![0]
  const result = (await handler(
    { prompt: "look up the capitals", systemPromptOptions: { promptGuidelines: [] } },
    fakeCtx(dir),
  )) as { systemPrompt?: string } | undefined

  assert.ok(result?.systemPrompt)
  assert.match(result!.systemPrompt!, /Reply with exactly the text/)
  assert.match(result!.systemPrompt!, /stood up: fan-out/)
  const runDir = (await waitFor(marker)).trim()
  assert.match(runDir, /\/sessions\/s-[^/]+\/jobs\/j-[^/]+\/run$/)
  assert.ok(pi.sent.some((m) => m.customType === "agentic-os-route"))
})

test("--route lets a direct pick run as the worker", async () => {
  const pi = await loadExtension()
  await stubPicker("direct 1")
  pi.flags.set("route", true)

  const handler = pi.handlers.get("before_agent_start")![0]
  const result = await handler(
    { prompt: "rename the helper", systemPromptOptions: { promptGuidelines: [] } },
    fakeCtx("/tmp"),
  )

  assert.equal(result, undefined)
})

test("an error turn continues three times, then stops with the message", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("agent_before_settle")![0]
  const results: { continue?: boolean; entries?: unknown[] }[] = []

  for (let i = 0; i < 4; i++) {
    results.push(
      (await handler(
        { outcome: "error", context: { canContinue: true } } as never,
        {} as never,
      )) as { continue?: boolean; entries?: unknown[] },
    )
  }

  assert.deepEqual(results[0], { continue: true })
  assert.deepEqual(results[1], { continue: true })
  assert.deepEqual(results[2], { continue: true })
  const stop = results[3] as { entries: { content: string }[]; continue: boolean }
  assert.equal(stop.continue, false)
  assert.equal(stop.entries[0].content, "Stopped after 3 retries.")
})

test("an error turn that cannot continue is left to settle on its own", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("agent_before_settle")![0]

  const result = await handler(
    { outcome: "error", context: { canContinue: false } } as never,
    {} as never,
  )

  assert.equal(result, undefined)
})
