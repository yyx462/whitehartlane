import assert from "node:assert/strict"
import test from "node:test"
import { drop, emptyBoard, note, place, share } from "../src/lanes.ts"

test("lanes open only when needed and share the tab", () => {
  let board = emptyBoard()
  const first = place(board, "orchestrator")
  assert.equal(first.kind, "first")
  board = note(board, first, "p1")
  assert.equal(share(board.tabs[0].lanes.length), 1)

  const actor = place(board, "actor")
  assert.equal(actor.kind, "lane")
  board = note(board, actor, "p2")
  assert.equal(share(2), 0.5)

  const mock = place(board, "mock")
  assert.equal(mock.kind, "lane")
  board = note(board, mock, "p3")
  assert.equal(share(3), 1 / 3)
})

test("a second mock stacks in the mock lane, and the fourth opens a tab", () => {
  let board = emptyBoard()
  for (const role of ["orchestrator", "actor", "mock"]) {
    const placed = place(board, role)
    board = note(board, placed, role)
  }
  const second = place(board, "mock")
  assert.equal(second.kind, "stack")
  board = note(board, second, "m2")
  board = note(board, place(board, "mock"), "m3")
  const fourth = place(board, "mock")
  assert.equal(fourth.kind, "overflow-tab")
})

test("closing a lane leaves the others to share the width", () => {
  let board = emptyBoard()
  for (const [role, pane] of [["orchestrator", "p1"], ["actor", "p2"], ["mock", "p3"]]) {
    board = note(board, place(board, role), pane)
  }
  board = drop(board, "p2")
  assert.deepEqual(board.tabs[0].lanes.map((lane) => lane.role), ["orchestrator", "mock"])
  assert.equal(share(board.tabs[0].lanes.length), 0.5)
})
