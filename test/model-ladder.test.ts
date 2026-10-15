import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  budgetAction,
  isProviderBudgetError,
  nextModel,
  policyFromToml,
  readModelsFile,
  writePending,
} from "../src/model-ladder.ts"

const TOML = `[workflow]
name = "t"
worker_kind = "opencode"

[fallback]
mode = "auto"
order = ["zhipuai-coding-plan/glm-5.3", "xai/grok-4.7"]
`

test("a provider.rate-limit message is a budget fault; ordinary work is not", () => {
  assert.equal(isProviderBudgetError({ type: "provider.rate-limit", status: 429 }), true)
  assert.equal(isProviderBudgetError({ status: 429 }), true)
  assert.equal(isProviderBudgetError({ type: "provider.auth" }), false)
  assert.equal(isProviderBudgetError(undefined), false)
})

test("next model walks the order and stops at the end", () => {
  const order = ["a/one", "b/two"]
  assert.equal(nextModel(order, "a/one"), "b/two")
  assert.equal(nextModel(order, "b/two"), null)
  assert.equal(nextModel(order, undefined), "a/one")
})

test("toml [fallback] is the default; models.json wins in flight", () => {
  assert.deepEqual(policyFromToml(TOML), { mode: "auto", order: ["zhipuai-coding-plan/glm-5.3", "xai/grok-4.7"] })
  assert.deepEqual(policyFromToml("[workflow]\nname=\"t\"\n"), { mode: "ask", order: [] })
  const dir = mkdtempSync(join(tmpdir(), "aos-models-"))
  writeFileSync(join(dir, "models.json"), JSON.stringify({ mode: "ask", order: ["xai/grok-4.7", "zhipuai-coding-plan/glm-5.3"] }))
  const live = readModelsFile(dir, TOML)
  assert.equal(live.mode, "ask")
  assert.deepEqual(live.order, ["xai/grok-4.7", "zhipuai-coding-plan/glm-5.3"])
})

test("auto switches, ask waits, an empty ladder is exhausted, a decide line resolves", () => {
  const policy = { mode: "auto" as const, order: ["a/one", "b/two"] }
  assert.deepEqual(
    budgetAction({ fault: true, member: "junior", current: "a/one", policy }),
    { kind: "switch", to: "b/two" },
  )
  assert.equal(
    budgetAction({ fault: true, member: "junior", current: "a/one", policy: { ...policy, mode: "ask" } }).kind,
    "ask",
  )
  assert.equal(
    budgetAction({ fault: true, member: "junior", current: "b/two", policy }).kind,
    "exhausted",
  )
  const asked = {
    mode: "ask" as const,
    order: policy.order,
    pending: { member: "junior", from: "a/one", to: "b/two", at: "t", why: "token budget" },
  }
  assert.equal(budgetAction({ fault: false, member: "junior", current: "a/one", policy: asked }).kind, "waiting")
  assert.deepEqual(
    budgetAction({ fault: false, member: "junior", current: "a/one", policy: { ...asked, decide: { junior: "switch" } } }),
    { kind: "switch", to: "b/two" },
  )
})

test("writePending keeps the ladder the human is editing", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-pending-"))
  const file = { mode: "ask" as const, order: ["a/one", "b/two"] }
  writePending(dir, file, { member: "junior", from: "a/one", to: "b/two", at: "t", why: "token budget" })
  const onDisk = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"))
  assert.equal(onDisk.pending.member, "junior")
  assert.deepEqual(onDisk.order, ["a/one", "b/two"])
})
