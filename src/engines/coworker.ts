// Coworker (zen 6): panes that talk through the rail. This is the pure
// half — member parsing, message parsing, and the relay plan. The body
// (birth, prompt, retire, report) lives in src/coworker-run.ts.
// A worker never writes another worker: the plan only ever names
// prompts the RAIL delivers.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type SeedSpec = { tool: string; session_id: string; since?: string }

// roots: external paths (~ works) a member's work legitimately needs
// OUTSIDE the job tree — declared up front so the dialogs never fire
// (a granted root is only read at session start; answering mid-run
// spends the sweep). A vista reviewer names ~/.vista here.
export type Member = { name: string; model?: string; seed?: SeedSpec; initiates?: boolean; roots?: string[] }

const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/

// [members.<name>] with optional model = "provider/model", an
// optional fork seed (seed_tool + seed_session [+ seed_since]), and
// optional pre-declared external roots (roots = ["~/.vista", …]).
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
    const initiates = /^\s*initiates\s*=\s*true\s*$/m.test(body)
    const rootsBody = body.match(/^\s*roots\s*=\s*\[([^\]]*)\]/m)?.[1]
    let roots: string[] | undefined
    if (rootsBody !== undefined) {
      roots = [...rootsBody.matchAll(/"([^"]+)"/g)].map((m) => m[1])
      if (roots.length === 0) throw new Error(`members.${name} roots list is empty`)
      for (const root of roots) {
        if (!root.startsWith("/") && !root.startsWith("~/") && root !== "~") {
          throw new Error(`members.${name} root must be absolute or ~-relative: ${root}`)
        }
      }
    }
    let seed: SeedSpec | undefined
    if (seedTool !== undefined || seedSession !== undefined) {
      if (seedTool === undefined || seedSession === undefined) {
        throw new Error(`members.${name} seed needs both seed_tool and seed_session`)
      }
      seed = { tool: seedTool, session_id: seedSession, ...(seedSince ? { since: seedSince } : {}) }
    }
    members.push({
      name,
      ...(model ? { model } : {}),
      ...(seed ? { seed } : {}),
      ...(initiates ? { initiates: true } : {}),
      ...(roots ? { roots } : {}),
    })
  }
  return members
}

// The first prompt a non-initiating member ever receives: its brief and
// the first relayed message arrive TOGETHER, split by a ----- line, so
// the member wakes straight into work — no context read, no polling,
// no sleep loop. The rail is the watcher; the member is idle until mail.
export function combineFirstPrompt(brief: string, from: string, body: string): string {
  return `${brief}\n\n-----\n\n[relay] from ${from}:\n\n${body}`
}

export type Message = {
  file: string
  seq: number
  from: string
  to: string
  type: "note" | "stop"
  body: string
}

// A refusal carries its sender when attributable — the payload's from
// when the JSON parsed, else the filename's sender slot. The nudge
// ladder quotes refusals AT their sender (the 2026-10-12 wave-2 fix:
// members died at the nudge cap without ever being told why their
// mail was refused). A best guess that names a stranger is filtered
// at the use site.
export type BadMessage = { file: string; why: string; from?: string }

// One message file. TWO layouts, both read forever:
//  - OUTBOX (zen 7): messages/<owner>/<seq>.json — identity is the
//    FOLDER; the from field must equal the folder's owner. A file in
//    alice's outbox claiming from bob is refused: the sender identity
//    is where the file lives, not what its bytes claim.
//  - LEGACY: messages/<seq>-<from>.json — identity is the filename's
//    sender slot (both bytes attacker-writable in the shared folder);
//    kept so parked runs resume their old mail unchanged.
// from must be a member; to must be a member — a message to a stranger
// is refused, never relayed.
export function parseMessage(file: string, raw: string, members: string[]): Message | BadMessage {
  const rel = file.replace(/^.*[\/]messages[\/]/, "")
  const parts = rel.replace(/\.json$/, "").split("/")
  const owner = parts.length === 2 ? parts[0] : undefined
  const base = parts[parts.length - 1]
  const seq = Number(base.split("-")[0])
  const from = owner !== undefined ? owner : base.split("-").slice(1).join("-") || undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { file, why: "not JSON", from }
  }
  const m = parsed as { from?: unknown; to?: unknown; type?: unknown; body?: unknown }
  if (typeof m.from !== "string" || typeof m.to !== "string")
    return { file, why: "from and to must be strings", from: typeof m.from === "string" ? m.from : from }
  if (from !== m.from)
    return {
      file,
      why: owner !== undefined
        ? `from ${m.from} does not match its outbox folder ${owner} — sender identity is the folder, never the bytes`
        : `filename sender ${from ?? "(none)"} does not match from ${m.from}`,
      from: m.from,
    }
  if (!Number.isInteger(seq) || seq < 1) return { file, why: `seq is not a positive integer: ${base.split("-")[0]}`, from: m.from }
  if (!members.includes(m.from)) return { file, why: `from is not a member: ${m.from}`, from: m.from }
  if (!members.includes(m.to)) return { file, why: `to is not a member: ${m.to}`, from: m.from }
  if (m.from === m.to) return { file, why: `a message to itself: ${m.from}`, from: m.from }
  if (m.type !== "note" && m.type !== "stop") return { file, why: `type must be note or stop: ${String(m.type)}`, from: m.from }
  if (typeof m.body !== "string" || m.body.trim() === "") return { file, why: "body is empty", from: m.from }
  return { file, seq, from: m.from, to: m.to, type: m.type, body: m.body }
}

