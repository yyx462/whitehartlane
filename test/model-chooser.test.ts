// The chooser's pure surface: candidate pruning, request shapes, and
// answer parsing. The jev dial itself is a thin spawnSync (chooseModel);
// these tests pin the policy that surrounds it.
import assert from "node:assert/strict"
import test from "node:test"
import {
  CATALOG,
  chooserQuestions,
  chooserState,
  chooseModel,
  parseChooser,
  remainingCandidates,
} from "../src/jev/model-chooser.ts"

const ORDER = [
  "zhipuai-coding-plan/glm-5.3",
  "zhipuai-coding-plan/glm-5.3-flash",
  "xai/grok-4.7",
]

test("remainingCandidates drops the dead and keeps the rest for the judge", () => {
  assert.deepEqual(remainingCandidates(ORDER, new Set(["zhipuai-coding-plan/glm-5.3-flash"])), [
    "zhipuai-coding-plan/glm-5.3",
    "xai/grok-4.7",
  ])
  // a plan-cap fault does NOT pre-filter same-plan candidates: a wrong
  // GLM pick costs one refused turn (~nothing), forcing grok from code
  // would buy the most expensive model against the operator's preference
  assert.deepEqual(remainingCandidates(ORDER, new Set()), ORDER)
})

test("questions cover exactly the live candidates, with real rates and GLM-first policy", () => {
  const q = chooserQuestions(["xai/grok-4.7"]) as { pick: { criteria: Record<string, string>; instructions: string } }
  assert.deepEqual(Object.keys(q.pick.criteria), ["xai/grok-4.7"])
  assert.match(q.pick.criteria["xai/grok-4.7"], /most expensive/)
  assert.match(q.pick.instructions, /GLM coding plan/)
  assert.match(q.pick.instructions, /strongly preferred/)
  assert.match(chooserQuestions(ORDER).pick.criteria["zhipuai-coding-plan/glm-5.3-flash"], /\$0\.15/)
  assert.match(chooserQuestions(ORDER).pick.criteria["zhipuai-coding-plan/glm-5.3"], /\$1\.40/)
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
