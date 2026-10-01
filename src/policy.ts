// Policy is the admitting half of JEV: the model (or the deterministic
// router) proposes, these pure checks admit. Admission never spawns; it
// only answers. Rejections carry a why for the trace.

export type Admission = { admit: boolean; why?: string }

export function admitDirect(): Admission {
  return { admit: true }
}

export function admitFanOut(input: {
  manifestResolved: boolean
  manifestWhy?: string
  slots: number
}): Admission {
  if (!input.manifestResolved) {
    return { admit: false, why: input.manifestWhy ?? "no workflow.toml resolves" }
  }
  if (!Number.isInteger(input.slots) || input.slots < 1) {
    return { admit: false, why: `invalid slots: ${input.slots}` }
  }
  return { admit: true }
}

export function admitAnotherJob(running: number): Admission {
  if (running > 0) return { admit: false, why: `a job is already running (${running})` }
  return { admit: true }
}

export function admitWorkerSpawn(input: {
  settled: boolean
  shutdown: boolean
  active: number
  slots: number
  attempts: number
  cap: number
}): Admission {
  if (input.shutdown) return { admit: false, why: "orchestrator shutting down" }
  if (input.settled) return { admit: false, why: "unit already settled" }
  if (input.active >= input.slots) {
    return { admit: false, why: `slots full (${input.active}/${input.slots})` }
  }
  if (input.attempts >= input.cap) {
    return { admit: false, why: `retry cap reached (${input.attempts}/${input.cap})` }
  }
  return { admit: true }
}
