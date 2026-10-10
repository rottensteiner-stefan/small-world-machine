# Multi-Agent Collaborate: Oil/Petrol/Diesel Puddles & Puddles in General

## Topic Overview
**Goal:** Represent oil/petrol/diesel puddles and puddles in general markedly better in Small World Machine — within the established Graphic-Noir art direction ("Morbid-Painterly Graphic-Noir", a Dishonored × Disco-Elysium × Little-Nightmares blend, ink-outline + watercolor-wash, muted desaturated palette) and at the same time technically on par with current practices (physical thin-film interference where it helps; consistent reflection quality everywhere).

**Moderator's question (verbatim):**
> "Öl-/Benzin-/Diesel-Pfützen und Pfützen generell deutlich besser darstellen. Inspiriert von Godot und Unity (kopieren, wenn es hilft). Du sollst sehen, wie wir das in Small World Machine abbilden, recherchierte Quellen verifizieren, entscheiden ob Material oder Shader … und ein Kollaborationsdokument in `.agents/collaborate` anlegen. Der Plan darf groß sein; bis zu 10 parallele Sub-Agenten beim Ausführen."

**Hard constraint (art direction, [SOURCED: `.agents/scratches/oil_puddle_concepts/`]):**
The six own concept variants define the target look — all **muted / Graphic-Noir**:
- v1 "Comic-Ink Tar Pool": almost monochrome black, cross-hatching, hard white highlights, nearly no color.
- v2 "Muted Thin-Film Iridescence": **"restrained and painterly, never a bright saturated rainbow"** — muted teal / dull violet / faded amber.
- v3 "Chiaroscuro Mirror Streak": almost pure black, ONE sharp warm vertical mirror-reflection streak.
- v4 "Viscous Tar-Skin with Grit": tar-skin folds, rust flakes, cross-hatched rim.
- v5 "Dishonored Whale-Oil Glow": dark puddle, faint warm amber glow at the drip point.
- v6 "Graphic Poster Rainbow Rings": flat, deliberate concentric rings of muted rainbow tint (poster style).

**[JUDGMENT: style criterion]** v2 states the binding limit: iridescence must stay **muted**; a bright saturated cosine rainbow (as currently in `liquid-extras`) is an explicit style break.

---

## Small World Machine State Inventory — 4 code paths + 2 lost docs [MEASURED: file listing]

| # | Path | Kind | Status / conflict |
|---|------|------|-------------------|
| A | `packages/liquid-extras/src/materials/OilSlickMaterial.ts` | ADR-0025 hook extension of `StylizedWaterMaterial` (liquid pool) | `thinFilmRainbow` cosine palette (bright/saturated), `iridescenceStrength` in `u_styleA.w`; used by showcase 10 `PoolPresets.ts:512` (`petroleum-oil`). **Style conflict with v2/v6.** |
| B | `apps/sample-apps/the-whisper/scenes/character-diorama/OilSlickMaterial.ts` + `OilSlick.frag.wgsl/.glsl/.glsl100` | app-local standalone `AbstractMaterial` for **floor puddles** (decal) | **Production reference.** Already contains: physics-based thin-film interference (Fresnel R1/R2 at both interfaces, Snell refraction, OPD, per-RGB-wavelength phase `I = R1+R2+2·√(R1·R2)·cos(phase)`, IOR 1.3, baseF0 0.0204, **desaturation re-mix via `strength`**), plus splatter mask, 2-stage ink outline, meniscus normal perturbation, amber drip glow, `rimDarkening`, `floorVisibility` via `u_opaqueMap` (real floor sampling), analytic env reflection (Schlick, F0=0.0204). App-vendored → not reusable, no look presets, analytic constant instead of a real planar/env reflection route. |
| C | `apps/showcases/12/assets/OilPuddleMaterial.js` | standalone material, **WGSL only** | rain/interaction ripples (showcase.ts:1043 confirms "only a WGSL implementation"). **No WebGL fallback.** |
| D | `apps/showcases/30/showcase.ts:250-269` | "puddles in general": `StandardMaterial` + `PlanarReflectionNode` | Real reflection route (planar 1024²), `reflectionFresnelBlend 0.15` (deliberately shallow Fresnel, no switch effect). Showcase-only, not a standard component/guide. |

