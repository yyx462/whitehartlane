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

// A fork passes the same admission as any birth, plus its seed must
// resolve (zen 6): a known tool and a readable host session.
export function admitFork(input: {
  seed: { tool: string; session_id: string; session_file?: string }
  fileExists: (path: string) => boolean
}): Admission {
  if (input.seed.tool !== "pi" && input.seed.tool !== "opencode")
    return { admit: false, why: `unknown seed tool: ${input.seed.tool}` }
  if (!input.seed.session_file)
    return { admit: false, why: `seed ${input.seed.session_id} has no session_file to resolve` }
  if (!input.fileExists(input.seed.session_file))
    return { admit: false, why: `seed session unreadable: ${input.seed.session_file}` }
  return { admit: true }
}

export function admitWorkerSpawn(input: {
  finished: boolean
  shutdown: boolean
  active: number
  slots: number
  attempts: number
  cap: number
}): Admission {
  if (input.shutdown) return { admit: false, why: "orchestrator shutting down" }
  if (input.finished) return { admit: false, why: "unit already finished" }
  if (input.active >= input.slots) {
    return { admit: false, why: `slots full (${input.active}/${input.slots})` }
  }
  if (input.attempts >= input.cap) {
    return { admit: false, why: `retry cap reached (${input.attempts}/${input.cap})` }
  }
  return { admit: true }
}
