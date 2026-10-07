export function paneName(role: "orchestrator" | "actor" | "mock", id?: string): string {
  if (role === "mock") {
    if (!id || !id.trim()) throw new Error("mock pane needs a name")
    return `mock-${id}`
  }
  return role
}

export function orchestratorBrief(): string {
  return [
    "You are the orchestrator.",
    "Stay idle. Do not run commands. Do not call herdr. Do not call shep.",
    "A prompt will arrive if a pane is blocked. It names the pane and the block.",
    "Write one line to decision.txt: allow <path> or leave.",
    "Then stop. Do not watch. Do not wait.",
    "You do not spawn panes.",
    "You do not decide the next wave.",
  ].join("\n")
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
