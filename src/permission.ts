// The permission half of JEV (zen 6): when a worker pane blocks on a
// permission dialog, the rail asks this typed decider — a script, not
// an agent, never a person waiting. Allow what is inside the member's
// roots; deny the dangerous patterns outright; deny the rest as
// unneeded wandering. Every verdict carries a message the rail injects
// into the pane. And a repeated ask for the same non-dangerous path IS
// the assertion of need: escalateOnRepeat grants it on the second ask,
// so the deny message's promise is true. Hard-deny never escalates.
export type PermissionDecision = {
  decision: "allow" | "deny" | "deny-unneeded"
  message: string
  path?: string
  // true when a repeat ask for the same path may escalate to allow
  escalatable?: boolean
}

// hardcoded: secrets and credentials are denied even inside roots
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
]

function under(path: string, root: string): boolean {
  const r = root.endsWith("/") ? root.slice(0, -1) : root
  return path === r || path.startsWith(`${r}/`)
}

export function decidePermission(input: {
  question: string
  allowedRoots: string[]
  home?: string
}): PermissionDecision {
  const home = input.home ?? "/Users/"
  // the longest absolute path mentioned in the dialog is the subject
  const path = (input.question.match(/\/[A-Za-z0-9._~\/+-]+/g) ?? [])
    .filter((p) => !p.endsWith("/") || p.length > 1)
    .sort((a, b) => b.length - a.length)[0]
  if (path === undefined) {
    return {
      decision: "deny-unneeded",
      escalatable: false,
      message:
        "denied: no recognizable path in that permission ask. Stay in the target tree and the job dir; if you truly need something else, say why in your next message.",
    }
  }
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
