// questions-28 (questions lens, Q2/Q6) — THE SUPERVISOR'S BRIEF STILL WAITS ON
// THE PROVE SEAT while the WATCHER was moved onto the merge seat.
//
// The chain (templates/pr-review/workflow.toml) is:
//   intake → lenses → prove → divide → merge
//   prove  writes data/review/verdict.json   (two stages before the end)
//   divide writes the feedback/ shelf (feedback/MAP.md)
//   merge  writes data/review/merge.json     ← the commission's END
//
// This diff moved the WATCHER's wait onto the merge seat
// (src/doors/ship-supervisor.ts, the watcher script):
//   while [ ! -f "$OUT/data/review/merge.json" ]; do
// and states the law in its own comment:
//   "THE SEAT (principles-4004): the commission ends with the MERGE stage
//    … the watcher waits on exactly that. The verdict (prove) lands two
//    stages earlier; waiting on it would speak before the feedback map
//    exists."
//
// The OTHER half of the same supervisor — the BRIEF, the text the agent
// itself reads (supervisorBrief, step 2) — still waits on the prove seat:
//   V=<the staged ${runDir}/data/review/verdict.json path from step 3>;
//   i=0; until [ -f "$V" ]; do sleep 15; …
// and step 5 asks it to post "the feedback pointers from the job run dir's
// feedback/MAP.md when it exists" — a file the divide stage writes AFTER
// the verdict. Step 6 then asserts a fact that is not true yet: "accept:
// the rail's merge command already merged the PR".
//
// So the agent wakes on the verdict, composes the PR comment before the
// divide and merge stages ran (no feedback map, no merge yet), and posts
// it; the watcher's backstop stays silent (supervisor-comment.md exists),
// so nothing corrects the early announcement.
//
// The repro: the REAL brief, the REAL chain, and the rule the watcher
// already obeys — the seat the brief WAITS on must be written by the LAST
// stage of the chain.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")
const PR_REVIEW = join(TEMPLATES, "pr-review")

// the chain, in the order the workflow.toml declares it
function chainStages(): { id: string; hook: string }[] {
  const toml = readFileSync(join(PR_REVIEW, "workflow.toml"), "utf8")
  return toml
    .split(/\[\[stage\]\]/)
    .slice(1)
    .map((b) => ({
      id: /id\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? "?",
      hook: (/run\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? "").replace(/^bash\s+/, ""),
    }))
}

// which stage WRITES that seat? a write, not a read.
function writerOf(rel: string): { id: string; hook: string }[] {
  const base = rel.split("/").pop() ?? rel
  const stages = chainStages()
  return stages.filter((s) => {
    if (!s.hook) return false
    const p = join(PR_REVIEW, s.hook)
    if (!existsSync(p)) return false
    const text = readFileSync(p, "utf8")
    if (!text.includes(base)) return false
    return /writeFileSync|appendFileSync|createWriteStream|>>\s*`?[^`\n]*\$\{?prog/.test(text)
  })
}

test("questions-28: the seat the supervisor's BRIEF waits on must be the LAST stage's seat", async () => {
  const mod = (await import("../../src/doors/ship-supervisor.ts").catch(() => null)) as
    | typeof import("../../src/doors/ship-supervisor.ts")
    | null
  assert.ok(mod, "the supervisor seat must exist — the brief must have an owner")
  const { supervisorBrief } = mod
  const brief = supervisorBrief({
    levyCmd: "whl review /repo --base master --head feat --model 'acme/strong' --unattended",
    runDir: "/run",
    pr: "42",
    repo: "/repo",
  })

  // the brief's WAIT: the seat it polls in its blocking loop
  assert.match(brief, /until \[ -f "\$V" \]/, "the brief must spell a blocking wait on $V")
  const seat = /V=<the staged ([^>]+)>/.exec(brief)?.[1] ?? ""
  const rel = /data\/review\/([A-Za-z0-9_.-]+\.json)/.exec(seat)?.[1]
  assert.ok(rel, `the brief must name the seat it waits on (read: ${JSON.stringify(seat)})`)

  const stages = chainStages()
  const last = stages[stages.length - 1]!
  const writers = writerOf(`data/review/${rel}`)
  assert.ok(writers.length > 0, `the seat ${rel} must be written by some stage of the chain (writers found: none)`)
  for (const w of writers) {
    assert.equal(
      w.id,
      last.id,
      `the supervisor's brief waits on data/review/${rel}, which the '${w.id}' stage writes — but the chain continues (${stages
        .slice(stages.indexOf(w) + 1)
        .map((x) => x.id)
        .join(", ")}) after it: the agent wakes on the verdict, posts the outcome before the divide/merge stages ran (the feedback map does not exist yet, and the merge has not happened), and the watcher's backstop stays silent because the agent already posted`,
    )
  }
})
