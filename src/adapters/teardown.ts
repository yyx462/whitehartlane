// teardown — the run's END owns its labs (#278, the 2026-11-03 receipt:
// 64 review-worktree registrations accumulated in .bear because teardown
// lived ONLY in merge.sh's EXIT trap — every round that died before the
// merge stage retired its PANES honestly and left its base/head labs
// behind, two registrations per round, forever). The labs are
// regenerable from the SHAs intake pins in config.sh; the words
// (verdict, findings, feedback) live outside them and never ride this.
//
// The ordering is PR #260's, unchanged and load-bearing: repros ride
// out to data/review/repros/ FIRST (the fixer's adoption contract
// reads them there), the checkout dirs go SECOND, `worktree prune`
// LAST (prune before rm leaves stale metadata and the next
// `worktree add` dies with 128 — intake's own re-entry law inverted).
// Teardown is INFRA: every step guarded, it never changes a verdict,
// and a teardown failure is a log line, never a failed run.
//
// retirePanesVerified is #119's other half: abort used to run
// `shep retire` inside a swallowed catch and then book the pane dead
// anyway — a refused retire read as success and the real pane lived
// on as a zombie (eight of them survived overnight, 2026-10-14). A
// retire that fails prunes the ledger and retries ONCE; a pane that
// still refuses comes back NAMED, and the caller prints it loudly —
// a booked death must never be silent.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

export type LabsReceipt = {
  rodeOut: number // repro test files preserved under repros/
  removed: string[] // lab dirs removed (relative names)
  pruned: boolean // the repo's worktree metadata pruned
  repo?: string
}

// the repo the labs were minted from — config.sh is the review
// program's single config (intake writes it; every hook sources it)
function repoOf(review: string): string | undefined {
  try {
    const cfg = readFileSync(join(review, "config.sh"), "utf8")
    return cfg.match(/^REPO='(.*)'$/m)?.[1]
  } catch {
    return undefined
  }
}

export function teardownReviewLabs(taskDir: string): LabsReceipt | null {
  const review = join(taskDir, "data", "review")
  const head = join(review, "head")
  const base = join(review, "base")
  if (!existsSync(head) && !existsSync(base)) return null // not a review run, or already torn down
  const receipt: LabsReceipt = { rodeOut: 0, removed: [], pruned: false, repo: repoOf(review) }
  // the ride-out (#260): the corpus the lenses wrote into the head lab
  // is the fixer's adoption seat — it survives the lab, verbatim
  try {
    const corpus = join(head, "test", "review")
    if (existsSync(corpus)) {
      const repros = join(review, "repros", "test", "review")
      rmSync(join(review, "repros"), { recursive: true, force: true })
      mkdirSync(repros, { recursive: true })
      cpSync(corpus, repros, { recursive: true })
      receipt.rodeOut = readdirSync(repros).filter((f) => f.endsWith(".test.ts")).length
    }
  } catch {
    /* infra — the labs still go; the corpus was unreadable */
  }
  for (const [name, dir] of [
    ["head", head],
    ["base", base],
  ] as const) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true })
        receipt.removed.push(name)
      } catch {
        /* a locked checkout is a log line, not a failed run */
      }
    }
  }
  if (receipt.repo) {
    try {
      execFileSync("git", ["-C", receipt.repo, "worktree", "prune"], { timeout: 15_000 })
      receipt.pruned = true
    } catch {
      /* prune is best-effort; the next intake prunes again */
    }
  }
  return receipt
}

// #119 — a retire that can fail, named. The runner is injectable so
// tests drive a fake shep; production passes execFileSync.
export type PaneRunner = (args: string[]) => { status: number; stdout: string; stderr: string }

export function retirePanesVerified(
  labels: string[],
  run: PaneRunner,
): { closed: string[]; refused: { label: string; why: string }[] } {
  const closed: string[] = []
  const refused: { label: string; why: string }[] = []
  for (const label of labels) {
    if (run(["retire", label]).status === 0) {
      closed.push(label)
      continue
    }
    // the ledger may hold the pane in a state retire refuses (#119's
    // `not in ledger` mystery) — prune reaps ledger ghosts, retry once
    run(["prune"])
    const again = run(["retire", label])
    if (again.status === 0) closed.push(label)
    else refused.push({ label, why: again.stderr.split("\n").find(Boolean) ?? `exit ${again.status}` })
  }
  return { closed, refused }
}

// #143 — the retro closure DECISION (pure; the sweep wires it to the
// fleet). Two arms, both conservative:
//   1. a live pane whose owning Job is terminal AND NOT continuable
//      (retired/failed) closes — paused/aborted/orphaned panes stay
//      (continue rebirths them; the retro pass must never kill a
//      park's restart material).
//   2. a live pane NO Job record claims, whose label is whl's own
//      chrome — its job record is gone, so its owner can never come
//      back for it.
export type RetroJob = { id: string; state: string; panes: { label: string }[] }

export function retroClosure(
  live: { label: string }[],
  jobs: RetroJob[],
): { label: string; why: string; close: boolean }[] {
  const owners = new Map<string, RetroJob>()
  for (const j of jobs) for (const p of j.panes) if (!owners.has(p.label)) owners.set(p.label, j)
  const out: { label: string; why: string; close: boolean }[] = []
  for (const p of live) {
    const owner = owners.get(p.label)
    if (owner && (owner.state === "retired" || owner.state === "failed")) {
      out.push({ label: p.label, why: `job ${owner.id} is ${owner.state} (terminal, not continuable)`, close: true })
      continue
    }
    if (owner) continue // live, parked, or continuable — not ours to close
    if (/^(fan-out-|w-|whl-fork-|levy-)/.test(p.label)) {
      out.push({ label: p.label, why: "no Job record claims it — whl chrome with no owner", close: true })
    }
    // anything else is a foreign pane — never touched
  }
  return out
}
