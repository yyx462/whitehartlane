// R5 closure — the mutation gate, proved at the API: #230 narrowed the
// binds, but the tailnet bind is peer-reachable and POST /api/run +
// PUT /api/program are code execution. Every non-GET must prove
// possession of the bearer token minted into the OS disk root (0600);
// reads stay open; a browser Origin that is not one of the server's own
// is refused even with the right token (CSRF via no-cors POSTs —
// readBody ignores Content-Type — and DNS rebinding both die here);
// GET /api/boot hands the token to loopback callers only.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

async function waitHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error("server did not come up")
}

test("non-GET needs the bearer token; foreign origins are refused; boot dispenses to loopback", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-web-auth-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const port = 21000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [resolve("web/server.mjs")], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      AGENTIC_OS_ROOT: root,
      AGENTIC_OS_DOOR: "/nonexistent-door",
    },
    stdio: "ignore",
  })
  t.after(() => child.kill())
  await waitHealthy(port)

  // the token is minted on boot, owner-only
  const tokenFile = join(root, "window.token")
  const token = readFileSync(tokenFile, "utf8").trim()
  assert.ok(token.length >= 32, "a 32-byte secret, not a placeholder")
  assert.equal(statSync(tokenFile).mode & 0o777, 0o600, "token file is owner-only")

  // reads stay open — no header, still 200
  const health = await fetch(`http://127.0.0.1:${port}/api/health`)
  assert.equal(health.status, 200, "GETs are not gated")

  const del = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/api/job/s-auth01/j-none00/delete`, {
      method: "POST",
      headers,
    })

  // mutation without / with a wrong token -> 401, before any handler
  assert.equal((await del({})).status, 401, "no bearer -> 401")
  assert.equal((await del({ authorization: "Bearer " + "x".repeat(43) })).status, 401, "wrong bearer -> 401")

  // the right token passes the gate — a missing job answers 404, which
  // proves the request reached the route handler, not the gate
  const ok = await del({ authorization: `Bearer ${token}` })
  assert.equal(ok.status, 404, "right bearer passes the gate (404 = route answered)")

  // a foreign Origin is refused even with the right token — Origin is
  // browser-set, so this is the CSRF / DNS-rebind lock
  const csrf = await del({
    authorization: `Bearer ${token}`,
    origin: "https://evil.example",
  })
  assert.equal(csrf.status, 403, "foreign origin -> 403 despite the token")

  // our own Origin is allowed
  const own = await del({
    authorization: `Bearer ${token}`,
    origin: `http://127.0.0.1:${port}`,
  })
  assert.equal(own.status, 404, "own origin passes (404 = route answered)")

  // the boot dispenser serves the loopback caller the file's token
  const boot = await fetch(`http://127.0.0.1:${port}/api/boot`)
  assert.equal(boot.status, 200)
  const bootBody = (await boot.json()) as { token: string }
  assert.equal(bootBody.token, token, "boot hands out exactly the minted token")

  // ...but never across a foreign Origin, even on loopback (rebind lock)
  const bootEvil = await fetch(`http://127.0.0.1:${port}/api/boot`, {
    headers: { origin: "https://evil.example" },
  })
  assert.equal(bootEvil.status, 403, "boot refuses foreign origins")
})
