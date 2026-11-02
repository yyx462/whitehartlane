import assert from "node:assert/strict"
import { join } from "node:path"
import test from "node:test"
import { actorBrief, actorBriefPath } from "../src/core/roles.ts"

test("the actor brief is the program's own text — no OS-injected target", () => {
  const brief = actorBrief("Read the target skill. Do not edit it.")
  assert.match(brief, /You are the actor/)
  assert.match(brief, /Read the target skill/)
  assert.equal(brief.includes("Target:"), false)
  assert.equal(brief.includes("SKILL_RSI"), false)
})

test("the actor brief carries the booking marker (#266 twin): its first message names the briefs dir", () => {
  const taskDir = "/sessions/s-x/jobs/j-lab0001/run"
  // exactly what lab.ts writes to <taskDir>/briefs/actor.md and submits
  // as the actor's first prompt
  const first = actorBrief("Run the experiment.", taskDir)
  // the booking seats' marker: dirname(actorBriefPath(taskDir)) = <taskDir>/briefs
  const marker = join(taskDir, "briefs")
  assert.ok(first.includes(marker), "writer≡reader: the actor's first user message must carry <taskDir>/briefs or its session never books and a continued lab re-briefs instead of resuming")
  // no taskDir (tests, old callers) → the text stays clean, no fake paths
  assert.equal(actorBrief("x").includes("/briefs"), false)
})
