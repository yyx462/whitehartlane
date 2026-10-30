// ship-supervisor — the parentless commission's owner (2026-10-30).
// The wake law ("one wake per commission; a Job nobody hears finishing
// is an information gap") meets the plain terminal: `gwt submit-pr`
// from a shell has no session to wake, and a git hook cannot own a
// 4-lens agent review. So the door MINTS the owner: a one-shot
// headless opencode agent whose entire commission is — levy the rail
// in its tracked background shell, hear the finish, deliver the
// verdict to the PR, die. Detached from the caller's process tree
// (submit-pr returns when the PR opens), which is exactly the
// detachment the whl-driving law forbids — except there the hearer is
// absent by construction; here the supervisor IS the hearer. One wake,
// kept by design.
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync } from "node:fs"
import { dirname, join } from "node:path"

// single-quote shell escaping — the levy command is COPIED into the
// supervisor's brief and run verbatim; a title with an apostrophe must
// not break the spell
export const q = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

export function supervisorBrief(opts: { levyCmd: string; runDir: string; pr: string; repo: string }): string {
  const { levyCmd, runDir, pr, repo } = opts
  return [
    `You are the ship supervisor for PR #${pr} of ${repo}. This is your entire commission — do exactly this and nothing else:`,
    ``,
    `1. Run this levy in your tracked background shell (NEVER nohup or '&' detached — you must hear it finish):`,
    `   ${levyCmd}`,
    `2. STAY ALIVE until the commission resolves — your process IS the watch. Keep a FOREGROUND blocking wait for the verdict (a sh loop like: until [ -f "$V" ]; do sleep 15; done; cat "$V") and let it run to completion. Do NOT end your turn with nothing pending; a supervisor that exits early abandons the commission (the receipt: the first live supervisor died exactly this way and PR #259 went silent).`,
    `3. The verdict file: the levy's own stdout names the job it booked (a line like 'job: j-XXXX') — the verdict lands at the JOB's run dir, pattern ${runDir.startsWith("/") ? "$AGENTIC_OS_HOME" : ""}/sessions/*/jobs/<jid>/run/data/review/verdict.json under the agentic-os home; the staged ${runDir}/data/review/verdict.json may also carry it. Watch BOTH paths; resolve <jid> from the levy output.`,
    `4. When the wait ends, read the outcome. If verdict.json exists: go to step 5. If verdict.json is ABSENT (no verdict — the inner door refused, or infra failed): the levy carried --pr so its skip receipt may already be on PR #${pr}; post ONE comment yourself naming the outcome and the levy's printed reason — the PR is NEVER left silent.`,
    `5. Write ${runDir}/supervisor-comment.md, then post it as ONE comment on PR #${pr}: cd ${q(repo)} && gh pr comment ${pr} --body-file ${runDir}/supervisor-comment.md — the verdict (accept/reject), each blocked finding (id, severity, claim, location.file) if any, and the feedback pointers from the job run dir's feedback/MAP.md when it exists.`,
    `6. accept: the rail's merge command already merged the PR — do NOT merge again. reject: do NOT merge, do NOT fix anything, do NOT re-run the review — the authors own the fixes.`,
    `7. If the wait exceeds 2 hours: post a timeout comment on PR #${pr} and (best effort) run: notify "ship-gate" "PR #${pr} review timed out — supervisor log beside ${runDir}" — so a human hears the silence.`,
    `8. Write one line to ${runDir}/supervisor-result.md (verdict or outcome + PR number). Then STOP — your commission is complete.`,
  ].join("\n")
}

// the ship-gate's receipt channel: a comment on the PR under review.
// cwd is the repo (a worktree of it) so gh resolves the remote itself.
export function ghPrComment(pr: string, repo: string, body: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("gh", ["pr", "comment", pr, "--body", body], { cwd: repo, encoding: "utf8", timeout: 60_000 }).trim()
    return { ok: true, out }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim() }
  }
}

// mint the owner: detached one-shot agent, stdout/stderr to a log the
// caller can tail. A bin that cannot spawn is INFRA, reported as infra
// (questions-18): preflight resolves it BEFORE spawning — a failed
// spawn returns ok:false (never "pid -1 owns the review"), and the
// async 'error' listener is armed anyway so a post-preflight failure
// cannot crash the caller as an unhandled event.
export type SpawnedSupervisor = { ok: true; pid: number; logPath: string } | { ok: false; why: string }

