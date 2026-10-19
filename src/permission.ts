// The permission half of JEV (zen 6), and THE canonical path predicate
// (OPTIMUM §5): every path question the rail asks — a blocked dialog,
// a pre-seed glob, an admission scan — is answered from the scope this
// module constructs. When a worker pane blocks on a
// permission dialog, the rail asks this typed decider — a script, not
// an agent, never a person waiting. Allow what is inside the member's
// roots and temp scratch; deny the dangerous patterns outright; the
// gray zone (not roots, not temp, not dangerous — inside home or out)
// is a jev question, not a flat no: a tuned typed judgment reads the
// ask plus the worker's task and decides plausibly-needed (a vista job
// may read its session shots) against wandering. The prompt and
// threshold it asks with are the jev-tuner's landed winner — a dead
// jev fails restrictive. And a repeated ask for the same non-dangerous
// path IS the assertion of need: escalateOnRepeat grants it on the
// second ask, so the deny message's promise is true even when the
// judge misses. Hard-deny never escalates. The dialog's path is
// NORMALIZED first (see normalizeDialogPath): `~`, cwd-relative, and
// home-stripped forms all key one path, so the ladder and the reason
// hold steady while the terminal's rendering wobbles. Every verdict
// carries a message the rail injects into the pane. Prompts never
// queue for a human.
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { loadPrompt, loadThreshold } from "./jev-prompts.ts"
import { jevNoulQ } from "./jev.ts"

// The deny cap every rail surface shares: a worker may be DENIED this
// many dialogs before its blocking is the worker's, not the dialog's.
// Allows are free — a jev-blessed need (a vista job reading its
// session shots) is work, not wandering; only a deny pattern (wandering
// asks, or a hard-deny re-ask loop) spends the cap.
export const PERMISSION_CAP = 6

// Roots a program declares that can NEVER ride along: hard-deny paths.
// The battery's secrets scenario proved the smuggling route — a
// roots.txt naming ~/.e2e-vault/.env pre-allowed it in the worker's
// opencode.json, so no dialog ever fired and the rail's HARD_DENY (which
// outranks roots only AT a dialog) never got a say: the worker read the
// secret silently. Such roots are stripped loudly instead.
export function sanitizeRoots(roots: string[]): { kept: string[]; stripped: string[] } {
  const kept: string[] = []
  const stripped: string[] = []
  for (const root of roots) {
    if (HARD_DENY.some((re) => re.test(root))) stripped.push(root)
    else kept.push(root)
  }
  return { kept, stripped }
}

export type PermissionDecision = {
  decision: "allow" | "deny" | "deny-unneeded"
  message: string
  path?: string
  // true when a repeat ask for the same path may escalate to allow
  escalatable?: boolean
}

// The gray-zone judge: p(this path is plausibly needed for this task).
// Injected so tests stay offline; the rail passes the tuned one.
export type PermissionJudge = (input: {
  path: string
  ask: string
  context?: string
}) => number

// hardcoded: secrets and credentials are denied even inside roots —
// the judge never sees them
const HARD_DENY = [
  /\.ssh/i,
  /\.gnupg/i,
  /\.env/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.aws/i,
  /\.kube/i,
  /secret/i,
  /credential/i,
  /private[-_]?key/i,
  /\.config\/jev\//i,
  /\.secrets\//i,
  /\.gpg/i,
]

function under(path: string, root: string): boolean {
  const r = root.endsWith("/") ? root.slice(0, -1) : root
  return path === r || path.startsWith(`${r}/`)
}

// -- the canonical path predicate (OPTIMUM §5) ---------------------------------
//
// Four side layers used to re-spell this file's three primitives (the
// deny set, the under-test, the temp set), and they drifted: run.ts's
// admission scan carried a private temp list missing the realpath
// form, its `~` regex differed from coworker-run's, and a hard-deny
// root in roots.txt was stripped by the doors but still counted
// "covered" at admission (#77 enforced at one boundary only). One
// PathScope, constructed from the program's declaration, is the
// currency now: the dialog ladder, the pre-seed globs, and the
// admission scan all ask the scope; nothing re-owns the primitives.

// One tilde spelling: `~` and `~/…` resolve against the real home.
export function expandHome(p: string): string {
  return p.replace(/^~(?=\/|$)/, homedir())
}

