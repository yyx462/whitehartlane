// Grill gate. Jev answers one question: is this enough to write hooks
// and run? Not enough stays in the First Mate chat. "just do it" skips.
// "grill me" forces the questions. The chat is the grill; no pane.
// The question and the bar are the jev-tuner's landed winner.
import { loadPrompt, loadThreshold } from "./jev-prompts.ts"
import { jevNoulQ } from "./jev.ts"

export type Grill = { enough: boolean; p: number; ask?: string }

export const GRILL_ASK =
  "Not enough to run yet. Ask what is missing — the exact change, the done shape, and what must not be touched. Do not do the task. Do not spawn anything. When the user answers, call stand_up again with the original task plus their answers."

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
  if (p >= ENOUGH_AT()) return { enough: true, p }
  return { enough: false, p, ask: GRILL_ASK }
}

export function ENOUGH_AT(): number {
  return loadThreshold("grill-enough")
}

export function jevNoul(task: string): number {
  return jevNoulQ(loadPrompt("grill-enough"), task)
}
