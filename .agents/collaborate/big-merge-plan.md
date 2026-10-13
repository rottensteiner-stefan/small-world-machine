# BIG MERGE — Master Plan Briefing (Parallel Agents)

- **Document type:** `collaborate` — `plan` mode master briefing (parallel blackboard).
- **Language:** Agent-facing content in **English** (skill rule); user-facing German only in §0 and in the final `big-merge.md`.
- **Input (read this file):** `.agents/collaborate/big-merge-plan.md`
- **Deliverable (write this file):** `.agents/collaborate/big-merge.md` — the final, consensus-backed implementation plan (German, as the human moderator reads it).
- **Scope of this session:** PLANNING ONLY. No source code changes. The output is a decision-backed implementation plan (plus ADR drafts as content of that plan).
- **Required skill:** Every agent MUST read `.agents/skills/collaborate/SKILL.md` + companion `blackboard.md`, `discussion-phase.md`, `commands.md` first, and follow the blackboard protocol via `node .agents/skills/collaborate/collab.mjs`.
- Additional skills to consult: `domain-modeling` (ADR drafts), `maintain-references`, `changelog`, `deslop` (prose), `coding-guide` (feasibility of the headless/CLI architecture in strict TS).

---

## 0. Executive Summary (German — for the human moderator)

**Auftrag:** Alle Entwicklungswerkzeuge von Small World Machine (Maker, Xtractor bzw. „Extractor", Pixler bzw. „Spriter-Editor", Map Generator, Material Studio/PBR-Gen, IBL-Gen, Kit-Inspector, Splatter-Gen, Forge) sollen zu **einem einzigen Werkzeug** verschmolzen werden — dem **Maker** als einheitliche Oberfläche. Derselbe Funktionskern soll künftig **auf zwei Wegen** bedienbar sein:

