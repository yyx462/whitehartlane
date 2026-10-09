import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-ext-"))

type Handler = (event: never, ctx: never) => unknown
type Command = { description: string; handler: (args: string, ctx: never) => Promise<void> }

class FakePi {
  handlers = new Map<string, Handler[]>()
  commands = new Map<string, Command>()
  sent: { customType: string; content: string }[] = []
  timers: (() => void)[] = []

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return () => {}
  }

  registerCommand(name: string, def: Command) {
    this.commands.set(name, def)
  }

  registerFlag(_name: string, _options: unknown) {}

  sendMessage(message: { customType: string; content: string }) {
    this.sent.push(message)
    return Promise.resolve()
  }

  sendUserMessage(_content: string) {
    return Promise.resolve()
  }
}

async function loadExtension() {
  const mod = await import("../.pi/extensions/front-door.ts")
  const pi = new FakePi()
  mod.default(pi as never)
  return pi
}

function fakeCtx(cwd: string) {
  const id = `ext-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
  return {
    cwd,
    hasUI: false,
    sessionManager: {
      getSessionId: () => id,
      getSessionFile: () => `/tmp/${id}.jsonl`,
    },
  }
}

test.afterEach(() => {
  delete process.env.AGENTIC_OS_PICK
  delete process.env.AGENTIC_OS_ORCHESTRATOR
})

// The chat door is passive (RAILS.md): no stand_up tool, no /standup
// command, no --route flag — standing up is the doors' work.
test("the passive door registers no stand-up surface", async () => {
  const pi = await loadExtension()
  assert.equal((pi as unknown as { tools?: Map<string, unknown> }).tools, undefined)
  assert.equal(pi.commands.has("standup"), false)
  assert.equal(pi.handlers.has("before_agent_start"), false)
})

test("an error turn continues three times, then stops with the message", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("agent_before_settle")![0]!
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
  assert.equal(stop.entries[0]!.content, "Stopped after 3 retries.")
})

test("an error turn that cannot continue is left to settle on its own", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("agent_before_settle")![0]!

  const result = await handler(
    { outcome: "error", context: { canContinue: false } } as never,
    {} as never,
  )

  assert.equal(result, undefined)
})

test("session_start binds the conversation to an OS session and arms the wake poll", async () => {
  const pi = await loadExtension()
  const handler = pi.handlers.get("session_start")![0]!
  const dir = mkdirSync(join(process.env.AGENTIC_OS_HOME!, "bind-cwd"), { recursive: true })
  await handler({} as never, fakeCtx(dir) as never)
  // the second call does not re-arm (one timer per session)
  await handler({} as never, fakeCtx(dir) as never)
  const shutdown = pi.handlers.get("session_shutdown")![0]!
  await shutdown({} as never, {} as never)
})

test("/jobs lists the (empty) OS disk without standing anything up", async () => {
  const pi = await loadExtension()
  const jobs = pi.commands.get("jobs")
  assert.ok(jobs, "/jobs is registered")
  await jobs!.handler("", { cwd: "/tmp", ui: undefined } as never)
  assert.equal(pi.sent.length, 1)
  assert.match(pi.sent[0]!.content, /no Jobs on the OS disk/)
})
