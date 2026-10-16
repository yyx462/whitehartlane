import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  budgetAction,
  isProviderBudgetError,
  isProviderFault,
  nextModel,
  policyFromToml,
  readModelsFile,
  writePending,
} from "../src/model-ladder.ts"
import { DEFAULT_ORDER } from "../src/model-chooser.ts"

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

test("ANY provider.* error is a fault; non-provider errors are decisions", () => {
  assert.equal(isProviderFault({ type: "provider.auth", status: 401 }), true)
  assert.equal(isProviderFault({ type: "provider.model-not-found" }), true)
  assert.equal(isProviderFault({ type: "provider.rate-limit", status: 429 }), true)
  assert.equal(isProviderFault({ status: 403 }), true)
  assert.equal(isProviderFault({ status: 500 }), true)
  assert.equal(isProviderFault({ type: "auth" }), false)
  assert.equal(isProviderFault({}), false)
  assert.equal(isProviderFault(undefined), false)
})

test("policy layering: spur toml > local global file > built-in default", () => {
  const root = mkdtempSync(join(tmpdir(), "aos-policy-"))
  const plainToml = "[workflow]\nname = \"t\"\n"
  // no spur section, no global file -> built-in default (static, auto)
  assert.deepEqual(readModelsFile(mkdtempSync(join(tmpdir(), "aos-run-")), plainToml, root), {
    mode: "auto",
    order: DEFAULT_ORDER,
  })
  // global file fills an empty policy, chooser included
  writeFileSync(
    join(root, "models.local.toml"),
    '[fallback]\nmode = "auto"\nchooser = "jev"\norder = ["a/one", "b/two"]\n',
  )
  assert.deepEqual(readModelsFile(mkdtempSync(join(tmpdir(), "aos-run-")), plainToml, root), {
    mode: "auto",
    order: ["a/one", "b/two"],
    chooser: "jev",
  })
  // a spur section with a mode but no order borrows the order below
  const spurModeOnly = '[fallback]\nmode = "ask"\n'
  assert.deepEqual(readModelsFile(mkdtempSync(join(tmpdir(), "aos-run-")), spurModeOnly, root), {
    mode: "ask",
    order: ["a/one", "b/two"],
    chooser: "jev",
  })
  // a spur order is the most specific — wins over the global file; the
  // chooser MECHANISM still inherits (narrowing candidates is not a
  // vote against the judge; a spur that wants static omits nothing —
  // there is no static escape yet, by design)
  const spurFull = '[fallback]\nmode = "auto"\norder = ["c/three"]\n'
  assert.deepEqual(readModelsFile(mkdtempSync(join(tmpdir(), "aos-run-")), spurFull, root), {
    mode: "auto",
    order: ["c/three"],
    chooser: "jev",
  })
  // no doorRoot: no global lookup, still the built-in default
  assert.deepEqual(readModelsFile(mkdtempSync(join(tmpdir(), "aos-run-")), plainToml), {
    mode: "auto",
    order: DEFAULT_ORDER,
  })
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
