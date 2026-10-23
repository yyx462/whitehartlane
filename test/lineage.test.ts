import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// The lineage rules (the Airflow dag_id uniqueness, scoped to what
// agents can actually enforce): one session per (scope_root, spur_id).
// The scope is the commissioning git worktree — so the fixtures below
// are REAL git repos, exactly the shape agent worktrees have. The same
// spur in two worktree copies is TWO sessions, never an error; two
// program dirs wearing one spur_id inside ONE worktree is the only
// refusal; and outside any git repo a program dir is its own scope.
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-lineage-"))

const { findSessionBySpur } = await import("../src/adapters/store.ts")
const { resolveLineageSession } = await import("../src/doors/run.ts")
const { scopeRootOf, validateSpurId } = await import("../src/doors/project.ts")

const root = mkdtempSync(join(tmpdir(), "whl-scope-"))
const wtA = join(root, "wt-alpha", "state", "prog-a")
const wtB = join(root, "wt-beta", "state", "prog-a")
const otherDir = join(root, "wt-alpha", "state", "other-dir")
for (const d of [wtA, wtB, otherDir]) mkdirSync(d, { recursive: true })
// the worktrees are worktrees: git answers --show-toplevel for them
for (const wt of [join(root, "wt-alpha"), join(root, "wt-beta")]) {
  execFileSync("git", ["init", "-q", wt])
}
const SPUR = "rsi-loop-v2-iter6"

test("case 1 — the same spur in two worktree copies: two sessions, no refusal", () => {
  const a = resolveLineageSession(wtA, SPUR)
  const b = resolveLineageSession(wtB, SPUR)
  assert.ok("session" in a && "session" in b)
  assert.notEqual(a.session.id, b.session.id, "each worktree scope gets its own lineage session")
  assert.equal(a.session.spur_key?.rel_source, "state/prog-a")
  assert.equal(b.session.spur_key?.rel_source, "state/prog-a", "copies share the relative spelling — that is the point")
  assert.notEqual(a.session.spur_key?.scope_root, b.session.spur_key?.scope_root)
})

test("case 2 — re-run in place: the SAME session comes back", () => {
  const first = resolveLineageSession(wtA, SPUR)
  const again = resolveLineageSession(wtA, SPUR)
  assert.ok("session" in first && "session" in again)
  assert.equal(first.session.id, again.session.id)
})

test("case 3 — two dirs, one spur_id, one worktree: REFUSED, both paths named", () => {
  const clash = resolveLineageSession(otherDir, SPUR)
  assert.ok("refuse" in clash, "the collision is refused")
  assert.match(clash.refuse, /rsi-loop-v2-iter6/)
  assert.match(clash.refuse, /prog-a/, "the existing claim is named")
  assert.match(clash.refuse, /other-dir/, "the challenger is named")
})

test("case 4 — the host binding adopts a pre-lineage session instead of forking it", async () => {
  const { openSession, findSessionByHost } = await import("../src/adapters/store.ts")
  const adopted = openSession({ cwd: wtA, host: { tool: "whitehartlane", session_id: wtA } })
  // a fresh AGENTIC_OS_HOME simulates a pre-lineage disk: re-resolving
  // the same dir finds the host-bound session and stamps it
  const resolved = resolveLineageSession(wtA, SPUR)
  assert.ok("session" in resolved)
  assert.equal(resolved.session.id, adopted.id, "continuity: no fork on upgrade")
  assert.equal(resolved.session.spur_key?.spur_id, SPUR, "adopted AND stamped")
  assert.ok(findSessionByHost("whitehartlane", wtA))
})

test("the scope root: a git worktree's toplevel, a bare dir its own scope", () => {
  assert.equal(scopeRootOf(wtA), realpathSync(join(root, "wt-alpha")), "git answers the worktree top")
  const loose = mkdtempSync(join(tmpdir(), "whl-loose-"))
  assert.equal(scopeRootOf(loose), realpathSync(loose), "outside git, the dir is its own scope — copies never collide")
})

test("spur_id grammar: refuse what cannot be keyed or grepped", () => {
  assert.equal(validateSpurId("rsi-loop-v2-iter6"), null)
  assert.equal(validateSpurId("spur-1a2b3c4d"), null)
  assert.ok(validateSpurId("My Spur") !== null, "spaces and case refused")
  assert.ok(validateSpurId("-leading-dash") !== null, "leading dash refused")
  assert.ok(validateSpurId("a".repeat(65)) !== null, "over-long refused")
})
