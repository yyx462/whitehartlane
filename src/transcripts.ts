// Transcript pointers and resolvers. The transcript of a worker lives
// with its host tool (pi: jsonl under ~/.pi/agent/sessions; opencode:
// a SQLite db queried via the CLI) — we never copy it. A pointer says
// "the newest session this host started in this cwd since this
// instant"; per-unit working directories make that unique. Resolvers
// turn a pointer into readable bytes.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { TranscriptPointer } from "./store.ts"

export function piSessionsRoot(): string {
  return process.env.PI_SESSIONS_ROOT ?? join(homedir(), ".pi", "agent", "sessions")
}

// pi encodes the cwd into the directory name as "--<path with / \ :
// replaced by ->--"; the leading slash is dropped, not dashed.
export function piEncodeCwd(cwd: string): string {
  return cwd.replaceAll(/[/\\:]/g, "-").replace(/^-/, "")
}

type PiHeader = { type: string; id?: string; timestamp?: string; cwd?: string }

function readPiHeader(path: string): PiHeader | null {
  try {
    const first = readFileSync(path, "utf8").split("\n")[0]
    const parsed = JSON.parse(first) as PiHeader
    return parsed?.type === "session" ? parsed : null
  } catch {
    return null
  }
}

export function resolvePi(pointer: TranscriptPointer): { id: string; path: string } | null {
  const dir = join(piSessionsRoot(), `--${piEncodeCwd(pointer.cwd)}--`)
  if (!existsSync(dir)) return null
  const since = Date.parse(pointer.since)
  let best: { id: string; path: string; ts: number } | null = null
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue
    const path = join(dir, name)
    const header = readPiHeader(path)
    if (!header?.id || !header.timestamp) continue
    const ts = Date.parse(header.timestamp)
    if (Number.isNaN(ts) || ts < since) continue
    if (!best || ts > best.ts) best = { id: header.id, path, ts }
  }
  return best ? { id: best.id, path: best.path } : null
}

function opencodeDb(): string {
  return process.env.OPENCODE_DB ?? join(homedir(), ".local", "share", "opencode", "opencode.db")
}

// Primary: the opencode SQLite db, queried precisely by (directory,
// created >= since) — no CLI list window can miss it. Fallback: the
// CLI's session list (last resort when the db is unreadable).
export function resolveOpencode(pointer: TranscriptPointer): { id: string } | null {
  const since = Date.parse(pointer.since)
  if (existsSync(opencodeDb())) {
    try {
      const db = new DatabaseSync(opencodeDb(), { readOnly: true })
      try {
        const row = db
          .prepare(
            "SELECT id FROM session WHERE directory = ? AND time_created >= ? ORDER BY time_created DESC LIMIT 1",
          )
          .get(pointer.cwd, since) as { id?: string } | undefined
        if (row?.id) return { id: row.id }
        return null
      } finally {
        db.close()
      }
    } catch {
      // fall through to the CLI
    }
  }
  let best: { id: string; created: number } | null = null
  for (const s of listOpencodeSessions(1000)) {
    if (s.directory !== pointer.cwd) continue
    if (typeof s.created !== "number" || s.created < since) continue
    if (!best || s.created > best.created) best = { id: s.id, created: s.created }
  }
  return best ? { id: best.id } : null
}

export type OpencodeSession = {
  id: string
  title?: string
  directory?: string
  updated?: number
  created?: number
}

export function listOpencodeSessions(limit = 100): OpencodeSession[] {
  try {
    const out = execFileSync(
      process.env.OPENCODE_BIN ?? "opencode",
      ["session", "list", "--format", "json", "-n", String(limit)],
      { encoding: "utf8", timeout: 30_000 },
    )
    return JSON.parse(out) as OpencodeSession[]
  } catch {
    return []
  }
}

export function resolveTranscript(
  pointer: TranscriptPointer,
): { tool: string; id: string; path?: string; read: () => string } | null {
  if (pointer.tool === "pi") {
    const hit = resolvePi(pointer)
    if (!hit) return null
    return { tool: "pi", id: hit.id, path: hit.path, read: () => readFileSync(hit.path, "utf8") }
  }
  if (pointer.tool === "opencode") {
    const hit = resolveOpencode(pointer)
    if (!hit) return null
    return {
      tool: "opencode",
      id: hit.id,
      read: () =>
        execFileSync(process.env.OPENCODE_BIN ?? "opencode", ["export", hit.id], {
          encoding: "utf8",
          timeout: 60_000,
        }),
    }
  }
  return null
}
