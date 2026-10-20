import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { combineFirstPrompt, memberProtocol, parseMembers, parseMessage, readMessages, relayPlan } from "../src/engines/coworker.ts"

test("members parse from [members.<name>] with model, seed, and initiates", () => {
  const toml = [
    '[workflow]',
    'name = "ui"',
    'kind = "coworker"',
    "",
    '[members.backend]',
    'model = "opencode-go/glm-5.3"',
    'initiates = true',
    "",
    '[members.frontend]',
    'model = "opencode-go/glm-5.3-flash"',
    'seed_tool = "pi"',
    'seed_session = "uuid-old"',
  ].join("\n")
  const members = parseMembers(toml)
  assert.deepEqual(
    members.map((m) => m.name),
    ["backend", "frontend"],
  )
  assert.equal(members[0].model, "opencode-go/glm-5.3")
  assert.equal(members[0].initiates, true)
  assert.equal(members[1].initiates, undefined)
  assert.equal(members[1].seed?.session_id, "uuid-old")
  assert.throws(() => parseMembers('[members."bad name"]\n'), /shep-safe/)
  assert.throws(() => parseMembers('[members.a]\nmodel = "glm53"\n'), /provider\/model/)
  assert.throws(() => parseMembers('[members.a]\nseed_tool = "pi"\n'), /seed_tool and seed_session/)
})

test("a held member wakes on brief + first message, split by -----", () => {
  const text = combineFirstPrompt("You are frontend.", "backend", "server up on 8787")
  const [brief, relay] = text.split("\n\n-----\n\n")
  assert.equal(brief, "You are frontend.")
  assert.match(relay, /\[relay\] from backend:/)
  assert.match(relay, /server up on 8787/)
})

test("a message must come from a member, name a member, and match its filename", () => {
  const ok = parseMessage("0001-backend.json", JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "api up" }), [
    "backend",
    "frontend",
  ])
  assert.equal("why" in ok ? "bad" : ok.to, "frontend")
  const cases: [string, string, RegExp][] = [
    ["0001-impostor.json", JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "x" }), /filename sender/],
    ["0001-backend.json", JSON.stringify({ from: "backend", to: "stranger", type: "note", body: "x" }), /to is not a member/],
    ["0001-backend.json", JSON.stringify({ from: "backend", to: "backend", type: "note", body: "x" }), /to itself/],
    ["0001-backend.json", JSON.stringify({ from: "backend", to: "frontend", type: "urgent", body: "x" }), /note or stop/],
    ["0001-backend.json", JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "  " }), /body is empty/],
    ["zero-backend.json", JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "x" }), /seq/],
  ]
  for (const [file, raw, why] of cases) assert.match((parseMessage(file, raw, ["backend", "frontend"]) as { why: string }).why, why)
})

test("a refusal carries its sender when attributable — the 2026-10-12 wave-2 matrix", () => {
  const members = ["backend", "frontend"]
  // KR's bug: valid filename, broken JSON (a trailing }) — the
  // filename names the sender
  const kr = parseMessage("0005-backend.json", '{"from":"backend","to":"frontend"} }', members) as { why: string; from?: string }
  assert.match(kr.why, /not JSON/)
  assert.equal(kr.from, "backend")
  // JP's bug: a topic where the sender belongs — the payload names him
  const jp = parseMessage("0003-pipeline-topic.json", JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "x" }), members) as { why: string; from?: string }
  assert.match(jp.why, /filename sender/)
  assert.equal(jp.from, "backend")
  // TW's bug: seq starts at 0 — sender from the payload
  const tw = parseMessage("0-backend.json", JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "x" }), members) as { why: string; from?: string }
  assert.match(tw.why, /seq/)
  assert.equal(tw.from, "backend")
  // unattributable: broken JSON behind a stranger's filename — the raw
  // filename guess survives for the log; the nudge site filters it
  const anon = parseMessage("0007-stranger.json", "{not json", members) as { why: string; from?: string }
  assert.equal(anon.from, "stranger")
})

test("readMessages sorts by seq and separates the refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-msgs-"))
  writeFileSync(join(dir, "0002-frontend.json"), JSON.stringify({ from: "frontend", to: "backend", type: "note", body: "styling done" }))
  writeFileSync(join(dir, "0001-backend.json"), JSON.stringify({ from: "backend", to: "frontend", type: "note", body: "framework up" }))
  writeFileSync(join(dir, "0003-frontend.json"), "{not json")
  const { messages, bad } = readMessages(dir, ["backend", "frontend"])
  assert.deepEqual(
    messages.map((m) => m.seq),
    [1, 2],
  )
  assert.equal(bad.length, 1)
})

test("the relay plan delivers to the named pane only, then honors stop and cap", () => {
  const messages = [
    { file: "0001-backend.json", seq: 1, from: "backend", to: "frontend", type: "note", body: "a" },
    { file: "0002-frontend.json", seq: 2, from: "frontend", to: "backend", type: "note", body: "b" },
  ] as const
  const first = relayPlan([...messages], [], 40)
  assert.deepEqual(
    first.relays.map((r) => r.to),
    ["frontend", "backend"],
  )
  assert.equal(first.stop, false)
  // delivered messages do not re-deliver
  const second = relayPlan([...messages], ["0001-backend.json"], 40)
  assert.deepEqual(
    second.relays.map((r) => r.file),
    ["0002-frontend.json"],
  )
  // a stop message ends the exchange
  const stopped = relayPlan(
    [...messages, { file: "0003-backend.json", seq: 3, from: "backend", to: "frontend", type: "stop", body: "done" }],
    ["0001-backend.json", "0002-frontend.json"],
    40,
  )
  assert.equal(stopped.stop, true)
  assert.equal(stopped.why, "stop")
  assert.equal(stopped.relays.length, 0)
  // the cap ends it too — every retry surface is capped
  const capped = relayPlan([...messages], [], 2)
  assert.equal(capped.stop, true)
  assert.equal(capped.why, "cap")
})

test("the member protocol names the wire format and forbids peer-writing", () => {
  const text = memberProtocol("backend", ["frontend"], "/run")
  assert.match(text, /"from":"backend"/)
  assert.match(text, /Never write a peer's message file/)
  assert.match(text, /messages/)
})

test("members may pre-declare external roots; bad ones fail the run", () => {
  const members = parseMembers('[members.reviewer]\nroots = ["~/.vista", "/opt/data"]\n')
  assert.deepEqual(members[0]!.roots, ["~/.vista", "/opt/data"])
  // a relative root is a typo, not a grant — refuse before any spawn
  assert.throws(() => parseMembers('[members.a]\nroots = ["relative/path"]\n'), /absolute or ~-relative/)
  assert.throws(() => parseMembers('[members.a]\nroots = []\n'), /roots list is empty/)
  // a member without the key stays bare
  assert.equal(parseMembers("[members.b]\n")[0]!.roots, undefined)
})
