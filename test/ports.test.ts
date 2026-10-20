import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the seam proofs: a Transport fake and an AgentHost fake are SECOND
// adapters — the receipt that the seams are real, not hypothetical
// ("one adapter means a hypothetical seam; two adapters means a real
// one"). No CLI runs; no OS disk is touched.
import { HerdrTransport } from "../src/adapters/herdr-transport.ts"
import { OpenCodeHost, parseAgentStatus } from "../src/adapters/opencode-host.ts"
import { Rail } from "../src/adapters/rail.ts"
import type { AgentHost, AgentStatus, HostInhabitSpec } from "../src/ports/agent-host.ts"
import type { CmdResult, Transport } from "../src/ports/transport.ts"

type Script = (args: string[]) => CmdResult | undefined

function fakeTransport(script: Script = () => undefined): Transport & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    exec: (...args: string[]) => {
      calls.push(args)
      return script(args) ?? { status: 0, stdout: "", stderr: "" }
    },
    splitPane: () => null,
    closePane: () => {},
    renamePane: () => {},
    layoutOf: () => null,
    tabCreate: () => ({ root: null, tab: null, status: 0 }),
    closeTab: () => {},
  }
}

function fakeHost(status: AgentStatus = "unknown"): AgentHost & { inhabited: HostInhabitSpec[]; prompts: string[] } {
  const inhabited: HostInhabitSpec[] = []
  const prompts: string[] = []
  return {
    inhabited,
    prompts,
    inhabit: (label, pane, spec) => {
      inhabited.push(spec)
      return true
    },
    prompt: (label, text) => {
      prompts.push(text)
      return { status: 0, stdout: "", stderr: "" }
    },
    status: () => status,
  }
}

// -- the grammar: ONE parser, four inputs --------------------------------

test("parseAgentStatus: the agent_status grammar — done folds to idle, garbage is unknown", () => {
  assert.equal(parseAgentStatus(`{"agent_status":"working"}`), "working")
  assert.equal(parseAgentStatus(`{"agent_status":"blocked"}`), "blocked")
  assert.equal(parseAgentStatus(`{"agent_status":"idle"}`), "idle")
  assert.equal(parseAgentStatus(`{"agent_status":"done"}`), "idle", "a finished turn reads as idle")
  assert.equal(parseAgentStatus(""), "unknown")
  assert.equal(parseAgentStatus("no title set — a plain shell"), "unknown")
})

// -- the host rides ANY transport ----------------------------------------

test("OpenCodeHost.inhabit: model pin + start retry + brief delivery through a fake transport", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-ports-"))
  writeFileSync(join(dir, "brief.md"), "do the thing\n")
  const t = fakeTransport((args) =>
    args[0] === "agent" && args[1] === "start" && args.filter((a) => a === "start").length === 1 && t.calls.length === 1
      ? { status: 1, stdout: "", stderr: "brownout" } // first knock refused
      : undefined,
  )
  const host = new OpenCodeHost(t, () => {})
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "3"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "1"
  try {
    const ok = host.inhabit("w-demo", "p-1", { kind: "opencode", briefPath: join(dir, "brief.md"), cwd: dir, model: "zhipuai/glm-5.3", hold: false })
    assert.equal(ok, true, "the second knock lands — brownout is not death")
    const starts = t.calls.filter((a) => a[1] === "start")
    assert.equal(starts.length, 2, "exactly one retry")
    const pin = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")) as { model?: string }
    assert.ok(String(pin.model).includes("glm-5.3"), "the model pin rode the sandbox settings (j-37bdc0)")
    const prompts = t.calls.filter((a) => a[1] === "prompt")
    assert.equal(prompts.length, 1, "the brief was delivered once")
  } finally {
    delete process.env.AGENTIC_OS_BIRTH_JITTER_MS
    delete process.env.AGENTIC_OS_START_TRIES
    delete process.env.AGENTIC_OS_START_BACKOFF_MS
  }
})

// -- the transport parses ITS OWN formats --------------------------------

test("HerdrTransport.splitPane picks the pane id out of herdr's JSON", () => {
  const t = new HerdrTransport(
    () => ({ status: 0, stdout: `{"result":{"pane":{"pane_id":"wK:p42"}}}`, stderr: "" }),
    () => {},
  )
  assert.equal(t.splitPane("wK:p1", "down", "/tmp", 0.5), "wK:p42")
})

// -- the plugin slots: Rail takes either adapter by constructor -------

test("Rail's plugin slots: an injected host answers workerStatus; an injected transport takes the exec", () => {
  const host = fakeHost("idle")
  const t = fakeTransport()
  const rail = new Rail({ transport: t, host, ledger: null, log: () => {} })
  assert.equal(rail.workerStatus("demo"), "idle", "the status question went to the injected host")
  rail.promptAgent("demo", "hello")
  assert.deepEqual(host.prompts, ["hello"], "the prompt went through the host, not herdr")
})
