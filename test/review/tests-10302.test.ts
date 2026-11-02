// tests-10302 (tests lens) — THE HARNESS-TREE RUNG GRANTS A PATH THAT
// LEAVES THE HARNESS TREE — the diff's own new permission rung matches
// the ask as TEXT, so a `..` segment walks straight out of the tree the
// rung claims to describe.
//
// WHAT THE CHANGE CLAIMS (src/core/permission.ts, the rung this diff
// adds — the diff hunk is `@@ -311,6 +311,31 @@`):
//
//   // THE HARNESS-TREE RUNG (the r12/r14/r15 receipts, 2026-11-01): ...
//   // The harness's own tree is not user territory: an ask under
//   // AGENTIC_OS_HOME, or an ancestor of the Job's own roots inside
//   // dirname(AGENTIC_OS_HOME), is allowed without the judge. Outside
//   // that bound (an ask for ~ itself, ~/Library, any user tree) the
//   // gray zone keeps its judge.
//
//   const harnessHome = process.env.AGENTIC_OS_HOME ?? ""
//   const harnessTree = harnessHome ? resolve(harnessHome, "..") : ""
//   if (
//     (harnessHome && under(path, harnessHome)) ||
//     (harnessTree && under(path, harnessTree) && allowedRoots.some((root) => under(root, path)))
//   ) {
//     return { decision: "allow", path, message: `granted: ${path} is the harness's own tree ...` }
//   }
//
// THE BOUND IS THE POINT OF THE RUNG — and the repo's OWN test for it
// (test/permission.test.ts, "THE ANCESTOR RUNG", added by this same
// diff) says so:
//
//   // the BOUND holds: an ask for the home itself (or anything outside
//   // the harness tree) is still the gray zone — the ancestor rung
//   // must not become a coarse-reads hole
//
// It proves the bound for exactly TWO forms (`/Users/me` and
// `/Users/me/Library`) — both of which are spelled WITHOUT a traversal
// segment. The predicate that answers the bound is a TEXT test:
//
//   const under = (path: string, root: string): boolean => {
//     const r = root.endsWith("/") ? root.slice(0, -1) : root
//     return path === r || path.startsWith(`${r}/`)
//   }
//
// and the path it tests is the dialog's raw ask, normalized only for
// `~`, cwd-relative and the underscore-mangled home prefix
// (normalizeDialogPath, src/core/permission.ts:235-254) — NEVER
// resolved. So an ask that READS as "inside the harness tree" but
// RESOLVES outside it passes the rung and is granted FLAT (no judge,
// no escalation, no gray zone):
//
//   /Users/me/.local/share/agentic-os/../../../../../etc/passwd
//     reads as  under AGENTIC_OS_HOME   -> the rung fires
//     resolves to /etc/passwd          -> outside the harness tree
//
// The grant is the harm: the rail hands the worker a path the OS will
// resolve to user territory, and the gray zone's judge — the only
// thing that could say "this worker does not need /etc/passwd" — never
// sees the ask. The rung's own message even certifies the false claim:
// "granted: ... is the harness's own tree".
//
// BASE behaviour: BASE has no harness rung at all (no AGENTIC_OS_HOME
// in BASE's src/core/permission.ts), so the same ask falls to the gray
// zone and — with no judge — is refused ("deny-unneeded"). The test
// PASSES on BASE and FAILS on HEAD: the change introduced the hole.
import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"
import { decidePermission, declareScope } from "../../src/core/permission.ts"

const HARNESS_HOME = "/Users/me/.local/share/agentic-os"
const PANE = "/Users/me/.local/share/agentic-os/sessions/s-1/jobs/j-1/run/units/principles"

test("tests-10302: the harness-tree rung must not grant a path that RESOLVES outside the harness tree", () => {
  const prev = process.env.AGENTIC_OS_HOME
  process.env.AGENTIC_OS_HOME = HARNESS_HOME
  try {
    // the pane's own scope: the job dir only (the shape the rail spawns)
    const scope = declareScope([PANE])

    // the escaping ask: it READS as the harness's own tree, and
    // RESOLVES to /etc/passwd
    const ask = `${HARNESS_HOME}/../../../../../etc/passwd`
    assert.equal(resolve(ask), "/etc/passwd", "the ask must really escape the tree")

    const v = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${ask}`,
      scope,
      home: "/Users/me/",
      cwd: PANE,
    })
    assert.notEqual(
      v.decision,
      "allow",
      `the ask resolves OUTSIDE the harness tree but was granted: ${v.message}`,
    )
    assert.doesNotMatch(
      v.message,
      /harness's own tree/,
      `the rung certified a false claim about the path: ${v.message}`,
    )

    // the SECOND escaping form — the ancestor clause of the same rung
    // (harnessTree = dirname(AGENTIC_OS_HOME)): an ask under
    // ~/.local/share that walks out of it
    const ancestor = "/Users/me/.local/share/../../../../etc/hosts"
    assert.equal(resolve(ancestor), "/etc/hosts", "the ancestor ask must really escape")
    const a = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${ancestor}`,
      scope,
      home: "/Users/me/",
      cwd: PANE,
    })
    assert.notEqual(
      a.decision,
      "allow",
      `the ancestor ask resolves OUTSIDE the harness tree but was granted: ${a.message}`,
    )
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prev
  }
})
