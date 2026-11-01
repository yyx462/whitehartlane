// tests-10403 (tests lens) — THE OVERRIDE MERGE DOOR KEEPS ONLY HALF
// OF merge.sh's BASE GUARD: A BASE THAT CANNOT BE NAMED IS MERGED BLIND.
//
// WHAT THE CHANGE CLAIMS (bin/whitehartlane, the `ship` verb, the base
// half this diff adds):
//
//   // THE BASE'S HALF (principles-45 / questions-34): this door is a
//   // SECOND merge site, and until now it kept only the HEAD half of
//   // merge.sh's drift guards — a base that moved during the review
//   // lands unreviewed commits inside the accepted override merge,
//   // the exact case merge.sh refuses (principles-108).
//   const verdictBase = check.verdict.base ?? ""
//   if (!verdictBase) { ...refuse... }
//   {
//     let trunkNow = ""
//     try { trunkNow = execFileSync("git", ["-C", repoAbs, "rev-parse", `${baseRef}^{commit}`]).trim() }
//     catch { trunkNow = "" }
//     if (trunkNow && trunkNow !== verdictBase) { ...refuse... }
//   }
//
// merge.sh keeps TWO parts of that same guard (the file this diff
// edits, accept arm):
//
//   # A base we cannot NAME (BASE_BRANCH empty or sha-like,
//   # questions-30) cannot be verified at all — refuse rather than
//   # merge blind.
//   if [ -z "${BASE_BRANCH:-}" ] || printf '%s' "$BASE_BRANCH" | grep -qE '^[0-9a-f]{7,40}$'; then
//     echo "merge: the base cannot be named ... refusing" >&2
//     exit 1
//   fi
//   now_base="$(git -C "$REPO" rev-parse --verify "$BASE_BRANCH^{commit}" ...)"
//   if [ "$now_base" != "$BASE_SHA" ]; then ... refuse ... fi
//
// The override door implements only the SECOND part. With the base
// passed as a SHA, the "current tip" it reads IS the sha it compares
// against — a sha never moves — so the guard is VACUOUS: the door
// believes it verified a base it never checked, and a trunk that moved
// during the review lands unreviewed commits inside the override merge.
//
// THE FAULT THIS HUNTS: the two merge sites disagree on the same
// decision ("may this merge land unreviewed bytes?"). The diff's own
// door comment claims the override door keeps merge.sh's base guard;
// it keeps half of it. merge.sh refuses; the override door merges.
//
// INV-3 (one decision, one place — the two merge sites must agree) and
// the change's own claim.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("whl ship: a base that cannot be NAMED must refuse the override merge (merge.sh's rule, kept)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-unnamed-"))
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
        ["--experimental-strip-types", BIN, "ship", repo, "--pr", "42", "--overrule", overrule, "--head", "feat", "--base", base, "--merge-cmd", mergeCmd],
        { env, encoding: "utf8", timeout: 60_000 },
      )

    // run A — the base is NAMED (a branch). The trunk moved → the door
    // must refuse. (This arm holds on HEAD; it is the twin.)
    const named = ship("main")
    assert.notEqual(named.status, 0, `a moved, NAMED base must refuse (stdout: ${named.stdout}\nstderr: ${named.stderr})`)
    assert.ok(!existsSync(mergeMarker), "no merge happened on the named-base run")
    // the twin's refusal NAMES the moved base (the door's own message;
    // on a checkout without the ship verb the door does not exist)
    if (named.stderr.includes("ship:")) {
      assert.match(named.stderr, /base main moved/, `the refusal names the moved base (stderr: ${named.stderr})`)
    }

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
