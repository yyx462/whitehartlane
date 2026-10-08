import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decidePermission } from "../src/permission.ts"

// the judge branch reads the landed threshold; point at an empty tmp
// dir so the compiled default (0.5) applies, whatever has been landed
process.env.AGENTIC_OS_JEV_PROMPTS_DIR = mkdtempSync(join(tmpdir(), "aos-prompts-"))

const roots = ["/Users/me/proj/ui-window", "/Users/me/.local/share/agentic-os"]

test("a path inside the roots is allowed", () => {
  const v = decidePermission({
    question: "Permission required\nAccess external directory /Users/me/proj/ui-window/web\nPatterns: ...",
    allowedRoots: roots,
  })
  assert.equal(v.decision, "allow")
  assert.match(v.path ?? "", /ui-window\/web/)
})

test("secrets are denied outright, even inside the roots", () => {
  const v = decidePermission({
    question: "Access external directory /Users/me/proj/ui-window/web/.env",
    allowedRoots: roots,
  })
  assert.equal(v.decision, "deny")
  assert.match(v.message, /secrets or credentials/)
})

test("auth-bearing configs are denied outright, not judged", () => {
  for (const p of [
    "/Users/me/.config/jev/env",
    "/Users/me/.secrets/env",
    "/Users/me/.config/gnupg/trustdb.gpg",
  ]) {
    const v = decidePermission({
      question: `Access external directory ${p}`,
      allowedRoots: roots,
      context: "check the model api key is configured",
    })
    assert.equal(v.decision, "deny", p)
  }
})

test("outside the home tree is denied", () => {
  const v = decidePermission({
    question: "Access external directory /etc/hosts",
    allowedRoots: roots,
  })
  assert.equal(v.decision, "deny")
})

test("home-but-unrooted wandering is denied as unneeded, with guidance", () => {
  const v = decidePermission({
    question: "Access external directory /Users/me/projects/other-repo/src",
    allowedRoots: roots,
  })
  assert.equal(v.decision, "deny-unneeded")
  assert.match(v.message, /I don't think you need/)
  assert.match(v.message, /say why/)
})

test("a question with no path is denied as unneeded", () => {
  const v = decidePermission({ question: "Permission required: run command", allowedRoots: roots })
  assert.equal(v.decision, "deny-unneeded")
})

test("the gray zone: a judge that sees the need allows the vista shots", () => {
  const v = decidePermission(
    {
      question: "Permission required: Access external directory /Users/me/.vista/sessions/99a14ca0/shots/home.png",
      allowedRoots: roots,
      context: "Use yyx-vista to screenshot the built page and judge its spacing against the design.",
    },
    () => 0.9,
  )
  assert.equal(v.decision, "allow")
  assert.match(v.message, /needed for this job/)
})

test("the gray zone: a low judge score stays deny-unneeded", () => {
  const v = decidePermission(
    {
      question: "Permission required: Access external directory /Users/me/.vista/sessions/99a14ca0/shots/home.png",
      allowedRoots: roots,
      context: "Refactor the auth module in this repo.",
    },
    () => 0.3,
  )
  assert.equal(v.decision, "deny-unneeded")
  assert.match(v.message, /say why/)
})

test("a dead judge fails restrictive, never blocks the rail", () => {
  const v = decidePermission(
    {
      question: "Access external directory /Users/me/Documents/notes/release-checklist.md",
      allowedRoots: roots,
      context: "Cut the release following my checklist in Documents/notes.",
    },
    () => {
      throw new Error("jev unreachable")
    },
  )
  assert.equal(v.decision, "deny-unneeded")
})

test("no judge keeps the legacy flat deny-unneeded", () => {
  const v = decidePermission({
    question: "Access external directory /Users/me/.vista/sessions/99a14ca0/shots/home.png",
    allowedRoots: roots,
    context: "Use yyx-vista to screenshot the built page.",
  })
  assert.equal(v.decision, "deny-unneeded")
})
