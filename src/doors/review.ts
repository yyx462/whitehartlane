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
import { parse as parseToml } from "smol-toml"
import { SHEP_ID_CLASS } from "./hooks.ts"

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
  /** the gate's lens roster (review-gate.ts); omit = all four lenses */
  roster?: string[]
  /**
   * a dropout-audit levy (gate-r2 momentum-15): the gate judged skip
   * but the dropout sample escalated to a full review — the docs-only
   * pre-flight skip does NOT apply (the audit exists to measure the
   * skipped class; a skipped audit can produce no verdict, no label,
   * no greens, and the rate pins at 1.0 forever).
   */
  auditLevy?: boolean
}

export type ReviewReady =
  | { ok: true; dir: string; skipped: false; headShort: string }
  | { ok: true; dir: null; skipped: true; why: string; files: number }
  | { ok: false; why: string; code: 1 | 2 }

export const DOCS_ONLY = /\.(md|markdown|txt|png|jpe?g|gif|svg|webp|pdf|licen[cs]e|gitignore)$/i
// directory matches are TOP-LEVEL docs/ ONLY (self-review r2 tests-1):
// assets/, images/, licence/ DIRECTORIES can hold code in real repos
// (assets/gen.ts) — the extensions above already cover real image and
// license FILES, so the directory whitelist stays minimal
export const DOCS_PATH = /^(docs?|doc)\//i

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
// The pin's landing — TEXT-PRESERVING, never a re-serialization
// (gate-r1 momentum-1/principles-14/questions-2: the parse→stringify
// landing rewrote the whole document — the template's inline
// `units = [ … ]` became [[stage.units]] tables, intake.sh's
// `^units = [` anchor matched nothing, and every model-pinned review
// derived ZERO lens order files on the normal path). The parser is
// the VERIFIER, not the writer: this function performs surgical line
// edits, and the caller re-parses the result to prove workflow.model
// landed. Arms, in order (gate-r2 principles-15/tests-2 — every form
// the consumer parses must land):
//   1. a [workflow] header block — interior spaces tolerated
//      ("[ workflow ]" is legal TOML)
//   2. dotted keys (workflow.model = "…" / workflow.* siblings)
//   3. a single-line inline table (workflow = { … }) — that ONE line
//      is reconstructed from the parse (scalars only); everything
//      else in the document survives verbatim
function pinIntoWorkflowTable(templateToml: string, model: string): string | undefined {
  const pin = `model = ${JSON.stringify(model)}`
  const lines = templateToml.split("\n")
  // 1) the [workflow] table header — tolerant: interior spaces and a
  // trailing comment (gate-r2 tests-41: "[ workflow ]" parses fine)
  const headerIdx = lines.findIndex((l) => /^\[\s*workflow\s*\]\s*(#.*)?$/.test(l.trim()))
  if (headerIdx !== -1) {
    let end = lines.length
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (/^\[/.test(lines[i].trim())) {
        end = i
        break
      }
    }
    for (let i = headerIdx + 1; i < end; i++) {
      if (/^[ \t]*model\s*=/.test(lines[i])) {
        lines[i] = pin
        return lines.join("\n")
      }
    }
    lines.splice(headerIdx + 1, 0, pin)
    return lines.join("\n")
  }
  // 2) dotted-key form (workflow.model = "…" at top level)
  const dotted = /^workflow\.model\s*=/
  for (let i = 0; i < lines.length; i++) {
    if (dotted.test(lines[i])) {
      lines[i] = pin.replace(/^model = /, "workflow.model = ")
      return lines.join("\n")
    }
  }
  const firstDotted = lines.findIndex((l) => /^workflow\./.test(l))
  if (firstDotted !== -1) {
    lines.splice(firstDotted, 0, pin.replace(/^model = /, "workflow.model = "))
    return lines.join("\n")
  }
  // 3) single-line inline table (workflow = { k = v, … }) — gate-r2
  // principles-15: smol-toml parses a complete workflow table from
  // these bytes; refusing was a false premise. The ONE line is rebuilt
  // from the parse (scalars only — nested values are not a form this
  // arm rewrites); the rest of the document is untouched.
  const inlineIdx = lines.findIndex((l) => /^[ \t]*workflow[ \t]*=[ \t]*\{.*\}[ \t]*(#.*)?$/.test(l))
  if (inlineIdx !== -1) {
    try {
      const parsed = parseToml(templateToml) as { workflow?: Record<string, unknown> }
      const wf = parsed.workflow
      if (!wf || typeof wf !== "object") return undefined
      const scalar = (v: unknown): string | undefined => {
        if (typeof v === "string") return JSON.stringify(v)
        if (typeof v === "number" || typeof v === "boolean") return String(v)
        return undefined // nested structures: not this arm's form
      }
      const entries: string[] = []
      let modelLanded = false
      for (const [k, v] of Object.entries(wf)) {
        const s = scalar(v)
        if (s === undefined) return undefined
        if (k === "model") {
          entries.push(`model = ${JSON.stringify(model)}`)
          modelLanded = true
        } else {
          entries.push(`${k} = ${s}`)
        }
      }
      if (!modelLanded) entries.push(`model = ${JSON.stringify(model)}`)
      lines[inlineIdx] = `workflow = { ${entries.join(", ")} }`
      return lines.join("\n")
    } catch {
      return undefined
    }
  }
  return undefined // no arm landed — the caller's refusal names the true premise
}

// The trunk's name is ONE decision (gate-r14 tests-1): the door
// auto-detects master/main/trunk, and the gate's bin default must
// answer the same — a hardcoded "master" left main-only repos (the
// git/GitHub default layout) gate-broken on every review, no ledger
// row ever written.
export function detectTrunk(repo: string): string | undefined {
  for (const d of ["master", "main", "trunk"]) {
    try {
      git(repo, "rev-parse", "--verify", d)
      return d
    } catch {
      /* try the next */
    }
  }
  return undefined
}

// The roster's surgical filter (review-gate.ts subset materialization):
// removes unit entries whose id is not in `keep`, from every
// `units = [ … ]` block. TWO array forms (gate-r5 tests-1/2): the
// multi-line block (entries on their own lines — line surgery) and the
// SINGLE-LINE inline array (all entries on the `units = [` line —
// rebuilt from the parse, scalars only; the briefs carry literal
// braces, so text-side brace matching is doomed). Returns null when no
// units block exists or a value cannot be re-serialized.
function stripUnitsToRoster(toml: string, keep: Set<string>): string | null {
  const lines = toml.split("\n")
  // spacing-tolerant (gate-r11 momentum-24): `units =[` and `units= [` are
  // legal TOML the door's text-preserving materialization stages verbatim
  const unitsLine = /^[ \t]*units[ \t]*=[ \t]*\[/
  // THE PARSE IS THE DECISION (gate-r17 — the same replacement the
  // grammar grind forced on intake): which entries exist and what they
  // carry comes from smol-toml ONCE; the text surgery only REPLACES
  // each units block with its parse-kept rebuild. The former text
  // arms (entry-id regexes, header counters, block-end scans, quote
  // and padding tolerances) each stayed one legal spelling behind the
  // grammar forever — the parse cannot. Stage-with-units blocks in
  // the parse, in order, answer to units blocks in the text, in
  // order (the zip the misindex class tests-901 pinned).
  let stagesWithUnits: Array<Array<Record<string, unknown>>> = []
  try {
    const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<Record<string, unknown>> }> }
    stagesWithUnits = (parsed.stage ?? [])
      .map((s) => (s.units ?? []).filter((u): u is Record<string, unknown> => !!u && typeof u === "object"))
      .filter((units) => units.length > 0)
  } catch {
    return null // the door's own parse verify refuses these bytes honestly
  }
  // the inline serializer is TOTAL over the parse's own value shapes
  // (gate-r15 tests-1): nested inline tables and arrays included
  const inline = (v: unknown): string | undefined => {
    if (typeof v === "string") return JSON.stringify(v)
    if (typeof v === "number" || typeof v === "boolean") return String(v)
    if (Array.isArray(v)) {
      const items = v.map(inline)
      return items.some((x) => x === undefined) ? undefined : `[${items.join(", ")}]`
    }
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => {
        const s = inline(x)
        return s === undefined ? null : `${k} = ${s}`
      })
      if (entries.some((e) => e === null)) return undefined
      return `{ ${entries.join(", ")} }`
    }
    return undefined
  }
  let saw = false
  let changed = false
  // the [[stage.units]] array-of-tables form (gate-r6 tests-102): drop
  // whole blocks whose id is not in the roster — the id read through
  // the SAME parse (quoted keys included, gate-r15 momentum-30), the
  // block located by its header (spacing-tolerant, gate-r15 tests-1)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\[\[\s*stage\.units\s*\]\]/.test(lines[i].trim())) continue
    saw = true
    let end = i + 1
    while (end < lines.length && !/^\[/.test(lines[end].trim())) end++
    const id = lines
      .slice(i, end)
      .map((l) => l.trim().match(new RegExp(`^["']?id["']?[ \t]*=[ \t]*["'](${SHEP_ID_CLASS})["']`))?.[1])
      .find(Boolean)
    if (id !== undefined && !keep.has(id)) {
      lines.splice(i, end - i)
      changed = true
      i--
    } else {
      i = end - 1
    }
  }
  // every `units = [` block — single-line and multi-line, ONE arm —
  // replaced by its parse-kept rebuild
  let zip = 0
  for (let i = 0; i < lines.length; i++) {
    if (!unitsLine.test(lines[i])) continue
    saw = true
    const stageUnits = stagesWithUnits[zip]
    zip += 1
    if (stageUnits === undefined) return null // text/parse disagreement — the verify refuses honestly
    // the kept entries from the parse, in order
    const kept: string[] = []
    for (const u of stageUnits) {
      if (typeof u.id !== "string" || !keep.has(u.id)) continue
      const entries = Object.entries(u).map(([k, v]) => {
        const s = inline(v)
        return s === undefined ? null : `${k} = ${s}`
      })
      if (entries.some((e) => e === null)) return null
      kept.push(`{ ${entries.join(", ")} }`)
    }
    const rebuilt = `units = [ ${kept.join(", ")} ]`
    const t = lines[i].trim()
    if (/\]\s*(#.*)?$/.test(t) && !t.endsWith("[")) {
      // single-line block: the closer rides the same line
      if (lines[i] !== rebuilt) {
        lines[i] = rebuilt
        changed = true
      }
      continue
    }
    // multi-line block: replace through its closer (which may carry a
    // trailing comment — gate-r15 tests-1)
    let end = i + 1
    while (end < lines.length && !/^\]/.test(lines[end].trim())) end++
    if (end >= lines.length) return null
    const blockWas = lines.slice(i, end + 1).join("\n")
    lines.splice(i, end + 1 - i, rebuilt)
    if (blockWas !== rebuilt) changed = true
  }
  if (!saw) return null
  return changed ? lines.join("\n") : toml
}

