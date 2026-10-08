// The jev-tuner core. Every JEV-involved decision gate gets a folder
// under jev-tuner/gates/<gate>/ holding its test cases (cases.jsonl,
// >= 50, LLM-seeded), its prompt candidates (prompts/), its run
// reports (results/), and its winner record (winner.json). runGate
// scores every candidate through the real jev CLI — the same adapter
// production asks through — sweeps noul thresholds offline from the
// recorded probabilities, and the accuracy winner lands in production
// (src/jev-prompts/<gate>.* , read live by the rails) automatically
// when it beats the incumbent by the gate's margin. Tuning is never
// hand-copying: promote writes, production reads, the loop closes.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { landGate, loadThreshold, type GateId } from "./jev-prompts.ts"
import { jevChoiceQAsync, jevNoulQAsync } from "./jev.ts"
import { permissionJudgeState } from "./permission.ts"

export type GateKind = "noul" | "choice"

export type GateConfig = {
  id: GateId
  kind: GateKind
  min_cases: number
  margin: number
  positive: string
  negative: string
  state: "task" | "permission-ask"
  describes: string
  input_fields: Record<string, string>
}

export type TunerCase = {
  id: string
  input: Record<string, string>
  expected: string
  note?: string
}

export type NoulCandidate = { name: string; prompt: string }
export type ChoiceCandidate = { name: string; prompt: string; options: Record<string, string> }
export type Candidate = NoulCandidate | ChoiceCandidate

export type CandidateScore = {
  name: string
  accuracy: number
  threshold?: number
  confusion: { hit: number; miss: number }
  misses: string[]
  errors: string[]
}

export type WinnerRecord = {
  name: string
  accuracy: number
  threshold: number
  cases: number
  landed_at: string
  prompt: string
  options?: Record<string, string>
}

export type RunReport = {
  gate: string
  at: string
  cases: number
  candidates: CandidateScore[]
  winner?: CandidateScore
  incumbent?: { name: string; accuracy: number }
  landed: boolean
  why_not?: string
}

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "jev-tuner", "gates")

// call-time resolution: tests point the tuner at a tmp gates dir
export function gatesRoot(): string {
  return process.env.AGENTIC_OS_TUNER_GATES ?? defaultRoot
}

export function gateDir(id: string): string {
  return join(gatesRoot(), id)
}

export function loadGateConfig(id: string): GateConfig {
  const file = join(gateDir(id), "gate.json")
  if (!existsSync(file)) throw new Error(`no such gate: ${id} (expected ${file})`)
  const cfg = JSON.parse(readFileSync(file, "utf8")) as GateConfig
  if (cfg.kind !== "noul" && cfg.kind !== "choice") throw new Error(`gate ${id}: bad kind ${cfg.kind}`)
  return cfg
}

export function listGates(): GateConfig[] {
  const root = gatesRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "gate.json")))
    .map((d) => loadGateConfig(d.name))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function loadCases(id: string): TunerCase[] {
  const cfg = loadGateConfig(id)
  const file = join(gateDir(id), "cases.jsonl")
  if (!existsSync(file)) throw new Error(`gate ${id} has no cases.jsonl`)
  const cases: TunerCase[] = []
  const seen = new Set<string>()
  for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
    const text = line.trim()
    if (!text) continue
    let parsed: TunerCase
    try {
      parsed = JSON.parse(text) as TunerCase
    } catch (err) {
      throw new Error(`gate ${id} cases.jsonl line ${i + 1} is not JSON: ${err instanceof Error ? err.message : err}`)
    }
    if (!parsed.id || seen.has(parsed.id)) throw new Error(`gate ${id}: missing or duplicate case id at line ${i + 1}`)
    seen.add(parsed.id)
    if (typeof parsed.input !== "object" || parsed.input === null) {
      throw new Error(`gate ${id} case ${parsed.id}: input must be an object`)
    }
    if (parsed.expected !== cfg.positive && parsed.expected !== cfg.negative) {
      throw new Error(
        `gate ${id} case ${parsed.id}: expected must be ${cfg.positive}|${cfg.negative}, got ${parsed.expected}`,
      )
    }
    cases.push(parsed)
  }
  return cases
}

