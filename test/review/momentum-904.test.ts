// momentum-904 — the parent resolution must not bind a session it could
// only see PART of.
//
// src/doors/ship-supervisor.ts:90-97 states the tier's law:
//
//   "COWORKER LAW (momentum-1, sharpened round 5): 'newest' is NEVER
//    identity — the commissioner's own long turn looks quiet while a
//    sibling ticks, so recency guesses the wrong owner exactly when it
//    matters. Tier 2 binds ONLY by uniqueness: exactly ONE session in
//    the project — no siblings to confuse, no ordering to trust.
//    Two or more candidates, fresh or stale → null → the supervisor
//    (a minted owner beats a guessed one, always)."
//
// The code fetches a WINDOW, not the project's sessions:
//   src/doors/ship-supervisor.ts:122 —
//   runJson(ocBin, ["session", "list", "--format", "json", "-n", "5"], cwd)
// i.e. the five NEWEST sessions. With six or more sessions in the
// project the window HIDES the rest, so "exactly ONE session in the
// project" is decided over a truncated set — recency by the back door.
//
// The concrete harm (the wrong-owner wake this tier exists to prevent):
// the commissioner is mid-long-turn (its `updated` ticks per TURN, so it
// looks OLD), a sibling session in the same project ticks recently. The
// window carries the sibling, not the commissioner → one candidate under
// the cwd → the door binds the SIBLING as the parent — the wake (and
// therefore the verdict) goes to the wrong session, and the commissioner's
// PR is reviewed with nobody hearing the result.
//
// The repro drives resolveCaller with a project that has SIX sessions
// (the stub honours the requested -n and returns the newest five), where
// the only one under the cwd is the recent sibling. A truncated list
// cannot prove uniqueness → the tier must refuse (mint the supervisor).
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist there — so
// on BASE this test passes.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)

test("a truncated session list must not be read as the project's ONLY session", async () => {
  const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
  if (!supervisor) return // BASE shape: no parent resolution at all

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom904-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "wt-x"), { recursive: true })
  const now = 1793339266367

  const stub = (name: string, body: string): string => {
    const p = join(tmp, name)
    writeFileSync(p, body)
    chmodSync(p, 0o755)
    return p
  }
  const herdr = stub("herdr", `#!/bin/sh\ncat <<'EOF'\n{"result":{"agent":{"agent":"opencode"}}}\nEOF\n`)

  // SIX sessions in the project, most recent first; the stub honours the
  // -n the door asks for and returns the NEWEST N — the sixth (the
  // commissioner's own long turn, quiet) falls outside the window.
  const all = [
    { id: "ses_sibling", directory: repo, updated: now },
    { id: "ses_new2", directory: join(repo, "other"), updated: now - 1 },
    { id: "ses_new3", directory: join(repo, "other"), updated: now - 2 },
    { id: "ses_new4", directory: join(repo, "other"), updated: now - 3 },
    { id: "ses_new5", directory: join(repo, "other"), updated: now - 4 },
    { id: "ses_commissioner", directory: repo, updated: now - 60 * 60 * 1000 },
  ]
  all.forEach((s, i) => writeFileSync(join(tmp, `s${i}.json`), JSON.stringify(s)))
  const files = all.map((_, i) => join(tmp, `s${i}.json`)).join(" ")
  const oc = stub(
    "opencode",
    `#!/bin/sh
n=5
while [ $# -gt 0 ]; do
  if [ "$1" = "-n" ]; then n="$2"; shift 2; continue; fi
  shift
done
printf '['
first=1
i=0
for f in ${files}; do
  i=$((i+1))
  if [ "$i" -gt "$n" ]; then break; fi
  if [ "$first" = 1 ]; then first=0; else printf ','; fi
  cat "$f"
done
printf ']'
`,
  )

  const env = { HERDR_ENV: "1", HERDR_PANE_ID: "wK:pSV", WHL_HERDR_BIN: herdr, WHL_OPENCODE_BIN: oc }
  const caller = supervisor.resolveCaller(join(repo, "wt-x"), { env, now: now + 30_000 })
  assert.equal(
    caller,
    null,
    `a session list that came back at the requested cap (${all.length} sessions in the project, the door asked for 5) cannot prove the project's ONLY session — the hidden one may be the commissioner; a guessed parent is the wrong-owner wake this tier exists to prevent`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
