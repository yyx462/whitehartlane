import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// QUESTIONS.md #1 / INV-4 (claims are honest): the diff's new
// scripts/review-trace.mjs claimed in its own header to trace
// "tokens + cost" and printed a `$` column the usd accumulator could
// never feed (the provider integration reports no price) — every
// receipt printed $0.00, a claim, not a measurement. THE FIX REMOVED
// THE PROMISE: the tracer traces tokens, names that cost is not
// reported, and prints no `$`. Fixture: one review job, one unit
// session with known tokens; pinned: the token half arrives, and no
// unfed `$` column exists.
test("review-trace claims only what it traces: tokens, no fabricated dollars", () => {
  const script = join(ROOT, "scripts", "review-trace.mjs")
  if (!existsSync(script)) return // BASE shape: no tracer, no claim
  const home = mkdtempSync(join(tmpdir(), "whl-questions1-"))
  try {
    const run = join(home, ".local/share/agentic-os/sessions/s-q1/jobs/j-q1/run")
    const unit = join(run, "units", "questions")
    mkdirSync(join(run, "data", "review"), { recursive: true })
    mkdirSync(unit, { recursive: true })
    writeFileSync(join(run, "data", "review", "config.sh"), "TITLE='questions q1 fixture'\n")
    writeFileSync(
      join(run, "orchestrator.log"),
      "2026-10-28T00:00:00.000Z start\n2026-10-28T00:05:00.000Z end\n",
    )
    writeFileSync(join(unit, "findings.jsonl"), "")
    const db = join(home, ".local/share/opencode/opencode.db")
    mkdirSync(join(home, ".local/share/opencode"), { recursive: true })
    execFileSync("sqlite3", [
      db,
      [
        "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT)",
        "CREATE TABLE session_message (session_id TEXT, type TEXT, data TEXT)",
        `INSERT INTO session_v2 VALUES ('ses_q1', '${unit}')`,
        `INSERT INTO session_message VALUES ('ses_q1', 'assistant', '${JSON.stringify({
          tokens: { input: 2000, output: 300, reasoning: 0, cache: { read: 4000 } },
        }).replace(/'/g, "''")}')`,
      ].join(";") + ";",
    ])
    const out = execFileSync(process.execPath, [script, "--json", "j-q1"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    })
    const report = JSON.parse(out)
    const toks = report.jobs?.[0]?.toks?.questions
    assert.ok(toks, "the fixture session must surface as the unit's tokens")
    assert.equal(toks.kin, 2000, "sanity: the token half of the claim works")
    assert.ok(!("usd" in toks), "the tracer must not print a $ column it cannot feed — tokens are the honest currency (the cost promise was removed, not fulfilled)")
    assert.doesNotMatch(readFileSync(script, "utf8"), /tokens \+ cost/, "the header must not promise cost the rows cannot carry")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