export function spawnSupervisor(opts: { brief: string; cwd: string; logPath: string; bin?: string }): SpawnedSupervisor {
  const bin = opts.bin ?? process.env.WHL_SUPERVISOR_BIN ?? "opencode"
  const onPath = (process.env.PATH ?? "").split(":").some((d) => existsSync(join(d, bin)))
  const present = bin.includes("/") ? existsSync(bin) : onPath
  if (!present) return { ok: false, why: `supervisor bin '${bin}' not found (WHL_SUPERVISOR_BIN or PATH)` }
  mkdirSync(dirname(opts.logPath), { recursive: true })
  const fd = openSync(opts.logPath, "a")
  const child = spawn(bin, ["run", "--standalone", opts.brief], {
    cwd: opts.cwd,
    detached: true, // submit-pr returns now; the supervisor outlives it BY DESIGN
    stdio: ["ignore", fd, fd],
  })
  child.on("error", () => {}) // preflight raced: the fd-holding caller reports via log silence instead of a crash
  child.unref()
  if (typeof child.pid !== "number" || child.pid <= 0) return { ok: false, why: `spawn returned pid ${child.pid}` }
  return { ok: true, pid: child.pid, logPath: opts.logPath }
}

// ---- parent resolution: the commissioner is an agent most of the time
// (2026-10-30, the user's rule: the supervisor is the RARE fallback).
// submit-pr runs inside an agent's shell; the wake should reach THAT
// agent, and only a genuinely parentless terminal mints a supervisor.
// Order of evidence, strongest first:
//   1. the harness itself names the session (OPENCODE_SESSION_ID — the
//      cleanest field, exported the day opencode does)
//   2. herdr names the pane's agent (API field, never pane scraping):
//      only when THIS pane runs an opencode agent is the session list
//      trusted — herdr's liveness word replaces a freshness window
//      (a window on `updated` breaks long turns; `updated` ticks per
//      turn, not per tool call), and the directory-ancestor check
//      keeps the wake inside the commissioning project. COWORKER LAW:
//      a whl fan-out puts SEVERAL live sessions in one project —
//      "newest" stops being identity when the runner-up is equally
//      fresh, and binding then GUESSES the commissioner (a
//      wrong-owner wake violates the one-wake law worse than minting
//      a supervisor). The newest binds only when it is decisively
//      newest: every other session in the project must be quiet.
//   anything else → null → the supervisor (rare by construction)
export type Caller = { from: string; via: string }

const COWORKER_QUIET_MS = 10 * 60 * 1000

const runJson = (bin: string, args: string[], cwd: string, timeout = 15_000): unknown => {
  try {
    return JSON.parse(execFileSync(bin, args, { cwd, encoding: "utf8", timeout }))
  } catch {
    return null
  }
}

export function resolveCaller(cwd: string, opts: { env?: Record<string, string>; now?: number } = {}): Caller | null {
  const env = opts.env ?? process.env
  // 1. the harness said who we are — final, no guessing
  const self = env.OPENCODE_SESSION_ID
  if (self) return { from: `opencode:${self}`, via: "env OPENCODE_SESSION_ID" }
  // 2. herdr's word for THIS pane + the project's newest session
  if (env.HERDR_ENV === "1" && env.HERDR_PANE_ID) {
    const herdrBin = env.WHL_HERDR_BIN ?? "herdr"
    const ocBin = env.WHL_OPENCODE_BIN ?? "opencode"
    const info = runJson(herdrBin, ["agent", "get", env.HERDR_PANE_ID], cwd) as
      | { result?: { agent?: { agent?: string } } }
      | null
    if (info?.result?.agent?.agent === "opencode") {
      const list = runJson(ocBin, ["session", "list", "--format", "json", "-n", "5"], cwd) as
        | Array<{ id: string; directory: string; updated: number }>
        | null
      if (Array.isArray(list) && list.length > 0) {
        const under = (dir: string) => cwd === dir || cwd.startsWith(`${dir}/`)
        const matching = list.filter((s) => under(s.directory))
        const hit = matching[0] // newest-first
        const now = opts.now ?? Date.now()
        const busySibling = matching.slice(1).find((s) => now - (s.updated ?? 0) < COWORKER_QUIET_MS)
        if (hit && !busySibling) {
          const ageS = Math.max(0, Math.round((now - (hit.updated ?? 0)) / 1000))
          return { from: `opencode:${hit.id}`, via: `herdr pane ${env.HERDR_PANE_ID} runs opencode; newest session in project, siblings quiet (updated ${ageS}s ago)` }
        }
      }
    }
  }
  return null
}

