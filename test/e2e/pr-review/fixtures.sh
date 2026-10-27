#!/usr/bin/env bash
# fixtures.sh — build the five drill cases under $1 (the drill root):
#   c1-clean        a correct fix, both twin sites updated  → ACCEPT + merge
#   c2-twin         the run-#17 class: observed wait in one path, fixed
#                   sleep left in its twin                  → REJECT (introduced)
#   c3-tests        an untested edge (empty input) the change breaks → REJECT (introduced)
#   c4-docs         docs-only diff                           → SKIP at the door
#   c5-multiworker  two modules, two authors, one bug each    → REJECT + feedback split
# Each repo carries its own INVARIANTS.md (what "right" means there);
# c5 also gets a fabricated authoring run trace for the divider.
set -euo pipefail
root="${1:?usage: fixtures.sh <drill-root>}"
mkdir -p "$root"
gitify() { git init -q -b main "$1" && git -C "$1" config user.email drill@t.local && git -C "$1" config user.name drill; }
commit() { git -C "$1" add -A && git -C "$1" commit -qm "$2"; }

# ── c1-clean: split() loses the remainder; the PR distributes it exactly ──
if [ ! -d "$root/c1" ]; then
  mkdir -p "$root/c1/src"
  gitify "$root/c1"
  cat > "$root/c1/src/split.ts" <<'EOF'
// split a total into parts — remainder is LOST today (known bug)
export function split(total: number, parts: number): number[] {
  const each = Math.floor(total / parts)
  return Array(parts).fill(each)
}
EOF
  cat > "$root/c1/INVARIANTS.md" <<'EOF'
- INV-1 split is EXACT for every integer total 0 <= t <= 2^53 and
  every n >= 1: sum(split(t, n)) === t, every part >= 0.
- INV-2 one function decides the split; no other site re-implements it.
EOF
  printf '# ledger\n' > "$root/c1/README.md"
  commit "$root/c1" base
  git -C "$root/c1" checkout -qb fix
  cat > "$root/c1/src/split.ts" <<'EOF'
// split a total into parts — the LAST part carries the remainder, so
// the sum is always exact for totals up to 2^53 (INV-1)
export function split(total: number, parts: number): number[] {
  const each = Math.floor(total / parts)
  const out = Array(parts).fill(each)
  out[parts - 1] += total - each * parts
  return out
}
EOF
  mkdir -p "$root/c1/test"
  cat > "$root/c1/test/split.test.ts" <<'EOF'
import test from "node:test"
import assert from "node:assert/strict"
import { split } from "../src/split.ts"
test("exact", () => assert.deepEqual(split(10, 3), [3, 3, 4]))
EOF
  commit "$root/c1" "split: distribute the remainder exactly"
fi

# ── c2-twin: drain observes; the PR rewrites its twin stop onto a timer ──
if [ ! -d "$root/c2" ]; then
  gitify "$root/c2"
  mkdir -p "$root/c2/src"
  cat > "$root/c2/src/drain.ts" <<'EOF'
// drain waits until OBSERVED not-working — the one settle spelling
export async function drain(workers: { working: boolean; tick(): Promise<void> }[]): Promise<void> {
  for (const w of workers) {
    while (w.working) await w.tick()
  }
}
EOF
  cat > "$root/c2/src/stop.ts" <<'EOF'
// stop settles the same way drain does: observe, never guess
export async function stop(workers: { working: boolean; tick(): Promise<void> }[]): Promise<void> {
  for (const w of workers) {
    while (w.working) await w.tick()
  }
}
EOF
  cat > "$root/c2/INVARIANTS.md" <<'EOF'
- INV-1 every settle path (drain, stop, retire) waits on OBSERVED
  not-working state for every worker — a fixed timer is never the wait.
- INV-2 one function per decision: all settle paths share the same
  observed-wait spelling; a second spelling is a finding even when it
  happens to agree today.
EOF
  commit "$root/c2" base
  git -C "$root/c2" checkout -qb fast-stop
  cat > "$root/c2/src/stop.ts" <<'EOF'
// stop: settle quickly — a beat is always enough in practice
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export async function stop(workers: unknown[]): Promise<void> {
  for (const _w of workers) {
    await sleep(50)
  }
}
EOF
  commit "$root/c2" "stop: settle after one beat instead of spinning"
fi

# ── c3-tests: a discount nobody tested on the empty cart ──
if [ ! -d "$root/c3" ]; then
  gitify "$root/c3"
  mkdir -p "$root/c3/src"
  cat > "$root/c3/src/total.ts" <<'EOF'
