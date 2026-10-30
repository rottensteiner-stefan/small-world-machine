# AGENTS Instructions & Coding Standards

**Context:** Small World Machine is a custom, lightweight 3D engine written in strict TypeScript supporting hybrid WebGL/WebGPU rendering pipelines.

## 1. Core Workflow & Token Saving

- **Planning:** Require detailed plan approval only for major features, complex refactorings, or architectural changes. Small edits, bugfixes, asset generation, and documentation updates should be implemented directly without blocking for prior approval.
- **Git Permissions & Commit Cadence:** You are explicitly authorized to execute git operations without asking, BUT **do NOT commit immediately after every single micro-edit/change**. Wait until a feature/milestone is cohesively rounded off or the user signals/requests a commit. Every commit message MUST be a pure quote without author/prefixes, and never reused (check `git log` first).
- **Surgical Changes:** Use `replace` tool for edits. NEVER use `write_file` on existing files.
- **Data Integrity:** Preserve historical entries in logs/changelogs.
- **File Storage:** Store scratchpads, sketches, and temporary files locally in the project under `.agents/scratches`, not in the hard-to-reach agent-specific AppData directory. Exceptions are regular assets or artifacts where the target location is known and logical.
- **Verification:** Run `npm run lint:fix`, `npm run build:lib` and `npm run test` proactively after making changes to catch errors before committing.
- **Communication & Language Standard:** User chat is in German (human preference). All internal documentation, `.agents/MEMORY.md`, `.agents/BACKLOG.md`, ADRs, architecture guides, code comments, and commit messages are written in **compact, high-density technical English**. English reduces token footprint by 20–40% (avoiding BPE subtoken fragmentation on German compound words) and aligns directly with code tokens and 3D web specifications.
- **AI-Optimized Markdown Structure:**
  - *Structure over Prose:* Favor bullet lists, key-values, and tabular matrices over long narrative paragraphs.
  - *Exact Identifiers in Backticks:* Quote code symbols, uniforms, configs, and file paths (e.g. `RendererType.WEB_GPU`, `u_dirEVSMMap`) for direct attention-head anchoring.
  - *Rule-First / Invariant-First:* State the invariant, constraint, or finding at the beginning of the bullet; do not bury conclusions behind conversational lead-ins.
  - *Zero Slop / Telegram-Style:* Strip all filler phrases, emotional padding, and conversational recaps. Keep statements dense and factual.
- **Terminal Commands:** You are explicitly allowed to run read-only shell commands (like `grep`, `tail`, `cat`, `ls`, `find`, `git log`, `git diff`), image manipulation tools (`sips`), asset download commands (`curl -sL "https://tripo-data...`), Git operations (`git checkout`, `git add`, `git commit`, `git push`, `git log`, `git branch`), as well as safe project scripts (`npm run lint`, `npm run build`, `npm run test`) in the terminal WITHOUT asking for permission.
- **Simplicity:** Keep things as simple as possible. Strictly avoid overengineering or preemptive abstraction. Complexity arises naturally on its own.
- **User Workflow / Persona:** The user is an experienced digital artist/power-user (Photoshop veteran on Mac). Always prioritize robust, high-efficiency keyboard shortcuts, arrow-key nudging/transformations, and low-friction modal key bindings across all tools and editors.
- **User Responsibility & Unrestricted Tooling:** The user carries the sole and ultimate responsibility for all workflows, prompts, content, assets, and licensing. Technical implementations and developer tools must never impose moralizing disclaimers, patronizing checks, or artificial copyright barriers. Build pragmatic, unhindered, high-performance tools.
- **Sparring & Industry Benchmark Doctrine:** When discussing new features, UX, or UI ideas, act as an active sparring partner with a "critical architect hat". Benchmark every proposal against established industry standards (*Unity, Blender, Unreal, Godot, Figma, Photoshop, macOS HIG*). Do not reinvent the wheel: adopt proven muscle-memory conventions, eliminate tooling bloat, and make workflows lightning-fast and intuitive for Small World Machine.
- **App Docs Convention:** Every app under `apps/<app>/` has a `docs` subfolder with `concept-dossier.html` (visual concept) and `log.md` (living dev log). The `log.md` is the primary memory for that app — read it at session start, append an entry at session end. Full rules: `docs/guides/app-docs-convention.md`.

## 2. Core Architectural Laws

