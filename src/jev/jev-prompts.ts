// Landed prompts. The jev-tuner's winner lands here; production
// gates read this folder at call time and fall back to the compiled
// defaults — a missing or deleted file never breaks a rail. Thresholds
// land beside their prompt as <gate>.json so a tuned gate moves as one
// unit. Everything here is data, not code: the tuner may rewrite it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const srcDir = dirname(fileURLToPath(import.meta.url))

// call-time resolution: tests point the tuner's lands at a tmp dir
function promptsDir(): string {
  return process.env.AGENTIC_OS_JEV_PROMPTS_DIR ?? join(srcDir, "jev-prompts")
}

export type GateId = "permission-needed" | "grill-enough" | "workflow-choice"

export const DEFAULT_PROMPTS: Record<GateId, string> = {
  "permission-needed":
    "A worker agent is blocked on a permission ask. Given the ask, the worker's task, and the job's roots, is this path plausibly needed to do the task?",
  "grill-enough":
    "Is this task specified enough to write worker hooks and run without more questions?",
  "workflow-choice":
    "Is this task a bag of independent units, such as separate web searches, where no unit needs another's result?",
}

export const DEFAULT_THRESHOLDS: Record<GateId, number> = {
  "permission-needed": 0.5,
  "grill-enough": 0.7,
  "workflow-choice": 0.5,
}

// Choice gates carry their options beside the question; noul gates
// have none.
export const DEFAULT_OPTIONS: Record<GateId, Record<string, string> | undefined> = {
  "workflow-choice": {
    "fan-out": "The task is independent units. No unit needs another unit's result.",
    direct: "The task is one piece of work, like a coding change in one chat.",
  },
}

export function promptFile(gate: GateId): string {
  return join(promptsDir(), `${gate}.txt`)
}

export function thresholdFile(gate: GateId): string {
  return join(promptsDir(), `${gate}.json`)
}

export function loadPrompt(gate: GateId): string {
  const file = promptFile(gate)
  if (!existsSync(file)) return DEFAULT_PROMPTS[gate]
  const text = readFileSync(file, "utf8").trim()
  return text.length > 0 ? text : DEFAULT_PROMPTS[gate]
}

export function loadThreshold(gate: GateId): number {
  const file = thresholdFile(gate)
  if (!existsSync(file)) return DEFAULT_THRESHOLDS[gate]
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { threshold?: unknown }
    if (typeof parsed.threshold === "number" && parsed.threshold > 0 && parsed.threshold < 1) {
      return parsed.threshold
    }
  } catch {
    // a broken meta file falls back to the default, never blocks a gate
  }
  return DEFAULT_THRESHOLDS[gate]
}

export function loadOptions(gate: GateId): Record<string, string> {
  const file = thresholdFile(gate)
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { options?: unknown }
      if (
        parsed.options &&
        typeof parsed.options === "object" &&
        Object.values(parsed.options as Record<string, unknown>).every((v) => typeof v === "string")
      ) {
        return { ...(parsed.options as Record<string, string>) }
      }
    } catch {
      // fall through to the defaults
    }
  }
  return { ...(DEFAULT_OPTIONS[gate] ?? {}) }
}

// The tuner's promote lands a winner: prompt, threshold, and (for a
// choice gate) its options — one gate moves as one unit.
export function landGate(
  gate: GateId,
  prompt: string,
  threshold: number,
  options?: Record<string, string>,
): void {
  mkdirSync(promptsDir(), { recursive: true })
  writeFileSync(promptFile(gate), `${prompt.trim()}\n`, "utf8")
  const meta: Record<string, unknown> = { threshold, gate }
  if (options) meta.options = options
  writeFileSync(thresholdFile(gate), `${JSON.stringify(meta, null, 2)}\n`, "utf8")
}
