# Zen 9 — the window mutation gate (R5 closure)

2026-10-26. Session: opencode:ses_e8900c9b4ffe7kAvmybND7AYci.
Distilled in-session by the implementing agent (yyx-project-meta not
present in that harness). Context: review agent flagged R5 — #230
narrowed the window binds, but the tailnet bind is reachable by every
peer and the mutation routes (`POST /api/run`, the rail verbs, delete,
trigger, run-with-edits, `PUT /api/program`) are code execution as this
user. A second vector lives on loopback: `readBody` ignores
Content-Type, so any website's no-cors text/plain POST parses fine.
Only the **Final** lines are law.

## Final (these lines are law)

- **Every non-GET on the window API carries the bearer token.** One
  32-byte secret, minted once into the OS disk root as `window.token`
  (mode 0600), compared constant-time. Reads (GET/HEAD) stay open.
  An unauthenticated POST is rejected BEFORE any handler — even the C06
  cache-bust never runs for it (no side effects for the unauthenticated).
- **The boot dispenser is loopback-only.** `GET /api/boot` hands the
  token to loopback callers only, and never across a foreign Origin.
  Every local process can read the 0600 file anyway — the dispenser
  exists so the operator's browser is zero-config; it is not a secret
  from the machine. A page opened from the tailnet addr is a read-only
  window; its mutations 401 with the token's location in the message.
- **Origin is the browser lock; the token is the load-bearing wall.**
  A browser mutation must carry an Origin that is one of the server's
  own origins (binds + localhost, never the request's Host header).
  Origin is browser-set — JS cannot forge it — so this kills CSRF and
  DNS rebinding (the rebound page CAN set headers but still carries its
  true origin). curl sends no Origin and can forge any header text;
  only the token covers it. Neither check alone is sufficient.
- **Uniform on all binds — REJECTED: loopback exemption.** One
  invariant beats socket-address normalization (`::1` vs `127.0.0.1`
  vs `::ffff:`), which is exactly where bypass bugs live. Tests read
  the token from their fixture root; no address-form branching exists.
- **Program editing stays in the server, gated.** The momentum line
  "the window only views" is in tension with `PUT /api/program` and
  run-with-edits; this session did NOT fight the momentum silently —
  the gate is the minimal security fix, and whether editing leaves the
  server at all is left open for the refit to rule on.
- **SSE constrains the read gate.** `EventSource` cannot set headers;
  if reads are ever gated, the token must travel by `?token=` query
  (log-leak tradeoff) or a cookie. That cost is why reads stay open
  today.

## Coinages (→ CONTEXT.md)

- **Boot dispenser** — `GET /api/boot`, the loopback-only handoff of
  the mutation token to the window's own page.

## Rejected proposals

- Loopback-exempt bearer policy (two code paths; address normalization
  is the natural home of bypass bugs; local malware reads the token
  file regardless — the exemption buys no real security).
- Gating reads in the same stroke (EventSource cannot set headers; a
  token-in-URL mechanism is a worse trade than the read exposure it
  closes — reads leak run content, never code execution).
- Dropping `PUT /api/program` + run-with-edits in this change (a
  product reversal owned by the momentum refit, not by a security
  patch riding on it).
