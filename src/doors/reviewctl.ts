// reviewctl — the review rail's LEVER ("Build the Lever", the
// veteran's rule): one CLI that scripts seam-testing of the pr-review
// rail, so an agent runs `whl reviewctl hook prove.sh <dir>` instead
// of writing a throwaway node script to do the same (fewer tokens,
// reproducible, testable). Deep-module shape: few verbs, each hides
// the whole seam behind it.
//
// Laws this file keeps:
// - machine-readable by default where a caller composes (--json);
//   human lines only when the human is the consumer (default).
// - destructive verbs (cleanup) carry --dry-run and a signature
//   guard: the dir must LOOK like a staged program (workflow.toml)
//   before anything deletes it — a CLI that rms arbitrary paths is
//   a footgun wearing a uniform.
// - errors say what to DO next, never just what failed.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, resolve, basename } from "node:path"
import { prepareReview } from "./review.ts"
import { runGate, gateReceipt, LENSES } from "./review-gate.ts"
import type { Lens } from "./review-gate.ts"

export const REVIEWCTL_VERBS = ["doctor", "stage", "hook", "verdict", "lenses", "gate", "cleanup"] as const

export type ReviewctlArgs = {
  verb: string
  /** the positional target (dir or repo), if any */
  target?: string
  flags: Record<string, string | boolean>
}

const flag = (a: ReviewctlArgs, name: string): string | undefined => {
  const v = a.flags[name]
  return typeof v === "string" ? v : undefined
}
const has = (a: ReviewctlArgs, name: string): boolean => name in a.flags

const die = (code: number, msg: string, next: string): never => {
  process.stderr.write(`reviewctl: ${msg}\nreviewctl: ${next}\n`)
  process.exit(code)
}

const out = (a: ReviewctlArgs, pretty: string, json: unknown): void => {
  if (has(a, "json")) console.log(JSON.stringify(json, null, 2))
  else console.log(pretty)
}

const isStagedProgram = (dir: string): boolean => existsSync(join(dir, "workflow.toml")) && existsSync(join(dir, "hooks"))

const asDir = (a: ReviewctlArgs, what: string): string => {
  const t = a.target ?? flag(a, "dir")
  if (!t) die(2, `${what} needs a directory (positional or --dir)`, `whl reviewctl ${a.verb} <dir> — try doctor first to see what exists`)
  const dir = resolve(t)
  if (!existsSync(dir)) die(1, `${dir} does not exist`, "stage one first: whl reviewctl stage <repo> --base b --head h --out <dir>")
  return dir
}

const csvRoster = (raw: string | undefined): Lens[] | undefined => {
  if (!raw) return undefined
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean)
  const bad = ids.filter((id) => !(LENSES as readonly string[]).includes(id))
  if (bad.length > 0) die(2, `unknown lens id(s): ${bad.join(", ")}`, `legal ids: ${LENSES.join(", ")} (a retired/typo'd id must never silently shrink the rail)`)
  return ids as Lens[]
}