**Lost docs:** `oil-shader-roadmap.md` (Phases 1–3, 6.3) and `oil.md` ("Godot reference") are referenced in code comments but no longer exist in the repo `[MEASURED: find . -iname "*oil*roadmap*" → empty]`. The planning basis must be reconstructed.

**Available infra:** `RampLUT.presets` (`packages/engine/src/core/textures/RampLUT.ts:117`, incl. volcanic/infernal), `PlanarReflectionNode` (showcase 30), ADR-0025 hook system + ADR 0013 ("one core mechanism, looks as presets"), `StandardWebGPULayout` (512 B, free style slots, ADR 0026/0027).

---

## Research Findings (verified / corrected)

1. **Godot [SOURCED: docs.godotengine.org, godotshaders.com]:** No built-in iridescence/thin-film — neither a material parameter nor `KHR_materials_iridescence` import (0 hits in the glTF importer). Community replacement is the same `N·V`-driven hue trick Small World Machine already uses. **The real differentiator of good puddles is reflection plumbing:** opaque, up-facing-normal mask, an SSR/planar/env route; no SSR on web → planar/env fallback required (maps 1:1 onto Small World Machine).
2. **Unity (Medium, Tay Hao Cheng, 2024-03) [SOURCED]:** The article is about **wet/reflective** puddles (heightmap mask + flat normals (0.5,0.5,1) + high gloss/metallic + ripple noise) — **no Fresnel/rainbow oil** in it. The "ultimate puddle" reference image matches: dark night wet street, saturated cyan+red concentrated in the lower half `[MEASURED: pixel analysis /tmp/puddle_ref.png]` — the target is reflection/composition quality, not a rainbow palette.
3. **KHR_materials_iridescence → Filament [SOURCED: local copy `.agents/scratches/filament-materials.html`]:** parameter set `iridescenceIor` (default 1.3), `iridescenceThickness` (nm), layer under clear coat. B already follows the principle (simplified two-beam approximation, not Belcour-Barla spectral sum).
4. **Unreal custom-node tutorial [SOURCED: local `.agents/scratches/thinfilm.en.vtt.txt`]:** thin film with a **thickness map**, view-angle coupling (effective thickness ~ "thickness + angle"), constructive/destructive interference. Plus bubble-shader transcript (Unreal+Unity), `bubble_dedup.txt`.
5. **Blender [SOURCED; pasted titles corrected]: Cartesian Caramel "How to make Oil Spill Materials in Blender!" (xcx_LfXuuX4), Node-Based "OIL SHADER in Blender 4.2" (0o4BGLjIDyk): glossy BSDF + Fresnel/hue** — stylistically a side note for Small World Machine.

**Small World Machine vs. research:** production floor puddle (B) is **ahead** of most published approaches (real physical model, muted, Graphic-Noir compliant). The real gaps: (1) path A uses the wrong bright look; (2) B not reusable/parametrized as presets; (3) B's reflection is an analytic constant, not a real (planar/env) route; (4) C without fallback shaders; (5) "puddles in general" (D) not available as a standard component/guide; (6) lost planning docs.

---

## Discussion Turns

### Round 1: Ava (Technical & Artistic Lead — Liquid/Puddle Materials, Physical Thin-Film + Graphic-Noir Stylization) — 2026-10-10

#### 1. Phase A — Shared goal image (for moderator confirmation)
1. **One** canonical, reusable **thin-film / oil-sheen module** (GLSL100/GLSL300+WGSL symmetric) with two artist-selectable paths: (a) the **physical model** already implemented in B (KHR-style; per-RGB-wavelength, desaturation control `strength` as the primary style control), (b) a **`RampLUT`-based** artistic ramp for controlled muted look-ramps (v2/v6). Replaces the bright cosine palette everywhere.
2. **One** first-class **floor oil material** (`OilPuddleMaterial`, lifted out of B into `@small-world-machine/liquid-extras`), look presets for v1–v6, reflection routing (env + optional planar like D), generalization to **petrol/diesel** (more volatile, thinner films, different color temperature).
3. **Puddles in general** as a documented standard component/guide (up-facing mask, reflection channel, darkening) built on D.
4. **Style limit:** iridescence stays muted; any bright rainbow presentation is a bug.