export function total(items: { price: number; qty: number }[]): number {
  return items.reduce((acc, i) => acc + i.price * i.qty, 0)
}
EOF
  cat > "$root/c3/INVARIANTS.md" <<'EOF'
- INV-1 total() of an empty cart is 0, under every option combination.
- INV-2 options never leak into the empty path's return value.
EOF
  commit "$root/c3" base
  git -C "$root/c3" checkout -qb discount
  cat > "$root/c3/src/total.ts" <<'EOF'
export function total(items: { price: number; qty: number }[], discountPct = 0): number {
  if (items.length === 0) return discountPct
  const sum = items.reduce((acc, i) => acc + i.price * i.qty, 0)
  return sum * (1 - discountPct / 100)
}
EOF
  commit "$root/c3" "total: apply an optional discount to the sum"
fi

# ── c4-docs: nothing but prose moved ──
if [ ! -d "$root/c4" ]; then
  mkdir -p "$root/c4/docs"
  gitify "$root/c4"
  printf '# notes\n\nv1 is stable.\n' > "$root/c4/NOTES.md"
  commit "$root/c4" base
  git -C "$root/c4" checkout -qb docs
  printf '# notes\n\nv1 is stable. v2 planning lives in docs/roadmap.md.\n' > "$root/c4/NOTES.md"
  printf '# roadmap\n\n- faster settle\n' > "$root/c4/docs/roadmap.md"
  commit "$root/c4" "docs: point at the roadmap"
fi

# ── c5-multiworker: alice's queue drops the last item; bob's cache
#    never overwrites — one proven finding each, two authors ────────────
if [ ! -d "$root/c5" ]; then
  gitify "$root/c5"
  mkdir -p "$root/c5/src"
  cat > "$root/c5/src/queue.ts" <<'EOF'
// drain returns every queued item, in order
export function drain(q: unknown[]): unknown[] {
  return q.splice(0, q.length)
}
EOF
  cat > "$root/c5/src/cache.ts" <<'EOF'
// remember: first write wins per key? NO — the latest value wins
const store = new Map<string, unknown>()
export function remember(key: string, value: unknown): void {
  store.set(key, value)
}
export function peek(key: string): unknown {
  return store.get(key)
}
EOF
  cat > "$root/c5/INVARIANTS.md" <<'EOF'
- INV-1 drain() returns ALL queued items in order — none dropped.
- INV-2 remember() is last-write-wins: a second remember of a key
  replaces the value (peek sees the newest).
EOF
  commit "$root/c5" base
  git -C "$root/c5" checkout -qb pair-fix
  cat > "$root/c5/src/queue.ts" <<'EOF'
// drain returns the queued items in order
export function drain(q: unknown[]): unknown[] {
  // splice to length-1 keeps the slot clear for the next producer
  return q.splice(0, Math.max(0, q.length - 1))
}
EOF
  cat > "$root/c5/src/cache.ts" <<'EOF'
// remember: keep the FIRST value a key ever saw (cache stampede guard)
const store = new Map<string, unknown>()
export function remember(key: string, value: unknown): void {
  if (!store.has(key)) store.set(key, value)
}
export function peek(key: string): unknown {
  return store.get(key)
}
EOF
  commit "$root/c5" "queue+cache: pair of settle fixes"
  # the fabricated authoring run trace (what the divider reads)
  mkdir -p "$root/c5-trace/units/alice" "$root/c5-trace/units/bob"
  cat > "$root/c5-trace/units/alice/result.md" <<'EOF'
Implemented src/queue.ts: adjusted drain() to keep the last slot
clear for the next producer. All queue tests pass.
EOF
  cat > "$root/c5-trace/units/bob/result.md" <<'EOF'
Implemented src/cache.ts: remember() now keeps the first value per
key as a cache stampede guard. Cache tests pass.
EOF
  cat > "$root/c5-trace/events.jsonl" <<'EOF'
{"kind":"unit.started","unit":"alice","ts":"2026-10-27T00:00:00Z"}
{"kind":"unit.started","unit":"bob","ts":"2026-10-27T00:00:01Z"}
{"kind":"unit.finished","unit":"alice","pass":true,"ts":"2026-10-27T00:04:00Z"}
{"kind":"unit.finished","unit":"bob","pass":true,"ts":"2026-10-27T00:04:30Z"}
EOF
fi

echo "fixtures ready under $root"
