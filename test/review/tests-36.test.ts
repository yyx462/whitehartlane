import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { writeWorkerPermissions } from "../../src/adapters/store.ts"

// Meta-ACH: mid-failure. The MERGE rewrite of writeWorkerPermissions
// (store.ts, issue #249) reads the prior opencode.json with
// JSON.parse inside the one big try whose outer catch swallows
// EVERYTHING ("permissions scoping is best-effort"). A prior write
// that tore mid-write (writeFileSync is not atomic; the repo's own
// receipt culture calls this artifact class real: "a torn verdict is
// the crash's own receipt") is unparseable — so the entire isolation
// write is skipped, forever, on every future generation. BASE
// clobbered the file unconditionally, so it self-healed; the merge
// feature turns one torn write into a PERMANENT isolation loss — the
// sandbox inherits the operator's interactive global config, the
// exact j-4a0009/#249 failure this change claims to kill ("the unit
// sandbox inherits NOTHING").
test("a torn prior opencode.json is repaired by the isolation write, never preserved as poison", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-t36-torn-"))
  try {
    // a previous generation died mid-write: the config on disk is torn
    writeFileSync(join(dir, "opencode.json"), '{ "model": "p/m", "permi')
    writeWorkerPermissions(dir, [dir])

    let oc: Record<string, unknown> | null = null
    try {
      oc = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")) as Record<string, unknown>
    } catch {
      oc = null
    }
    assert.ok(
      oc !== null,
      "the isolation write must survive a corrupt prior: on HEAD the torn file is left " +
        "untouched (JSON.parse throws into the outer catch and the whole write is skipped), so the " +
        "sandbox keeps NO permission block and opencode merges the operator's interactive global " +
        "config — issue #249's failure, reintroduced by the merge read",
    )
    const permission = (oc as { permission?: { external_directory?: Record<string, string> } }).permission
    assert.ok(
      permission?.external_directory && Object.keys(permission.external_directory).length > 0,
      "the scoped permission block must force-win over whatever the prior carried",
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// control: the healthy merge (valid prior) — the behavior the MERGE
// comment promises. This pins the intended half so the fix cannot
// regress to clobbering while repairing the torn half.
test("control: a valid prior merges — earned keys survive, isolation force-wins", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-t36-merge-"))
  try {
    writeFileSync(
      join(dir, "opencode.json"),
      JSON.stringify({ model: "p/m", custom_key: "keep-me" }) + "\n",
    )
    writeWorkerPermissions(dir, [dir])
    const oc = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")) as {
      model?: string
      custom_key?: string
      permission?: { external_directory?: Record<string, string> }
    }
    assert.equal(oc.model, "p/m", "the earned model pin survives the merge")
    assert.equal(oc.custom_key, "keep-me", "keys the sandbox earned survive the re-seed")
    assert.ok(
      oc.permission?.external_directory && Object.keys(oc.permission.external_directory).length > 0,
      "the isolation keys force-win",
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
