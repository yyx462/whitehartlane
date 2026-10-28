// src/doors/review.ts — the `whl review` verb: close the PR→merge gap
// with the adversarial pre-merge rail (templates/pr-review).
//
// One command materializes the review program for a concrete
// BASE..HEAD of a repo and (with --from/--unattended) levies it:
//
//   whl review <repo> --base main --head feat --from opencode:ses_…
//     → job: …  trace: …   (the lenses run; the wake carries the verdict)
//
// The pre-flight (BEFORE any job exists — a chain cannot shed units
// mid-run, so the docs-only skip lives here, at the door):
//   - resolve base/head to SHAs, refuse moved/rebased inputs
//   - docs-only diff → print the skip receipt, exit 0, no job
// The materializer: copy the template, write review/config.sh (the
// hooks' single config, generated — shell-sourceable), copy the repo's
// own INVARIANTS.md / QUESTIONS.md when they exist (the template's are
// the seed), copy the authoring run's trace (for the divide stage)
// when --trace-dir is given. Then the door's own admission screens
// judge the program (prepareRun in check mode — grammar, deliverables).
import { execFileSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"

export type ReviewArgs = {
  repo: string
  base?: string
  head?: string
  title?: string
  author?: string
  mergeCmd?: string
  traceDir?: string
  bodyFile?: string
  out?: string
  template?: string
  model?: string
}

export type ReviewReady =
  | { ok: true; dir: string; skipped: false; headShort: string }
  | { ok: true; dir: null; skipped: true; why: string; files: number }
  | { ok: false; why: string; code: 1 | 2 }

const DOCS_ONLY = /\.(md|markdown|txt|png|jpe?g|gif|svg|webp|pdf|licen[cs]e|gitignore)$/i
// directory matches are TOP-LEVEL docs/ ONLY (self-review r2 tests-1):
// assets/, images/, licence/ DIRECTORIES can hold code in real repos
// (assets/gen.ts) — the extensions above already cover real image and
// license FILES, so the directory whitelist stays minimal
const DOCS_PATH = /^(docs?|doc)\//i

// no shell, ever (self-review r5 tests-1: raw --base/--head used to
// ride execSync strings — a substitution in a branch name would
// execute on the levy host). Args go to git as an argv array.
const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()

const shellQuote = (s: string): string => `'${String(s).replace(/'/g, `'\\''`)}'`

// The pin's landing (r19 tests-1): INSIDE the [workflow] table the
// run-time reads — never the first `model =` line in any other table.
// Text-preserving: the header line and its whitespace survive; the
// first existing `model =` in the table's span is replaced, else the
// pin is inserted right under the header. Returns undefined when the
// template has no [workflow] table at all.
// The pin's landing (r19 tests-1, r21 questions-4): INSIDE the
// [workflow] table the run-time reads — whatever form declares it
// (a literal header, dotted keys, an inline table). Parse → mutate →
// re-serialize: every parseable form lands; comments in a third-party
// template are the documented trade. Undefined only when the consumer
// reads no [workflow] table at all.
function pinIntoWorkflowTable(templateToml: string, model: string): string | undefined {
  try {
    const parsed = parseToml(templateToml) as { workflow?: { model?: string } }
    if (!parsed.workflow || typeof parsed.workflow !== "object") return undefined
    parsed.workflow.model = model
    return stringifyToml(parsed)
  } catch (err) {
    return undefined // unparseable: the caller's own parse-guard refuses
  }
}

export function prepareReview(args: ReviewArgs, templateRoot: string): ReviewReady {
  const repo = resolve(args.repo)
  if (!existsSync(join(repo, ".git"))) {
    return { ok: false, why: `${repo} is not a git repository`, code: 1 }
  }
  const template = args.template ?? join(templateRoot, "pr-review")
  if (!existsSync(join(template, "workflow.toml"))) {
    return { ok: false, why: `no review template at ${template}`, code: 1 }
  }
  // the manual's hard rule, enforced where the manual promised (the
  // #251 review's momentum-2: a bare id sailed through to die four
  // lenses late at provider resolution — the claim was false). Exactly
  // one slash, no whitespace: provider/model.
  let headBranch: string
  try {
    headBranch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
  } catch {
    return { ok: false, why: `cannot read HEAD of ${repo}`, code: 1 }
  }
  const head = args.head ?? headBranch
  let base = args.base
  if (!base) {
    for (const d of ["master", "main", "trunk"]) {
      try {
        git(repo, "rev-parse", "--verify", d)
        base = d
        break
      } catch { /* try the next */ }
    }
    if (!base) return { ok: false, why: "no --base given and no master/main/trunk branch found", code: 2 }
  }
  let headSha: string, baseSha: string, files: string[]
  try {
    headSha = git(repo, "rev-parse", `${head}^{commit}`)
    baseSha = git(repo, "rev-parse", `${base}^{commit}`)
  } catch (err) {
    return { ok: false, why: `cannot resolve ${base}..${head}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`, code: 1 }
  }
  if (headSha === baseSha) {
    return { ok: false, why: `head ${head} and base ${base} are the same commit (${headSha.slice(0, 8)})`, code: 2 }
  }
  // direction of review (self-review r2 momentum-2): a two-dot diff on
  // a head that is BEHIND base shows the base's commits as reversals —
  // the review would judge the wrong direction. Base must be an
  // ancestor of head; a stale branch rebases first.
  try {
    execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", baseSha, headSha], { stdio: ["ignore", "ignore", "ignore"] })
  } catch {
    return { ok: false, why: `head ${head} is not ahead of base ${base} — merge or rebase base into head first (the review judges exactly base..head)`, code: 2 }
  }
  files = git(repo, "diff", "--name-only", baseSha, headSha).split("\n").filter(Boolean)
  if (files.length === 0) {
    return { ok: true, dir: null, skipped: true, why: "empty diff", files: 0 }
  }
  // The docs-only skip is a PRE-FLIGHT, not a chain stage: a declared
  // chain cannot shed its units mid-run (ADR 0014), so the skip has to
  // happen before anything is booked. Receipt, not silence.
  if (files.every((f) => DOCS_ONLY.test(f) || DOCS_PATH.test(f))) {
    return { ok: true, dir: null, skipped: true, why: "docs-only diff", files: files.length }
  }
  // ONE truthiness rule for a declared model (r10: four lenses caught
  // `--model ""` slipping between two rules). The shape is the REPO'S
  // CANONICAL provider/model grammar — /^[^/\s]+\/[^/\s]+$/ — the same
  // decision hooks.ts (×2), coworker.ts and jev/model-ladder.ts already
  // make (r14 momentum-7/principles-6: a stricter outlier refused
  // ollama/qwen3:32b, colon-bearing ids the repo accepts and spawns —
  // one decision answered two opposite ways). Seated AFTER the skips
  // (r12 tests-5): a docs-only diff never spawns, never pins.
  if (args.model !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(args.model)) {
    return {
      ok: false,
      why: `--model must be provider/model (exactly one /, no whitespace): ${args.model} — bare ids are refused here, at the door, not four lenses late at provider resolution`,
      code: 2,
    }
  }
  // the missing-model twin, BEFORE materialization but AFTER the skips
  // (the #251 review's principles-2: it used to fire after mkdir+cpSync,
  // leaving a half-built dir the replace-guard then refused to replace —
  // the recovery the message itself prescribed was dead-ended). A
  // docs-only diff never needs a model: nothing spawns, nothing pins.
  //
  // THE pin-plan (r17 principles-10/tests-1: one computation, one
  // anchor; r19 tests-1: verified by the parser; r20 principles-12/
  // tests-30/tests-31: EVERY model question is answered by the
  // consumer's own smol-toml read — hasModel, the landing, and the
  // verify — never by a table-blind regex; malformed TOML is a code-2
  // door refusal, never an escaped stack).
  let pinnedWorkflowToml: string | undefined
  {
    const templateToml = readFileSync(join(template, "workflow.toml"), "utf8")
    let parsedTemplate: { workflow?: { model?: string } }
    try {
      parsedTemplate = parseToml(templateToml) as { workflow?: { model?: string } }
    } catch (err) {
      return {
        ok: false,
        why: `the template's workflow.toml is not valid TOML (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — fix the template or pass --template pointing at a valid one`,
        code: 2,
      }
    }
    // the temp-pin question, answered by the consumer's own read too
    // (r23 tests-40: the table-blind regex matched "temperature" in
    // comments and string values, refusing legal model-less
    // materializations) — a deep walk over the PARSED document: a
    // temperature KEY anywhere (workflow table, stage tables, unit
    // entries) pins; the word in a comment or a value does not.
    const hasTempPin = (function walk(node: unknown): boolean {
      if (Array.isArray(node)) return node.some(walk)
      if (node && typeof node === "object") {
        return Object.entries(node as Record<string, unknown>).some(
          ([k, v]) => k === "temperature" || walk(v),
        )
      }
      return false
    })(parsedTemplate)
    // "a model to ride" = declared in the template OR supplied via
    // --model — the consumer's read for the former, the argv for the
    // latter (r20 principles-12 kept the parser; this disjunct is the
    // supplied half — dropping it refused every --model call)
    // "a model to ride" = a grammar-legal model DECLARED in the template
    // (the run path's own grammar — an illegal template model like ""
    // or a bare id is NOT a declared model: the temp-pin refusal fires
    // and the operator's --model wins — r21 tests-1) OR supplied via
    // --model (the argv half; r20 principles-12 kept the parser read
    // for the template half)
    const templateModel = parsedTemplate?.workflow?.model
    const hasModel = (typeof templateModel === "string" && /^[^/\s]+\/[^/\s]+$/.test(templateModel)) || typeof args.model === "string"
    if (hasTempPin && !hasModel) {
      return {
        ok: false,
        why: `the template pins per-unit temperature but no model is declared — pass --model <provider/model> (the temperature pin rides the model's settings)`,
        code: 2,
      }
    }
    if (typeof args.model === "string") {
      // r19 tests-1: the landing must be inside the [workflow] table
      // THE RUN-TIME READS — a `model =` line in any other table sailed
      // the old regex verify while loadManifest read workflow.model =
      // undefined. Text-preserving landing + a parse of the result:
      // the verification is the consumer's own read.
      pinnedWorkflowToml = pinIntoWorkflowTable(templateToml, args.model)
      let parsed: { workflow?: { model?: string } } | undefined
      try {
        parsed = pinnedWorkflowToml !== undefined
          ? parseToml(pinnedWorkflowToml) as { workflow?: { model?: string } }
          : undefined
      } catch (err) {
        // r20 tests-30: the pin's landing can produce bytes the run-
        // time cannot parse (e.g. a duplicated model key the template's
        // own indentation hid) — a door refusal naming the template,
        // never an escaped TomlError
        return {
          ok: false,
          why: `the model pin's landing does not parse as TOML (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — fix the template's [workflow] table or pass --template pointing at a valid one`,
          code: 2,
        }
      }
      if (parsed?.workflow?.model !== args.model) {
        return {
          ok: false,
          why: `the template's workflow.toml has no [workflow] table — the model pin has nowhere to land (add a [workflow] table to the template, or pass --template pointing at one)`,
          code: 2,
        }
      }
    }
  }

  const headShort = headSha.slice(0, 8)
  const slug = `${basename(repo)}-${head === headBranch && headBranch !== "HEAD" ? headBranch.replace(/[^a-zA-Z0-9-]/g, "-") : headShort}`
  const dir = args.out ? resolve(args.out) : join(repo, ".whl-review", slug)
  // an unguarded rmSync on a caller-supplied path is a footgun (the
  // self-review r4's momentum-1): a typo'd --out must refuse, never
  // recursively delete whatever was there. Replacing OUR OWN
  // materialized program (re-runs) stays allowed.
  if (existsSync(dir)) {
    const ours = existsSync(join(dir, "workflow.toml")) && existsSync(join(dir, "data", "review"))
    if (!ours) {
      return { ok: false, why: `--out ${dir} exists and is not a materialized review program — refusing to replace it (pass an empty dir, or the program dir from an earlier review)`, code: 2 }
    }
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
  cpSync(template, dir, { recursive: true })
  // the lens temperature pins need a model to ride (the host writes
  // provider.<p>.models.<id>.temperature): --model lands as the
  // workflow pin. The MISSING-model refusal lives at the door now
  // (pre-materialization, above) — this branch only writes the pin.
  // the pin-plan was computed and verified PRE-materialization — the
  // materialization writes exactly those bytes (r17 principles-10/
  // tests-1: one computation, one anchor)
  if (pinnedWorkflowToml !== undefined) {
    writeFileSync(join(dir, "workflow.toml"), pinnedWorkflowToml)
  }

  const title = args.title ?? `${head} → ${base}`
  const lines = [
    "# generated by `whl review` — the review program's single config (sourced by every hook)",
    `REPO=${shellQuote(repo)}`,
    `BASE_BRANCH=${shellQuote(base)}`,
    `BASE_SHA=${shellQuote(baseSha)}`,
    `HEAD_BRANCH=${shellQuote(head)}`,
    `HEAD_SHA=${shellQuote(headSha)}`,
    `TITLE=${shellQuote(title)}`,
    `AUTHOR=${shellQuote(args.author ?? "")}`,
    `MERGE_CMD=${shellQuote(args.mergeCmd ?? "")}`,
  ]
  // data/ is the DOOR-STAGED carrier (src/doors/run.ts copyBeside): a
  // program's run dir is a staged copy, and everything hooks+briefs
  // read must travel inside it — the review's inputs are data/, by
  // the door's own law, not by a new one.
  mkdirSync(join(dir, "data", "review"), { recursive: true })
  writeFileSync(join(dir, "data", "review", "config.sh"), lines.join("\n") + "\n")
  // refuse, never vanish (the self-review's tests-4): a --body-file
  // that does not exist is a typo'd path, and silently ignoring it
  // reviews a PR missing the claims the caller thought it carried
  if (args.bodyFile && !existsSync(args.bodyFile)) {
    return { ok: false, why: `--body-file ${args.bodyFile} does not exist`, code: 2 }
  }
  if (args.bodyFile) {
    copyFileSync(args.bodyFile, join(dir, "data", "review", "pr-body.md"))
  }
  // the reviewer's law + schema also ride data/ — staging carries
  // hooks/ + data/ only, and every brief references data/REVIEWER.md
  // (the c2 divider caught their absence the honest way)
  for (const doc of ["REVIEWER.md", "SCHEMA.md"]) {
    copyFileSync(join(template, doc), join(dir, "data", doc))
  }
  // the repo's own checklists are the live ones; the template's are seeds
  for (const [repoFile, seed, dest] of [
    ["INVARIANTS.md", "INVARIANTS.template.md", "INVARIANTS.md"],
    ["QUESTIONS.md", "QUESTIONS.template.md", "QUESTIONS.md"],
  ] as const) {
    if (existsSync(join(repo, repoFile))) copyFileSync(join(repo, repoFile), join(dir, "data", dest))
    else copyFileSync(join(template, seed), join(dir, "data", dest))
  }
  // the authoring run's trace: the divide stage's evidence set. Without
  // it, rejection feedback falls back to one author file.
  if (args.traceDir) {
    if (!existsSync(args.traceDir)) return { ok: false, why: `--trace-dir ${args.traceDir} does not exist`, code: 2 }
    cpSync(args.traceDir, join(dir, "data", "trace"), { recursive: true })
  }
  return { ok: true, dir, skipped: false, headShort }
}

// The receipt the door prints after materializing (before any levy) —
// also the unit-test surface: pure given a ReviewReady.
export function reviewReceipt(r: ReviewReady): string {
  if (r.ok && r.skipped) return `review: skip — ${r.why} (${r.files} file${r.files === 1 ? "" : "s"}; nothing levied)`
  if (!r.ok) return `review: ${r.why}`
  return [
    `review: program materialized at ${r.dir}`,
    `review: levy it with: whl run ${r.dir} --from <tool>:<session-id>`,
    `review: the staged run dir carries the verdict (data/review/verdict.json); feedback/ lands beside it on reject`,
  ].join("\n")
}
