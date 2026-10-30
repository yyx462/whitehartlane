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
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { sessionsRoot } from "../adapters/store.ts"

// POSIX single-quote escaping for the watcher's own spelling
const shq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

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
    `2. STAY ALIVE until the commission resolves — your process IS the watch. Keep a FOREGROUND blocking wait for the commission's END, BOUNDED BY ITS OWN SPELL (a counted deadline, so the never-lands arc can still reach steps 4 and 7): V=<the staged ${runDir}/data/review/merge.json — the staged tree's data/review/merge.json, the MERGE seat, written by the chain's LAST stage>; i=0; until [ -f "$V" ]; do sleep 15; i=$((i+1)); [ "$i" -ge 480 ] && break; done — 480 x 15s is the 7200s deadline. Wait on NOTHING EARLIER: the verdict is written three stages before the end, and a supervisor that wakes on it posts a receipt before the feedback map exists and announces a merge that has not run (the 2026-10-30 twin-seat lesson: the brief and the watcher are two answers to ONE question — this is the seat they share). Do NOT end your turn with nothing pending; a supervisor that exits early abandons the commission (the receipt: the first live supervisor died exactly this way and PR #259 went silent).`,
    `3. The merge seat's payload names the outcome (accept/reject/refused). The FINDINGS for the receipt live in the job's own record: the levy's stdout names the job it booked (a line like 'job: j-XXXX'); that job's run dir — pattern ${sessionsRoot()}/*/jobs/<jid>/run — carries the verdict file and the feedback/ map. Resolve <jid> from the levy output and read them from there (and from the staged dir's review folder beside the seat).`,
    `4. When the wait ends, read the outcome. If the seat exists (or its payload reached the job run dir): go to step 5. If the seat is ABSENT after the deadline (no outcome — the inner door refused, or infra failed): the levy carried --pr so its skip receipt may already be on PR #${pr}; post ONE comment yourself naming the outcome and the levy's printed reason — the PR is NEVER left silent.`,
    `5. Write ${runDir}/supervisor-comment.md, then post it as ONE comment on PR #${pr}: cd ${q(repo)} && gh pr comment ${pr} --body-file ${runDir}/supervisor-comment.md — the outcome, each blocked finding (id, severity, claim, location.file) if any, and the feedback pointers from the job run dir's feedback/MAP.md when it exists.`,
    `6. accept: the rail's merge command already merged the PR (the seat's payload is written AFTER the merge ran) — do NOT merge again. reject: do NOT merge, do NOT fix anything, do NOT re-run the review — the authors own the fixes.`,
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

