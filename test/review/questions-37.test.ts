// questions-37 (questions lens, Q1/Q2) — THE OVERRIDE MERGE DOOR
// MERGES A BASE IT CANNOT NAME, WHILE THE RAIL'S OWN MERGE STAGE
// REFUSES EXACTLY THAT BASE.
//
// TWO MERGE SITES, ONE DECISION ("may this merge land unreviewed
// bytes?") — this diff ADDS the second one:
//
//   bin/whitehartlane, the `ship` verb (added by this diff):
//     const verdictBase = check.verdict.base ?? ""
//     if (!verdictBase) { ...refuse... }
//     {
//       let trunkNow = ""
//       try { trunkNow = execFileSync("git", ["-C", repoAbs, "rev-parse", `${baseRef}^{commit}`]).trim() }
//       catch { trunkNow = "" }
//       if (trunkNow && trunkNow !== verdictBase) { ...refuse... }
//     }
//
//   templates/pr-review/hooks/merge.sh, the accept arm (the rail's own
//   merge stage — the twin this diff edits):
//     # A base we cannot NAME (BASE_BRANCH empty or sha-like,
//     # questions-30) cannot be verified at all — refuse rather than
//     # merge blind.
//     if [ -z "${BASE_BRANCH:-}" ] || printf '%s' "$BASE_BRANCH" | grep -qE '^[0-9a-f]{7,40}$'; then
//       echo "merge: the base cannot be named ..." >&2
//       exit 1
//     fi
//
// The override door implements only the SECOND half. Pass the base as a
// SHA and the "current tip" it reads IS that SHA — a SHA never moves —
// so the drift guard is VACUOUS: the door believes it verified a base
// it never checked, and a trunk that moved during the review lands
// UNREVIEWED commits inside the accepted override merge.
//
// The diff's own door comment claims the override door keeps merge.sh's
// base guard. It keeps half of it. merge.sh refuses; the override door
// merges.
//
// This is BOTH a Q1 gap and a Q2 twin divergence:
//   · Q2 — the two merge sites answer the same question differently.
//   · Q1 — NO test in the repo (nor in the repo's own adopted
//     test/review/ suite) fails if the override door's guard is
//     removed: I reverted the door's base-drift guard and the door's
//     stale-bytes check and the whole suite stayed green.
//
// The assertion drives the REAL door (bin/whitehartlane) end to end.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("whl ship: a base that cannot be NAMED must refuse the override merge (merge.sh's rule, kept)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q37-unnamed-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const mergeMarker = join(tmp, "merge-happened.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    const baseSha = g("rev-parse main").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm feat")
    const headSha = g("rev-parse HEAD").trim()

    // two reject rounds on this head (the good-faith floor is 2); the
    // verdict names the base it judged — the real rail verdict shape
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({
          verdict: "reject",
          repo,
          base: baseSha,
          head: headSha,
          blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
        }),
      )
    }

    // THE TRUNK MOVED after the review: an unreviewed commit on main
    g("checkout -q main")
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add -A && git commit -qm 'unreviewed trunk commit'")
    const movedBase = g("rev-parse main").trim()
    g("checkout -q feat")
    assert.notEqual(movedBase, baseSha, "the trunk really moved since the review")

    // a gh stub: the PR's remote head IS the judged head; comments record
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;;`,
        `  *) printf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))} ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    )
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))

    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      PATH: `${tmp}:${process.env.PATH}`,
    }
    delete (env as Record<string, string | undefined>).OPENCODE_SESSION_ID
    const mergeCmd = `echo merged >> ${JSON.stringify(mergeMarker)}`
    const ship = (base: string) =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          BIN,
          "ship",
          repo,
          "--pr",
          "42",
          "--overrule",
          overrule,
          "--head",
          "feat",
          "--base",
          base,
          "--merge-cmd",
          mergeCmd,
        ],
        { env, encoding: "utf8", timeout: 60_000 },
      )

    // run A — the base is NAMED (a branch). The trunk moved → the door
    // must refuse. (This arm holds on HEAD; it is the twin.)
    const named = ship("main")
    assert.notEqual(named.status, 0, `a moved, NAMED base must refuse (stdout: ${named.stdout}\nstderr: ${named.stderr})`)
    assert.ok(!existsSync(mergeMarker), "no merge happened on the named-base run")

    // run B — the SAME repo, the SAME moved trunk, but the base is
    // passed as a SHA: it cannot be named, so its drift cannot be
    // verified. merge.sh refuses exactly this base ("the base cannot be
    // named … its drift cannot be verified; refusing"); the override
    // door must refuse it too instead of merging.
    const unnamed = ship(baseSha)
    assert.notEqual(
      unnamed.status,
      0,
      `a base named by a SHA cannot drift, so the drift guard is vacuous — the door must refuse, not merge (stdout: ${unnamed.stdout}\nstderr: ${unnamed.stderr})`,
    )
    assert.ok(
      !existsSync(mergeMarker),
      `the override merge RAN although the base was not nameable — unreviewed trunk commits ride the merge (stdout: ${unnamed.stdout}\nstderr: ${unnamed.stderr})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