// "does this document pin temperature anywhere?" — a deep walk over
// the PARSED document (r23 tests-40: the word in a comment or a
// string value is not a pin; the KEY is). Named for reuse: the
// audit-strip's pre-verify walks the STRIPPED bytes with the same
// question (gate-r3) — one walker, both sites.
function hasTemperatureKey(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasTemperatureKey)
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).some(
      ([k, v]) => k === "temperature" || hasTemperatureKey(v),
    )
  }
  return false
}

// A model-less dropout audit's untuned materialization (gate-r2
// momentum-15): remove `temperature = <num>` keys — the pins are tuning
// that needs a model to ride; without one the lenses spawn on the host
// default, untuned (stated in the receipt). BOTH unit forms (gate-r10
// tests-1): the inline-array arm rewrites `{ id =` entry lines, and the
// [[stage.units]] arm drops temperature-key LINES inside unit blocks
// (the form gate-r6 blessed — the strip missing it dead-ended every
// audited escalation on table-form templates).
function stripTemperaturePins(toml: string): string {
  const lines = toml.split("\n")
  // arm 2: [[stage.units]] blocks — drop temperature-key lines.
  // Space-tolerant header (gate-r16 tests-1): `[[ stage.units ]]` is
  // legal TOML the door's parse, the roster strip's anchor, and
  // intake's awk arm all bless — an exact-match header here refused
  // the strip's own verify and dead-ended every audited escalation
  // on a spaced-header template with a false "door bug" premise.
  let inUnitBlock = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (/^\[\[\s*stage\.units\s*\]\]$/.test(t)) {
      inUnitBlock = true
      continue
    }
    if (/^\[/.test(t)) {
      inUnitBlock = false
      continue
    }
    if (inUnitBlock && /^[ \t]*temperature[ \t]*=[ \t]*[0-9]+(\.[0-9]+)?[ \t]*(#.*)?$/.test(lines[i])) {
      lines[i] = ""
    }
  }
  // arm 1: inline-array entry lines. ANY key order (gate-r12
  // principles-35): TOML legalizes temperature-first entries
  // ({ temperature = 0.2, id = "…" }) and the door's parse reads and
  // materializes them — the arm selects every line carrying a pin
  // INSIDE its braces, not only the ones that happen to start with id
  // (the id-first selector let the survivor trip the parse-verify and
  // dead-end the audited escalation one key order later).
  const inlinePin = /\{[^}]*\btemperature\s*=\s*[0-9]+(\.[0-9]+)?/
  return lines
    .map((l) =>
      inlinePin.test(l)
        ? l.replace(/,\s*temperature\s*=\s*[0-9]+(\.[0-9]+)?/g, "").replace(/temperature\s*=\s*[0-9]+(\.[0-9]+)?\s*,\s*/g, "")
        : l,
    )
    .join("\n")
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
    base = detectTrunk(repo)
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
    // an audit levy arriving at an EMPTY diff means the class flipped
    // under it (a force-push between the gate's read and the levy's) —
    // the levy still runs (the audit measures the judgment the gate
    // made on the diff it saw; an all-green verdict on nothing accrues
    // honestly) rather than dead-ending with a ledger row claiming
    // audit:true and nothing levied (gate-r8 tests-1's shape). The
    // plain spell skips with a receipt.
    if (args.auditLevy) {
      // fall through: the audit measures the class, even an emptied one
    } else {
      return { ok: true, dir: null, skipped: true, why: "empty diff", files: 0 }
    }
  }
  // The docs-only skip is a PRE-FLIGHT, not a chain stage: a declared
  // chain cannot shed its units mid-run (ADR 0014), so the skip has to
  // happen before anything is booked. Receipt, not silence. The
  // auditLevy fall-through is the RACE GUARD (gate-r13
  // momentum-26/principles-36), the same law the empty-diff arm above
  // states: the gate NEVER audits docs_only on its own judgment (a
  // file-list fact is mechanical — gate-r12 momentum-25), so an audited
  // levy arriving at a docs-only diff means the class FLIPPED under it
  // between the gate's read and this one (--gate-only makes the window
  // caller-controlled) — the ledger row is already written, and an
  // audit nobody runs measures nothing. One decision, one answer at
  // both arms of "the class flipped under it".
  if (!args.auditLevy && files.every((f) => DOCS_ONLY.test(f) || DOCS_PATH.test(f))) {
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
  // THE CONTENT PIPELINE (gate-r5: the pin-plan grew three captured
  // arms — pin, untuned, legacy staged strip — and the no-model strip
  // had no verify behind it, so a silent no-op inverted the gate's
  // roster decision with no refusal and no receipt). ONE string, an
  // ordered chain of TEXT transforms, each VERIFIED by the parser as
  // it lands, ONE write at materialization:
  //   roster strip (units ⊆ roster, verified — both model paths)
  //   → temperature strip (audit + no model; no temperature keys, verified)
  //   → model pin (workflow.model === --model, verified)
  // Every model question is answered by the consumer's own smol-toml
  // read (r20 principles-12); malformed TOML is a code-2 door refusal,
  // never an escaped stack (r20 tests-30).
  let workflowTomlOut: string | undefined
  {
    const templateToml = readFileSync(join(template, "workflow.toml"), "utf8")
    let toml = templateToml
    if (args.roster && args.roster.length < 4) {
      const stripped = stripUnitsToRoster(toml, new Set(args.roster))
      if (stripped === null) {
        return { ok: false, why: `template has no units block for roster subsetting`, code: 1 }
      }
      toml = stripped
    }
    let parsedTemplate: { workflow?: { model?: string }; stage?: Array<{ units?: Array<{ id?: string }> }> }
    try {
      parsedTemplate = parseToml(toml) as typeof parsedTemplate
    } catch (err) {
      return {
        ok: false,
        why: `the template's workflow.toml is not valid TOML (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — fix the template or pass --template pointing at a valid one`,
        code: 2,
      }
    }
    // the roster verify — UNCONDITIONAL now (gate-r5 tests-2: the
    // no-model strip no-op'd with no verify behind it, materializing
    // all four units while the gate decided two): the consumer's own
    // read must agree the subset landed. AND non-empty (gate-r7
    // principles-28): a roster naming ZERO of the template's units
    // dropped every lens and the strays-only check passed on zero
    // survivors — a zero-lens review with ok:true, the exact shape
    // the empty-roster guard refuses.
    if (args.roster && args.roster.length < 4) {
      const keep = new Set(args.roster)
      const ids = (parsedTemplate.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id))
      const stray = ids.filter((id) => id !== undefined && !keep.has(id))
      if (stray.length > 0) {
        return {
          ok: false,
          why: `roster subsetting failed post-verify — units outside the roster survived the strip: ${stray.join(", ")} (this is a door bug; report it)`,
          code: 2,
        }
      }
      const survivors = ids.filter((id) => id !== undefined)
      if (survivors.length === 0) {
        return {
          ok: false,
          why: `the roster names no unit in this template (roster [${args.roster.join(", ")}] ∩ template units = ∅) — a zero-lens review is the empty-roster shape the door refuses; this is gate/template drift (the gate read a different template than the door)`,
          code: 2,
        }
      }
    }
    const hasTempPin = hasTemperatureKey(parsedTemplate)
    const templateModel = parsedTemplate?.workflow?.model
    const hasModel = (typeof templateModel === "string" && /^[^/\s]+\/[^/\s]+$/.test(templateModel)) || typeof args.model === "string"
    if (hasTempPin && !hasModel) {
      if (args.auditLevy === true && args.model === undefined) {
        // a MODEL-LESS dropout audit (gate-r2 momentum-15): refusing
        // here dead-ends the audit. The pins are TUNING, not law:
        // strip them and the lenses spawn on the host default,
        // untuned — stated in the bin's receipt. VERIFIED here
        // (gate-r3): any surviving temperature key refuses rather
        // than ships a receipt that lies.
        const stripped = stripTemperaturePins(toml)
        let clean = false
        try {
          clean = !hasTemperatureKey(parseToml(stripped))
        } catch {
          clean = false
        }
        if (!clean) {
          return {
            ok: false,
            why: `the dropout audit's temperature strip could not strip every pin (the strip regex missed a form) — refusing rather than shipping pins the receipt claims were dropped (this is a door bug; report it)`,
            code: 2,
          }
        }
        toml = stripped
      } else {
        return {
          ok: false,
          why: `the template pins per-unit temperature but no model is declared — pass --model <provider/model> (the temperature pin rides the model's settings)`,
          code: 2,
        }
      }
    }
    if (typeof args.model === "string") {
      // r19 tests-1: the landing must be inside the [workflow] table
      // THE RUN-TIME READS. Text-preserving landing + a parse of the
      // result: the verification is the consumer's own read.
      const pinned = pinIntoWorkflowTable(toml, args.model)
      let parsed: { workflow?: { model?: string } } | undefined
      try {
        parsed = pinned !== undefined ? (parseToml(pinned) as { workflow?: { model?: string } }) : undefined
      } catch (err) {
        return {
          ok: false,
          why: `the model pin's landing does not parse as TOML (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — fix the template's [workflow] table or pass --template pointing at a valid one`,
          code: 2,
        }
      }
      if (parsed?.workflow?.model !== args.model) {
        return {
          ok: false,
          why: `the template's workflow.toml has no [workflow] table the door can pin text-preservingly (a [workflow] header block, dotted workflow.* keys, or a single-line inline table — re-serializing the whole document would mangle the units layout): rewrite the table in one of those forms, or pass --template pointing at one`,
          code: 2,
        }
      }
      toml = pinned
    }
    workflowTomlOut = toml !== templateToml ? toml : undefined
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
  // the gate's roster (review-gate.ts): a subset materializes ONLY
  // those lens units — one decision, made once at the door (ADR 0014:
  // a chain cannot shed units mid-run, so the roster is pre-flight).
  // The filter is line-surgical on the units block; an EMPTY roster
  // refuses (that is a skip, not a review with no lenses).
  if (args.roster && args.roster.length === 0) {
    return { ok: false, why: `empty roster — the gate decided skip; do not materialize (this is a door bug if you see it)`, code: 2 }
  }
  // the lens temperature pins need a model to ride (the host writes
  // provider.<p>.models.<id>.temperature): --model lands as the
  // workflow pin. The MISSING-model refusal lives at the door now
  // (pre-materialization, above) — this branch only writes the pin.
  // THE CONTENT PIPELINE's single write (gate-r5: three arms — pin,
  // untuned, legacy staged strip — became one verified chain; the
  // materialization writes whatever the chain changed, nothing else)
  if (workflowTomlOut !== undefined) {
    writeFileSync(join(dir, "workflow.toml"), workflowTomlOut)
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
  // THE ONE READER (gate-r17 — the design replacement the grammar grind
  // forced): "which lens units did this program materialize?" is
  // answered ONCE, by the door's own smol-toml parse of the FINAL
  // materialized bytes, and intake.sh reads THIS file. Four textual
  // shadow-readers (sed/grep/awk arms) each stayed one legal TOML
  // spelling behind the grammar forever — quotes, padding, key order,
  // quoted keys, trailing comments, spaced headers, braces in briefs —
  // one P1 per spelling per round. The parse is the reader; this file
  // is the handoff; intake no longer re-derives.
  {
    const finalToml = workflowTomlOut ?? templateToml
    let ids: string[] = []
    try {
      const parsedFinal = parseToml(finalToml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
      ids = (parsedFinal.stage ?? [])
        .flatMap((s) => (s.units ?? []).map((u) => u?.id))
        .filter((x): x is string => typeof x === "string")
    } catch {
      return { ok: false, why: `the final materialized workflow.toml does not parse — cannot hand off the lens roster (this is a door bug; report it)`, code: 2 }
    }
    writeFileSync(join(dir, "data", "review", "lenses.txt"), ids.length > 0 ? ids.join("\n") + "\n" : "")
  }
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
