// src/doors/review-gate.ts — the review GATE: one cheap decision in
// front of the rail (the mandatory hook's brain; gwt calls this, not
// the rail).
//
// Division of labor (the design law — never violate it):
//   the script supplies FACTS    diff class, churn, hot files (prior
//                               proven findings per file), the class's
//                               audit history from the ledger
//   jev supplies the JUDGMENT    four calibrated noul — one per lens,
//                               ONE `jev run` request (parallel, cheap)
//   the script ENFORCES          roster, dropout roll, ledger row
// jev never enforces; the script never judges.
//
// Fail-safe: jev unreachable/unparsable → every lens runs —
// uncertainty ALWAYS defaults to reviewing. The gate can only loosen
// as greens accumulate; a red in a skipped class re-tightens it.
//
// Dropout (the unbiased-sample law): every skip is audited with
// class-conditioned probability — a fresh class audits every skip,
// greens decay the rate, a red resets it. The skip region is never
// unmeasured; that is the whole point of the dropout.
//
// Labels are DERIVED, never written back: a ledger row's label is the
// verdict.json for its headSha, read from its own home (append-only
// decisions; labels are facts where they live).
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { homeRoot, sessionsRoot } from "../adapters/store.ts"
import { DOCS_ONLY, DOCS_PATH } from "./review.ts"
import { parse as parseToml } from "smol-toml"

export const LENSES = ["principles", "tests", "momentum", "questions"] as const
export type Lens = (typeof LENSES)[number]

export type GateClass = "docs_only" | "test_only" | "code_small" | "code_large"

export type GateFeatures = {
  repo: string
  base: string
  head: string
  baseSha: string
  headSha: string
  files: string[]
  churn: number
  klass: GateClass
  hotFiles: { file: string; findings: number }[]
}

export type GateDecision = {
  action: "skip" | "review"
  roster: Lens[]
  ps: Partial<Record<Lens, number>> | null
  klass: GateClass
  audit: boolean
  auditRate: number
  greens: number
  reds: number
  why: string
}

// no shell, ever — the review door's own law rides here too
const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()

const TEST_PATH = /(^|\/)(tests?|spec|__tests__)\//i
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i
const CODE_SMALL_CHURN = 150

// the ledger lives under THE store's own root (gate-r2 tests-1: the
// hard-wired ~/.local/share/agentic-os path ignored homeRoot()'s
// ownership — on the ADR 0011 whitehartlane default disk or any
// AGENTIC_OS_HOME root the parent did not exist, appendLedgerRow threw
// ENOENT, and the bin demoted the whole gate to "broken — fail-safe:
// full rail" on EVERY review: the gate silently never engaged there)
export const ledgerPath = (): string =>
  process.env.WHL_GATE_LEDGER ?? join(homeRoot(), "review-gate.jsonl")

export function classify(files: string[], churn: number): GateClass {
  if (files.every((f) => DOCS_ONLY.test(f) || DOCS_PATH.test(f))) return "docs_only"
  if (files.every((f) => TEST_PATH.test(f) || TEST_FILE.test(f))) return "test_only"
  return churn <= CODE_SMALL_CHURN ? "code_small" : "code_large"
}

