import assert from "node:assert/strict"
import test from "node:test"
import { closeWave } from "../src/wave.ts"

const live = { paneId: "pane-7" }

test("an open pane holds the prompt", () => {
  const prompts: string[] = []
  const stored: string[] = []
  const closed = closeWave(
    live,
    [
      { id: "france", end: "done", result: "paris" },
      { id: "japan", end: null },
    ],
    {
      prompt: (paneId) => prompts.push(paneId),
      store: (pane) => stored.push(pane.id),
    },
  )
  assert.equal(closed, false)
  assert.deepEqual(prompts, [])
  assert.deepEqual(stored, [])
})

test("the last end stores both results and prompts the same pane once", () => {
  const prompts: string[] = []
  const stored: string[] = []
  const panes = [
    { id: "france", end: "done", trace: { tool: "opencode", cwd: "/tmp/france", since: "t0" }, result: "paris" },
    { id: "japan", end: "blocked", trace: { tool: "opencode", cwd: "/tmp/japan", since: "t1" }, result: "no page" },
  ]
  const closed = closeWave(live, panes, {
    prompt: (paneId, text) => prompts.push(`${paneId}:${text}`),
    store: (pane) => stored.push(`${pane.id}:${pane.trace?.cwd}:${pane.result}`),
  })
  assert.equal(closed, true)
  assert.deepEqual(prompts, ["pane-7:wave closed"])
  assert.deepEqual(stored, ["/tmp/france", "/tmp/japan"].map((cwd, i) => `${panes[i].id}:${cwd}:${panes[i].result}`))
})
