import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  allowGlobs,
  decidePermission,
  declareScope,
  escalateOnRepeat,
  readRootsTxt,
  scopeCovers,
  scopeFromDir,
} from "../src/permission.ts"

// the judge branch reads the landed threshold; point at an empty tmp
// dir so the compiled default (0.5) applies, whatever has been landed
process.env.AGENTIC_OS_JEV_PROMPTS_DIR = mkdtempSync(join(tmpdir(), "aos-prompts-"))

const scope = declareScope(["/Users/me/proj/ui-window", "/Users/me/.local/share/agentic-os"])

test("a path inside the roots is allowed", () => {
  const v = decidePermission({
    question: "Permission required\nAccess external directory /Users/me/proj/ui-window/web\nPatterns: ...",
    scope,
  })
  assert.equal(v.decision, "allow")
  assert.match(v.path ?? "", /ui-window\/web/)
})

test("secrets are denied outright, even inside the roots", () => {
  const v = decidePermission({
    question: "Access external directory /Users/me/proj/ui-window/web/.env",
    scope,
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
      scope,
      context: "check the model api key is configured",
    })
    assert.equal(v.decision, "deny", p)
  }
})

test("temp scratch is allowed outright — inside or outside home (j-ba18b7)", () => {
  for (const p of ["/tmp/build-cache", "/tmp", "/private/tmp/pytest-of-me", join(tmpdir(), "aos-run-1")]) {
    const v = decidePermission({
      question: `Access external directory ${p}`,
      scope,
    })
    assert.equal(v.decision, "allow", p)
    assert.match(v.message, /temp scratch/)
  }
})

