<!-- yyx:repo-layout v2 -->
- Tickets live on this repo's git tracker (GitHub/Gitea issues) when it has one; `docs/tickets/` files (`NN-slug.md`) only as the no-tracker fallback. One home per ticket — never both.
- Plan pages live in `docs/plans/` — one-shot, regenerated, never status.
- ADRs in `docs/adr/`; glossary in root `CONTEXT.md`.
Shapes: see yyxSkills `docs/agents/repo-layout.md`.
<!-- /yyx:repo-layout -->

<!-- momentum (product direction — read before designing anything) -->
The PRD at `docs/prd/OPTIMUM.md` is the momentum vector: refit from ALL
merged PRs, regenerated whole, never appended. Hard invariants it found:
programs are data ([[stage]] chains; refusal beats silence); minds are
delegated, fresh, briefed from one source; ordering is the chain, never
brief text; verdicts are honest (check=judge, run=act, grade=bind,
signal/end=observe; infra ≠ answer); one wake per commission; the
window only views; a mind's pin = its nearest declaration. When fixing:
replace the worst DESIGN (highest reversal-count component), never
patch inside it. Do not fight the momentum without writing down why in
the PRD first.
<!-- /momentum -->

<!-- project-meta: zens are the decision inbox. A design session is not
finished until its rulings exist as a zen entry (distilled by the
yyx-project-meta skill); the refit consumes every zen newer than the
last refit. Newest: docs/zen/2026-10-25-zen-7.md. Manifest + checkpoint:
meta.toml. -->

<!-- agent-api: coding-agent and herdr state comes from API fields
     (OpenCode message error.type / finish, herdr agent_status). Never
     scrape pane screen text or TUI chrome for control flow. -->

<!-- window server: verifying UI changes on :8787 after a merge — static
     assets (app.js/style.css) refresh on browser reload, but server.mjs
     runs in the launchd daemon's memory: bounce it with
     `launchctl kickstart -k gui/$(id -u)/local.agentic-os.window`
     (details: autojobs show agentic-os-window) before concluding a
     server-side fix "didn't land". -->

<!-- whl-driving: any command that DRIVES whl (run/review, the e2e
     battery, the pr-review drill) from an agent session runs in the
     harness's TRACKED background shell, so the finish wakes the agent
     that launched it — never nohup/`&` detached, where nobody hears
     the end. Receipt: c1 drill round 3 (2026-10-26) — a nohup'd run
     finished failing and the session sat idle for the rest of the
     turn. This is the operator-side twin of the door's --from law: a
     Job nobody hears finishing is an information gap, and so is a
     whl-driving command you cannot hear. -->

<!-- gwt worktrees: a spawned worktree is a fresh checkout with no
     node_modules — run `npm install` INSIDE the worktree before
     npm test (symptom: the whole suite dies with ERR_MODULE_NOT_FOUND
     smol-toml). Never at the project root: a stray root
     package-lock.json/node_modules breaks `gwt verify`
     ("root entry 'package-lock.json' is not a registered worktree"). -->

<!-- commit identity: history carries exactly TWO authors, both under the
     owner's GitHub noreply email — attribution is email-only on GitHub,
     and the plus-tag form does NOT attribute (probe-tested 2026-10-14):
       human:  yyx         <52618739+yyx462@users.noreply.github.com>
       agent:  yyx462-agent <52618739+yyx462@users.noreply.github.com>
     Never invent a third; never inherit a machine's global git identity.
     - On the origin machine, .bear/config defaults worktrees to the agent
       identity — agents just commit normally there. A human hand-committing
       here overrides with:
         git -c user.name=yyx -c user.email=52618739+yyx462@users.noreply.github.com commit ...
     - Anywhere else (fresh clone, CI, another machine): set it first —
         git config user.name yyx462-agent
         git config user.email 52618739+yyx462@users.noreply.github.com
     - A pre-commit hook in .bear enforces the email allowlist on the
       origin machine; keep it in place when the bare repo is rebuilt. -->

## the fixer's laws (the review loop's autopsies, 2026-11-02)

Written after r22's autopsy — a 240-line fix push carried six real
bugs, and the receipts named the habits that would have caught each.

- **VERIFY THE DELIVERY.** When a change hands a value from one
  program to another, run the RECEIVER and read what it actually got
  before pushing. Two green seat-tests with a broken seam between
  them shipped the r22 export bug. The reviewers' repro ran the
  receiver; the fixer's did not.
- **EVERY DOOR.** Before installing a guard, list every path the
  guarded behavior can take. One arm guarded and one open is a
  shipped bug, not a partial success (r22: the chain check guarded
  one merge arm).
- **WHO ELSE READS THIS.** Before changing what a file or list
  MEANS, name every consumer. A record book mistaken for reading
  material demoted still-unfixed findings to "pre-existing" (r22:
  the fix classifier's file list).
- **SIDE-NOTES ARE TRIAGED, NEVER DROPPED.** Every advisory is either
  fixed or written off in the commit message with a reason. An
  advisory silently ignored returns next round as a blocked finding
  (r21's advisory questions-41 returned as r22's momentum-2102).
- **THE FIXER IS THE FINAL DECISION MAKER.** Reviewer complaints can
  be REJECTED — answer each rejected finding with a one-line why,
  recorded on the PR and in the ledger (the overrule door). Two
  rounds giving opposite orders is not a puzzle to satisfy
  simultaneously: pick the sounder law, reject the other, and say
  why (r21's momentum-2101 × r22's tests-30001 — the discriminator
  was the verdict's value; the synthesis took a round that a
  recorded rejection would have taken a line).
- **WHY ARE WE NOT CONVERGING?** When the rail asks (three or more
  rounds, stop criterion not holding), the answer must change the
  MECHANISM — append a law here, edit the lens briefs, fix the gate.
  A finding-fix alone does not answer it. The lenses read this file:
  a law appended here is read back by the reviewers next round.
