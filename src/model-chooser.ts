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
    cost: "$1.40 in / $4.40 out per 1M tokens; covered by the operator's GLM coding plan (the preferred workhorse)",
    depth: "full-depth agentic work: multi-step verification, code migration, deep debugging; 1M context",
  },
  "zhipuai-coding-plan/glm-5.3-flash": {
    cost: "$0.15 in / $0.50 out per 1M tokens — ~1/9 of glm-5.3, also plan-covered; shares the GLM plan's 5-hour cap pool with glm-5.3",
    depth: "mechanical runs, log greps, simple edits, short replies",
  },
  "xai/grok-4.7": {
    cost: "$2.00 in / $6.00 out per 1M tokens (above 200k context up to $4.40/$13.20) — the most expensive option; metered, outside the GLM plan",
    depth: "full-depth work; the escape hatch when no GLM candidate is live (plan cap) or a stretch clearly exceeds GLM",
  },
}

export const CHOOSER_MIN_CONFIDENCE = 0.6

// The built-in candidate order — the zero-config default when neither
// the spur toml nor the local global file names any.
export const DEFAULT_ORDER = Object.keys(CATALOG)

// The just-faulted model leaves the candidate set; everything else stays
// and the judge decides with the fault + notes in view. A wrong GLM pick
// under a plan cap costs one refused turn (~nothing); forcing grok from
// code would silently buy the most expensive model against the
// operator's stated preference.
export function remainingCandidates(order: string[], dead: Iterable<string>): string[] {
  const deadSet = new Set(dead)
  return order.filter((m) => !deadSet.has(m))
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
        "The operator holds a GLM coding plan, so GLM candidates are plan-covered and strongly preferred: " +
        "prefer a live GLM candidate over grok-4.7 whenever it can carry the work. " +
        "Otherwise pick the cheapest candidate that can still carry the work to completion, and " +
        "escalate to grok-4.7 only when no GLM candidate is live (`fault`, candidate notes) or the work clearly exceeds GLM's depth. " +
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
