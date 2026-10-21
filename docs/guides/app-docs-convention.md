# App Documentation & Living Logs

Small World Machine is designed as a multi-application, multi-showcase monorepo. To ensure institutional memory, prevent architectural regression, and maintain design integrity across sessions and developers, every application adheres to the **App Documentation Convention**.

---

## 1. Directory Structure

Every standalone app and every larger showcase under `apps/<category>/<app-name>/` (e.g. `apps/sample-apps/the-whisper/` or `apps/showcases/10/`) maintains a dedicated `docs/` subfolder (small showcases may go without one; showcase 27 has only a `log.md`). Extra files such as `story.md` or `assets/` are allowed next to the two core artifacts:

```
apps/<category>/<app-name>/
└── docs/
    ├── concept-dossier.html   ← Visual concept dossier (standalone HTML)
    └── log.md                 ← Living development log (Markdown, append-only)
```

---

## 2. The Two Core Artifacts

### 1. `concept-dossier.html` (Visual Concept Dossier)
* **Format:** Static, self-contained HTML with embedded CSS styling.
* **No Build Step:** Must open directly in any browser without requiring Vite, Node, or compilation.
* **Content:**
  * High-level elevator pitch and design pillars.
  * Art direction, mood boards, and aesthetic references.
  * Color palettes (with hex codes and CSS variables).
  * Interactive controls, keyboard shortcuts, and UX diagrams.
  * Technical architecture diagrams (embedded SVG or clean HTML/CSS).
* **Audience:** Digital artists, game designers, and developers aligning on the creative vision.

### 2. `log.md` (Living Development Log)
* **Format:** Clean GitHub-flavored Markdown.
* **Primary Memory:** `log.md` is the **single source of truth** for an application's design decisions, technical audits, bugfixes, and evolution.
* **Append-Only Law:**
  * Entries are arranged chronologically with dates (newest entries appended at the bottom, or kept in strict chronological order).
  * **History is never erased.** When an earlier decision is revised, append a new section explaining *why* the approach shifted rather than retroactively altering past logs.

---

## 3. Operational Rules

### The Two Session Rules
1. **At Session Start:** Read the target app's `docs/log.md` to absorb the active context, known bugs, and recent architectural calls.
2. **At Session End:** Append a dated entry to `docs/log.md` summarizing what was added, changed, or fixed, including file references and benchmark outcomes.

### Scope Boundaries: App Docs vs. Global Research
* **App-Specific Research & Decision Logs:** Belong strictly in `apps/<app>/docs/log.md` (and `concept-dossier.html`).
* **`docs/research/`:** Reserved exclusively for repo-wide, cross-cutting technical audits (e.g. `docs/research/aaa-engine-techniques.md`). Do not create app-specific files in `docs/research/`.

---

## 4. Active Applications & Existing Logs

| Application | Path | Key Focus |
| :--- | :--- | :--- |
| **The Whisper — A Viennese Requiem** | [`apps/sample-apps/the-whisper/docs/log.md`](../../apps/sample-apps/the-whisper/docs/log.md) | Narrative graphic-noir RPG, 2.5D diorama rooms, level schemas. |
| **Minceraft (Voxel Sandbox)** | [`apps/sample-apps/voxel-prototype/docs/log.md`](../../apps/sample-apps/voxel-prototype/docs/log.md) | Voxel engine, worker meshing, delta persistence, daylight model. |
| **YAD (Yet Another Dungeon)** | [`apps/sample-apps/yad/docs/log.md`](../../apps/sample-apps/yad/docs/log.md) | 2.5D dungeon crawler, raycast physics, torch illumination. |
| **Light Cycle Arena** | [`apps/sample-apps/light-cycle-arena/docs/log.md`](../../apps/sample-apps/light-cycle-arena/docs/log.md) | High-speed 3D Tron grid, neon post-processing, light trails. |
| **Showcase 10 (Waterworld Gallery)** | [`apps/showcases/10/docs/log.md`](../../apps/showcases/10/docs/log.md) | 16-pool liquid gallery, Gerstner waves, buoyancy probes, PBR grass. |
| **Showcase 39 (Atmospheric Sanctum)** | [`apps/showcases/39/docs/log.md`](../../apps/showcases/39/docs/log.md) | Froxel 3D volumetric fog, interior carving, animated 3D mist. |
| **Showcase 40 (Decal Probe)** | [`apps/showcases/40/docs/log.md`](../../apps/showcases/40/docs/log.md) | Projected box decals, normal buffer inspection, decal sockets. |
| **Showcase 22 (Gargantua / Black Hole)** | [`apps/showcases/22/docs/log.md`](../../apps/showcases/22/docs/log.md) | Black hole rendering. |
| **Showcase 24 (Shader Gallery)** | [`apps/showcases/24/docs/log.md`](../../apps/showcases/24/docs/log.md) | Shader gallery. |
| **Showcase 27 (Shadow Sanctuary)** | [`apps/showcases/27/docs/log.md`](../../apps/showcases/27/docs/log.md) | Shadow showcase (log only, no dossier). |
| **Showcase 28 (Quantum Refraction Lab / Optical Prism)** | [`apps/showcases/28/docs/log.md`](../../apps/showcases/28/docs/log.md) | Refraction / optical prism. |
| **Showcase 41 (Metal Wall Relief & Assemblage Art)** | [`apps/showcases/41/docs/log.md`](../../apps/showcases/41/docs/log.md) | Metal wall relief and assemblage art. |
