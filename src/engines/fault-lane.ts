// The provider-fault lane — ONE algorithm, two engines. Born in the
// coworker loop (the jev model ladder: budgetAction → chooser/static
// → in-session switch → "[rail] your provider refused" prompt), it
// rode only that engine — j-93d652's gap #4: a fan-out worker on a
// faulting provider burned nudges and died with no switch lane. This
// module is the verbatim extraction; both engine beats call it.
// Deaths flow through the CALLER's close ceremony (the one spelling
// each engine already owns); the lane never closes anything itself.
import { budgetAction, clearPending, nextModel, readModelsFile, writePending } from "../jev/model-ladder.ts"
import { chooseModel, remainingCandidates } from "../jev/model-chooser.ts"

export type FaultRail = {
  workerStatus: (name: string) => string
  latestSessionFault: (sid: string, cwd: string) => { id: string; type: string } | null
  switchSessionModel: (sid: string, model: string, cwd: string) => { ok: boolean; why?: string }
  promptAgent: (name: string, text: string) => unknown
}

export type FaultLaneDeps = {
  taskDir: string
  names: string[]
  sessionOf: (name: string) => string | undefined
  cwdOf: (name: string) => string
  modelOf: (name: string) => string | undefined
  setModel: (name: string, model: string) => void
  isDead: (name: string) => boolean
  awaitingTurn: Set<string>
  actedFault: Map<string, string>
  deadModels: Map<string, Set<string>>
  policy: ReturnType<typeof readModelsFile>
  rail: FaultRail
  close: (name: string, why: string) => void
  resetClock: (name: string) => void
  log: (msg: string) => void
}

export function runFaultLane(d: FaultLaneDeps): void {
  for (const name of d.names) {
    if (d.isDead(name)) continue
    if (d.awaitingTurn.has(name)) {
      if (d.rail.workerStatus(name) === "working") d.awaitingTurn.delete(name)
      else continue
    }
    const sid = d.sessionOf(name)
    const fault = sid ? d.rail.latestSessionFault(sid, d.cwdOf(name)) : null
    if (fault && fault.id === d.actedFault.get(name)) continue
    const action = budgetAction({ fault: Boolean(fault), member: name, current: d.modelOf(name), policy: d.policy })
    if (action.kind === "none") continue
    if (action.kind === "waiting") {
      d.resetClock(name)
      continue
    }
    if (action.kind === "stay") {
      clearPending(d.taskDir, d.policy, name)
      continue
    }
    if (action.kind === "exhausted") {
      d.close(name, `${name} hit a provider fault and the model ladder is empty`)
      d.log(`worker ${name} out of candidates — no next model in the ladder`)
      continue
    }
    if (action.kind === "ask") {
      writePending(d.taskDir, d.policy, { member: name, from: d.modelOf(name) ?? "", to: action.to, at: new Date().toISOString(), why: "provider fault" })
      d.resetClock(name)
      d.log(`ASK model switch ${name}: ${d.modelOf(name) ?? "?"} -> ${action.to}`)
      continue
    }
    if (!sid) {
      d.log(`model switch ${name} -> ${action.to} skipped — no booked session yet`)
      continue
    }
    if (fault) d.actedFault.set(name, fault.id)
    // The failed model leaves the candidate set; the chooser (or the
    // static ladder, when no chooser is configured) picks among what
    // is still live. Empty remaining = the honest death walk.
    const deadSet = d.deadModels.get(name) ?? new Set<string>()
    if (d.modelOf(name)) deadSet.add(d.modelOf(name) as string)
    d.deadModels.set(name, deadSet)
    const remaining = remainingCandidates(d.policy.order, deadSet)
    if (remaining.length === 0) {
      d.close(name, `${name} hit a provider fault and every candidate model has failed`)
      d.log(`worker ${name} out of candidates — every candidate model failed`)
      continue
    }
    let to: string | null = null
    if (d.policy.chooser === "jev") {
      const pick = chooseModel({
        taskDir: d.taskDir,
        member: name,
        remaining,
        fault: fault ? { model: d.modelOf(name) ?? "", detail: fault.type } : null,
      })
      if (pick.ok && pick.model) {
        to = pick.model
        d.log(`chooser ${name}: ${to} (jev confidence ${pick.confidence}) over [${remaining.join(", ")}]`)
      } else {
        d.log(`chooser ${name}: ${pick.why} — static ladder fallback over [${remaining.join(", ")}]`)
      }
    }
    if (!to) to = nextModel(remaining, d.modelOf(name))
    if (!to) {
      d.close(name, `${name} hit a provider fault and every candidate model has failed`)
      d.log(`worker ${name} out of candidates — no next model among [${remaining.join(", ")}]`)
      continue
    }
    const switched = d.rail.switchSessionModel(sid, to, d.cwdOf(name))
    if (!switched.ok) {
      d.log(`model switch ${name} -> ${to} failed: ${switched.why}`)
      continue
    }
    d.setModel(name, to)
    d.awaitingTurn.add(name)
    d.rail.promptAgent(name, `[rail] Your provider refused another turn. The model for this session is now ${to}. Continue exactly where you left off.`)
    d.resetClock(name)
    d.log(`model switch ${name}: -> ${to} (inside the live session)`)
  }
}