- **The Godot & PlayCanvas Doctrine (Architectural North Stars):** Small World Machine merges the ergonomics and node-composition spirit of **Godot** with the lightweight, browser-native performance and zero-GC discipline of **PlayCanvas**:
  - *Schlanke Modularität:* Keine aufgeblasenen Allround-Monsterklassen. Alles ist ein präziser, komponierbarer Baustein (`Behavior`, `SceneNode`).
  - *Schnelle Iteration:* Null Sekunden Build-Overhead, sofortiges Feedback direkt im Browser.
  - *Ehrliche Abstraktionen:* Intuitive High-Level-APIs (z. B. `camera.flyTo(...)`) auf einem transparenten, soliden Low-Level-Fundament ohne Magie.
  - *Browser-Nativität:* Von Grund auf für WebGL2 und WebGPU in modernem TypeScript gebaut – keine C++-Desktop-Altlasten, die krampfhaft per WASM in den Browser gepresst wurden.
  - *Zero-GC & Hot-Path-Disziplin:* Allokationsfreie Frame-Loops (`update(deltaTime)`), Strukturierung über TypedArrays und speicherschonendes Pooling.
  - *Leichtgewichtiger Footprint:* Schnelle Ladezeiten und schlanke Builds statt hunderter Megabyte Engine-Ballast.
  - *Pragmatismus statt Dogmatismus:* Kein 100%-Purismus-Anspruch (illusorisch). Wir folgen diesen Prinzipien so weit wie architektonisch sinnvoll und praxistauglich — das exzellente, spielbare Ergebnis und die Entwicklerfreude stehen immer im Mittelpunkt.
- **Whack-a-Mole-Doktrin (ADR 0047, verbindlich):** Die 5 Goldenen Prinzipien (S2 §4) sind Engine-Doktrin gegen Schleichkomplexität. Neue öffentliche Parameter im auditierten Hot-Scope werden klassifiziert (`@domain`/`@derived`/`@fixed` + einzeilige Bedeutung); geteilte Abstraktionen brauchen ≥3 semantische Konsumenten (ADR-0038-Infrastruktur ausgenommen); modeful Objekte konvertieren Zustand explizit (Transitionstest); mathematische Behauptungen referenzieren die Invarianten-Registry (`@invariant <ID>`); Fail-Closed/Honest-Fallback nur für render-kritische Capabilities (ADR 0043). Anti-Dogma-Kalibrierung: Verträge binden, Heuristiken verdienen ihre Schärfe per eigener Rule of Three — geprüft über **genau ein** Skript `npm run check:doctrine` (Exit 0/1/2, kein ESLint-Plugin). Fang-/Rekalibrierungs-Nachweis: `docs/reference/doctrine-ledger.md`.
- **Right-Handed System:** +X=Right, +Y=Up, +Z=Backward (-Z=Forward/Front).
- **Behavior System:** Entities like Cameras use the Behavior system rather than specific controller arrays. Use `camera.addBehavior(new OrbitController())` instead of managing controllers directly.
- **No Global Singletons:** Small World Machine must support multiple engine instances per page. Never use global singletons. Pass dependencies via Context Objects, Constructor Injection, or Scene Graph lifecycle methods.
- **Strict Types:** Explicit types, access modifiers, and **NO `any`**. The linter will instantly reject it. Use explicit casting or generics.
- **Lifecycle & Fail Fast:** Follow the "Fail Fast" principle to catch invalid states immediately. However, **never throw exceptions in property setters** if the required properties might only be assigned in subsequent lines. Throw exactly when the subsystem actively processes the object.
- **Tiered Renderer Autonomy (No API-Parity Cap):** Two independent axes. **API tier** (WebGPU / WebGL2 / WebGL1) = capabilities; **performance tier** (weak … strong device) = speed. WebGPU must NEVER be degraded, constrained, or stripped of features (e.g. compute pipelines, 3D froxel grids, clustered light lists, 3D temporal reprojection, storage textures) *because a lower API tier lacks them*. Every renderer operates at its maximal API capabilities. Lower API tiers (WebGL2, WebGL1) implement the best possible fallback tailored to their hardware/API constraints (e.g. half-res raymarching + bilateral upsampling in WebGL2, analytical fog in WebGL1), sharing mathematical and optical concepts where possible, but never holding WebGPU back to a least common denominator. Independently of that, **any** renderer may swap a feature for a cheaper variant (e.g. froxel → analytical fog) or scale budgets (resolution, samples, radii, counts) based on the performance tier (DeviceCaps estimate + runtime frame-time governor) when the device would otherwise miss its frame budget. Config hints > cached tier > heuristic estimate; the governor always runs underneath. Cross-tier look consistency is guarded by golden tests with tolerances.

