import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest } from "../../src/doors/hooks.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one decision, one place — "is this string a legal provider/model
// id?"). The diff added a NEW, STRICT grammar for that decision at the
// review door (src/doors/review.ts:128:
// /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i) while the four
// pre-existing validators of the SAME decision keep the repo's long-held
// permissive grammar /^[^/\s]+\/[^/\s]+$/:
//   - src/doors/hooks.ts:618   ([workflow] model — every run program)
//   - src/doors/hooks.ts:134   (member/per-unit model pins)
//   - src/engines/coworker.ts:43 (member model — coworker engine)
//   - src/jev/model-ladder.ts:36 (parseModelRef — the host's own parser)
// The two grammars disagree on a real, mainstream id class: provider ids
// carrying a tag colon (`ollama/qwen3:32b`), a `+`, a `$`, a `~`. The run
// path accepts and executes them (the manifest grammar is the run door's
// judge); the review door refuses them with exit 2 — so the SAME program
// declaring the SAME model runs under `whl run` but cannot be reviewed
// with its own model under `whl review --model`, and the help's hard rule
// "--model is REQUIRED as provider/model" is false for ids the repo's own
// validators accept. BASE materialized this id (no grammar check at all),
// so the refusal — and the divergence — is introduced by this change.
const MODEL = "ollama/qwen3:32b"

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

test("the door's --model grammar agrees with the manifest's own provider/model grammar", () => {
  // ── sanity: the repo's canonical grammar (loadManifest — the same
  // judge every `whl run` program passes through) ACCEPTS this id
  const prog = mkdtempSync(join(tmpdir(), "whl-p6-prog-"))
  try {
    writeFileSync(
      join(prog, "workflow.toml"),
      [
        "[workflow]",
        `name = "p6"`,
        `worker_kind = "opencode"`,
        `model = "${MODEL}"`,
        "",
        "[[stage]]",
        `id = "u"`,
        `topology = "fan-out"`,
        `units = [{ id = "a", brief = "b" }]`,
        "",
      ].join("\n"),
    )
    const manifest = loadManifest(prog)
    assert.equal(
      (manifest.workflow as { model?: unknown }).model,
      MODEL,
      "sanity: the manifest grammar (hooks.ts) accepts a colon-tagged provider/model — the run path executes it",
    )
  } finally {
    rmSync(prog, { recursive: true, force: true })
  }

  // ── the twin: the review door must accept every id the manifest
  // grammar accepts. One decision, one answer.
  const tmp = mkdtempSync(join(tmpdir(), "whl-p6-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const r = prepareReview({ repo, base: "master", head: "feat", model: MODEL, out }, join(ROOT, "templates"))
    assert.equal(
      r.ok,
      true,
      `INV-3 twin grammars: the review door (review.ts:128, /^[a-z0-9][a-z0-9._-]*\\/${"[a-z0-9][a-z0-9._-]*"}$/i) refuses ` +
        `--model ${MODEL} (ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"}) while the manifest grammar ` +
        `(hooks.ts:618 [workflow] model, hooks.ts:134 member pins, coworker.ts:43, model-ladder.ts:36 — all ` +
        `/^[^/\\s]+\\/[^/\\s]+$/) accepts the identical id and the run path executes it. "Is this a legal ` +
        `provider/model id" is one decision answered two opposite ways; the help's hard rule ("--model is ` +
        `REQUIRED as provider/model") is false for the tag-colon id class. BASE materialized this id — ` +
        `the refusal is introduced by this diff.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
