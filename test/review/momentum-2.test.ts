import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (claims are honest): the new `whl review --help` hard rule says
// "--model is REQUIRED as provider/model ... (bare ids are refused)".
// No site refuses one: the door writes args.model verbatim into
// workflow.toml (src/doors/review.ts), and the host's splitModel
// mangles a bare id (indexOf("/") === -1) into provider "claude-" with
// id "claude-3" (src/adapters/store.ts) — the spawn then dies at the
// provider, four lenses late. Drive the door with a bare id: the
// manual promises a refusal; the door must deliver it.
test("the door refuses a bare --model id, as the manual claims", () => {
  const bin = readFileSync(join(ROOT, "bin", "whitehartlane"), "utf8")
  if (!bin.includes("bare ids are refused")) return // BASE: the manual makes no such claim
  const repo = mkdtempSync(join(tmpdir(), "whl-momentum-repo-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-momentum-out-"))
  const out = join(outRoot, "program") // must NOT exist beforehand: the door refuses an existing non-program dir
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

    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "claude-sonnet-4", out },
      join(ROOT, "templates"),
    )
    const why = (ready as { why?: string }).why
    const refused = !ready.ok && /model/i.test(String(why ?? ""))
    assert.ok(
      refused,
      `INV-4: the manual's hard rule promises bare model ids are refused, but the door accepted ` +
        `--model claude-sonnet-4 (ok=${ready.ok}, why=${why ?? "n/a"}) — the change's own claim is false`,
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
