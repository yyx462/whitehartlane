import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (claims are honest): the rewritten PR-review section of
// skills/yyx-whl/SKILL.md says the agent-facing contract (the spell,
// verdict handling, feedback division, test adoption, the re-levy law)
// "is the USER-level skill **yyx-ship** — load it when reviewing". A
// manual may only point at things that exist. If the named skill
// resolves in no registry an agent can load it from, the claim is
// false and the deleted inline contract is unrecoverable through the
// pointer (QUESTIONS.md #9: readers of deleted content must be
// updated, not re-routed into nothing).
test("SKILL.md's named user-level skill exists", () => {
  const skill = readFileSync(join(ROOT, "skills", "yyx-whl", "SKILL.md"), "utf8")
  const m = skill.match(/USER-level skill \*\*([^*]+)\*\*/)
  if (!m) return // BASE shape: the contract is inline, nothing is pointed at
  const name = m[1]
  const roots = [
    join(ROOT, "skills"),
    join(homedir(), ".config", "opencode", "skills"),
    join(homedir(), ".config", "opencode", "skill"),
    join(homedir(), ".opencode", "skills"),
    join(homedir(), ".opencode", "skill"),
  ]
  const found = roots.some(
    (root) => existsSync(join(root, name, "SKILL.md")) || existsSync(join(root, `${name}.md`)),
  )
  assert.ok(
    found,
    `INV-4: SKILL.md claims the agent-facing contract is the user-level skill "${name}", ` +
      `but no such skill exists in any registry: ${roots.join(", ")}` +
      ` — the manual points at nothing (the claim is false)`,
  )
})
