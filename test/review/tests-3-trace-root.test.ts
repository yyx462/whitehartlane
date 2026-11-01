import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (the suite's green is a verdict; a skip is a claim) — the diff
// marks ALL FIVE web-canvas-fit tests `SKIP = { skip: "pre-existing red
// on master (fails on BASE too) — issue #253" }`. Measured on BASE
// (daa61ea): exactly TWO of the five fail ("a box dragged past the old
// right edge…", "dragging down grows the height the same way"); the
// other THREE pass on BASE and pass against HEAD's own web/public/app.js
// bytes. A skip whose premise ("fails on BASE too") is false deletes a
// live regression guard from the very suite this diff makes load-bearing
// (package.json's quoted glob now runs it on every `npm test`) —
// QUESTIONS.md #7's red flag: assertions neutered, not fixtures moved.
// The honest shape is: skip only what actually fails. This test
// re-executes every SKIP-marked body against the same marked pure block
// the file lifts, and demands each one genuinely fail; on BASE (no SKIP
// markers exist) it is vacuously green.
test("a test skipped as 'pre-existing red' must actually fail — green means green", () => {
  const file = join(ROOT, "test", "web-canvas-fit.test.ts")
  const src = readFileSync(file, "utf8")
  const marked = [...src.matchAll(/test\(\s*"(?:[^"\\]|\\.)*"\s*,\s*SKIP\s*,\s*\(\)\s*=>\s*\{/g)]
  if (marked.length === 0) return // BASE shape: nothing skipped as red — nothing to prove
  // the same lift the file itself performs: the marked pure block of app.js
  const app = readFileSync(join(ROOT, "web", "public", "app.js"), "utf8")
  const START = "// fit-canvas:start"
  const END = "// fit-canvas:end"
  const s = app.indexOf(START)
  const e = app.indexOf(END)
  assert.ok(s !== -1 && e > s, "sanity: the fit-canvas markers bound a block in app.js")
  const ctx: Record<string, unknown> = {}
  runInNewContext(app.slice(s + START.length, e), ctx)
  const fitCanvasSize = ctx.fitCanvasSize as (...args: unknown[]) => unknown
  assert.equal(typeof fitCanvasSize, "function", "sanity: the marked block declares fitCanvasSize")

  for (const m of marked) {
    const nameMatch = /test\(\s*"((?:[^"\\]|\\.)*)"/.exec(m[0])
    const name = nameMatch ? nameMatch[1] : "?"
    // brace-walk the body out of the file (bodies hold no unbalanced braces)
    let i = (m.index ?? 0) + m[0].length
    const bodyStart = i
    let depth = 1
    while (depth > 0 && i < src.length) {
      const ch = src[i]
      if (ch === "{") depth++
      else if (ch === "}") depth--
      i++
    }
    const body = src.slice(bodyStart, i - 1)
    let failed = false
    let outcome = "passed"
    try {
      new Function("fitCanvasSize", "assert", body)(fitCanvasSize, assert)
    } catch (err) {
      failed = true
      outcome = `threw: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`
    }
    assert.ok(
      failed,
      `INV-4: test "${name}" is skipped as "pre-existing red on master (fails on BASE too) — issue #253", ` +
        `but its body ${outcome} against HEAD's own web/public/app.js — the skip's premise is false for this ` +
        `test. It is a live guard deleted from the suite this diff widens (package.json now runs this file on ` +
        `every npm test), not pre-existing debt: on BASE 2 of these 5 fail and 3 pass; skip the 2, keep the 3. ` +
        `Green means green — a skip claiming red must actually be red.`,
    )
  }
})
