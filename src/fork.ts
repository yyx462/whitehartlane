// ADR 0006 §3 — whl fork: deliver a booked wake into a reborn levy
// pane. This is the pure half: the seed the fork points back to, and
// the first prompt the reborn pane receives. The body (tab, pane,
// herdr) lives in bin/agentic-os.
import type { JobRecord, SeedPointer } from "./store.ts"

// The seed a fork of this Job's levy points back to — always the
// spawner pointer, never anything later: the levy session stays the
// spawn point forever.
export function forkSeedOf(job: JobRecord): SeedPointer | null {
  if (!job.spawner) return null
  return { tool: job.spawner.tool, session_id: job.spawner.session_id, since: job.spawner.since }
}

export function forkPrompt(input: {
  wake: { message: string }
  seed: SeedPointer
  jid: string
}): string {
  return [
    `[wake] ${input.wake.message}`,
    "",
    `You are the fork of the levy that levied this spur (${input.jid}): your`,
    `session ${input.seed.tool}:${input.seed.session_id} was resumed from the`,
    `checkpoint ${input.seed.since} — the moment the spur was levied.`,
    "Read the report, decide what it means for your work, and carry on.",
  ].join("\n")
}
