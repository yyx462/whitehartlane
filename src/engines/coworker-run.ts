// The coworker engine. Members talk through the rail: this loop
// births each named member with its own brief and model, relays
// message files as prompts to the named pane, ends on stop or the
// cap, then reports. The privilege sweep, pane bookkeeping, and
// layout all live on the Rail; the runner door picks this engine by
// shape (src/engine.ts). Member supervision is the flight bench's
// member court (below) — the second customer of #181's bench, folded
// onto it from a hand-rolled nudge/stall ladder.
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { memberProtocol, parseMembers, readMessages, relayPlan, combineFirstPrompt, interruptedMember, readRelayLedger, writeRelayLedger } from "./coworker.ts"
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
  const bookedSessionOf = (name: string): string | undefined => {
    if (!ledger) return undefined
    const latest = ledger.job.panes
      .filter((p) => (p.unit === name || p.unit?.startsWith(`${name}-`)) && p.transcript)
      .sort((a, b) => a.born.localeCompare(b.born))
      .pop()
    return latest?.transcript?.session_id
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
    // pre-declared external roots ride the session-start config — the
    // dialogs for these paths never fire, so the sweep never spends
    // on them (the j-5b245e lesson: a vista reviewer died at the cap
    // for paths every verdict allowed). The scope's roots ride too;
    // member roots arrive tilde-form and expand inside.
    rail.writePermissions(dir, m.roots ?? [])
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
      return rail.bookedWait(name)
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
  const memberBench: Judge<MemberBeat>[] = [privilegeJudge, livenessJudge, stallJudge]

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
  let draining = false
  let drainUntil: number | null = null
  // SIGTERM is the drain (ADR 5): the hook goes to the Rail, whose
  // trapSignals owns the signal. Stop delivering, let a member
  // mid-turn end its turn, then park. Pending mail is NOT drained — it
  // waits in messages/ for the next run's relay.
  rail.drainHook = () => {
    if (ended !== null || draining) return
    draining = true
    const ceiling =
      Number(process.env.AGENTIC_OS_DRAIN_MS ?? "") || manifest.workflow.drain_timeout_ms || 10 * 60_000
    drainUntil = drainDeadline(taskDir, Date.now(), ceiling)
    log(`coworker: pause requested — draining to quiescence (ceiling ${new Date(drainUntil).toISOString()})`)
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
      rail.drainHook = null
      rail.closeVerbose()
      return null
    }
    if (draining) {
      // ADR 5: no new deliveries; a member mid-turn ends its turn.
      // Permission asks, nudges, and dead checks stand down — the
      // park is taking over, bounded by the drain ceiling.
      const anyWorking = members.some((m) => rail.workerStatus(m.name) === "working")
      if (!anyWorking || (drainUntil !== null && Date.now() > drainUntil)) {
        ended = "paused"
        break
      }
      await waitChange(join(taskDir, "messages"), beatMs)
      continue
    }
    // queued privilege notes ride the sweep (tickPrivilege flushes);
    // readMessages follows it on the same beat
    const { messages, bad } = readMessages(join(taskDir, "messages"), names)
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
      const verdictCmd = manifest.hooks.verdict
      if (verdictCmd) {
        verdictRuns += 1
        let verdictWhy = ""
        let verdictPass = false
        try {
          execSync(verdictCmd, { cwd: taskDir, timeout: 120_000, stdio: ["ignore", "ignore", "pipe"] })
          verdictPass = true
        } catch (err) {
          // the hook's OWN stderr line outranks execSync's generic
          // "Command failed" — the revise note must name the artifact
          const stderr = (err as { stderr?: Buffer | string }).stderr
          const firstStderr = stderr ? Buffer.from(stderr).toString().split("\n").find((l) => l.trim()) : undefined
          verdictWhy = firstStderr ?? (err instanceof Error ? err.message.split("\n")[0] : String(err)).split("\n")[0]
        }
        if (verdictPass) {
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
      resetClock: (n) => {
        if (ballOn.name === n) ballOn.since = Date.now()
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
    rail.drainHook = null
    rail.retireAll()
    rail.closeVerbose()
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
  rail.retireAll()
  rail.closeVerbose()
  return report
}