export function readMessages(dir: string, members: string[]): { messages: Message[]; bad: BadMessage[] } {
  const files: string[] = []
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".json")) files.push(e.name)
      // outbox layout: messages/<owner>/<seq>.json — the relative path
      // rides into parseMessage so the folder IS the identity
      else if (e.isDirectory()) {
        for (const f of readdirSync(join(dir, e.name))) {
          if (f.endsWith(".json")) files.push(`${e.name}/${f}`)
        }
      }
    }
  } catch {
    return { messages: [], bad: [] }
  }
  const messages: Message[] = []
  const bad: BadMessage[] = []
  for (const name of files.sort()) {
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

// The relay delivery ledger (ADR 5 / M2): outliving memory for the
// relay — which message files have already been injected into panes,
// and which were refused. Committed after each delivery, so a crash
// re-delivers at worst (a duplicate prompt), never loses mail.
// RefusedDetail rides the ledger so a resumed run (ADR 5 continue)
// still knows WHY each file was refused — the nudge quotes survive
// the park. Additive: old relay.json files load without it.
export type RefusedDetail = { file: string; why: string; from?: string }

export type RelayLedger = { delivered: string[]; refused: string[]; refusedDetail?: RefusedDetail[] }

export function readRelayLedger(taskDir: string): RelayLedger {
  try {
    const parsed = JSON.parse(readFileSync(join(taskDir, "relay.json"), "utf8")) as Partial<RelayLedger>
    return {
      delivered: parsed.delivered ?? [],
      refused: parsed.refused ?? [],
      refusedDetail: Array.isArray(parsed.refusedDetail) ? parsed.refusedDetail : [],
    }
  } catch {
    return { delivered: [], refused: [], refusedDetail: [] }
  }
}

export function writeRelayLedger(taskDir: string, ledger: RelayLedger): void {
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, "relay.json"), JSON.stringify(ledger, null, 2))
}

// Who was mid-turn when the run parked (ADR 5): the member that took
// the last delivered mail and never answered. Derived purely from disk
// — no booking needed at park time, so even a SIGKILLed orchestrator
// yields the answer. No deliveries yet: the initiator holds the ball.
export function interruptedMember(messages: Message[], delivered: string[], initiator?: string): string | null {
  if (delivered.length === 0) return initiator ?? null
  const last = messages.find((m) => m.file === delivered[delivered.length - 1])
  if (!last) return null
  const answered = messages.some((m) => m.from === last.to && m.seq > last.seq)
  return answered ? null : last.to
}

// The protocol every member brief carries: how to talk. The program's
// brief stays task-pure; the rail appends the wire format.
export function memberProtocol(name: string, peers: string[], dir: string): string {
  return [
    "",
    "--- relay protocol (the rail appends this; it is law) ---",
    `You are member ${name} of a coworker job. Peers: ${peers.join(", ")}.`,
    `A message from a peer arrives as a prompt from the rail, prefixed [relay].`,
    "You never poll messages/, never wait in a loop — the rail watches the",
    "folder and wakes you. Between prompts: work, or idle.",
    "To reply, write a JSON file in YOUR outbox (absolute path):",
    `${join(dir, "messages", name, "<seq>.json")}`,
    `with {"from":"${name}","to":"<peer>","type":"note","body":"..."}.`,
    "Your outbox folder is yours alone — NEVER write into a peer's outbox;",
    "your identity is the folder the file lives in, and the rail refuses a",
    "file whose from does not match its folder.",
    "<seq> is the highest existing seq across EVERY outbox in messages/",
    "(look at all of messages/ first, not just your own folder), plus one.",
    'When the exchange has fully reached its goal, write type "stop" with a',
    "one-paragraph summary as body, addressed to any peer. Never prompt or",
    "message a peer any other way. Never write a peer's message file.",
    "Everything you build goes in the target tree the task names.",
  ].join("\n")
}
