# path-predicate — the canonical scope (OPTIMUM §5 replacement)

Slice 1 of the §5 INVESTIGATE verdict, 2026-10-19. Design record; the
code's comments carry the same story in place.

## Sick → replaced

Three primitives (deny set, under-test, temp set) were re-spelled
across six consumers and drifted. `run.ts`'s admission scan carried a
temp list missing the realpath form, a `~` regex that differed from
coworker-run's, and it counted hard-deny roots "covered" while the
doors stripped them (#77 at one boundary only). `store.ts` seeded only
`/**` while `addWorkerRoot` seeded the bare form too. `rail.ts`
assembled `[cwd, taskDir, …programRoots]` per dialog behind a dead
`opts.roots` override no caller passed. The bins duplicated a 16-line
roots.txt reader each.

Now `src/permission.ts` is THE canonical predicate: `declareScope`
(~-expand, hard-deny-strip, dedupe — idempotent), `readRootsTxt` /
`scopeFromDir` (the one roots.txt spelling), `decidePermission` (the
verdict; dialog-path repair and root assembly are its internals),
`scopeCovers` (the admission question), `allowGlobs` / `grantRoot`
(the pre-seed projection, both path forms plus realpath, temp in).
`Rail` constructs the scope once; `writePermissions` seeds from it;
`store.ts` owns only file IO. What the door admits is what the run
allows — #77 at both boundaries.

## Deleted

- `Rail.programRoots`, the ladder root-set assembly, the dead opts channel
- `uncoveredBriefPaths`' private roots/temp/`~` copies (drift fixed)
- the glob-spelling duplicates + their `/**`-vs-bare asymmetry
- `normalizeDialogPath` and `TEMP_ROOTS` as exports

## Next slice (needs `bin/` edits — outside the gate whitelist)

Fold the doors' roots.txt IIFEs onto `readRootsTxt`/`scopeFromDir`,
delete the duplicated blocks, retire the `sanitizeRoots` export. Then
the component's only path knowledge lives in `permission.ts` and §5
can converge at the next refit.
