// Issue: token-budget faults are provider failures, not member answers.
// The rail keeps a model ladder and switches INSIDE the live agent
// session (opencode: POST /session/{id}/model) — never a new session,
// so the conversation survives the provider.
//
// Two modes, both editable in flight via <run>/models.json (that file
// wins over the manifest; the engine re-reads it every beat):
//   auto — take the next model in `order` and switch
//   ask  — park a pending decision; nudges stand down until the human
//          (or the UI) writes decide.<member> = "switch" | "stay"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type FallbackMode = "auto" | "ask"

export type ModelPolicy = {
  mode: FallbackMode
  order: string[]
}

export type PendingSwitch = {
  member: string
  from: string
  to: string
  at: string
  why: string
}

export type ModelsFile = ModelPolicy & {
  pending?: PendingSwitch
  decide?: Record<string, "switch" | "stay">
}

const MODEL_RE = /^[^/\s]+\/[^/\s]+$/

export function parseModelRef(model: string): { providerID: string; id: string } | null {
  if (!MODEL_RE.test(model)) return null
  const slash = model.indexOf("/")
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) }
}

// A budget fault is a provider saying "I will not take another turn",
// not the member deciding it is done. Matched on the pane's own words.
const BUDGET = [
  /token limit/i,
  /context length/i,
  /maximum context/i,
  /quota exceeded/i,
  /insufficient[_\s-]?quota/i,
  /rate limit/i,
  /429/,
  /billing/i,
  /credit balance/i,
]

export function isBudgetFault(text: string): boolean {
  return BUDGET.some((re) => re.test(text))
}

export type BudgetAction =
  | { kind: "none" }
  | { kind: "switch"; to: string }
  | { kind: "ask"; to: string }
  | { kind: "waiting" }
  | { kind: "stay" }
  | { kind: "exhausted" }

// What the beat should do for one member. A pending ask outranks a
// fresh detection: the human's decide line is the only thing that
// moves it, and until then the stall clock stands down (waiting).
export function budgetAction(input: {
  screen: string
  member: string
  current?: string
  policy: ModelsFile
}): BudgetAction {
  const pending = input.policy.pending
  if (pending?.member === input.member) {
    const decision = input.policy.decide?.[input.member]
    if (decision === "switch") return { kind: "switch", to: pending.to }
    if (decision === "stay") return { kind: "stay" }
    return { kind: "waiting" }
  }
  if (!isBudgetFault(input.screen)) return { kind: "none" }
  const to = nextModel(input.policy.order, input.current)
  if (!to) return { kind: "exhausted" }
  return input.policy.mode === "auto" ? { kind: "switch", to } : { kind: "ask", to }
}

export function nextModel(order: string[], current: string | undefined): string | null {
  if (order.length === 0) return null
  if (!current) return order[0]
  const i = order.indexOf(current)
  if (i === -1) return order.find((m) => m !== current) ?? null
  return order[i + 1] ?? null
}

export function policyFromToml(toml: string): ModelPolicy {
  const section = toml.split(/\n(?=\[)/).find((b) => /^\s*\[fallback\]/.test(b))
  if (!section) return { mode: "ask", order: [] }
  const modeLine = section.match(/^\s*mode\s*=\s*"(auto|ask)"/m)
  const orderLine = section.match(/^\s*order\s*=\s*\[([^\]]*)\]/m)
  const order = orderLine
    ? [...orderLine[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((m) => MODEL_RE.test(m))
    : []
  return { mode: modeLine?.[1] === "auto" ? "auto" : "ask", order }
}

export function readModelsFile(taskDir: string, toml: string): ModelsFile {
  const base = policyFromToml(toml)
  const path = join(taskDir, "models.json")
  if (!existsSync(path)) return base
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ModelsFile>
    const order = Array.isArray(raw.order) ? raw.order.filter((m) => typeof m === "string" && MODEL_RE.test(m)) : base.order
    const mode = raw.mode === "auto" || raw.mode === "ask" ? raw.mode : base.mode
    const decide: Record<string, "switch" | "stay"> = {}
    if (raw.decide && typeof raw.decide === "object") {
      for (const [k, v] of Object.entries(raw.decide)) {
        if (v === "switch" || v === "stay") decide[k] = v
      }
    }
    const pending = raw.pending && typeof raw.pending.member === "string" ? (raw.pending as PendingSwitch) : undefined
    return { mode, order, ...(pending ? { pending } : {}), ...(Object.keys(decide).length ? { decide } : {}) }
  } catch {
    return base
  }
}

export function writePending(taskDir: string, file: ModelsFile, pending: PendingSwitch): void {
  const next: ModelsFile = { ...file, pending }
  writeFileSync(join(taskDir, "models.json"), JSON.stringify(next, null, 2) + "\n")
}

export function clearPending(taskDir: string, file: ModelsFile, member: string): void {
  const decide = { ...(file.decide ?? {}) }
  delete decide[member]
  const next: ModelsFile = { mode: file.mode, order: file.order, ...(Object.keys(decide).length ? { decide } : {}) }
  writeFileSync(join(taskDir, "models.json"), JSON.stringify(next, null, 2) + "\n")
}