#### 2. Architecture decision (decision delegated to Ava)
**Decision: material system (not a bare shader file as the product), consistent with ADR 0025/0013.** Rationale:
- Both productive realizations (A, B) are **materials**; ADR 0013/0025 establishes "one core mechanism, looks as presets" and hook extensibility — reuse the wheel, don't reinvent it.
- The pool↔floor split forces two embeddings: **liquid pool → ADR-0025 hook** (path A), **floor decals → standalone `AbstractMaterial`** (path-B architecture, since it is not a water volume). Both consume the same shared thin-film module.
- `StandardMaterial` puddles (D) stay on the data/guide level (reflection routing + mask), no core-shader rebuild.
- **Learned from Godot:** reflection plumbing is the real quality lever; no SSR on web → use planar/env route. **Learned from KHR/Filament:** standardize the IOR/thickness parameterization. **Learned from Unity:** flat normals + mask as the puddle basis.

#### 3. Plan draft (large, parallelizable — work packages for sub-agents)

**Phase 0 — Foundation/reconstruction**
- WP-0: Reconstruct the lost roadmap (`oil-shader-roadmap.md`, `oil.md`) from code comments + `petroleum-oil` goldens (`/goldens/p3-*`) and pin it down as a `docs/guides` section or ADR. *(1 sub, low risk)*

**Phase 1 — Shared thin-film module (core)**
- WP-1: Canonize the thin-film fragment from B → `packages/liquid-extras/src/shading/thinFilm.{wgsl,glsl,glsl100}` / chunk system, symmetric WGSL/GLSL, `RampLUT` path, unit tests (N·V domain, desaturation 0/1 limits), perf estimate. *(1–2 subs: shader architecture + QA)*
- WP-2: **Path A repair:** switch `liquid-extras/OilSlickMaterial` to the muted module (fix the v2 style break) OR (open decision, WP-2b) point the showcase-10 preset at the new floor material. *(1 sub)*

**Phase 2 — Floor oil material (first class)**
- WP-3: Lift `OilPuddleMaterial` from B into `liquid-extras` (AbstractMaterial, both-side shaders, clean manifest/layout, no app imports, no more `u_isTerrain` repurposing), look-preset controls v1–v6, petrol/diesel physiognomy presets (thickness/color temperature/volatility). *(2 subs: material architecture + shader)*
- WP-4: Reflection routing: envMap sampling + optional `PlanarReflectionNode` hookup (like D) instead of the analytic constant. *(1–2 subs: rendering plumbing)*

**Phase 3 — Puddles in general & integration**
- WP-5: "Puddles in general" component/guide (up-facing mask + reflection + darkening) as a reusable helper/guidance; reference scenario like D. *(1 sub)*
- WP-6: Consumable demo in Graphic-Noir (barrel scene à la `oil_puddle_concepts`) as a showcase / `the-whisper`-scene proof; golden baselines + WebGL1/2/GPU run (also for C if kept). *(2 subs: scene + golden CI)*
- WP-7: Docs: ADR addition/new ADR for the thin-film module & puddle standard, `REFERENCES.md` (interference/KHR/Godot sources), app `log.md` entries, `domain-modeling` terms. *(1 sub)*

**Parallelization sketch (up to 10 subs):** WP-1, WP-3, WP-4, WP-5 largely independent after Phase 0; roles separated (shader architecture / art direction / rendering plumbing / assets / test-QA) like the lava process. Dependencies: Phase 1 before Phase 2 (module first), WP-6 after WP-3/WP-4.

