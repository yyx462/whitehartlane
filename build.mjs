// build.mjs — bundle the doors to plain JS for the npm tarball.
// Why: the dev checkout ships raw TypeScript run via
// `node --experimental-strip-types` (see bin/whitehartlane's shebang), but
// npm's `engines` gate is soft — npm prints EBADENGINE and installs anyway,
// so a raw-TS package would die at runtime on older Node. Bundled plain JS
// runs on anything the engines field admits (docs/research/
// install-landscape.md, Stage 1).
//
// Runtime layout contract (import.meta.url anchors in src — don't move
// these without checking src/jev-prompts.ts, src/jev-tuner.ts, src/hooks.ts,
// the plugin verb, and levy's orchestratorRoot):
//   dist/whitehartlane.mjs        entry (npm bins whl + whitehartlane)
//   dist/orchestrator             runner door, levy-spawned, sibling of the entry
//   dist/jev-prompts/             join(srcDir, "jev-prompts")
//   <pkg>/jev-tuner/gates/        join(dir, "..", "jev-tuner", "gates")
//   <pkg>/global/workflow.toml    REPO_DIR = join(dir, "..")
//   <pkg>/plugin/opencode-wake.js plugin verb source
import { build } from "esbuild"
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync } from "node:fs"

rmSync("dist", { recursive: true, force: true })
mkdirSync("dist", { recursive: true })

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  sourcemap: false,
  logLevel: "info",
}

// The doors are extensionless TypeScript on disk (Node type-strips them in
// the dev checkout). esbuild keys its loader off the file extension, so
// feed each door through stdin with an explicit ts loader and bin/ as the
// resolve dir — relative imports like ../src/run.ts then resolve as usual.
function door(file) {
  const contents = readFileSync(`bin/${file}`, "utf8").replace(/^#![^\n]*\n/, "")
  return { stdin: { contents, resolveDir: "bin", sourcefile: `${file}.ts`, loader: "ts" } }
}

await build({ ...common, ...door("whitehartlane"), outfile: "dist/whitehartlane.mjs", banner: { js: "#!/usr/bin/env node" } })
await build({ ...common, ...door("orchestrator"), outfile: "dist/orchestrator" })

// Data the bundle resolves relative to its own location.
cpSync("src/jev-prompts", "dist/jev-prompts", { recursive: true })

// npm preserves the tarball's file mode for bin targets — without the exec
// bit the global shim dies with EACCES.
chmodSync("dist/whitehartlane.mjs", 0o755)
chmodSync("dist/orchestrator", 0o755)
