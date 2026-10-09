import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decidePermission, escalateOnRepeat } from "../src/permission.ts"

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
  assert.match(v.message, /ask again/)
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
  assert.match(v.message, /ask again/)
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

test("a repeat ask escalates to allow — persistence is the asserted need", () => {
  const first = decidePermission({
    question: "Access external directory /Users/me/.config/opencode/skills/yyx-vista/",
    allowedRoots: roots,
  })
  assert.equal(first.decision, "deny-unneeded")
  assert.equal(first.escalatable, true)
  assert.match(first.message, /ask again/)
  const second = escalateOnRepeat(first, 1)
  assert.equal(second.decision, "allow")
  assert.match(second.message, /granted on repeat/)
  // outside-home denies escalate too; hard-deny never does
  const tmp = decidePermission({ question: "Access /tmp/build-cache", allowedRoots: roots })
  assert.equal(escalateOnRepeat(tmp, 1).decision, "allow")
  const secret = decidePermission({
    question: "Access /Users/me/proj/ui-window/web/.env",
    allowedRoots: roots,
  })
  assert.equal(secret.decision, "deny")
  assert.equal(escalateOnRepeat(secret, 5).decision, "deny")
  // first asks and no-path verdicts stay as they are
  assert.equal(escalateOnRepeat(first, 0).decision, "deny-unneeded")
  assert.equal(
    escalateOnRepeat(decidePermission({ question: "no path here", allowedRoots: roots }), 3).decision,
    "deny-unneeded",
  )
})

test("a judge miss is still covered: the judge's deny-unneeded escalates on repeat", () => {
  const first = decidePermission(
    {
      question: "Access external directory /Users/me/projects/inventory-app/src/app/page.tsx",
      allowedRoots: roots,
      context: "Fix the hydration warning in this repo's own app directory.",
    },
    () => 0.1,
  )
  assert.equal(first.decision, "deny-unneeded")
  assert.equal(first.escalatable, true)
  const second = escalateOnRepeat(first, 1)
  assert.equal(second.decision, "allow")
})

// j-2b508e: the same ask arrived in two forms —
// `/Users/sagebot/projects/NWi/…` and (home-stripped) `/projects/NWi/…`
// — and wobbled both the verdict's reason and the escalation ladder.
// Normalization keys one path.

test("a home-stripped path form resolves to the real path, not an outside-home deny", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const real = join(home, "projects", "NWi", "whl", "lazada-ozon-port", "units", "g0-shared")
  mkdirSync(real, { recursive: true })
  const v = decidePermission({
    question: `Permission required\n\nthe agent wants to read /projects/NWi/whl/lazada-ozon-port/units/g0-shared/`,
    allowedRoots: [],
    home,
  })
  assert.doesNotMatch(v.message, /outside the home tree/)
  assert.equal(v.path, real)
  // a stripped form with no real counterpart stays literal
  const ghost = decidePermission({
    question: "Access /definitely/not/on/disk",
    allowedRoots: [],
    home,
  })
  assert.match(ghost.message, /outside the home tree/)
})

test("a tilde-form path resolves against home", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const real = join(home, ".vista", "sessions")
  mkdirSync(real, { recursive: true })
  const v = decidePermission({
    question: "Access external directory ~/.vista/sessions",
    allowedRoots: [],
    home,
  })
  assert.equal(v.path, real)
})

test("stripped and full forms of one path key identically for escalation", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const full = join(home, "projects", "NWi", "units")
  mkdirSync(full, { recursive: true })
  const stripped = decidePermission({
    question: "Access /projects/NWi/units",
    allowedRoots: [],
    home,
  })
  assert.equal(stripped.path, full)
  // same key → escalateOnRepeat's prior counts both forms together
  const escalated = escalateOnRepeat(stripped, 1)
  assert.equal(escalated.decision, "allow")
})
