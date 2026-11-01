// src/doors/stop-rule.ts — the owner's stop rule (2026-11-01).
//
// "Zero findings in the whole cumulative diff" is not a reachable
// termination condition from inside a review loop: every fix adds
// surface, fresh lenses probe it, and the bar rises forever (the
// round-10 receipt: novel=7 — one fix push created seven new
// root-cause buckets). This module computes the owner-side
// diminishing-returns FACT from the PR's own round history:
//
//   novel  = root-cause buckets this round that the previous round
//            did not have (NEW mechanisms — the ratchet's measure)
//   stuck  = buckets present in BOTH of the last two rounds (an
//            unfixed finding — persistence disqualifies eligibility;
//            the loop is not diminishing, it is stuck)
//
// eligible = rounds ≥ min_rounds (good faith), no P0 in the window,
//            novel ≤ novelMax for `rounds` consecutive rounds, and
//            no stuck bucket in the window.
//
// The rule NEVER flips a verdict. It lights a banner (merge.sh's
// reject arm) and records a fact beside the override (the ship door):
// the reviewer reminds, the owner decides. Thresholds are measured
// against this repo's own round history (11 rounds replayed:
// novel≤1 ×2 with no stuck and no P0 never fires spuriously — see
// test/stop-rule.test.ts's replay fixture), never hand-picked.
import { execFileSync } from "node:child_process"
import { parse as parseToml } from "smol-toml"

// the finding's SEAT (the cluster key): one file, one 40-line window.
// Three lenses finding the same bug land in the same bucket (the r11
// receipt: 11 findings → 7 buckets — momentum-920, principles-103 and
// questions-27 were three ids for one verdictsForBranch bug).
export type BlockedLike = { id?: string; severity?: string; location?: { file?: string; line_start?: number } }

export type StopConfig = { rounds: number; novelMax: number; minRounds: number }

export const DEFAULT_STOP: StopConfig = { rounds: 2, novelMax: 1, minRounds: 2 }

export function bucketOf(b: BlockedLike): string {
  const file = (b.location?.file ?? "?").split("/").pop() ?? "?"
  const win = Math.floor((b.location?.line_start ?? 0) / 40)
  return `${file}:${win}`
}

export function clustersOf(blocked: BlockedLike[]): string[] {
  return [...new Set(blocked.map(bucketOf))].sort()
}

export type StopEligibility = {
  rounds: number
  novel: number
  stuck: string[]
  p0: boolean
  eligible: boolean
  why: string
}

// history = one entry per round, OLDEST FIRST, each the round's
// blocked findings. The eligibility reads the LAST cfg.rounds rounds;
// novelty/stuck are computed against each round's predecessor.
export function stopEligibility(history: BlockedLike[][], cfg: StopConfig = DEFAULT_STOP): StopEligibility {
  const rounds = history.length
  const last = history[rounds - 1] ?? []
  const prev = history[rounds - 2] ?? []
  const cur = clustersOf(last)
  const prv = clustersOf(prev)
  const novel = prev.length ? cur.filter((x) => !prv.includes(x)).length : cur.length
  const stuck = prev.length ? cur.filter((x) => prv.includes(x)) : []
  const window = history.slice(-cfg.rounds)
  const p0 = window.some((r) => r.some((b) => b.severity === "P0"))
  // per-window-round checks: every round in the window must itself be
  // quiet (novel ≤ novelMax against ITS predecessor, no stuck)
  const quiet = window.every((r, i) => {
    const before = history[history.length - window.length + i - 1]
    if (!before) return false // the window needs a predecessor to be novel against
    const a = clustersOf(r), b = clustersOf(before)
    const n = b.length ? a.filter((x) => !b.includes(x)).length : a.length
    const s = b.length ? a.filter((x) => b.includes(x)) : []
    return n <= cfg.novelMax && s.length === 0
  })
  const eligible = rounds >= cfg.minRounds && !p0 && novel <= cfg.novelMax && stuck.length === 0 && quiet
  const why = eligible
    ? `eligible — novel ${novel} ≤ ${cfg.novelMax} for ${cfg.rounds} consecutive round(s), no P0, no stuck bucket, ${rounds} round(s) of good faith`
    : rounds < cfg.minRounds
      ? `not eligible — round ${rounds} of min ${cfg.minRounds}: good faith comes first`
      : p0
        ? `not eligible — a P0 sits in the last ${cfg.rounds} round(s)`
        : stuck.length > 0
          ? `not eligible — ${stuck.length} stuck bucket(s) (${stuck.join(", ")}): a finding persisting across rounds is not diminishing returns, it is unfinished work`
          : `not eligible — novel ${novel} > ${cfg.novelMax} (new mechanisms keep appearing; the loop is not diminishing)`
  return { rounds, novel, stuck, p0, eligible, why }
}

// the OWNER's parameters ride the TRUSTED side — the BASE commit's
// review-gate.toml [stop] block — exactly the band's seat
// (momentum-910): a PR cannot loosen the rule that ends its own
// review. A base with no contract means the measured defaults.
export function stopConfigOf(repo: string, opts: { base?: string } = {}): StopConfig {
  if (!opts.base) return DEFAULT_STOP
  try {
    const raw = execFileSync("git", ["-C", repo, "show", `${opts.base}:review-gate.toml`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const t = parseToml(raw) as { stop?: { rounds?: unknown; novel_max?: unknown; min_rounds?: unknown } }
    const s = t.stop ?? {}
    const num = (v: unknown, d: number) => (typeof v === "number" && v >= 1 ? Math.floor(v) : d)
    return { rounds: num(s.rounds, DEFAULT_STOP.rounds), novelMax: num(s.novel_max, DEFAULT_STOP.novelMax), minRounds: num(s.min_rounds, DEFAULT_STOP.minRounds) }
  } catch {
    return DEFAULT_STOP
  }
}
