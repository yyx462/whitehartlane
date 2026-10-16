// The agentic-wake plugin on the opencode v2 API. The v1 shape (default
// export = async fn over {client}) does not load on opencode 2.x — it
// sat dormant and every wake fell to parent-pane/fork (the p10-era
// regression). This file pins the v2 contract: default export
// { id, setup(ctx) }, membership via tool.execute.before, delivery via
// ctx.session.prompt, idle reconciles, deleted forgets, cleanup is a
// function. Pure halves stay pinned in wake-spool.test.ts.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import plugin, { digest } from "../plugin/opencode-wake.js"
import { spoolDirOf } from "../src/wake-spool.ts"

const HOME = mkdtempSync(join(tmpdir(), "aos-wake-v2-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(HOME, { recursive: true, force: true }))

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// controllable event streams: each setup() subscribes with its own
// signal; an aborted subscription resolves done so a cleaned-up plugin
// can never swallow an emit meant for a live one.
const subscriptions: Array<{ waiters: Array<(r: any) => void> }> = []
const makeEventCtx = () => ({
  subscribe: ({ signal }: any) => {
    const sub = { waiters: [] as Array<(r: any) => void> }
    subscriptions.push(sub)
    signal?.addEventListener("abort", () => {
      while (sub.waiters.length) sub.waiters.shift()({ value: undefined, done: true })
    }, { once: true })
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise((resolve) => {
          if (signal?.aborted) return resolve({ value: undefined, done: true })
          sub.waiters.push(resolve)
        }),
      }),
    }
  },
})
const emit = (event: any) => {
  for (const sub of [...subscriptions]) sub.waiters.shift()?.({ value: event, done: false })
}

const prompts: Array<{ sessionID: string; text: string }> = []
const hooks: Record<string, (event: any) => any> = {}
const makeCtx = () => {
  prompts.length = 0
  for (const k of Object.keys(hooks)) delete hooks[k]
  return {
    tool: { hook: async (name: string, fn: any) => { hooks[name] = fn; return {} } },
    event: makeEventCtx(),
    session: { prompt: async (input: any) => { prompts.push(input) } },
  }
}

const queue = (sid: string, jid: string, text: string) => {
  const dir = spoolDirOf(sid)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "queue.jsonl"), JSON.stringify({ to: sid, jid, text }) + "\n", { flag: "a" })
  return dir
}

test("v2 shape: default export is { id, setup } — the v1 named export is gone", async () => {
  assert.equal(plugin.id, "agentic-wake", "v2 loads plugins by id from the default export object")
  assert.equal(typeof plugin.setup, "function")
  const ns = await import("../plugin/opencode-wake.js")
  assert.equal((ns as any).AgenticWake, undefined, "the v1 named export must not linger — two shapes, one truth")
})

test("membership via door touch delivers in-band and advances the watermark once", async () => {
  const ctx = makeCtx()
  const cleanup = await plugin.setup(ctx)
  assert.equal(typeof cleanup, "function", "setup returns its cleanup")

  queue("s1", "j-1", "report done")
  const firstLen = readFileSync(join(spoolDirOf("s1"), "queue.jsonl"), "utf8").length
  await hooks["execute.before"]({ tool: "bash", sessionID: "s1", input: { command: "whl jobs" } })
  await settle()

  assert.equal(prompts.length, 1, "the touch turn delivers without waiting for a tick")
  assert.equal(prompts[0].sessionID, "s1")
  assert.match(prompts[0].text, /\[agentic-wake\]/)
  assert.match(prompts[0].text, /j-1: report done/)
  assert.equal(readFileSync(join(spoolDirOf("s1"), ".offset"), "utf8"), String(firstLen), "watermark advances only after prompt accepts")
  assert.ok(existsSync(join(spoolDirOf("s1"), "alive.json")), "membership writes the heartbeat")

  queue("s1", "j-2", "second wake")
  await hooks["execute.before"]({ tool: "bash", sessionID: "s1", input: { command: "whl events" } })
  await settle()
  assert.equal(prompts.length, 2, "only the NEW row delivers — the watermark held")
  assert.match(prompts[1].text, /j-2/)

  cleanup()
  queue("s1", "j-3", "after cleanup")
  await hooks["execute.before"]({ tool: "bash", sessionID: "s1", input: { command: "whl jobs" } })
  await settle()
  assert.equal(prompts.length, 2, "after cleanup nothing delivers — the plugin is inert")
})

test("idle reconciles and deleted forgets — session lifecycle on the v2 event stream", async () => {
  const ctx = makeCtx()
  const cleanup = await plugin.setup(ctx)
  queue("s2", "j-4", "queued mid-turn")
  emit({ type: "session.idle", properties: { sessionID: "s2" } })
  await settle(200)
  assert.equal(prompts.filter((p) => p.sessionID === "s2").length, 0, "idle for a non-member delivers nothing — the touch is the only door")

  await hooks["execute.before"]({ tool: "bash", sessionID: "s2", input: { command: "agentic-os run x --from pi:s2" } })
  await settle()
  assert.equal(prompts.filter((p) => p.sessionID === "s2").length, 1, "the legacy door spelling still touches")

  queue("s2", "j-5", "landed at turn end")
  emit({ type: "session.idle", properties: { sessionID: "s2" } })
  await settle(200)
  assert.equal(prompts.filter((p) => p.sessionID === "s2").length, 2, "idle reconciles a wake queued mid-turn")

  emit({ type: "session.deleted", properties: { sessionID: "s2" } })
  await settle()
  queue("s2", "j-6", "nobody home")
  emit({ type: "session.idle", properties: { sessionID: "s2" } })
  await settle(200)
  assert.equal(prompts.filter((p) => p.sessionID === "s2").length, 2, "deleted forgets membership — no ghost heartbeats")
  cleanup()
})

test("defensive shapes: v1-style nested input still carries the touch", async () => {
  const ctx = makeCtx()
  const cleanup = await plugin.setup(ctx)
  queue("s3", "j-7", "old shape")
  await hooks["execute.before"]({ tool: "bash", input: { args: { command: "whitehartlane fork j-x" }, sessionID: "s3" } })
  await settle()
  assert.equal(prompts.filter((p) => p.sessionID === "s3").length, 1, "the long door name touches; nested sessionID resolves")
  assert.match(prompts.at(-1)!.text, /j-7/)
  assert.equal(digest([{ jid: "j-7", text: "old shape" }]).includes("j-7"), true)
  cleanup()
})
