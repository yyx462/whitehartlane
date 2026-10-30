import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { writeWorkerPermissions } from "../../src/adapters/store.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// globalMcpNames caches its answer process-wide (mcpNamesCache), so the
// broken-probe case must run BEFORE any successful probe in THIS file,
// and the control runs in its own child process with a fresh cache.

// Meta-ACH: empty input to the isolation probe. The diff's own comment
// (store.ts writeWorkerPermissions) claims "the isolation keys
// (permission, mcp) FORCE-win" over the merged prior. The mcp half of
// that claim is keyed on globalMcpNames() returning NON-EMPTY:
//     const mcp = globalMcpNames()
//     if (mcp.length > 0) { config.mcp = …enabled:false… }
// When the probe answers EMPTY — `opencode` missing from PATH, the 20s
// timeout under load, or this very cache poisoned at [] by one failed
// call (the diff's adopted questions-7 observed a cold probe under a
// concurrent run sitting at []) — the merge keeps whatever `mcp` block
// the prior file carried, ENABLED entries included. On BASE the write
// replaced the file wholesale, so no prior mcp block could survive any
// re-seed: the merge reintroduces survival of exactly the key the
// isolation contract names, one probe-failure later. The pane-hang
// class mcp isolation exists to prevent (the r4 divide-pane incident:
// an enabled server pops auth chrome no API field exposes, hanging an
// innocent pane until a human clicks) is back on that path — and the
// unit dir is the worker's own writable cwd, so the prior block is not
// only the door's own past writes.

function priorConfig(where: string, mcp: Record<string, unknown>): void {
  mkdirSync(where, { recursive: true })
  writeFileSync(
    join(where, "opencode.json"),
    JSON.stringify({
      model: "acme/strong",
      mcp,
      permission: { external_directory: { "/etc": "allow" } },
    }),
  )
}

test("the isolation mcp force-win holds even when the probe fails — an enabled prior server never survives a re-seed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t1-"))
  try {
    const runDir = join(tmp, "unit")
    priorConfig(runDir, {
      evil: { type: "stdio", command: ["curl", "evil.example"], enabled: true },
      "auth-chrome": { type: "stdio", command: ["connect-integration"], enabled: true },
    })
    // the probe fails: no `opencode` anywhere on PATH → execFileSync
    // throws ENOENT inside globalMcpNames → cache [] → the merge branch
    const realPath = process.env.PATH
    process.env.PATH = ""
    try {
      writeWorkerPermissions(runDir)
    } finally {
      process.env.PATH = realPath
    }
    const cfg = JSON.parse(readFileSync(join(runDir, "opencode.json"), "utf8")) as {
      mcp?: Record<string, { enabled?: boolean }>
      permission?: { external_directory?: Record<string, string> }
      model?: string
    }
    const enabled = Object.entries(cfg.mcp ?? {}).filter(([, v]) => v?.enabled === true).map(([k]) => k)
    assert.deepEqual(
      enabled,
      [],
      `INV-2 (an accepted isolation decision must reach its consumer — refuse, never vanish) / the diff's own claim ` +
        `(store.ts writeWorkerPermissions: "the isolation keys (permission, mcp) FORCE-win, everything else the ` +
        `sandbox earned survives the re-seed"): with the MCP probe answering EMPTY (no opencode on PATH — the same ` +
        `state a timeout or the process-wide cache poisoned at [] leaves; the diff's own questions-7 observed it ` +
        `live), the merge kept the prior file's ENABLED mcp servers ${JSON.stringify(enabled)}: the force-win is ` +
        `keyed on mcp.length > 0, so a failed probe silently re-grants every server the prior generation (or ` +
        `anyone who could write the unit dir — it is the worker's own cwd) declared enabled. On BASE impossible: ` +
        `the write clobbered the file wholesale. Isolation must win unconditionally — a probe that answers nothing ` +
        `must still strip or disable the prior's mcp block, never inherit it enabled (the auth-chrome pane-hang ` +
        `class, r4's divide-pane incident).`,
    )
    // the OTHER isolation key keeps its promise on the same path
    assert.ok(!cfg.permission?.external_directory?.["/etc"], "the permission force-win holds even on the broken-probe path")
    assert.equal(cfg.model, "acme/strong", "the merge keeps the earned model pin (#249) — only the isolation keys are under test")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("control: when the probe succeeds the merge replaces the prior mcp block wholesale (fresh process, fresh cache)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t1-ctl-"))
  try {
    const runDir = join(tmp, "unit")
    // a stub opencode whose `mcp list` names one server — the
    // force-win fires (replace) and must not carry the prior's entries
    const stubBin = join(tmp, "bin")
    mkdirSync(stubBin, { recursive: true })
    writeFileSync(join(stubBin, "opencode"), "#!/bin/sh\nprintf '%s\\n' '✓  some-server  connected'\n", { mode: 0o755 })
    priorConfig(runDir, { evil: { type: "stdio", command: ["curl"], enabled: true } })
    const script = [
      `const { writeWorkerPermissions } = await import(${JSON.stringify(join(ROOT, "src/adapters/store.ts"))})`,
      `writeWorkerPermissions(${JSON.stringify(runDir)})`,
    ].join(";")
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ""}` },
    })
    assert.equal(r.status, 0, `control harness: the child writer ran (${r.stderr})`)
    const cfg = JSON.parse(readFileSync(join(runDir, "opencode.json"), "utf8")) as {
      mcp?: Record<string, { enabled?: boolean }>
    }
    assert.equal(cfg.mcp?.evil, undefined, "control: the probe succeeded, so the prior's enabled server is replaced, not inherited")
    assert.equal(cfg.mcp?.["some-server"]?.enabled, false, "control: the probe's own server is neutralized")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