// hot files: prior PROVEN findings per file, from every verdict on
// this machine — the one receipt-backed feature (hooks.ts produced
// findings in 5 different rounds; a repeat offender deserves review
// whatever the diff size). Basename-keyed: reviews of forks/worktrees
// speak of the same file.
function hotFileCounts(files: string[]): { file: string; findings: number }[] {
  const want = new Map(files.map((f) => [f.replace(/.*\//, ""), 0]))
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  for (const sid of readdirSync(root)) {
    const jdir = join(root, sid, "jobs")
    if (!existsSync(jdir)) continue
    for (const jid of readdirSync(jdir)) {
      const v = join(jdir, jid, "run", "data", "review", "verdict.json")
      if (!existsSync(v)) continue
      try {
        const verdict = JSON.parse(readFileSync(v, "utf8"))
        for (const b of verdict.blocked ?? []) {
          const f = String(b.location?.file ?? "").replace(/.*\//, "")
          if (want.has(f)) want.set(f, (want.get(f) ?? 0) + 1)
        }
      } catch {
        /* unreadable verdict: not our fact to guess */
      }
    }
  }
  return [...want.entries()].filter(([, n]) => n > 0).map(([file, findings]) => ({ file, findings }))
}

export function gateFeatures(repo: string, base: string, head: string): GateFeatures {
  const baseSha = git(repo, "rev-parse", `${base}^{commit}`)
  const headSha = git(repo, "rev-parse", `${head}^{commit}`)
  const files = git(repo, "diff", "--name-only", baseSha, headSha).split("\n").filter(Boolean)
  const churn = git(repo, "diff", "--numstat", baseSha, headSha)
    .split("\n")
    .filter(Boolean)
    .reduce((n, line) => n + line.split("\t").slice(0, 2).reduce((a, x) => a + (x === "-" ? 0 : Number(x)), 0), 0)
  return { repo, base, head, baseSha, headSha, files, churn, klass: classify(files, churn), hotFiles: hotFileCounts(files) }
}

// ---- the ledger: append-only decisions; labels derived at read time

type LedgerRow = {
  ts: string
  repo: string
  head: string
  headSha: string
  klass: GateClass
  files: number
  churn: number
  hot: { file: string; findings: number }[]
  ps: Partial<Record<Lens, number>> | null
  roster: Lens[]
  action: "skip" | "review" | "override"
  audit: boolean
  // the band that made the decision (absent on rows older than the
  // band table — they were all medium by definition)
  strictness?: Strictness
}

export function appendLedgerRow(row: Omit<LedgerRow, "ts">, path = ledgerPath()): void {
  // the parent is created at write time (gate-r2 tests-1): a first
  // decision on a fresh machine must mint the ledger, not ENOENT
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n")
}

function verdictRedsByHeadSha(): Map<string, { red: boolean }> {
  // one verdict per headSha: the NEWEST verdict.json wins (gate-r7
  // tests-1: "last one wins" was readdirSync enumeration order —
  // name-sorted job dirs — so a re-run head's stale RED beat the newer
  // GREEN and the dropout rate pinned at 1.0 on the manual's own
  // re-levy loop). Recency = the verdict file's mtime.
  const m = new Map<string, { red: boolean; at: number }>()
  const root = sessionsRoot()
  if (!existsSync(root)) return new Map<string, { red: boolean }>()
  for (const sid of readdirSync(root)) {
    const jdir = join(root, sid, "jobs")
    if (!existsSync(jdir)) continue
    for (const jid of readdirSync(jdir)) {
      const v = join(jdir, jid, "run", "data", "review", "verdict.json")
      if (!existsSync(v)) continue
      try {
        const verdict = JSON.parse(readFileSync(v, "utf8"))
        const head = String(verdict.head ?? "")
        let at = 0
        try {
          at = statSync(v).mtimeMs
        } catch {
          /* unstatable falls back to losing collisions */
        }
        const prev = m.get(head)
        if (!prev || at >= prev.at) m.set(head, { red: (verdict.blocked ?? []).length > 0, at })
      } catch {
        /* skip unreadable */
      }
    }
  }
  return new Map([...m].map(([k, v]) => [k, { red: v.red }]))
}

export type ClassStats = { greens: number; reds: number; audits: number; rate: number }

// the dropout rate: fresh class → audit every skip; greens decay it;
// any red resets it to every-skip (drift alarm). A RESET is
// re-decayable (gate-r13 tests-701): the decay counts greens SINCE the
// last red — `reds > 0` pinned every class that ever caught a real
// bug at 1.0 forever, dead-coding the documented "can only loosen as
// greens accumulate". Pure.
export function classStats(
  rows: LedgerRow[],
  labels: Map<string, { red: boolean }>,
  klass: GateClass,
  band: GateBand = BANDS.medium,
): ClassStats {
  let greens = 0
  let reds = 0
  let audits = 0
  let sinceRed = 0 // greens accumulated since the last red
  for (const r of rows) {
    if (r.klass !== klass || r.action !== "skip") continue
    // only ESCALATED skips are audits (gate-r25 tests-9601): the row's
    // own `audit` flag is the one fact that says a measured full-rail
    // verdict exists (or will) for this skip — a plain skip (jev said
    // skip, the roll said stand down) has no rail and no verdict; it
    // is not a measurement, and counting it inflated
    // class_audit_history.audits on every decayed class (rate 0.25
    // leaves 3 of 4 skips unescalated — the inflation was unbounded),
    // corrupting the fact fed to the gate's one judgment.
    if (r.audit) audits += 1
    const label = labels.get(r.headSha)
    if (!label) continue
    if (label.red) {
      reds += 1
      sinceRed = 0 // the drift alarm re-tightens — and the class can re-earn trust after it
    } else {
      greens += 1
      sinceRed += 1
    }
  }
  const rate = band.audit(sinceRed)
  return { greens, reds, audits, rate }
}

function readLedger(path = ledgerPath()): LedgerRow[] {
  if (!existsSync(path)) return []
  // one torn line must not take the whole gate down (gate-r13
  // tests-700): the ledger is appendFileSync'd mid-crash surface — a
  // SIGKILL between open and flush leaves a partial line, and the
  // reader is the gate's front door (runGate throws → the bin's catch
  // demotes the gate PERMANENTLY). The module's other machine-state
  // readers (verdictRedsByHeadSha, hotFileCounts) guard per item; this
  // reader joins them: skip the unreadable line, decide anyway.
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as LedgerRow
      } catch {
        return null
      }
    })
    .filter((r): r is LedgerRow => r !== null)
}

// ---- jev: the judgment (four noul, one request)

const JEV_TIMEOUT_MS = 30_000

export function jevLenses(
  f: GateFeatures,
  stats: ClassStats,
  opts: { bin?: string; state?: string } = {},
): Partial<Record<Lens, number>> | null {
  const bin = opts.bin ?? process.env.WHL_JEV_BIN ?? "jev"
  const state =
    opts.state ??
    JSON.stringify({
      repo: basename(f.repo),
      diff_class: f.klass,
      file_count: f.files.length,
      files: f.files.slice(0, 50),
      churn: f.churn,
      hot_files: f.hotFiles,
      class_audit_history: { greens: stats.greens, reds: stats.reds, audits: stats.audits },
    })
  const questions: Record<string, { type: string; instructions: string }> = {}
  for (const lens of LENSES) {
    questions[`l_${lens}`] = {
      type: "noul",
      instructions: `Does this diff need the ${lens} review lens to run before merge? Answer from the diff's class, size, files, and audit history.`,
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), "whl-gate-"))
  const q = join(tmp, "q.json")
  const s = join(tmp, "s.json")
  try {
    writeFileSync(q, JSON.stringify(questions))
    writeFileSync(s, state)
    const out = execFileSync(bin, ["run", "-q", q, "-f", s, "--json", "--quiet"], {
      encoding: "utf8",
      timeout: JEV_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const answers = JSON.parse(out)?.answers
    const ps: Partial<Record<Lens, number>> = {}
    for (const lens of LENSES) {
      const n = answers?.[`l_${lens}`]?.noul
      // unparsable → fail-safe. The DOMAIN is enforced here too
      // (gate-r13 tests-702): a finite noul outside [0,1] is the same
      // broken-judge garbage one shape later — trusted raw it can
      // silently turn the rail OFF (noul:-1 ×4 → empty roster → plain
      // skip), the exact vanish-not-review direction the fail-safe
      // law forbids. The script ENFORCES; validating the judgment's
      // domain is enforcement, not judgment.
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) return null
      ps[lens] = n
    }
    return ps
  } catch {
    return null // jev down / timeout / absent → fail-safe, never vanish
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ---- the decision

// strictness — the per-project bar, selected by review-gate.toml at
// the repo root (absent/unparsable → medium, never vanish). The two
// design laws ride UNCHANGED through every band: jev judges, the
// script enforces (a band selects NUMBERS, never outcomes), and the
// fail-safe direction is absolute (jev down → full rail; a red in a
// skipped class re-tightens the ladder to every-skip — loose is legal
// BECAUSE the dropout stays measured).
export type Strictness = "strict" | "medium" | "loose"

export type GateBand = {
  // a lens runs unless jev's p(needed) falls BELOW keepP — the higher
  // the bar, the more sure jev must be that a lens is pointless
  keepP: number
  // the dropout ladder over greens-since-last-red
  audit: (sinceRed: number) => number
  // prior PROVEN findings on diff files outrank the judgment
  hotFileForce: boolean
}

export const BANDS: Record<Strictness, GateBand> = {
  // strict: the flagship posture — jev must be 85% sure a lens is
  // pointless to drop it, the ladder loosens half as far and twice as
  // slow, and a repeat-offender file forces the full rail (a fact
  // beats a probability)
  strict: { keepP: 0.15, audit: (g) => (g < 4 ? 1.0 : g < 10 ? 0.5 : 0.25), hotFileForce: true },
  // medium: today's exact numbers (the old LENS_KEEP_THRESHOLD 0.35
  // and the 3/8 ladder) — the default every repo gets until it opts in
  medium: { keepP: 0.35, audit: (g) => (g < 3 ? 1.0 : g < 8 ? 0.25 : 0.1), hotFileForce: false },
  // loose: trust the greens — jev keeps a lens at a mere 0.40 doubt,
  // the ladder decays at 2/5 to a 0.05 floor. Cheaper reviews, same
  // safety net: any red re-tightens to 1.0 and stays re-decayable
  loose: { keepP: 0.6, audit: (g) => (g < 2 ? 1.0 : g < 5 ? 0.1 : 0.05), hotFileForce: false },
}

// the per-project ship contract, versioned with the code it gates:
//   auto = true            levy the review after every gwt submit-pr
//   model = "provider/m"  the levy's model pin (auto = true requires it)
//   strictness = "medium" the band above
export type ShipConfig = { auto: boolean; model?: string; strictness: Strictness }

export function shipConfigOf(repo: string, opts: { head?: string; base?: string } = {}): ShipConfig {
  // the band comes from the TRUSTED SIDE — the BASE commit (momentum-910):
  // the gate diffs base..head out of git, so a band read from the
  // checkout means one diff is gated differently per checkout, and a PR
  // can ADD the file that lowers the bar gating it. The base's contract
  // governs the review of the diff against it.
  const local = (() => {
    const p = join(repo, "review-gate.toml")
    if (!existsSync(p)) return { auto: false, model: undefined as string | undefined }
    try {
      const t = parseToml(readFileSync(p, "utf8")) as { auto?: unknown; model?: unknown }
      return { auto: t.auto === true, model: typeof t.model === "string" ? t.model : undefined }
    } catch {
      return { auto: false, model: undefined as string | undefined }
    }
  })()
  const commit = opts.base ?? opts.head
  if (commit) {
    // the TRUSTED side's contract, and NOTHING else: a commit that
    // carries no contract means the DEFAULT band — never a fallback to
    // the working tree (that fallback is the checkout-dependence the
    // finding named: the PR's own "loose" file lowering the bar that
    // reviews it)
    let raw: string
    try {
      raw = execFileSync("git", ["-C", repo, "show", `${commit}:review-gate.toml`], { encoding: "utf8" })
    } catch {
      // the base declares no contract → the DEFAULT band (never a
      // fallback to the working tree: that fallback is the
      // checkout-dependence the finding named)
      return { auto: local.auto, model: local.model, strictness: "medium" }
    }
    const t = parseToml(raw) as { strictness?: unknown }
    const strictness: Strictness = t.strictness === "strict" || t.strictness === "loose" ? t.strictness : "medium"
    return { auto: local.auto, model: local.model, strictness }
  }
  return { auto: local.auto, model: local.model, strictness: "medium" }
}

function parseShipConfig(raw: string): ShipConfig {
  try {
    const t = parseToml(raw) as { auto?: unknown; model?: unknown; strictness?: unknown }
    const strictness = t.strictness === "strict" || t.strictness === "loose" ? t.strictness : "medium"
    return { auto: t.auto === true, model: typeof t.model === "string" ? t.model : undefined, strictness }
  } catch {
    // an unparsable contract is not a reason to skip anything
    return { auto: false, strictness: "medium" }
  }
}

export function decideGate(
  f: GateFeatures,
  ps: Partial<Record<Lens, number>> | null,
  stats: ClassStats,
  roll = Math.random(),
  band: GateBand = BANDS.medium,
): GateDecision {
  if (f.klass === "docs_only") {
    // the one mechanical rule, kept by construction: the blocking
    // class (code twins) cannot live in a docs-only diff. And it is
    // MECHANICAL — a file-list fact, not a judgment — so the dropout
    // audit never samples it (gate-r12 momentum-25): the audit
    // exists to sample the JUDGE's skips ("jev said skip; the sample
    // says run"), and on a fresh class rate 1.0 made every docs-only
    // skip levy a full 4-lens rail — falsifying the manual's own
    // hard rule ("docs-only diffs skip at the door, receipt printed,
    // exit 0") deterministically on every first contact. action
    // records the JUDGMENT ("skip"); audit the ESCALATION — gate-r1
    // momentum-2: audited skips recorded action:"review", so
    // classStats never counted them, greens never accrued, and the
    // rate could never decay below 1.0 — the gate could NEVER loosen,
    // dead code where the manual promises "loosens as greens
    // accumulate". The ledger now tells the truth; the levy (bin)
    // reads action + audit.
    return { action: "skip", roster: [], ps: null, klass: f.klass, audit: false, auditRate: stats.rate, greens: stats.greens, reds: stats.reds, why: "docs-only diff — no code to prove wrong, no judgment to audit" }
  }
  // strict band's fact-beats-probability rule: a file with prior
  // PROVEN findings reviews in full whatever jev thinks of the diff
  if (band.hotFileForce && f.hotFiles.length > 0) {
    return { action: "review", roster: [...LENSES], ps, klass: f.klass, audit: false, auditRate: stats.rate, greens: stats.greens, reds: stats.reds, why: `strict band: hot file(s) ${f.hotFiles.map((h) => h.file).join(", ")} — ${f.hotFiles.reduce((n, h) => n + h.findings, 0)} prior proven findings outrank the judgment` }
  }
  if (ps === null) {
    return { action: "review", roster: [...LENSES], ps: null, klass: f.klass, audit: false, auditRate: stats.rate, greens: stats.greens, reds: stats.reds, why: "jev unavailable — fail-safe full rail" }
  }
  // a MISSING probability is never a reason to drop a lens (fail-safe)
  const roster = LENSES.filter((l) => (ps[l] ?? 1) >= band.keepP)
  if (roster.length === 0) {
    // same law as docs_only: the JUDGMENT is skip; the audit escalates
    const audit = roll < stats.rate
    return audit
      ? { action: "skip", roster: [...LENSES], ps, klass: f.klass, audit: true, auditRate: stats.rate, greens: stats.greens, reds: stats.reds, why: "dropout audit — jev said skip, the sample says run" }
      : { action: "skip", roster: [], ps, klass: f.klass, audit: false, auditRate: stats.rate, greens: stats.greens, reds: stats.reds, why: "jev: no lens clears the bar" }
  }
  return { action: "review", roster, ps, klass: f.klass, audit: false, auditRate: stats.rate, greens: stats.greens, reds: stats.reds, why: `jev roster (${roster.join(",")})` }
}

// one gate evaluation: features → stats → jev → decision → ledger row.
// The band comes from the repo's own review-gate.toml unless the
// caller pins one — the per-project contract selects the numbers.
export function runGate(
  repo: string,
  base: string,
  head: string,
  opts: { jev?: boolean; strictness?: Strictness } = {},
): { features: GateFeatures; decision: GateDecision } {
  const features = gateFeatures(repo, base, head)
  // the band comes from the BASE COMMIT (momentum-910) — a PR must not
  // be able to add the file that lowers the bar gating it (the resolved
  // merge base, not the moving ref)
  const strictness = opts.strictness ?? shipConfigOf(repo, { base: features.baseSha }).strictness
  const band = BANDS[strictness]
  const stats = classStats(readLedger(), verdictRedsByHeadSha(), features.klass, band)
  const ps = opts.jev === false || features.klass === "docs_only" ? null : jevLenses(features, stats)
  const decision = decideGate(features, ps, stats, Math.random(), band)
  appendLedgerRow({
    repo: features.repo,
    head: features.head,
    headSha: features.headSha,
    klass: features.klass,
    files: features.files.length,
    churn: features.churn,
    hot: features.hotFiles,
    ps: decision.ps,
    roster: decision.roster,
    action: decision.action,
    audit: decision.audit,
    strictness,
  })
  return { features, decision }
}

export function gateReceipt(f: GateFeatures, d: GateDecision): string {
  const ps = d.ps ? ` ps ${LENSES.map((l) => `${l[0]}=${(d.ps?.[l] ?? -1).toFixed(2)}`).join(" ")}` : ""
  const head = `gate: ${d.action} — class ${f.klass} (${f.files.length} files, ${f.churn} churn${f.hotFiles.length ? `, hot: ${f.hotFiles.map((h) => `${h.file}×${h.findings}`).join(",")}` : ""})${ps}`
  const tail = d.action === "skip" && !d.audit
    ? ` · audit p=${d.auditRate} (greens ${d.greens}/reds ${d.reds}) · ledger row written`
    : d.audit
      ? ` · DROPOUT AUDIT (p=${d.auditRate}) — the skip region stays measured`
      : ` · roster: ${d.roster.join(", ")}`
  return head + tail + `\ngate: ${d.why}`
}
