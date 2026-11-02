import { join } from "node:path"

export function paneName(role: "actor" | "mock", id?: string): string {
  if (role === "mock") {
    if (!id || !id.trim()) throw new Error("mock pane needs a name")
    return `mock-${id}`
  }
  return role
}

// ONE SPELLING for the actor's brief path, and the marker that rides
// the actor's first user message (momentum-3 / principles-1 / tests-3,
// the #266 twin): the lab's booking seats match dirname(briefPath) =
// <taskDir>/briefs against the first message, and the actor's brief
// never carried it — the actor's session never booked, and a
// continued lab re-briefed its one mind instead of resuming it.
export const actorBriefPath = (taskDir: string): string => join(taskDir, "briefs", "actor.md")

export function actorBrief(jobText: string, taskDir = ""): string {
  const markerLine = taskDir
    ? [`Your brief for this experiment is filed at ${actorBriefPath(taskDir)} — if this conversation loses it, re-read it there.`, ""]
    : []
  return [
    "You are the actor. You do not spawn panes. You do not call shep.",
    "Write protocol.json in this directory to name the next wave. Then stop and wait.",
    'A later prompt brings the results. To finish, write {"stop":true} as protocol.json.',
    ...markerLine,
    jobText.trim(),
  ].join("\n")
}
