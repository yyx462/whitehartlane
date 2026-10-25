// ports/agent-host.ts — what runs INSIDE a pane (the agent-CLI seam).
//
// The transport addresses panes; the host is the vocabulary of the
// agent CLI that occupies one: how an agent is born (model pin, start
// retry, brief delivery), how it is prompted, and how its own status
// is read (the agent_status grammar is HOST knowledge — the CLI
// reports it, the host parses it). Today's adapter is opencode (with
// a pi branch); a future host plugin implements THIS interface.
import type { CmdResult } from "./transport.ts"

export type AgentStatus = "working" | "idle" | "blocked" | "unknown"

// #104 / #201 accounting: a worker's cumulative token ledger from its
// host's own store (opencode: the sqlite session db; pi: not yet).
// (cwd, since) scoped — retries mint new sessions in the same sandbox
// and count. Best-effort by law: no host store, no row, never a gate.
export type UsageRow = {
  input: number
  output: number
  cacheRead: number
  cost: number
  sessions: number
}

export interface HostInhabitSpec {
  kind: string
  briefPath: string
  cwd: string
  model?: string
  // per-mind model settings: opencode pins this into the sandbox
  // config (provider.<p>.models.<id>.temperature, the schema's own
  // key); hosts without a settings layer log it, never drop silently
  temperature?: number
  // ADR 5: resume a booked session instead of a fresh brief
  resumeSession?: string
  // zen 6: a member that does not initiate is born idle — its brief
  // rides with the first relayed message
  hold: boolean
}

export interface AgentHost {
  // birth: pin the model, start the agent CLI in the pane (with the
  // brownout guard's stagger/retry), submit the brief unless held
  inhabit(label: string, pane: string, spec: HostInhabitSpec): boolean
  prompt(label: string, text: string): CmdResult
  // the agent's own verdict — the grammar parser lives here
  status(label: string): AgentStatus
  // #104: the worker's cumulative token usage from the host's own
  // store, scoped by (cwd, since) — null when the host keeps none
  usageOf(cwd: string, sinceMs: number): UsageRow | null
}
