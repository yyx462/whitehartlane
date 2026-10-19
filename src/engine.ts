// The one runner's engine picker — the dispatch layer, deleted
// (OPTIMUM.md §2: the three runners share Rail/panes/ledger; one
// runner with kind-specific engines replaces two kind-mapped bins).
// The staged workflow.toml names the shape; the shape picks the
// engine IN THIS PROCESS: coworker's relay loop, lab's actor loop, or
// the fan-out cycle. The engines themselves are untouched — the split
// was right at the runner level; what died is the machinery around
// picking one (bins, second dispatch, wrong-bin refusal).
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse as parseToml } from "smol-toml"
import { runCoworker } from "./coworker-run.ts"
import { levyChildProgram } from "./levy.ts"
import { runLab } from "./lab.ts"
import { runOrchestrator, worktreeChurnedSince } from "./orchestrator.ts"
import { sanitizeRoots } from "./permission.ts"
import type { Rail } from "./rail.ts"
import type { Report } from "./report.ts"
import { workflowKind, type WorkflowKind } from "./workflow-kind.ts"

export type EngineDeps = {
  // injectable so tests exercise the dispatch without spawning panes
  runCoworker?: typeof runCoworker
  runLab?: typeof runLab
  runFanOut?: typeof runOrchestrator
}

// roots.txt beside the staged program, one absolute path per line —
// the program's named extra roots. Hard-deny paths (secrets,
// credentials) never ride along: they are stripped here, loudly, so a
// rooted .env is never pre-allowed (j-1deef9). Shared by every shape;
// was copy-pasted per bin.
export function programRootsOf(dir: string): string[] {
  try {
    const raw = readFileSync(join(dir, "roots.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const { kept, stripped } = sanitizeRoots(raw)
    for (const s of stripped) console.error(`warning: roots.txt names ${s} — hard-deny paths are never roots; stripped`)
    return kept
  } catch {
    return []
  }
}

// The staged shape. A missing workflow.toml is a bare standalone run
// (fan-out, as ever); a PRESENT but invalid kind refuses — the door
// already refuses it pre-booking, so only a manual bin run lands here,
// and silence is not an answer (L0: refusal beats silence).
export function stagedKind(dir: string): WorkflowKind {
  let raw: string
  try {
    raw = readFileSync(join(dir, "workflow.toml"), "utf8")
  } catch {
    return "fan-out"
  }
  return workflowKind(raw)
}

// The fan-out engine wiring (moved out of the old fan-out bin so it is
// testable and lives with the other engines). Levy-spawned children
// resolve the runner through orchestratorRoot — the door checkout's
// bin/ in dev, dist/ in the npm bundle.
export function fanOutEngine(
  rail: Rail,
  orchestratorRoot: string,
  deps: EngineDeps = {},
): () => Promise<Report | null> {
  const ledger = rail.ledger
  // Fan-out workers live in the task dir's tree — pre-seed it from the
  // scope here, in the engine, so the DOOR never branches on kind
  // (coworker/lab members carry their own per-sandbox seeds).
  rail.writePermissions(rail.taskDir)
  return () => {
    // ADR 5: unfinished units of an earlier generation resume from the
    // pane ledger's booked session pointers. The ledger's unit column
    // carries the transport name (w-<id> for fan-out workers); the
    // walker keys by the bare unit id — re-key here, at the engine
    // that owns the w- convention. (Probe receipt 2026-10-19: the
    // un-rekeyed map's keys never matched the walker's lookup, so
    // every production continue silently took the fresh-brief
    // fallback; the booked-session path only ever ran in tests.)
    const resumes = new Map(
      [...rail.resumesForUnfinished()].map(([k, v]) => [k.startsWith("w-") ? k.slice(2) : k, v]),
    )
    if (resumes.size > 0) {
      rail.log(
        `continue: ${resumes.size} parked unit(s) resume from booked panes (${[...resumes.values()].filter((s) => s.session_id).length} with a session id)`,
      )
    }
    // deadline_ms on [workflow] is the run's hard ceiling (default 2h);
    // canary: env (0/1) wins for a run, then [workflow] canary, then on.
    let deadlineMs: number | undefined
    let wf: { deadline_ms?: number; canary?: boolean } | undefined
    try {
      wf = parseToml(readFileSync(join(rail.taskDir, "workflow.toml"), "utf8")).workflow
      const dm = Number(wf?.deadline_ms ?? "")
      if (dm > 0) deadlineMs = dm
    } catch {}
    const canary = (() => {
      if (process.env.AGENTIC_OS_CANARY === "0") return false
      if (process.env.AGENTIC_OS_CANARY === "1") return true
      return wf?.canary !== false
    })()
    return (deps.runFanOut ?? runOrchestrator)({
      taskDir: rail.taskDir,
      shep: rail,
      checkMs: Number(process.env.AGENTIC_OS_CHECK_MS ?? "") || undefined,
      slots: Number(process.env.AGENTIC_OS_SLOTS ?? "") || undefined,
      drainMs: Number(process.env.AGENTIC_OS_DRAIN_MS ?? "") || undefined,
      deadlineMs,
      resumes,
      // Booked wait (ADR 0006), the rail's one spelling: a pane session
      // a live child spur names as its spawner is idle on purpose.
      bookedWait: (unitId) => rail.bookedWait(`w-${unitId}`),
      // ADR 0007 stage 3 — the rail as levy: wake steps spawn child
      // programs through the door's own admission; the durable
      // wake.json is the receipt the engine polls.
      levyChild: ledger
        ? (unitId, folder) =>
            levyChildProgram({ folder, parentSid: ledger.job.sid, orchestratorRoot })
        : undefined,
      emit: (kind, payload) => ledger?.emit(kind, payload),
      existingRows: rail.existingRows(),
      // The worktree is the PROGRAM's tree, not the door's (j-battery):
      // env override, then the checkout holding the program (walk up
      // from its booked source for .git), else nothing.
      worktree: worktreeLadderOf(rail),
      churnSince: worktreeChurnedSince,
      canary,
    })
  }
}

// The ONE dispatch: shape → engine. Called once per runner process,
// inside it — no bin mapping, no second dispatch, no wrong bin.
export function engineFor(
  rail: Rail,
  kind: WorkflowKind,
  orchestratorRoot: string,
  deps: EngineDeps = {},
): () => Promise<Report | null> {
  if (kind === "coworker") return () => (deps.runCoworker ?? runCoworker)(rail)
  if (kind === "lab") return () => (deps.runLab ?? runLab)(rail)
  return fanOutEngine(rail, orchestratorRoot, deps)
}

function worktreeLadderOf(rail: Rail): string | undefined {
  const ledger = rail.ledger
  if (process.env.AGENTIC_OS_WORKTREE) return resolve(process.env.AGENTIC_OS_WORKTREE)
  const label = ledger?.job.worktree
  if (label?.startsWith("/")) return label
  const source = ledger?.job.spur?.source
  if (!source) return undefined
  let here = resolve(source)
  for (let up = 0; up < 8; up++) {
    if (existsSync(join(here, ".git"))) return here
    const parent = resolve(join(here, ".."))
    if (parent === here) break
    here = parent
  }
  return undefined
}
