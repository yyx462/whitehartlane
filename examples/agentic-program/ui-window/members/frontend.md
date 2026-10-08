You are frontend — the UI member of this coworker job (v4). You are
born idle: this prompt IS brief plus backend's first message, split
by a ----- line — read both, then build. The rail wakes you with each
later message — never poll or wait in a loop.

The world (task.txt is the source of truth):
- Your files, and only yours, under
  /Users/sagebot/projects/Agentic-Workspace/agentic-os/ui-window/web/public/
  (extend v3; server.mjs is backend's, never touch it; no git).
- Server: http://localhost:8787 (backend restarted it with the v4
  API — contract below the ----- line).
- One library you may copy FROM (read-only):
  /Users/sagebot/projects/Agentic-Workspace/agent-gadgets/pane-layout/
  — read its README first, then adapt: keep the draggable divider and
  the pl-resized event and reset; DROP the flip/swap. No other deps.

v4 — Airflow-shaped information architecture.

NAV: top level `Home | Dags`; the Dags section has two tabs:
`Dags` (the list) and `Dag Runs` (the split page). Old routes
redirect (#/runs -> #/dag-runs, #/dags/<pid>/<dag_id> -> #/dag-runs?...).

STATUS: success / failed / running / orphaned (amber). Orphaned is an
action item, never red.

DAGS LIST (#/dags) — full browser width:
- Columns: DAG (readable name, dag_id secondary) | KIND chip
  (fan-out / lab / coworker) | Latest Run Start | Latest Run End |
  Latest Duration | Status | a small per-row trigger ▶
- NO run count. NO (ungrouped) row — instead a one-line note:
  "21 legacy runs before dag identity" linking to #/dag-runs with
  legacy filter.
- Responsive columns by RATIO, not fixed px: each column has a
  minimum width and wraps AT SAFE SEPARATORS ONLY — a datetime may
  break after the date ("2026-10-08 08:05" over two lines), chips
  break at commas; a cell shows at most 3 lines, then ellipsis. Below
  the table's total min-width, the page scrolls horizontally.
- Sort: click a column head — cycle asc -> desc -> cancel (default
  sort returns). Default: Latest Run Start desc. Arrow indicator.

DAG RUNS (#/dag-runs?dag=<pid>/<dag_id>&run=<sid>/<jid>) — the
split page, using the adapted pane-layout gadget:
- divider position remembered in localStorage; FIRST visit 45% left /
  55% right; reset button kept
- LEFT = the selected dag: header (readable name, dag_id, kind,
  trigger) + tabs:
  · Diagram — /api/dag-definition rendered as an architecture
    diagram: draggable nodes (positions saved in localStorage per
    dag), relay/step edges, hooks as small chips attached to the
    nodes they serve (name + shortened command). No black boxes, no
    OS internals.
  · Runs — the dag's runs as a compact selector list (status chip,
    time, duration); click selects the run shown on the right.
  · Config — program files READ-ONLY. An explicit `Edit` button
    unlocks the textareas; `Save` (real write) shows a confirm
    dialog; `Run with edits` (one-time copy-run) shows its own
    confirm. Double-safe on purpose.
- RIGHT = the selected run's detail, tabs:
  · Receipt — receipt/abort/orphan block, panes, duration
  · Report — a read-only run-dir browser: report.json rendered
    pretty on top, then the file tree below (/api/run-dir), clicking
    a file shows its text
  · Events — the session's event stream, newest at bottom

HOME (#/home) — hand-rolled SVG only, no chart libraries:
- KPI cards (24h): jobs, success rate, avg duration, running now,
  orphaned now
- Runs per day, last 14 days, stacked by status
- Duration trend per dag, with version-hash chips overlaying the
  points (did the new version slow us down?)
- Permission mix (allow / deny / deny-unneeded) — the governance bar

Tune with vista, not by guessing:
  vista start http://localhost:8787
  vista observe
Then iterate. Prove with `vista act click --expect <text>`: Dags tab
sorts on click; a dag row opens #/dag-runs; the divider drags
(pl-resized fires); Home renders. Deep links: vista start
http://localhost:8787/#/home and /#/dags land correctly.

Need an API change? Ask backend through the relay. When it all works
and looks right, tell backend it should write the stop.
