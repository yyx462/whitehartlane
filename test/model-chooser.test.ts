// The chooser's pure surface: candidate pruning, request shapes, and
// answer parsing. The jev dial itself is a thin spawnSync (chooseModel);
// these tests pin the policy that surrounds it.
import assert from "node:assert/strict"
import test from "node:test"
import {
  CATALOG,
  capBound,
  chooserQuestions,
  chooserState,
  chooseModel,
  parseChooser,
  remainingCandidates,
} from "../src/model-chooser.ts"

const ORDER = [
  "zhipuai-coding-plan/glm-5.3",
  "zhipuai-coding-plan/glm-5.3-flash",
  "xai/grok-4.7",
]

test("capBound recognizes plan-cap faults only", () => {
  assert.equal(capBound({ detail: "provider.rate-limit" }), false)
  assert.equal(capBound({ detail: "已达到 5 小时的使用上限。您的限额将在 2026-10-15 20:06:04 重置。" }), true)
  assert.equal(capBound({ detail: "5-hour usage cap reached" }), true)
  assert.equal(capBound(null), false)
})

test("remainingCandidates drops the dead and the just-faulted model", () => {
  assert.deepEqual(remainingCandidates(ORDER, new Set(["zhipuai-coding-plan/glm-5.3-flash"]), null), [
    "zhipuai-coding-plan/glm-5.3",
    "xai/grok-4.7",
  ])
  assert.deepEqual(
    remainingCandidates(ORDER, new Set(), { model: "zhipuai-coding-plan/glm-5.3", detail: "provider.rate-limit" }),
    ["zhipuai-coding-plan/glm-5.3-flash", "xai/grok-4.7"],
  )
})

test("a plan-cap fault pre-filters same-plan candidates when an off-plan one is live", () => {
  assert.deepEqual(
    remainingCandidates(ORDER, new Set(), { model: "zhipuai-coding-plan/glm-5.3", detail: "已达到 5 小时的使用上限" }),
    ["xai/grok-4.7"],
  )
  // everything left is on the capped plan — keep them, the next fault
  // drives the honest death walk
  const planOnly = ["zhipuai-coding-plan/glm-5.3", "zhipuai-coding-plan/glm-5.3-flash"]
  assert.deepEqual(
    remainingCandidates(planOnly, new Set(), { model: "zhipuai-coding-plan/glm-5.3", detail: "已达到 5 小时的使用上限" }),
    ["zhipuai-coding-plan/glm-5.3-flash"],
  )
})

test("questions cover exactly the live candidates, with the corrected pricing", () => {
  const q = chooserQuestions(["xai/grok-4.7"]) as { pick: { criteria: Record<string, string> } }
  assert.deepEqual(Object.keys(q.pick.criteria), ["xai/grok-4.7"])
  assert.match(q.pick.criteria["xai/grok-4.7"], /same as glm-5\.3/)
  assert.match(chooserQuestions(ORDER).pick.criteria["zhipuai-coding-plan/glm-5.3-flash"], /1\/5 price/)
  assert.ok(CATALOG["zhipuai-coding-plan/glm-5.3"])
})

test("state carries member, work, fault, and candidate notes", () => {
  const s = chooserState({
    member: "junior",
    briefExcerpt: "build the kit",
    fault: { model: "zhipuai-coding-plan/glm-5.3", detail: "provider.rate-limit" },
    remaining: ["xai/grok-4.7"],
  }) as { fault: unknown; candidates: Record<string, unknown> }
  assert.ok(s.fault)
  assert.deepEqual(Object.keys(s.candidates), ["xai/grok-4.7"])
})

test("parseChooser accepts a live pick and refuses off-lattice or garbage", () => {
  const good = JSON.stringify({ answers: { pick: { choice: "xai/grok-4.7", confidence: 0.71 } } })
  assert.deepEqual(parseChooser(good, ["xai/grok-4.7"]), { model: "xai/grok-4.7", confidence: 0.71 })
  const off = JSON.stringify({ answers: { pick: { choice: "zhipuai-coding-plan/glm-5.3", confidence: 0.9 } } })
  assert.equal(parseChooser(off, ["xai/grok-4.7"]), null)
  assert.equal(parseChooser("not json", ["xai/grok-4.7"]), null)
})

test("chooseModel gates on confidence and falls back honest", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-chooser-"))
  const high = JSON.stringify({ answers: { pick: { choice: "xai/grok-4.7", confidence: 0.8 } } })
  const ok = chooseModel({
    taskDir: dir,
    member: "junior",
    remaining: ["xai/grok-4.7"],
    run: () => ({ status: 0, stdout: high }),
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.model, "xai/grok-4.7")
  const low = JSON.stringify({ answers: { pick: { choice: "xai/grok-4.7", confidence: 0.4 } } })
  const shy = chooseModel({
    taskDir: dir,
    member: "junior",
    remaining: ["xai/grok-4.7"],
    run: () => ({ status: 0, stdout: low }),
  })
  assert.equal(shy.ok, false)
  assert.match(shy.why ?? "", /confidence/)
  const dead = chooseModel({ taskDir: dir, member: "junior", remaining: [], run: () => ({ status: 0, stdout: "{}" }) })
  assert.equal(dead.ok, false)
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
