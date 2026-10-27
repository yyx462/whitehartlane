// adapters/opencode-host.ts — today's AgentHost: the agent CLIs that
// occupy herdr panes (opencode primary, pi branch).
//
// The HOST vocabulary, all in one place: the model pin (each CLI's own
// settings file — the flag that crashes one TUI rides the other), the
// start sequence behind the brownout guard (stagger + retry), the
// brief delivery, and the agent_status grammar parser (ONE parser —
// the liveness consolidation's single verb feeds from here).
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { backoffBase, backoffMs, drawJitter, jitterBound, retries, sleepSync } from "./backoff.ts"
import { modelIn, splitModel, writeOpencodeModel, writeOpencodeModelSettings, writePiSettings } from "./store.ts"
import { opencodeUsageOf } from "./transcripts.ts"
import type { UsageRow } from "../ports/agent-host.ts"
import type { AgentHost, AgentStatus, HostInhabitSpec } from "../ports/agent-host.ts"
import type { CmdResult, Transport } from "../ports/transport.ts"

const START_TIMEOUT_MS = 60_000

// the run-root sandbox opencode.json (writeWorkerPermissions seeds it,
// including its resolved model pin) — discovered the same way opencode
// discovers project config: walk up from cwd
function sandboxModelOf(cwd: string): string | undefined {
  let d = cwd
  for (let i = 0; i < 4; i++) {
    const probe = join(d, "opencode.json")
    if (existsSync(probe)) {
      try {
        const m = JSON.parse(readFileSync(probe, "utf8")).model
        return typeof m === "string" ? m : undefined
      } catch {
        return undefined
      }
    }
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return undefined
}

export class OpenCodeHost implements AgentHost {
  private readonly transport: Transport
  private readonly log: (msg: string) => void

  constructor(transport: Transport, log: (msg: string) => void = () => {}) {
    this.transport = transport
    this.log = log
  }

  inhabit(label: string, pane: string, spec: HostInhabitSpec): boolean {
    // the brownout guard's first half (ADR 0010): births stagger — a
    // random pause before the pane is touched, so a batch of spurs
    // asking for panes in the same second arrives as a queue instead
    // of a stampede (the 2026-10-12 09:51 storm).
    const staggerBound = jitterBound("AGENTIC_OS_BIRTH_JITTER_MS", 1_500)
    const stagger = drawJitter(staggerBound)
    if (stagger > 0) {
      this.log(`birth stagger: ${label} waits ${stagger}ms (bound ${staggerBound}ms)`)
      sleepSync(stagger)
    }
    const tail: string[] = []
    if (spec.model && spec.kind === "pi") {
      writePiSettings(spec.cwd, spec.model)
      const { provider, id } = splitModel(spec.model)
      tail.push("--approve", "--provider", provider, "--model", id)
      if (spec.temperature !== undefined) {
        this.log(`temperature ${spec.temperature} requested for ${label} — pi settings carry no temperature key today; the pin rides opencode only`)
      }
    } else if (spec.kind === "opencode") {
      // the root command dropped --model in the 2026-10 upgrade — a
      // passed flag crashes the TUI at birth (j-37bdc0: three start
      // timeouts, run dead). The pin rides the sandbox opencode.json
      // instead, symmetric with pi's settings write above.
      if (spec.model) writeOpencodeModel(spec.cwd, spec.model)
      if (spec.temperature !== undefined) {
        // a model-LESS spawn used to drop the pin silently (the
        // self-review r4's principles-1: the lens shape — temperature
        // pins, no unit model — never wrote settings, and the
        // README-advertised spread was fiction). Resolve against the
        // SANDBOX opencode.json's own model pin (writeWorkerPermissions
        // resolved unit → stage → workflow there); with no model
        // anywhere, REFUSE the spawn — never vanish.
        const m = spec.model ?? sandboxModelOf(spec.cwd) ?? modelIn(spec.cwd)
        if (!m) {
          this.log(`temperature ${spec.temperature} for ${label} has no model to pin against (no unit/stage/workflow model) — refusing spawn`)
          return false
        }
        if (!spec.model) writeOpencodeModel(spec.cwd, m)
        writeOpencodeModelSettings(spec.cwd, m, { temperature: spec.temperature })
      }
    }
    if (spec.resumeSession) tail.push("--session", spec.resumeSession)
    const startArgs = tail.length ? ["--", ...tail] : []
    // NOTE (r4 divide-pane incident): worker panes must not inherit the
    // human's interactive surface (global MCP/integrations can pop auth
    // chrome no API exposes). Isolation lives in the SANDBOX config —
    // writeWorkerPermissions re-declares every global MCP server with
    // enabled:false — because herdr's agent start carries no --env and
    // the opencode CLI carries no --config (OPENCODE_CONFIG cannot ride
    // the spawn). See src/adapters/store.ts.
    // the brownout guard's second half (ADR 0010): a refused start is
    // not death — knock again with growing pauses. AGENTIC_OS_START_
    // TRIES / _BACKOFF_MS tune it.
    const tries = retries("AGENTIC_OS_START_TRIES", 3)
    const backoffStartBase = backoffBase("AGENTIC_OS_START_BACKOFF_MS", 5_000)
    let start: CmdResult | null = null
    for (let attempt = 1; attempt <= tries; attempt++) {
      start = this.transport.exec(
        "agent", "start", label, "--kind", spec.kind, "--pane", pane,
        "--timeout", String(START_TIMEOUT_MS), ...startArgs,
      )
      if (start.status === 0) break
      this.log(`agent start failed for ${label} (rc=${start.status}, attempt ${attempt}/${tries})`)
      if (attempt < tries) {
        const pause = backoffMs(backoffStartBase, attempt)
        this.log(`agent start retry for ${label} in ${pause}ms (herdr brownout guard)`)
        sleepSync(pause)
      }
    }
    if ((start?.status ?? 1) !== 0) {
      this.log(`agent start failed for ${label} (rc=${start?.status}) after ${tries} attempt(s) — ghost cleared`)
      return false
    }
    if (!spec.hold) {
      const brief = readFileSync(spec.briefPath, "utf8")
      const prompt = this.transport.exec("agent", "prompt", label, brief)
      if (prompt.status !== 0) {
        this.log(`brief submission failed for ${label} — the grace reprompt will retry`)
      }
    }
    return true
  }

  prompt(label: string, text: string): CmdResult {
    return this.transport.exec("agent", "prompt", label, text)
  }

  status(label: string): AgentStatus {
    return parseAgentStatus(this.transport.exec("agent", "get", label).stdout)
  }

  // #104: the opencode sqlite db IS the usage store; pi keeps none
  // yet (null — the caller emits no row, never a fake zero)
  usageOf(cwd: string, sinceMs: number): UsageRow | null {
    return opencodeUsageOf(cwd, sinceMs)
  }
}

// ONE parser for the agent_status grammar — every status question in
// the rail goes through it (the liveness consolidation: one verb,
// workerStatus, four former spellings deleted).
export function parseAgentStatus(stdout: string): AgentStatus {
  if (stdout.includes('"agent_status":"working"')) return "working"
  if (stdout.includes('"agent_status":"blocked"')) return "blocked"
  if (stdout.includes('"agent_status":"idle"') || stdout.includes('"agent_status":"done"')) return "idle"
  return "unknown"
}
