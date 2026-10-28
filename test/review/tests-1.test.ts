import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one function per decision) / INV-4 (claims are honest):
// "was a model supplied?" is decided TWICE in src/doors/review.ts with
// two different predicates: the format check and the missing-model
// check treat `model === ""` differently.
//   - review.ts:71  `if (args.model && !regex)`        — "" is FALSY  → no format check
//   - review.ts:133 `hasModel = typeof args.model === "string" || …` — "" is a STRING → "model supplied"
//   - review.ts:163 `if (args.model)`                  — "" is FALSY  → no pin written
// Net on HEAD: `whl review <repo> --model ""` (an unset env var: the
// classic `--model "$WHL_MODEL"`) materializes a program whose
// workflow.toml keeps the template's temperature pins with NO model —
// every lens spawn is then refused by the host ("temperature … has no
// model to pin against — refusing spawn", src/adapters/opencode-host.ts:95).
// That is the exact four-lenses-late death the diff's own help text
// promises cannot happen ("--model is REQUIRED … bare ids are refused").
// BASE refused this input (the removed else-branch, base review.ts:147,
// caught "" via truthiness → hasTempPin && !hasModel → refuse, code 2),
// so the hole is INTRODUCED by this change. The repo's own twin at
// src/engines/coworker.ts:43 (`model !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(model)`)
// also refuses "" — the door is now the one site that lets it through.
test("an empty --model is refused at the door, not materialized into a dead program", () => {
  const repo = mkdtempSync(join(tmpdir(), "whl-tests1-repo-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-tests1-out-"))
  const out = join(outRoot, "program") // must NOT exist beforehand
  try {
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(repo, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    mkdirSync(join(repo, "src"), { recursive: true })
    writeFileSync(join(repo, "src", "app.ts"), "export const one = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    const r = prepareReview(
      // the CLI reachability: `whl review <repo> --model ""` — val("model")
      // hands the empty argv string straight through (bin/whitehartlane)
      { repo, base: "master", head: "feat", model: "", out },
      join(ROOT, "templates"),
    )
    assert.equal(
      r.ok,
      false,
      `INV-3/INV-4: an empty --model must be refused at the door. The door's two "was a model ` +
        `supplied?" predicates disagree on "": review.ts:133 (typeof === "string") says supplied, ` +
        `review.ts:71/163 (truthiness) say absent — the program materializes with temperature pins ` +
        `and no model, and every lens spawn dies at src/adapters/opencode-host.ts:95 ("no model to ` +
        `pin against — refusing spawn"), the exact late death the help's hard rule refuses at the door. ` +
        `BASE refused this input (base review.ts:147); HEAD materialized it: ${JSON.stringify(r)}`,
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