## 3. Detailed Skills

Detailed coding standards, formatting, shader logic, and domain knowledge are outsourced to skills under `.agents/skills/` to save context tokens. **Always read the relevant skill before starting a task:**
- `coding-guide`: For TS templates, DOM assignments, Enum rules, Shader optimizations, Rendering pipeline rules, Hot-path TypeScript performance, and Testing.
- `changelog`: For release standard and commit rules.
- `domain-modeling`: For maintaining `CONTEXT.md` and recording architecture decisions as ADRs (`docs/adr/`).
- `maintain-references`: For adding to `REFERENCES.md`.
- `character-pipeline`: For the end-to-end 2D sketch to rigged 3D game-ready character workflow.
- `deslop`: For anti-AI-slop and human tone filter.
- `check-compiler-errors`: Runs compile/typecheck passes and summarizes failures by file/type.
- `collaborate`: Multi-agent problem-solving and deliberation protocol with human moderator. Standard: Parallel execution with 4 default agents (1 coordinator, 3 workers) on Blackboard/tasks.
- `vision-image`: "Synthetic eyes" for text-only models — send an image to an external vision API (Gemini default, OpenAI opt-in) and get a text description, to inspect renders, screenshots, concept art, or baked-in text.
- `thermo-nuclear-code-quality-review-revised`: Extremely strict, manually-invoked maintainability review (abstraction quality, spaghetti growth, file size).
- `reset-vite`: Frees occupied Vite dev/preview ports and kills hanging Vite processes.

## 4. Further Documentation

None of this is pre-loaded — open the relevant file when the task touches that area. This applies to every agent reading this file (Claude Code, Gemini CLI, or any generic AGENTS.md-consuming tool), not only ones with a "Skill" auto-loader:
- **Local-only files:** Everything under `.agents/notes/`, `.agents/collaborate/`, `.agents/skills/`, `.agents/scratches/`, as well as `.agents/MEMORY.md` and `.agents/BACKLOG.md` is local working material, not part of the repository (see `.gitignore`). While the following references are canonical in this workspace, a fresh clone or another machine may lack them — always check existence before opening, and never assume a build or task failed just because one of these files is missing.
- **Committed repo tooling (NOT local-only):** `.agents/scripts/` (repo scripts, formerly `scripts/` — relocated here; CI, npm scripts, tests, vitest, and tsconfig reference it) and `.agents/goldens/` (committed golden baselines) ARE part of the repository and exist on any fresh clone. Do not delete or treat them as scratch material.
- `CONTEXT.md` (repo root): Canonical domain vocabulary/glossary. Read before naming a new concept or touching cross-subsystem code; kept up to date via the `domain-modeling` skill.
- `docs/adr/` (start at `docs/adr/index.md`): Architecture Decision Records — the "why" behind hard-to-reverse design calls. Check for an existing ADR before revisiting one of these decisions.
- `docs/guides/` (start at `docs/guides/index.md`): Per-subsystem deep-dive guides (materials, physics, tools, coordinate system, etc.). Read the guide for the subsystem you're touching.
- `docs/research/` (start at `docs/research/index.md`): Point-in-time research/audit reports — historical context, not living standards.
- `.agents/MEMORY.md`: Central project memory & knowledge base (architecture overview, identity, key decisions). *Hinweis:* Lokales Arbeitsgedächtnis (in `.gitignore`); auf einem frischen Clone oder neuen Rechner existiert die Datei initial eventuell noch nicht.
- `.agents/BACKLOG.md`: Living, append-only chronological project journal (ideas/open items/decisions, status legend 💡📋🔜✅❌). *Hinweis:* Lokales Arbeitsjournal (in `.gitignore`); auf einem frischen Clone oder neuen Rechner existiert die Datei initial eventuell noch nicht. Bei Sessionstart lohnt ein Blick auf die offenen (💡/📋/🔜) Punkte.
- `docs/guides/asset-pipeline.md`: Official guide for asset/texture sourcing, 4-tier polycount budgets, and modular environments.
- `docs/guides/app-docs-convention.md`: Living convention that every app under `apps/<app>/docs/` has `concept-dossier.html` + `log.md`.
- `docs/reference/`: Standalone HTML deep-dive explainers, linked to from the specific guide/skill that needs them (e.g. 2.5D basics from `docs/guides/2-5d-scenes.md`, leg-occlusion from the `character-pipeline` skill) rather than indexed on their own.
