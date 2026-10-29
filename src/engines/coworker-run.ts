// The coworker engine. Members talk through the rail: this loop
// births each named member with its own brief and model, relays
// message files as prompts to the named pane, ends on stop or the
// cap, then reports. The privilege sweep, pane bookkeeping, and
// layout all live on the Rail; the runner door picks this engine by
// shape (src/engine.ts). Member supervision is the flight bench's
// member court (below) — the second customer of #181's bench, folded
// onto it from a hand-rolled nudge/stall ladder.
import { execSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { memberProtocol, parseMembers, readMessages, relayPlan, combineFirstPrompt, interruptedMember, readRelayLedger, writeRelayLedger } from "./coworker.ts"
import { opencodeSessionActiveSince } from "../adapters/transcripts.ts"
import { readModelsFile } from "../jev/model-ladder.ts"
import { chooseModel } from "../jev/model-chooser.ts"
import { runFaultLane } from "./fault-lane.ts"
import { runCounts } from "../doors/hooks.ts"
import { emptyBoard } from "../core/lanes.ts"
import { drainDeadline } from "../adapters/levy.ts"
import { waitChange, type Rail } from "../adapters/rail.ts"
import { writeReport, type Report } from "../core/report.ts"
// the flight bench's protocol (#181) — this engine's member court is
// its second customer (OPTIMUM §2's one named residual, folded)
import { firstRuling, type Judge, type Ruling } from "./orchestrator.ts"
import type { AgentStatus } from "../ports/agent-host.ts"

// The door checkout root — where the operator's global models.local.toml
// lives (layer 3 of the policy ladder).
const DOOR_ROOT = join(import.meta.dirname, "..", "..")

// ADR 0016 slice 1 — the station hosting contract: a coworker STAGE in
// a chain runs THIS engine in-process at stations/<S>/ instead of a
// minted child job. The station passes its members (from the stage
// declaration — the station is a folder, never program bytes), its
// worker kind, and its retry cap; the engine owns briefs/, messages/,
// work/, relay.json under the station dir exactly as a standalone run
// owns them at the root.
export type StationSpec = {
  dir: string
  members: import("./coworker.ts").Member[]
  workerKind: string
  retry?: number
  // The station twin of #198's audit-before-retire: the coworker
  // stage's own `check`, run IN-EXCHANGE at the stop while every
  // member pane still lives — red hands the check's first stderr line
  // to the stop's author for ONE revise round; a second red ends the
  // exchange honestly (the verdict row rides the report, the parent
  // fails the step). Before, the parent ran it AFTER the exchange
  // returned — i.e. after every member pane was already retired, so a
  // red check could only fail the step, never be fixed by the minds
  // that caused it.
  check?: string
  // The check's cwd: the PARENT task dir (where the stage was
  // declared), NOT the station dir — stage checks are authored
  // parent-relative ("stations/<id>/data/...", "hooks/..."), and
  // delivery-promotion checks (transfer-window's accept-plan.sh) write
  // into the parent's data/. Absent = the station dir.
  checkCwd?: string
}

export async function runCoworker(
  rail: Rail,
  opts: { stallMs?: number; beatMs?: number; graceMs?: number; station?: StationSpec } = {},
): Promise<Report | null> {
  const taskDir = opts.station?.dir ?? rail.taskDir
  const log = rail.log
  const ledger = rail.ledger
  // a hosted station carries its members in the spec (the stage
  // declaration IS the program); a standalone run parses its own toml
  const members = opts.station?.members ?? parseMembers(readFileSync(join(rail.taskDir, "workflow.toml"), "utf8"))
  const toml = opts.station ? "" : readFileSync(join(rail.taskDir, "workflow.toml"), "utf8")
  if (members.length < 2) {
    throw new Error("coworker needs at least two [members.*]")
  }
  const manifest = rail.manifest()
  const memberKind = opts.station?.workerKind ?? manifest.workflow.worker_kind
  const names = members.map((m) => m.name)
  if (!members.some((m) => m.initiates)) {
    throw new Error("coworker needs one member with initiates = true — otherwise everyone idles and the exchange never starts")
  }
  // ADR 5 / M2: the relay ledger is outliving memory — deliveries and
  // refusals survive the orchestrator; pending mail redelivers by it.
  const relayLedger = readRelayLedger(taskDir)
  const delivered = [...relayLedger.delivered]
  // the mail ledger's memory: files already accounted (a resumed run
  // pre-seeds from the relay ledger so old mail never re-accounts)
  const knownFiles = new Set<string>(delivered)
  const refused = [...relayLedger.refused]
  // why each refusal happened, and its attributable sender — the nudge
  // ladder quotes these AT the sender (the 2026-10-12 wave-2 lesson:
  // a member whose mail is refused must be told why, or it idles to
  // death certain it already sent). A file that later parses good (or
  // is deleted) heals out of this map.
  const refusedDetail = new Map((relayLedger.refusedDetail ?? []).map((d) => [d.file, d]))
  const commitRelay = () => writeRelayLedger(taskDir, { delivered, refused, refusedDetail: [...refusedDetail.values()] })
  // A parked member continues its own booked session (write-ahead at
  // birth); a member without one is born fresh, held idle until mail.
  // THE ONE SPELLING, coworker edition (gate-r24 principles-50): a
  // member's pane row is matched by its EXACT unit — members inhabit
  // under their name verbatim (inhabitPane(m.name, …)), so the
  // bare-name disjunct and the dash-prefix startsWith arm were pure
  // collision surface (member api answering api-v2's row): a member
  // that never boarded was born resumed into its sibling's session —
  // held idle, its brief never delivered, the exchange deadlocked.
  // The same law rail.bookedSessionOf's w- form states: exact match,
  // no variants. AND THE POINTER IS EVIDENCE ONLY WHEN IT IS ACTIVE
  // THIS GENERATION (gate-r27, momentum-90's law at the coworker
  // seat): existence alone reads a surviving predecessor's untouched
  // session as boarding — verify opencode pointers against the store
  // before answering.
  const bookedSessionOf = (name: string): string | undefined => {
    if (!ledger) return undefined
    const latest = ledger.job.panes
      .filter((p) => p.unit === name && p.transcript)
      .sort((a, b) => a.born.localeCompare(b.born))
      .pop()
    const sid = latest?.transcript?.session_id
    if (sid === undefined) return undefined
    // ACTIVITY IS THE ORACLE (gate-r27, momentum-90's law at the
    // coworker seat): a readable store with no row disproves the
    // pointer; an unreadable store spares (momentum-34) — never a
    // store-less world answering 'dead'.
    if (latest?.transcript?.tool === "opencode") {
      const bornMs = Date.parse(latest.born)
      if (!Number.isNaN(bornMs) && !opencodeSessionActiveSince(sid, bornMs)) return undefined
    }
    return sid
  }
  const resumeOf = new Map<string, string>()
  if (ledger) {
    for (const m of members) {
      const sid = bookedSessionOf(m.name)
      if (sid) resumeOf.set(m.name, sid)
    }
  }
  const { messages: priorMessages } = readMessages(join(taskDir, "messages"), names)
  // Kind-scoped hooks, taught not suffered (j-64e035): a coworker runs
  // only counts. units/grade are fan-out/lab concepts — declared here
  // they are dead config, and a scaffold that copied them from a
  // fan-out example is one counts="true" away from a report-time death.
  // A hosted station reads the PARENT manifest — its units/grade belong
  // to the chain's other stages, not dead config, so no warning.
  if (!opts.station && (manifest.hooks.units || manifest.hooks.grade)) {
    log(
      "coworker ignores hooks.units/hooks.grade (the members are the units; only counts runs) — remove them from the spur toml",
    )
  }
  const initiator = members.find((m) => m.initiates)?.name
  const midTurn = interruptedMember(priorMessages, delivered, initiator)
  if (resumeOf.size > 0) {
    log(`continue: ${resumeOf.size} member(s) resume booked sessions${midTurn ? `; ${midTurn} was mid-turn at park` : ""}`)
  }
  let board = emptyBoard()
  if (rail.wantVerbose()) rail.openVerbose()
  mkdirSync(join(taskDir, "messages"), { recursive: true })
  mkdirSync(join(taskDir, "briefs"), { recursive: true })
  const bornAt = new Map<string, number>()
  const prompted = new Set<string>()
  const sandboxOf = new Map<string, string>()
  const paneOfMember = new Map<string, string | null>()
  for (const m of members) {
    const dir = join(taskDir, "sandboxes", m.name)
    sandboxOf.set(m.name, dir)
    mkdirSync(dir, { recursive: true })
    // THE SEND TOOL (ADR 0016 slice 5 / zen 7): staged once per run —
    // the only sanctioned sender. Identity = the caller's sandbox
    // folder; the roster names the legal recipients. Members reach it
    // at tools/send.mjs (the protocol section teaches the call).
    const toolsDir = join(taskDir, "tools")
    if (!existsSync(join(toolsDir, "send.mjs"))) {
      mkdirSync(toolsDir, { recursive: true })
      copyFileSync(new URL("./send-tool.mjs", import.meta.url).pathname, join(toolsDir, "send.mjs"))
      writeFileSync(join(toolsDir, "roster.txt"), `${names.join("\n")}\n`)
    }
    // pre-declared external roots ride the session-start config — the
    // dialogs for these paths never fire, so the sweep never spends
    // on them (the j-5b245e lesson: a vista reviewer died at the cap
    // for paths every verdict allowed). The scope's roots ride too;
    // member roots arrive tilde-form and expand inside.
    //
    // Mailbox law (slice 5): a member's write scope adds the shared
    // data/ shelf and its OWN outbox only — peers' outboxes sit
    // outside every scope, so a forged or misdirected write is out of
    // scope by construction (the interview's gap #1, closed).
    // deliverables/ needs NO grant: the human pack is RENDERED by the
    // audit at report time (hooks run outside member sandboxes) — no
    // member ever writes there; the pack's only reader is the human.
    rail.writePermissions(dir, [
      ...(m.roots ?? []),
      join(taskDir, "data"),
      join(taskDir, "messages", m.name),
    ])
    let brief = ""
    try {
      brief = readFileSync(join(taskDir, "members", `${m.name}.md`), "utf8")
    } catch {
      throw new Error(`no brief for ${m.name} — members/${m.name}.md is missing`)
    }
    writeFileSync(
      join(taskDir, "briefs", `${m.name}.md`),
      brief + memberProtocol(m.name, names.filter((n) => n !== m.name), taskDir),
    )
    const slot = rail.ensureRole(board, m.name, dir)
    board = slot.board
    // No explicit member model + a configured chooser = the judge picks
    // the birth model from the candidate order. A fresh member has no
    // fault history; the brief excerpt is the only evidence that matters.
    // (A hosted station's members carry their pins in the spec — the
    // parent toml's member tables never speak for them.)
    const birthPolicy = readModelsFile(taskDir, toml, DOOR_ROOT)
    if (!m.model && birthPolicy.chooser === "jev" && birthPolicy.order.length > 0) {
      const pick = chooseModel({
        taskDir,
        member: m.name,
        remaining: birthPolicy.order,
        briefExcerpt: brief.slice(0, 400),
      })
      m.model = pick.ok && pick.model ? pick.model : birthPolicy.order[0]
      log(`chooser birth ${m.name}: ${m.model}${pick.ok ? ` (jev confidence ${pick.confidence})` : ` (${pick.why} — order[0] fallback)`}`)
    }
    // the initiator wakes on its brief alone; everyone else is held
    // idle until the rail delivers brief + first message together —
    // except a resumed member (ADR 5): its session already carries the
    // brief, so it is never re-briefed; a mid-turn park gets one
    // rail-generated nudge instead ("continue where you left off")
    const resumeId = resumeOf.get(m.name)
    const ok = slot.pane
      ? rail.inhabitPane(
          m.name, memberKind, slot.pane, join(taskDir, "briefs", `${m.name}.md`), dir,
          m.model, m.seed, !m.initiates || Boolean(resumeId), resumeId, m.temperature,
        )
      : false
    if (slot.pane) rail.renamePane(slot.pane, m.name)
    // A failed start ghost-clears its pane. Leave that id on the board
    // and the next member splits from a closed anchor (j-ea5f4d: junior
    // timed out, senior's split was `pane not found`, senior never born).
    if (!ok && slot.pane) board = rail.dropPane(board, slot.pane)
    paneOfMember.set(m.name, ok ? slot.pane : null)
    if (ok && (m.initiates || resumeId)) prompted.add(m.name)
    if (ok && resumeId && m.name === midTurn) {
      rail.promptAgent(
        m.name,
        "[rail] The run was parked and has been continued. You were interrupted mid-thought — pick up exactly where you left off.",
      )
      log(`continue: nudged ${m.name} (interrupted mid-turn at park)`)
    }
    bornAt.set(m.name, Date.now())
    log(ok ? `name ${m.name} pane ${slot.pane}${m.initiates ? " (initiates)" : " (held idle)"}` : `member ${m.name} failed to spawn`)
    if (ok) rail.say("rail", `birth ${m.name}`)
  }
  const CAP = Number(process.env.AGENTIC_OS_RELAY_CAP ?? "") || 60
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const deadline = Date.now() + 2 * 60 * 60_000
  // Issue #122 — transport retry: a member pane that dies mid-exchange
  // (crash, killed TTY) is a malfunction, not an answer. The rail
  // respawns it from its booked session, bounded by workflow.retry
  // (default 1), counted per member, and the report carries the churn
  // so the levy can see it. Semantic outcomes — a stop, a capped
  // stall, a deny-cap block — are never retried: those are decisions.
  const retryCap = opts.station?.retry ?? manifest.workflow.retry ?? 1
  const retriesUsed = new Map<string, number>()
  const respawnMember = (m: (typeof members)[number]): boolean => {
    const dir = sandboxOf.get(m.name) ?? join(taskDir, "sandboxes", m.name)
    const oldPane = paneOfMember.get(m.name) ?? null
    if (oldPane) board = rail.dropPane(board, oldPane)
    rail.retire(m.name) // books the pane death; clears the rail's bookkeeping
    const slot = rail.ensureRole(board, m.name, dir)
    board = slot.board
    paneOfMember.set(m.name, slot.pane)
    const resumeId = bookedSessionOf(m.name)
    const ok = slot.pane
      ? rail.inhabitPane(
          m.name, memberKind, slot.pane, join(taskDir, "briefs", `${m.name}.md`), dir,
          m.model, m.seed, Boolean(resumeId), resumeId, m.temperature,
        )
      : false
    if (slot.pane && ok) rail.renamePane(slot.pane, m.name)
    if (!ok) return false
    bornAt.set(m.name, Date.now())
    // a respawned session already carries its brief — never re-brief
    // it, and the stall ladder starts fresh (a transport fault is not
    // silence)
    prompted.add(m.name)
    flightOf.set(m.name, freshFlight())
    const attempt = retriesUsed.get(m.name) ?? 1
    rail.promptAgent(
      m.name,
      `[rail] Your process died mid-exchange (transport fault — retry ${attempt}/${retryCap}). Your session was resumed from its checkpoint; pick up exactly where you left off.`,
    )
    rail.say("rail", `respawn ${m.name} (transport retry ${attempt}/${retryCap})`)
    return true
  }
  // the stall judge's clock and the loop's beat — parameterized so
  // tests drive the nudge ladder in milliseconds
  const stallMs = opts.stallMs ?? 120_000
  const beatMs = opts.beatMs ?? 5_000
  // the newborn grace: a pane younger than this is not judged dead yet
  // (birth is asynchronous) — parameterized so tests drive it to 0
  const graceMs = opts.graceMs ?? 15_000
  const dead: string[] = []
  const switchedAwaitingTurn = new Set<string>()
  const actedFault = new Map<string, string>()
  const deadModels = new Map<string, Set<string>>()
  // why each member died — the report's exchange row carries it, so a
  // "failed" never arrives without its reason (j-5b245e read "ended by
  // dead" with the cap hit only in the log)
  const deadWhy = new Map<string, string>()
  // the ball: whose turn the exchange waits on. Idle too long → one
  // nudge, then a second, then the member is dead. A silent member
  // must never stall the exchange forever.
  const ballOn = { name: members.find((m) => m.initiates)?.name, since: Date.now() }
  // refusal feedback: the quoted reasons a member's mail was refused,
  // for its nudges and — if it still stalls — its death record
  const refusalsOf = (member: string) => [...refusedDetail.values()].filter((d) => d.from === member)
  const refusalList = (member: string): string => {
    const mine = refusalsOf(member)
    const head = mine.slice(0, 3).map((d) => `'${d.file}': ${d.why}`).join("; ")
    return mine.length > 3 ? `${head} (+${mine.length - 3} more)` : head
  }
  const refusalQuote = (member: string): string => {
    if (refusalsOf(member).length === 0) return ""
    return (
      ` The relay REFUSED your message file(s) — nothing you sent was delivered: ${refusalList(member)}.` +
      ` Fix the file and write it again: messages/<your-name>/<seq>.json holding {"from","to","type":"note"|"stop","body"} with seq a positive integer.`
    )
  }
  const refusalSuffix = (member: string): string => {
    const n = refusalsOf(member).length
    return n > 0 ? ` — ${n} message file(s) refused by the relay: ${refusalList(member)}` : ""
  }
  // ── the member court: the flight bench's second customer ───────────
  //
  // #181's bench (orchestrator.ts) seated for members: ONE typed beat
  // per member per beat, judges in precedence order (firstRuling is
  // the one walk), ONE bailiff — the hand-rolled nudge ladder, the
  // deferred kill, and the bespoke dead-record closes are gone (the
  // OPTIMUM §2 residual, folded).
  const memberOf = (name: string) => members.find((m) => m.name === name)!

  // the member's ladder state — was three collections (the nudged
  // map, the deferred set, the stoodDown set)
  type MemberFlight = { nudged: number; deferred: boolean; stoodDown: boolean }
  const freshFlight = (): MemberFlight => ({ nudged: 0, deferred: false, stoodDown: false })
  const flightOf = new Map<string, MemberFlight>()
  for (const m of members) flightOf.set(m.name, freshFlight())

  // ONE observation per member per beat; no judge reads the rail or
  // fs directly. booked/pendingNote are LAZY (disk reads — only the
  // judges that need them pay, the #181 law).
  type MemberBeat = {
    id: string
    alive: boolean
    pastGrace: boolean
    status: AgentStatus
    holdsBall: boolean
    silentFor: number
    flight: MemberFlight
    capped: boolean
    answered: boolean
    retriesLeft: boolean
    booked: boolean
    pendingNote: boolean
  }
  const memberBeat = (name: string, swept: { answered: Set<string>; capped: Set<string> }): MemberBeat => ({
    id: name,
    alive: rail.paneAlive(name),
    pastGrace: Date.now() - (bornAt.get(name) ?? 0) > graceMs,
    status: rail.workerStatus(name),
    holdsBall: ballOn.name === name,
    silentFor: ballOn.name === name ? Date.now() - ballOn.since : 0,
    flight: flightOf.get(name) ?? freshFlight(),
    capped: swept.capped.has(name),
    answered: swept.answered.has(name),
    retriesLeft: (retriesUsed.get(name) ?? 0) < retryCap,
    get booked() {
      // ADR 0016 slice 4: stations host in-process — no child spur can
      // hold a member's session as its spawner, so no booked wait
      return false
    },
    get pendingNote() {
      return rail.hasPendingNote(name)
    },
  })

  // the bailiff's close — ONE dead-record ceremony for every death on
  // this court (deny cap, spent transport retry, nudge cap, model
  // exhaustion; was hand-rolled at five sites): a "failed" never
  // arrives without its reason (j-5b245e), and the levy always learns
  // why (the wake).
  const closeMember = (name: string, reason: string): void => {
    dead.push(name)
    deadWhy.set(name, reason)
    ledger?.emit("wake", { why: `member ${reason}` })
    log(`member ${reason} — ending`)
    rail.say("watcher", `${name} dead`)
  }

  // privilege: a capped member is dead; an answered dialog on the ball
  // holder is progress — permission churn must not eat the nudge
  // budget while the member talks to the rail (j-a532f9).
  const privilegeJudge: Judge<MemberBeat> = (b) => {
    if (b.capped) {
      return {
        kind: "close",
        stage: "member",
        pass: false,
        row: { unit: b.id, result: `${b.id} blocked past the deny cap`, pass: false },
      }
    }
    if (b.answered && b.holdsBall) {
      return { kind: "defer", why: "an injected verdict is progress" }
    }
    return { kind: "none" }
  }

  // liveness: a pane gone past the newborn grace is a TRANSPORT fault
  // (issue #122), never an answer — respawn from the booked session
  // while retries remain, only a spent cap closes. Liveness outranks
  // the stall ladder: a dead pane is malfunctioning, not silent, so
  // no nudge may race the respawn.
  const livenessJudge: Judge<MemberBeat> = (b) => {
    if (b.alive || !b.pastGrace) return { kind: "none" }
    const spent = retriesUsed.get(b.id) ?? 0
    if (spent < retryCap && respawnMember(memberOf(b.id))) {
      retriesUsed.set(b.id, spent + 1)
      ledger?.emit("retry", { member: b.id, attempt: spent + 1, why: "pane died" })
      log(`member ${b.id} pane died — respawned from booked session (transport retry ${spent + 1}/${retryCap})`)
      return { kind: "defer", why: "transport retry — respawned from the booked session" }
    }
    return {
      kind: "close",
      stage: "member",
      pass: false,
      row: {
        unit: b.id,
        result: `${b.id} pane died${spent > 0 ? ` after ${spent} transport retry(ies)` : ""}`,
        pass: false,
      },
    }
  }

  // BIRTH (gate-r30 principles-202, the fan-out bench's twin law):
  // "how long may an unboarded pane ride?" is ONE decision — the
  // fan-out bench answers at born_ms (orchestrator.ts birthJudge:
  // session existence is the only key, the working exemption dies at
  // bornMs, transport never an answer). This bench accepted the field
  // (hooks validates workflow.born_ms) with NO consumer: the stall
  // judge deferred the never-boarding ball-holder on "working"
  // unconditionally and the exchange rode a member nobody will ever
  // hear. THE PATIENCE IS THE EARLIER CLOCK — min(born_ms, stall_ms):
  // an unboarded member silent past EITHER ceiling is the
  // never-boarding shape (the stall ladder would judge a BOOKED pane
  // at the same silence; working does not exempt past the window —
  // the #249 agent_status-lies class, gate-r11 tests-1's fan-out
  // twin). Respawn while retries remain (the liveness judge's
  // transport ceremony), close honestly at the cap.
  const bornPatience = Math.min(manifest.workflow.born_ms ?? 180_000, stallMs)
  // "did this member EVER board?" — the RAW ROW question (any pane row
  // carrying a session pointer), NOT bookedSessionOf's verified answer
  // (which consults the host store; a synthetic test pointer must not
  // read as never-boarded and eat a respawn — the r27 hermeticity
  // lesson). The verified oracle keeps its seats (resume, the fan-out
  // spare); the birth question only asks whether a booking exists.
  const everBookedRow = (name: string): boolean => {
    if (!ledger) return false
    return ledger.job.panes.some((p) => p.unit === name && p.transcript?.session_id !== undefined)
  }
  const memberBirthJudge: Judge<MemberBeat> = (b) => {
    if (!b.holdsBall) return { kind: "none" }
    if (everBookedRow(b.id)) return { kind: "none" } // boarded — however quiet, this court is not its seat
    // JURISDICTION (the court's own law): only the shape the stall
    // ladder CANNOT judge — a member 'working'-deferred forever (the
    // #249 agent_status-lies class; an idle unboarded member is the
    // nudge ladder's: prompt, refuse, kill — the standing law). This
    // seat exists because the stall judge defers on "working"
    // UNCONDITIONALLY, and a never-boarding member rode the whole
    // exchange behind that defer.
    if (b.status !== "working") return { kind: "none" }
    if (Date.now() - (bornAt.get(b.id) ?? 0) <= bornPatience) return { kind: "none" }
    const spent = retriesUsed.get(b.id) ?? 0
    if (spent < retryCap && respawnMember(memberOf(b.id))) {
      retriesUsed.set(b.id, spent + 1)
      ledger?.emit("retry", { member: b.id, attempt: spent + 1, why: "never boarded by the birth patience" })
      log(`member ${b.id} never boarded within ${bornPatience}ms — respawned (transport retry ${spent + 1}/${retryCap})`)
      return { kind: "defer", why: "birth retry — never boarded within the patience" }
    }
    return {
      kind: "close",
      stage: "member",
      pass: false,
      row: {
        unit: b.id,
        result: `dead at birth (${bornPatience}ms, ${spent + 1} attempts)`,
        pass: false,
      },
      faultsCanary: false,
      fault: true,
      detail: `no agent session ${bornPatience}ms after spawn, ${spent + 1} attempts`,
      wake: `member ${b.id} never boarded — dead at birth (issue #249 class)`,
    }
  }

  // stall — the nudge ladder. Only the ball holder is judged: working
  // defers, a booked wait stands the clock down (ADR 0006), two
  // nudges (refusals quoted at their sender), one guidance-deferred
  // kill (j-a532f9), then the honest close.
  const NUDGE_CAP = 2
  const stallJudge: Judge<MemberBeat> = (b) => {
    if (!b.holdsBall) return { kind: "none" }
    if (b.status === "working") return { kind: "defer", why: "agent working" }
    if (b.silentFor <= stallMs) return { kind: "none" }
    if (b.booked) {
      if (!b.flight.stoodDown) {
        b.flight.stoodDown = true
        log(`booked wait ${b.id}: a live child spur holds it — nudges stand down`)
      }
      return { kind: "defer", why: "booked wait — a live child holds this member" }
    }
    const used = b.flight.nudged
    if (used < NUDGE_CAP) {
      b.flight.nudged = used + 1
      return {
        kind: "reprompt",
        note:
          (used === 0
            ? "The exchange waits on you. Continue your task now; when you have something for a peer, write your message file (messages/<your-name>/<seq>.json)."
            : `Second and final nudge, ${b.id}: the exchange waits on you. Act now or the job ends unresolved.`) + refusalQuote(b.id),
        event: ["reprompt", { member: b.id, nudge: used + 1 }],
      }
    }
    if (b.pendingNote && !b.flight.deferred) {
      // the guidance is still queued — the kill raced the message that
      // could save the member (j-a532f9). Defer death one beat, flush
      // now; the second expiry is honest death.
      b.flight.deferred = true
      rail.flushPendingNotes()
      log(`member ${b.id} at the nudge cap — guidance still queued, deferring one beat`)
      return {
        kind: "defer",
        why: "guidance still queued — death deferred one beat",
        event: ["reprompt", { member: b.id, deferred: true }],
      }
    }
    return {
      kind: "close",
      stage: "member",
      pass: false,
      row: { unit: b.id, result: `${b.id} stalled past the nudge cap${refusalSuffix(b.id)}`, pass: false },
    }
  }

  // the seating — the precedence IS the design (pinned in
  // test/coworker-run.test.ts, the way benchOrder's is).
  const memberBench: Judge<MemberBeat>[] = [privilegeJudge, livenessJudge, memberBirthJudge, stallJudge]

  // the bailiff: close = the one dead record; defer/reprompt = the
  // ball's clock resets (only the holder's silence is the exchange's)
  // and the event books; none leaves everything as the beat found it —
  // the relay's deliveries own the ball's moves.
  const applyMemberRuling = (beat: MemberBeat, ruling: Ruling): void => {
    switch (ruling.kind) {
      case "close":
        closeMember(beat.id, ruling.row.result)
        return
      case "carry":
        return // a drain parks before this court sits — kept for the protocol
      case "defer":
        if (ballOn.name === beat.id) ballOn.since = Date.now()
        if (ruling.event) ledger?.emit(ruling.event[0], ruling.event[1])
        return
      case "reprompt":
        rail.promptAgent(beat.id, ruling.note)
        if (ballOn.name === beat.id) ballOn.since = Date.now()
        if (ruling.event) ledger?.emit(ruling.event[0], ruling.event[1])
        return
      case "none":
        return
    }
  }
  let ended: "stop" | "cap" | "deadline" | "dead" | "paused" | null = null
  // #198 — the verdict hook's round bookkeeping: one revise round,
  // then the red verdict rides the report honestly
  let verdictRuns = 0
  let verdictRed: string | null = null
  // the station check's receipt: a green stage check leaves a row on
  // the report — the parent refuses a "done" station without it (a
  // host that skips the stop ceremony must not pass silently)
  let stationCheckGreen = false
  let draining = false
  let drainUntil: number | null = null
  // ONE spelling of "is the workforce settled?" — the drain path's
  // rule: nobody is working. The stop path used to sleep one beat of
  // mail quiet instead, and run #17's verdict audited a half-written
  // shelf while the interviewer was still synthesizing. Every path
  // that ends an exchange asks this same question; a second spelling
  // here would drift again.
  const anyWorking = (): boolean => members.some((m) => rail.workerStatus(m.name) === "working")
  // the shared ceiling math (env → manifest → 10min), one spelling for
  // the pause drain and the stop-settle below
  const drainCeilingMs = (): number =>
    Number(process.env.AGENTIC_OS_DRAIN_MS ?? "") || manifest.workflow.drain_timeout_ms || 10 * 60_000
  // SIGTERM is the drain (ADR 5): the hook goes to the Rail, whose
  // trapSignals owns the signal. Stop delivering, let a member
  // mid-turn end its turn, then park. Pending mail is NOT drained — it
  // waits in messages/ for the next run's relay.
  // Station tenancy (ADR 0016): installDrain RETURNS a disposer — a
  // hosted exchange removes ITS drain when it ends, leaving the
  // parent's intact (the pre-tenancy assignment overwrote it).
  const dropOwnDrain = rail.installDrain(() => {
    if (ended !== null || draining) return
    draining = true
    drainUntil = drainDeadline(taskDir, Date.now(), drainCeilingMs())
    log(`coworker: pause requested — draining to quiescence (ceiling ${new Date(drainUntil).toISOString()})`)
  })
  // Station tenancy (ADR 0016): a hosted exchange sweeps exactly its
  // OWN member panes on the way out (rail.retire is per-pane: shep
  // retire + ledger kill, no fleet tab, no pkill). The parent's unit
  // panes, its chrome, and the process-level guarantee over the run
  // dir (rail.retireAll's pkill tail) are never a station's to touch —
  // that pkill at a station boundary is what orphaned runs mid-flight
  // on Linux (the early R6).
  const endOfExchangeSweep = (): void => {
    dropOwnDrain()
    if (opts.station) {
      for (const m of members) rail.retire(m.name)
      log(`coworker: retired ${members.length} member pane(s) — the parent's rail is untouched`)
      return
    }
    rail.retireAll()
    rail.closeVerbose()
  }
  while (!ended && Date.now() < deadline) {
    // the lease rides the beat (issue #123): one fs write per beat
    // keeps the expiring leadership claim fresh; a dead orchestrator
    // simply stops renewing — absence of renewal is the signal.
    // The mutex half: losing the lease mid-run (a steal, a second
    // orchestrator) means this loop no longer owns the job — stop
    // relays and exit SILENTLY (no report, no retire: the panes and
    // the job now belong to the winner). Never split-brain it.
    if (rail.ledger && rail.ledger.renew() === false) {
      log("coworker: lease lost — another orchestrator owns this job; stopping relays")
      dropOwnDrain()
      if (!opts.station) rail.closeVerbose()
      return null
    }
    if (draining) {
      // ADR 5: no new deliveries; a member mid-turn ends its turn.
      // Permission asks, nudges, and dead checks stand down — the
      // park is taking over, bounded by the drain ceiling.
      if (!anyWorking() || (drainUntil !== null && Date.now() > drainUntil)) {
        ended = "paused"
        break
      }
      await waitChange(join(taskDir, "messages"), beatMs)
      continue
    }
    // queued privilege notes ride the sweep (tickPrivilege flushes);
    // readMessages follows it on the same beat
    const { messages, bad } = readMessages(join(taskDir, "messages"), names)
    // the RAIL-written mail ledger (slice 5): every NEW file a mailbox
    // produces is accounted the beat it first parses — who filed it,
    // where it sits, what it says it is. The ledger is rail-owned by
    // construction: panes write mail, only the rail writes accounting.
    for (const m of messages) {
      if (knownFiles.has(m.file)) continue
      knownFiles.add(m.file)
      ledger?.emit("mail.filed", { from: m.from, to: m.to, file: m.file, type: m.type })
    }
    for (const b of bad) {
      // the detail (why + sender) is refreshed every beat — a refusal
      // loaded from an old ledger without detail backfills here
      const sender = b.from && names.includes(b.from) ? b.from : undefined
      refusedDetail.set(b.file, { file: b.file, why: b.why, from: sender })
      if (refused.includes(b.file)) continue
      refused.push(b.file)
      commitRelay()
      ledger?.emit("reject", { why: `message ${b.file}: ${b.why}` })
      log(`refused message ${b.file}: ${b.why}`)
      rail.say("watcher", `refuse ${b.file}`)
    }
    // healed: a refused file that no longer parses bad (fixed in place
    // or deleted) stops being quoted — the sender acted on the feedback
    const stillBad = new Set(bad.map((b) => b.file))
    for (const [file, detail] of refusedDetail) {
      if (!stillBad.has(file)) {
        refusedDetail.delete(file)
        commitRelay()
        log(`refusal healed: ${file} no longer refuses (${detail.why})`)
      }
    }
    const plan = relayPlan(messages, delivered, CAP)
    for (const r of plan.relays) {
      // a working member takes mail on a later beat — never mid-turn
      if (rail.workerStatus(r.to) === "working") continue
      let text = `[relay] from ${r.from}:\n\n${r.body}`
      if (!prompted.has(r.to)) {
        text = combineFirstPrompt(readFileSync(join(taskDir, "briefs", `${r.to}.md`), "utf8"), r.from, r.body)
        prompted.add(r.to)
      }
      const rc = rail.promptAgent(r.to, text)
      if (rc.status !== 0) {
        log(`relay ${r.file} could not reach ${r.to} (rc=${rc.status}) — retrying next beat`)
        continue
      }
      delivered.push(r.file)
      commitRelay()
      // #104 / #201: the sender's turn just completed — its cumulative
      // usage sampled onto the trace (turn.tokens). Deltas between
      // consecutive rows are the turn's own cost; the report's
      // per-member row carries the final word. Best-effort: no host
      // store, no row.
      const senderSince = bornAt.get(r.from) ?? 0
      const usage = rail.usageOf(r.from, senderSince)
      if (usage) {
        ledger?.emit("turn.tokens", { member: r.from, to: r.to, file: r.file, ...usage })
      }
      // a held member mints its session on this first prompt — book it
      // shortly (ADR 5), so continue resumes its conversation
      rail.bookSessionLate(r.to, memberKind, sandboxOf.get(r.to) ?? taskDir, new Date(bornAt.get(r.to) ?? Date.now()).toISOString())
      ballOn.name = r.to
      ballOn.since = Date.now()
      ledger?.emit("relay", { from: r.from, to: r.to, file: r.file })
      log(`relay ${r.file}: ${r.from} -> ${r.to}`)
      rail.say("rail", `relay ${r.from} -> ${r.to}`)
    }
    if (plan.stop) {
      // #198 — audit BEFORE retire: a program may declare [hooks]
      // verdict; it runs HERE, while every pane is still alive. Green:
      // the stop stands. Red: the hook's first stderr line is handed
      // VERBATIM to the stop's author for ONE revise round — the stop
      // is consumed, the exchange continues, the next stop re-runs the
      // hook. A second red ends the run honestly (#204 made the red
      // report honest; the verdict row rides it).
      // The verdict command, one seam: a STATION's stop verdict is its
      // stage check — ONLY (a station without a check settles on the
      // members' stop, like a unit stage with no check declared). The
      // parent program's [hooks] verdict belongs to the standalone
      // shape alone: at a hosted stop it would run with the station as
      // cwd at EVERY exchange's end — deleted, never fallen back to.
      // A fallback here is exactly the residue that drifts back into
      // the old design.
      const verdictCmd = opts.station ? opts.station.check : manifest.hooks.verdict
      if (verdictCmd) {
        // Either way it runs BEFORE any pane retires, so a red can
        // still reach its author.
        const verdictCwd = opts.station?.check ? (opts.station.checkCwd ?? taskDir) : taskDir
        // The stop-settle (j-53850f + run #17): the rail may see a stop
        // while OTHER members are still working — run #17's
        // interviewee stopped while the interviewer was mid-synthesis,
        // and the fixed 5s sleep let the verdict audit a half-written
        // gaps.md. "Quiet enough to end" is the DRAIN path's rule —
        // nobody is working — never one beat of mail quiet. The wait
        // rides the same drain ceiling, so a member stuck working
        // cannot hang the exchange; then one beat more lets the stop's
        // author flush its own final writes (j-53850f: the send and
        // the write are separate tool calls in its session).
        const settleUntil = drainDeadline(taskDir, Date.now(), drainCeilingMs())
        while (anyWorking()) {
          if (Date.now() > settleUntil) {
            log("coworker: stop-settle ceiling passed with a member still working — running the verdict anyway")
            break
          }
          await sleep(beatMs)
        }
        await sleep(beatMs)
        verdictRuns += 1
        let verdictWhy = ""
        let verdictPass = false
        try {
          // WHL_UNIT: every site that runs a stage check names its
          // subject (the self-review's principles-1: the STAGES.md
          // claim was false here — the in-exchange check judged the
          // station unnamed). The station's id is the subject.
          execSync(verdictCmd, { cwd: verdictCwd, timeout: 120_000, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, WHL_UNIT: opts.station ? opts.station.dir.split("/").pop()! : "station" } })
          verdictPass = true
        } catch (err) {
          // the hook's OWN stderr line outranks execSync's generic
          // "Command failed" — the revise note must name the artifact
          const stderr = (err as { stderr?: Buffer | string }).stderr
          const firstStderr = stderr ? Buffer.from(stderr).toString().split("\n").find((l) => l.trim()) : undefined
          verdictWhy = firstStderr ?? (err instanceof Error ? err.message.split("\n")[0] : String(err)).split("\n")[0]
        }
        if (verdictPass) {
          if (opts.station?.check) stationCheckGreen = true
          ended = plan.why ?? "stop"
          break
        }
        if (verdictRuns > 1) {
          verdictRed = verdictWhy
          ended = plan.why ?? "stop"
          break
        }
        const stopMsg = messages.find((m) => m.type === "stop" && !delivered.includes(m.file))
        const author = stopMsg?.from ?? initiator ?? names[0]
        // the failed stop is consumed — the author fixes what the hook
        // named, then stops again; the next stop re-runs the verdict
        if (stopMsg) {
          delivered.push(stopMsg.file)
          commitRelay()
        }
        rail.promptAgent(
          author,
          `[rail] verdict hook failed (the exchange is NOT over — one revise round): ${verdictWhy}\nFix exactly what it names, then write your stop message again.`,
        )
        if (ballOn.name === author) ballOn.since = Date.now()
        ledger?.emit("verdict-reprompt", { to: author, why: verdictWhy.slice(0, 160) })
        log(`verdict hook red — revise round handed to ${author}: ${verdictWhy.slice(0, 120)}`)
        continue
      }
      ended = plan.why ?? "stop"
      break
    }
    // the permission half of JEV (zen 6, rail-owned): a blocked member
    // is a question, and the rail's sweep answers it — every pane the
    // rail holds, this loop's members and anything else alike, one
    // sweep per beat. No dialog ever waits for a person; the court
    // below carries the consequence.
    const sweep = rail.tickPrivilege()
    // the member court sits: one beat per living member, privilege →
    // liveness → stall, the first ruling wins, the bailiff applies.
    // Every death on this engine — the deny cap, a spent transport
    // retry, the nudge cap — closes through the bailiff's one record.
    for (const m of members) {
      if (dead.includes(m.name)) continue
      const beat = memberBeat(m.name, sweep)
      applyMemberRuling(beat, firstRuling(memberBench, beat))
    }
    // the provider-fault lane (the jev model ladder) — not a stall
    // question, so it rides its own block: its clock resets and its
    // deaths flow through the bailiff's close, never a hand-rolled one.
    // ONE algorithm, two engines since j-93d652's gap #4 (fan-out had
    // no provider-fault lane at all) — the shared extraction lives in
    // engines/fault-lane.ts; this is the conversation engine's call.
    const policy = readModelsFile(taskDir, toml, DOOR_ROOT)
    runFaultLane({
      taskDir,
      names: members.map((m) => m.name),
      sessionOf: bookedSessionOf,
      cwdOf: (n) => sandboxOf.get(n) ?? taskDir,
      modelOf: (n) => members.find((m) => m.name === n)?.model,
      setModel: (n, model) => {
        const m = members.find((x) => x.name === n)
        if (m) m.model = model
      },
      isDead: (n) => dead.includes(n),
      awaitingTurn: switchedAwaitingTurn,
      actedFault,
      deadModels,
      policy,
      rail,
      close: (n, why) => closeMember(n, why),
      emit: (kind, payload) => ledger?.emit(kind, payload),
      resetClock: (n) => {
        if (ballOn.name === n) ballOn.since = Date.now()
        // #243: a provider fault is not silence — the whole stall
        // accounting starts fresh, not just the clock. Without this,
        // a member that burned a nudge inside a provider outage is
        // switched to a working model but keeps the burn, so the
        // post-switch ladder is one "final" nudge then death (the
        // respawn path's law above, now on the switch path too).
        flightOf.set(n, freshFlight())
      },
      log,
    })
    if (dead.length > 0) {
      ended = "dead"
      break
    }
    // the beat: mail wakes the loop early, the timer is the backstop —
    // beatMs also paces the stall ladder and the permission sweep
    await waitChange(join(taskDir, "messages"), beatMs)
  }
  if (!ended) ended = "deadline"
  // ADR 5: parked — not a finish. No report; the delivery ledger and
  // messages/ carry the exchange; a typed continue resumes it.
  if (ended === "paused") {
    endOfExchangeSweep()
    log(`coworker: parked — paused (${delivered.length} relayed; pending mail waits in messages/)`)
    return null
  }
  const { messages } = readMessages(join(taskDir, "messages"), names)
  const rows = members.map((m) => ({
    unit: m.name,
    result: `${messages.filter((x) => x.from === m.name).length} messages`,
    pass: !dead.includes(m.name),
  }))
  if (ended !== "stop") {
    const why = [...deadWhy.values()].join("; ")
    rows.push({ unit: "exchange", result: `ended by ${ended}${why ? ` — ${why}` : ""}`, pass: false })
  }
  if (verdictRed !== null) {
    rows.push({ unit: "verdict", result: `verdict hook failed twice: ${verdictRed.slice(0, 160)}`, pass: false })
  }
  // the station check's receipt (#198's station twin): "done" through a
  // declared stage check leaves this row — execStation demands it
  if (stationCheckGreen) {
    rows.push({ unit: "check", result: "stage check passed (in-exchange)", pass: true })
  }
  // transport churn is visible, not silent (issue #122): the levy sees
  // who was respawned and how often
  const spent = [...retriesUsed.entries()].filter(([, n]) => n > 0)
  if (spent.length > 0) {
    rows.push({
      unit: "retries",
      result: `${spent.map(([name, n]) => `${name}×${n}`).join(", ")} transport fault(s) — respawned from booked sessions`,
      pass: true,
    })
  }
  // unresolved refused mail is a failure in its own right even on a
  // clean stop — a levy looks at the report first, so the refusals
  // ride it (the wave-2 lesson: they lived only in orchestrator.log)
  const unresolved = [...refusedDetail.values()]
  if (unresolved.length > 0) {
    const list = unresolved.slice(0, 3).map((d) => `'${d.file}': ${d.why}`).join("; ")
    rows.push({
      unit: "relay",
      result: `${unresolved.length} message file(s) refused by the relay — ${list}${unresolved.length > 3 ? ` (+${unresolved.length - 3} more)` : ""}`,
      pass: false,
    })
  }
  log(`exchange ended (${ended}) — ${messages.length} messages, ${delivered.length} relayed${unresolved.length > 0 ? `, ${unresolved.length} refused` : ""}`)
  // #104 / #201: the per-member cost columns — cumulative usage from
  // the host's own store, plus the wall-clock each member lived. One
  // accounting row per member, AFTER the exchange ends (the final
  // word, not a sample).
  for (const m of members) {
    const since = bornAt.get(m.name) ?? 0
    const usage = rail.usageOf(m.name, since)
    const lived = since > 0 ? Math.round((Date.now() - since) / 1000) : 0
    rows.push({
      unit: `tokens ${m.name}`,
      result: usage
        ? `in ${usage.input} / out ${usage.output} / cache ${usage.cacheRead} — $${usage.cost.toFixed(4)} across ${usage.sessions} session(s), ${lived}s lived`
        : `no usage row (host keeps none) — ${lived}s lived`,
      pass: true,
    })
  }
  const report = writeReport(
    taskDir,
    taskDir,
    rows,
    (table) => runCounts(taskDir, rail.manifest(), table),
    ended === "stop" && dead.length === 0 && unresolved.length === 0 && verdictRed === null ? "done" : undefined,
  )
  endOfExchangeSweep()
  return report
}
