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