#### 4. Red Team (required; strongest case against the plan)
- **[ASSUMED]/Objection 1 — anticlimax risk:** B is technically already "almost there". Risk that much of the work only *refactors* instead of visibly improving (focus loss). Early indicator: no visible quality jump after module canonization.
- **[ASSUMED]/Objection 2 — scope explosion:** 4 code paths × 6 looks × physical + artistic model paths × style fidelity = too much for one action. Two most plausible failure modes: (a) losing the art-direction balance in physical iridescence (too colorful), (b) getting lost in disposal work (keep vs. delete C/D) instead of refining B.
- **[JUDGMENT: "economical vs. ambitious"] overlooked alternative:** a simpler strategy — only develop B further along Phases 2–3 (real reflection + petrol/diesel + presets), touch A minimally (desaturation clamp), drop C and the consolidation. Pro: half the effort; con: triple-maintenance of three look systems remains.
- **Moderator ownership:** (1) Are C (ripple material) and D (cyberpunk puddles) kept as production goals or only as references? (2) Style priority — are all 6 looks required, or an MVP (v1/v2 + v5)? (3) Budget — number of parallel sub-agents and commit cadence.

#### 5. Response to the Red Team (plan adjustment)
- Anticlimax: the MVP enforces a **visible quality jump as definition of done** — new light/reflection behavior (WP-4) and petrol/diesel breadth (WP-3) are measurable (golden diff), not just refactoring.
- Scope: **prioritization reduction built in** — MVP = WP-0/1/2/3/4 (visible improvement via reflection + presets); look completeness (all 6) and C/D expansion are deferred, optional work packages; consolidation only where the style break (A) or non-usability (B) actually costs.
- Physics: the B approximation suffices (no Belcour-Barla needed) [JUDGMENT]; ALU budget is bounded by the LUT path and desaturation control; WGSL/GLSL divergence is mitigated by the symmetry requirement (both languages per WP) and the existing hook/chunk conventions.

#### 6. Questions to the moderator / agreement status
- **[TEAM_QUESTION: path maintenance]** Should **C** (showcase-12 ripple oil, currently WGSL-only) and **D** (showcase-30 puddles) be maintained as durable production paths, or only remain as evidence? Determines WP-6/gap budget.
- **[TEAM_QUESTION: look MVP]** Is curating the look presets v1/v2/v5 (tar, muted sheen, whale-oil glow) as a Phase-2 goal sufficient as an MVP, or is the full palette (incl. v6 poster rings, v4 tar-skin) desirable?
- **[TEAM_QUESTION: placement]** Should the floor oil material go into `@small-world-machine/liquid-extras` (consolidation, ADR 0025-conform, proposed) or engine-near into its own extras package?
- **Status:** clear recommendation toward material-based + module (see architecture decision); completed once the goal image (Section 1) and the [TEAM_QUESTION]s are confirmed → then `[CONSENSUS_PROPOSAL: P1]`.

---

## [CONSENSUS_PROPOSAL: P1] — "Muted thin-film module + first-class floor oil material"

**Proposed by:** Ava — 2026-10-10

1. Build the **canonical shared thin-film/iridescence module** (`liquid-extras/src/shading/thinFilm.*`, GLSL100/300+WGSL symmetric) from the already-implemented physical model in B (KHR-style dual-Fresnel + Snell + OPD + per-wavelength phase, desaturation control), plus a `RampLUT`.presets-based artistic path. Replace the bright cosine palette in path A (v2-compliant muted look).
2. Lift B into `@small-world-machine/liquid-extras` as a first-class `OilPuddleMaterial` (clean AbstractMaterial, no app imports, look presets v1–v6, petrol/diesel physiognomy presets), with **real reflection routing** (env sampling, optional planar like showcase 30) replacing the analytic constant.
3. Document "puddles in general" as a standard component/guide built on showcase 30; make C (WGSL-only) and D durable only if the moderator confirms them as production paths.
4. MVP scope = Phase 0–2 (WP-0, WP-1, WP-2, WP-3, WP-4) with a visible quality jump (golden-diff) as definition of done; later Phases 3 deferred unless the moderator expands scope.
5. Style boundary: any bright saturated rainbow appearance is a defect — iridescence is desaturated by default and only `strength`-muted.

