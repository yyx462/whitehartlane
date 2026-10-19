# path-predicate — the canonical scope (OPTIMUM §5 replacement)

Slices 1 + 2 of the §5 INVESTIGATE verdict, 2026-10-19. Design record;
the code's comments carry the same story in place.

## Sick → replaced

Three primitives (deny set, under-test, temp set) were re-spelled
across six consumers and drifted. `run.ts`'s admission scan carried a
temp list missing the realpath form, a `~` regex that differed from
coworker-run's, and it counted hard-deny roots "covered" while the
doors stripped them (#77 at one boundary only). `store.ts` seeded only
`/**` while `addWorkerRoot` seeded the bare form too. `rail.ts`
assembled `[cwd, taskDir, …programRoots]` per dialog behind a dead
`opts.roots` override no caller passed. The bins duplicated a 16-line
roots.txt reader each — and #161's bin deletion left the survivor,
`engine.ts programRootsOf`, as a SECOND roots.txt spelling beside the
canonical one: its own file read, its own strip, its own warning.

Now `src/permission.ts` is THE canonical predicate: `declareScope`
(~-expand, LOUD hard-deny-strip, dedupe — idempotent, and quiet on
already-clean roots), `readRootsTxt` / `scopeFromDir` (the one
roots.txt spelling), `decidePermission` (the verdict; dialog-path
repair and root assembly are its internals), `scopeCovers` (the
admission question), `allowGlobs` / `grantRoot` (the pre-seed
projection, both path forms plus realpath, temp in). `Rail` constructs
the scope once; `writePermissions` seeds from it; `store.ts` owns only
file IO. What the door admits is what the run allows — #77 at both
boundaries.

## Deleted

- `Rail.programRoots`, the ladder root-set assembly, the dead opts channel
- `uncoveredBriefPaths`' private roots/temp/`~` copies (drift fixed)
- the glob-spelling duplicates + their `/**`-vs-bare asymmetry
- `normalizeDialogPath` and `TEMP_ROOTS` as exports
- (slice 2) `programRootsOf`'s private roots.txt reader, local strip,
  and own warning — it is now a pure fold,
  `declareScope(readRootsTxt(dir)).roots`, and the loud warning lives
  in the canonical strip: EVERY construction site warns, the runner
  door AND the admission scan
- (slice 2) the `sanitizeRoots` export — internal to the predicate,
  pinned through `declareScope`/`scopeFromDir` instead

## Converged (the closing condition, met)

The component's only path knowledge lives in `permission.ts`:
`programRootsOf` reads no file, spells no deny list, expands nothing —
it names the canonical spelling once, for the one caller that wants
bare roots (`bin/orchestrator` → `Rail`'s `programRoots` opt, which
`declareScope` passes through unchanged). §5 converges to KEEP at the
next refit; nothing else is stated.
