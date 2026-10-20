// Transcript pointers and resolvers. The transcript of a worker lives
// with its host tool (pi: jsonl under ~/.pi/agent/sessions; opencode:
// a SQLite db queried via the CLI) — we never copy it. A pointer says
// "the newest session this host started in this cwd since this
// instant"; per-unit working directories make that unique. Resolvers
// turn a pointer into readable bytes.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
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

export function resolvePi(pointer: TranscriptPointer, expect?: string): { id: string; path: string } | null {
  const dir = join(piSessionsRoot(), `--${piEncodeCwd(pointer.cwd)}--`)
  if (!existsSync(dir)) return null
  const since = Date.parse(pointer.since)
  const candidates: { id: string; path: string; ts: number }[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue
    const path = join(dir, name)
    const header = readPiHeader(path)
    if (!header?.id || !header.timestamp) continue
    const ts = Date.parse(header.timestamp)
    if (Number.isNaN(ts) || ts < since) continue
    candidates.push({ id: header.id, path, ts })
  }
  candidates.sort((a, b) => b.ts - a.ts)
  // expect disambiguates a shared cwd (j-78ca43: two workers born seconds
  // apart in one worktree cross-booked each other's sessions under
  // newest-wins). The pane's own session is the one whose bytes contain
  // its brief's marker. With a marker there is NO fallback: a miss means
  // the brief is not committed yet (or never will be), and newest-wins
  // here is exactly the cross-booking the marker exists to prevent —
  // the caller's late probe retries, then may book without a marker.
  if (expect) {
    for (const cand of candidates) {
      try {
        if (readFileSync(cand.path, "utf8").includes(expect)) return { id: cand.id, path: cand.path }
      } catch {
        /* unreadable candidate — try the next */
      }
    }
    return null
  }
  const best = candidates[0]
  return best ? { id: best.id, path: best.path } : null
}

function opencodeDb(): string {
  return process.env.OPENCODE_DB ?? join(homedir(), ".local", "share", "opencode", "opencode.db")
}

// C06 — one shared read-only handle, not a fresh open per helper: the
// real db is 4GB+ of WAL and every wake/probe path opened it
// synchronously. Keyed on (path, mtime) so a replaced db (tests, a
// migration) never reads a stale inode; SQLite itself sees WAL
// freshness, the key only detects REPLACEMENT. A failed open returns
// null and callers fall through exactly as before. The one writer
// (repointOpencodeSession) keeps its own per-call connection.
let readCache: { path: string; mtimeMs: number; db: DatabaseSync } | null = null
function opencodeReadDb(): DatabaseSync | null {
  const path = opencodeDb()
  let st: { mtimeMs: number }
  try {
    st = statSync(path)
  } catch {
    readCache = null
    return null
  }
  if (readCache && readCache.path === path && readCache.mtimeMs === st.mtimeMs) {
    return readCache.db
  }
  try {
    readCache?.db.close()
  } catch {
    /* already gone */
  }
  try {
    const db = new DatabaseSync(path, { readOnly: true })
    readCache = { path, mtimeMs: st.mtimeMs, db }
    return db
  } catch {
    readCache = null
    return null
  }
}

// opencode v2.0.x migrated its storage: `session_v2` is the live
// table — everything created after the migration lives ONLY there,
// while legacy `session` is frozen at the migration instant. The p10
// incident (2026-10-12): the wake ladder's fork seed went blind
// because these reads still queried legacy only — every wake for a
// post-migration levy session fell to the doorbell. Ask v2 first,
// then legacy, then the CLI list.
const OPENCODE_SESSION_TABLES = ["session_v2", "session"]

// True when the session's FIRST user message contains the marker: that
// message is the brief a pane was born with, so the marker (the unit
// dir) identifies which pane owns the session even when siblings share
// the cwd. Schemas drift across opencode versions — any doubt is false,
// and the caller falls back to newest-wins.
function opencodeFirstUserHas(db: DatabaseSync, id: string, expect: string): boolean {
  for (const sql of [
    "SELECT data FROM session_message WHERE session_id = ? AND type = 'user' ORDER BY seq LIMIT 1",
    "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created, id LIMIT 1",
  ] as const) {
    try {
      const row = db.prepare(sql).get(id) as { data?: string } | undefined
      if (typeof row?.data === "string" && row.data.includes(expect)) return true
    } catch {
      /* table absent on this opencode version — try the next */
    }
  }
  return false
}