export function loadCandidates(id: string, kind: GateKind): Candidate[] {
  const dir = join(gateDir(id), "prompts")
  if (!existsSync(dir)) throw new Error(`gate ${id} has no prompts/ folder`)
  const out: Candidate[] = []
  for (const f of readdirSync(dir).sort()) {
    if (kind === "noul" && f.endsWith(".txt")) {
      const prompt = readFileSync(join(dir, f), "utf8").trim()
      if (prompt) out.push({ name: f.replace(/\.txt$/, ""), prompt })
    }
    if (kind === "choice" && f.endsWith(".json")) {
      const parsed = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        question?: string
        options?: Record<string, string>
      }
      if (parsed.question && parsed.options && Object.keys(parsed.options).length >= 2) {
        out.push({ name: f.replace(/\.json$/, ""), prompt: parsed.question, options: parsed.options })
      }
    }
  }
  if (out.length === 0) throw new Error(`gate ${id}: no candidates in prompts/`)
  return out
}

// The state string for one case — exactly what production sends.
export function stateOf(cfg: GateConfig, input: Record<string, string>): string {
  if (cfg.state === "permission-ask") {
    return permissionJudgeState({
      path: input.path ?? "",
      ask: input.ask ?? "",
      context: input.context,
    })
  }
  return input.task ?? ""
}

export type Askers = {
  noul?: (question: string, state: string) => Promise<number>
  choice?: (
    question: string,
    options: Record<string, string>,
    state: string,
  ) => Promise<{ choice: string; p: number; confidence: number }>
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<Map<T, R>> {
  const out = new Map<T, R>()
  let next = 0
  const runners = Array.from({ length: Math.max(1, size) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      out.set(item, await work(item))
    }
  })
  await Promise.all(runners)
  return out
}

function bestThreshold(
  ps: { p: number; expected: string }[],
  positive: string,
  negative: string,
): { accuracy: number; threshold: number } {
  const thresholds = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]
  let best = { accuracy: -1, threshold: 0.5 }
  for (const t of thresholds) {
    let hit = 0
    for (const c of ps) {
      if ((c.p >= t ? positive : negative) === c.expected) hit++
    }
    const accuracy = ps.length > 0 ? hit / ps.length : 0
    if (accuracy > best.accuracy) best = { accuracy, threshold: t }
  }
  return best
}

async function scoreCandidate(
  cfg: GateConfig,
  candidate: Candidate,
  cases: TunerCase[],
  askers: Askers,
  jobs: number,
): Promise<CandidateScore> {
  const ask = async (c: TunerCase) => {
    const state = stateOf(cfg, c.input)
    if (cfg.kind === "noul") {
      const noul = askers.noul ?? ((q, s) => jevNoulQAsync(q, s))
      return { kind: "noul" as const, value: await noul(candidate.prompt, state) }
    }
    const choice =
      askers.choice ?? ((q, o, s) => jevChoiceQAsync(q, o, s))
    const options =
      "options" in candidate && candidate.options ? candidate.options : { [cfg.positive]: "", [cfg.negative]: "" }
    return { kind: "choice" as const, value: await choice(candidate.prompt, options, state) }
  }
  const results = await pool(cases, jobs, async (c) => {
    try {
      return { ok: true as const, ...(await ask(c)) }
    } catch (err) {
      // one retry — jev hiccups are common enough to matter
      try {
        return { ok: true as const, ...(await ask(c)) }
      } catch {
        return { ok: false as const, error: err instanceof Error ? err.message.slice(0, 120) : String(err) }
      }
    }
  })
  const misses: string[] = []
  const errors: string[] = []
  let hit = 0
  let threshold: number | undefined
  if (cfg.kind === "noul") {
    const ps: { id: string; p: number; expected: string }[] = []
    for (const c of cases) {
      const r = results.get(c)
      if (!r || !r.ok) {
        errors.push(`${c.id}: ${r && !r.ok ? r.error : "no result"}`)
        continue
      }
      if (r.kind !== "noul") continue
      ps.push({ id: c.id, p: r.value as number, expected: c.expected })
    }
    const best = bestThreshold(ps, cfg.positive, cfg.negative)
    threshold = best.threshold
    for (const c of ps) {
      const predicted = c.p >= best.threshold ? cfg.positive : cfg.negative
      if (predicted === c.expected) hit++
      else misses.push(c.id)
    }
  } else {
    for (const c of cases) {
      const r = results.get(c)
      if (!r || !r.ok) {
        errors.push(`${c.id}: ${r && !r.ok ? r.error : "no result"}`)
        continue
      }
      if (r.kind !== "choice") continue
      const value = r.value as { choice: string }
      if (value.choice === c.expected) hit++
      else misses.push(c.id)
    }
  }
  const scored = cases.length - errors.length
  return {
    name: candidate.name,
    accuracy: scored > 0 ? hit / scored : 0,
    threshold,
    confusion: { hit, miss: scored - hit },
    misses,
    errors,
  }
}

