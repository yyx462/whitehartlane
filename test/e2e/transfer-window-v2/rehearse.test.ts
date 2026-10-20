// rehearse.test.ts — the composite case's MOCK REHEARSAL (OPTIMUM's
// exam): the real orchestrator walks the real workflow.toml — waves,
// stage checks, mint, levies, bookings, the final gate — with scripted
// minds at the two seams the test suite itself fakes (ShepPort spawn,
// the levy port of stages.test.ts's autoWakeLevy shape). Seconds, zero
// tokens; part of npm test. The negative run proves verify.sh CHECKS:
// a schema-valid plan with ONE doctored fee passes every mid-chain
// check and dies at the grade gate, where the verdict belongs (#150).
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runOrchestrator, type ShepPort } from "../../../src/engines/orchestrator.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-tw2-"))
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const CASE = import.meta.dirname

// the ingest desk's oracle — the brief's rules, executable
function normalize(csvText: string): string {
  const [head, ...lines] = csvText.split("\n")
  assert.equal(head, "id,name,pos_group,position,age,fee,wage,form_pct,contract_years")
  const gbpK = (raw: string): number => {
    const m = /^£([\d.]+)([mk])$/.exec(raw)!
    return m[2] === "m" ? Math.round(parseFloat(m[1]) * 1000) : parseInt(m[1], 10)
  }
  return lines
    .filter((l) => l.length > 0)
    .map((l) => {
      const [id, name, grp, position, age, fee, wage, form, years] = l.split(",")
      const row = {
        id, name: name.replace(/\s+/g, " ").trim(), pos_group: grp.toLowerCase(), position,
        age: parseInt(age, 10), fee_gbp_k: gbpK(fee), wage_gbp_k: gbpK(wage),
        form_pct: parseInt(form, 10), contract_years: parseInt(years, 10),
      }
      return JSON.stringify(row)
    })
    .join("\n") + "\n"
}

function stageCase(name: string): string {
  const dir = join(process.env.AGENTIC_OS_HOME!, name)
  mkdirSync(dir, { recursive: true })
  cpSync(join(CASE, "workflow.toml"), join(dir, "workflow.toml"))
  cpSync(join(CASE, "hooks"), join(dir, "hooks"), { recursive: true })
  execFileSync("python3", [join(CASE, "gen-universe.py"), join(dir, "data")])
  return dir
}