// Primary: the opencode SQLite db, queried precisely by (directory,
// created >= since) — no CLI list window can miss it. Fallback: the
// CLI's session list (last resort when the db is unreadable). expect
// (a brief marker, e.g. the unit dir) breaks newest-wins ties between
// siblings born into one shared cwd.
export function resolveOpencode(pointer: TranscriptPointer, expect?: string): { id: string } | null {
  const since = Date.parse(pointer.since)
  const db = opencodeReadDb()
  if (db) {
    try {
      for (const table of OPENCODE_SESSION_TABLES) {
        try {
          const rows = db
            .prepare(
              `SELECT id FROM ${table} WHERE directory = ? AND time_created >= ? ORDER BY time_created DESC LIMIT 50`,
            )
            .all(pointer.cwd, since) as { id?: string }[]
          const ids = rows.filter((r) => typeof r.id === "string").map((r) => r.id as string)
          if (ids.length === 0) continue
          if (expect) {
            for (const id of ids) {
              if (opencodeFirstUserHas(db, id, expect)) return { id }
            }
            // no candidate carries the marker: the pane's own first
            // user message is not committed yet (j-eafc83: siblings
            // born seconds apart race message persistence) — booking
            // newest-wins here IS the cross-booking. No id; the
            // caller's late probe retries.
            return null
          }
          return { id: ids[0]! }
        } catch {
          /* table absent on this opencode version — try the next */
        }
      }
      return null
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

// Issue #127 — repoint a session whose project directory vanished
// (repo renamed/moved/deleted) to a surviving ancestor. opencode binds
// a session to its stored directory on resume (it chdirs back to the
// old path, ENOENT), so moving the binding is the only way a ghost
// session can be woken. The rule is deterministic — the caller picks
// the target (nearest surviving ancestor), the rail never guesses;
// the old→new move is recorded in the caller's trail, so every
// repoint is auditable and reversible.
export function opencodeSessionDirectoryOf(id: string): string | null {
  const db = opencodeReadDb()
  if (!db) return null
  try {
    for (const table of OPENCODE_SESSION_TABLES) {
      try {
        const row = db.prepare(`SELECT directory FROM ${table} WHERE id = ?`).get(id) as
          | { directory?: string }
          | undefined
        if (typeof row?.directory === "string") return row.directory
      } catch {
        /* table absent on this opencode version — try the next */
      }
    }
    return null
  } catch {
    return null
  }
}

// Returns true when at least one row moved. WAL allows the write
// beside a live opencode server; a busy db throws and the caller
// falls back to the refusal that names the manual remedy.
export function repointOpencodeSession(id: string, directory: string): boolean {
  if (!existsSync(opencodeDb())) return false
  let db: DatabaseSync
  try {
    db = new DatabaseSync(opencodeDb())
  } catch {
    return false
  }
  try {
    for (const table of OPENCODE_SESSION_TABLES) {
      try {
        const r = db.prepare(`UPDATE ${table} SET directory = ? WHERE id = ?`).run(directory, id)
        if (r.changes > 0) return true
      } catch {
        /* table absent on this opencode version — try the next */
      }
    }
    return false
  } finally {
    db.close()
  }
}

// A fork seed names a host session by id, not by a (cwd, since)
// window: pi → the session file its header ids, opencode → the db row
// (the CLI list is the fallback). This is the "seed must resolve"
// half of fork admission (zen 6).
export function seedSessionFile(seed: { tool: string; session_id: string }): string | null {  if (seed.tool === "pi") {
    const root = piSessionsRoot()
    if (!existsSync(root)) return null
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".jsonl")) continue
        const path = join(dir, name)
        if (readPiHeader(path)?.id === seed.session_id) return path
      }
    }
    return null
  }
  if (seed.tool === "opencode") {
    return opencodeSessionExists(seed.session_id) ? opencodeDb() : null
  }
  return null
}

export function opencodeSessionExists(id: string): boolean {
  const db = opencodeReadDb()
  if (db) {
    try {
      for (const table of OPENCODE_SESSION_TABLES) {
        try {
          if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(id) !== undefined) return true
        } catch {
          /* table absent on this opencode version — try the next */
        }
      }
    } catch {
      // fall through to the CLI
    }
  }
  return listOpencodeSessions(1000).some((s) => s.id === id)
}

// The spawner session's current title — the identity half of the wake
// ladder's parent-pane guard (the host tool syncs the session title
// into the pane's terminal title, "OC | <title>"). Self-contained on
// purpose: session_v2 is the live table post-migration, legacy session
// froze at the migration; ask v2 first, then legacy. Unknown session
// or no title is a state, not an error: null, and the guard stands
// down.
export function opencodeSessionTitle(id: string): string | null {
  const db = opencodeReadDb()
  if (!db) return null
  try {
    for (const table of ["session_v2", "session"]) {
      try {
        const row = db.prepare(`SELECT title FROM ${table} WHERE id = ? LIMIT 1`).get(id) as { title?: string } | undefined
        if (typeof row?.title === "string" && row.title) return row.title
      } catch {
        /* table absent or has no title column — try the next */
      }
    }
  } catch {
    /* unreadable db — no title */
  }
  return null
}
