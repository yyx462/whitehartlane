import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { loadManifest, HookError } from "../../src/doors/hooks.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// THE ROUND CLIFF'S MANIFEST SEAT (the r25 receipt, 2026-11-02): the
// template declared `deadline_s = 1800`, the orchestrator read
// `manifest.workflow.deadline_s` — and loadManifest's whitelist
// assembly never carried the key, so every live run fell to the 2h
// default while the bytes on disk said 30 minutes. r25 reached 95
// minutes on a 30-minute cliff (budget law healthy: questions 14 min,
// momentum 16; the cliff itself inert). The fixer's first law —
// VERIFY THE DELIVERY, run the receiver — is this test: the consumer's
// own read, not the file's bytes, is the only truth.
test("the round cliff reaches the consumer: the real template's deadline_s loads through loadManifest", () => {
  const wf = loadManifest(join(ROOT, "templates", "pr-review")).workflow
  assert.equal(wf.deadline_s, 1800, "the pr-review template's 30-minute cliff must survive the manifest's whitelist assembly")
})

test("no deadline declared → no deadline invented (undefined, not a default)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-dlm-"))
  try {
    const dir = join(tmp, "prog")
    mkdirSync(dir)
    writeFileSync(join(dir, "workflow.toml"), '[workflow]\nname = "w"\nworker_kind = "opencode"\n')
    assert.equal(loadManifest(dir).workflow.deadline_s, undefined)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("workflow.deadline_s validates at load: integer seconds, 60..7200 — garbage refuses loudly, never a silent instant-or-infinite cliff", () => {
  for (const bad of ["10", "99999", "30.5"]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-dlm-"))
    try {
      const dir = join(tmp, "prog")
      mkdirSync(dir)
      writeFileSync(join(dir, "workflow.toml"), `[workflow]\nname = "w"\nworker_kind = "opencode"\ndeadline_s = ${bad}\n`)
      assert.throws(() => loadManifest(dir), (err: unknown) => {
        assert.ok(err instanceof HookError)
        assert.match(err.message, /deadline_s must be an integer 60-7200/)
        return true
      }, `deadline_s = ${bad} must refuse at load`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})

test("a legal declaration round-trips: deadline_s = 1800 loads as the number 1800", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-dlm-"))
  try {
    const dir = join(tmp, "prog")
    mkdirSync(dir)
    writeFileSync(join(dir, "workflow.toml"), '[workflow]\nname = "w"\nworker_kind = "opencode"\ndeadline_s = 1800\n')
    assert.equal(loadManifest(dir).workflow.deadline_s, 1800)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