**Risk (self-declared):** without moderator answers to the [TEAM_QUESTION]s, WP-6/C/D scope stays fuzzy — the MVP path (1–4) above avoids depending on those answers.

Status of agreement: **MODERATOR APPROVED 2026-10-10T15:47:00Z** (see below).

[MODERATOR_APPROVAL P1 2026-10-10T13:44:01Z]

### Moderator decisions (`[MODERATOR_NOTE]` 2026-10-10)
The moderator answered all three [TEAM_QUESTION]s:
1. **Path maintenance:** C (showcase-12 ripple oil, currently WGSL-only) and D (showcase-30 puddles) are **durable production paths** → WP-6 covers C's WebGL fallback and keeps D as a maintained reference; neither path is disposable.
2. **Look MVP:** **full palette** (v1–v6) is the Phase-2 target — no MVP cut-down; look-preset completeness for v1–v6 is part of WP-3 scope.
3. **Placement:** the floor oil material is consolidated into **`@small-world-machine/liquid-extras`** (ADR 0025 extension package), as proposed.

Scope adjustments to P1 as a result: Phase 2 requires **WP-3 extended** (v1–v6 presets + petrol/diesel), **WP-6 extended** (C WebGL fallback + goldens for C, D, and the liquid-extras material; D remains maintained), and Phase 3 (WP-5, WP-7) becomes part of the committed plan rather than deferred-only.

---

## Open questions & next steps
1. Moderator confirms Phase A (goal image) and answers the three [TEAM_QUESTION]s.
2. Then: detailed WP planning (sizing, roles) and delegated execution with up to 10 parallel sub-agents.
3. Commit rule per AGENTS.md: only after a cohesively rounded-off milestone (end of Phase 1 or Phase 2).

---

### Round 3: Ava (Technical & Artistic Lead) — Implementation Turn (Phase 0 + 1) — 2026-10-10

**Status:** `status: "consensus_reached"`, Umsetzungsphase. Meilenstein 1 (WP-0, WP-1, WP-2) implementiert und laufzeit-verifiziert.

#### Implementiert (MEILENSTEIN 1)
- **WP-0 (Roadmap-Rekonstruktion):** Verlorene Doku rekonstruiert und dangling Code-Verweise aufgelöst:
  - `.agents/notes/oil-shader-roadmap.md` (Phasen 1–3, Abschnitt 6.3, Nachfolge-Referenz auf `oil-puddles.md`)
  - `.agents/notes/oil.md` (Godot-/Industry-Referenznotiz; Verweise in `OilSlick.frag.*` zeigen jetzt auf echte Dateien)
- **WP-1 (kanonisches Thin-Film-Modul):** `packages/liquid-extras/src/shading/thinFilm.ts` ([MEASURED]):
  - `THIN_FILM_GLSL_DECL` (GLSL ES 1.00/3.00-tauglich) + `THIN_FILM_WGSL_DECL`, kollisionssichere `oilFilm*`-Präfixe, selbsttragende reine Funktionen (keine Sampler/Uniforms/Globals) → per `composeStylizedWaterSources`-Decl-Hook überall injizierbar.
  - `oilFilmThinFilm`: physikalisches Zwei-Strahl-Modell (KHR-Style, IOR 1.3, baseF0 0.0204, OPD, Per-RGB-Phase), Desaturations-Steuerung via `strength` als primärer Stilregler.
  - `oilFilmRainbow`: bewusst desaturierter künstlerischer Fallback (kein heller Regenbogen).
- **WP-2 (Pfad-A-Reparatur):** `packages/liquid-extras/src/materials/OilSlickMaterial.ts` (v2-Stilbruch behoben):
  - Helle Cosinus-Palette `thinFilmRainbow` ersetzt durch `oilFilmThinFilm`-Aufruf; **Chroma-Leak-only** (`max(sheen-lum,0)*5.0`), Luma-Body bleibt teer-schwarz; Maske/Fresnel/Shore-Foam-Logik unverändert.
  - Tests aktualisiert auf kanonische Namen (`OilSlickMaterial.test.ts:28`, `LaneTransport.test.ts:76`). Modul via `index.ts` exportiert.

