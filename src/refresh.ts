// Human-triggered door refresh. A running orchestrator is the code it
// was born with; merging master does not enter that process. Refresh
// is pause-then-continue, and only because a person asked. Nothing
// here re-execs on its own.
//
// The wait is a property of the record, not a timer event: paused
// means the drain booked, anything other than running means the job
// left the drain on its own, and the ceiling is the only give-up.

export type RefreshWait = "wait" | "continue" | "stopped" | "timeout"

export function refreshWait(state: string, elapsedMs: number, ceilingMs: number): RefreshWait {
  if (state === "paused") return "continue"
  if (state !== "running") return "stopped"
  if (elapsedMs >= ceilingMs) return "timeout"
  return "wait"
}
