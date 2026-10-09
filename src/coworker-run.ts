// The coworker engine (moved out of bin/lab-orchestrator so tests can
// reach it — the bin is only the door). Members talk through the rail:
// this loop births each named member with its own brief and model,
// relays message files as prompts to the named pane, ends on stop or
// the cap, then reports. The privilege sweep, pane bookkeeping, and
// layout all live on the Rail.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { memberProtocol, parseMembers, readMessages, relayPlan, combineFirstPrompt, interruptedMember, readRelayLedger, writeRelayLedger } from "./coworker.ts"
import { runCounts } from "./hooks.ts"
import { emptyBoard } from "./lanes.ts"
import { drainDeadline } from "./orchestrator.ts"
import { waitChange, type Rail } from "./rail.ts"
import { writeReport, type Report } from "./report.ts"
import { liveSpawnerSessionIds, writeWorkerPermissions } from "./store.ts"

export async function runCoworker(rail: Rail): Promise<Report | null> {
  const taskDir = rail.taskDir
  const log = rail.log
  const ledger = rail.ledger
  const toml = readFileSync(join(taskDir, "workflow.toml"), "utf8")
  const members = parseMembers(toml)
  if (members.length < 2) {
    throw new Error("coworker needs at least two [members.*]")
  }
  const manifest = rail.manifest()
  const memberKind = manifest.workflow.worker_kind
  const names = members.map((m) => m.name)
  if (!members.some((m) => m.initiates)) {
    throw new Error("coworker needs one member with initiates = true — otherwise everyone idles and the exchange never starts")
  }
  // ADR 5 / M2: the relay ledger is outliving memory — deliveries and
  // refusals survive the orchestrator; pending mail redelivers by it.
  const relayLedger = readRelayLedger(taskDir)
  const delivered = [...relayLedger.delivered]
  const refused = [...relayLedger.refused]
  const commitRelay = () => writeRelayLedger(taskDir, { delivered, refused })
  // A parked member continues its own booked session (write-ahead at
  // birth); a member without one is born fresh, held idle until mail.
  const resumeOf = new Map<string, string>()
  if (ledger) {
    for (const m of members) {
      const latest = ledger.job.panes
        .filter((p) => p.unit === m.name && p.transcript)
        .sort((a, b) => a.born.localeCompare(b.born))
        .pop()
      if (latest?.transcript?.session_id) resumeOf.set(m.name, latest.transcript.session_id)
    }
  }
  const { messages: priorMessages } = readMessages(join(taskDir, "messages"), names)
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
  for (const m of members) {
    const dir = join(taskDir, "sandboxes", m.name)
    sandboxOf.set(m.name, dir)
    mkdirSync(dir, { recursive: true })
    writeWorkerPermissions(dir, [taskDir, ...rail.programRoots])
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
    // the initiator wakes on its brief alone; everyone else is held
    // idle until the rail delivers brief + first message together —
    // except a resumed member (ADR 5): its session already carries the
    // brief, so it is never re-briefed; a mid-turn park gets one
    // rail-generated nudge instead ("continue where you left off")
    const resumeId = resumeOf.get(m.name)
    const ok = slot.pane
      ? rail.inhabitPane(
          m.name, memberKind, slot.pane, join(taskDir, "briefs", `${m.name}.md`), dir,
          m.model, m.seed, !m.initiates || Boolean(resumeId), resumeId,
        )
      : false
    if (slot.pane) rail.renamePane(slot.pane, m.name)
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
  const dead: string[] = []
  // the ball: whose turn the exchange waits on. Idle too long → one
  // nudge, then a second, then the member is dead. A silent member
  // must never stall the exchange forever.
  const ballOn = { name: members.find((m) => m.initiates)?.name, since: Date.now() }
  const nudged = new Map<string, number>()
  // Booked wait (ADR 0006): a member whose booked session a running
  // child spur names as its spawner is idle on purpose — the nudge
  // clock stands down (and resets) while the child runs. Disk-derived
  // set, memoized briefly.
  let spawnIdsAt = 0
  let spawnIds = new Set<string>()
  const spawnerSessions = () => {
    if (Date.now() - spawnIdsAt > 10_000) {
      spawnIds = liveSpawnerSessionIds()
      spawnIdsAt = Date.now()
    }
    return spawnIds
  }
  const memberBookedWait = (name: string) => {
    if (!ledger) return false
    const panes = ledger.job.panes.filter((p) => p.unit === name && p.transcript?.session_id)
    const sid = panes[panes.length - 1]?.transcript?.session_id
    return sid ? spawnerSessions().has(sid) : false
  }
  const stoodDown = new Set<string>()
  let ended: "stop" | "cap" | "deadline" | "dead" | "paused" | null = null
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
    if (draining) {
      // ADR 5: no new deliveries; a member mid-turn ends its turn.
      // Permission asks, nudges, and dead checks stand down — the
      // park is taking over, bounded by the drain ceiling.
      const anyWorking = members.some((m) =>
        rail.agentStatus(m.name).includes('"agent_status":"working"'),
      )
      if (!anyWorking || (drainUntil !== null && Date.now() > drainUntil)) {
        ended = "paused"
        break
      }
      await waitChange(join(taskDir, "messages"), 5_000)
      continue
    }
    const { messages, bad } = readMessages(join(taskDir, "messages"), names)
    for (const b of bad) {
      if (refused.includes(b.file)) continue
      refused.push(b.file)
      commitRelay()
      ledger?.emit("reject", { why: `message ${b.file}: ${b.why}` })
      log(`refused message ${b.file}: ${b.why}`)
      rail.say("watcher", `refuse ${b.file}`)
    }
    // flush queued permission notes into panes that can take them
    rail.flushPendingNotes()
    const plan = relayPlan(messages, delivered, CAP)
    for (const r of plan.relays) {
      // a working member takes mail on a later beat — never mid-turn
      const state = rail.agentStatus(r.to)
      if (state.includes('"agent_status":"working"')) continue
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
      ended = plan.why ?? "stop"
      break
    }
    // the permission half of JEV (zen 6): a blocked member is a
    // question, and the typed decider answers it — the Rail owns the
    // sweep (roots, judge, escalation, ask cap); this loop only
    // carries the consequence: a capped member is dead and ends the
    // exchange. No dialog ever waits for a person.
    for (const m of members) {
      if (dead.includes(m.name)) continue
      const verdict = rail.answerPermission(m.name)
      if (verdict === "capped") {
        dead.push(m.name)
        ledger?.emit("wake", { why: `member ${m.name} blocked past the permission cap` })
        log(`member ${m.name} hit the permission cap — ending`)
      }
    }
    // the stall guard: whoever holds the ball and idles too long gets
    // nudged — twice, then the exchange ends. Working resets the clock.
    if (ballOn.name && !dead.includes(ballOn.name)) {
      const st = rail.agentStatus(ballOn.name)
      if (st.includes('"agent_status":"working"')) {
        ballOn.since = Date.now()
      } else if (Date.now() - ballOn.since > 120_000 && memberBookedWait(ballOn.name)) {
        // booked wait: a live child spur holds this member — stand the
        // nudge clock down without spending a nudge (ADR 0006)
        if (!stoodDown.has(ballOn.name)) {
          stoodDown.add(ballOn.name)
          log(`booked wait ${ballOn.name}: a live child spur holds it — nudges stand down`)
        }
        ballOn.since = Date.now()
      } else if (Date.now() - ballOn.since > 120_000) {
        const used = nudged.get(ballOn.name) ?? 0
        if (used < 2) {
          nudged.set(ballOn.name, used + 1)
          rail.promptAgent(
            ballOn.name,
            used === 0
              ? "The exchange waits on you. Continue your task now; when you have something for a peer, write your message file (messages/<seq>-<name>.json)."
              : `Second and final nudge, ${ballOn.name}: the exchange waits on you. Act now or the job ends unresolved.`,
          )
          ballOn.since = Date.now()
          log(`nudge ${ballOn.name} (${used + 1}/2)`)
          ledger?.emit("reprompt", { member: ballOn.name, nudge: used + 1 })
        } else {
          dead.push(ballOn.name)
          ledger?.emit("wake", { why: `member ${ballOn.name} stalled past the nudge cap` })
          log(`member ${ballOn.name} stalled past the nudge cap — ending`)
        }
      }
    }
    for (const m of members) {
      if (dead.includes(m.name)) continue
      if (!rail.paneAlive(m.name) && Date.now() - (bornAt.get(m.name) ?? 0) > 15_000) {
        dead.push(m.name)
        ledger?.emit("wake", { why: `member ${m.name} is dead` })
        log(`member ${m.name} is dead — ending the exchange`)
        rail.say("watcher", `${m.name} dead`)
      }
    }
    if (dead.length > 0) {
      ended = "dead"
      break
    }
    await waitChange(join(taskDir, "messages"), 30_000)
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
  if (ended !== "stop") rows.push({ unit: "exchange", result: `ended by ${ended}`, pass: false })
  log(`exchange ended (${ended}) — ${messages.length} messages, ${delivered.length} relayed`)
  const report = writeReport(
    taskDir,
    taskDir,
    rows,
    (table) => runCounts(taskDir, rail.manifest(), table),
    ended === "stop" && dead.length === 0 ? "done" : undefined,
  )
  rail.retireAll()
  rail.closeVerbose()
  return report
}
