// principles-5201 — the program's IDENTITY hash lost every DIRECTORY
// name: `contentHashOf` now hashes only file basenames and contents,
// so two structurally different programs hash IDENTICALLY and the
// "program changed since booking" receipt goes silent on a real edit.
//
// THE CHANGE (src/doors/project.ts:111-165) rewrote the walker to make
// EMPTY directories invisible (principles-5100 — the seat-minting
// `mkdirSync(data/review)` inside the source dir moved the hash). Its
// own comment states the law it intends:
//
//   "a directory whose only children are skipped output seats
//    contributes NOTHING — not even its name. ... Bottom-up: a dir
//    hashes its name only if something beneath it hashed first."
//
// THE IMPLEMENTATION NEVER RETURNS THE FLAG (project.ts:128-162):
//
//   const walk = (d: string, rel: string): boolean => {
//     ...
//     let contributed = false
//     for (const e of entries) {
//       ...
//       if (e.isDirectory()) {
//         if (walk(p, r)) {            // <-- walk() returns undefined!
//           h.update(`dir:${e.name}`)   // <-- therefore NEVER runs
//           contributed = true
//         }
//         continue
//       }
//       h.update(e.name)
//       contributed = true
//       ...
//     }
//   }                                  // <-- no `return contributed`
//
// `walk` is declared `: boolean` but has NO return statement, so it
// always yields `undefined` (falsy). Two consequences, both wrong:
//
//   1. the intended law ("a dir hashes its name only if something
//      beneath it hashed first") never fires — a directory WITH content
//      beneath it contributes nothing either;
//   2. the file's own contract (project.ts:99-100: "the version of a
//      program: sha1 over the staged files ... and EVERY CONTENT CHANGE
//      IS A NEW VERSION") is broken — a directory rename is a content
//      change and it is NOT a new version.
//
// BASE hashed every entry name, directories included (BASE's walker
// called `h.update(e.name)` before recursing), so BASE DID see the
// rename. This change is what made the identity blind to it.
//
// THE HARM — two named consumers in this repo:
//
//   (a) src/adapters/store.ts:845-856 `failedWakeWhy` — the receipt
//       that tells the operator "the program was fixed after the
//       failure; `whl continue` re-runs the verdict on the same work":
//
//         if (contentHashOf(src) !== booked) why += " — program changed
//           since booking: `whl continue` re-runs the verdict on the
//           same work"
//
//       With the identity blind to a directory rename, an operator who
//       moved a file edits the program and the receipt says plain
//       "failed" — the recovery the receipt exists to prescribe is
//       mis-prescribed (the same failure the 5100 receipt names, in
//       the opposite direction).
//
//   (b) src/doors/run.ts:196-224 `copyBeside` — the re-levy FOLD's
//       "same program?" identity (`identity.data`,
//       `identity.hooks`, `identity.members` are contentHashOf calls).
//       A program whose data file moved into a nested directory hashes
//       the same in HEAD and different in BASE, so the fold folds a
//       DONE unit forward across an edited input — the exact harm the
//       code's own comment names at run.ts:200-204: "a done unit folded
//       forward across edited inputs, run 2's ledger claiming a settle
//       its own inputs never made".
//
// BASE behaviour: BASE's walker hashed directory names, so BASE's
// hash MOVES on the rename and the receipt names the change — the
// assertion below PASSES on BASE. The change is what made it silent.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")

test("principles-5201: a program's identity must move when its layout changes", async () => {
  const { failedWakeWhy } = await import(join(HEAD, "src", "adapters", "store.ts"))
  const { contentHashOf } = await import(join(HEAD, "src", "doors", "project.ts"))
  const { prepareRun } = await import(join(HEAD, "src", "doors", "run.ts"))

  const tmp = mkdtempSync(join(tmpdir(), "p5201-identity-"))
  const prevHome = process.env.AGENTIC_OS_HOME
  process.env.AGENTIC_OS_HOME = join(tmp, "home")
  try {
    // a program whose DATA carries a nested directory
    const prog = join(tmp, "prog")
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "bank"), { recursive: true })
    writeFileSync(join(prog, "workflow.toml"), "[workflow]\nname='t'\nworker_kind='pi'\n[[stage]]\nid=\"s1\"\ntopology=\"gate\"\nrun=\"bash hooks/x.sh\"\n")
    writeFileSync(join(prog, "contract.toml"), "[[contract.deliverables]]\nname=\"out\"\npath=\"out.md\"\nkind=\"file\"\n")
    writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 0\n")
    writeFileSync(join(prog, "data", "bank", "questions.toml"), "one = 1\n")

    // the door books the program and records its version
    const ready = prepareRun(prog)
    assert.ok(ready.ok, `the program must book: ${ready.ok ? "" : ready.why}`)
    const booked = ready.job.spur?.content_hash
    assert.ok(booked, "the booking must record a spur version")
    assert.equal(
      contentHashOf(prog),
      booked,
      "staging must not move the program's identity (the seat is output, never input)",
    )

    // the operator MOVES a file into a different directory — a real
    // content change (the file's bytes and name are identical; only the
    // LAYOUT moved)
    renameSync(join(prog, "data", "bank"), join(prog, "data", "vault"))

    assert.notEqual(
      contentHashOf(prog),
      booked,
      `a program's identity must move when its layout changes — the hash is the program's version ("every content change is a new version", src/doors/project.ts:99-100), and the re-levy fold's "same program?" judgment (src/doors/run.ts:196-224) reads it.\n` +
        `src/doors/project.ts:128-162: the rewritten walker never returns its "contributed" flag (the function is declared to return a boolean but has no return statement), so the "if (walk(p, r))" test is always falsy and the "h.update('dir:' + e.name)" line NEVER runs — no directory name ever rides the hash, not just the empty ones the change meant to hide.\n` +
        `BASE's walker hashed every entry name (directories included), so BASE saw the rename.`,
    )

    // the CONSUMER's receipt, on the job the booking wrote
    const job = { spur: ready.job.spur } as never
    const why = failedWakeWhy(job, "failed")
    assert.match(
      why,
      /program changed since booking/,
      `the wake must name the change — the program was edited after the booking, so \`whl continue\` re-runs the verdict on the same work (src/adapters/store.ts:845-856). It says: "${why}".`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
