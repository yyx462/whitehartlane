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
  // THE PARSE VERIFIES THE LANDING (gate-r20 tests-5003): every seat
  // is located by TEXT, and text matches inside string values too — a
  // `[workflow]` line quoted in a documentation string matched first,
  // the pin landed INSIDE the string, the verify parse read no
  // workflow.model, and the door refused a template the consumer reads
  // perfectly. String content never becomes parse data (tests-9101's
  // law, applied to the pin arm): a landing COUNTS only when the
  // whole-document parse says workflow.model === the pin. Each arm
  // tries every candidate; the first the parse blesses wins; a form
  // whose candidates all fail falls through to the next arm.
  const landsPinned = (text: string): boolean => {
    try {
      const p = parseToml(text) as { workflow?: { model?: unknown } }
      return p.workflow?.model === model
    } catch {
      return false // a landing that does not parse is not a landing
    }
  }
  // 1) the [workflow] table header — tolerant: interior spaces, a
  // trailing comment (gate-r2 tests-41: "[ workflow ]" parses fine),
  // and a QUOTED table key (gate-r18 tests-3001: ["workflow"] is
  // legal TOML smol-toml parses into the same workflow table)
  const headerRe = /^\[\s*["']?workflow["']?\s*\]\s*(#.*)?$/
  for (let headerIdx = 0; headerIdx < lines.length; headerIdx++) {
    if (!headerRe.test(lines[headerIdx].trim())) continue
    const cand = lines.slice()
    let end = cand.length
    for (let i = headerIdx + 1; i < cand.length; i++) {
      if (/^\[/.test(cand[i].trim())) {
        end = i
        break
      }
    }
    let landed: string | undefined
    for (let i = headerIdx + 1; i < end; i++) {
      if (/^[ \t]*model\s*=/.test(cand[i])) {
        cand[i] = pin
        landed = cand.join("\n")
        break
      }
    }
    if (landed === undefined) {
      cand.splice(headerIdx + 1, 0, pin)
      landed = cand.join("\n")
    }
    if (landsPinned(landed)) return landed
  }
  // 2) dotted-key form (workflow.model = "…" at top level)
  for (let i = 0; i < lines.length; i++) {
    if (!/^workflow\.model\s*=/.test(lines[i])) continue
    const cand = lines.slice()
    cand[i] = pin.replace(/^model = /, "workflow.model = ")
    const landed = cand.join("\n")
    if (landsPinned(landed)) return landed
  }
  for (let firstDotted = 0; firstDotted < lines.length; firstDotted++) {
    if (!/^workflow\./.test(lines[firstDotted])) continue
    const cand = lines.slice()
    cand.splice(firstDotted, 0, pin.replace(/^model = /, "workflow.model = "))
    const landed = cand.join("\n")
    if (landsPinned(landed)) return landed
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
      // the SHARED TOTAL serializer (gate-r21 tests-9502): this arm's
      // own scalar-only twin refused — false premise — a single-line
      // inline workflow table carrying a nested value the run-time's
      // own parse reads fine; the roster strip's serializer was TOTAL
      // over the same shapes one function over. One serializer.
      const entries: string[] = []
      let modelLanded = false
      for (const [k, v] of Object.entries(wf)) {
        const s = inlineTomlValue(v)
        if (s === undefined) return undefined
        if (k === "model") {
          entries.push(`model = ${JSON.stringify(model)}`)
          modelLanded = true
        } else {
          entries.push(`${k} = ${s}`)
        }
      }
      if (!modelLanded) entries.push(`model = ${JSON.stringify(model)}`)
      const cand = lines.slice()
      cand[inlineIdx] = `workflow = { ${entries.join(", ")} }`
      const landed = cand.join("\n")
      return landsPinned(landed) ? landed : undefined
    } catch {
      return undefined
    }
  }
  return undefined // no arm landed a candidate the parse verifies — the caller's refusal names the true premise
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
// THE TOTAL inline serializer (gate-r15 tests-1: nested tables and
// arrays), SHARED by every arm that rewrites inline TOML (gate-r21
// tests-9502: the model pin's inline-table arm carried its own
// scalar-only twin that bailed on any nested value — refusing, with a
// false premise, a single-line inline workflow table the run-time's
// own parse reads fine — while this serializer one function over was
// explicitly TOTAL over the same shapes. One serializer, every seat.)
function inlineTomlValue(v: unknown): string | undefined {
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    const items = v.map(inlineTomlValue)
    return items.some((x) => x === undefined) ? undefined : `[${items.join(", ")}]`
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => {
      const s = inlineTomlValue(x)
      return s === undefined ? null : `${k} = ${s}`
    })
    if (entries.some((e) => e === null)) return undefined
    return `{ ${entries.join(", ")} }`
  }
  return undefined
}

