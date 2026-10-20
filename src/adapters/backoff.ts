// The herdr brownout guard (ADR 0010): the 2026-10-12 09:51 storm —
// seven spurs asking for panes in the same second, herdr choking, and
// a zero-retry engine treating the first refusal as death. Two
// primitives fix both halves: births STAGGER (a random pause, so a
// batch arrives as a queue, not a stampede) and refusals RETRY with
// growing pauses (brownouts last seconds, not minutes). The engines
// are synchronous by design (spawnSync CLIs) — a bounded blocking
// pause via Atomics.wait is the in-process price, no subprocess.

// sync sleep without a subprocess — Atomics.wait on a shared cell
export function sleepSync(ms: number): void {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// attempts for a retrying call: an explicit env knob always wins;
// otherwise the production default — except under node:test, where
// the default is a single attempt (tests inject their own scales)
export function retries(envVar: string, productionDefault: number): number {
  const raw = Number(process.env[envVar] ?? "")
  if (Number.isInteger(raw) && raw >= 1) return raw
  return process.env.NODE_TEST_CONTEXT ? 1 : productionDefault
}

// the pause before retry N: base, base×3, base×9… — knock louder each time
export function backoffMs(base: number, attempt: number): number {
  return base * 3 ** (attempt - 1)
}

// a retry pause base: explicit env wins; production default otherwise —
// 0 under node:test (a single attempt never pauses anyway, and tests
// that scale the loop name their own base)
export function backoffBase(envVar: string, productionDefault: number): number {
  const raw = process.env[envVar]
  if (raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw)
  return process.env.NODE_TEST_CONTEXT ? 0 : productionDefault
}

// an explicit env bound always wins; otherwise the production default,
// except under node:test (0 — no jitter to slow the suite)
export function jitterBound(envVar: string, productionDefault: number): number {
  const raw = process.env[envVar]
  if (raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw)
  return process.env.NODE_TEST_CONTEXT ? 0 : productionDefault
}

// the drawn pause, uniform in [0, bound)
export function drawJitter(bound: number): number {
  return bound <= 0 ? 0 : Math.floor(Math.random() * bound)
}
