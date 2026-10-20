// The init half of the jev-tuner: seed a gate's cases with an LLM.
// The tuner scores through jev (typed judgment, no generation), so
// seeding borrows the same key jev uses (~/.config/jev/env) against
// an openai-compatible chat endpoint. Everything generated is
// validated against the gate's schema before it touches cases.jsonl
// — the LLM proposes cases, loadCases' checks dispose.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { GateConfig, TunerCase } from "./jev-tuner.ts"

export type InitOptions = {
  n: number
  apiKey?: string
  baseUrl?: string
  model?: string
  fetchImpl?: typeof fetch
}

function jevEnvValue(varName: string): string {
  if (process.env[varName]) return process.env[varName]
  for (const file of [`${process.env.HOME}/.config/jev/env`, `${process.env.HOME}/.secrets/env`]) {
    if (!existsSync(file)) continue
    const line = readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null && m[1] === varName)
      .pop()
    if (line) {
      let v = line[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      return v
    }
  }
  return ""
}

export function buildSeedPrompt(cfg: GateConfig, n: number, examples: TunerCase[]): string {
  const fields = Object.entries(cfg.input_fields)
    .map(([k, v]) => `  "${k}": ${v}`)
    .join("\n")
  const shots = examples
    .slice(0, 6)
    .map((c) => JSON.stringify(c))
    .join("\n")
  return [
    `You write test cases for a typed decision gate named "${cfg.id}".`,
    `The gate decides: ${cfg.describes}`,
    `Each case is one JSON object on one line with exactly these input fields:`,
    fields,
    ``,
    `Labels: "${cfg.positive}" and "${cfg.negative}". Aim for a hard, balanced mix:`,
    `about half ${cfg.positive}, half ${cfg.negative}, including near-miss cases where surface`,
    `features point one way and the right answer is the other. No trivial repeats.`,
    ``,
    `Examples of the exact shape (do not copy their content):`,
    shots || "(none)",
    ``,
    `Write ${n} new cases as a JSON array of objects with fields "input", "expected", "note".`,
    `Respond with ONLY the JSON array, no prose, no code fence.`,
  ].join("\n")
}

export function parseSeedCases(raw: string, cfg: GateConfig): TunerCase[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start < 0 || end <= start) throw new Error("no JSON array in the LLM answer")
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown[]
  const out: TunerCase[] = []
  for (const [i, item] of parsed.entries()) {
    if (typeof item !== "object" || item === null) continue
    const obj = item as { input?: unknown; expected?: unknown; note?: unknown; id?: unknown }
    if (typeof obj.input !== "object" || obj.input === null) continue
    if (obj.expected !== cfg.positive && obj.expected !== cfg.negative) continue
    const input: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj.input as Record<string, unknown>)) {
      if (typeof v === "string") input[k] = v
    }
    out.push({
      id: typeof obj.id === "string" && obj.id ? obj.id : `${cfg.id}-llm-${Date.now().toString(36)}-${i}`,
      input,
      expected: obj.expected,
      note: typeof obj.note === "string" ? obj.note.slice(0, 200) : undefined,
    })
  }
  return out
}

export async function initCases(
  cfg: GateConfig,
  examples: TunerCase[],
  opts: InitOptions,
): Promise<TunerCase[]> {
  const apiKey = opts.apiKey ?? jevEnvValue("AIHUBMIX_API_KEY")
  const baseUrl = opts.baseUrl ?? process.env.JEV_TUNER_BASE_URL ?? "https://aihubmix.com/v1"
  const model = opts.model ?? process.env.AGENTIC_OS_TUNER_MODEL ?? "gpt-4o-mini"
  if (!apiKey) {
    throw new Error("AIHUBMIX_API_KEY not set (env or ~/.config/jev/env) — cannot seed cases")
  }
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You output only valid JSON arrays. No prose." },
        { role: "user", content: buildSeedPrompt(cfg, opts.n, examples) },
      ],
      temperature: 1,
    }),
  })
  if (!res.ok) throw new Error(`seed model ${model} answered ${res.status}`)
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = body.choices?.[0]?.message?.content ?? ""
  return parseSeedCases(content, cfg)
}

export function seedFilePath(id: string): string {
  return join("jev-tuner", "gates", id, "cases.jsonl")
}
