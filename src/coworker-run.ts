// The coworker engine (moved out of bin/lab-orchestrator so tests can
// reach it — the bin is only the door). Members talk through the rail:
// this loop births each named member with its own brief and model,
// relays message files as prompts to the named pane, ends on stop or
// the cap, then reports. The privilege sweep, pane bookkeeping, and
// layout all live on the Rail.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { memberProtocol, parseMembers, readMessages, relayPlan, combineFirstPrompt, interruptedMember, readRelayLedger, writeRelayLedger } from "./coworker.ts"
import { runCounts } from "./hooks.ts"
import { emptyBoard } from "./lanes.ts"
import { drainDeadline } from "./orchestrator.ts"
import { waitChange, type Rail } from "./rail.ts"
import { writeReport, type Report } from "./report.ts"
import { liveSpawnerSessionIds, writeWorkerPermissions } from "./store.ts"

export async function runCoworker(
  rail: Rail,
  opts: { stallMs?: number; beatMs?: number; graceMs?: number } = {},
): Promise<Report | null> {
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
      .filter((p) => p.unit === name && p.transcript)
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
    // for paths every verdict allowed)
    const extraRoots = (m.roots ?? []).map((r) => r.replace(/^~(?=\/|$)/, homedir()))
    writeWorkerPermissions(dir, [taskDir, ...rail.programRoots, ...extraRoots])
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
    paneOfMember.set(m.name, slot.pane)
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
  const retryCap = manifest.workflow.retry ?? 1
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
          m.model, m.seed, Boolean(resumeId), resumeId,
        )
      : false
    if (slot.pane && ok) rail.renamePane(slot.pane, m.name)
    if (!ok) return false
    bornAt.set(m.name, Date.now())
    // a respawned session already carries its brief — never re-brief it
    prompted.add(m.name)
    nudged.delete(m.name)
    stoodDown.delete(m.name)
    const attempt = retriesUsed.get(m.name) ?? 1
    rail.promptAgent(
      m.name,
      `[rail] Your process died mid-exchange (transport fault — retry ${attempt}/${retryCap}). Your session was resumed from its checkpoint; pick up exactly where you left off.`,
    )
    rail.say("rail", `respawn ${m.name} (transport retry ${attempt}/${retryCap})`)
    return true
  }
  // the stall guard's clock and the loop's beat — parameterized so
  // tests drive the nudge ladder in milliseconds
  const stallMs = opts.stallMs ?? 120_000
  const beatMs = opts.beatMs ?? 5_000
  // the newborn grace: a pane younger than this is not judged dead yet
  // (birth is asynchronous) — parameterized so tests drive it to 0
  const graceMs = opts.graceMs ?? 15_000
  const dead: string[] = []
  // why each member died — the report's exchange row carries it, so a
  // "failed" never arrives without its reason (j-5b245e read "ended by
  // dead" with the cap hit only in the log)
  const deadWhy = new Map<string, string>()
  // the ball: whose turn the exchange waits on. Idle too long → one
  // nudge, then a second, then the member is dead. A silent member
  // must never stall the exchange forever.
  const ballOn = { name: members.find((m) => m.initiates)?.name, since: Date.now() }
  const nudged = new Map<string, number>()
  // a nudge-cap kill deferred because guidance was still queued — once
  // per member; the second expiry is honest death
  const deferred = new Set<string>()
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
      ` Fix the file and write it again: messages/<seq>-<your-name>.json holding {"from","to","type":"note"|"stop","body"} with seq a positive integer.`
    )
  }
  const refusalSuffix = (member: string): string => {
    const n = refusalsOf(member).length
    return n > 0 ? ` — ${n} message file(s) refused by the relay: ${refusalList(member)}` : ""
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
    // the permission half of JEV (zen 6, rail-owned): a blocked member
    // is a question, and the rail's sweep answers it — every pane the
    // rail holds, this loop's members and anything else alike. This
    // loop only carries the consequence: a capped member is dead and
    // ends the exchange. No dialog ever waits for a person.
    const sweep = rail.tickPrivilege()
    const answered = new Set<string>()
    for (const m of members) {
      if (dead.includes(m.name)) continue
      if (sweep.answered.has(m.name)) answered.add(m.name)
      if (sweep.capped.has(m.name)) {
        dead.push(m.name)
        deadWhy.set(m.name, `${m.name} blocked past the deny cap`)
        ledger?.emit("wake", { why: `member ${m.name} blocked past the deny cap` })
        log(`member ${m.name} hit the deny cap — ending`)
      }
    }
    // a dialog the rail just answered is progress: the stall clock
    // resets, or permission churn eats the whole nudge budget while
    // the member is talking to the rail, not idling (j-a532f9)
    if (ballOn.name && answered.has(ballOn.name)) ballOn.since = Date.now()
    // the stall guard: whoever holds the ball and idles too long gets
    // nudged — twice, then the exchange ends. Working resets the clock.
    if (ballOn.name && !dead.includes(ballOn.name)) {
      const st = rail.agentStatus(ballOn.name)
      if (st.includes('"agent_status":"working"')) {
        ballOn.since = Date.now()
      } else if (Date.now() - ballOn.since > stallMs && memberBookedWait(ballOn.name)) {
        // booked wait: a live child spur holds this member — stand the
        // nudge clock down without spending a nudge (ADR 0006)
        if (!stoodDown.has(ballOn.name)) {
          stoodDown.add(ballOn.name)
          log(`booked wait ${ballOn.name}: a live child spur holds it — nudges stand down`)
        }
        ballOn.since = Date.now()
      } else if (Date.now() - ballOn.since > stallMs) {
        const used = nudged.get(ballOn.name) ?? 0
        if (used < 2) {
          nudged.set(ballOn.name, used + 1)
          rail.promptAgent(
            ballOn.name,
            (used === 0
              ? "The exchange waits on you. Continue your task now; when you have something for a peer, write your message file (messages/<seq>-<name>.json)."
              : `Second and final nudge, ${ballOn.name}: the exchange waits on you. Act now or the job ends unresolved.`) + refusalQuote(ballOn.name),
          )
          ballOn.since = Date.now()
          log(`nudge ${ballOn.name} (${used + 1}/2)`)
          ledger?.emit("reprompt", { member: ballOn.name, nudge: used + 1 })
        } else if (rail.hasPendingNote(ballOn.name) && !deferred.has(ballOn.name)) {
          // the guidance is still queued — a blocked pane refused it and
          // the kill raced the message that could save the member
          // (j-a532f9: dead 5s after the deny, note undelivered).
          // Defer death one beat and try to flush now; the second
          // expiry is honest death.
          deferred.add(ballOn.name)
          ballOn.since = Date.now()
          rail.flushPendingNotes()
          log(`member ${ballOn.name} at the nudge cap — guidance still queued, deferring one beat`)
          ledger?.emit("reprompt", { member: ballOn.name, deferred: true })
        } else {
          const reason = `${ballOn.name} stalled past the nudge cap${refusalSuffix(ballOn.name)}`
          dead.push(ballOn.name)
          deadWhy.set(ballOn.name, reason)
          ledger?.emit("wake", { why: `member ${reason}` })
          log(`member ${reason} — ending`)
        }
      }
    }
    for (const m of members) {
      if (dead.includes(m.name)) continue
      if (!rail.paneAlive(m.name) && Date.now() - (bornAt.get(m.name) ?? 0) > graceMs) {
        // transport class (issue #122): the pane is gone — crash, kill,
        // browned-out TTY. Not the member's answer; respawn it from the
        // booked session while retries remain, and only then is the
        // death honest.
        const used = retriesUsed.get(m.name) ?? 0
        if (used < retryCap && respawnMember(m)) {
          retriesUsed.set(m.name, used + 1)
          ledger?.emit("retry", { member: m.name, attempt: used + 1, why: "pane died" })
          log(`member ${m.name} pane died — respawned from booked session (transport retry ${used + 1}/${retryCap})`)
          continue
        }
        const spent = retriesUsed.get(m.name) ?? 0
        dead.push(m.name)
        deadWhy.set(m.name, `${m.name} pane died${spent > 0 ? ` after ${spent} transport retry(ies)` : ""}`)
        ledger?.emit("wake", { why: `member ${m.name} is dead` })
        log(`member ${m.name} is dead — ending the exchange`)
        rail.say("watcher", `${m.name} dead`)
      }
    }
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
  const report = writeReport(
    taskDir,
    taskDir,
    rows,
    (table) => runCounts(taskDir, rail.manifest(), table),
    ended === "stop" && dead.length === 0 && unresolved.length === 0 ? "done" : undefined,
  )
  rail.retireAll()
  rail.closeVerbose()
  return report
}
