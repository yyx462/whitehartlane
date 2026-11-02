// tests-10507 — merge.sh's "NO WITNESS, NO MERGE" law, the arm the
// diff adds:
//
//   "NO WITNESS, NO MERGE (tests-10301 / tests-20002): a HEAD_BRANCH
//   that is empty — or a legacy config holding the judged SHA itself,
//   which answers its own question forever — means the door could not
//   name the reviewed branch; the local arm cannot verify, so the PR's
//   remote head becomes the ONLY witness, and without a PR number the
//   accept refuses rather than merge a branch nobody can prove still
//   holds the judged bytes."
//
// The remote head is the ONLY witness, but the check that reads it is
// wrapped in `command -v gh` — so when gh is not installed the only
// witness silently disappears and the accept proceeds with nothing
// having proved the branch still holds the judged bytes.
//
// Its twin — the diff's own `whl ship` door — refuses in exactly this
// situation (an unreadable PR head is "unverified is unmerged"), so
// the two merge sites answer the same question two different ways.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MERGE_SH = join(import.meta.dirname, "..", "..", "templates", "pr-review", "hooks", "merge.sh")

const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

test("merge.sh: with no nameable branch and no gh, the accept has NO witness and must refuse", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-merge-nowitness-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    const base = g("rev-parse main").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm feat")
    const head = g("rev-parse HEAD").trim()

    const dir = join(tmp, "prog")
    mkdirSync(join(dir, "hooks"), { recursive: true })
    mkdirSync(join(dir, "data", "review"), { recursive: true })
    writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(MERGE_SH, "utf8"))
    const marker = join(tmp, "merged.txt")
    writeFileSync(
      join(dir, "data", "review", "config.sh"),
      [
        `REPO=${sq(repo)}`,
        `BASE_BRANCH=${sq("main")}`,
        `BASE_SHA=${sq(base)}`,
        // the door could not name the reviewed branch (no local witness)
        `HEAD_BRANCH=${sq("")}`,
        `HEAD_SHA=${sq(head)}`,
        `TITLE=${sq("t")}`,
        `MERGE_CMD=${sq(`echo merged >> ${marker}`)}`,
        `PR_NUM=${sq("42")}`,
        "",
      ].join("\n"),
    )
    writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))

    // a PATH with git-less gh: the remote head cannot be read because
    // the tool that reads it is not installed
    const noGhDir = join(tmp, "nog")
    mkdirSync(noGhDir, { recursive: true })
    symlinkSync(process.execPath, join(noGhDir, "node"))

    const r = spawnSync("bash", [join(dir, "hooks", "merge.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${noGhDir}:/usr/bin:/bin` },
    })
    assert.notEqual(
      r.status,
      0,
      `NO WITNESS, NO MERGE: nothing could prove the branch still holds the judged bytes, so the accept must refuse (stderr: ${r.stderr})`,
    )
    assert.ok(!existsSync(marker), "nothing merged without a witness")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
