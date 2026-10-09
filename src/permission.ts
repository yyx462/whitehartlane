// The permission half of JEV (zen 6): when a worker pane blocks on a
// permission dialog, the rail asks this typed decider — a script, not
// an agent, never a person waiting. Allow what is inside the member's
// roots; deny the dangerous patterns outright; the gray zone (inside
// home, outside roots, not dangerous) is a jev question, not a flat
// no: a tuned typed judgment reads the ask plus the worker's task and
// decides plausibly-needed (a vista job may read its session shots)
// against wandering. The prompt and threshold it asks with are the
// jev-tuner's landed winner — a dead jev fails restrictive. And a
// repeated ask for the same non-dangerous path IS the assertion of
// need: escalateOnRepeat grants it on the second ask, so the deny
// message's promise is true even when the judge misses. Hard-deny
// never escalates. The dialog's path is NORMALIZED first (see
// normalizeDialogPath): `~`, cwd-relative, and home-stripped forms all
// key one path, so the ladder and the reason hold steady while the
// terminal's rendering wobbles. Every verdict carries a message the
// rail injects into the pane. Prompts never queue for a human.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { loadPrompt, loadThreshold } from "./jev-prompts.ts"
import { jevNoulQ } from "./jev.ts"

// The deny cap every rail surface shares: a worker may be DENIED this
// many dialogs before its blocking is the worker's, not the dialog's.
// Allows are free — a jev-blessed need (a vista job reading its
// session shots) is work, not wandering; only a deny pattern (wandering
// asks, or a hard-deny re-ask loop) spends the cap.
export const PERMISSION_CAP = 6

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

// A dialog names its path in whatever form the terminal rendered it:
// absolute, `~`-relative, cwd-relative, or home-STRIPPED (j-2b508e:
// `/Users/sagebot/projects/NWi/…` shown as `/projects/NWi/…`). The
// judgment and the escalation ladder must key ONE path, or a wobbling
// form splits the ladder and flips the verdict's reason. Normalizing:
// `~` and cwd-relative resolve by construction; a bare `/…` that does
// not exist on disk while `home + path` does is the stripped form.
export function normalizeDialogPath(raw: string, home: string, cwd?: string): string {
  let p = raw
  if (p === "~" || p.startsWith("~/")) p = home.replace(/\/$/, "") + p.slice(1)
  if (!p.startsWith("/")) p = cwd ? join(cwd, p) : p
  const homePrefix = home.replace(/\/$/, "")
  if (!p.startsWith(homePrefix) && !existsSync(p) && existsSync(homePrefix + p)) {
    p = homePrefix + p
  }
  // a directory rendered with its trailing slash is the same path
  return p.replace(/\/+$/, "") || p
}

export function decidePermission(
  input: {
    question: string
    allowedRoots: string[]
    home?: string
    cwd?: string
    context?: string
  },
  judge?: PermissionJudge,
): PermissionDecision {
  const home = input.home ?? "/Users/"
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
  if (input.allowedRoots.some((root) => under(path, root))) {
    return {
      decision: "allow",
      path,
      message: `granted: ${path} is inside this Job's roots.`,
    }
  }
  if (!path.startsWith(home)) {
    return {
      decision: "deny",
      path,
      escalatable: true,
      message: `denied: ${path} is outside the home tree this Job runs in. If you truly need it, ask again — a repeated ask for the same path is granted.`,
    }
  }
  // the gray zone: inside home, outside roots. A judge reads the ask
  // in context; no judge (or a dead one) stays restrictive. Whatever
  // the judge says, a repeat ask still escalates below.
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
  return {
    decision: "deny-unneeded",
    path,
    escalatable: true,
    message: `denied: I don't think you need ${path} for this job — stay in the target tree and the job dir. If you truly need it, ask again — a repeated ask for the same path is granted.`,
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
