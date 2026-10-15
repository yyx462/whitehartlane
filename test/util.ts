import { cpSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Rail, type RailLedger, type RunnerResult } from "../src/rail.ts"
import type { PermissionJudge } from "../src/permission.ts"
import type { JobRecord } from "../src/store.ts"

export const EXAMPLE = join(import.meta.dirname, "..", "examples", "fan-out-spurs", "three-lookups")

export async function copyExample(prefix = "agentic-os-"): Promise<string> {
  return copyExampleNamed("fan-out-spurs/three-lookups", prefix)
}

export async function copyExampleNamed(name: string, prefix = "agentic-os-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cpSync(join(import.meta.dirname, "..", "examples", name), dir, { recursive: true })
  return dir
}

// -- fake rail: engines run against scripted agents, no CLIs --------------
//
// The herdr runner is a state machine: panes get ids, agents get a
// phase (idle | dialog), and the test scripts what each "agent" does
// when prompted. Writes the scripted agents make are delayed a beat so
// the engines' fs.watch wakes see them (a write that lands before the
// watch is armed waits for the 30s backstop — same as production).

export function fakeLedger(): RailLedger & {
  events: { kind: string; payload: Record<string, unknown> }[]
  attached: string[]
  killed: string[]
} {
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
    renew: () => {},
    emit: (kind, payload) => events.push({ kind, payload }),
    attach: (label) => attached.push(label),
    kill: (label) => killed.push(label),
    finish: () => {},
    abort: () => {},
    pause: () => {},
    setSession: () => {},
  }
}

const line = (o: unknown): RunnerResult => ({ status: 0, stdout: JSON.stringify({ result: o ?? {} }) })

export type FakeHerdr = {
  runner: (args: string[]) => RunnerResult
  calls: string[][]
  phase: Record<string, string>
  // panes that refuse prompts even when idle (j-a532f9: the pane the
  // guidance could not reach) — set a scoped label to hold it
  hold: Set<string>
  // the scripted agent brain: (pane name, prompt text) → side effects;
  // use `later(fn)` to make writes the engines' watches can catch
  onPrompt: (name: string, text: string, later: (fn: () => void) => void) => void
  readFor: (name: string) => string
  onKeys: (name: string, key: string) => void
}

export function fakeHerdr(): FakeHerdr {
  const calls: string[][] = []
  const seq = { n: 0 }
  const phase: Record<string, string> = {}
  const hold = new Set<string>()
  const fake: FakeHerdr = {
    calls,
    phase,
    hold,
    onPrompt: () => {},
    readFor: () => "",
    onKeys: () => {},
    runner: (args) => {
      calls.push(args)
      if (args[0] === "pane" && args[1] === "split") {
        seq.n += 1
        return line({ pane: { pane_id: `p-${seq.n}` } })
      }
      if (args[0] === "tab" && args[1] === "create") return line({ root_pane: { pane_id: "p-root" } })
      if (args[0] === "pane" && args[1] === "layout") {
        return line({
          layout: {
            area: { width: 100, height: 100 },
            panes: [
              { pane_id: "p-1", rect: { x: 0, y: 0, width: 50, height: 100 } },
              { pane_id: "p-2", rect: { x: 50, y: 0, width: 50, height: 100 } },
            ],
          },
        })
      }
      if (args[0] === "agent" && args[1] === "start") {
        phase[args[2]!] = "idle"
        return line({})
      }
      if (args[0] === "agent" && args[1] === "get") {
        const ph = phase[args[2]!] ?? "idle"
        if (ph === "dead") return { status: 1, stdout: "" }
        return line({ agent: args[2], agent_status: ph === "dialog" ? "blocked" : ph })
      }
      if (args[0] === "agent" && args[1] === "read") {
        return { status: 0, stdout: fake.readFor(args[2]!) }
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        // reality (j-a532f9): a blocked pane refuses prompts — the
        // rail queues the note for the next unblocked beat. A held
        // pane refuses even idle (the unreachable-guidance race).
        const ph = phase[args[2]!]
        if (ph === "dialog" || hold.has(args[2]!)) return { status: 1, stdout: "" }
        fake.onPrompt(args[2]!, args[3] ?? "", (fn) => setTimeout(fn, 50).unref?.())
        return line({})
      }
      if (args[0] === "agent" && args[1] === "send-keys") {
        fake.onKeys(args[2]!, args[3]!)
        return line({})
      }
      return { status: 0, stdout: "" }
    },
  }
  return fake
}

export function fakeRail(
  taskDir: string,
  herdr: FakeHerdr,
  ledger: RailLedger | null,
  railOpts: { judge?: PermissionJudge; home?: string; log?: (msg: string) => void } = {},
): Rail {
  return new Rail({
    argvDir: taskDir,
    ledger,
    judge: railOpts.judge,
    home: railOpts.home,
    log: railOpts.log ?? (() => {}),
    shepRunner: () => ({ status: 0, stdout: "" }),
    herdrRunner: herdr.runner,
  })
}
