// ADR 0006 §3 — whl fork: deliver a booked wake into a reborn levy
// pane. The pure half: the seed the fork points back to, and the first
// prompt the reborn pane receives. The body (tab, pane, herdr) lives
// in bin/whitehartlane.
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import type { JobRecord, SeedPointer } from "./store.ts"
import { appendEvent, findOrOpenSession } from "./store.ts"
import { admitFork } from "./policy.ts"
import { seedSessionFile, repointOpencodeSession } from "./transcripts.ts"
import { defaultRunner, jsonAt, type RunnerResult } from "./runners.ts"

// Issue #127 — the deterministic walk: from a vanished path, the
// nearest surviving ancestor. $HOME itself is deliberately too vague
// (an agent parked in ~ is lost, not home) — reaching it refuses.
export function survivingAncestor(path: string): string | null {
  const home = homedir()
  let here = resolve(path)
  for (;;) {
    const parent = dirname(here)
    if (parent === here) return null // filesystem root — nothing survives
    here = parent
    if (here === home) return null
    if (existsSync(here)) return here
  }
}

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
  relocation?: { from: string; to: string }
}): string {
  const lines = [
    `[wake] ${input.wake.message}`,
    "",
    `You are the fork of the levy that levied this spur (${input.jid}): your`,
    `session ${input.seed.tool}:${input.seed.session_id} was resumed from the`,
    `checkpoint ${input.seed.since} — the moment the spur was levied.`,
    "Read the report, decide what it means for your work, and carry on.",
  ]
  if (input.relocation) {
    lines.push(
      "",
      `Your session's project directory ${input.relocation.from} no longer exists on disk`,
      `(renamed, moved, or deleted); this pane repointed you to ${input.relocation.to},`,
      "the nearest surviving parent. Your session history is intact — find where",
      "your work lives now (the repo may have moved or been renamed), or ask your",
      "operator which repo this is before editing anything.",
    )
  }
  return lines.join("\n")
}

// The fork is a COURIER (ADR 0008 rung 3): it exists to deliver the wake
// into the levy session — the session lives on after; the pane is just a
// TTY. So the pane closes itself when the reborn turn ends (agent idle),
// the same second nobody needs to watch it anymore. Detached shell —
// must survive this process.
//
// Issue #124 — "idle" is ambiguous before first work: a resumed TTY can
// sit idle for seconds while it loads the session, and j-64e035's
// reaper closed the courier in exactly that window (agent prompt rc=0,
// session store untouched — the wake never landed). So the reaper waits
// for the FIRST WORKING TURN before it may wait for idle, and writes a
// receipt the audit can read: worked=true (a live turn took the wake)
// or worked=false (the pane closed without the prompt ever reaching an
// agent turn — drain the wake again). Bounds: working-wait 90s
// (AGENTIC_OS_FORK_WORKING_MS), idle-wait 30min (AGENTIC_OS_FORK_IDLE_MS)
// — long turns are legitimate, squatting forever is not.
export function forkReaperCmd(label: string, pane: string, tab: string, receiptPath?: string): string {
  const r = receiptPath ? shellQuote(receiptPath) : null
  const workingMs = hookEnvMs("AGENTIC_OS_FORK_WORKING_MS", 90_000)
  const idleMs = hookEnvMs("AGENTIC_OS_FORK_IDLE_MS", 1_800_000)
  return [
    r
      ? `if herdr agent wait ${label} --until working --timeout ${workingMs}; then echo '{"worked":true}' > ${r}; else echo '{"worked":false}' > ${r}; fi`
      : `herdr agent wait ${label} --until working --timeout ${workingMs} || true`,
    `herdr agent wait ${label} --until idle --timeout ${idleMs} || true`,
    `herdr tab close ${tab}`,
    `herdr pane close ${pane}`,
  ].join("; ")
}

function hookEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "")
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
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
  opts: { herdrRun?: (args: string[]) => RunnerResult; detachedSpawn?: (cmd: string) => void } = {},
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
  let cwd = session.cwd || job.dir
  let relocation: { from: string; to: string } | undefined
  // Issue #127 — a levy whose project dir is gone births a dead
  // courier: opencode binds a session to its stored directory and goes
  // back to it on resume (probe: oc --session from another cwd chdirs
  // to the old path, ENOENT), so the pane lands on a directory picker
  // no non-interactive courier can answer. Ladder: repoint the session
  // to the nearest SURVIVING ancestor (deterministic walk — the rail
  // never guesses which repo is "best"; the resumed agent, which has
  // judgment, gets a relocation note and decides where its work lives),
  // and refuse — never a ghost courier — when repointing cannot happen.
  if (!existsSync(cwd)) {
    const ghost = cwd
    const survivor = survivingAncestor(ghost)
    const manual =
      `the levy's project dir is gone: ${ghost} — recreate it (mkdir -p '${ghost}') or restore the repo there, ` +
      `or repoint the session (UPDATE session SET directory='<a real dir>' WHERE id='${job.spawner.session_id}' in the opencode DB); ` +
      `the durable wake.json waits at ${join(job.dir, "wake.json")}`
    if (job.spawner.tool !== "opencode") {
      return { ok: false, why: `auto-repoint is opencode-only; this levy is ${job.spawner.tool} — ${manual}` }
    }
    if (!survivor) {
      return { ok: false, why: `no surviving ancestor short of $HOME — too vague to repoint blindly. ${manual}` }
    }
    let moved = false
    try {
      moved = repointOpencodeSession(job.spawner.session_id, survivor)
    } catch {
      moved = false
    }
    if (!moved) {
      return { ok: false, why: `repointing the session row failed (db busy or unreadable). ${manual}` }
    }
    cwd = survivor
    relocation = { from: ghost, to: survivor }
    appendEvent(session.id, {
      actor: "levy",
      kind: "session.repointed",
      jid: job.id,
      from: ghost,
      to: survivor,
      session_id: job.spawner.session_id,
      why: "project dir gone — repointed to the nearest surviving ancestor",
    })
  }
  const tab = run(["tab", "create", "--label", `whl-fork-${job.id}`.slice(0, 40), "--cwd", cwd, "--no-focus"])
  const root = jsonAt(tab.stdout, (d) => d?.result?.root_pane?.pane_id ?? null)
  const forkTab = jsonAt(tab.stdout, (d) => d?.result?.tab?.tab_id ?? d?.result?.root_pane?.tab_id ?? null)
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
  const prompt = run(["agent", "prompt", label, forkPrompt({ wake, seed, jid: job.id, ...(relocation ? { relocation } : {}) })])
  if (prompt.status !== 0) {
    run(["pane", "close", shell])
    return { ok: false, why: `the wake prompt did not land (rc=${prompt.status})` }
  }
  // the courier closes its own tab when the reborn turn ends — idle fork
  // panes (whl-fork-*) used to squat forever after delivery. The reaper
  // writes its receipt into the job dir (issue #124): worked=true/false
  // is the honest record of whether the wake ever reached a live turn,
  // and wakeAudit surfaces a never-worked courier for a re-drain.
  if (forkTab) {
    const reaper = opts.detachedSpawn ?? ((cmd: string) => {
      spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" }).unref()
    })
    reaper(forkReaperCmd(label, shell, forkTab, join(job.dir, "courier.json")))
  }
  return { ok: true, label, pane: shell }
}
