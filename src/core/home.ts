// src/core/home.ts — the harness home's ONE resolution (moved from
// adapters/store.ts, 2026-11-01 — the momentum-1007 receipt: the
// permission ladder hand-spelled the LEGACY disk path where the store
// resolves the ADR-0011 default, and the rung was inert on exactly the
// disk the sessions live on; a third twin was the finding, not the
// fix). core owns it because BOTH the store and the permission ladder
// need it, and adapters may import core — never the other way.
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export function homeRoot(): string {
  // TWIN WARNING: scripts/review-trace.mjs replicates this exact
  // resolution (a .mjs cannot import this TS module) — if you change
  // the order or the spellings, change both (r13 tests-3).
  if (process.env.AGENTIC_OS_HOME) return process.env.AGENTIC_OS_HOME
  // ADR 0011: the disk default is ~/.local/share/whitehartlane; a legacy
  // agentic-os disk still wins while it is the only one that exists
  // (read both, write the new spelling — the ADR 0009 pattern).
  const next = join(homedir(), ".local", "share", "whitehartlane")
  const old = join(homedir(), ".local", "share", "agentic-os")
  return existsSync(old) && !existsSync(next) ? old : next
}
