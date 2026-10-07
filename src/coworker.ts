// Coworker (zen 6): panes that talk through the rail. This is the pure
// half — member parsing, message parsing, and the relay plan. The body
// (birth, prompt, retire, report) lives in bin/lab-orchestrator.
// A worker never writes another worker: the plan only ever names
// prompts the RAIL delivers.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type SeedSpec = { tool: string; session_id: string; since?: string }

export type Member = { name: string; model?: string; seed?: SeedSpec }

const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/

// [members.<name>] with optional model = "provider/model" and an
// optional fork seed (seed_tool + seed_session [+ seed_since]).
export function parseMembers(toml: string): Member[] {
  const members: Member[] = []
  const seen = new Set<string>()
  // a typo'd or unsafe member header must fail the run, not vanish it
  const loose = /^\s*\[members(\.[^\]]*)?\]\s*$/gm
  const strict = /^\s*\[members\.([a-z0-9_-]+)\]\s*$/
  let scan: RegExpExecArray | null
  while ((scan = loose.exec(toml))) {
    if (!strict.test(scan[0])) throw new Error(`member header is not [members.<shep-safe-name>]: ${scan[0].trim()}`)
  }
  const section = /^\s*\[members\.([a-z0-9_-]+)\]\s*$/gm
  let head: RegExpExecArray | null
  const heads: { name: string; at: number }[] = []
  while ((head = section.exec(toml))) heads.push({ name: head[1], at: head.index })
  for (let i = 0; i < heads.length; i++) {
    const body = toml.slice(heads[i].at, i + 1 < heads.length ? heads[i + 1].at : undefined)
    const name = heads[i].name
    if (!SHEP_SAFE_ID.test(name)) throw new Error(`member name is not shep-safe: ${name}`)
    if (seen.has(name)) throw new Error(`member repeats: ${name}`)
    seen.add(name)
    const model = body.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1]
    if (model !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(model)) {
      throw new Error(`members.${name}.model must be provider/model: ${model}`)
    }
    const seedTool = body.match(/^\s*seed_tool\s*=\s*"([^"]+)"/m)?.[1]
    const seedSession = body.match(/^\s*seed_session\s*=\s*"([^"]+)"/m)?.[1]
    const seedSince = body.match(/^\s*seed_since\s*=\s*"([^"]+)"/m)?.[1]
    let seed: SeedSpec | undefined
    if (seedTool !== undefined || seedSession !== undefined) {
      if (seedTool === undefined || seedSession === undefined) {
        throw new Error(`members.${name} seed needs both seed_tool and seed_session`)
      }
      seed = { tool: seedTool, session_id: seedSession, ...(seedSince ? { since: seedSince } : {}) }
    }
    members.push({ name, ...(model ? { model } : {}), ...(seed ? { seed } : {}) })
  }
  return members
}

export type Message = {
  file: string
  seq: number
  from: string
  to: string
  type: "note" | "stop"
  body: string
}

export type BadMessage = { file: string; why: string }

// One message file: <seq>-<from>.json holding {from, to, type, body}.
// from must match the filename; to must be a member — a message to a
// stranger is refused, never relayed.
export function parseMessage(file: string, raw: string, members: string[]): Message | BadMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { file, why: "not JSON" }
  }
  const m = parsed as { from?: unknown; to?: unknown; type?: unknown; body?: unknown }
  const base = file.replace(/^.*\//, "")
  const name = base.replace(/\.json$/, "")
  const seq = Number(name.split("-")[0])
  const from = base.split("-").slice(1).join("-").replace(/\.json$/, "") || undefined
  if (typeof m.from !== "string" || typeof m.to !== "string") return { file, why: "from and to must be strings" }
  if (from !== m.from) return { file, why: `filename sender ${from ?? "(none)"} does not match from ${m.from}` }
  if (!Number.isInteger(seq) || seq < 1) return { file, why: `seq is not a positive integer: ${name.split("-")[0]}` }
  if (!members.includes(m.from)) return { file, why: `from is not a member: ${m.from}` }
  if (!members.includes(m.to)) return { file, why: `to is not a member: ${m.to}` }
  if (m.from === m.to) return { file, why: `a message to itself: ${m.from}` }
  if (m.type !== "note" && m.type !== "stop") return { file, why: `type must be note or stop: ${String(m.type)}` }
  if (typeof m.body !== "string" || m.body.trim() === "") return { file, why: "body is empty" }
  return { file, seq, from: m.from, to: m.to, type: m.type, body: m.body }
}

export function readMessages(dir: string, members: string[]): { messages: Message[]; bad: BadMessage[] } {
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort()
  } catch {
    return { messages: [], bad: [] }
  }
  const messages: Message[] = []
  const bad: BadMessage[] = []
  for (const name of names) {
    const parsed = parseMessage(name, readFileSync(join(dir, name), "utf8"), members)
    if ("why" in parsed) bad.push(parsed)
    else messages.push(parsed)
  }
  messages.sort((a, b) => a.seq - b.seq || a.file.localeCompare(b.file))
  return { messages, bad }
}

export type Relay = { file: string; from: string; to: string; body: string }

export type RelayPlan = {
  relays: Relay[]
  stop: boolean
  why?: "stop" | "cap"
  refused: BadMessage[]
}

// The relay plan: pending (not yet delivered) messages become prompts
// to the named pane — only the rail delivers them. A stop message ends
// the exchange; so does the cap (every retry surface is capped).
export function relayPlan(messages: Message[], delivered: string[], cap: number): RelayPlan {
  const done = new Set(delivered)
  const pending = messages.filter((m) => !done.has(m.file))
  const stopMsg = pending.find((m) => m.type === "stop")
  const capped = messages.length >= cap
  const relays: Relay[] = pending
    .filter((m) => m.type !== "stop")
    .map((m) => ({ file: m.file, from: m.from, to: m.to, body: m.body }))
  return {
    relays,
    stop: stopMsg !== undefined || capped,
    why: stopMsg ? "stop" : capped ? "cap" : undefined,
  }
}

// The protocol every member brief carries: how to talk. The program's
// brief stays task-pure; the rail appends the wire format.
export function memberProtocol(name: string, peers: string[], dir: string): string {
  return [
    "",
    "--- relay protocol (the rail appends this; it is law) ---",
    `You are member ${name} of a coworker job. Peers: ${peers.join(", ")}.`,
    `A message from a peer arrives as a prompt from the rail, prefixed [relay].`,
    "To reply, write a JSON file in messages/ (absolute path):",
    `${join(dir, "messages", "<seq>-${name}.json")}`,
    `with {"from":"${name}","to":"<peer>","type":"note","body":"..."}.`,
    "<seq> is the highest existing seq plus one (look at messages/ first).",
    'When the exchange has fully reached its goal, write type "stop" with a',
    "one-paragraph summary as body, addressed to any peer. Never prompt or",
    "message a peer any other way. Never write a peer's message file.",
    "Everything you build goes in the target tree the task names.",
  ].join("\n")
}
