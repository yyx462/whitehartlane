// src/doors/ship.ts — the fixer's right to reject a rejection (the
// 2026-10-30 ruling). The rail's verdicts are honest, but a PROVEN
// repro can still assert the wrong REQUIREMENT (the r2 receipt: "a
// suite test asserting the wrong thing") — the reviewer sees the diff,
// the owner knows the intent. GitHub's admin-merge is the precedent:
// the override is allowed, visible, and recorded. This door is that
// shape for the rail: after round 1, the branch owner may overrule a
// reject — answering EVERY blocked finding with a one-line why — and
// merge the EXACT bytes the verdict judged.
//
// The laws it keeps:
//   never in the dark   every blocked finding answered, no invented ids
//   never stale bytes   the merged head IS the head the verdict names
//   never on round 1    good faith comes first; the exit opens after it
//   never stealth       the overrule is ledgered and posted to the PR
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { homeRoot, sessionsRoot } from "../adapters/store.ts"

export type BlockedFinding = { id: string; severity?: string; claim?: string; location?: { file?: string } }

export type Verdict = {
  verdict: string
  repo?: string
  base?: string
  head?: string
  blocked: BlockedFinding[]
  advisory?: unknown[]
}

// every verdict on this machine for one head sha, NEWEST FIRST —
// recency is the file's mtime (the gate-r7 law: never enumeration
// order), the same read the gate itself trusts
export function verdictsForHead(headSha: string, root = sessionsRoot()): Array<{ verdict: Verdict; at: number; path: string }> {
  return allVerdicts(root).filter((h) => h.verdict.head === headSha)
}

// every verdict for ONE REPO, newest first (principles-4002): the
// overrule exit counts the owner's ROUNDS, not the rounds of one
// sha — a fixer who changed bytes (a new head) and was rejected again
// is on round 2, not on "round 1 of 1"; counting per sha locked the
// exit against exactly the fixer it was built for.
// MEMBERSHIP, not a field: a verdict carries no repo name, but its
// head sha EXISTS in exactly one repo — so "this verdict judged THIS
// repo" is answered by git.
export function verdictsForRepo(repo: string, root = sessionsRoot()): Array<{ verdict: Verdict; at: number; path: string }> {
  const inRepo = (sha: string | undefined): boolean => {
    if (!sha) return false
    try {
      execFileSync("git", ["-C", repo, "cat-file", "-e", `${sha}^{commit}`], { stdio: ["ignore", "ignore", "ignore"] })
      return true
    } catch {
      return false
    }
  }
  return allVerdicts(root).filter((h) => h.verdict.repo === repo || inRepo(h.verdict.head))
}

// the owner's ROUNDS on THIS branch (questions-1 / tests-2): the
// repo's whole review history counted (other PRs included), so a
// brand-new PR's FIRST reject opened the override exit — the gate the
// exit exists to keep. The owner's rounds are the verdicts whose head
// is ON this branch's history — and the BASE's verdicts are NOT this
// PR's rounds (a verdict AT the base sha judged some other branch's
// diff against that base).
export function verdictsForBranch(
  repo: string,
  headSha: string,
  opts: { base?: string; root?: string } = {},
): Array<{ verdict: Verdict; at: number; path: string }> {
  const onBranch = (sha: string | undefined): boolean => {
    if (!sha) return false
    if (sha === headSha) return true
    if (opts.base && sha === opts.base) return false
    try {
      execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", sha, headSha], { stdio: ["ignore", "ignore", "ignore"] })
      return true
    } catch {
      return false
    }
  }
  return verdictsForRepo(repo, opts.root ?? sessionsRoot()).filter((h) => onBranch(h.verdict.head))
}