1. **Web („wie bisher"):** die bestehende, schöne Browser-Oberfläche wird die vereinheitlichte Maker-UX, alle bisherigen Tool-URLs bleiben erreichbar.
2. **CLI:** eine echte Kommandozeilen-Schnittstelle (z. B. `swm …`), die denselben Kern headless bedient. Nicht jede interaktive Fähigkeit (Gizmos, Viewport-Feeling) ist per CLI abbildbar — die Agents müssen eine **pragmatische, sinnvolle Teilmengen-Abgrenzung** treffen, ohne ein monströses Interface zu bauen.

Das ist eine harte Architekturvorgabe (Verschmelzung + Dual-Interface). Deshalb läuft die Umsetzungsplanung als **parallele Multi-Agent-Session**, in der verschiedene Umsetzungswege **als Vorschläge diskutiert, gegeneinander bewertet und per Konsens entschieden** werden. Dieses Dokument schreibt den Rahmen: Pflichtziele, harte Constraints, der verifizierte Ist-Zustand, die Entscheidungspunkte (D1–D6), die Aufgabenteilung der Agents, den Blackboard-Ablauf und die Qualitätsgates. Das Ergebnis dieser Session ist **nur der Plan** (`big-merge.md`), keine Code-Änderung.

---

## 1. Mission

Design a phased, decision-backed implementation plan that transforms the set of standalone browser tools of `@small-world-machine/tools` into a **single unified tool (Maker)** whose **shared headless core** is driven by **both** (a) a polished web UI (the merged Maker app, preserving/redirecting all existing `public/tools/*.html` entry points and the in-game Forge integration) **and** (b) a **real CLI** (`swm <command>`) that runs the same core without a browser.

The plan MUST NOT be authoritative before the team achieves consensus on every decision point below (definition of agreement in SKILL.md §4).

### Mandatory goals (Phase A — non-negotiable end state)

- **G1 — One tool:** All authoring tools merge into Maker as integrated modules/panels/tools within one application shell. No more separate app roots for Maker/Xtractor/Pixler/MapGenerator/MaterialStudio/pbr-gen/ibl-gen/splatter-gen/kit-inspector.
- **G2 — Dual interface from the same core:** Extract the *domain logic* of each tool into a **framework-agnostic, headless core** (pure TS, no DOM/GL as a hard requirement) that is consumed by BOTH the web UI and the CLI. No duplicated logic, no second implementation.
- **G3 — CLI exists and is genuinely useful:** A real, shippable CLI (own `bin` entry in `@small-world-machine/tools`, wired into the repo toolchain) exposing the *pragmatic subset* of operations that make sense non-interactively (asset ingest/convert/crop/slice, map ASCII<->GLB, material texture map generation, IBL bake, kit validation/inspection, scene glTF/texture export, batch operations, headless rendering where it matters). Rationale for the subset selection must be explicit — the user accepts that a CLI cannot surface *all* interactive capability (Gizmos, drag & drop, viewport feel) without an over-engineered interface; we deliberately do NOT build that.
- **G4 — Web stays the beautiful primary surface:** The merged web app is the power-user surface (keyboard-driven, modal bindings, snapping, low friction — see AGENTS.md persona). All existing `public/tools/*.html` URLs keep working (as redirects/sections into the merged app, or retained as thin wrappers where functionally required) and `attachDevTools` Forge integration keeps working.
- **G5 — No regressions, migration-safe:** Engine stays lightweight (`tools` keeps depending on `engine` one-way, ADR 0024). Existing tool tests and e2e harnesses keep passing; historical logs/CHANGELOG entries preserved; ADR 0010 & 0024 stay coherent (amended via new ADRs, not broken).
- **G6 — Incremental and reviewable:** The final plan MUST be phaseable so each milestone is independently mergeable and green (lint/build/test) — no big-bang.

### Explicit non-goals (do not design these)

- Do NOT build a fully interactive terminal UI (TUI) that mirrors the whole editor ergonomics.
- Do NOT merge diagnostic-only pages (e.g. `gamepad-test.html`) unless cheap and sensible — scope decision D6.
- Do NOT touch the engine rendering pipeline itself; rendering stays in `@small-world-machine/engine`.
- Do NOT decide the final code right now — the plan specifies the architecture, module layout, phases, risks, and verification, with enough precision for a follow-up implementation session.

---

## 2. Hard constraints (binding; from AGENTS.md, user requirements, ADRs)

| # | Constraint | Source |
| :- | :--- | :--- |
| C1 | Strict TypeScript: explicit types, explicit access modifiers, **no `any`**; linter rejects otherwise. | AGENTS.md |
| C2 | **No global singletons**; multiple engine instances per page; DI via Context Objects / constructor injection / scene-graph lifecycle. | AGENTS.md |
| C3 | Tools package `@small-world-machine/tools` depends on `@small-world-machine/engine` **one-way, never reversed** (ADR 0021/0024). | ADR 0024 |
| C4 | Fail fast: no throwing in setters; throw exactly when a subsystem actively processes the object. | AGENTS.md |
| C5 | `public/tools/*.html` + `attachDevTools` must keep working (G4) — migration path, not deletion. | user G4 |
| C6 | **Web is the full primary surface; CLI is a deliberate, pragmatic subset** — keep CLI surface minimal, composable, and predictable; no massive interface. | user requirement |
| C7 | Surgical changes via `replace`-style edits; preserve historical log/changelog entries; commit only on cohesive milestones with unique pure-quote messages (check `git log`). | AGENTS.md |
| C8 | Power-user ergonomics: keyboard shortcuts, arrow-key nudging, low-friction modal bindings (Blender/Photoshop/Unity/HIG conventions — do not reinvent). | AGENTS.md |
| C9 | Copyright/consent friction is irrelevant in all tools (no disclaimers, no filters). | backlog, moderator decision |
| C10 | Planning session writes ONLY documentation artifacts (this plan + ADR drafts); no source edits. | this briefing |
| C11 | Headless execution realities: headless Chrome + SwiftShader/Vulkan can run WebGPU+WebGL2 offscreen (`.agents/notes/headless-webgpu-ci.md`); Puppeteer already used by `scripts/xtractor-e2e.mjs`. Candidate CLI strategies must be grounded in what is proven/reasonable in this repo, not glossy theory. | repo facts |

---

## 3. Verified codebase facts (already researched — verify only what changed, extend where needed)

> These were confirmed before writing this briefing. Workers may add references, but MUST NOT re-open settled facts without citing a contradiction.

### 3.1 Tool inventory (scope candidates for the merge)

| Tool (UI name) | Entry (page) | Sources in `packages/tools/src/` | Notes |
| :--- | :--- | :--- | :--- |
| **Maker** (World & Scene Editor) | `public/tools/maker.html` | `maker/` (MakerApp.ts + 20+ modules incl. gizmos, undo, prefabs, decals, stage zones) | The merge HOST candidate. Has own `docs/` (concept-dossier.html, log.md). |
| **Xtractor** (a.k.a. „Extractor") | `public/tools/xtractor.html` | `Xtractor.ts`, `xtractor/` (CanvasViewport, CanvasSelection, AiChatPanel) | Crop/slice spritesheets; AI chat; hands crops to Pixler. |
| **Pixler** (a.k.a. „Spriter-Editor") | `public/tools/pixler.html` | `Pixler.ts` | Retro pixel art editor; toolbar, symmetry, undo/redo; receives Xtractor crops. |
| **Map Generator** | `public/tools/map-gen.html` | `MapGenerator.ts` | Grid editor -> `GridLevelBuilder` ASCII export. |
| **Material Studio** (PBR map gen) | `public/tools/pbr-gen.html` | `MaterialStudio.ts`, `material-studio/` | Diffuse -> derived PBR maps; sandbox preview mesh. |
| **IBL Generator** | `public/tools/ibl-gen.html` | `ibl-gen/` (ibl-gen.ts, ibl-gen-core.ts, IBLShaders.ts) | Offline IBL bake (already proven Node-ish core). |
| **Kit Inspector** | `public/tools/kit-inspector.html` | `kit-inspector/` + `KitInspectorApp.ts` | Asset kit manifest validation/inspection. |
| **Splatter Generator** | `public/tools/splatter-gen.html` | *(self-contained inline HTML/JS/WGSL — no TS source)* | Procedural splatter textures; may need porting if merged. **Watch: no TS core exists.** |
| **Gamepad Test** | `public/tools/gamepad-test.html` | *(self-contained)* | Diagnostic; likely stays separate (see D6). |
| **Forge** (window/dock manager) | — (overlay) | `forge/` (Forge, ForgeWindow, ForgeTheme) | Host used by `attachDevTools`; still exposes `ForgeTool` windows in-game. |

### 3.2 Entry points & wiring

- `vite.config.ts` rollup `input` lists each page separately (exports to `js/tools/<name>.js`): pbrgen, iblgen, pixler, mapgen, xtractor, splattergen, gamepadtest, maker, kitinspector re `vite.config.ts:262-286`.
- `public/tools/*.html` import TS sources directly from `packages/tools/src/...` (e.g. kit-inspector.html imports `KitInspectorApp.ts`); some pages are fully self-contained inline HTML (splatter-gen, gamepad-test).
- `attachDevTools(app)` (`src/attachDevTools.ts`) creates a Forge hub with the built-in window tools bound to **Ctrl/Cmd+Alt+G** — replaces old `enableInspector` (ADR 0024). `ForgeTool` interface stays in the engine (`core/forge/`).
- `scripts/sync-tools.js` repackages the standalone tool HTML pages into unified header/footer templates — will be affected by any migration of the tool pages.

### 3.3 Shared infrastructure already present (leverage, don't duplicate)

- `src/common/ai/` — multi-provider vision (Claude/Gemini/OpenAI/Ollama/HTTP) + `AiConfigStorage`.
- `src/common/io/` — **Universal ingest** (`UniversalIngestRouter`, sources: Drop/File/Http/Zip/Directory; sinks: Directory/Download/Zip; `safeUnzip`, `KitManifestValidator`, `svgNormalize`, `PbrSlotMatcher`, `Security`).
- `src/common/image/` — CanvasOps, undo history, SmartSegmentation, BackgroundRemoval.
- `src/common/dsp/` — CanvasOperations, TextureFilters.
- `src/common/io/ui/` — toolHost, CommandHistory, ToastManager, dropzone/ingest panel, shortcuts (`bindToolShortcuts`).
- Root `package.json` has `pngjs` dependency (used by scripts/e2e harnesses).

### 3.4 CLI state today

- **There is NO CLI.** `packages/tools/package.json` has no `bin`, no `exports` for a CLI; nothing under `scripts/` is user-facing CLI tooling.
- Closest precedents for HEADLESS execution:
  - `scripts/xtractor-e2e.mjs`, `scripts/xtractor-forge-e2e.mjs`, `scripts/forge-tools-e2e.mjs` — Puppeteer driving the dev server (XTRACTOR_URL override), in-process OpenAI mock.
  - `scripts/goldens/capture.js` + `headless-webgpu-ci.md` — headless Chrome SwiftShader/Vulkan runs WebGPU+WebGL2.
  - `scripts/ibl-bake.ts` (`npm run ibl:bake`) — a **Node-side** offline pipeline (seed/out args) — the closest thing to a CLI today.
  - `scripts/pbr.sh` — shell-driven texture generation for materials.
- So the CLI strategy will likely need to combine: (a) pure-TS core extraction of image/procedural ops (Node API), and (b) where a canvas/GL context is unavoidable, either a Node canvas shim or headless-browser execution — this is precisely a decision point the team must evaluate (D3).

### 3.5 Tests & gates

- `npm run lint:fix`, `npm run build:lib`, `npm run test` (vitest) are the repo gates; `npm run typecheck` (tsc --noEmit). e2e harnesses live in `scripts/`.
- `packages/tools/tests/` exists (Maker/MaterialStudio tests live there).

---

## 4. Decision points (deliberation REQUIRED — proposals + counter-proposals + votes)

For EACH D below the team must generate **at least two viable, materially different routes**, present them as formal proposals (`post-proposal` → `post-vote`), evaluate with a **tradeoff matrix** (effort, risk, reversibility, alignment with constraints C1–C11, power-user UX, CLI quality), and reach consensus. Genuinely unresolved forks go to the moderator (`/collaborate --decide`).

### D1 — Merge architecture / host shell
*Seed routes to consider (extend with your own):*
- **1A** Maker as the single app shell; every other tool becomes a dockable/switchable module **inside** Maker (unified toolbar/modes/panels), sharing one Chromium window and one scene/project workspace.
- **1B** A new neutral „Studio" host that subsumes Maker + all tools as first-class modes (Maker = one mode among many) — renamed branding.
- **1C** Keep each tool's DOM isolated as an iframe/tab-driven „app" inside a shared launcher shell (minimal integration, fastest, but weakest unification of state/undo/asset flows).
Evaluate: real unification of state (single undo scope? per-tool scopes?), asset flow (one ingest/one project dir?), keyboard ergonomics, migration cost, long-term maintenance, and how each route affects the shared-core extraction (G2). Recommend ONE with a short justification and a fallback.

### D2 — Headless core extraction model
*Seed routes:*
- **2A** **Core/extractor-first:** for each tool, split into `core/*` (framework-agnostic domain logic, pure TS, testable headless — e.g. `XtractorCore`, `PixlerOps`, `MapDefConverter`, `MaterialMapPipeline`, `IblBakePipeline`) + thin `ui/*` shells that call the core. Web UI and CLI both consume `core`. (Strongest fit for G2/G6, highest upfront refactor cost.)
- **2B** Thin-controller forwarding: keep current tool code, add headless controllers that re-implement the CLI path with separate minimal logic (fast to ship, but duplicates logic → violates G2).
- **2C** Headless via browser automation only (Puppeteer drives the existing UI for CLI) — max reuse, worst perf/latency/lifecycle story, couples CLI to the dev-server/browser.
Decide the extraction granularity (per-tool core modules vs. one shared pipeline core), the boundary rules (what may live in `core` vs `ui`), and how canvas/GL-dependent steps are isolated behind an interface (see D3).

### D3 — Canvas / GL / Node-runtime strategy for headless core
The single most consequential technical fork. Evaluate concrete, repo-grounded options:
- **3A** Node-native core using a canvas shim (@napi-rs/canvas / node-canvas / pure-RGBA ops) for 2D algorithms (crop, splice, pixel ops, material map convolution) — no browser needed; IBL/Splatter/GL-dependent steps handled separately.
- **3B** Headless-Chrome execution for GL-dependent steps (IBL preview, Material Studio sandbox, goldens-style captures) invoked by the CLI as a subprocess only where needed (proven pattern in this repo).
- **3C** Hybrid: 3A for the bulk 2D/procedural/aggregate ops, 3B for the specific render-dependent steps. Quantify rendering-dependent vs. pure-data steps per tool before proposing (a short per-tool table of "headless-feasible / needs-GL" is expected in the plan).
- **3D** Move the whole CLI into the browser-less Vite/Node ecosystem via `tsx` entry (already used in repo scripts) vs. build a compiled binary — evaluate packaging (`bin` field, shebang, deps footprint).
Criteria: dependency bloat vs. fidelity; determinism for tests; whether `pngjs`-style pure ops suffice for each tool's CLI subset.

### D4 — CLI surface design (`swm`)
- Propose the **command taxonomy + concrete command tree** (`swm <tool> <verb> [flags]` — e.g. `swm xtract --sheet x.png [--out dir] [--auto]`, `swm map import --ascii lvl.txt --out lvl.gltf`, `swm material-gen --diffuse d.png --out maps/`, `swm ibl bake ...`, `swm kit validate <dir>`, `swm scene export ...`), `--help`, exit codes, streaming/logging conventions, where it's installed, and how it is documented (guides + `references`). Constraint C6: keep it minimal, composable, non-interactive-first; **explicitly list which interactive capabilities are NOT surfaced and why.**
- Decide: single `swm` umbrella vs. per-tool binaries (`swm-maker`, `swm-xtract`...); JSON output mode for scripting (`--json`) — recommended given repo's test/automation culture; config file vs. flags only (reuse `AiConfigStorage`?).

### D5 — Sequencing / rollout & migration of the web surface
- Propose an **incremental phase plan** (G6): each phase = independently green milestone mapping D1/D2 outcomes to code steps, including: new `public/tools/*.html` URL strategy (redirects? consolidated page? keep as thin mode-wrappers), `sync-tools.js` impact, `attachDevTools`/Forge integration, docs (guides `forge/maker/xtractor/pixler/map-generator/material-studio`, new `docs/guides/*` for the merged app + CLI), CHANGELOG + app `log.md` (Maker docs) + CLI docs. Define rollback for each phase.
- Risk register: the biggest regressions (e2e harnesses, build inputs, kit-inspector/splatter-gen port, AI provider wiring) MUST appear as explicit plan items with owners.

### D6 — Scope of merger (which pages merge, which stay)
Verify and decide on the **authoritative merged scope** (the „etc." the user left open): Maker, Xtractor, Pixler, Map Generator, Material Studio (pbr-gen), IBL Gen, Splatter Gen, Kit Inspector — which merge fully (→ in Maker), which are ported only if cheap (splatter-gen has no TS core), which stay as diagnostic (gamepad-test), and whether `attachDevTools`/Forge windows remain available inside the merged app or only in-game. Justify each line item with effort/risk.

---

## 5. Parallel work packages (team of 4 — split, minimal overlap)

Start the session with `board-init big-merge Alice --role "Lead Coordinator"` (commands in SKILL.md commands.md §1). Mark unavoidable overlaps with `[OVERLAP: …]`.

- **Alice — Coordinator / Lead:** milestones from §5/§4 briefs; synthesizes proposals; owns the final `big-merge.md` assembly (German), consensus bookkeeping, moderator escalation. Also drafts Phase-A shared-goals summary (deliverable §7, §1) and the quality-gate checklist (§8).
- **Bob — Architecture & Merge Design:** owns **D1, D2** research + proposals (shell architecture, core-extraction model, module/package layout, per-tool headless-feasibility table for D3). Must read `docs/guides/maker.md`, `forge.md`, `material-studio.md`, ADR 0010 + 0024, and `packages/tools/src/maker/` + `common/`. Outputs: architecture section of `big-merge.md` + ADR draft(s).
- **Charly — Headless/CLI Engineering & Test Strategy:** owns **D3, D4** (Node/canvas/GL strategy, `swm` surface design) + the verification plan (how each `swm` subcommand is tested: unit + e2e, determinism, `npm run test`/lint/build gates, golden-style checks). Must read `scripts/xtractor-e2e.mjs`, `scripts/ibl-bake.ts`, `pbr.sh`, `.agents/notes/headless-webgpu-ci.md`, `packages/tools/package.json`, `src/common/io/` (UniversalIngest is the natural CLI ingest base). Outputs: CLI design + test/verification chapter of `big-merge.md`.
- **Dave — Ecosystem Integrity, Migration & Docs:** owns **D5, D6** (phasing, migration of web surface, URL strategy, `sync-tools.js`/vite impact, Forge/attachDevTools impact, docs & changelog/logs, risk register) + domain-modeling (new concepts → CONTEXT.md, ADRs) and `maintain-references` (REFERENCES.md additions e.g. CLI conventions). Must read `vite.config.ts` tool inputs, `scripts/sync-tools.js`, `docs/adr/index.md`, `docs/guides/index.md`, `CONTEXT.md`, `.agents/notes/backlog.md`, the `domain-modeling` skill. Outputs: phasing/migration/risk chapter + ADR drafts in `big-merge.md`.

> **Deliberation loop (user requirement):** after each worker completes its first-pass proposal set, run at least one formal **critique round** where every other worker posts counter-proposals or DISAGREE-votes with reasoned evaluation (tradeoff matrices) on the other tracks' decision points (D1↔D3 and D2↔D4 cross-impacts are the hot overlap zones), before any consensus vote is recorded.

---

## 6. Collaborate session workflow (do this, in order)

1. `node .agents/skills/collaborate/collab.mjs board-init big-merge Alice --role "Lead Coordinator" --max-agents 4`
2. `post-task` for §5 packages (T1 architecture/merge — Bob; T2 CLI + tests — Charly; T3 migration/docs/scope — Dave; T0 gait/shared-goals — Alice).
3. Workers research in parallel (read-only, no code), then post their **seed proposals per decision point** (`post-proposal … P<n> …`).
4. Cross-critique round (§5 ¶ after the table); then each worker `post-vote … AGREE/DISAGREE --reason …`.
5. Alice resolves overlaps, escalates unresolved forks to moderator `/collaborate --decide`.
6. On consensus (definition per SKILL §4): `resolve-board big-merge Alice --outcome CONSENSUS` and `render big-merge`.
7. **Final assembly (in your own words, German):** rewrite the rendered board into a polished `big-merge.md` meeting §7 spec. This file is the ONLY permanent artifact (keep the `.board.jsonl` for provenance; leave the `render` skeleton reviewed).

---

## 7. Deliverable spec — `big-merge.md` MUST contain

1. **Goals & non-goals** (from §1), restated crisp.
2. **Target architecture** (D1/D2 decision): single-tool shell layout, `core/` vs `ui/` boundaries, module/package changes (`packages/tools` layout sketch, new files/moves), dependency graph (respecting C3).
3. **Headless/CLI chapter** (D3/D4): runtime strategy per tool (table), `swm` command reference (tree, flags, `--json`, exit codes), rationale for the **excluded** interactive subset (C6), packaging (`bin`, deps), install/update path.
4. **Web-surface migration chapter** (D5/D6): merged app UX, URL strategy for ALL existing `public/tools/*.html` (+vite + `sync-tools.js` impact), `attachDevTools`/Forge impact, docs updates (guides/CHANGELOG/log.md) — preserving historical entries (C7).
5. **Phased implementation roadmap** (G6): concrete milestones M1..Mn; per milestone: scope, files, tests, gates (lint/build/test/typecheck/e2e), rollback, and which ADR/domain changes land when.
6. **Risk register:** per-risk likelihood/impact/mitigation; **explicitly** the high-risk set (e2e harness regressions, splatter-gen port, AI provider wiring, canvas/GL strategy failure modes).
7. **ADR draft(s)** — at minimum one covering the merge architecture and one covering the headless-core/CLI boundary (create under `docs/adr/` as draft content inside this plan for later promotion; check `docs/adr/index.md` first).
8. **Verification strategy** (from Charly): how every CLI command and every merged module is tested, determinism, coverage of both WebGL2 and WebGPU where relevant.
9. **Definition of Done** for the whole effort + explicit statement of what stays deliberately out of scope.
10. **Language:** German, precise, with file:line references (AGENTS.md style), no AI-slop (`deslop` skill).

---

## 8. Quality gates (before Alice declares the session done)

- [ ] All D1–D6 resolved with recorded AGREE votes; any DISAGREE resolved or escalated.
- [ ] `big-merge.md` exists, meets §7 spec, is German, references actual files with paths/lines.
- [ ] No source files were modified by this session (verify via `git status` — only the two `.md` files + board artifacts may be new).
- [ ] Gates run & reported: `npm run lint`, `npm run build:lib`, `npm run test`, `npm run typecheck` still green (proves planning didn't break anything and reference points are accurate).
- [ ] Domain model / references noted where the final plan introduces new vocabulary (via `domain-modeling` / `maintain-references` conventions, content folded into the plan).
- [ ] Coordinator summary block appended (German) with the session outcome, key decisions, and the recommended next action for the *implementation* session.
