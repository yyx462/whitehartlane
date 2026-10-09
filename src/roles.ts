export function paneName(role: "actor" | "mock", id?: string): string {
  if (role === "mock") {
    if (!id || !id.trim()) throw new Error("mock pane needs a name")
    return `mock-${id}`
  }
  return role
}

export function actorBrief(jobText: string): string {
  return [
    "You are the actor. You do not spawn panes. You do not call shep.",
    "Write protocol.json in this directory to name the next wave. Then stop and wait.",
    'A later prompt brings the results. To finish, write {"stop":true} as protocol.json.',
    "",
    jobText.trim(),
  ].join("\n")
}
