import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BIN = join(ROOT, "bin", "whitehartlane")

// BASE shape: the gate→door roster handoff is this diff's own addition —
// on BASE there is no gate, no roster, no handoff (nothing to judge).
if (!readFileSync(BIN, "utf8").includes("gateRoster")) {
  test("principles-41: BASE — no gate roster handoff, nothing to judge", () => {})
} else {
  // A FIVE-unit review template — legal via the first-class --template
  // flag; the shipped pr-review template with one operator unit added
  // to the lens roster (contract/docs ride along so the bin's admission
  // check passes).
  function templateDir(where: string): string {
    cpSync(join(ROOT, "templates", "pr-review"), where, { recursive: true })
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "p41"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        "units = [",
        `  { id = "principles", brief = "p" },`,
        `  { id = "tests", brief = "t" },`,
        `  { id = "momentum", brief = "m" },`,
        `  { id = "questions", brief = "q" },`,
        `  { id = "summarize", brief = "s" },`,
        "]",
        "",
      ].join("\n"),
    )
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(where, doc), "# seed\n")
    }
    return where
  }

  function fixtureRepo(where: string): string {
    const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
    mkdirSync(join(where, "src"), { recursive: true })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(where, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")
    return where
  }

  const unitIds = (tomlPath: string): string[] => {
    const parsed = parseToml(readFileSync(tomlPath, "utf8")) as {
      stage?: Array<{ units?: Array<{ id?: string }> }>
    }
    return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
  }

  test("the bin hands the gate's roster to the door — the door's set-difference law, retired lens included", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p41-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = templateDir(join(tmp, "tpl"))

      // ── PREMISE (the door half of the decision): handed the gate's
      // four-lens roster over this five-unit template, the door strips
      // to exactly the roster — its set-difference law (the diff's own
      // tests-5001 fix: "does this roster name fewer units than the
      // template DECLARES?" answered against the template's parse).
      const doorDir = join(tmp, "door-dir")
      const door = prepareReview(
        { repo, base: "master", head: "feat", out: doorDir, template: tpl, roster: ["principles", "tests", "momentum"] },
        join(ROOT, "templates"),
      )
      assert.ok(
        door.ok && !("skipped" in door && door.skipped),
        `premise: the door materializes the handed roster: ${JSON.stringify(door).slice(0, 200)}`,
      )
      assert.deepEqual(
        unitIds(join((door as { dir: string }).dir, "workflow.toml")).sort(),
        ["momentum", "principles", "tests"],
        "premise: handed the roster, the door materializes ONLY the rostered lenses — summarize AND the retired questions unit strip",
      )

      // ── THE BIN half: the same gate decision (jev down → fail-safe
      // full rail → roster = the four lenses, length 4) arriving through
      // the bin. The bin hands the roster to the door only when
      // `g.decision.roster.length < 4` — a length-4 roster is never
      // handed — so the door runs with roster=undefined and
      // materializes every template unit.
      const r = spawnBin(repo, tpl, out, tmp)
      assert.equal(r.status, 0, `sanity: the bin review completed: ${r.stdout}\n${r.stderr}`)
      assert.match(r.stdout, /gate: review/, "sanity: the gate decided review (fail-safe full rail — jev down)")
      assert.match(r.stdout, /principles, tests, momentum/, "sanity: the gate's receipt names the full three-lens roster")
      assert.deepEqual(
        unitIds(join(out, "workflow.toml")).sort(),
        ["momentum", "principles", "tests"],
        `INV-3/INV-4 (reworked for the three-lens roster, 2026-11-05): the bin hands every ` +
          `non-empty decision roster to the door (the old length-4 magic constant is gone) and the ` +
          `door's set-difference strips BOTH the un-rostered summarize unit AND the retired ` +
          `questions unit — with jev down (fail-safe full rail = [principles, tests, momentum]) ` +
          `over this FIVE-unit template, the materialized program carries exactly the decision's ` +
          `[${unitIds(join(out, "workflow.toml")).sort().join(", ")}]: no lens the gate never ` +
          `named ever runs, and a retired lens cannot resurrect through the template.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  function spawnBin(repo: string, tpl: string, out: string, tmp: string): { status: number; stdout: string; stderr: string } {
    try {
      const r = execFileSync(
        process.execPath,
        [BIN, "review", repo, "--base", "master", "--head", "feat", "--out", out, "--template", tpl],
        {
          encoding: "utf8",
          timeout: 120_000,
          env: {
            ...process.env,
            AGENTIC_OS_HOME: join(tmp, "home"),
            WHL_GATE_LEDGER: join(tmp, "home", "gate.jsonl"),
            WHL_JEV_BIN: join(tmp, "no-such-jev"), // jev down → fail-safe full rail, deterministic
            AGENTIC_OS_NOTIFY: "0",
          },
        },
      )
      return { status: 0, stdout: r, stderr: "" }
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(err) }
    }
  }
}
