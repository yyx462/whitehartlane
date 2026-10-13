<!-- yyx:repo-layout v1 -->
- Tickets live in `docs/tickets/` (to-tickets + wayfinder shapes).
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
