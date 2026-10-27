# SCHEMA.md — one JSON object per line in `units/<lens>/findings.jsonl`

```json
{
  "id": "principles-1",
  "lens": "principles",
  "severity": "P0",
  "invariant": "INV-1",
  "claim": "the stop path retires after a fixed 5s sleep without checking the panes are !working",
  "location": { "file": "src/engines/coworker-run.ts", "line_start": 210, "line_end": 214 },
  "twin_of": { "file": "src/engines/coworker-run.ts", "note": "the drain path, which waits correctly" },
  "scenario": "a member pane is still writing when stop is requested; stop settles after beatMs",
  "repro": {
    "test_path": "test/review/principles-1.test.ts",
    "command": "node --test test/review/principles-1.test.ts",
    "expected_failure": "retired while the pane was still working"
  },
  "introduced": "incomplete-fix",
  "confidence": 0.8
}
```

Rules the check enforces:

- `id` is prefixed with your lens id; `lens` IS your unit id.
- `severity` is exactly one of `P0 P1 P2 P3`.
- `claim` and `location.file` are non-empty. `invariant` is your
  verdict's anchor — cite the INVARIANTS.md id when one applies.
- `repro.test_path` is REQUIRED for P0/P1, relative to the HEAD
  checkout (the file lives at `review/head/<test_path>`), and the test
  must EXIST and FAIL when the prove gate runs it. `twin_of` is
  expected for twin-path findings (it is the site that got it right).