// The shared parse-driven units-block rewriter (gate-r17): THE PARSE// IS THE DECISION — which entries exist and what they carry comes
// from smol-toml ONCE, and each `units = [` block in the text is
// REPLACED by its parse-kept rebuild. The former text arms (entry-id
// regexes, header counters, block-end scans, quote and padding
// tolerances) each stayed one legal spelling behind the TOML grammar
// forever — the parse cannot. Stages-with-units in the parse, in
// order, answer to units blocks in the text, in order (the zip the
// misindex class tests-901 pinned). `edit` answers per unit: the
// (possibly modified) object to keep, or null to drop the entry.
// Returns null when the document does not parse (the caller's verify
// refuses honestly). The inline serializer is TOTAL over the parse's
// own value shapes (gate-r15 tests-1: nested tables and arrays).
// the whole-document stage-entry ids for an array key — the
// CONTAINMENT ORACLE both strip arms share (gate-r19 tests-9101's
// law: string content never becomes parse data; a "block" whose
// entries do not exist in the document's parse is a quoted example
// inside a string value). Throws on unparseable bytes — the callers
// refuse honestly.
function documentStageIds(toml: string, key: string, identity: "id" | "name"): Set<string> {
  const whole = parseToml(toml) as { stage?: unknown }
  const stages = Array.isArray(whole.stage) ? whole.stage : whole.stage !== undefined ? [whole.stage] : []
  return new Set(
    (stages as Array<Record<string, unknown>>)
      .flatMap((s) => {
        const entries = s?.[key]
        return Array.isArray(entries) ? entries : []
      })
      .map((u) => (u && typeof u === "object" && typeof (u as Record<string, unknown>)[identity] === "string" ? ((u as Record<string, string>)[identity]) : null))
      .filter((x): x is string => x !== null),
  )
}

