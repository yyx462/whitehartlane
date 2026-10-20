import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_PROMPTS, landGate, loadOptions, loadPrompt, loadThreshold, promptFile } from "../src/jev/jev-prompts.ts"

const tmp = mkdtempSync(join(tmpdir(), "aos-jp-"))
process.env.AGENTIC_OS_JEV_PROMPTS_DIR = tmp

test("with no landed files the compiled defaults answer", () => {
  assert.equal(loadPrompt("permission-needed"), DEFAULT_PROMPTS["permission-needed"])
  assert.equal(loadThreshold("grill-enough"), 0.7)
  assert.equal(loadOptions("workflow-choice")["fan-out"], "The task is independent units. No unit needs another unit's result.")
})

test("an empty landed prompt falls back, a broken meta falls back", () => {
  writeFileSync(promptFile("permission-needed"), "  \n")
  assert.equal(loadPrompt("permission-needed"), DEFAULT_PROMPTS["permission-needed"])
  writeFileSync(join(tmp, "grill-enough.json"), "{not json")
  assert.equal(loadThreshold("grill-enough"), 0.7)
})

test("landGate writes prompt, threshold, and options as one unit", () => {
  landGate("workflow-choice", "Parallel or connected?", 0.55, {
    "fan-out": "never meets",
    direct: "one thread",
  })
  assert.equal(loadPrompt("workflow-choice"), "Parallel or connected?")
  assert.equal(loadThreshold("workflow-choice"), 0.55)
  assert.deepEqual(loadOptions("workflow-choice"), { "fan-out": "never meets", direct: "one thread" })
  assert.equal(existsSync(promptFile("workflow-choice")), true)
})

test("the repo's committed landed prompts are readable and non-empty", () => {
  delete process.env.AGENTIC_OS_JEV_PROMPTS_DIR
  for (const gate of Object.keys(DEFAULT_PROMPTS) as (keyof typeof DEFAULT_PROMPTS)[]) {
    const p = loadPrompt(gate)
    assert.ok(p.length > 20, `${gate} landed prompt too short`)
    const t = loadThreshold(gate)
    assert.ok(t > 0 && t < 1, `${gate} threshold out of range`)
    const text = readFileSync(promptFile(gate), "utf8")
    assert.equal(text.trim(), p, `${gate} file should hold the landed prompt verbatim`)
  }
})
