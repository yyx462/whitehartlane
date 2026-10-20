// The spawn-time parent binding: --from books the levy, and the pane
// rides along when the door runs inside herdr (HERDR_PANE_ID) or is
// named explicitly (--pane). The wake's parent-pane rung lives off
// this capture — one motion at handover, no afterthought registration,
// no registry staleness.
import assert from "node:assert/strict"
import test from "node:test"
import { spawnerFromArgs } from "../src/doors/run.ts"

test("spawnerFromArgs: --from books the levy; the pane rides along from --pane or HERDR_PANE_ID", () => {
  assert.equal(spawnerFromArgs(["run", "folder"]), null, "no --from — no levy booked")
  assert.equal(spawnerFromArgs(["--from", "garbage"]), null, "malformed --from is refused")

  const bare = spawnerFromArgs(["--from", "opencode:ses_1", "folder"], {})!
  assert.equal(bare.tool, "opencode")
  assert.equal(bare.session_id, "ses_1")
  assert.ok(bare.since)
  assert.equal(bare.pane, undefined, "outside herdr there is no pane — a state, not an error")

  const envPane = spawnerFromArgs(["--from", "opencode:ses_1", "folder"], { HERDR_PANE_ID: "wK:pGG" })!
  assert.equal(envPane.pane, "wK:pGG", "the herdr pane env is captured without any flag")

  const flagPane = spawnerFromArgs(["--from", "opencode:ses_1", "--pane", "wJ:p12", "folder"], {})!
  assert.equal(flagPane.pane, "wJ:p12", "an explicit --pane outranks the environment")
})
