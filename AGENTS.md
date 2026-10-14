<!-- yyx:repo-layout v2 -->
- Tickets live on this repo's git tracker (GitHub/Gitea issues) when it has one; `docs/tickets/` files (`NN-slug.md`) only as the no-tracker fallback. One home per ticket — never both.
- Plan pages live in `docs/plans/` — one-shot, regenerated, never status.
- ADRs in `docs/adr/`; glossary in root `CONTEXT.md`.
Shapes: see yyxSkills `docs/agents/repo-layout.md`.
<!-- /yyx:repo-layout -->

<!-- window server: verifying UI changes on :8787 after a merge — static
     assets (app.js/style.css) refresh on browser reload, but server.mjs
     runs in the launchd daemon's memory: bounce it with
     `launchctl kickstart -k gui/$(id -u)/local.agentic-os.window`
     (details: autojobs show agentic-os-window) before concluding a
     server-side fix "didn't land". -->

<!-- gwt worktrees: a spawned worktree is a fresh checkout with no
     node_modules — run `npm install` INSIDE the worktree before
     npm test (symptom: the whole suite dies with ERR_MODULE_NOT_FOUND
     smol-toml). Never at the project root: a stray root
     package-lock.json/node_modules breaks `gwt verify`
     ("root entry 'package-lock.json' is not a registered worktree"). -->

<!-- commit identity: history carries exactly TWO authors — the human
     (yyx <52618739+yyx462@users.noreply.github.com>) and the agent
     (agent <agent@local>). Never invent a third; never inherit the
     machine's global git identity.
     - On the origin machine, .bear/config already defaults worktrees to
       agent <agent@local> — agents just commit normally there.
     - Anywhere else (fresh clone, CI, another machine): set it first —
         git config user.name agent && git config user.email agent@local
       — or pass it per commit:
         git -c user.name=agent -c user.email=agent@local commit ...
     - The human commits as yyx <52618739+yyx462@users.noreply.github.com>
       (web merges do this automatically). A pre-commit hook in .bear
       rejects any other identity on the origin machine; keep that hook
       in place when the bare repo is rebuilt. -->