#### Verifikation (9.1, benanntes Prüfmittel pro Behauptung)
- `npm run typecheck` → grün; `eslint .` → 0 Fehler; `npx vitest run` → **1611/1611** bestanden; `npm run build:showcases` → grün.
- `WgslReflect` auf `THIN_FILM_WGSL_DECL` → valide (Modul-WGSL). `lint:wgsl` (Engine) → grün.
- **Laufzeit-Render (echtes Prüfmittel):** `scripts/goldens/capture.js` `petroleum-oil`, Matrix `gl2` + `gpu`: **2/2 cells OK je Backend**, 0 Konsolenfehler, nicht-leer; komponierte WGSL/GLSL kompilieren real in Chrome (WebGL2 + WebGPU).
- **Stilgrenze (Messung, non-quant.):** Sättigung in der geänderten Fläche bleibt gedämpft (~0.21–0.23 von 1.0; oblique +0.011), kein heller Regenbogen-Flood [MEASURED: Pixelanalyse pre-p2-b vs. neu, `.agents/scratches/oilverify/`]. Luma minimal heller.

#### Offene/Ablässige Punkte
- **Aesthetik-Urteil beim Moderator:** Der Shear ist in der `petroleum-oil`-Zelle bewusst subtil (Top-View advers; fast schwarzer Body). Captures zur Augenkontrolle: `.agents/scratches/oilverify/{gl2,gpu}/petroleum-oil__{top,oblique}.png` (Referenz alt: `goldens/pre-p2-b/`). Beim Blick auf Showcase 10 live: ggf. `iridescenceStrength`/Skalierung nachjustieren — reine Kunstentscheidung, kein Code-Blocker.
- Noch offen (Phase 2/3 laut P1 + Moderator-Scope: volle Palette, C/D dauerhaft): WP-3 (OilPuddleMaterial-Elevation aus the-whisper, v1–v6-Presets, Benzin/Diesel), WP-4 (echtes Reflexions-Routing env/Planar), WP-6 (C-WebGL-Fallback + Goldens inkl. petroleum-oil-Baseline-Refresh), WP-7 (ADR/REFERENCES/log).
- **Hinweis Baseline:** `petroleum-oil`-Golden ändert sich erwartungsgemäß (neue Optik) — beim nächsten golden-refresh als gewollte Änderung dokumentieren.

**Nächster Zug:** Moderator prüft Captures; danach startet Ava Phase 2 (WP-3 + WP-4).

---

### Round 4: Ava (Technical & Artistic Lead) — Implementation Turn (Phase 2: WP-3) — 2026-10-10

**Status:** `status: "consensus_reached"`, Umsetzungsphase. WP-3 (OilPuddleMaterial-Elevation aus the-whisper + v1–v6/Petrol-Diesel-Presets) implementiert und auf allen drei Backends laufzeit-verifiziert. WP-4 (echtes Reflexions-Routing) folgt.

#### Implementiert (WP-3)
- **First-class `OilPuddleMaterial`** in `packages/liquid-extras/src/materials/OilPuddleMaterial.ts` (ADR-0025-Extensionspaket, sauberes `AbstractMaterial`): API-treuer Port von B (alle Origin-Optionen), ergänzt um `look`-Presets v1–v6 (`mutedSheen`/`tar`/`chiaroscuro`/`tarSkin`/`whaleOil`/`posterRings`), `fluidType` (`crude`/`petrol`/`diesel` — Volatilität via `timeScale` + Irideszenz-Dach, ohne explizite Nutzerwerte zu überschreiben), gated v4-Runzel (`wrinkleStrength`) und v6-Poster-Ringe (`ringEnabled`), `timeScale` (Volatilität).
- **Shader-Port** `OilPuddle.frag.{wgsl,glsl,glsl100}` aus B, aber:
  - **Parametertransport auf semantischen `u_matParam0..5`-Lanes** — keinerlei Standard-Slot-Umwidmung mehr (B repurposete `u_isTerrain`/`u_pad1-3`/`u_extraParams`); WGSL-Struct `matParam0..15` bestätigt, Renderer-bindbar auf GL1/GL2/GPU.
  - **Kanonische Thin-Film-Decl wird injiziert** (`// [THIN_FILM_DECL]`-Marker → `THIN_FILM_*_DECL` aus `../shading/thinFilm.ts`) — kein Fork, Modul bleibt einzige Quelle.
  - v2-Stilgrenzenlinie kodiert (Ringfarbe via `oilFilmRainbow(strength 0.45)` — gedämpft).
