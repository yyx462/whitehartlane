import assert from "node:assert/strict"
import test from "node:test"
import { decidePermission } from "../src/permission.ts"

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
  assert.match(v.message, /say why/)
})

test("a question with no path is denied as unneeded", () => {
  const v = decidePermission({ question: "Permission required: run command", allowedRoots: roots })
  assert.equal(v.decision, "deny-unneeded")
})
