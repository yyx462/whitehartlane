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
import { DEFAULT_ORDER } from "./model-chooser.ts"

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
  chooser?: "jev"
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
// not the member deciding it is done. The source is the session message
// API (error.type / status), not the pane text that renders it.
const BUDGET_TYPES = new Set([
  "provider.rate-limit",
  "provider.quota",
  "provider.billing",
  "provider.context-length",
])

export function isProviderBudgetError(error: { type?: string; status?: number } | null | undefined): boolean {
  if (!error) return false
  if (error.type && BUDGET_TYPES.has(error.type)) return true
  return error.status === 429
}

// ANY provider refusal is ladder-worthy, not only budget ones: an
// auth error from a model the operator has no subscription for (the
// wrong-model demo), model-not-found, 5xx — all mean "this provider
// will not take another turn", and the answer is the same: re-pick
// from the candidates. Non-provider errors (a human abort, an agent
// stop) are decisions, not faults — the ladder must not touch them.
export function isProviderFault(error: { type?: string; status?: number } | null | undefined): boolean {
  if (!error) return false
  if (error.type && error.type.startsWith("provider.")) return true
  return typeof error.status === "number" && error.status >= 400
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
  fault: boolean
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
  if (!input.fault) return { kind: "none" }
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

export function policyFromToml(toml: string): ModelPolicy & { chooser?: "jev" } {
  const section = toml.split(/\n(?=\[)/).find((b) => /^\s*\[fallback\]/.test(b))
  if (!section) return { mode: "ask", order: [] }
  const modeLine = section.match(/^\s*mode\s*=\s*"(auto|ask)"/m)
  const orderLine = section.match(/^\s*order\s*=\s*\[([^\]]*)\]/m)
  const chooserLine = section.match(/^\s*chooser\s*=\s*"(\w+)"/m)
  const order = orderLine
    ? [...orderLine[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((m) => MODEL_RE.test(m))
    : []
  return {
    mode: modeLine?.[1] === "auto" ? "auto" : "ask",
    order,
    ...(chooserLine?.[1] === "jev" ? { chooser: "jev" as const } : {}),
  }
}

// The model policy is layered, most specific wins:
//   1. run models.json — in-flight override (the human's ballot box)
//   2. the spur's workflow.toml [fallback] — per-spur policy
//   3. models.local.toml at the door checkout root — the operator's
//      global default, local-only and gitignored (never pushed)
//   4. the built-in candidate order — zero-config: auto, static walk
//
// A spur section with a mode but no order borrows the order from the
// layer below (multi-model spurs name their own order; everything else
// inherits). doorRoot is where step 3 looks; production passes the
// door checkout root, tests pass a fixture dir.
function globalPolicy(doorRoot: string): ModelsFile | null {
  const path = join(doorRoot, "models.local.toml")
  if (!existsSync(path)) return null
  try {
    const g = policyFromToml(readFileSync(path, "utf8"))
    if (g.order.length === 0) return null
    return { mode: g.mode, order: g.order, ...(g.chooser ? { chooser: g.chooser } : {}) }
  } catch {
    return null
  }
}

function layeredBase(toml: string, doorRoot: string | null): ModelsFile {
  const hasOwn = /^\s*\[fallback\]/m.test(toml)
  const own = policyFromToml(toml)
  const g = doorRoot ? globalPolicy(doorRoot) : null
  if (hasOwn) {
    const order = own.order.length > 0 ? own.order : (g && g.order.length > 0 ? g.order : DEFAULT_ORDER)
    const chooser = own.chooser ?? g?.chooser
    return { mode: own.mode, order, ...(chooser ? { chooser } : {}) }
  }
  if (g && g.order.length > 0) return g
  return { mode: "auto", order: DEFAULT_ORDER }
}

export function readModelsFile(taskDir: string, toml: string, doorRoot?: string | null): ModelsFile {
  const base = layeredBase(toml, doorRoot ?? null)
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
    const chooser = raw.chooser === "jev" || base.chooser === "jev" ? ("jev" as const) : undefined
    return { mode, order, ...(chooser ? { chooser } : {}), ...(pending ? { pending } : {}), ...(Object.keys(decide).length ? { decide } : {}) }
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