function allVerdicts(root: string): Array<{ verdict: Verdict; at: number; path: string }> {
  const hits: Array<{ verdict: Verdict; at: number; path: string }> = []
  if (!existsSync(root)) return hits
  for (const sid of readdirSync(root)) {
    const jdir = join(root, sid, "jobs")
    if (!existsSync(jdir)) continue
    for (const jid of readdirSync(jdir)) {
      const v = join(jdir, jid, "run", "data", "review", "verdict.json")
      if (!existsSync(v)) continue
      try {
        const parsed = JSON.parse(readFileSync(v, "utf8")) as Verdict
        hits.push({ verdict: parsed, at: statSync(v).mtimeMs, path: v })
      } catch {
        /* unreadable verdict: not our fact */
      }
    }
  }
  return hits.sort((a, b) => b.at - a.at)
}

export type ShipCheck = { ok: true; verdict: Verdict; rounds: number; overrules: Record<string, string> } | { ok: false; code: number; why: string }

// the whole judgment BEFORE any mutation: a reject worth overruling,
// a round count past good faith, and a per-finding answer for every
// blocked finding — fixes ride the normal loop; what is left is being
// REJECTED, and a rejection of a rejection says why, per finding
export function shipCheck(opts: {
  headSha: string
  overruleFile: string
  rounds: Array<{ verdict: Verdict; at: number }>
  repoRounds?: number
  minRounds?: number
}): ShipCheck {
  const minRounds = opts.minRounds ?? 2
  if (opts.rounds.length === 0) return { ok: false, code: 2, why: `no review verdict exists for head ${opts.headSha.slice(0, 12)} — nothing to overrule; levy a review first` }
  const latest = opts.rounds[0].verdict
  if (latest.verdict !== "reject") return { ok: false, code: 2, why: `the latest verdict for this head is '${latest.verdict}', not reject — nothing to overrule` }
  // the ROUNDS are the owner's rounds for this REPO (principles-4002):
  // a fixer who changed bytes and was rejected again is on round 2, not
  // "round 1 of 1" — the exit must open for exactly that fixer
  const rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)
  if (rounds < minRounds) {
    return { ok: false, code: 2, why: `round 1 of ${rounds}: the overrule opens after good faith — fix what you accept and re-review first (the exit unlocks at ${minRounds} rounds)` }
  }
  let overrules: Record<string, string> = {}
  try {
    overrules = JSON.parse(readFileSync(opts.overruleFile, "utf8")) as Record<string, string>
  } catch (err) {
    return { ok: false, code: 2, why: `cannot read the overrule file (${err instanceof Error ? err.message : String(err)}) — want JSON: { "<finding-id>": "one line why", … }` }
  }
  const blockedIds = new Set(latest.blocked.map((b) => b.id))
  for (const id of Object.keys(overrules)) {
    if (!blockedIds.has(id)) return { ok: false, code: 2, why: `overrule mentions '${id}' which is not a blocked finding — feedback never invents findings, and neither does an overrule` }
  }
  const missing = latest.blocked.filter((b) => !overrules[b.id] || !String(overrules[b.id]).trim())
  if (missing.length > 0) {
    return { ok: false, code: 2, why: `unanswered blocked finding(s): ${missing.map((b) => b.id).join(", ")} — every rejection you reject carries a one-line why` }
  }
  return { ok: true, verdict: latest, rounds: opts.rounds.length, overrules }
}

export function overruleComment(opts: { pr: string; verdict: Verdict; overrules: Record<string, string>; by: string }): string {
  const lines = [
    `**ship-gate: MERGED UNDER OVERRIDE — ${Object.keys(opts.overrules).length} finding(s) overruled, answered per finding** *(by ${opts.by})*`,
    ``,
    `The reviewer proved; the owner disagreed. Each overruled fact and the stated why:`,
    ``,
  ]
  for (const [id, why] of Object.entries(opts.overrules)) {
    const b = opts.verdict.blocked.find((x) => x.id === id)
    lines.push(`- **${id}** (${b?.severity ?? "?"}): ${b?.claim ?? ""}`)
    lines.push(`  → overruled: ${why}`)
  }
  lines.push(``)
  lines.push(`The reviewer's receipts stand (repros reproducible from the run dir); this merge is recorded as an override, not a refutation.`)
  return lines.join("\n")
}
