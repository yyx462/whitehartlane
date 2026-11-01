import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest } from "../../src/doors/hooks.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

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

// A MIXED template: a fan-out units stage (no pins — the door's units
// question is silent about it) plus a coworker exchange whose MEMBERS
// carry temperature pins. Every seat here is first-class: --template is
// a door flag, coworker is a declared topology, and members[].temperature
// is a VALIDATED field (hooks.ts:159-163 "per-mind model settings;
// opencode pins it in the sandbox config"). No model anywhere.
function memberPinnedTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "p60"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `units = [`,
      `  { id = "principles", brief = "p" },`,
      "]",
      "",
      "[[stage]]",
      `id = "exchange"`,
      `topology = "coworker"`,
      "members = [",
      `  { name = "alice", brief = "a", initiates = true, temperature = 0.2 },`,
      `  { name = "bob", brief = "b", temperature = 0.7 },`,
      "]",
      "",
    ].join("\n"),
  )
  return where
}

// INV-3 / INV-4 — "does this program pin a temperature that needs a
// model to ride?" is ONE decision, and this diff moved it to the door
// ("The MISSING-model refusal lives at the door now (pre-materialization)",
// src/doors/review.ts) — but seated it at pinsUnitTemperature
// (review.ts:489-494), which walks stage[].units[] ONLY. The run-time's
// enforcement is WIDER: member temperature rides rail.inhabitPane
// (coworker-run.ts:215/259) into the SHARED host.inhabit birth path,
// which REFUSES any temperature spawn with no model to pin against
// (opencode-host.ts:85-99, "no unit/stage/workflow model — refusing
// spawn"). BASE answered the door's question textually over the WHOLE
// document (/\btemperature\s*=/) — over-broad ([physics] data tripped
// it, the tests-6101 false refusal), but it DID catch member pins.
// This diff narrowed the question to units and DROPPED the member seat:
// a member-pinned template now materializes ok:true with no model, and
// the run dies at member birth on exactly the infra the door move
// promised to catch before materialization. (The model-less audit-levy
// arm inherits the same hole: stripTemperaturePins speaks units too, so
// bin's receipt "temperature pins dropped; the lenses run untuned" is
// false whenever member pins ride.)
//
// tests-6101's law is not in tension: [physics] is read by NOBODY, so
// refusing on it had a false premise; members[].temperature IS read —
// by the engine, and enforced by the host. The door's question must
// cover every seat its consumers enforce: units AND members.
test("member temperature pins with no model are refused at the door, not at member birth", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p60-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = memberPinnedTemplate(join(tmp, "tpl"))

    // premise: the run-time's own manifest read ACCEPTS the member pins —
    // they are live, validated fields, not dead weight
    const manifest = loadManifest(tpl)
    const members = manifest.stages?.find((s) => s.id === "exchange")?.members ?? []
    assert.deepEqual(
      members.map((m) => ({ name: m.name, temperature: m.temperature })),
      [
        { name: "alice", temperature: 0.2 },
        { name: "bob", temperature: 0.7 },
      ],
      "premise: hooks accepts members[].temperature — the pins reach the engine",
    )

    const out = join(tmp, "program") // must NOT exist beforehand
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      !r.ok,
      `INV-3/INV-4: the door materialized (ok=${String(r.ok)}) a program whose coworker MEMBERS pin ` +
        `temperature (alice 0.2, bob 0.7) with NO model anywhere. The "pins need a model" decision lives in ` +
        `two places with different scopes: the door asks pinsUnitTemperature (src/doors/review.ts:489-494, ` +
        `stage[].units[] ONLY) while the run-time enforces it for EVERY pane — member temperature rides ` +
        `rail.inhabitPane (src/engines/coworker-run.ts:215,259) into the shared host.inhabit birth, which ` +
        `refuses any temperature spawn with no unit/stage/workflow model (src/adapters/opencode-host.ts:95). ` +
        `BASE refused this template at the door (the textual /\\btemperature\\s*=/ covered members); this ` +
        `diff narrowed the question to units (the tests-6101 fix for unread tables like [physics]) and ` +
        `dropped the member seat — so the door's own claim ("the MISSING-model refusal lives at the door ` +
        `now, pre-materialization") is false for members, and the review dies at member birth on infra the ` +
        `door was moved to catch. The door must ask the question its consumers enforce: units AND members ` +
        `(got: ${"ok:true"}).`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const mat = readFileSync(join(r.dir, "workflow.toml"), "utf8")
      assert.match(
        mat,
        /temperature = 0\.2/,
        "the materialized program carries the member pin that will be refused at member birth",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
