// The permission half of JEV (zen 6): when a worker pane blocks on a
// permission dialog, the rail asks this typed decider — a script, not
// an agent, never a person waiting. Allow what is inside the member's
// roots; deny the dangerous patterns outright; deny the rest as
// unneeded wandering. Every verdict carries a message the rail injects
// into the pane. With this decider the default posture can be
// restrictive again: prompts never queue for a human.
export type PermissionDecision = {
  decision: "allow" | "deny" | "deny-unneeded"
  message: string
  path?: string
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
  return {
    decision: "deny-unneeded",
    path,
    message: `denied: I don't think you need ${path} for this job — stay in the target tree and the job dir. If you truly need it, say why in your next message and the decision may change.`,
  }
}
