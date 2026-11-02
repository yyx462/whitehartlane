// principles-44 — THE VERDICT SEAT LEAKED INTO THE GENERAL RUN PATH,
// AND IT EATS THE USER'S OWN FILE.
//
// The change adds the verdict seat (the door PROMISES the verdict at
// <out>/data/review/verdict.json; the supervisor's bounded wait polls
// exactly that path):
//
//   src/doors/run.ts:142  export function linkVerdictSeat(source, store) {
//     const seat = join(source, "data", "review", "verdict.json")
//     if (existsSync(seat) || lstatSync(seat, ...)) rmSync(seat, {force:true})
//     mkdirSync(dirname(seat), {recursive:true})
//     symlinkSync(join(store, "data", "review", "verdict.json"), seat)
//   }
//
// and it is called from TWO places — the twin-path this lens hunts:
//
//   1. src/doors/run.ts:127 — INSIDE stageRun(), the GENERAL program
//      staging path (every `whl run <program>` of ANY program goes
//      through it). Here source = the PROGRAM FOLDER the user pointed
//      at, and store = the run's job dir. So the seat link lands in
//      THE USER'S OWN PROGRAM TREE, pointing into the session store.
//
//   2. bin/whitehartlane:687 — the REVIEW door only:
//        linkVerdictSeat(ready.dir, runReady.job.dir)
//      Here source = ready.dir, the MATERIALIZED review program (a
//      scratch dir under --out), which is what the door's promise is
//      about.
//
// The two sites are not the same decision. Site 2 is the door's promise
// ("<out>/data/review/verdict.json"). Site 1 is a review concept
// applied to EVERY program — and it MUTATES the user's directory:
// linkVerdictSeat rmSync's whatever sits at data/review/verdict.json
// (a real file the author wrote is DELETED) and leaves a symlink into
// ~/.local/share/agentic-os/sessions/... in their tree.
//
// The change's own code knows the seat is a symlink in a program tree —
// src/doors/run.ts:171-176 in copyBeside removes the self-referential
// link from the COPY ("the copy must not carry a self-referential link
// (ELOOP)"), and src/doors/project.ts's OUTPUT_SEATS excludes it from
// every hash root. But the copy is the only place it is cleaned: the
// SOURCE keeps the destroyed file's replacement.
//
// REACHABLE PATH (the tool's main verb): `whl run ./my-program` —
// prepareRun(dir) -> book(dir, ...) -> stage(job.dir) -> stageRun(dir,
// job.dir) -> linkVerdictSeat(dir, job.dir). Nothing about the program
// needs to be a review.
//
// Repro: a plain program whose data/review/verdict.json is a REAL file
// the author wrote; stage it; assert the author's file survived and
// that the program's source tree gained no symlink into the store.
//
// BASE behaviour: BASE has no linkVerdictSeat at all (grep: base/src/
// doors/run.ts has no symlinkSync) — the author's file survives
// untouched -> the assertion PASSES on BASE -> the prove gate
// classifies this as introduced (the diff touches src/doors/run.ts).
import assert from "node:assert/strict"
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const { stageRun } = await import(join(HEAD, "src", "doors", "run.ts"))

test("staging a program must not destroy the program's own files or plant a symlink in its tree", () => {
  const root = mkdtempSync(join(tmpdir(), "aos-seat-"))
  try {
    const src = join(root, "prog")
    mkdirSync(join(src, "hooks"), { recursive: true })
    writeFileSync(
      join(src, "workflow.toml"),
      '[workflow]\nname = "plain"\nworker_kind = "opencode"\nslots = 1\ncanary = false\n',
    )
    writeFileSync(join(src, "hooks", "verdict.sh"), "echo v\n")

    // the AUTHOR'S OWN real file at the seat path
    const authorFile = join(src, "data", "review", "verdict.json")
    mkdirSync(join(src, "data", "review"), { recursive: true })
    writeFileSync(authorFile, JSON.stringify({ verdict: "accept", mine: true }))

    const store = join(root, "store")
    stageRun(src, store)

    // (A) the author's own file must survive the staging
    assert.ok(
      existsSync(authorFile) && !lstatSync(authorFile).isSymbolicLink(),
      `staging DESTROYED the program's own data/review/verdict.json — the change's linkVerdictSeat (src/doors/run.ts:145) rmSync's whatever sits at the seat path and replaces it with a symlink into the run dir. The author's file is gone.`,
    )
    assert.equal(
      readFileSync(authorFile, "utf8"),
      JSON.stringify({ verdict: "accept", mine: true }),
      "the program's own verdict.json content changed during staging",
    )

    // (B) the program's source tree must not gain a symlink into the store
    assert.ok(
      !lstatSync(authorFile).isSymbolicLink(),
      `the program's source tree gained a symlink into the run store — a program dir is the user's own tree; the door stages a COPY, it does not rewrite the source. Read: ${lstatSync(authorFile).isSymbolicLink() ? readlinkSync(authorFile) : "(not a link)"}`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
