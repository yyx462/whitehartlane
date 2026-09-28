import assert from "node:assert/strict"
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { copyExample } from "./util.ts"

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
  sent: { customType: string; content: string }[] = []

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return () => {}
  }

  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  sendMessage(message: { customType: string; content: string }) {
    this.sent.push(message)
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
  return { cwd, hasUI: false }
}

test.afterEach(() => {
  delete process.env.AGENTIC_OS_PICK
  delete process.env.AGENTIC_OS_ORCHESTRATOR
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
  assert.equal((await waitFor(marker)).trim(), dir)
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

  assert.match(result.content[0].text, /direct — you are the worker/)
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

  assert.match(result.content[0].text, /direct — you are the worker/)
  assert.match(result.content[0].text, /low confidence — defaulted to direct/)
})

test("fan-out without workflow.toml falls back to direct", async () => {
  const pi = await loadExtension()
  await stubPicker("fan-out 1")
  const dir = await mkdtemp(join(tmpdir(), "ext-nomanifest-"))

  const result = await pi.tools.get("stand_up")!.execute(
    "t1",
    { task: "look up three capitals" },
    undefined,
    undefined,
    fakeCtx(dir),
  )

  assert.match(result.content[0].text, /cannot fan-out: no workflow\.toml/)
  assert.match(result.content[0].text, /do it yourself now/)
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