async function rehearse(name: string, planFixture: string) {
  const dir = stageCase(name)
  const spawned: string[] = []
  const shep: ShepPort = {
    setLayout: () => {},
    spawnWorker: (worker, _kind, briefPath, cwd) => {
      const id = worker.slice(2)
      spawned.push(id)
      // the scripted unit mind: do the stage's artifact work, then land
      // the done line the marker judge reads
      if (id === "ingest") {
        const jsonl = normalize(readFileSync(join(dir, "data", "players.csv"), "utf8"))
        for (const target of [
          join(dir, "data", "players.jsonl"),
          join(dir, "stages", "negotiate", "data", "players.jsonl"),
          join(dir, "stages", "scout", "data", "players.jsonl"),
        ]) {
          mkdirSync(join(target, ".."), { recursive: true })
          writeFileSync(target, jsonl)
        }
      } else {
        const shard = `shortlist-${id === "defensive" ? "defensive" : id === "midfield" ? "midfield" : "forward"}.json`
        mkdirSync(join(dir, "stages", "negotiate", "data"), { recursive: true })
        cpSync(join(CASE, "fixtures", shard), join(dir, "stages", "negotiate", "data", shard))
      }
      writeFileSync(join(cwd, "result.md"), `${id} done\n`)
      writeFileSync(join(briefPath, "..", "log.txt"), `done ${id}\n`)
      return true
    },
    paneAlive: () => true,
    retire: () => {},
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  // the scripted delegated mind: the child's members/actor delivered
  // their artifacts inside the child job's run dir — the wake booking
  // (wakes/<id>.json) is where the stage's accept checks find them
  const levyChild = (unitId: string) => {
    const jobDir = join(dir, "child-jobs", unitId)
    mkdirSync(join(jobDir, "data"), { recursive: true })
    if (unitId === "negotiate") cpSync(join(CASE, "fixtures", planFixture), join(jobDir, "data", "plan.json"))
    if (unitId === "scout") cpSync(join(CASE, "fixtures", "scout-verdict.json"), join(jobDir, "data", "scout-verdict.json"))
    writeFileSync(join(jobDir, "wake.json"), JSON.stringify({ outcome: "done", at: new Date().toISOString() }))
    return { ok: true as const, jid: `j-${unitId}`, jobDir, warnings: [] }
  }
  const report = await runOrchestrator({
    taskDir: dir, shep, levyChild,
    gateCheckMs: 50, logPollMs: 50, stallMs: 60_000, briefGraceMs: 60_000, log: () => {},
  })
  return { dir, spawned, report }
}

test("transfer-window-v2 rehearses green: five topologies, one chain, verify.sh PASS", async () => {
  const { dir, spawned, report } = await rehearse("green", "plan.json")
  assert.equal(report.status, "done", JSON.stringify(report.table, null, 1))
  // the declared chain, in order: one solo worker, three analysts; the
  // delegated stages birth no pane here (their minds are the child's)
  assert.deepEqual(spawned, ["ingest", "defensive", "midfield", "forward"])
  // every unit stage settled through its OWN stage check (jq schema),
  // never the task verifier (#150 — grade=false on analyze)
  const rows = Object.fromEntries(report.table.map((r) => [r.unit, String(r.result)]))
  assert.match(rows.ingest, /stage check passed/)
  for (const unit of ["defensive", "midfield", "forward"]) assert.match(rows[unit], /stage check passed/)
  assert.match(rows.negotiate, /child j-negotiate done — stage check passed/)
  assert.match(rows.scout, /child j-scout done — stage check passed/)
  assert.match(rows.grade, /stage gate passed/)
  // delivery INTO the delegated stages rode the minted folders
  assert.ok(readFileSync(join(dir, "stages", "negotiate", "members", "dof.md"), "utf8").includes("Director of Football"))
  assert.ok(readFileSync(join(dir, "stages", "scout", "actor.md"), "utf8").includes("chief scout"))
  // delivery OUT rode the accept checks (bookings -> parent data/)
  assert.ok(readFileSync(join(dir, "data", "plan.json"), "utf8").length > 0)
  assert.ok(readFileSync(join(dir, "data", "scout-verdict.json"), "utf8").includes('"fit": 1.0'))
  // and the gate's own verdict line, straight from the horse's mouth
  const v = execFileSync("bash", ["hooks/verify.sh"], { cwd: dir, encoding: "utf8" }).trim()
  assert.match(v, /^PASS squad=9 spent=49660\/60000, coverage\/fees\/probes exact$/)
})

test("the same rehearsal with ONE doctored fee: mid-chain green, grade gate RED", async () => {
  const { dir, report } = await rehearse("badfee", "plan-bad.json")
  assert.equal(report.status, "failed")
  const rows = Object.fromEntries(report.table.map((r) => [r.unit, String(r.result)]))
  assert.match(rows.grade, /stage gate failed/, "the grade gate failed the doctored plan")
  // every earlier stage stayed green — the verdict is the gate's, never
  // a mid-chain check's (#150); the doctoring is invisible to schema
  for (const unit of ["ingest", "defensive", "midfield", "forward", "negotiate", "scout"]) {
    assert.doesNotMatch(rows[unit], /failed/, `${unit} must stay green while the gate red-lines the plan`)
  }
  // verify.sh names the check that fired: the fee disagrees with the
  // universe (spent arithmetic still exact — this is the vibe-proof)
  const rc = spawnSync("bash", ["hooks/verify.sh"], { cwd: dir, encoding: "utf8" })
  assert.notEqual(rc.status, 0)
  assert.match(rc.stdout, /^FAIL universe:/)
})

test("the corpus pin holds: the case parses and the fixture tree is stable", () => {
  // corpus.test.ts's walk already loadManifest-pins this workflow.toml;
  // this pins the FIXTURE side of the rehearsal: the good plan is legal
  // against the generated universe, and the bad plan differs from it by
  // exactly one fee (the check the negative run proves verify.sh makes)
  const good = JSON.parse(readFileSync(join(CASE, "fixtures", "plan.json"), "utf8"))
  const bad = JSON.parse(readFileSync(join(CASE, "fixtures", "plan-bad.json"), "utf8"))
  const diffs = good.squad.flatMap((p: { id: string; fee_gbp_k: number }, i: number) =>
    bad.squad[i].fee_gbp_k === p.fee_gbp_k ? [] : [p.id])
  assert.deepEqual(diffs, [good.squad[3].id])
  assert.equal(bad.spent_gbp_k - good.spent_gbp_k, 250)
  assert.ok(readdirSync(join(CASE, "hooks")).every((f) => f.endsWith(".sh")))
})