function rebuildInlineArray(
  toml: string,
  key: string,
  identity: "id" | "name",
  edit: (u: Record<string, unknown>) => Record<string, unknown> | null,
): { text: string; saw: boolean; changed: boolean } | null {
  const lines = toml.split("\n")
  // block DETECTOR: spacing-tolerant (gate-r11 momentum-24) and
  // quoted-key-tolerant — `["units"] = [` is legal TOML. One rewriter
  // for both stage arrays (units — gate-r17; members — gate-r25
  // principles-60): same grammar, same oracles.
  const arrayLine = new RegExp(`^[ \t]*["']?${key}["']?[ \t]*=[ \t]*\\[`)
  let saw = false
  let changed = false
  // STRING-EMBEDDED FALSE POSITIVES (gate-r19 tests-9101): a
  // `units = [` line inside a multi-line brief string matches the
  // textual detector, and its slice can even PARSE standalone when the
  // quoted example carries its own closing bracket — the oracle would
  // rewrite a lens's quoted law. The discriminator: string content
  // never becomes parse data. A REAL block's entry ids all exist in the
  // WHOLE-document parse's stage arrays; a quoted example's ids do not.
  // (Residual, stated: a brief quoting the program's OWN unit ids
  // verbatim passes containment and its example is rewritten — the
  // pathological self-documentating template.)
  let documentIds: Set<string>
  try {
    documentIds = documentStageIds(toml, key, identity)
  } catch {
    return null // the whole document does not parse — the verify refuses honestly
  }
  for (let i = 0; i < lines.length; i++) {
    if (!arrayLine.test(lines[i])) continue
    // THE PARSE IS THE EXTENT ORACLE (gate-r18 tests-3002/3003,
    // momentum-33): the block ends at the SMALLEST line-prefix from
    // here that parses as TOML. No closer scan (a ']'-initial line
    // inside a multi-line basic string cut the splice mid-string and
    // manufactured invalid TOML); no cross-stage zip (an
    // array-of-tables stage ahead of an inline stage misaligned the
    // document's stage order and rebuilt the WRONG stage's units,
    // silently inverting the roster). Each block carries ITS OWN
    // parse; the document's stage order never enters. An arrayLine
    // match with NO parseable extent (e.g. the bytes sit inside a
    // multi-line string elsewhere) refuses honestly here.
    let end = -1
    let blockEntries: Array<Record<string, unknown>> | null = null
    for (let e = i; e < lines.length && e < i + 500; e++) {
      try {
        const p = parseToml(lines.slice(i, e + 1).join("\n")) as Record<string, unknown>
        if (Array.isArray(p[key])) {
          blockEntries = p[key] as Array<Record<string, unknown>>
          end = e
          break
        }
      } catch {
        /* extend the span until the parse closes the array */
      }
    }
    if (end === -1) {
      // In a document the WHOLE-parse already accepted (top of this
      // function), a real inline block's prefix closes somewhere
      // parseable — inline arrays are self-contained. No parseable
      // extent therefore means a quoted example whose own bracket
      // never closes inside the string (gate-r19 tests-9101-2): skip
      // the false positive, never dead-end the strip on it.
      continue
    }
    const entries = blockEntries.filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
    // the containment discriminator above: a "block" whose parsed ids
    // do not exist in the document's stage arrays is a quoted example
    // inside a string value — not the strip's to edit. Skip it WITHOUT
    // counting it as a seen block (a template whose only inline-looking
    // line is a quoted example is served by its real entries, wherever
    // they are declared — never refused as "no units block")
    const blockIds = entries.map((u) => (typeof u[identity] === "string" ? (u[identity] as string) : null)).filter((x): x is string => x !== null)
    if (blockIds.length > 0 && !blockIds.every((id) => documentIds.has(id))) {
      continue
    }
    saw = true
    const kept: string[] = []
    for (const u of entries) {
      const next = edit(u)
      if (next === null) continue
      const serialized = Object.entries(next).map(([k, v]) => {
        const s = inlineTomlValue(v)
        return s === undefined ? null : `${k} = ${s}`
      })
      if (serialized.some((e) => e === null)) return null
      kept.push(`{ ${serialized.join(", ")} }`)
    }
    const rebuilt = `${key} = [ ${kept.join(", ")} ]`
    const blockWas = lines.slice(i, end + 1).join("\n")
    lines.splice(i, end + 1 - i, rebuilt)
    if (blockWas !== rebuilt) changed = true
  }
  return { text: changed ? lines.join("\n") : toml, saw, changed }
}

// "is this line a [[stage.units]] unit-block header?" — ONE seat
// (gate-r24 principles-51): the roster strip's anchor and the
// temperature strip's block detector used to be two grammars that
// disagreed on legal TOML (quoted key segments — [[stage."units"]] —
// and trailing comments — [[stage.units]] # lenses — matched one and
// not the other), so a model-less dropout audit of such a template
// dead-ended at its own verify ("the strip regex missed a form … this
// is a door bug") while the roster strip read the same line fine.
// Spacing-tolerant (gate-r16 tests-1), quoted-key-tolerant,
// comment-tolerant — the parser's grammar, one spelling. The same
// grammar answers the members twin ([[stage.members]]) — one builder.
function stageArrayHeaderRe(key: string): RegExp {
  return new RegExp(`^\\[\\[\\s*stage\\s*\\.\\s*["']?${key}["']?\\s*\\]\\]\\s*(#.*)?$`)
}
function isStageUnitsHeader(line: string): boolean {
  return stageArrayHeaderRe("units").test(line.trim())
}
function isStageMembersHeader(line: string): boolean {
  return stageArrayHeaderRe("members").test(line.trim())
}

