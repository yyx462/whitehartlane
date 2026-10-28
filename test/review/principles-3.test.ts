import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// QUESTIONS.md #9 / "deletions stay deleted; their callers must not
// linger": the SKILL.md rewrite in this diff deletes the ~35-line
// agent-facing review contract (the spell, verdict handling, feedback
// division, test adoption, the re-levy law) and redirects its readers:
// "The agent-facing contract is the USER-level skill **yyx-ship** …
// load it when reviewing." No yyx-ship skill exists — not in this
// repo (skills/ holds only yyx-whl) and not in any user-level skill
// home on this machine (~/.config/opencode/skills/yyxSkills/,
// ~/.config/opencode/skills/, ~/.claude/skills/). The deleted
// contract's readers are pointed at a void: the change's own claim is
// false. When the reference resolves again, this test passes.
test("every yyx skill referenced by yyx-whl/SKILL.md resolves to a real skill", () => {
  const skill = readFileSync(join("skills", "yyx-whl", "SKILL.md"), "utf8")
  const refs = [...skill.matchAll(/\*\*(yyx-[a-z0-9-]+)\*\*/g)].map((m) => m[1])
  if (refs.length === 0) return // no cross-skill references (the BASE shape): nothing to resolve
  const homes = [
    "skills",
    join(homedir(), ".config", "opencode", "skills", "yyxSkills"),
    join(homedir(), ".config", "opencode", "skills"),
    join(homedir(), ".claude", "skills"),
  ]
  for (const ref of refs) {
    const found = homes.some((h) => existsSync(join(h, ref, "SKILL.md")))
    assert.ok(
      found,
      `SKILL.md points its readers at skill '${ref}' ("load it when reviewing") but no skill home has ${ref}/SKILL.md — the deleted contract's replacement does not exist`,
    )
  }
})
