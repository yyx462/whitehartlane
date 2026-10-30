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
import { openSync } from "node:fs"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

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
    `2. When it finishes, read the verdict at ${runDir}/data/review/verdict.json.`,
    `3. Write ${runDir}/supervisor-comment.md, then post it as ONE comment on PR #${pr}: cd ${q(repo)} && gh pr comment ${pr} --body-file ${runDir}/supervisor-comment.md`,
    `   The comment carries: the verdict (accept/reject), each blocked finding (id, severity, claim, location.file) if any, and the feedback pointers from ${runDir}/feedback/MAP.md when it exists.`,
    `4. accept: the rail's merge command already merged the PR — do NOT merge again. reject: do NOT merge, do NOT fix anything, do NOT re-run the review — the authors own the fixes.`,
    `5. Write one line to ${runDir}/supervisor-result.md (verdict + PR number). Then STOP — your commission is complete.`,
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
// caller can tail. The caller prints the log path — the supervisor is
// never silent, even when it fails to start.
export function spawnSupervisor(opts: { brief: string; cwd: string; logPath: string; bin?: string }): { pid: number; logPath: string } {
  const bin = opts.bin ?? process.env.WHL_SUPERVISOR_BIN ?? "opencode"
  mkdirSync(dirname(opts.logPath), { recursive: true })
  const fd = openSync(opts.logPath, "a")
  const child = spawn(bin, ["run", "--standalone", opts.brief], {
    cwd: opts.cwd,
    detached: true, // submit-pr returns now; the supervisor outlives it BY DESIGN
    stdio: ["ignore", fd, fd],
  })
  child.unref()
  return { pid: child.pid ?? -1, logPath: opts.logPath }
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
//      keeps the wake inside the commissioning project
//   anything else → null → the supervisor (rare by construction)
export type Caller = { from: string; via: string }

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
        const hit = list.find((s) => under(s.directory))
        if (hit) {
          const ageS = Math.max(0, Math.round(((opts.now ?? Date.now()) - (hit.updated ?? 0)) / 1000))
          return { from: `opencode:${hit.id}`, via: `herdr pane ${env.HERDR_PANE_ID} runs opencode; newest session in project (updated ${ageS}s ago)` }
        }
      }
    }
  }
  return null
}