// doctor — health of a staged program dir: does every stage's hook
// exist, does the workflow read, is the door's handoff (lenses.txt)
// present, what state did the run reach.
function doctor(a: ReviewctlArgs): void {
  const dir = asDir(a, "doctor")
  const problems: string[] = []
  const workflow = join(dir, "workflow.toml")
  if (!existsSync(workflow)) problems.push("workflow.toml missing — not a staged review program; stage one first")
  let stages: Array<{ id?: string; topology?: string; run?: string; check?: string }> = []
  if (existsSync(workflow)) {
    try {
      // block-scoped reads, never index-paired flatten (a naive
      // matchAll pairing misassigns hooks across stages — doctor must
      // not become a second WRONG parser of the grammar). Only files
      // are judged: the door parse-verified at stage time and refuses
      // unparsable bytes.
      const blocks = readFileSync(workflow, "utf8").split(/^\[\[stage\]\]/m).slice(1)
      stages = blocks.map((b) => ({
        id: b.match(/^id = "(.+)"$/m)?.[1],
        topology: b.match(/^topology = "(.+)"$/m)?.[1],
        run: b.match(/^run = "(.+)"$/m)?.[1],
        check: b.match(/^check = "(.+)"$/m)?.[1],
      }))
      for (const s of stages) {
        for (const hookRef of [s.run, s.check]) {
          if (!hookRef) continue
          const m = hookRef.match(/^bash hooks\/([\w.-]+)$/)
          if (!m) continue
          if (!existsSync(join(dir, "hooks", m[1]))) {
            // hooks run as `bash hooks/<f>` — the exec bit is not a
            // dependency; a missing file is
            problems.push(`stage ${s.id}: ${hookRef} — hook file missing`)
          }
        }
      }
    } catch (e) {
      problems.push(`workflow.toml unreadable: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const lensesTxt = join(dir, "data", "review", "lenses.txt")
  const lenses = existsSync(lensesTxt) ? readFileSync(lensesTxt, "utf8").trim().split("\n").filter(Boolean) : null
  if (!lenses) problems.push("data/review/lenses.txt missing — the door's handoff; stage again (do not hand-write it)")
  const verdictPath = join(dir, "data", "review", "verdict.json")
  const verdict = existsSync(verdictPath)
  let verdictState: string | undefined
  if (verdict) {
    try {
      verdictState = (JSON.parse(readFileSync(verdictPath, "utf8")) as { verdict?: string }).verdict
    } catch {
      problems.push("verdict.json present but unparsable — the prove gate wrote garbage; report this")
    }
  }
  const feedback = existsSync(join(dir, "feedback")) ? readdirSync(join(dir, "feedback")).sort() : []
  out(a,
    [
      `program: ${dir}`,
      `stages: ${stages.map((s) => `${s.id}(${s.topology ?? "?"})`).join(" → ") || "—"}`,
      `lenses: ${lenses?.join(", ") ?? "—"}`,
      `verdict: ${verdictState ?? "not yet (prove has not run)"}`,
      `feedback: ${feedback.length ? feedback.join(", ") : "none"}`,
      ...(problems.length ? problems.map((p) => `PROBLEM: ${p}`) : ["healthy"]),
    ].join("\n"),
    { dir, stages: stages.map((s) => s.id), lenses, verdict: verdictState ?? null, feedback, problems, ok: problems.length === 0 })
  process.exit(problems.length === 0 ? 0 : 1)
}

// stage — materialize a review program WITHOUT booking a job: the
// seam-test harness's first move (then drive hooks by hand).
function stage(a: ReviewctlArgs): void {
  const repo = a.target ?? flag(a, "repo")
  if (!repo) die(2, "stage needs a repo", "whl reviewctl stage <repo> --base <ref> --head <ref> --out <dir>")
  const base = flag(a, "base")
  const head = flag(a, "head")
  if (!base || !head) die(2, "stage needs --base and --head refs", "example: --base master --head feat")
  const outDir = flag(a, "out")
  if (!outDir) die(2, "stage needs --out (the staged dir)", "pick a throwaway path — cleanup removes it later")
  const ready = prepareReview({
    repo,
    base,
    head,
    out: outDir,
    template: flag(a, "template"),
    title: flag(a, "title"),
    roster: csvRoster(flag(a, "roster")),
  }, join(import.meta.dirname, "..", "..", "templates"))
  if (!ready.ok) die(ready.code === 2 ? 2 : 1, ready.why, "fix the inputs and re-stage; doctor an existing dir with: whl reviewctl doctor <dir>")
  if (ready.skipped) {
    out(a, `skipped: ${ready.why} (${ready.files} files)`, { skipped: true, why: ready.why, files: ready.files, dir: null })
    return
  }
  const lenses = readFileSync(join(ready.dir, "data", "review", "lenses.txt"), "utf8").trim().split("\n")
  out(a,
    [
      `staged: ${ready.dir}`,
      `lenses: ${lenses.join(", ")}`,
      `next: whl reviewctl hook intake.sh ${ready.dir}`,
    ].join("\n"),
    { skipped: false, dir: ready.dir, headShort: ready.headShort, lenses })
}

// hook — run ONE staged hook by name (bash hooks/<name>) with the
// program dir as cwd, exactly the way the orchestrator would.
function hook(a: ReviewctlArgs): void {
  const name = a.target ?? flag(a, "name")
  if (!name) die(2, "hook needs a hook name", `legal names live in <dir>/hooks/ — ls it, or run doctor`)
  if (name.includes("/") || name.includes("..")) die(2, `hook name ${name} is not a plain file name`, "hooks run from <dir>/hooks/ — name only, no paths")
  const dirFlag = flag(a, "dir")
  if (!dirFlag) die(2, "hook needs --dir (the staged program)", "whl reviewctl hook <name> --dir <dir>")
  const dir = resolve(dirFlag)
  if (!isStagedProgram(dir)) die(1, `${dir} is not a staged review program (workflow.toml + hooks/ expected)`, "stage one: whl reviewctl stage <repo> --base b --head h --out <dir>")
  const hookPath = join(dir, "hooks", name)
  if (!existsSync(hookPath)) die(1, `${name} not in ${dir}/hooks/`, `available: ${readdirSync(join(dir, "hooks")).join(", ")}`)
  const r = spawnSync("bash", [hookPath], { cwd: dir, stdio: "inherit", env: { ...process.env, PROG: dir } })
  process.exit(r.status ?? 1)
}

// verdict — read a staged (or job-run) verdict.json without jq
// gymnastics: the counts, the blocked table, the adopt handover.
function verdict(a: ReviewctlArgs): void {
  const dir = asDir(a, "verdict")
  const p = join(dir, "data", "review", "verdict.json")
  if (!existsSync(p)) die(1, `no verdict.json at ${p}`, "the prove gate writes it — run: whl reviewctl hook prove.sh --dir " + JSON.stringify(dir))
  let v: { verdict?: string; blocked?: unknown[]; advisory?: unknown[]; adopt?: unknown[] }
  try {
    v = JSON.parse(readFileSync(p, "utf8"))
  } catch (e) {
    die(1, `verdict.json unparsable: ${e instanceof Error ? e.message : String(e)}`, "the prove gate wrote it — re-run prove to overwrite")
  }
  const blocked = (v.blocked ?? []) as Array<{ id?: string; severity?: string; outcome?: string; claim?: string }>
  const advisory = (v.advisory ?? []) as Array<{ id?: string }>
  const adopt = (v.adopt ?? []) as Array<{ id?: string }>
  out(a,
    [
      `verdict: ${v.verdict ?? "?"} — blocked ${blocked.length}, advisory ${advisory.length}, adopt ${adopt.length}`,
      ...blocked.map((b) => `  ${b.id ?? "?"} [${b.severity ?? "?"}] ${b.outcome ?? "?"} — ${b.claim ?? ""}`),
      ...(adopt.length ? [`adopt: ${adopt.map((x) => x.id).join(", ")}`] : []),
    ].join("\n"),
    { dir, verdict: v.verdict, blockedCount: blocked.length, advisoryCount: advisory.length, adoptCount: adopt.length, blocked, advisory, adopt })
  process.exit(v.verdict === "accept" ? 0 : 1)
}

// lenses — the one-reader law, checked: lenses.txt (the door's
// handoff) must equal the workflow's own stage units.
function lenses(a: ReviewctlArgs): void {
  const dir = asDir(a, "lenses")
  const p = join(dir, "data", "review", "lenses.txt")
  if (!existsSync(p)) die(1, `no lenses.txt at ${p}`, "the door writes it at stage time — re-stage the program")
  const handoff = readFileSync(p, "utf8").trim().split("\n").filter(Boolean)
  const text = readFileSync(join(dir, "workflow.toml"), "utf8")
  const units = [...text.matchAll(/^\s+\{ id = "([\w.-]+)"/gm)].map((m) => m[1])
  const agree = JSON.stringify([...handoff].sort()) === JSON.stringify([...units].sort())
  out(a, `lenses: ${handoff.join(", ")}${agree ? "" : `\nDISAGREEMENT: workflow units are ${units.join(", ")} — the handoff and the template must speak with one voice; re-stage`}`,
    { handoff, units, agree })
  process.exit(agree ? 0 : 1)
}

// gate — the decision, isolated: what would the gate do with this
// base..head? (Writes a ledger row — the gate's own law: every
// evaluation is recorded; there is no dry-run draw.)
function gate(a: ReviewctlArgs): void {
  const repo = a.target ?? flag(a, "repo")
  if (!repo) die(2, "gate needs a repo", "whl reviewctl gate <repo> --base <ref> --head <ref>")
  const base = flag(a, "base")
  const head = flag(a, "head")
  if (!base || !head) die(2, "gate needs --base and --head refs", "example: --base master --head feat")
  try {
    const { features, decision } = runGate(repo, base, head, {
      roster: csvRoster(flag(a, "roster")),
      jev: has(a, "no-jev") ? false : undefined,
    })
    out(a, gateReceipt(features, decision), { decision, klass: features.klass, files: features.files.length, churn: features.churn })
  } catch (e) {
    die(1, `gate failed: ${e instanceof Error ? e.message : String(e)}`, "check the refs exist and the repo is clean enough to diff")
  }
}

// cleanup — remove a staged program dir. Signature-guarded (it must
// look staged) and --dry-run capable: deletion is the one verb that
// cannot be un-run.
function cleanup(a: ReviewctlArgs): void {
  const dir = asDir(a, "cleanup")
  if (!isStagedProgram(dir)) die(1, `${dir} does not look like a staged review program (workflow.toml + hooks/ expected)`, "refusing to delete anything else — remove it by hand if you are sure")
  const entries = readdirSync(dir)
  if (has(a, "dry-run")) {
    out(a, `would remove ${dir} (${entries.length} entries: ${entries.slice(0, 5).join(", ")}${entries.length > 5 ? ", …" : ""})`, { dir, wouldRemove: true, entries })
    return
  }
  rmSync(dir, { recursive: true, force: true })
  out(a, `removed ${dir}`, { dir, removed: true })
}

export function reviewctl(a: ReviewctlArgs): void {
  switch (a.verb) {
    case "doctor": return doctor(a)
    case "stage": return stage(a)
    case "hook": return hook(a)
    case "verdict": return verdict(a)
    case "lenses": return lenses(a)
    case "gate": return gate(a)
    case "cleanup": return cleanup(a)
    default:
      die(2, `unknown verb ${JSON.stringify(a.verb)}`, `legal verbs: ${REVIEWCTL_VERBS.join(", ")} — or --help for the manual`)
  }
}

export const REVIEWCTL_HELP = `whitehartlane reviewctl — the review rail's lever (seam-testing CLI)

  reviewctl <verb> [args] [--json]

verbs
  reviewctl doctor <dir>            health of a staged program: stages,
                                    hooks present, lenses handoff,
                                    verdict state
  stage <repo> --base b --head h --out <dir> [--roster p,t,m] [--template d]
                               materialize a review program WITHOUT booking
                               a job — then drive its hooks by hand
  hook <name> --dir <dir>      run one hook (bash hooks/<name>) exactly the
                               way the orchestrator would; exits with the
                               hook's own code
  verdict <dir>                read data/review/verdict.json: counts,
                               blocked table, adopt handover (exit 0 =
                               accept, 1 = reject)
  lenses <dir>                 the lens roster AND its one-reader check
                               (lenses.txt must equal the workflow's units)
  gate <repo> --base b --head h [--roster p,t,m] [--no-jev]
                               the gate decision in isolation (writes a
                               ledger row — every evaluation is recorded)
  cleanup <dir> [--dry-run]    remove a staged program dir; refuses dirs
                               that do not look staged; --dry-run prints
                               what would go

laws
  --json on every verb: machine-readable output for composing agents
  destructive verbs are signature-guarded and dry-run capable
  errors name the next command, not just the failure`
