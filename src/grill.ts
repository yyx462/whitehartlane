// Grill gate. Jev answers one question: is this enough to write hooks
// and run? Not enough stays in the First Mate chat. "just do it" skips.
// "grill me" forces the questions. The chat is the grill; no pane.
import { execFileSync } from "node:child_process"

export type Grill = { enough: boolean; p: number; ask?: string }

export const GRILL_ASK =
  "Not enough to run yet. Ask what is missing — the exact change, the done shape, and what must not be touched. Do not do the task. Do not spawn anything. When the user answers, call stand_up again with the original task plus their answers."

const ENOUGH_AT = 0.7

export function judgeEnough(task: string, noul: (task: string) => number = jevNoul): Grill {
  const forced = process.env.AGENTIC_OS_GRILL
  if (forced === "skip" || /^just do it\b/i.test(task)) return { enough: true, p: 1 }
  if (forced === "force" || /^grill me\b/i.test(task)) return { enough: false, p: 0, ask: GRILL_ASK }
  let p: number
  try {
    p = noul(task)
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err)
    return { enough: false, p: 0, ask: `${GRILL_ASK} (jev unavailable: ${why.slice(0, 120)})` }
  }
  if (p >= ENOUGH_AT) return { enough: true, p }
  return { enough: false, p, ask: GRILL_ASK }
}

export function jevNoul(task: string): number {
  const bin = process.env.AGENTIC_OS_JEV ?? "jev"
  const out = execFileSync(
    bin,
    [
      "noul",
      "Is this task specified enough to write worker hooks and run without more questions?",
      "-s",
      task.slice(0, 4000),
    ],
    { encoding: "utf8", timeout: 30_000 },
  )
  const match = out.match(/noul:\s*([0-9.]+)/)
  if (!match) throw new Error(`jev said: ${out.slice(0, 80)}`)
  return Number(match[1])
}
