// adapters/opencode-host.ts — today's AgentHost: the agent CLIs that
// occupy herdr panes (opencode primary, pi branch).
//
// The HOST vocabulary, all in one place: the model pin (each CLI's own
// settings file — the flag that crashes one TUI rides the other), the
// start sequence behind the brownout guard (stagger + retry), the
// brief delivery, and the agent_status grammar parser (ONE parser —
// the liveness consolidation's single verb feeds from here).
import { readFileSync } from "node:fs"
import { backoffBase, backoffMs, drawJitter, jitterBound, retries, sleepSync } from "./backoff.ts"
import { splitModel, writeOpencodeModel, writeOpencodeModelSettings, writePiSettings } from "./store.ts"
import type { AgentHost, AgentStatus, HostInhabitSpec } from "../ports/agent-host.ts"
import type { CmdResult, Transport } from "../ports/transport.ts"

const START_TIMEOUT_MS = 60_000

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
    } else if (spec.model && spec.kind === "opencode") {
      // the root command dropped --model in the 2026-10 upgrade — a
      // passed flag crashes the TUI at birth (j-37bdc0: three start
      // timeouts, run dead). The pin rides the sandbox opencode.json
      // instead, symmetric with pi's settings write above.
      writeOpencodeModel(spec.cwd, spec.model)
      if (spec.temperature !== undefined) {
        writeOpencodeModelSettings(spec.cwd, spec.model, { temperature: spec.temperature })
      }
    }
    if (spec.resumeSession) tail.push("--session", spec.resumeSession)
    const startArgs = tail.length ? ["--", ...tail] : []
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
