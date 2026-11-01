// questions-2-base (questions lens, Q2 — one decision, one owner) —
// THE DOOR STILL NAMES THE WRONG BASE BRANCH: the bin's fall-through
// hand-down replaces the caller's `--base <ref>` with the gate's
// resolved SHA, so the door's "the caller's name first" law can never
// fire and the ALPHABETICAL GUESS (branchOf) is what always ships.
//
// What the change does (bin/whitehartlane, the review verb):
//
//   base: gateBaseSha ?? val("base"),
//   head: gateHeadSha ?? val("head"),
//
// `gateBaseSha` is set whenever the gate runs (the default — the gate
// runs unless WHL_GATE=off and no --roster pin), so `base` is a 40-char
// sha on EVERY ordinary run.
//
// What the door then writes (src/doors/review.ts:1110):
//
//   BASE_BRANCH=${shellQuote(args.baseBranch ?? (
//     /^[0-9a-f]{7,40}$/.test(base) ? branchOf(baseSha) ?? "" : base))}
//
// `args.baseBranch` has NO PRODUCER (grep: the only occurrence is the
// type at review.ts:48 and this line — no `--base-branch` flag exists,
// and the bin never passes one), so the sha branch is always taken and
// `branchOf` answers "WHICH branch happens to point at this sha,
// alphabetically first?" — never "the branch the reviewer named".
//
// The change's own claim (src/doors/review.ts:1102-1109) is the
// opposite:
//
//   // the BASE rides as the BRANCH NAME — the CALLER'S name first
//   // (principles-5103 / questions-31): ... The operator's ref IS the
//   // honest name; the guess remains only for callers who passed a
//   // bare sha.
//
// The door's OWN hand-down is what turns the caller's named ref into a
// bare sha — so the "bare sha" case is not the exception, it is every
// run.
//
// THE HARM (templates/pr-review/hooks/merge.sh:137-139, the local
// accept arm):
//
//   git -C "$REPO" checkout -q "$BASE_BRANCH"
//   git -C "$REPO" merge --no-ff --no-edit -m "pr-review: accept ..." "$HEAD_SHA"
//
// The accept checks OUT the named branch and merges the judged head
// INTO it. With the wrong name the accept lands on a sibling branch
// the PR was never based on, the real base branch never advances, and
// merge.sh still prints "merge: accepted — <title> (<sha>) merged".
//
// BASE behaviour: the bin wrote `base: val("base")` — the reviewer's
// own ref verbatim — so BASE names "master" and this assertion PASSES
// there. The change is what introduced the sha hand-down.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const BIN = join(HEAD, "bin", "whitehartlane")

test("the door names the BASE branch the reviewer named, not an alphabetical guess", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q2-base-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(repo, { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init", "-q", "-b", "master", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src.ts"), "export const a = 1\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    // the rename-era shape: main AND master at the SAME base sha —
    // "main" sorts before "master" in `for-each-ref --points-at`
    g("branch", "main")
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-qm", "feat")

    const out = join(tmp, "prog")
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "master", "--head", "feat", "--model", "acme/m", "--out", out],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: tmp,
          WHL_GATE_LEDGER: join(tmp, "ledger.jsonl"),
          WHL_GATE: "on",
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    )
    const cfgPath = join(out, "data", "review", "config.sh")
    assert.ok(
      readFileSync(cfgPath, "utf8").length > 0,
      `the door must materialize the program (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
    )
    const cfg = readFileSync(cfgPath, "utf8")
    const named = cfg.match(/^BASE_BRANCH='(.*)'$/m)?.[1]
    assert.equal(
      named,
      "master",
      `the config must name the base branch the reviewer asked for ("master"), not whichever branch sorts first at the base sha — got '${named}'.\n` +
        `The door's own hand-down (bin/whitehartlane: "base: gateBaseSha ?? val('base')") turns the caller's named ref into a bare sha, and src/doors/review.ts:1110 then answers with the alphabetical guess — the change's own law says "the CALLER'S name first ... the guess remains only for callers who passed a bare sha".\n` +
        `The merge stage checks OUT BASE_BRANCH and merges the judged head INTO it (templates/pr-review/hooks/merge.sh:137-139), so a wrong name lands the accept on a branch the PR was never based on while printing "merge: accepted".\n` +
        `config.sh:\n${cfg}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