export function readWinner(id: string): WinnerRecord | undefined {
  const file = join(gateDir(id), "winner.json")
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as WinnerRecord
  } catch {
    return undefined
  }
}

export function writeWinner(id: string, record: WinnerRecord): void {
  writeFileSync(join(gateDir(id), "winner.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

export type RunOptions = {
  jobs?: number
  land?: boolean
  askers?: Askers
  now?: () => string
}

export async function runGate(id: string, opts: RunOptions = {}): Promise<RunReport> {
  const cfg = loadGateConfig(id)
  const cases = loadCases(id)
  const candidates = loadCandidates(id, cfg.kind)
  const jobs = opts.jobs ?? 4
  const land = opts.land ?? true
  const now = opts.now ?? (() => new Date().toISOString())
  const scores: CandidateScore[] = []
  for (const candidate of candidates) {
    scores.push(await scoreCandidate(cfg, candidate, cases, opts.askers ?? {}, jobs))
  }
  scores.sort((a, b) => b.accuracy - a.accuracy || a.name.localeCompare(b.name))
  const winner = scores[0]
  const incumbent = readWinner(id)
  const report: RunReport = {
    gate: id,
    at: now(),
    cases: cases.length,
    candidates: scores,
    winner: winner ? { name: winner.name, accuracy: winner.accuracy, threshold: winner.threshold } : undefined,
    incumbent: incumbent ? { name: incumbent.name, accuracy: incumbent.accuracy } : undefined,
    landed: false,
  }
  const enough = cases.length >= cfg.min_cases
  if (!enough) report.why_not = `only ${cases.length} cases (min ${cfg.min_cases})`
  const bar = (incumbent?.accuracy ?? -1) + cfg.margin
  if (!winner || !enough || winner.accuracy < bar) {
    report.why_not ??= `best ${winner?.accuracy.toFixed(2) ?? "n/a"} under the land bar ${bar.toFixed(2)}`
    writeResult(id, report)
    return report
  }
  const candidate = candidates.find((c) => c.name === winner.name)
  if (!candidate) throw new Error(`winner ${winner.name} vanished between scoring and landing`)
  const threshold = winner.threshold ?? loadThreshold(cfg.id)
  if (land) {
    landGate(
      cfg.id,
      candidate.prompt,
      threshold,
      "options" in candidate && candidate.options ? candidate.options : undefined,
    )
    const record: WinnerRecord = {
      name: candidate.name,
      accuracy: winner.accuracy,
      threshold,
      cases: cases.length,
      landed_at: now(),
      prompt: candidate.prompt,
    }
    if ("options" in candidate && candidate.options) record.options = candidate.options
    writeWinner(id, record)
    report.landed = true
  }
  writeResult(id, report)
  return report
}

function writeResult(id: string, report: RunReport): void {
  const dir = join(gateDir(id), "results")
  mkdirSync(dir, { recursive: true })
  const stamp = report.at.replace(/[:.]/g, "-")
  writeFileSync(join(dir, `${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8")
}

export function appendCases(id: string, cases: TunerCase[]): number {
  const file = join(gateDir(id), "cases.jsonl")
  const existing = existsSync(file) ? new Set(loadCases(id).map((c) => c.id)) : new Set<string>()
  const fresh = cases.filter((c) => !existing.has(c.id))
  if (fresh.length > 0) {
    writeFileSync(file, fresh.map((c) => JSON.stringify(c)).join("\n") + "\n", { encoding: "utf8", flag: "a" })
  }
  return fresh.length
}