function stripUnitsToRoster(toml: string, keep: Set<string>): string | null {
  const lines = toml.split("\n")
  let sawTable = false
  let tableChanged = false
  // the [[stage.units]] array-of-tables form (gate-r6 tests-102): drop
  // whole blocks whose id is not in the roster. THE PARSE IS THE
  // EXTENT ORACLE FOR THE TABLE FORM TOO (gate-r23 principles-43):
  // the old text scan — a quote-blind header anchor plus "first
  // trimmed line starting with [" as the end — never matched the
  // legal [[stage."units"]] header, and cut a multi-line brief
  // carrying a bracketed example line mid-string, then refused "no
  // units block" for a template the door's own parse reads: a false
  // premise that killed the gate's subset review entirely. The header
  // is located by isStageUnitsHeader (ONE seat, shared with the
  // temperature strip — gate-r24 principles-51); the EXTENT is the
  // FIRST candidate boundary whose slice parses standalone to exactly
  // one unit entry (a candidate that cuts a multi-line string fails
  // the parse and falls through); and containment against the
  // whole-document parse decides which "headers" are quoted examples
  // — tests-9101's law, both arms.
  let documentUnitIds: Set<string>
  try {
    documentUnitIds = documentStageIds(toml, "units", "id")
  } catch {
    return null // the whole document does not parse — the verify refuses honestly
  }
  for (let i = 0; i < lines.length; i++) {
    if (!isStageUnitsHeader(lines[i])) continue
    // candidate boundaries: every later trimmed line opening a table
    // header, or EOF. The first whose slice [i..e) parses standalone
    // with exactly ONE unit entry is the block's extent.
    let end = -1
    let id: string | null = null
    for (let e = i + 1; e <= lines.length; e++) {
      if (e < lines.length && !/^\[/.test(lines[e].trim())) continue
      const slice = lines.slice(i, e).join("\n")
      try {
        const p = parseToml(slice) as { stage?: unknown }
        const stages = Array.isArray(p.stage) ? p.stage : p.stage !== undefined ? [p.stage] : []
        const ids = (stages as Array<{ units?: unknown }>)
          .flatMap((s) => (Array.isArray(s.units) ? s.units : []))
          .map((u) => (u && typeof u === "object" && typeof (u as { id?: unknown }).id === "string" ? (u as { id: string }).id : null))
          .filter((x): x is string => x !== null)
        if (ids.length === 1) {
          end = e
          id = ids[0]
          break
        }
      } catch {
        /* the candidate cuts the block mid-string — try the next */
      }
    }
    if (end === -1) continue // no parseable single-unit extent — not this arm's to touch
    // containment (tests-9101's law): a "header" whose block's id does
    // not exist in the document's parse is a quoted example inside a
    // string value — skip it, un-counted
    if (id === null || !documentUnitIds.has(id)) {
      i = end - 1
      continue
    }
    sawTable = true
    if (!keep.has(id)) {
      lines.splice(i, end - i)
      tableChanged = true
      i--
    } else {
      i = end - 1
    }
  }
  // every `units = [` block — single-line and multi-line, ONE arm —
  // replaced by its parse-kept rebuild
  const res = rebuildInlineArray(lines.join("\n"), "units", "id", (u) =>
    typeof u.id === "string" && keep.has(u.id) ? u : null,
  )
  if (res === null) return null
  if (!res.saw && !sawTable) return null
  return res.changed || tableChanged ? res.text : toml
}

// "does this document pin temperature anywhere?" — a deep walk over a
// PARSED subtree (r23 tests-40: the word in a comment or a string
// value is not a pin; the KEY is).
function hasTemperatureKey(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasTemperatureKey)
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).some(
      ([k, v]) => k === "temperature" || hasTemperatureKey(v),
    )
  }
  return false
}

