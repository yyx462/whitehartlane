#!/usr/bin/env node
// tools/send.mjs — THE SEND TOOL (zen 7 / ADR 0016 slice 5): the only
// sanctioned sender. A member runs it from its own sandbox; identity
// is the FOLDER (the #202 law — never bytes you typed), the tool
// assigns the sequence across every outbox, and it refuses anything
// that would write outside YOUR mailbox.
//
//   node tools/send.mjs <peer> <note|stop> <body text>
//
// (staged into the run tree by the coworker engine; the roster beside
// it names the legal recipients)
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"

const me = basename(process.cwd())
const messages = resolve(process.cwd(), "..", "..", "messages")
const roster = existsSync(resolve(messages, "..", "tools", "roster.txt"))
  ? readFileSync(resolve(messages, "..", "tools", "roster.txt"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  : []

const die = (why) => {
  console.error(`send: ${why}`)
  process.exit(1)
}

const [to, type, ...bodyParts] = process.argv.slice(2)
const body = bodyParts.join(" ").trim()
if (!to || !type || !body) die("usage: node tools/send.mjs <peer> <note|stop> <body text>")
if (type !== "note" && type !== "stop") die(`type must be note or stop, got ${type}`)
if (roster.length > 0 && !roster.includes(to)) die(`${to} is not a member of this exchange (roster: ${roster.join(", ")})`)
if (to === me) die("you cannot message yourself")

// the sequence: highest across EVERY outbox, plus one (the wire law)
let seq = 0
try {
  for (const entry of readdirSync(messages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const f of readdirSync(resolve(messages, entry.name))) {
      const n = Number(f.replace(/\.json$/, ""))
      if (Number.isFinite(n) && n > seq) seq = n
    }
  }
} catch {
  /* an empty messages/ starts at 1 */
}
seq += 1

const outbox = resolve(messages, me)
mkdirSync(outbox, { recursive: true })
const file = resolve(outbox, `${seq}.json`)
const tmp = resolve(outbox, `.tmp-${seq}.json`)
const note = { from: me, to, type, body }
writeFileSync(tmp, JSON.stringify(note) + "\n")
renameSync(tmp, file) // atomic — the rail never reads a half-written mail
console.log(`send: filed ${basename(file)} in your outbox (${me} -> ${to}, ${type})`)
