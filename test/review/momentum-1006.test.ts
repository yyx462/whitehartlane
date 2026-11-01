// momentum-1006 — the OVERRIDE merge door's base half.
//
// `whl ship` is the SECOND merge site (the fixer overruling a reject).
// Its own comment claims it keeps merge.sh's base guard:
//
//   "THE BASE'S HALF (principles-45 / questions-34): this door is a
//    SECOND merge site, and until now it kept only the HEAD half of
//    merge.sh's drift guards — a base that moved during the review
//    lands unreviewed commits inside the accepted override merge,
//    the exact case merge.sh refuses (principles-108)."
//
// merge.sh keeps TWO parts of that guard:
//   (1) the base must be NAMEABLE — "A base we cannot NAME (BASE_BRANCH
//       empty or sha-like, questions-30) cannot be verified at all —
//       refuse rather than merge blind."
//   (2) the named base must still point at the sha the review judged.
//
// `whl ship` implements only (2). With a base passed as a SHA, (2)
// compares the sha with itself — a sha never moves — so the guard is
// VACUOUS: the door believes it verified a base it never checked, and
// a trunk that moved during the review lands unreviewed commits
// inside the override merge.
//
// The repro drives the real door twice on ONE repo whose trunk moved
// after the review:
//   run A  --base main   → the base is NAMED  → the door refuses (correct)
//   run B  --base <sha>  → the base is NOT NAMED → the door MERGES (bug)
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("whl ship: a base that cannot be NAMED must refuse the override merge (merge.sh's rule, kept)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-base-"))
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
    const judged1 = g("rev-parse HEAD").trim()
    // the fix after round 1's rejection — the honest round 2 is a
    // rejection of FIXED bytes (momentum-9201: two verdicts at ONE head
    // are one round; a re-levy is not good faith)
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false // fix\n")
    g("add -A && git commit -qm fix")
    const headSha = g("rev-parse HEAD").trim()

    // TWO reject rounds on TWO heads (the good-faith floor is 2) and the
    // verdict names the base it judged — the real rail verdict shape.
    for (const [sid, head, ago] of [["s-r1", judged1, 60], ["s-r2", headSha, 0]] as const) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      const vf = join(dir, "verdict.json")
      writeFileSync(
        vf,
        JSON.stringify({
          verdict: "reject",
          repo,
          base: baseSha,
          head,
          blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
        }),
      )
      const t = Date.now() / 1000 - ago // stagger mtimes: the store orders rows by mtime
      utimesSync(vf, t, t)
    }

    // THE TRUNK MOVED after the review: an unreviewed commit on main.
    g("checkout -q main")
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add -A && git commit -qm 'unreviewed trunk commit'")
    const movedBase = g("rev-parse main").trim()
    g("checkout -q feat")
    assert.notEqual(movedBase, baseSha, "the trunk really moved since the review")

    // a gh stub: the PR's remote head is the judged head; comments record
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
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement — the reviewer sees the diff, the owner knows the intent" }))

    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      PATH: `${tmp}:${process.env.PATH}`,
    }
    const mergeCmd = `echo merged >> ${JSON.stringify(mergeMarker)}`
    const ship = (base: string) =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", BIN, "ship", repo, "--pr", "42", "--overrule", overrule, "--head", "feat", "--base", base, "--merge-cmd", mergeCmd],
        { env, encoding: "utf8", timeout: 60_000 },
      )

    // run A — the base is NAMED (a branch). The trunk moved → the door
    // must refuse. This is the twin's behaviour and it holds on HEAD.
    const named = ship("main")
    assert.notEqual(named.status, 0, `a moved, NAMED base must refuse (stdout: ${named.stdout}\nstderr: ${named.stderr})`)
    assert.match(named.stderr, /base main moved/, `the refusal names the moved base (stderr: ${named.stderr})`)
    assert.ok(!existsSync(mergeMarker), "no merge happened on the named-base run")

    // run B — the SAME repo, the SAME moved trunk, but the base is passed
    // as a SHA: it cannot be named, so its drift cannot be verified.
    // merge.sh refuses exactly this base ("the base cannot be named …
    // its drift cannot be verified; refusing"); the override door must
    // refuse it too instead of merging.
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
