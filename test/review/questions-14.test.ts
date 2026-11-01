import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape: the lenses.txt handoff (the door's parse→intake reader
// replacement) is this diff's own addition — on BASE there is no
// handoff and no zero-lens doctrine in the door, nothing to judge
// (the momentum-14 device: guarded on the marker, vacuous green on
// BASE, so the prove gate classifies this repro as introduced).
const doorHasTheHandoff = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("lenses.txt")

function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

// a legal-TOML template whose parse reads ZERO stage units — a
// [[stage]] gate with no units anywhere. The door's own parse handles
// these bytes fine; that is the point: the shape is not a parse
// failure, it is a DOCTRINE failure (is a zero-lens program a
// materializable review?).
function unitsLessTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "q14"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "intake"`,
      `topology = "gate"`,
      `run = "true"`,
      "",
    ].join("\n"),
  )
  return where
}

test("a template whose parse reads zero units is refused — never materialized with an empty lens handoff", () => {
  if (!doorHasTheHandoff) return // BASE: no handoff machinery — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-q14-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = unitsLessTemplate(join(tmp, "tpl"))

    // premise: the door's own parse reads ZERO unit ids from the
    // template — smol-toml parses it fine; nothing is malformed here
    const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<{ id?: string }> }>
    }
    const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u?.id)).filter(
      (x): x is string => typeof x === "string",
    )
    assert.deepEqual(ids, [], "premise: the door's own parse reads zero stage units from the template")

    // THE TWIN (the door's own law, seated on the roster path): the
    // same template under a roster refuses — "a zero-lens review is
    // the empty-roster shape the door refuses" (review.ts, the
    // survivors check). One decision, and the door already answers it
    // NO on the path this diff built first.
    const rosterProbe = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-roster"), template: tpl, roster: ["principles"] },
      join(ROOT, "templates"),
    )
    assert.equal(
      rosterProbe.ok,
      false,
      `premise/twin: the roster path already refuses this exact template ("the roster names no unit in this template … a zero-lens review is the empty-roster shape the door refuses") — got ${JSON.stringify(rosterProbe).slice(0, 200)}`,
    )

    // THE LAW: the plain path (no roster) must answer the SAME — the
    // materialized artifact would carry an empty data/review/lenses.txt,
    // and the run's own intake gate exits 1 on exactly that ("missing or
    // empty handoff … this is a door bug; report it"): a BOOKED job dead
    // at its first gate, holding a receipt that tells the operator to
    // report the bug the door itself just manufactured. Refuse here, at
    // the door, before anything is booked — the same code-2 answer the
    // empty-roster guard gives.
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    let handoff = "(not written)"
    if (r.ok && !("skipped" in r && r.skipped)) {
      try {
        handoff = JSON.stringify(readFileSync(join((r as { dir: string }).dir, "data", "review", "lenses.txt"), "utf8"))
      } catch {
        /* the assertion below carries the finding */
      }
    }
    assert.equal(
      r.ok,
      false,
      `INV-3/INV-4: "may a zero-lens program materialize?" is answered NO by the door's own guards — the ` +
        `empty-roster refusal ("empty roster — the gate decided skip; do not materialize") and the roster ` +
        `path's survivors check ("a zero-lens review is the empty-roster shape the door refuses", proven ` +
        `refusing in the premise above) — and YES by the plain path: for a legal-TOML template whose parse ` +
        `reads ZERO stage units, prepareReview returned ok=${String(r.ok)} (code=${r.ok ? "-" : String((r as { code?: number }).code)}) ` +
        `and wrote data/review/lenses.txt = ${handoff} — the empty handoff the run's own intake gate exits 1 on ` +
        `("missing or empty handoff … this is a door bug; report it"). The program is dead on arrival by ` +
        `construction, but only AFTER a job is booked — the four-late shape the door's pre-flight screens ` +
        `exist to prevent, carrying a receipt that blames the door. The template needs no roster to reach ` +
        `this path: any --template without stage units takes it. Refuse at the door (code 2, naming the ` +
        `zero-unit template), like both twins already do.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