test("outside-home non-temp is judged, not flat-denied", () => {
  const v = decidePermission({
    question: "Access external directory /etc/hosts",
    scope,
  })
  assert.equal(v.decision, "deny-unneeded")
  assert.match(v.message, /I don't think you need/)
  assert.equal(v.escalatable, true)
  // a judge that sees the need allows even outside home
  const judged = decidePermission(
    {
      question: "Access external directory /etc/hosts",
      scope,
      context: "Diagnose why the crawler resolves the broker host wrongly.",
    },
    () => 0.9,
  )
  assert.equal(judged.decision, "allow")
})

test("brute-force key hunting is denied even when the key does not exist", () => {
  const v = decidePermission({
    question: "Access external directory /Users/me/.ssh/id_rsa_github_backup",
    scope,
    context: "probing for credentials to set up git push",
  })
  assert.equal(v.decision, "deny")
  assert.equal(escalateOnRepeat(v, 5).decision, "deny")
})

test("home-but-unrooted wandering is denied as unneeded, with guidance", () => {
  const v = decidePermission({
    question: "Access external directory /Users/me/projects/other-repo/src",
    scope,
  })
  assert.equal(v.decision, "deny-unneeded")
  assert.match(v.message, /I don't think you need/)
  assert.match(v.message, /ask again/)
})

test("a question with no path is denied as unneeded", () => {
  const v = decidePermission({ question: "Permission required: run command", scope })
  assert.equal(v.decision, "deny-unneeded")
})

test("the gray zone: a judge that sees the need allows the vista shots", () => {
  const v = decidePermission(
    {
      question: "Permission required: Access external directory /Users/me/.vista/sessions/99a14ca0/shots/home.png",
      scope,
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
      scope,
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
      scope,
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
    scope,
    context: "Use yyx-vista to screenshot the built page.",
  })
  assert.equal(v.decision, "deny-unneeded")
})

test("a repeat ask escalates to allow — persistence is the asserted need", () => {
  const first = decidePermission({
    question: "Access external directory /Users/me/.config/opencode/skills/yyx-vista/",
    scope,
  })
  assert.equal(first.decision, "deny-unneeded")
  assert.equal(first.escalatable, true)
  assert.match(first.message, /ask again/)
  const second = escalateOnRepeat(first, 1)
  assert.equal(second.decision, "allow")
  assert.match(second.message, /granted on repeat/)
  // outside-home non-temp denies escalate too; hard-deny never does
  const outside = decidePermission({ question: "Access /opt/tools/bin", scope })
  assert.equal(outside.decision, "deny-unneeded")
  assert.equal(escalateOnRepeat(outside, 1).decision, "allow")
  // temp scratch allows on first ask — nothing to escalate
  const tmp = decidePermission({ question: "Access /tmp/build-cache", scope })
  assert.equal(tmp.decision, "allow")
  const secret = decidePermission({
    question: "Access /Users/me/proj/ui-window/web/.env",
    scope,
  })
  assert.equal(secret.decision, "deny")
  assert.equal(escalateOnRepeat(secret, 5).decision, "deny")
  // first asks and no-path verdicts stay as they are
  assert.equal(escalateOnRepeat(first, 0).decision, "deny-unneeded")
  assert.equal(
    escalateOnRepeat(decidePermission({ question: "no path here", scope }), 3).decision,
    "deny-unneeded",
  )
})

test("a judge miss is still covered: the judge's deny-unneeded escalates on repeat", () => {
  const first = decidePermission(
    {
      question: "Access external directory /Users/me/projects/inventory-app/src/app/page.tsx",
      scope,
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
// `/Users/dev/projects/acme/…` and (home-stripped) `/projects/acme/…`
// — and wobbled both the verdict's reason and the escalation ladder.
// Normalization keys one path.

test("a home-stripped path form resolves to the real path, not an outside-home deny", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const real = join(home, "projects", "acme", "whl", "marketplace-port", "units", "g0-shared")
  mkdirSync(real, { recursive: true })
  const v = decidePermission({
    question: `Permission required\n\nthe agent wants to read /projects/acme/whl/marketplace-port/units/g0-shared/`,
    scope: declareScope([]),
    home,
  })
  assert.doesNotMatch(v.message, /outside the home tree/)
  assert.equal(v.path, real)
  // a stripped form with no real counterpart stays literal — judged,
  // not granted
  const ghost = decidePermission({
    question: "Access /definitely/not/on/disk",
    scope: declareScope([]),
    home,
  })
  assert.match(ghost.message, /I don't think you need/)
  assert.equal(ghost.escalatable, true)
})

test("a tilde-form path resolves against home", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const real = join(home, ".vista", "sessions")
  mkdirSync(real, { recursive: true })
  const v = decidePermission({
    question: "Access external directory ~/.vista/sessions",
    scope: declareScope([]),
    home,
  })
  assert.equal(v.path, real)
})

test("stripped and full forms of one path key identically for escalation", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const full = join(home, "projects", "acme", "units")
  mkdirSync(full, { recursive: true })
  const stripped = decidePermission({
    question: "Access /projects/acme/units",
    scope: declareScope([]),
    home,
  })
  assert.equal(stripped.path, full)
  // same key → escalateOnRepeat's prior counts both forms together
  const escalated = escalateOnRepeat(stripped, 1)
  assert.equal(escalated.decision, "allow")
})


test("underscore-mangled home prefix is repaired (issue #82)", () => {
  const v = decidePermission({
    question: "Access external directory /Users_me/proj/ui-window/web",
    scope: declareScope(["/Users/me/proj/ui-window/web"]),
    home: "/Users/me",
  })
  assert.equal(v.decision, "allow")
  assert.equal(v.path, "/Users/me/proj/ui-window/web")
})

test("an underscore path whose repair does not exist is not reshaped (issue #82)", () => {
  const v = decidePermission({
    question: "Access external directory /Users_ghost/nowhere",
    scope: declareScope(["/Users/me/work"]),
    home: "/Users/me",
  })
  assert.equal(v.path, "/Users_ghost/nowhere")
  assert.match(v.message, /does not exist on disk/)
})

test("a literal existing underscore path is never reshaped", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-home-"))
  const literal = join(home, "Users_literal")
  mkdirSync(literal, { recursive: true })
  const v = decidePermission({
    question: `Access external directory ${literal}`,
    scope: declareScope([literal]),
    home,
  })
  assert.equal(v.decision, "allow")
  assert.equal(v.path, literal)
})

// -- the canonical scope (OPTIMUM §5): one construction, every consumer --
// The four side layers this replaces each re-spelled the deny set, the
// under-test, and the temp set; these pin the ONE spelling they now share.

test("declareScope expands ~, strips hard-deny roots, and dedupes", () => {
  const s = declareScope(["~/.vista", "/tmp/a", "/tmp/a", "", "/tmp/a/.env"])
  assert.deepEqual(s.roots, [`${homedir()}/.vista`, "/tmp/a"])
})

test("readRootsTxt is the one roots.txt spelling — trim, skip blanks", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-roots-"))
  writeFileSync(join(dir, "roots.txt"), "  /opt/tools \n\n~/.vista\n")
  assert.deepEqual(readRootsTxt(dir), ["/opt/tools", "~/.vista"])
  assert.deepEqual(readRootsTxt(mkdtempSync(join(tmpdir(), "aos-noroots-"))), [])
})

test("scopeFromDir: the program dir is a root; a hard-deny root covers nothing (#77 at admission too)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-scope-"))
  writeFileSync(join(dir, "roots.txt"), "/opt/a/.env\n/opt/tools\n")
  const s = scopeFromDir(dir)
  assert.deepEqual(s.roots, [dir, "/opt/tools"])
  assert.equal(scopeCovers(s, `${dir}/units/x/brief.md`), true)
  assert.equal(scopeCovers(s, "/opt/tools/bin/tool"), true)
  // stripped at construction — the door refuses the program instead of
  // admitting one whose runtime would hard-deny the same brief paths
  assert.equal(scopeCovers(s, "/opt/a/.env/key"), false)
})

test("allowGlobs pre-seeds both spellings of every root plus temp — never the disk", () => {
  const external = allowGlobs(["/opt/tools"])
  assert.equal(external["*"], "ask")
  assert.equal(external["/opt/tools"], "allow")
  assert.equal(external["/opt/tools/**"], "allow")
  assert.equal(external["/tmp/**"], "allow")
  assert.equal("/**" in external, false, "seeding never grants the disk")
})
