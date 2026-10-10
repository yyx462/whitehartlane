// ADR 0006 §3 — whl fork: deliver a booked wake into a reborn levy
// pane. The pure half: the seed the fork points back to, and the first
// prompt the reborn pane receives. The body (tab, pane, herdr) lives
// in bin/agentic-os.
import { existsSync } from "node:fs"
import type { JobRecord, SeedPointer } from "./store.ts"
import { appendEvent, findOrOpenSession } from "./store.ts"
import { admitFork } from "./policy.ts"
import { seedSessionFile } from "./transcripts.ts"
import { defaultRunner, jsonAt, type RunnerResult } from "./runners.ts"

// The seed a fork of this Job's levy points back to — always the
// spawner pointer, never anything later: the levy session stays the
// spawn point forever.
export function forkSeedOf(job: JobRecord): SeedPointer | null {
  if (!job.spawner) return null
  return { tool: job.spawner.tool, session_id: job.spawner.session_id, since: job.spawner.since }
}

export function forkPrompt(input: {
  wake: { message: string }
  seed: SeedPointer
  jid: string
}): string {
  return [
    `[wake] ${input.wake.message}`,
    "",
    `You are the fork of the levy that levied this spur (${input.jid}): your`,
    `session ${input.seed.tool}:${input.seed.session_id} was resumed from the`,
    `checkpoint ${input.seed.since} — the moment the spur was levied.`,
    "Read the report, decide what it means for your work, and carry on.",
  ].join("\n")
}

// The wake-time rebirth (ADR 0008 rung 3): an unregistered chat levy
// is dead to the ladder by rule — the wake forks it into a fresh pane
// instead of waiting for a conversation that never claimed to be
// reachable. Same body as the `whl fork` verb, callable from the rail:
// admit the seed, open the levy session, split a pane, resume the
// session, prompt the wake. The caller books delivery; this returns
// the pane it borned or why it could not.
export type ForkOutcome =
  | { ok: true; label: string; pane: string }
  | { ok: false; why: string }

export function forkLevy(
  job: JobRecord,
  wake: { message: string },
  opts: { herdrRun?: (args: string[]) => RunnerResult } = {},
): ForkOutcome {
  if (!job.spawner) return { ok: false, why: "unattended — no levy to fork" }
  const run = opts.herdrRun ?? defaultRunner("herdr")
  const seed = forkSeedOf(job)
  const seedFile = seedSessionFile(job.spawner)
  const admission = admitFork({
    seed: { ...job.spawner, ...(seedFile ? { session_file: seedFile } : {}) },
    fileExists: (p) => existsSync(p),
  })
  if (!admission.admit) return { ok: false, why: `the seed does not resolve — ${admission.why}` }
  const { session } = findOrOpenSession({
    cwd: job.dir,
    host: { tool: job.spawner.tool, session_id: job.spawner.session_id },
  })
  const label = `fork-${job.id}`
  const cwd = session.cwd || job.dir
  const tab = run(["tab", "create", "--label", `whl-fork-${job.id}`.slice(0, 40), "--cwd", cwd, "--no-focus"])
  const root = jsonAt(tab.stdout, (d) => d?.result?.root_pane?.pane_id ?? null)
  if (!root) return { ok: false, why: `could not open a pane (herdr rc=${tab.status})` }
  const split = run(["pane", "split", "--pane", root, "--direction", "right", "--ratio", "0.5", "--cwd", cwd, "--no-focus"])
  const shell = jsonAt(split.stdout, (d) => d?.result?.pane?.pane_id ?? null)
  if (root) run(["pane", "close", root])
  if (!shell) return { ok: false, why: "pane split failed" }
  const start = run([
    "agent", "start", label, "--kind", job.spawner.tool, "--pane", shell,
    "--timeout", "60000", "--", "--session", job.spawner.session_id,
  ])
  if (start.status !== 0) {
    run(["pane", "close", shell])
    return { ok: false, why: `agent start failed (rc=${start.status})` }
  }
  appendEvent(session.id, {
    actor: "levy",
    kind: "pane.born",
    label,
    pane: shell,
    parent: "levy",
    seed,
    fork_of: job.id,
  })
  const prompt = run(["agent", "prompt", label, forkPrompt({ wake, seed, jid: job.id })])
  if (prompt.status !== 0) {
    run(["pane", "close", shell])
    return { ok: false, why: `the wake prompt did not land (rc=${prompt.status})` }
  }
  return { ok: true, label, pane: shell }
}