// The declared-roots view of a program directory: roots.txt beside the
// workflow, one absolute or `~`-relative path per line. The one
// spelling — the doors' own readers fold onto this next slice.
export function readRootsTxt(dir: string): string[] {
  try {
    return readFileSync(join(dir, "roots.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

export type PathScope = { roots: string[] }

// Construct the scope: expand `~`, strip hard-deny roots (deny
// outranks roots EVERYWHERE a root can ride — #77, the pre-seed
// projection included), drop empties, dedupe. Idempotent: the doors
// pass already-sanitized programRoots through unchanged.
export function declareScope(roots: string[]): PathScope {
  const { kept } = sanitizeRoots(roots)
  return { roots: [...new Set(kept.map(expandHome).filter((r) => r.length > 0))] }
}

// The admission view (#51): the program dir plus its declared roots.
export function scopeFromDir(dir: string): PathScope {
  return declareScope([dir, ...readRootsTxt(dir)])
}

// Is a path covered by the scope — a root or temp scratch? The static
// question the door asks about brief text; the runtime ladder below is
// strictly richer (it judges the gray zone). Temp counts covered
// without the ladder's outside-home guard: a brief naming scratch
// under a home-planted temp tree is not a mismatch to refuse over.
export function scopeCovers(scope: PathScope, path: string): boolean {
  return [...scope.roots, ...TEMP_ROOTS].some((root) => under(path, root))
}

// The pre-seed projection: what the worker's own opencode.json allows
// from session start, so a dialog the ladder would only re-allow every
// beat never fires (j-b6067c). Derived from the same primitives — the
// writer (store.ts) never re-owns the knowledge. Every root grants
// BOTH spellings, the bare form and `/**`: the ladder's under()
// accepts the root itself, and a glob alone does not.
export function allowGlobs(roots: string[]): Record<string, string> {
  const external: Record<string, string> = { "*": "ask" }
  for (const root of [...roots, ...TEMP_ROOTS]) grantRoot(external, root)
  return external
}

// Grant one root into an external_directory map: both path forms plus
// the realpath opencode canonicalizes its project root to (j-b6067c —
// on symlinked roots a one-form glob leaks prompts). Degenerate roots
// ("/", "") are the CALLER's to refuse; a missing root still seeds its
// literal spelling.
export function grantRoot(external: Record<string, string>, root: string): void {
  try {
    for (const form of new Set([root, realpathSync(root)])) {
      external[form] = "allow"
      external[`${form}/**`] = "allow"
    }
  } catch {
    // no realpath (the root does not exist yet) — the literal spelling
    // still seeds both forms, exactly as an existing root's does
    external[root] = "allow"
    external[`${root}/**`] = "allow"
  }
}

// Temp space is working scratch, not a boundary: mktemp/git/pip writes
// land there, and a flat outside-home deny stall-reaps a worker that
// only wanted scratch (j-ba18b7: /tmp). Sensitive paths stay
// hard-denied above; wandering elsewhere outside home is judged below.
// Private now: the pre-seed projection (allowGlobs) lives in this file,
// so no consumer needs the list itself (j-b6067c behavior kept).
const TEMP_ROOTS: string[] = (() => {
  const roots = new Set(["/tmp", "/private/tmp", "/var/folders", tmpdir()])
  try {
    roots.add(realpathSync(tmpdir()))
  } catch {
    // keep the static spellings
  }
  return [...roots]
})()

// A dialog names its path in whatever form the terminal rendered it:
// absolute, `~`-relative, cwd-relative, home-STRIPPED (j-2b508e:
// `/Users/<name>/projects/acme/…` shown as `/projects/acme/…`), or
// underscore-MANGLED (j-8aceed / issue #82: `/Users_<name>/projects` —
// a slash rendered as `_`, so no root can ever match and the ladder
// keys a path that does not exist). The judgment and the escalation
// ladder must key ONE path, or a wobbling form splits the ladder and
// flips the verdict's reason. Normalizing: `~` and cwd-relative resolve
// by construction; a bare `/…` that does not exist on disk while
// `home + path` does is the stripped form; a first segment like
// `/Users_<name>/` whose slash-repaired form exists (or is the home
// prefix) is the mangled form. Private: the repair is the predicate's
// own concern — callers hand it raw dialog text.
function normalizeDialogPath(raw: string, home: string, cwd?: string): string {
  let p = raw
  if (p === "~" || p.startsWith("~/")) p = home.replace(/\/$/, "") + p.slice(1)
  if (!p.startsWith("/")) p = cwd ? join(cwd, p) : p
  const homePrefix = home.replace(/\/$/, "")
  if (!p.startsWith(homePrefix) && !existsSync(p) && existsSync(homePrefix + p)) {
    p = homePrefix + p
  }
  // underscore-mangled home prefix: `/Users_<name>/…` -> `/Users/<name>/…`
  const mangled = p.match(/^\/(Users|home)_([A-Za-z0-9._-]+)(\/|$)/)
  if (mangled) {
    const repaired = p.replace(/^\/(Users|home)_([A-Za-z0-9._-]+)(\/|$)/, "/$1/$2/")
    if (!existsSync(p) && (repaired.startsWith(homePrefix) || existsSync(repaired))) {
      p = repaired
    }
  }
  // a directory rendered with its trailing slash is the same path
  return p.replace(/\/+$/, "") || p
}

// THE verdict: one entry point for "may this worker touch this path?"
// The dialog text arrives raw; the repair (normalizeDialogPath) and the
// root assembly ([cwd, …scope.roots]) are the predicate's internals.
// The ladder: hard-deny → scope roots → temp-outside-home → the tuned
// judge → deny-unneeded (a repeat ask escalates — see below).
export function decidePermission(
  input: {
    question: string
    scope: PathScope
    home?: string
    cwd?: string
    context?: string
  },
  judge?: PermissionJudge,
): PermissionDecision {
  const home = input.home ?? "/Users/"
  const allowedRoots = [input.cwd ?? "", ...input.scope.roots].filter((r) => r.length > 0)
  // the longest path mentioned in the dialog is the subject; the
  // leading `~` of a tilde-form path rides the match, or it is lost
  const rawPath = (input.question.match(/~?\/[A-Za-z0-9._~\/+-]+/g) ?? [])
    .filter((p) => !p.endsWith("/") || p.length > 1)
    .sort((a, b) => b.length - a.length)[0]
  if (rawPath === undefined) {
    return {
      decision: "deny-unneeded",
      escalatable: false,
      message:
        "denied: no recognizable path in that permission ask. Stay in the target tree and the job dir; if you truly need something else, say why in your next message.",
    }
  }
  const path = normalizeDialogPath(rawPath, home, input.cwd)
  if (HARD_DENY.some((re) => re.test(path))) {
    return {
      decision: "deny",
      path,
      escalatable: false,
      message: `denied: ${path} looks like secrets or credentials. Never touch it in this Job. Continue your own task.`,
    }
  }
  if (allowedRoots.some((root) => under(path, root))) {
    return {
      decision: "allow",
      path,
      message: `granted: ${path} is inside this Job's roots.`,
    }
  }
  // temp scratch is free OUTSIDE home only — a home planted under the
  // temp tree (tests, sandboxes) keeps its judged gray zone
  const homePrefix = home.replace(/\/$/, "")
  if (!path.startsWith(homePrefix) && TEMP_ROOTS.some((root) => under(path, root))) {
    return {
      decision: "allow",
      path,
      message: `granted: ${path} is temp scratch — no boundary there.`,
    }
  }
  // the gray zone: anywhere the roots and temp scratch do not cover —
  // inside home or out. A judge reads the ask in context; no judge (or
  // a dead one) stays restrictive. Whatever the judge says, a repeat
  // ask still escalates below.
  if (judge) {
    let p: number
    try {
      p = judge({ path, ask: input.question.slice(0, 1200), context: input.context })
    } catch {
      p = 0
    }
    if (p >= loadThreshold("permission-needed")) {
      return {
        decision: "allow",
        path,
        message: `granted: ${path} looks needed for this job (needed=${p.toFixed(2)}).`,
      }
    }
  }
  // issue #82: a path that does not exist on disk is usually a mangled
  // build (/Users_<name>/projects) — say so, so the worker can fix its
  // own command instead of re-asking a phantom path.
  const missing = existsSync(path) ? "" : ` (note: ${path} does not exist on disk — check how that path was built)`
  return {
    decision: "deny-unneeded",
    path,
    escalatable: true,
    message: `denied: I don't think you need ${path} for this job — stay in the target tree and the job dir. If you truly need it, ask again — a repeated ask for the same path is granted.${missing}`,
  }
}

// A repeat ask for the same path is the assertion of need the first
// denial asked for. The rail counts asks per member+path; the second
// escalates to a durable allow. Hard-deny verdicts never escalate.
export function escalateOnRepeat(v: PermissionDecision, priorAsksForPath: number): PermissionDecision {
  if (priorAsksForPath >= 1 && v.escalatable && v.path) {
    return {
      decision: "allow",
      path: v.path,
      message: `granted on repeat: you asked for ${v.path} again — treated as asserted need, and made durable for this Job.`,
    }
  }
  return v
}

// The state string the tuned judge asks over — one builder shared by
// the rail's judge and the tuner's scorer, so tuning measures what
// production runs.
export function permissionJudgeState(input: {
  path: string
  ask: string
  context?: string
}): string {
  return [
    `ask: ${input.ask}`,
    `path: ${input.path}`,
    input.context ? `worker context: ${input.context.slice(0, 2000)}` : "worker context: (none given)",
  ].join("\n")
}

// The tuned judge the rail passes: the landed prompt and threshold,
// asked through the shared jev adapter. Any failure throws — the
// decider above catches it and denies restrictively.
export function tunedPermissionJudge(): PermissionJudge {
  const question = loadPrompt("permission-needed")
  return ({ path, ask, context }) => jevNoulQ(question, permissionJudgeState({ path, ask, context }))
}