// mint the owner: a detached WATCHER that runs the supervisor agent
// and outlives it (2026-10-30, momentum-905). "pid N owns the review"
// is a claim about a LIVE process: an agent that dies at once (no
// auth, no model, a bad flag) left the PR unreviewed AND unreported,
// because the 2h timeout lived INSIDE the agent. The watcher is the
// watch: it runs the agent, waits for the verdict at the seat the door
// PROMISED (the staged dir's link into the job's run dir), and reports
// the silence itself when the deadline passes — so the commission is
// watched even when its agent is not.
export function spawnSupervisor(opts: {
  brief: string
  cwd: string
  logPath: string
  bin?: string
  outDir?: string
  pr?: string
  repo?: string
}): SpawnedSupervisor {
  const bin = opts.bin ?? process.env.WHL_SUPERVISOR_BIN ?? "opencode"
  // BOX-IN-BOX, this seat too (principles-4003): the orchestrator's
  // spawn refuses to book a real workflow from inside a review job —
  // the --auto supervisor is a REAL headless agent, and a review run
  // that mints one books a worker from inside a review job
  // (reviewer-spawned reviewer panes). One law, both seats.
  if (process.env.AGENTIC_OS_JID) {
    return { ok: false, why: `box-in-box: this process runs inside review job ${process.env.AGENTIC_OS_JID} — a review run may not book another real workflow (the orchestrator seat refuses it too)` }
  }
  const onPath = (process.env.PATH ?? "").split(":").some((d) => existsSync(join(d, bin)))
  const present = bin.includes("/") ? existsSync(bin) : onPath
  if (!present) return { ok: false, why: `supervisor bin '${bin}' not found (WHL_SUPERVISOR_BIN or PATH)` }
  mkdirSync(dirname(opts.logPath), { recursive: true })
  // the brief travels in a FILE — the watcher reads it (a brief with
  // quotes in it must not break the watcher's own spelling)
  const briefPath = `${opts.logPath}.brief`
  writeFileSync(briefPath, opts.brief)
  const outDir = opts.outDir ?? opts.cwd
  const wrapperPath = `${opts.logPath}.watch`
  writeFileSync(
    wrapperPath,
    [
      "#!/bin/sh",
      `# the ship watcher (momentum-905): the watch outlives the agent`,
      `BIN=${shq(bin)}`,
      `BRIEF=$(cat ${shq(briefPath)})`,
      `LOG=${shq(opts.logPath)}`,
      `OUT=${shq(outDir)}`,
      `PR=${shq(opts.pr ?? "")}`,
      `REPO=${shq(opts.repo ?? "")}`,
      // the MINTING door runs the levy (momentum-907): a bare "whl"
      // on PATH may be an OLD install that knows none of this
      // hand-down (--roster, --pr, the pinned shas) — the reviewed
      // repo's own bin comes first, so the door that minted the
      // commission is the door that runs it
      `export PATH="${opts.repo ? `${opts.repo}/bin:` : ""}$PATH"`,
      `"$BIN" run --standalone "$BRIEF" >>"$LOG" 2>&1 &`,
      `AGENT=$!`,
      // the JOB's run dir — the seat link points into it (the verdict
      // lands there; the commission ENDS with the job's report)
      `RUN=""`,
      `[ -L "$OUT/data/review/verdict.json" ] && RUN=$(readlink "$OUT/data/review/verdict.json" 2>/dev/null | sed 's#/data/review/verdict.json$##')`,
      `i=0`,
      // THE SEAT (principles-4004): the commission ends with the MERGE
      // stage — the merge stage writes the outcome marker into the
      // staged program dir, and the watcher waits on exactly that.
      // The verdict (prove) lands two stages earlier; waiting on it
      // would speak before the feedback map exists.
      `while [ ! -f "$OUT/data/review/merge.json" ]; do`,
      `  sleep 1; i=$((i+1))`,
      // a chain that died BEFORE the merge stage (the divide stage
      // failed, the rail refused) leaves a verdict and no marker — the
      // PR must still hear (momentum-908), so the verdict's presence
      // ends the wait too (a POSITIVE test, not a poll: the law is
      // about the seat the wait resolves on)
      // THE GONE-WORLD EXIT (the zombie-watcher receipt, 2026-10-30):
      // a watcher whose staged dir was deleted (a test's tmp dir, a
      // cancelled round) has NOTHING to watch and NOBODY to tell —
      // exit quietly, never ride the deadline to a notify nobody wants
      `  if [ ! -d "$OUT" ]; then exit 4; fi`,
      `  if [ -f "$OUT/data/review/verdict.json" ] && ! kill -0 "$AGENT" 2>/dev/null; then break; fi`,
      `  if [ "$i" -ge 7200 ]; then`,
      `    if [ -n "$PR" ] && command -v gh >/dev/null 2>&1; then`,
      `      (cd "$REPO" && gh pr comment "$PR" --body "ship-gate: the review timed out (2h) — no outcome landed at $OUT/data/review/merge.json") >/dev/null 2>&1`,
      `    fi`,
      // the notify only fires with a PR to name — a nameless timeout
      // DM is noise (the receipt: "PR # review timed out")
      `    if [ -n "$PR" ] && command -v notify >/dev/null 2>&1; then notify "ship-gate" "PR #$PR review timed out — the watcher is the last word" >/dev/null 2>&1; fi`,
      `    exit 3`,
      `  fi`,
      `done`,
      // the BACKSTOP receipt (momentum-908): if the agent never posted
      // (it died at once), the PR still hears — the watcher is the last
      // word. The OUTCOME comes from the seat: the merge marker when
      // the chain reached it, else the verdict itself (a chain that
      // died before merge still judged — principles-5002: "unknown"
      // was a FABRICATED outcome)
      `if test -f "$OUT/supervisor-comment.md"; then :; elif [ -n "$PR" ] && command -v gh >/dev/null 2>&1; then`,
      `  V=$(sed -n 's/.*"outcome"[^"]*"\\([a-z]*\\)".*/\\1/p' "$OUT/data/review/merge.json" 2>/dev/null | head -1)`,
      `  if [ -z "$V" ]; then`,
      `    V=$(sed -n 's/.*"verdict"[^"]*"\\([a-z]*\\)".*/\\1/p' "$OUT/data/review/verdict.json" 2>/dev/null | head -1)`,
      `  fi`,
      `  (cd "$REPO" && gh pr comment "$PR" --body "ship-gate: \${V:-unfinished} — the supervisor did not post; the outcome is at $OUT/data/review/merge.json") >/dev/null 2>&1`,
      `fi`,
      `exit 0`,
      "",
    ].join("\n"),
  )
  const fd = openSync(opts.logPath, "a")
  const child = spawn("sh", [wrapperPath], {
    cwd: opts.cwd,
    detached: true, // submit-pr returns now; the watcher outlives it BY DESIGN
    stdio: ["ignore", fd, fd],
  })
  child.on("error", () => {}) // preflight raced: the fd-holding caller reports via log silence instead of a crash
  child.unref()
  if (typeof child.pid !== "number" || child.pid <= 0) return { ok: false, why: `spawn returned pid ${child.pid}` }
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const until = Date.now() + 400
  while (Date.now() < until) {
    if (!alive(child.pid)) return { ok: false, why: `the watcher died at once (pid ${child.pid}) — nothing would watch the commission` }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40)
  }
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
//      keeps the wake inside the commissioning project. COWORKER LAW
//      (momentum-1, sharpened round 5): "newest" is NEVER identity —
//      the commissioner's own long turn looks quiet while a sibling
//      ticks, so recency guesses the wrong owner exactly when it
//      matters. Tier 2 binds ONLY by uniqueness: exactly ONE session
//      in the project — no siblings to confuse, no ordering to trust.
//      Two or more candidates, fresh or stale → null → the supervisor
//      (a minted owner beats a guessed one, always).
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
      // The window must be BIG enough to prove uniqueness (momentum-904,
      // tests-1): the uniqueness law is decided over the list the CLI
      // returns — a five-item window hides a sixth session, and a
      // project with two sessions then reads as one (a guessed owner
      // labeled "the project's ONLY session"). A WINDOW THAT FILLED UP
      // is a truncated view: uniqueness is unproven → refuse (the
      // supervisor is the honest answer).
      const list = runJson(ocBin, ["session", "list", "--format", "json", "-n", "200"], cwd) as
        | Array<{ id: string; directory: string; updated: number }>
        | null
      if (Array.isArray(list) && list.length > 0 && list.length < 200) {
        const under = (dir: string) => cwd === dir || cwd.startsWith(`${dir}/`)
        const matching = list.filter((s) => under(s.directory))
        // identity by UNIQUENESS, never by order or recency (momentum-1):
        // one candidate is provably the commissioner's project session;
        // two or more is a guess, and a guessed wake owner is the exact
        // wrong-owner wake this tier exists to prevent
        if (matching.length === 1) {
          const hit = matching[0]
          const now = opts.now ?? Date.now()
          const ageS = Math.max(0, Math.round((now - (hit.updated ?? 0)) / 1000))
          return { from: `opencode:${hit.id}`, via: `herdr pane ${env.HERDR_PANE_ID} runs opencode; the project's ONLY session (updated ${ageS}s ago)` }
        }
      }
    }
  }
  return null
}

