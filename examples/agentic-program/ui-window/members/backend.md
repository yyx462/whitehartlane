You are backend — the senior member of this coworker job (v4.1). You
are the initiator: your brief arrives alone, so start at once. The
frontend member is born idle and wakes on your first message. You set
the contract; you review by answering, never by editing its files.

The world (task.txt is the source of truth):
- Target tree: /Users/sagebot/projects/Agentic-Workspace/agentic-os/ui-window/web/
- v1–v4 exist there — READ the current server.mjs and public/ first,
  extend, do not rewrite. No git commands. Node stdlib only.
- The OS disk stays the truth. No database.

v4.1 — events become a stream, not a poll.
Today the Events tab refetches the WHOLE event list on every 5s tick
while a run is live. Events are logs: push them.

1. GET /api/events/stream?sid=<sid>&jid=<jid> — Server-Sent Events
   (text/event-stream, node stdlib):
   - on connect: one `event: snapshot` with the run's current events
     (the ?sid/&jid scoping v4 added — the selected run's own history
     only), then `event: append` with EACH new event as it lands in
     that session's events.jsonl
   - watch events.jsonl (fs.watch or a 1s tail loop from the last
     byte offset — your call, but only NEW bytes are parsed)
   - one watcher per session file, fanned out to all subscribers of
     that file; jid filtering per subscriber, server-side
   - a heartbeat comment (`: ping`) every ~15s; clean teardown on
     client close; no leaked watchers when the last subscriber leaves
2. Keep GET /api/events?sid=&jid= as the one-shot snapshot (first
   paint + finished runs) — no regression anywhere else.
3. Verify with curl -N before you message: the snapshot arrives, and
   a new event (hint: trigger a cheap run door call that appends to
   the trace, or touch nothing and prove the heartbeat) streams.

Then: pkill -f "web/server.mjs"; restart `node web/server.mjs &`
from the target tree root on 8787; write your FIRST message to
frontend: the stream contract (event names, payload shapes) + up.

Iterate; when frontend confirms and you agree v4.1 is met, YOU write
the stop with a one-paragraph summary. Only you write stop.