- **Integration:** the-whisper character-diorama (`showcase.ts:1231`) auf das geteilte Material umgestellt (`OilPuddleMaterial` aus `@small-world-machine/liquid-extras`); die 4 app-lokalen B-Dateien (`OilSlickMaterial.ts` + `OilSlick.frag.*`) via `git rm` entfernt. Gleiche Defaults → Szenen-Optik bleibt identisch.
- Tests `OilPuddleMaterial.test.ts` (7 neue Fälle: Default-Parameter, matParam-Lane-Transport, v6/v4-Gating, Look-Override, Fluid-Modifikatoren). `index.ts` exportiert das Material.

#### Verifikation (9.1, benanntes Prüfmittel pro Behauptung)
- `npm run typecheck` → grün; `eslint .` → 0 Fehler; `npx vitest run` → **1624/1624** (257 Dateien); `npm run build:showcases` + `npm run build:lib` → grün; `npm run lint:wgsl` → grün.
- `WgslReflect` auf der **komponierten Fragment-WGSL** (STRUCTS + PBR_MATH + Lighting + injizierte Thin-Film-Decl, exakt wie der WebGPURenderer sie baut) → valide, kein Parse-/Semantikfehler (Scratch `.agents/scratches/check-oilpuddle-wgsl.ts`).
- **Laufzeit-Render (echtes Prüfmittel):** Headless-Capture der character-diorama-Szene (`?rendererType=`), `.agents/scratches/capture-oilpuddle.ts` — **WEB_GPU, WEB_GL2, WEB_GL1: 3/3 OK**, 0 Konsolenfehler, nicht-leer (Stddev 44.5–49.4).
  - **Nebenbefund (Bugfix):** B's app-lokales `OilSlick.frag.glsl` schrieb `out_FragColor`, der Engine-GLSL300-Header deklariert aber `fragColor` → **latenter WebGL2-Kompilierbruch in B** (die Diorama-Lache lief offenbar nie zuvor auf GL2). Durch den Port behoben; GL2 und GL1 rendern die Lache jetzt erstmals überhaupt.
- **Backend-Parität (Messung, non-quant.):** GPU vs. GL2 mean-abs-Δ ≈ 3.75/255 (Licht/Tonemapping-Differenzen wie bei Showcase-10-Goldens erwartbar). Nur ~0.5% der Pixel hell & gesättigt (warme Laternen-Glanzlichter, gewollt) → **kein Regenbogen-Flood**, Avg-Luma ~0.078 (dunkle Noir-Szene).

#### Offene/Ablässige Punkte
- Captures zur Augenkontrolle beim Moderator: `.agents/scratches/oilpuddle-verify/diorama__{WEB_GPU,WEB_GL2,WEB_GL1}.png`.
- **WP-4 (echtes Reflexions-Routing)** bleibt offen: Diorama hat weiterhin den analytischen Env-Term (matParam5) statt echter `u_envMap`/`u_reflectionMap`-Sampling — Layout/Texturen (`u_envMap`@11, `u_reflectionMap`@15) sind vorhanden und für den nächsten Turn vorbereitet.
- WP-6 (C-WebGL-Fallback + Goldens-Framework für C/D), WP-7 (ADR/REFERENCES/log) sowie petroleum-oil-Baseline-Refresh stehen noch aus.
- **Commit-Hinweis:** WP-3 ist ein abgerundeter Meilenstein-Teilschritt, aber WP-4 folgt unmittelbar — Commit-Signal wartet auf Moderator/User.
