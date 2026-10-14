# Ticket 02 — WhiteHartLane rename: machine breakage audit + folder migration + publish prep

> Handoff for an agentic-os agent session. Work this ticket top-to-bottom.
> **Phase 0 is mandatory before any rename command runs.** Re-verify every finding at
> execution time — recon below was taken 2026-10-13 and may be stale by the time you run.

## Context

- Goal: rename `agentic-os` → **WhiteHartLane** and prepare the repo for public release
  (interview showcase). Name check 2026-10-13: `whitehartlane` has **0** GitHub repos and
  is free on npm; `agentic-os` has ~6.8k GitHub search hits, multiple literal-name repos
  (one is a competing multi-agent orchestrator for opencode), and the npm name is taken.
- Internal vocabulary (`spur` rail, `levy` wake, `whl` skill alias) already matches the
  WhiteHartLane theme — the rename makes the domain language coherent, not random.
- Three distinct migrations, in order:
  - **A. Machine-local folder rename** (this ticket's core):
    `~/projects/Agentic-Workspace/agentic-os` → `~/projects/Agentic-Workspace/whitehartlane`.
    Parent folder `Agentic-Workspace` is NOT renamed. Worktree branch folders
    (`master`, `spur-selbar-ui`, `wake-rung-debug`) keep their names (branch==folder).
  - **B. In-repo branding rename** (separate PR on a branch, after A lands).
  - **C. GitHub-side rename + public scrub** (after B merges).

---

## Phase 0 — breakage audit (DO FIRST, no renames yet)

⚠️ **Run this phase from OUTSIDE the folder** (e.g. `~/projects/Agentic-Workspace`).
If your session cwd is inside `agentic-os/`, the rename later will orphan your own shell.

Recon 2026-10-13 found these breakage surfaces. Re-verify each:

### 0.1 launchd job `agentic-os-window` — BREAKS (absolute path)

- Registry: `~/.config/autojobs/registry.json` `jobs[7]`, name `agentic-os-window`,
  label `local.agentic-os.window`.
- Plist `~/Library/LaunchAgents/local.agentic-os.window.plist` hardcodes:
  `ProgramArguments = node /Users/sagebot/projects/Agentic-Workspace/agentic-os/master/web/server.mjs`
  Log: `~/Library/Logs/agentic-os-window.launchd.log`. Env vars may include `AGENTIC_OS_DOOR`.
- Verify:
  ```bash
  autojobs show agentic-os-window
  grep -n "Agentic-Workspace/agentic-os" ~/Library/LaunchAgents/local.agentic-os.window.plist
  ```
- House rule (global AGENTS.md): control launchd ONLY via the `autojobs` CLI —
  never `launchctl bootstrap/bootout` directly. Editing the plist = `autojobs edit`.

### 0.2 Running server process — must restart through the job

- A node process (recon: PID 85618) serves `:8787` from `master/web/server.mjs`,
  started by launchd. After rename it keeps running off the old (now unlinked) inode —
  stale until restarted.
- Verify: `lsof -nP -iTCP:8787 -sTCP:LISTEN` and `ps aux | grep server.mjs | grep -v grep`.

### 0.3 herdr workspace + panes — BREAKS (absolute cwds)

- `~/.config/herdr/session.json`: `workspaces[0].identity_cwd` plus at least 3 pane
  `cwd` fields point into `.../Agentic-Workspace/agentic-os`. Rename leaves them dead.
- Verify: `grep -c "Agentic-Workspace/agentic-os" ~/.config/herdr/session.json`
- Fix must happen while herdr is NOT running (it rewrites session.json on exit).

### 0.4 gwt / `.bear` worktree pointers — BREAKS (absolute gitdirs, both directions)

- The bare repo lives INSIDE the renamed folder: `agentic-os/.bear`.
- Each worktree's `.git` file: `gitdir: /Users/.../agentic-os/.bear/worktrees/<branch>`
  (absolute). Each `.bear/worktrees/<b>/gitdir` points back (absolute). Folder rename
  breaks all 3 worktrees in both directions.
- Verify:
  ```bash
  cat ~/projects/Agentic-Workspace/agentic-os/master/.git
  ls ~/projects/Agentic-Workspace/agentic-os/.bear/worktrees/
  ```
- Fix: `git worktree repair` (run from inside a moved worktree, or once per worktree).

### 0.5 Cross-references — verified clean 2026-10-13, re-verify

- `~/.zshrc` / `~/.zprofile` / `~/.zshenv`: no references (grep to confirm).
- npm global: no `agentic-os` symlink under `/opt/homebrew/lib/node_modules/` (confirm).
- Sibling repos (`agentic-program`, `skill-evaluator`, `afk-home`): no path references
  (grep `Agentic-Workspace/agentic-os` to confirm).
- Known NON-blocking docs mention: `~/.config/opencode/skills/yyxSkills-prototype/slide-door/SKILL.md`
  mentions agentic-os — update wording later with the yyxSkills `whl` skill keyword pass.
- opencode sessions whose cwd is inside the folder will not resume cleanly — acceptable,
  note only.

### 0.6 Git remote — rename target exists

- `origin = git@github.com:yyx462/agentic-os.git` (private).
- GitHub-side rename happens in Phase C; old URLs redirect, but update with
  `git remote set-url` anyway once renamed.

### 0.7 Audit output required

End Phase 0 by writing the verified state (hit/miss per item) into this ticket as a
comment block — the Phase 1 fixes map 1:1 to these findings.

---

## Phase 1 — folder rename procedure (safe order, each step verifies)

1. `autojobs off agentic-os-window` — stop the :8787 server (registry entry stays).
2. Quit herdr; back up `~/.config/herdr/session.json` (cp to session.json.bak-<date>).
3. Confirm no process holds the folder open:
   `lsof +D ~/projects/Agentic-Workspace/agentic-os 2>/dev/null` — resolve or kill stragglers.
4. `mv ~/projects/Agentic-Workspace/agentic-os ~/projects/Agentic-Workspace/whitehartlane`
5. Repair git worktrees (from each worktree, or once from master):
   ```bash
   cd ~/projects/Agentic-Workspace/whitehartlane/master && git worktree repair
   git --git-dir=$HOME/projects/Agentic-Workspace/whitehartlane/.bear worktree list
   ```
   Expect 3 worktrees, all reachable. `git status` clean in each.
6. Run the `gwt` health/audit for this repo — branch==folder invariant intact.
7. Update the launchd path: `autojobs edit` the registry/plist script path to
   `/Users/sagebot/projects/Agentic-Workspace/whitehartlane/master/web/server.mjs`
   (keep job name `agentic-os-window` for now — renaming the job itself is Phase B
   follow-up, do it in the same edit if trivial). Then:
   `autojobs run agentic-os-window` → `curl -s localhost:8787/ | head` health check.
8. With herdr still stopped, rewrite `session.json` cwds
   (`Agentic-Workspace/agentic-os` → `Agentic-Workspace/whitehartlane`, incl.
   `identity_cwd`), restart herdr, open a pane to confirm cwd resolves.
9. Full re-verification sweep:
   ```bash
   grep -rn "Agentic-Workspace/agentic-os" ~/.config ~/Library/LaunchAgents 2>/dev/null | grep -v "\.log\|Cache"
   autojobs check
   ```

---

## Phase 2 — in-repo branding rename (branch PR, after Phase 1 is green)

- `package.json` `name` → `whitehartlane` (bin: none today — note for later).
- README: H1 `WhiteHartLane — deterministic supervisor for coding agents` on line 1
  (name + function in one breath). Keep the competitive-positioning section (interview
  asset). Add a "requires herdr" note near the top with availability status.
- ~60 files mention `agentic-os` (`grep -rl agentic-os --include='*.ts' --include='*.mjs'
  --include='*.md' --include='*.json' | grep -v node_modules`). Rename current-tense
  self-references; **do not rewrite ADR/zen history** — append a note instead.
- Env vars (`AGENTIC_OS_*`, door config — locate via repo-wide grep): decide
  rename→`WHL_*` with back-compat read of old names, or defer. Decide, document in ADR.
- Tests green before merge: `npm test`.

## Phase 3 — GitHub rename + publish prep (after Phase 2 merges)

1. Rename repo `yyx462/agentic-os` → `yyx462/whitehartlane`; `git remote set-url`.
2. Scrub BEFORE flipping visibility: secrets scan (API keys/tokens, e.g. gitleaks),
   company traces (NWi, 任拓, web01, client names), personal path leaks.
3. Repo description + topics: `llm-agents`, `multi-agent`, `orchestration`,
   `coding-agents`, `opencode`, `cli`.
4. Flip to public, pin on profile. Update `~/projects/job-seeking/profile.md`
   GitHub pin line (add whitehartlane next to sql-buddy / log-labor).

## Done criteria

- [x] Phase 0 audit table written into this ticket
- [x] Folder renamed; `git worktree list` ×2 clean (spur-selbar-ui / wake-rung-debug reaped pre-rename — see audit delta); `gwt` audit green (REMOVE=0 DIRTY=0 DRIFT=0)
- [x] `agentic-os-window` serving :8787 from the new path (PID 94940; `autojobs check` → all consistent)
- [x] herdr panes open into the new path — SELF-HEALED 2026-10-14: herdr re-persisted live state; identity_cwd + all pane cwds now `…/whitehartlane` (session.json:7,28,56); `herdr status`: server running, restart_needed no
- [x] Zero live references to the old folder path under `~/.config` and `~/Library/LaunchAgents` — full sweep clean 2026-10-14
- [ ] Phase 2 PR merged with tests green; Phase 3 checklist either done or ticketed forward

<!-- PHASE 0 AUDIT — verified 2026-10-13 by opencode session, run from ~/projects/Agentic-Workspace (outside the folder)

| # | Surface | Ticket claim | Verified at execution | Verdict |
|---|---------|-------------|----------------------|---------|
| 0.1 | launchd `agentic-os-window` | plist hardcodes abs path | plist:10 → `/Users/sagebot/projects/Agentic-Workspace/agentic-os/master/web/server.mjs`; ALSO `~/.config/autojobs/registry.json:124` `script` field carries the same path — `autojobs edit` must fix BOTH | HIT — breaks |
| 0.2 | :8787 server process | node serves from master/web/server.mjs | PID 85618, `*:8787 LISTEN`, started Mon 10AM from old path — stale after rename until job restart | HIT — restart via job |
| 0.3 | herdr session.json | identity_cwd + ≥3 pane cwds | 3 matches (lines 7 `identity_cwd`, 36 + 39 pane `cwd`). herdr IS RUNNING (PID 13030) **with a remote mosh client attached** (`herdr --session default`, PIDs 73929/73930) — the quit must include the remote client | HIT — fix only while herdr fully down |
| 0.4 | .bear worktree pointers | 3 worktrees, abs gitdirs both directions | **DELTA: 2 worktrees, not 3** — `master` (a19723f) + `herdr-brownout` (b118a3e, clean); `spur-selbar-ui` / `wake-rung-debug` reaped since recon. `master/.git` → `gitdir: …/agentic-os/.bear/worktrees/master` (absolute) — breaks both directions; `git worktree repair` fixes | HIT — 2 worktrees to repair |
| 0.5a | zsh dotfiles | no refs | grep clean | clean ✓ |
| 0.5b | npm global | no symlink | `/opt/homebrew/lib/node_modules` clean | clean ✓ |
| 0.5c | sibling repos | no path refs | agentic-program / skill-evaluator clean; `afk-home` does not exist on this machine (non-issue) | clean ✓ |
| 0.5d | known doc mention | slide-door SKILL.md | confirmed, line 24 (`structure/agentic-os-dag` path example) — non-blocking, yyxSkills `whl` keyword pass | non-blocking ✓ |
| 0.6 | git remote | origin = git@github.com:yyx462/agentic-os.git, private | confirmed via `git remote -v` + `gh repo view` → PRIVATE; gh auth working (needed for Phase 3) | confirmed |
| 0.7 | name availability | whitehartlane: 0 GH repos, npm free | GitHub search `whitehartlane` → total_count 0 ✓; npm registry → 404 (free) ✓. NB: one dead hyphenated repo `FajarSanjay/White-Hart-Lane` (empty, 2017, 0 stars) — no collision with the one-word name | still valid ✓ |

Full-config sweep (Phase-1 step-9 baseline, run now): `grep -rn "Agentic-Workspace/agentic-os" ~/.config ~/Library/LaunchAgents` (log/cache excluded) → exactly 3 live surfaces: `registry.json:124`, `herdr/session.json:7/36/39`, window `plist:10`. Nothing else.

NEW findings since recon (affect Phase 1 execution):

1. **This agent session runs INSIDE herdr** (HERDR_ENV=1; parent opencode PID 33432 holds FDs in the folder). Quitting herdr mid-flight kills the executing agent — Phase 1 step 2 (quit herdr) CANNOT run from this session. Split: agent does steps 1, 3–7; the herdr quit + session.json rewrite (steps 2, 8) runs from a plain Terminal outside herdr.
2. Folder holders (`lsof +D`): all cwd-only — opencode ×3 (16125, 33432, 33531), zsh ×2, node/z_ai mcp-server ×6, python ×3. macOS rename keeps cwd vnodes valid → no kills required. The :8787 node (85618) is not a cwd holder; it is stopped separately via `autojobs off`.
3. master worktree carries ONE untracked file: `docs/tickets/02-whitehartlane-rename.md` (this ticket — drafted, never committed).
4. `herdr-brownout` worktree: clean at b118a3e — safe through the rename.

Fix mapping (1:1): plist+registry path swap (`autojobs edit`) → 0.1; `autojobs run` restart → 0.2; herdr session.json rewrite while down → 0.3; `git worktree repair` ×2 → 0.4; nothing to do for 0.5; `remote set-url` deferred to Phase C per ticket.
-->

<!-- PHASE 1 EXECUTION LOG — agent half (steps 1,3–7) done 2026-10-13, same session, from ~/projects/Agentic-Workspace

Landed, in order:
1. Ticket + audit committed to master BEFORE the mv (c2ebc39, pushed) — was untracked.
2. `autojobs off agentic-os-window` → :8787 freed. NOTE for future bounce procedures: after `off`,
   revive with `autojobs on` — `autojobs run` REFUSES for KeepAlive daemons ("restart via its own
   tooling"). Ticket step 7 assumed `run`; wrong for this job kind.
3. `mv agentic-os whitehartlane` — zero holder kills needed (all cwd/read-FD only, vnodes followed).
4. Worktree repair DELTA: `git worktree repair` from INSIDE a moved worktree cannot even bootstrap
   (`fatal: not a git repository: …/agentic-os/.bear/worktrees/master` — the .git file points at the
   old path). What worked — from the BARE side, naming each worktree:
     git --git-dir=<new>/.bear worktree repair <new>/master <new>/herdr-brownout
   → both gitdir files reported incorrect and fixed; `worktree list` shows 2 worktrees at new paths.
5. `gwt audit` green: count 2, REMOVE=0 DIRTY=0 UNTRACKED=0 UNIQUE=1 (herdr-brownout) DRIFT=0, master PINNED.
6. Path swap via surgical sed `Agentic-Workspace/agentic-os/` → `Agentic-Workspace/whitehartlane/`
   (trailing slash — left the registry's prose "agentic-os gwt master worktree" untouched) on BOTH
   plist:10 and registry.json:124. Backups: $TMPDIR/opencode/{plist,registry.json}.bak-20261013-*.
   Pre-edit check: NO AGENTIC_OS_* env vars exist in the plist — recon's "may include AGENTIC_OS_DOOR"
   was wrong (door logic lives in server.mjs fallbacks, not launchd env). Narrows the Phase 2 env-var
   decision to in-repo env only.
7. `autojobs on agentic-os-window` → node PID 94940 serving :8787 from the NEW path
   (`ps` + `curl localhost:8787` HTML 200). `autojobs check` → "all consistent".
8. Agent session re-rooted to the new folder via opencode session_move — this session survived.

Job NAME deliberately kept `agentic-os-window` (+ label + plist filename + log name): a real rename
means new plist file + label + registry entry, not seddable — Phase B, as the ticket's primary
instruction already said.

REMAINING (human tail, steps 2+8): wizard script at ~/projects/Agentic-Workspace/whl-herdr-fix.sh —
quit herdr (incl. remote mosh client; this agent session dies with it), run the wizard in a plain
Terminal (backs up session.json, rewrites the 3 cwds, final sweep), restart herdr, open a pane.

The wizard (embedded so it survives the scratch file):

    #!/usr/bin/env bash
    # whl-herdr-fix.sh — ticket 02 Phase 1 steps 2+8 (herdr tail). Run AFTER the
    # agent session inside herdr has ended, in a plain Terminal. Idempotent.
    set -euo pipefail
    OLD="Agentic-Workspace/agentic-os"; NEW="Agentic-Workspace/whitehartlane"
    SJ="$HOME/.config/herdr/session.json"
    [ -d "$HOME/projects/$NEW" ] || { echo "folder $NEW missing — was the rename done?"; exit 1; }
    LEFT=$(pgrep -fl herdr | grep -v -e mcp-server -e whl-herdr-fix || true)
    [ -z "$LEFT" ] || { echo "herdr still running — quit it (incl. remote client; pkill -f remote-client-bridge for lingering bridges), then re-run:"; echo "$LEFT"; exit 1; }
    BAK="$SJ.bak-$(date +%Y%m%d-%H%M%S)"; cp "$SJ" "$BAK"; echo "backup: $BAK"
    sed -i '' "s|$OLD|$NEW|g" "$SJ"
    echo "remaining old refs (expect 0): $(grep -c "$OLD" "$SJ" || true)"
    grep -n "$NEW" "$SJ"
    SWEEP=$(grep -rn "$OLD" ~/.config ~/Library/LaunchAgents 2>/dev/null | grep -v "\.log\|Cache" || true)
    [ -n "$SWEEP" ] && { echo "STILL REFERENCED:"; echo "$SWEEP"; } || echo "sweep clean"
    echo "Done. Start herdr, open a pane, confirm cwd resolves under $NEW."
-->

<!-- PHASE 2 EXECUTION LOG — 2026-10-14, branch whl-branding

In-repo branding rename executed on the whl-branding worktree (gwt lane):

- bin/agentic-os → bin/whitehartlane (git mv); bin/whl shim + web/server.mjs
  resolve the new door; window UI title/wordmark/theme-key rebranded.
- OS disk default → ~/.local/share/whitehartlane with legacy agentic-os disk
  honored while it is the only one (store.ts, project.ts, server.mjs — the ADR
  0009 read-both-write-new pattern). Global manifest: .config/whitehartlane
  preferred, .config/agentic-os still honored (hooks.ts + both covered by tests).
- README: H1 per ticket, "formerly agentic-os" note, prose WhiteHartLane /
  commands whitehartlane. Living docs renamed (CONTEXT, GOAL, RAILS, PRDs,
  research incl. agent-glossary.html, yyx-whl skill). History frozen: ADRs,
  zen, tickets, examples untouched. AGENTS.md untouched (its mentions are the
  still-live launchd label).
- package.json name → whitehartlane; SHEP_SCOPE label → whl-test; lock
  regenerated. 322/322 tests green.
- DEFERRED to ticket 03 (see ADR 0011): AGENTIC_OS_* env prefix (36 vars, some
  dynamically constructed), customType tags, launchd job rename (machine-local).

Machine-local follow-ups AFTER this PR merges:
1. `ln -sf ~/projects/Agentic-Workspace/whitehartlane/master/bin/whitehartlane ~/.local/bin/whitehartlane`
   (the old ~/.local/bin/agentic-os symlink has been DANGLING since the Phase 1
   folder rename — remove it; ~/.local/bin/whl already points correctly).
2. Bounce the window server (server.mjs changed): `autojobs on agentic-os-window`
   (or `launchctl kickstart -k gui/$(id -u)/local.agentic-os.window`), then
   curl localhost:8787 — expect the whitehartlane wordmark + existing sessions
   still listed (legacy disk fallback).
3. Optional later: launchd job rename (new plist + label + registry entry), and
   `mv ~/.local/share/agentic-os ~/.local/share/whitehartlane` when convenient
   (fallback makes it safe either way).
-->

<!-- PHASE 2 MACHINE TAIL — done 2026-10-14, after PR #111 merged (master e202939)

- Reaped merged worktrees (whl-branding, eval-research): project = PINNED master
  only, all gwt tallies zero.
- CLI naming decision: `whl` is THE command (`~/.local/bin/whl` — already
  pointed at master/bin/whl, verified end-to-end: `whl jobs` lists every
  historical job from the legacy agentic-os disk via the ADR 0011 fallback).
  The long `~/.local/bin/whitehartlane` symlink was NOT created — canonical
  door stays bin/whitehartlane (what the window server spawns); dangling
  ~/.local/bin/agentic-os removed. Follow-up idea: README could lead its
  examples with `whl run` instead of `whitehartlane run`.
- Window server bounced (autojobs off→on): PID 28558, wordmark whitehartlane,
  log line "whitehartlane window server up" with os disk resolving to the
  legacy ~/.local/share/agentic-os — all sessions intact.
- master clean (no server.log churn at commit time).
-->



<!-- PHASE 1 CLOSURE — 2026-10-14: herdr tail SELF-HEALED, wizard obsolete

Overnight herdr rewrote session.json from its LIVE state, and the live state was already correct:
pane-shell cwds are vnode-backed and followed the folder rename (macOS getcwd() returns the new
path), so the rewrite-from-memory behavior — the enemy in yesterday's plan — wrote the NEW paths
for us (session.json:7 identity_cwd, :28/:56 pane cwds; the ~/.config/nvim pane was never
path-coupled to this repo). Full ~/.config + ~/Library/LaunchAgents sweep: zero live old-path
references. `herdr status`: server running v0.9.1, restart_needed no.

The quit-herdr + whl-herdr-fix.sh wizard is therefore OBSOLETE — script left at
~/projects/Agentic-Workspace/whl-herdr-fix.sh, safe to delete (content preserved above).
For the record, the clean shutdown path would have been `herdr server stop` (official API-socket
stop), not pkill.

Design note (ADR-worthy, inverts yesterday's lesson): herdr's memory-is-truth design only bites
when its in-memory state is stale. Here the kernel's inode-stable cwds kept the memory fresh, so
the dump self-corrected. The failure mode yesterday's plan guarded against (stale rewrite
clobbering a fix) never fires when the live state is right — the fix and the memory converged.
-->

