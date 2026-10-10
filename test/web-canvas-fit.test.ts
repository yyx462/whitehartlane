// the canvas fit, proved pure: redrawEdges recomputes the diagram
// canvas/svg size from the actual node boxes every pass, floored at
// the render-time footprint and at the .diagram-view clientWidth.
// The fit lives in web/public/app.js (a classic browser script — no
// imports), so the test lifts the marked pure block verbatim and runs
// it in a bare vm context: the same bytes the browser runs.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import test from "node:test"

const START = "// fit-canvas:start"
const END = "// fit-canvas:end"

const src = readFileSync(resolve("web/public/app.js"), "utf8")
const start = src.indexOf(START)
const end = src.indexOf(END)
assert.ok(start !== -1, "fit-canvas:start marker present in app.js")
assert.ok(end > start, "fit-canvas:end marker after the start in app.js")
const ctx: Record<string, unknown> = {}
runInNewContext(src.slice(start + START.length, end), ctx)
const fitCanvasSize = ctx.fitCanvasSize as
  (boxes: { x: number; y: number; w: number; h: number }[], floor: { fpW?: number; fpH?: number; wellW?: number }) => { w: number; h: number }
assert.equal(typeof fitCanvasSize, "function", "the marked block declares fitCanvasSize")

test("a box dragged past the old right edge grows the canvas so its edges never clip", () => {
  // render-time footprint 800x500; the well is 900 wide; one node sits
  // far right of both — the canvas must follow the box, not the render
  const { w, h } = fitCanvasSize(
    [
      { x: 20, y: 20, w: 168, h: 100 },
      { x: 1500, y: 60, w: 168, h: 100 },
    ],
    { fpW: 800, fpH: 500, wellW: 900 },
  )
  assert.equal(w, 1500 + 168 + 24) // the box extent + margin, beyond every floor
  assert.equal(h, 500) // vertically nothing beat the footprint floor
})

test("a narrow diagram fills the well: clientWidth floors the width, left=0 is the well's true left edge", () => {
  // footprint only 300x300 (a small chain) in a 1400px well: the canvas
  // spans the whole well — no centered dead margin to clamp inside of
  const { w, h } = fitCanvasSize(
    [{ x: 66, y: 32, w: 168, h: 100 }],
    { fpW: 300, fpH: 300, wellW: 1400 },
  )
  assert.equal(w, 1400) // the well-filling floor beats both content and footprint
  assert.equal(h, 300)
})

test("the render-time footprint floors the size — a wake-box slot reservation never shrinks", () => {
  // hollow wake boxes render smaller than the slots drawDiagram
  // reserved (nodeFootprint); the canvas must not shrink below the
  // layout footprint even though every live box is well inside it
  const { w, h } = fitCanvasSize(
    [{ x: 10, y: 10, w: 150, h: 90 }],
    { fpW: 980, fpH: 640, wellW: 400 },
  )
  assert.equal(w, 980) // footprint beats the narrower well
  assert.equal(h, 640)
  // no boxes at all: the floors alone decide (field-wise — the vm
  // object lives in another realm, deepEqual checks prototypes)
  const empty = fitCanvasSize([], { fpW: 500, fpH: 260, wellW: 700 })
  assert.equal(empty.w, 700)
  assert.equal(empty.h, 260)
})

test("the well's height floors the canvas too — the pane never wastes its lower half", () => {
  // a short diagram (footprint 260 tall) in a tall well (700): the
  // canvas fills the well, not the content
  const { h } = fitCanvasSize([{ x: 10, y: 10, w: 150, h: 90 }], { fpW: 300, fpH: 260, wellW: 500, wellH: 700 })
  assert.equal(h, 700)
  // a diagram taller than the well still grows past it (scroll on)
  const tall = fitCanvasSize([{ x: 10, y: 10, w: 150, h: 90 }], { fpW: 300, fpH: 900, wellW: 500, wellH: 700 })
  assert.equal(tall.h, 900)
})

test("dragging down grows the height the same way", () => {
  const { w, h } = fitCanvasSize(
    [{ x: 40, y: 1200, w: 168, h: 100 }],
    { fpW: 800, fpH: 500, wellW: 900 },
  )
  assert.equal(h, 1200 + 100 + 24)
  assert.equal(w, 900) // the well floor still holds the width
})
