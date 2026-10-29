import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

// the gate's ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests602-store-"))
process.env.AGENTIC_OS_NOTIFY = "0"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape: the audit levy is this diff's own addition — nothing to judge there
const HEAD_HAS_AUDIT = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")

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

function seedDocs(where: string): void {
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
}

// ── THE LAW (arm 2's own contract): the [[stage.<array>]] temperature
// strip drops temperature-key LINES inside a unit/member block — but its
// identity capture demands the `id`/`name` line BEFORE the temperature
// line (`blockIdentity` is null until the id/name line is seen; a
// temperature line ahead of it matches nothing and is kept). TOML key
// order inside a table is FREE — `temperature` first is legal TOML the
// door's own parse reads as the identical document. The post-strip
// verify then finds the surviving pin and the model-less dropout audit
// dead-ends at its own verify: "could not strip every pin … this is a
// door bug; report it" — no program, no verdict, no label, the ledger
// row already claims audit:true — the audit measures nothing while
// printing that it does (the tests-401/tests-5002/momentum-15 harm,
// one key-order spelling later). tests-5002 fixed the VALUE grammar
// (the parse decides numbers); the IDENTITY capture is still
// text-order-bound — the strip does not speak the parser's grammar
// where order is concerned.
const shapes: [string, string][] = [
  [
    "a [[stage.units]] block whose temperature line precedes its id line",
    [
      "[workflow]",
      `name = "t602a"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "",
      "[[stage.units]]",
      "temperature = 0.2",
      `id = "principles"`,
      `brief = "p"`,
      "[[stage.units]]",
      "temperature = 0.4",
      `id = "tests"`,
      `brief = "t"`,
      "",
    ].join("\n"),
  ],
  [
    "a [[stage.members]] block whose temperature line precedes its name line (the coworker twin, gate-r25)",
    [
      "[workflow]",
      `name = "t602b"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `units = [{ id = "principles", brief = "p" }]`,
      "",
      "[[stage]]",
      `id = "exchange"`,
      `topology = "coworker"`,
      "",
      "[[stage.members]]",
      "temperature = 0.2",
      `name = "alice"`,
      `brief = "a"`,
      "initiates = true",
      "[[stage.members]]",
      "temperature = 0.7",
      `name = "bob"`,
      `brief = "b"`,
      "",
    ].join("\n"),
  ],
]

for (const [label, toml] of shapes) {
  test(`a model-less dropout audit strips pins regardless of key order (${label})`, () => {
    if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge

    const tmp = mkdtempSync(join(tmpdir(), "whl-t602-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = join(tmp, "tpl")
      mkdirSync(tpl, { recursive: true })
      seedDocs(tpl)
      writeFileSync(join(tpl, "workflow.toml"), toml)

      // PREMISE — the consumer's own read: the parse reads the same pin
      // whichever order the lines stand in, and the pin has no model to
      // ride (no entry/stage/workflow model, no --model on an audited skip)
      const parsed = parseToml(toml) as {
        stage?: Array<{ units?: Array<{ id?: string; temperature?: unknown }>; members?: Array<{ name?: string; temperature?: unknown }> }>
      }
      const unitPins = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).filter((u) => "temperature" in u).map((u) => u.id))
      const memberPins = (parsed.stage ?? []).flatMap((s) => (s.members ?? []).filter((m) => "temperature" in m).map((m) => m.name))
      const pinned = [...unitPins, ...memberPins].filter((x): x is string => typeof x === "string")
      assert.ok(pinned.length > 0, `premise: the parse reads the pinned entries (${label}): ${JSON.stringify(pinned)}`)
      assert.equal(
        (parsed as { workflow?: { model?: string } }).workflow?.model,
        undefined,
        "premise: no workflow model — the pins have nothing to ride",
      )

      // the bin's exact shape for an audited skip: no model, auditLevy set
      const r = prepareReview(
        { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok,
        `INV-4 (the dropout law: "the skip region is never unmeasured") / the strip's own grammar law ` +
          `(tests-5002: "the strip speaks the parser's grammar"): the model-less dropout audit refused ` +
          `(ok=${String(r.ok)}, code=${r.ok ? "-" : String((r as { code?: number }).code)}): ` +
          `${JSON.stringify(r.ok ? "" : (r as { why?: string }).why)}. The [[stage.<array>]] temperature strip ` +
          `captures the block identity from the id/name line and only drops temperature lines AFTER it — but TOML ` +
          `key order inside a table is free, and these blocks declare temperature BEFORE the identity line: legal ` +
          `TOML the door's own parse reads as the identical pinned document (premise above: pins on ` +
          `${JSON.stringify(pinned)}). The strip misses them, the post-strip verify finds the survivors, and the ` +
          `audit dead-ends at its own verify ("this is a door bug; report it"): no program, no verdict, no label, ` +
          `no greens — while the ledger row already claims action:"skip" + audit:true. The audit measures nothing ` +
          `while printing that it does, over a key ORDER. Identity capture must be order-free (parse-driven, like ` +
          `the inline arm), or the arm must locate the pin lines by the parse, not by line position.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const mat = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
        const parsedOut = parseToml(mat) as typeof parsed
        const survivors = (parsedOut.stage ?? []).flatMap((s) => [
          ...(s.units ?? []).filter((u) => "temperature" in u).map((u) => `units:${u.id}`),
          ...(s.members ?? []).filter((m) => "temperature" in m).map((m) => `members:${m.name}`),
        ])
        assert.deepEqual(
          survivors,
          [],
          `the audit's receipt ("temperature pins dropped; the lenses run untuned") must be true of the materialized bytes — pins survived: ${JSON.stringify(survivors)}`,
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    }
  })
}
