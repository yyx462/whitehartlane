import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

// INV-3 (one decision, one place) — "is this string a valid provider/model"
// is decided by FOUR sites in this repo, and this diff made them disagree:
//   - src/doors/hooks.ts:619  ([workflow] model)  /^[^/\s]+\/[^/\s]+$/  permissive
//   - src/doors/hooks.ts:134  (member pins)       /^[^/\s]+\/[^/\s]+$/  permissive
//   - src/engines/coworker.ts:43 (member models)  /^[^/\s]+\/[^/\s]+$/  permissive
//   - src/doors/review.ts:128 (NEW MODEL_SHAPE)   id characters only    STRICT
// The three established sites accept every id of the shape provider/model
// with any non-space, non-slash characters — including the standard ollama
// spellings ("ollama/llama3:latest"), which the host consumer handles fine
// (store.ts splitModel splits on the FIRST slash; writeOpencodeModelSettings
// writes provider.ollama.models["llama3:latest"]). The diff's door grammar
// refuses those ids with a prescribed fix — "provider/model (id characters,
// exactly one /)" — that has NO legal spelling for a colon-bearing model:
// `whl review --model ollama/llama3:latest` dead-ends on a model class the
// repo itself accepts and spawns everywhere else. On BASE the door had no
// grammar check and accepted the id verbatim, so the divergence (and the
// dead-end) is introduced by this change.
test("the door's --model grammar agrees with the repo's other provider/model sites", () => {
  // the repo's established grammar, verbatim from hooks.ts:619/134 and coworker.ts:43
  const REPO_GRAMMAR = /^[^/\s]+\/[^/\s]+$/
  const ids = [
    "ollama/llama3:latest", // the standard ollama model-id spelling
    "ollama/qwen2.5-coder:32b", // tag-colon ids are ollama's norm
    "acme/strong", // control: both grammars accept
  ]
  for (const model of ids) {
    assert.ok(REPO_GRAMMAR.test(model), `sanity: ${model} clears the repo's established grammar`)
    const tmp = mkdtempSync(join(tmpdir(), "whl-m7-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const r = prepareReview(
        { repo, base: "master", head: "feat", model, out: join(tmp, "program") },
        join(ROOT, "templates"),
      )
      assert.equal(
        r.ok,
        true,
        `INV-3: the model-id grammar is decided four times and this diff made them disagree. ` +
          `hooks.ts:619 ([workflow] model), hooks.ts:134 (member pins) and coworker.ts:43 (member models) ` +
          `all accept "${model}" (/^[^/\\s]+\\/[^/\\s]+$/), and the host spawns it (store.ts splitModel ` +
          `splits on the first slash; writeOpencodeModelSettings writes provider.<p>.models["<id>"]) — ` +
          `but the diff's new door grammar (review.ts:128 MODEL_SHAPE, id characters only) refuses it: ` +
          `${JSON.stringify(r)}. The refusal's prescribed fix ("provider/model (id characters, exactly one /)") ` +
          `has no legal spelling for a colon-bearing id, so the rail is unusable with a model class the repo ` +
          `itself supports; on BASE the door accepted the id verbatim. One decision, two opposite answers.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
