# Big Merge — Independent Review Checklist (DAVE, Round 2)

> **Owner:** Dave (architecture/review) · **Status:** ready to execute — run AFTER M1+M2 have landed on the
> merged tree. This is a review checklist, not a verdict; issue per-item findings (P0/P1/P2) against the code.
> English as internal note (per AGENTS convention). Docs-language on any finding refers to German user-facing docs.

## A. File-level gates

1. **Repo hygiene:** `git status` + `git diff HEAD --stat` per milestone commit. Only intended files changed:
   M1 = `packages/tools/src/maker/*` + `public/tools/maker.html` (launcher) + tests; M2 = `packages/tools/src/core/*`
   + compatible re-exports in `packages/tools/src/index.ts` + tests/barrels. No stray edits in `packages/engine/`.
2. **F3 — Forge isolated:** `git diff` shows **no `attachDevTools.ts` change** and **no tool-constructor-signature
   churn**. The four instantiations in `attachDevTools.ts` (`new MapGenerator()`, `new Pixler(app.events)`,
   `new Xtractor(app.events)`, `new MaterialStudio()`) still compile unchanged. In-Game E2E harnesses
   (`scripts/forge-tools-e2e.mjs`, `scripts/xtractor-forge-e2e.mjs`, `apps/showcases/19/index.html`) unmodified.
3. **Diff review:** read every new/changed file under `packages/tools/src/` (maker host/router/modes, `core/`, barrels)
   — no dead code, no commented-out blocks, no scope creep beyond the milestone.

## B. Design review vs. plan (`.agents/collaborate/big-merge.md` §2 D1)

4. **ToolMode ≠ ForgeTool:** the new mode host imports **no forge-owned types** where avoidable
   (`grep -ri "forge" packages/tools/src/maker/ToolMode*.ts packages/tools/src/maker/ToolModeHost.ts`).
   `ToolMode` is its own lifecycle contract (mount/unmount/state); ForgeTool remains in-game only.
5. **No global singleton:** host/router receive dependencies via constructor/Context Object; no module-level
   shared mutable state; multiple engine instances per page still possible.
6. **Per-tool undo:** Maker `UndoStack` stays per tool/document (≤50 cap), never one global rail; Pixler bitmap
   history (`Pixler.ts:933-952`) untouched.
7. **Entry-alias semantics:** router boots `maker.html#<mode>`; legacy URLs stay reachable; internal mode switch is a
   pure in-app view swap (no `location.replace` document swap that would kill FS-Access/ProjectBinding state) — if an
   alias flip exists, the E2E re-point (xtractor-e2e) is honored.

## C. Core boundary (F1/F5, `npm run`-free greps)

8. **Grep gate F1:** `grep -rnE "getContext|document\.|window\." packages/tools/src/core/` → **0 hits**.
9. **Core import whitelist:** `grep -rh '^import' packages/tools/src/core/ | sort -u` — only `@small-world-machine/engine`,
   relative `common/` pure pieces, and core-internal modules; no DOM/`vite`/tweakpane/fs-access types.
10. **RasterIO (F5):** core never decodes PNG/canvas itself; all image data flows as RGBA via the `RasterIO` interface
    (pngjs adapter for Node, `createImageBitmap`/`Image` adapter for Web); the codec boundary is the only decode point.
11. **Purge `MapGenerator.loadFromImage`:** extracted map path is pure pixel-ops (no `ctx.drawImage`+`getImageData`);
    the web panel points to the same kernel (F1 closed, no behavioral drift through nearest-neighbor scaling).

## D. Backward compatibility (G5)

12. **Typecheck + build:** `npm run typecheck`, `npm run build:lib` green — pages and Forge still compile.
13. **Barrels keep legacy names:** `packages/tools/src/index.ts` (and `core/` barrels) re-export the previous API
    surface; `map-gen/pixler/xtractor/pbr-gen/ibl-gen` pages resolve their imports unchanged.
14. **Tests green:** `npm run test` — existing tool tests (RasterIO/ibl-core/CanvasOps etc.) plus new M1/M2 tests pass;
    Forge E2E harnesses logically unaffected (F3).

## E. Code quality gates

15. **Strict types:** no `any` in new core/shell code; `npm run lint` clean (explicit types/access modifiers).
16. **No new runtime deps:** `git diff packages/tools/package.json` shows no addition in M1/M2 (pngjs → prod-dep is an
    M5 CLI-packaging move, not M1/M2). No PDE/browser-only surprises in `core/`.

## F. Docs consistency (C7 / append-only)

17. ADR **0030**/**0031** are marked **DRAFT**, listed in `docs/adr/index.md`; scope clamps honored (0030: no CLI
    details / no Kit-Splatter panel ratios; 0031: no web-shell decisions / no verb list / no GLB writer).
18. `CONTEXT.md` terms coherent and not over-claimed: **Maker Mode / ToolHost**, **Workspace/Project**
    (marked "planned, not yet implemented"), **Headless Operation** — no claim that Workspace ships today.
19. `packages/tools/src/maker/docs/log.md`, `.agents/notes/backlog.md`, `CHANGELOG.md` **appended** only —
    `git diff` shows additions at expected positions, no history overwritten/rewritten.

## Deliverable

Numbered findings (P0 = gate-blocking, P1 = major, P2 = minor/doc) with `file:line` references and the exact
remediation; no code changes while implementing this review — report only.