// THE SCREEN ANSWERS ITS CONSUMERS' QUESTION (gate-r22 tests-6101,
// widened gate-r25 principles-60): "does this program pin a
// temperature the RUN-TIME will enforce?" — every spawn seat: stage
// units AND coworker members (member temperature rides
// rail.inhabitPane into the shared host birth, which refuses any
// temperature spawn with no model). The r22 narrowing to units
// dropped the members seat BASE's textual screen covered, and a
// member-pinned model-less template died at member birth on infra
// the door was moved to catch. Tables no consumer reads
// (loadManifest ignores them) stay out of scope — the tests-6101
// false-refusal law. One question, every enforced seat, both sites
// (the screen and the strip's post-strip verify).
function pinsSpawnTemperature(parsed: unknown): boolean {
  const stage = (parsed as { stage?: unknown })?.stage
  const stages = Array.isArray(stage) ? stage : []
  return stages.some((s) => {
    if (s == null || typeof s !== "object") return false
    const stageObj = s as { units?: unknown; members?: unknown }
    return hasTemperatureKey(stageObj.units ?? null) || hasTemperatureKey(stageObj.members ?? null)
  })
}

// A model-less dropout audit's untuned materialization (gate-r2
// momentum-15): remove `temperature = <num>` keys — the pins are tuning
// that needs a model to ride; without one the lenses spawn on the host
// default, untuned (stated in the receipt). BOTH unit forms (gate-r10
// tests-1): the inline-array arm rewrites `{ id =` entry lines, and the
// [[stage.units]] arm drops temperature-key LINES inside unit blocks
// (the form gate-r6 blessed — the strip missing it dead-ended every
// audited escalation on table-form templates).
// a temperature-pin LINE (the [[stage.units]] arm's unit of work): the
// KEY matched textually (bare or quoted — the roster strip's
// tolerance), the VALUE judged by the PARSE (gate-r20 tests-5002: the
// old decimal-only regex `[0-9]+(\.[0-9]+)?` missed the exponential
// spelling `temperature = 0.2e0` — legal TOML, the same 0.2 to
// smol-toml — so the pin survived the line strip and the gate-audited
// dropout levy dead-ended at its own verify: no program, no verdict,
// the audit measuring nothing. The strip speaks the parser's grammar:
// a value the parse reads as a number is a pin; anything else is not
// this arm's to touch, and the parse-verify backstops the residual.)
function isTemperaturePinLine(line: string): boolean {
  const m = line.match(/^[ \t]*["']?temperature["']?[ \t]*=[ \t]*(.+)$/)
  if (!m) return false
  try {
    const v = parseToml(`__probe = ${m[1]}`) as { __probe?: unknown }
    return typeof v.__probe === "number"
  } catch {
    return false
  }
}

function stripTemperaturePins(toml: string): string {
  const lines = toml.split("\n")
  // arm 2: [[stage.units]] AND [[stage.members]] blocks (gate-r25
  // principles-60: member temperature rides the same host birth and
  // is refused there with no model — the audit's receipt "temperature
  // pins dropped" must cover every enforced seat) — drop
  // temperature-key LINES (whole bare-key lines only; a multi-line
  // string whose line is EXACTLY a bare temperature key is the
  // documented residual — the parse-verify backstops surviving pins)
  let inEntryBlock = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    // the shared header predicates (gate-r24 principles-51): ONE seat
    // for "is this line a [[stage.<array>]] header" — quoted keys and
    // trailing comments included, exactly the grammar the roster
    // strip's anchor reads. Two grammars here dead-ended a dropout
    // audit of a legal template at its own verify.
    if (isStageUnitsHeader(t) || isStageMembersHeader(t)) {
      inEntryBlock = true
      continue
    }
    if (/^\[/.test(t)) {
      inEntryBlock = false
      continue
    }
    if (inEntryBlock && isTemperaturePinLine(lines[i])) {
      lines[i] = ""
    }
  }
  // arm 1: the inline forms — THE PARSE DECIDES (gate-r17 tests-2005):
  // the old /\{[^}]*\btemperature/ matcher matched the WORD inside
  // brief string values and the comma-form replace ate "temperature =
  // 5, " from INSIDE the value — the lens was briefed with a different
  // question than the program declared, ok:true. Pins are KEYS; only
  // the parse knows a key from a word in a string. Each block is
  // rebuilt from the parse with the temperature keys deleted (string
  // values re-serialize verbatim). BOTH stage arrays — units and
  // members (gate-r25 principles-60), one rewriter.
  const dropTemperature = (u: Record<string, unknown>): Record<string, unknown> => {
    if (!("temperature" in u)) return u
    const next = { ...u }
    delete next.temperature
    return next
  }
  const unitsPass = rebuildInlineArray(lines.join("\n"), "units", "id", dropTemperature)
  const membersPass =
    unitsPass !== null
      ? rebuildInlineArray(unitsPass.text, "members", "name", dropTemperature)
      : null
  return membersPass?.text ?? unitsPass?.text ?? lines.join("\n")
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
  // the FINAL materialized bytes, captured INSIDE the pipeline's scope
  // (gate-r18 principles-39: the lens handoff used to read
  // `workflowTomlOut ?? templateToml` OUTSIDE the block that declares
  // templateToml — ?? short-circuits, so every pipeline-changed path
  // skipped the right operand and the suite stayed green, while a
  // changed-NOTHING path (no --model, nothing to strip — the
  // model-less audit levy's own shape) evaluated it and threw
  // ReferenceError before any ReviewReady)
  let materializedToml: string | undefined
  {
    const templateToml = readFileSync(join(template, "workflow.toml"), "utf8")
    let toml = templateToml
    // THE SUBSET QUESTION (gate-r20 tests-5001): "does this roster
    // name fewer units than the template DECLARES?" — answered by set
    // difference against the template's own parse, never by the
    // canonical gate size. The old `roster.length < 4` keyed the strip
    // and the verify on a magic constant, so a four-element roster over
    // a FIVE-unit template skipped every roster check and materialized
    // all five units — at exactly the length where "full rail" and
    // "subset" stop coinciding, silently running a lens the gate's
    // decision excluded.
    let parsedOriginal: { workflow?: { model?: string }; stage?: unknown }
    try {
      parsedOriginal = parseToml(templateToml) as typeof parsedOriginal
    } catch (err) {
      return {
        ok: false,
        why: `the template's workflow.toml is not valid TOML (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — fix the template or pass --template pointing at a valid one`,
        code: 2,
      }
    }
    let rosterSubsets = false
    // THE STAGE/UNITS SHAPE LAW, ONE SEAT, BOTH PATHS (gate-r25
    // questions-15): a singular [stage] table or a singular units
    // table ([stage.units] / units = {… }) is legal TOML the parse
    // hands back as a plain object, and every units reader downstream
    // assumed the array — the singular-STAGE twin is typed-refused
    // while the units twin crashed with an escaped TypeError. The
    // run's own law: stages AND units must be arrays. Guarded once,
    // here, at the unconditional pre-build parse — before any side
    // effect, both paths; the strip writes only array forms, so the
    // materialized bytes cannot regress into the guarded shape.
    if (parsedOriginal.stage !== undefined && !Array.isArray(parsedOriginal.stage)) {
      return {
        ok: false,
        why: `the template's [stage] is a singular table — the run requires [[stage]] array-of-tables entries (stages must be an array); rewrite the stage headers`,
        code: 2,
      }
    }
    for (const s of (parsedOriginal.stage as Array<{ units?: unknown }> | undefined) ?? []) {
      if (s != null && typeof s === "object" && s.units !== undefined && !Array.isArray(s.units)) {
        return {
          ok: false,
          why: `the template's units is a singular table — the run requires units array entries ([[stage.units]] or units = [ … ]); rewrite the units declaration`,
          code: 2,
        }
      }
    }
    if (args.roster) {
      const templateIds = ((parsedOriginal.stage as Array<{ units?: Array<{ id?: string }> }> | undefined) ?? [])
        .flatMap((s) => (s.units ?? []).map((u) => u?.id))
        .filter((x): x is string => typeof x === "string")
      const keep = new Set(args.roster)
      rosterSubsets = templateIds.some((id) => !keep.has(id))
      if (rosterSubsets) {
        const stripped = stripUnitsToRoster(toml, keep)
        if (stripped === null) {
          return { ok: false, why: `template has no units block for roster subsetting`, code: 1 }
        }
        toml = stripped
      }
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
    // the roster verify — UNCONDITIONAL behind the strip (gate-r5
    // tests-2: the no-model strip no-op'd with no verify behind it,
    // materializing all four units while the gate decided two): the
    // consumer's own read must agree the subset landed. AND non-empty
    // (gate-r7 principles-28): a roster naming ZERO of the template's
    // units dropped every lens and the strays-only check passed on zero
    // survivors — a zero-lens review with ok:true, the exact shape the
    // empty-roster guard refuses. Keyed on the SAME parse-derived flag
    // as the strip (gate-r20 tests-5001 — one law, one seat).
    if (rosterSubsets && args.roster) {
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
    const hasTempPin = pinsSpawnTemperature(parsedTemplate)
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
          clean = !pinsSpawnTemperature(parseToml(stripped))
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
    materializedToml = toml
  }

  const headShort = headSha.slice(0, 8)
  const slug = `${basename(repo)}-${head === headBranch && headBranch !== "HEAD" ? headBranch.replace(/[^a-zA-Z0-9-]/g, "-") : headShort}`
  const dir = args.out ? resolve(args.out) : join(repo, ".whl-review", slug)
  // the gate's roster (review-gate.ts): a subset materializes ONLY
  // those lens units — one decision, made once at the door (ADR 0014:
  // a chain cannot shed units mid-run, so the roster is pre-flight).
  // An EMPTY roster refuses BEFORE ANY SIDE EFFECT (gate-r21
  // tests-9501): this check used to fire after mkdir+cpSync but
  // before data/review existed, leaving a half-built dir the door's
  // own replace-guard ("workflow.toml && data/review") classifies as
  // not-ours — the prescribed re-run at the same --out dead-ended on
  // the debris, and the default --out sits inside the repo under
  // review. Refusals precede the build; nothing is left to clean up.
  if (args.roster && args.roster.length === 0) {
    return { ok: false, why: `empty roster — the gate decided skip; do not materialize (this is a door bug if you see it)`, code: 2 }
  }
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
    const finalToml = materializedToml ?? readFileSync(join(template, "workflow.toml"), "utf8")
    let ids: string[] = []
    try {
      const parsedFinal = parseToml(finalToml) as { stage?: unknown }
      // singular [stage]: same typed refusal as the roster verify —
      // the run requires an array; never .flatMap an object
      // (gate-r18 tests-2006's twin crash site)
      // the stage/units shape law lives at ONE seat now (gate-r25
      // questions-15): the unconditional pre-build guard on
      // parsedOriginal — the strip writes only array forms, so the
      // materialized bytes cannot regress into a singular shape
      ids = ((parsedFinal.stage as Array<{ units?: Array<{ id?: string }> }> | undefined) ?? [])
        .flatMap((s) => (s.units ?? []).map((u) => u?.id))
        .filter((x): x is string => typeof x === "string")
    } catch {
      return { ok: false, why: `the final materialized workflow.toml does not parse — cannot hand off the lens roster (this is a door bug; report it)`, code: 2 }
    }
    // ONE doctrine, both paths (gate-r19 questions-14): the roster
    // path already refuses a template whose parse reads zero stage
    // units ("a zero-lens review is the empty-roster shape the door
    // refuses") — the plain path used to materialize it ok:true with
    // an EMPTY handoff, and the run's own intake gate exited 1 on
    // exactly that ("missing or empty handoff … this is a door bug"):
    // a booked job dead at its first gate, holding a receipt that
    // blames the door for the shape the door just shipped.
    if (ids.length === 0) {
      return {
        ok: false,
        why: `the template declares no stage units — a zero-lens review is the empty-roster shape the door refuses (the run's intake gate would exit on the empty handoff)`,
        code: 2,
      }
    }
    writeFileSync(join(dir, "data", "review", "lenses.txt"), ids.join("\n") + "\n")
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
