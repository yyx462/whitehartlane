import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (the suite's green is a verdict) + INV-3 (a decision answered two
// opposite ways): this diff widens `npm test` to the whole tree
// (package.json:36, quoted "test/**/*.test.ts") and its own tests-8 states
// the law — "a change that widens what the suite runs ships either a green
// suite or a named exclusion — not a red `npm test`". Meanwhile the same
// diff rewrites skills/yyx-whl/SKILL.md to make the user-level skill
// library OPTIONAL ("On machines where the user-level skill library is
// installed … Where it is absent, the two lines above ARE the contract")
// — and ships test/review/principles-3.test.ts, which asserts UNCONDITIONALLY
// that every **yyx-…** reference in SKILL.md resolves in a skill home under
// $HOME. On any machine without that library (a fresh clone, CI without the
// user's dotfiles — exactly the state SKILL.md names as supported), the
// widened `npm test` exits nonzero on this diff's own file. One decision —
// "is the skill library's absence a legal machine state?" — answered YES by
// SKILL.md and NO by the adopted repro. This repro isolates HOME to an empty
// directory and demands the reference check stay green there; it fails on
// HEAD (yyx-ship resolves nowhere) and passes on BASE (no **yyx-…** refs
// exist in BASE's SKILL.md — the reference, and the redness, are introduced
// by this change).
test("the widened suite stays green where SKILL.md itself says the skill library is absent", () => {
  const emptyHome = mkdtempSync(join(tmpdir(), "whl-p7-nohome-"))
  try {
    // the reference-resolution check exactly as principles-3.test.ts runs
    // it, under a HOME with no skill library (os.homedir() reads $HOME on
    // POSIX per call)
    const probe = `
      const fs = require("node:fs")
      const os = require("node:os")
      const path = require("node:path")
      const assert = require("node:assert/strict")
      const skill = fs.readFileSync(path.join("skills", "yyx-whl", "SKILL.md"), "utf8")
      const refs = [...skill.matchAll(/\\*\\*(yyx-[a-z0-9-]+)\\*\\*/g)].map((m) => m[1])
      if (refs.length === 0) process.exit(0) // BASE shape: no cross-skill references
      const homes = [
        "skills",
        path.join(os.homedir(), ".config", "opencode", "skills", "yyxSkills"),
        path.join(os.homedir(), ".config", "opencode", "skills"),
        path.join(os.homedir(), ".claude", "skills"),
      ]
      for (const ref of refs) {
        const found = homes.some((h) => fs.existsSync(path.join(h, ref, "SKILL.md")))
        assert.ok(found, \`skill '\${ref}' resolves in no home under HOME=\${os.homedir()}\`)
      }
    `
    let child = { status: 0, stdout: "", stderr: "" }
    try {
      child.stdout = execFileSync(
        process.execPath,
        ["-e", probe],
        { cwd: ROOT, encoding: "utf8", env: { ...process.env, HOME: emptyHome } },
      )
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      child = { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
    }
    assert.equal(
      child.status,
      0,
      `INV-4/INV-3: the diff widens \`npm test\` over its own test/review/ suite and its SKILL.md rewrite makes ` +
        `the user-level skill library OPTIONAL ("Where it is absent, the two lines above ARE the contract"), ` +
        `but the same diff ships test/review/principles-3.test.ts asserting UNCONDITIONALLY that every **yyx-…** ` +
        `reference in SKILL.md resolves under $HOME — on the library-less machines SKILL.md names as supported, ` +
        `the widened \`npm test\` exits nonzero (probe exit=${child.status}: ${child.stderr.split("\n").slice(0, 2).join(" | ")}). ` +
        `One decision — "is the skill library's absence legal?" — answered YES by skills/yyx-whl/SKILL.md and NO ` +
        `by test/review/principles-3.test.ts: the suite is red on a machine state the change's own doc supports.`,
    )
  } finally {
    rmSync(emptyHome, { recursive: true, force: true })
  }
})
