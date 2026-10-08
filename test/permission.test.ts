import assert from "node:assert/strict"
import test from "node:test"
import { decidePermission, escalateOnRepeat } from "../src/permission.ts"

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
