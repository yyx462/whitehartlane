// Backpressure, admitted from use (2026-10-01: a provider 429 killed a
// planner call and aborted the run — a temporary condition treated as
// fatal). One retry layer per call site: the hook CLASSIFIES (exit 75
// = the provider refused or slowed; anything else is deterministic),
// and the rail retries — refusal only, exponential backoff with
// jitter, a hard cap, a visible line per wait (a silent backoff reads
// as a hang), and a trace event so the wait is never mysterious.
export class RefusedError extends Error {
  readonly why: string
  constructor(why: string) {
    super(`provider refused: ${why}`)
    this.why = why
  }
}

export type BackpressureOpts = {
  attempts?: number // total tries, default 3
  baseMs?: number // first wait; default AGENTIC_OS_BACKOFF_MS ?? 2000
  jitterMs?: number // 0..jitter added per wait, default 500
  who?: string
  log?: (msg: string) => void
  emit?: (kind: string, payload: Record<string, unknown>) => void
  sleep?: (ms: number) => void
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function withBackpressure<T>(fn: (attempt: number) => T, opts: BackpressureOpts = {}): T {
  const attempts = opts.attempts ?? 3
  const base = opts.baseMs ?? (Number(process.env.AGENTIC_OS_BACKOFF_MS ?? "") || 2000)
  const jitter = opts.jitterMs ?? 500
  const who = opts.who ?? "call"
  for (let attempt = 1; ; attempt++) {
    try {
      return fn(attempt)
    } catch (err) {
      if (!(err instanceof RefusedError) || attempt >= attempts) throw err
      const wait = base * 2 ** (attempt - 1) + Math.floor(Math.random() * jitter)
      opts.log?.(`${who} refused (attempt ${attempt}/${attempts}): ${err.why} — waiting ${(wait / 1000).toFixed(1)}s`)
      opts.emit?.("backpressure", { who, attempt, waitMs: wait, why: err.why })
      ;(opts.sleep ?? sleepSync)(wait)
    }
  }
}
