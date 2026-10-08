// The permission half of JEV (zen 6): when a worker pane blocks on a
// permission dialog, the rail asks this typed decider — a script, not
// an agent, never a person waiting. Allow what is inside the member's
// roots; deny the dangerous patterns outright; the gray zone (inside
// home, outside roots, not dangerous) is a jev question, not a flat
// no: a tuned typed judgment reads the ask plus the worker's task and
// decides plausibly-needed (a vista job may read its session shots)
// against wandering. The prompt and threshold it asks with are the
// jev-tuner's landed winner — a dead jev fails restrictive and the
// say-why escape hatch still works. Every verdict carries a message
// the rail injects into the pane. Prompts never queue for a human.
import { loadPrompt, loadThreshold } from "./jev-prompts.ts"
import { jevNoulQ } from "./jev.ts"

export type PermissionDecision = {
  decision: "allow" | "deny" | "deny-unneeded"
  message: string
  path?: string
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

export function decidePermission(
  input: {
    question: string
    allowedRoots: string[]
    home?: string
    context?: string
  },
  judge?: PermissionJudge,
): PermissionDecision {
  const home = input.home ?? "/Users/"
  // the longest absolute path mentioned in the dialog is the subject
  const path = (input.question.match(/\/[A-Za-z0-9._~\/+-]+/g) ?? [])
    .filter((p) => !p.endsWith("/") || p.length > 1)
    .sort((a, b) => b.length - a.length)[0]
  if (path === undefined) {
    return {
      decision: "deny-unneeded",
      message:
        "denied: no recognizable path in that permission ask. Stay in the target tree and the job dir; if you truly need something else, say why in your next message.",
    }
  }
  if (HARD_DENY.some((re) => re.test(path))) {
    return {
      decision: "deny",
      path,
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
      message: `denied: ${path} is outside the home tree this Job runs in. Continue your own task.`,
    }
  }
  // the gray zone: inside home, outside roots. A judge reads the ask
  // in context; no judge (or a dead one) stays restrictive.
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
    message: `denied: I don't think you need ${path} for this job — stay in the target tree and the job dir. If you truly need it, say why in your next message and the decision may change.`,
  }
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
