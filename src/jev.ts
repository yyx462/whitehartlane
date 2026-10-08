// The shared jev adapter: one place that knows the CLI shape. Every
// JEV-involved gate (grill, workflow choice, the permission judge)
// asks through here, so the tuner tunes what production runs. Sync
// for the rails (a rail tick never awaits), async for the tuner's
// parallel scoring. A dead jev always throws — callers decide the
// fallback; nothing here waits for a person.
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"

const execFileA = promisify(execFile)

export type JevChoiceAnswer = { choice: string; p: number; confidence: number }

export function jevBin(): string {
  return process.env.AGENTIC_OS_JEV ?? "jev"
}

function parseNoul(out: string): number {
  const match = out.match(/noul:\s*([0-9.]+)/)
  if (!match) throw new Error(`jev said: ${out.slice(0, 80)}`)
  return Number(match[1])
}

function parseChoice(out: string): JevChoiceAnswer {
  const match = out.match(/choice:\s*(\S+)\s+p=([0-9.]+)\s+confidence=([0-9.]+)/)
  if (!match) throw new Error(`jev said: ${out.slice(0, 80)}`)
  return { choice: match[1], p: Number(match[2]), confidence: Number(match[3]) }
}

function choiceArgs(question: string, options: Record<string, string>, state: string): string[] {
  const args = ["choice", question]
  for (const [key, desc] of Object.entries(options)) args.push("--opt", `${key}=${desc}`)
  args.push("-s", state.slice(0, 8000))
  return args
}

export function jevNoulQ(question: string, state: string): number {
  const out = execFileSync(jevBin(), ["noul", question, "-s", state.slice(0, 8000)], {
    encoding: "utf8",
    timeout: 30_000,
  })
  return parseNoul(out)
}

export function jevChoiceQ(question: string, options: Record<string, string>, state: string): JevChoiceAnswer {
  const out = execFileSync(jevBin(), choiceArgs(question, options, state), {
    encoding: "utf8",
    timeout: 30_000,
  })
  return parseChoice(out)
}

export async function jevNoulQAsync(question: string, state: string): Promise<number> {
  const { stdout } = await execFileA(
    jevBin(),
    ["noul", question, "-s", state.slice(0, 8000)],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  )
  return parseNoul(stdout)
}

export async function jevChoiceQAsync(
  question: string,
  options: Record<string, string>,
  state: string,
): Promise<JevChoiceAnswer> {
  const { stdout } = await execFileA(jevBin(), choiceArgs(question, options, state), {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  return parseChoice(stdout)
}
