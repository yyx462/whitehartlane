# Coworker — panes that talk through the rail

The workflow for panes that depend on each other. Fan-out's law
("workers do not depend on each other") is not bent; Coworker is a
third kind beside fan-out and Direct: `kind = "coworker"` in
`workflow.toml`. The first tenant is feature-lend: a fork of the old
project's session hands a mechanism to a fresh pane in the new
project — live context instead of a stale doc.

## Picture

```text
agentic-os run <folder>            kind = "coworker"
  Rail births the named members. A member may be born forked:
  host session seeded from seed -> {tool, session_id, since}.
  Bytes never copied; the original session never written.

lender (forked; OLD's three hours)      borrower (fresh; NEW's worktree)
  writes messages/<n>.json on the Job dir
  goes idle
        |
        |  the message file is the signal. Idle alone is not.
        v
Rail
  photographs messages/ (a detector names what a message is)
  tick returns relay; the hands prompt the named pane
        |
        v
borrower answers the same way; the Rail relays back
        |
        v
Rail writes report.json when the stop lands; the receipt as ever
```

## Law

- A worker never writes another worker. The Rail is the relay.
- A message is a file on the Job dir, addressed by pane label. What a
  message is, is a detector — the program's say. That it is relayed,
  not written peer-to-peer, is rail.
- A fork is a birth mode, not an adoption: fresh pane, fresh record,
  fresh binding. The seed is booked on `pane.born`.
- A fork passes the same admission as any birth, plus the seed must
  resolve: a known tool and a readable host session.
- The orchestrator pane stays optional and stays failure-only: it
  wakes on a blocked member and writes one decision. It never relays
  content.
- roots.txt grants the forked member's read on the old repo — the
  lender reads, the borrower writes; one tree has one writer.
- Coworker produces a report. No quiet finish. The receipt is panes
  of this Job remaining = 0, as ever.

## Stages

Each stage is done only when its test is green. Do not start the next
on a red test.

1. **A fork is booked.** `attachPane` with a seed appends `pane.born`
   carrying it; `projectJob` restores it. Test: `test/fork.test.ts`.
2. **Fork admission.** `admitFork` refuses an unknown tool, a missing
   session file, and an unresolvable seed; admits a resolvable one.
   Test: `test/fork.test.ts`.
3. **The kind is named.** `kind = "coworker"` resolves at the door and
   books; its rail bin is named. Test: `test/workflow-kind.test.ts`.
4. **The relay is the rail.** A photographed message becomes a prompt
   to the named pane and no other; a worker-written prompt to another
   worker fails. Test: `test/relay.test.ts` (not built).
5. **A stop produces a report.** The stop message ends the exchange;
   `report.json` lands with counts from the counts hook. Test:
   `test/coworker-report.test.ts` (not built).
