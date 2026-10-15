// The JEV chooser: the judge picks the model, code owns the policy.
//
// Pricing parity (human-set, 2026-10-15): glm-5.3 costs the same as
// grok-4.7; flash is 1/5. So the frontier that matters is depth ×
// availability, not cents: flash for mechanical work, the full tier
// otherwise, and between the two full-price models choose on depth and
// availability (the zhipu plan's 5-hour cap binds, grok is metered).
//
// Detecting the fault itself is NOT a judgment — the session-message
// API field (provider.rate-limit) does that deterministically. JEV only
// picks among live candidates. Policy constants below are the
// reviewable surface: CHOOSER_MIN_CONFIDENCE gates acting on an answer,
// and a low-confidence or unreachable judge falls back to the static
// order ladder — the judge never blocks the run.
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type CatalogEntry = { cost: string; depth: string }

export const CATALOG: Record<string, CatalogEntry> = {
  "zhipuai-coding-plan/glm-5.3": {
    cost: "full price (same as grok-4.7)",
    depth: "full-depth agentic work: multi-step verification, code migration, deep debugging",
  },
  "zhipuai-coding-plan/glm-5.3-flash": {
    cost: "1/5 price",
    depth: "mechanical runs, log greps, simple edits, short replies",
  },
  "xai/grok-4.7": {
    cost: "full price (same as glm-5.3); metered, no 5-hour plan cap",
    depth: "full-depth work and the hardest stretches; long context",
  },
}

export const CHOOSER_MIN_CONFIDENCE = 0.6

// A plan-cap fault plausibly binds every model on the same provider
// plan. Pre-filter them ONLY when a live off-plan alternative exists —
// otherwise the judge would be asked to pick among certain 429s. When
// everything left is on the capped plan, keep them and let the next
// fault drive the honest death walk.
export function capBound(fault: { detail?: string } | null | undefined): boolean {
  if (!fault) return false
  return /使用上限|usage[- ]?cap|5-hour|限额/.test(fault.detail ?? "")
}

export function remainingCandidates(
  order: string[],
  dead: Iterable<string>,
  fault?: { model?: string; detail?: string } | null,
): string[] {
  const deadSet = new Set(dead)
  if (fault?.model) deadSet.add(fault.model)
  const live = order.filter((m) => !deadSet.has(m))
  if (!capBound(fault)) return live
  const offPlan = live.filter((m) => !m.startsWith("zhipuai-coding-plan/"))
  if (offPlan.length === 0) return live
  return offPlan
}

export function chooserState(input: {
  member: string
  briefExcerpt?: string
  workSummary?: string
  contextTokens?: number
  fault?: { model: string; detail: string } | null
  remaining: string[]
}): Record<string, unknown> {
  const candidates: Record<string, { cost: string; depth: string }> = {}
  for (const id of input.remaining) {
    const entry = CATALOG[id] ?? { cost: "unknown price", depth: "unknown depth" }
    candidates[id] = entry
  }
  return {
    member: { name: input.member, brief_excerpt: input.briefExcerpt ?? "" },
    work: {
      phase_summary: input.workSummary ?? "",
      context_tokens: input.contextTokens ?? null,
    },
    fault: input.fault ?? null,
    candidates,
  }
}

// ids are for code only — the instructions carry the meaning.
export function chooserQuestions(remaining: string[]): Record<string, unknown> {
  const criteria: Record<string, string> = {}
  for (const id of remaining) {
    const entry = CATALOG[id]
    criteria[id] = entry ? `${entry.cost}; suited to: ${entry.depth}` : "candidate model"
  }
  return {
    pick: {
      type: "choice",
      instructions:
        "Which model should run `member`'s next stretch of work, given `work` and `fault`? " +
        "Pick the cheapest candidate that can still carry the work to completion. " +
        "Full-price candidates cost the same as each other, so between them choose on " +
        "depth fit and availability (see `fault` and each candidate's notes), never on price. " +
        "When `fault` shows a model just failed, do not pick that model or anything its notes say shares the same cap.",
      criteria,
    },
  }
}

// The envelope is { answers: { pick: { choice, confidence } } } — and the
// judge must pick among the LIVE candidates only; anything else is a
// failed pick, not a re-filter.
export function parseChooser(stdout: string, remaining: string[]): { model: string; confidence: number } | null {
  try {
    const env = JSON.parse(stdout) as { answers?: { pick?: { choice?: unknown; confidence?: unknown } } }
    const pick = env.answers?.pick
    const choice = pick?.choice
    const confidence = typeof pick?.confidence === "number" ? pick.confidence : 0
    if (typeof choice !== "string" || !remaining.includes(choice)) return null
    return { model: choice, confidence }
  } catch {
    return null
  }
}

export type ChooserOpts = {
  taskDir: string
  member: string
  remaining: string[]
  briefExcerpt?: string
  workSummary?: string
  contextTokens?: number
  fault?: { model: string; detail: string } | null
  minConfidence?: number
  run?: (args: string[]) => { status: number; stdout: string }
}

export function chooseModel(opts: ChooserOpts): { ok: boolean; model?: string; confidence?: number; why?: string } {
  if (opts.remaining.length === 0) return { ok: false, why: "no live candidates" }
  const dir = join(opts.taskDir, ".jev")
  try {
    mkdirSync(dir, { recursive: true })
    const statePath = join(dir, "state.json")
    const qPath = join(dir, "questions.json")
    writeFileSync(statePath, `${JSON.stringify(chooserState(opts), null, 2)}\n`)
    writeFileSync(qPath, `${JSON.stringify(chooserQuestions(opts.remaining), null, 2)}\n`)
    const run = opts.run ?? ((args: string[]) => {
      const r = spawnSync("jev", args, { encoding: "utf8", timeout: 45_000 })
      return { status: r.status ?? 1, stdout: `${r.stdout ?? ""}` }
    })
    const r = run(["run", "-q", qPath, "-f", statePath, "--json"])
    if (r.status !== 0) return { ok: false, why: `jev rc=${r.status}` }
    const pick = parseChooser(r.stdout, opts.remaining)
    if (!pick) return { ok: false, why: "unparseable or off-lattice answer" }
    const min = opts.minConfidence ?? CHOOSER_MIN_CONFIDENCE
    if (pick.confidence < min) return { ok: false, why: `confidence ${pick.confidence} < ${min}`, model: pick.model, confidence: pick.confidence }
    return { ok: true, model: pick.model, confidence: pick.confidence }
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) }
  }
}
