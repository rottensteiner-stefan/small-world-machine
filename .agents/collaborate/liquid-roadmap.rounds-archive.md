# Liquid-Roadmap: Archiv der Runden-Blätter 1 bis 3

> Verlustfreie Zusammenfassung der 18 Einzelblätter (6 Agenten × 3 Runden), erstellt am 2026-10-07, nachdem ihr Inhalt in `liquid-roadmap.md` (§12 bis §17) integriert wurde. Jedes Blatt steht unverändert zwischen `BEGIN` und `END`, mit SHA-256 des Originals. **Maßgeblich ist `liquid-roadmap.md`**; dieses Archiv ist nur Quellenbeleg.

| Runde | Blätter |
|---|---|
| 1 | Analyse und Vergleich je Fachgebiet (Alice, Bob, Charly, Dave, Erin, Frank) |
| 2 | Einwände, Änderungsvorschläge, bedingte Zustimmung |
| 3 | Unterschrift unter den Plan P2 |


---

<!-- BEGIN liquid-roadmap.round1.Alice.md sha256=a1e4f1986514cfd4b66550fd812960d1322cee681895b4f873dee1e1851b15dd bytes=17479 -->
# Round 1: Alice (Architect & Systems Lead) — 2026-10-05

Scope: ENGINE ARCHITECTURE & SYSTEM STATE of the fluid stack, PIPELINE/RENDERING PATH, TOOLING/ARTIST WORKFLOW boundary, and the mandatory industry architecture comparison. Physics/geometry detail overlaps Dave/Erin; simulation/looks detail overlaps Bob/Charly — I focus on structure and system-state truth.

## 1. System-State (verified code facts, file:line)

Paths under `P=<repo-root>`.

### 1.1 Two-family material architecture — VERIFIED, production
- Wave family: abstract `LiquidWaveMaterial` (`P/packages/engine/src/core/materials/LiquidWaveMaterial.ts`, 194 ln) with presets `OpenWaterMaterial` (96 ln) and `StylizedWaterMaterial` (308 ln). Flow family: `FluidSurfaceMaterial` (284 ln) with presets `LavaMaterial` (60 ln), `SlimeMaterial` (60 ln). All classes exist, exported (`P/packages/engine/src/index.ts:14-17`), used in apps (showcases 10/31, yad, the-whisper). Inventory §1.
- Lava/Slime have **no own shader files** — they compile under the shared `FluidSurface.*` shader set, registered under own MaterialType IDs for separate compiled programs (`FluidSurfaceMaterial.ts:125-132`). This is ADR 0013's "one core mechanism, presets for looks" — real and working.
- UniversalFluidMaterial from ADR 0025:20 **does not exist** — its intended role was implemented as StylizedWaterMaterial (inventory §1; verified: no `UniversalFluid*.ts` in `packages/engine/src/`). The ADR is stale on this point.

### 1.2 Chunk/token mechanism — VERIFIED, production
- `ShaderRegistry.registerChunk` (`P/packages/engine/src/core/renderers/shaders/ShaderRegistry.ts:101`); token assembly via `/[A-Za-z0-9_]+/`-style replacement (lines 134–146). Liquid chunks registered in `CoreShaderChunks.ts` (`LIQUID_GERSTNER_WAVE/WORLEY_NOISE/CAUSTICS/GLINT` + `WATER_EXT_DECL`/`WATER_EXT_SURFACE`, glsl100:88–93, WGSL:120–125). Zero-drift on GLSL100: chunks reuse ES-1.00-compatible `.glsl` files (inventory §1, §7).

### 1.3 Extension boundary — VERIFIED, enforced, in production
- Only **two** tokens exist: `[WATER_EXT_DECL]` / `[WATER_EXT_SURFACE]` in `StylizedWater.frag.glsl:37,236`, `.glsl100:34,206`, `.wgsl:4,197`; substituted by `composeStylizedWaterSources()` (`StylizedWaterMaterial.ts:17-40`). Used live by `@small-world-machine/liquid-extras` (`NoirWaterMaterial.ts:123/126`, `OilSlickMaterial.ts:164/168`). The "5 injection hooks `#SW_INJECT_*`" (liquid-architecture F3/F4) were **never implemented** — superseded by the 2-token ADR-0025 design. 0-ALU / 0-uniform cost when unused by design (ADR 0025 consequence).

### 1.4 Uniform budget — VERIFIED FULL (hard constraint)
- `ObjectUniforms` packs to exactly **64 floats = 256 bytes**; `u_styleA`@float 56, `u_styleB`@float 60 — asserted by `P/packages/engine/tests/renderers/WebGPUObjectUniformPacker.test.ts:89-132`; ring-buffer slot stride 256 (`GPUObjectRingBuffer.ts:36-39`).
- Both `u_styleA`/`u_styleB` are now **consumed** by StylizedWater (`StylizedWaterMaterial.ts:288-300`; read in `StylizedWater.frag.glsl:26-27`). Confirmed "zero spare float slots" (`LiquidWaveMaterial.ts:41-43`); family-specific packing repurposes unrelated named lanes (`LiquidWaveMaterial.ts:98-130`, `FluidSurfaceMaterial.ts:187-243`).
- Consequence (hard): a third style vec4 does not fit. New parameters ⇒ per-styleId constants + repurposed lanes, or a wide-radius layout extension (ADR 0013 weighed, rejected for the FluidSurface case).

### 1.5 Render pipeline — NO water-specific pass (VERIFIED)
- Transparent liquids render in the **generic transparent pass** after opaque color+depth capture: `P/packages/engine/src/renderers/passes/MainRenderPass.ts:72-113` (`captureOpaqueTexture` 78, `captureOpaqueDepth` 79, transparent loop 98-112). Same structure in `WebGLMainPass.ts`.
- Screen-space refraction via captured `u_opaqueMap`/`u_opaqueDepthMap` (bound `WebGL2Renderer.ts:1310-1312`, `WebGPURenderer.ts:1861-1868`; GL1 depth-gap documented, accepted — `OpenWater.frag.glsl100:32-37`).

### 1.6 PlanarReflectionNode — VERIFIED orphan (for water)
- `P/packages/engine/src/core/PlanarReflectionNode.ts` (111 ln) renders a mirrored pass into a RenderTarget. But `u_reflectionMap` is sampled **only** by opaque `Standard.*` shaders (`Standard.frag.glsl:30,114`, `Standard.frag.wgsl:21`) — **no water fragment samples it** (grep of `materials/shaders/`: 0 water hits). Water "reflection" is procedural `skyTint` (`StylizedWater.frag.glsl:~166`). Used only in showcases 15/16/30 (mirrors, not water).

### 1.7 Geometry/tessellation/LOD — VERIFIED ABSENT
- `P/packages/engine/src/geometry/` (38 files) has **no** ocean/water/tessellated-fluid primitive. `Disk.ts:17` mentions tessellation only in passing; water surfaces are segmented `Plane` (showcase 10 ~line 1083, `widthSegments:32,heightSegments:32`). Fidelity ⇒ app-side segment density. No engine LOD.

### 1.8 Physics — VERIFIED disconnected + unused in apps
- `FluidVolume.ts` (29 ln) = pure data container; `fluids/BuoyancySolver.ts` (129 ln) = static Archimedes `applyFluidForces` (`BuoyancySolver.ts:113`). Sole consumer `PhysicsSystem.ts:120,296`. grep of `apps/`: **zero** FluidVolume/BuoyancySolver usages. No water-height feedback from physics; rendering is 100% shader-side.

### 1.9 Dead/overstated state
- Dead varying `v_displacementY` (written `StylizedWater.vert.glsl:108`, only declared `StylizedWater.frag.glsl:7`, never read).
- Claimed-but-absent: Clapotis, obstacle wakes, golden-ratio spread, crest foam in StylizedWater, 5 hooks, UniversalFluidMaterial, Lava/Slime "physics" (Bingham/Voronoi/Planck/Stokes/bubbles — all simplified noise looks).
- Test-matrix gaps: `ShaderAssembly.test.ts` covers FluidSurface + OpenWater only (list ~line 76–87); `ShaderValidation.test.ts` FluidSurface only (29–41). **StylizedWater, Lava, Slime uncovered** there — the `[VERIFICATION_PASSED]` claim (liquid-improve.md:323) overstates backend parity for these materials.

## 2. Industry Architecture Comparison (Godot / Unreal / Unity / Three.js vs Small World Machine)

Axis for this section: **system structure** — how each engine structures water as a subsystem (geometry, passes, shading model, physics coupling, extension model), not look fidelity (Bob/Charly own that). Browser constraints that modify the verdict: 3-backend parity (GLSL100/GLSL300/WGSL), 256-byte uniform slot, no forks, no global singletons (topic doc §3-4; ADR 0014/0015/0021).

### Godot — structurally the nearest analogue
- Ships **no first-party water material or pass**; water is generic `ShaderMaterial` + community shaders. Reflection/refraction are user-assembled via `SubViewport`/`BackBufferCopy` screen-reading. Buoyancy is external logic on `RigidBody` in `Area`.
- Small World Machine: structurally similar (generic transparent pass + captured opaque; physics external), but **ahead** — first-party OpenWater/StylizedWater families with 3-backend shader sets, plus a real extension package instead of copy-paste community shaders.
- Gap vs Small World Machine's trajectory: nothing Godot ships here that we miss; Godot proves the "no water subsystem" route is viable for stylized work. Verdict: our current architecture ≈ Godot-class structure AND exceeds it; no lesson that changes our plan.

### Unreal — the "water as a subsystem" benchmark
- **Water plugin**: `UWaterBody` generates its own quad-mesh water planes (always a grid primitive, never user `Plane`), owns a **Water Material Model** (a dedicated water shading model in the material system), feeds **buoyancy splatmaps** into `BuoyancyComponent`, and the renderer has dedicated water/reflection handling. Gerstner/FFT and meshes-with-LOD live in this subsystem. Niagara particles for volumetric fluids.
- Small World Machine difference: **no water shading model, no generated water geometry, no water pass, no physics coupling**. Everything water is a Material + app-supplied `Plane`.
- What we could adopt (research horizon, not now): quad-grid water body with cheap LOD; buoyancy driven from the actual water surface. What we deliberately don't: a separate water renderer backend (violates 3-backend, no-fork constraint).

### Unity — the model we already copied (per ADR 0013)
- HDRP Water System is one first-class PBR water pipeline with buoyancy hooks; URP water = Shader Graph + community (Stylized Water 2). ADR 0013 explicitly split Small World Machine the Unity way: **one core mechanism, shipped presets for looks**.
- Small World Machine is faithfully executing this split (two sibling mechanisms sharing shader text, not a common layout — ADR 0013 correction, lines 39-47). The part of Unity we did **not** take: dedicated water depth/reflection render features and a water grid — Unity water reads its own water-depth textures from a dedicated water pass.
- Verdict: architectural direction corroborated by Unity; our missing piece is exactly the **water-specific render/geometry layer** Unity and Unreal both have.

### Three.js — the anti-benchmark (and ours is cleaner)
- Three.js core has no water at all; `Water.js`/`Ocean.js` are demo-level examples, newer ones GPU-compute (FFT) based. Reflection = user-spawned `CubeCamera`/planar mirror passes; stylized water = userland TSL node graphs / arbitrary `Material` subclasses — **no enforced extension boundary**.
- Small World Machine is strictly ahead on architecture: first-party materials, coherent 3-backend set, declared chunk/hook extension boundary enforced by tests (liquid-extras), no per-style forks.
- What Three.js shows for the future (research): TSL/node composability and WebGPU compute FFT as a **later** capability, not a structural model to chase now.

### Cross-engine verdict
- **Structurally sound**: two-family split + presets + compile-time extension boundary is a correct, industry-aligned spine (Unity split, Unreal realism/NPR separation, confirmed by liquid-architecture F1).
- **Missing (structural)**: (a) water-specific render pass (water depth/reflection) — present in Unreal/Unity, absent in us; (b) generated water geometry/tessellation/LOD — none anywhere in our geometry layer (Unreal quad grids, Unity water grid); (c) physics↔surface coupling — external in Godot (like us), first-class in Unreal/Unity.
- **Dead end**: none of the current architecture is a dead end. The 256-byte uniform ceiling and single-plane geometry are the two constraints that will eventually force a decision (layout widening or per-geometry water rendering) — but both are known, sized, and deferrable.

## 3. What is GOOD / what is MISSING / what is in WHICH STATE

**GOOD (keep, protect, extend):**
- Two-family architecture + ADR 0025 extension boundary: sound, industry-aligned, verified, in production. Highest-value structural asset.
- 3-backend shader parity for a nontrivial shader set — rare engineering property; preserve.
- Per-material program registration (Lava/Slime as own typed programs, no renderer dispatch forks) — clean, no global singletons, fail-fast friendly.
- OpenWater's analytic Jacobian crest foam (`OpenWater.vert.glsl:113-119`) — genuinely good, WebGL1-upgradable math.

**MISSING (structural, ranked by leverage):**
1. Water-specific render/geometry layer (pass + surface) — the single biggest gap between "stylized shader toy" and "hard water system"; present in Unreal/Unity, absent in us, partially reachable via PlanarReflectionNode + tessellated fluid geometry.
2. Reflection wire-up for water — `PlanarReflectionNode` + `u_reflectionMap` exist but are wired only to opaque Standard; water must either sample a reflection source or formally drop the "reflection" claim (current `skyTint` is procedural).
3. Physics↔surface coupling — FluidVolume/BuoyancySolver are architecture with no tenant; disconnected from rendering and unused in apps.
4. Truth of claims — dead varying, absent Clapotis/wakes/5-hooks/UniversalFluid/Lava&Slime "physics" pollute documentation and the audit trail.

**WHICH STATE (honest):**
- Materials + chunks + hooks: **production**, used in shipped apps, tested (engine tests + liquid-extras tests).
- Pipeline (generic transparent pass + captured opaque): **adequate for stylized/flow looks**, insufficient for "harte" ocean work; WebGL1 depth-gap is a documented, accepted limitation.
- Geometry/tessellation/LOD: **absent** (no code).
- Physics: **stub** (primitive, untested-in-apps, disconnected).
- Reflection: **orphan capability** — node exists, not wired to water.

## 4. Stability gate: measurable acceptance criteria

"Hard & stable" for the fluid system is only real if each claim is pinned to a test or code. Acceptance criteria:

- **G1 Backend parity, all liquids:** WGSL + GLSL300 + GLSL100 assembly/validation green for **all** liquid materials — StylizedWater, Lava, Slime added to both `ShaderAssembly.test.ts` (materials list ~76-87) and `ShaderValidation.test.ts` (29-41), plus the extension package's Noir/OilSlick re-run in the same matrix. Today: only FluidSurface + OpenWater.
- **G2 Zero dead code:** automated check that no liquid fragment varying/sampler/uniform is declared-but-unused (kills `v_displacementY` `StylizedWater.vert.glsl:108` / `frag.glsl:7`). Engine currently has 0 TODO/FIXME in materials — keep it 0.
- **G3 Claims == Code:** a drift gate mapping every existing claim in `liquid-improve.md` / `liquid-architecture.md` to code or test; features not implemented are explicitly labelled "not implemented" in docs, not "done" (`[VERIFICATION_PASSED]` at `liquid-improve.md:323` must be re-scoped to the actual cover set).
- **G4 Uniform budget pinned:** `WebGPUObjectUniformPacker.test.ts` stays green (256-byte / styleA@56 / styleB@60, lines 89-132); any new parameter must first prove it fits per-style constants/repurposed lanes before a layout extension is considered.
- **G5 No new slots:** all additions respect the 256-byte slot; layout widening (if ever) is a named, ADR'd change with measured impact radius (ADR 0013 already quantified: DepthPrePassGPU, CascadedShadowPassGPU, SpotShadowPassGPU, MainRenderPass, WebGLMainPass).
- **G6 Physics resolution:** FluidVolume/BuoyancySolver are wired into ≥1 app with an integration test, **or** officially deprecated/documented as out-of-scope. No orphan architecture.
- **G7 Reflection decided:** water either samples a real reflection source (PlanarReflectionNode → `u_reflectionMap`, validated by a test) or the "reflection" claim is re-termed procedural `skyTint`. Documented WebGL1 degradation stays as an explicit known-limited entry.
- **G8 Performance budget (measurable):** per-frame liquid cost stays under a fixed budget (e.g. one transparent draw + captured opaque reads, no per-frame allocation in hot paths; FPS floor on showcase 10/31), asserted in CI.
- **G9 Runtime safety:** every new preset/extension path is fail-fast tested (like `FluidSurfaceMaterial` depth pre-pass opt-out test); no option may be dead (past audits killed several dead options — this discipline must become a gate).

**Gate wording:** the system is "hard & stable" when G1–G8 hold on the default branch (build, lint, full test matrix green, all 3 backends) **and** no claimed-but-absent feature remains open — regardless of any new glamour features.

## 5. Phase-A Goals / Vision for the roadmap

Phase-A is **hardness-first**; new looks are Phase-B+ (Bob/Charly own look scope). Sequence below is dependency-ordered, not effort-ordered.

- **A1 — Close the validation gap (G1+G2):** add StylizedWater/Lava/Slime + liquid-extras to ShaderAssembly/ShaderValidation matrices; add backend-parity + drift check for chunks (no automated GLSL100-drift check exists today). Small surface, highest stability leverage, unblocks every later claim.
- **A2 — Claim reconciliation (G3):** one pass aligning docs (liquid-improve.md, ADRs 0013/0025, liquid-architecture.md) with verified code; delete the dead varying; drop or implement Clapotis/wakes/5-hooks/UniversalFluid wording. Output: an audited "state" annex that future sessions must not contradict.
- **A3 — Resolve physics (G6):** decide FluidVolume/BuoyancySolver fate — wire into one showcase + integration test, or formally drop the claim. This is an architecture decision (ADR), not a code dump.
- **A4 — Decide optics lane (G7):** ADR on reflection/refraction direction: (i) wire PlanarReflectionNode into a water shader (3-backend cost, WebGL1 fallback), or (ii) formalize procedural `skyTint` + continue refraction-only. No half-measure.
- **A5 — Water-pass viability study (design-only):** spec (not build) a water-specific surface/pass layer that degrades to the generic transparent pass, holds inside the 3-backend constraint and the 256-byte slot; decide whether a tessellated fluid geometry (disk/plane LOD) is worth it before any rendering work.

**Vision:** keep the two-family spine + ADR-0025 extension boundary — they are sound and industry-aligned. Grow the pipeline only on verified need (water pass/render layer, optionally FFT/compute and LOD later on the research horizon per topic doc §1.5), never fork, never exceed the fixed uniform slot, and make every future feature land with its acceptance test. The roadmap's north star is a system whose **claims == code** and whose quality is measured, not asserted.

---
*Author note (Alice): this round is evidence-bound to HEAD (inventory + spot-verification greps). No tests were run; no other files were modified.*
<!-- END liquid-roadmap.round1.Alice.md -->

---

<!-- BEGIN liquid-roadmap.round1.Bob.md sha256=a74d018eb4f8a5e06084215357b969c6d1345dbd908091d22aae9c93a60b6534 bytes=19881 -->
# Round 1: Bob (Realistic Open-Water & Wave Physics) — 2026-10-05

Scope: the realistic / physically-grounded path only. Research-only; no code changed. All paths repo-relative to `<repo-root>`. Headers per moderator brief; citations `file:line`.

---

## 1. Verified state of the realistic path (file:line)

Verified directly against HEAD. `## VERIFIED-PRESENT` / `## PARTIAL` / `## CLAIMED-BUT-ABSENT` per inventory convention.

### I. Wave model — Gerstner cascade + deep-water dispersion
- `## VERIFIED-PRESENT` Six Gerstner terms summed in the OpenWater vertex shaders. Wave vectors constructed from the three packed uniforms + derived terms: `packages/engine/src/core/materials/shaders/OpenWater.vert.glsl:91-96` (w2=u_liquidParams, w3=u_thresholds, w4/w5 lines 94-95 "Detail wave … perpendicular", w6 line 96 "Bimodal 60-deg cross-swell"); six `gerstnerWave()` accumulations `OpenWater.vert.glsl:102-107`. Identical cascade in `.glsl100:29-45` and `.wgsl:21-38`.
- `## VERIFIED-PRESENT` Deep-water dispersion `omega = sqrt(g*k)`: shared chunk `chunks/liquid_gerstner_wave.glsl:10` (`float w = sqrt(9.81 * k);`), mirrored `chunks/liquid_gerstner_wave.wgsl:10`. Also carries the analytic tangent/bitangent partials (`t`/`b`) and returns the displacement (`chunks/liquid_gerstner_wave.glsl:16-28`).
- **True term composition (correcting the doc claim):** 2 dominant (w1,w2) + 1 threshold wave (w3) + 2 **90°-perpendicular** detail waves (w4,w5) + **one** 60° cross-swell (w6). In OpenWater all six execute unconditionally.
- `## CLAIMED-BUT-ABSENT` "golden-ratio directional spread": zero hits for golden/phi/1.618 anywhere in `packages/engine/src/core/materials/` (grep, 0 matches). The claimed spread from `liquid-improve.md:229` was never implemented; what exists is the hand-chosen 90°/60° set above.
- Limits to state honestly: 6 analytic waves only, hardcoded construction (derived w4-w6 scale from w1/w2 amplitudes/tails). No spectral/high-frequency detail, no wave-collider coupling, no spatial variation (same wavefield over the whole surface). No tessellation/LOD — the "ocean" is a 32×32 segmented `Plane` (`apps/showcases/10/showcase.ts:1080-1083`, `needsTangents` at :1079).

### II. Wave-crest foam — analytic horizontal Jacobian
- `## VERIFIED-PRESENT` `J = t.x*b.z − t.z*b.x` in the OpenWater vertex shader, normalized by summed steepness, emitted as a varying: `OpenWater.vert.glsl:113-119` (comment 113-116 "J ≤ 0 means folding"), `.glsl100:51-57`, `.wgsl:44-52` (carried in `Out.original_uv.x` with `texIndex`-collision warning :47-49). Consumed as crest foam: `OpenWater.frag.glsl:113-115` (`smoothstep(0.65,0.95,v_crest)*foamPattern*0.5`), `.glsl100:104-110`, `.wgsl:86-88`.
- This is the physically-correct whitecap indicator (folding/precipitation of the wave surface), not a normal-based fake. It is OpenWater-only (`## PARTIAL` for StylizedWater, whose `v_displacementY` varying is written-but-unread — see inventory §2b/§7; out of my scope, Charly's).

### III. Caustics
- Correction to the brief's "caustics (F1-SmoothF1)": **OpenWater does not use F1-SmoothF1.** `F1-SmoothF1` is the StylizedWater technique (`packages/engine/src/core/materials/shaders/StylizedWater.frag.glsl:103`). OpenWater caustics are an inline **smoothed Worley-cell double-product** anchored to the pool floor by sun-ray projection, not a depth-ray physical caustic: `OpenWater.frag.glsl:119-132` (`groundXZ` along the light ray line 123; `pow(c1*c2,1.6)*3.2` line 129; depth fade `exp(-depthDiff*0.7)*smoothstep(0.05,0.4,depthDiff)` line 130; additive gain `*0.1` line 131). Same pattern in `.glsl100:114-121` and `.wgsl:92-105`.
- The current gain/fade constants (`0.1`, `exp(-0.7)`) are already the **post-fix** values from the showcase10 fixes; at measurement time (`HEAD 82bebeee`) the gain was `*0.4` with `exp(-depthDiff*0.35)` (F17), see §2. Literal reading of `F17` in `.agents/.../showcase10-quality.md` vs `OpenWater.frag.glsl:131` confirms the codified fix.

### IV. Refraction + absorption
- `## VERIFIED-PRESENT` Screen-space refraction from the live-captured opaque color+depth: uniforms `u_opaqueDepthMap`/`u_opaqueMap` in `packages/engine/src/core/materials/LiquidWaveMaterial.ts:93-97` (left undefined so renderers bind the live capture); capture happens in the transparent pass `packages/engine/src/renderers/passes/MainRenderPass.ts:72-80` (`captureOpaqueTexture` + `captureOpaqueDepth`); sampler binding `packages/engine/src/renderers/WebGL2/WebGL2Renderer.ts:1310-1312`, `WebGPURenderer.ts:1861-1868`; distortion + distorted-depth front/behind fallback `OpenWater.frag.glsl:59-68`, `.wgsl:27-41`.
- `## VERIFIED-PRESENT` Beer-Lambert absorption: `exp(-depthDiff * waterAbsorption)` on per-channel coefficients `OpenWater.frag.glsl:70-78` (in-scatter floor prevents blackout :76-77); coefficients channel-repurposed onto skeletal slots `LiquidWaveMaterial.ts:116-118`; `waterAbsorption`/`refractionStrength` documented `OpenWaterMaterial.ts:21-27`.
- `## VERIFIED-PRESENT` (degradation, accepted) WebGL1 has **no depth capture**: `WebGL1Renderer.ts:690-692` documented no-op `copyToOpaqueDepthTexture`; the GLSL100 shader substitutes a clip-space-UV refractive stand-in and a Fresnel depth proxy — `OpenWater.frag.glsl100:32-38` (method comment), 48-49 (screen UV via `v_clipPos`), 56-64 (absorption driven by Fresnel proxy), 76/91 (edge/foam gated to grazing angles), 120 (caustics fade via Fresnel). Refraction on GL1 is colour-only, undistorted by true depth.

### V. Interaction/phenomena claimed but absent (realistic path)
- `## CLAIMED-BUT-ABSENT` Clapotis / basin-wall reflection: zero `clapotis` hits in `packages/engine/src/` and `apps/` (grep). No wall-normal mirrored Gerstner term, no standing-wave 2A anywhere.
- `## CLAIMED-BUT-ABSENT` Contact ripples / obstacle wakes: zero `wake` hits in materials and `apps/showcases/10/showcase.ts` (grep). OpenWater has no ripple/stroke system at all (only foam/caustics); the only occlusion interaction is the depth-based refraction falloff.
- `## CLAIMED-BUT-ABSENT` Water-specific reflection: no water fragment shader samples `u_reflectionMap` (grep of OpenWater*/StylizedWater* frags: 0 hits); the generic `PlanarReflectionNode` exists but is unwired for liquids; OpenWater "sky" is a procedural constant `vec3(0.6,0.8,1.0)` (`OpenWater.frag.glsl:85`, `.wgsl:58`).

### VI. Physics (rendering↔simulation bridge)
- `packages/engine/src/physix/FluidVolume.ts:8-28` — pure data container (AABB + density + drag + current), no wave heights/pressure/fluid mass. `packages/engine/src/physix/fluids/BuoyancySolver.ts:36-127` — hydrostatic Archimedes lift from AABB-submersion ratio (`:76-92`, `:113`), current-flow forces (:116-121), drag multipliers (:123-124); wired into `PhysicsSystem.ts:120`/`296`; **no app consumes it**, and the rendered wave surface is 100% shader-side with zero feedback loop to any buoyancy/probe (inventory §4 confirms).

---

## 2. Quality state (measured, from showcase10-quality)

Measured grades are pre-fix (`HEAD 82bebeee`); I separate **measured** from **codified fix**.

- **Clear Water measured: grade 1/5** (`F17`, `.agents/collaborate/scratches/water/showcase10-quality.md:44`). Pool interior was saturated white/blue blobs with radial zoom-streaks; tiles/seabed unreadable; no water look. Diagnosis: the procedural caustics were the culprit — `causticsValue*0.4` additive with gain up to ~1.28 over the deep blue, fixed `exp(-depthDiff*0.35)` fade, shared noise scale with foam; streaks came from projecting caustics UV through `groundWorldPos = v_worldPos + rayDir*depthDiff` where `depthDiff` varies steeply at walls. **This is the direct refutation of the earlier "procedural caustics only at intersections" claim** (CHANGELOG).
- **Codified fix now in HEAD:** caustics gain `0.4 → 0.1` and fade `exp(-0.35) → exp(-0.7)` + `smoothstep(0.05,0.4,depthDiff)` (can't fully verify silence: `OpenWater.frag.glsl:130-131`). Post-fix (F2, roadmap §2 line 31): Clear 3-4/5, WebGL1 worse.
- **White sun-specular patch** (`F18`, :45): a large top-right white patch on both WebGL2 and WebGPU hides the floor; source-shaped: `pow(nDotH,1200)*0.8` hard spec at `OpenWater.frag.glsl:91`. Not fixed by constant tuning alone — it is a real directional-sun hot spot on near-flat wave normals. Wall tiles read as **vertical/radial smear** (`F18`, `F15`) — same depth-projection weakness as the caustic streaks.
- **WebGL1** for OpenWater is a different, dimmer look (no real depth), grading lowest across the whole liquid gallery; acceptable documented degradation but confirms OpenWater's "hard & stable" bar can only be met on GL2/WebGPU parity.
- **Implication for "hard & stable":** the realistic path is currently a handful of **hardcoded constant traps** (caustic gain/fade, spec exponent/gain, crest thresholds, foam mask) with a demonstrated history of blowout at default showcase values. It is stable *only* under the post-fix constants and *only* on the two depth-capable backends. There is no measured regression grid for these constants, no own uniform for caustics gain (F17: "no param exists"), and the exact same wall-smear mechanism that produced `F17/F18` is still structurally present (`OpenWater.frag.glsl:123`).

---

## 3. Industry comparison — Godot / Unreal / Unity / Three.js

Axes: realistic wave model, maturations, browser-relevance, interaction + physics, artist/parameter surface. Reference depth kept honest; community/plugin facts labelled as such.

| Engine | Water tech | Realistic-wave technique | Maturity | Browser relevance | What Small World Machine lacks | Adoptable in thin 3-backend TS engine? |
|---|---|---|---|---|---|---|
| **Godot** | None built-in; community addons / shader gists | Gerstner vertex displacement shaders (community); `WAVE` normal-map "water" sample in FPS demo; 4.4 has experimental WebGPU export but official water is 2D `Water` concept only | Low (community-grade, no official ocean) | Medium (web export exists; water limited by no custom pass control) | (Lowest gap: SW already exceeds stock Godot water) | **Nothing to import**; SW is ahead. Contribution is negative example: no dedicated pass = water stays flat. |
| **Unreal** | Water plugin (`WaterBodyOcean/Lake/River`) + Niagara + `BuoyancyComponent` | Multi-octave Gerstner + layered normals (Water plugin); spectral/FFT ocean via third-party and mesh-side; **tessellated water mesh with full LOD**; GPU fluid/interaction via Niagara (`WaterInteraction`) | Very high (production, AAA) | Low (desktop-first, no official browser path for the Water plugin chain) | Tessellated LOD mesh; Gerstner+spectral fidelity scales; buoyancy + interaction plugs; in-console tuning | **No.** Full ocean plugin architecture (C++, mesh LOD, Niagara) is out of scale. *Lesson to steal:* (a) separation of water body/tooling from the look; (b) buoyancy is a first-class engine service, not a preset. |
| **Unity (HDRP)** | HDRP Water System (official) + **Crest** (open-source `crest-oceanrenderer`) | HDRP: spectral/Gerstner hybrid, under- and above-water; **Crest: GPU-compute Lovelace/spectral cascades, Jacobian-derived crest foam (same math class as SW's), wave colliders → wakes, dynamic obstruction via `WaveCurrent` etc.** | Very high (Crest de-facto research-grade) | Low-Med (Crest degrades without compute; WebGL2 lost D3D path; HDRP not web-oriented) | GPU-compute cascade LOD; spectrum resolution; **wave colliders / boat wakes**; interaction masks; proper reflection probes | **Partially.** Crest's **architecture** (cascade LOD, compute) is overkill + fails WebGL1. Crest's **interaction maths** (wave collider → wake emitters) is the single most adoptable realistic idea; and **Jacobian foam is already in SW** (same class). |
| **Three.js** | `examples/jsm/objects/Water.js` (classic reflect/refract) + `objects/Ocean.js` + `OceanShader` | **OceanShaderMesh = real Tessendorf GPU-FFT ocean** (JONSWAP spectrum, GPU ping-pong FFT over render targets, dispersion via spectrum, per-frame spectrum+Jacobian); classic `Water.js` = plane + animated normal maps corrected by reflection/refraction | Medium-high (port of MJP's 2011 demo, WebGL2-era, unmaintained-ish) | **High (this is the only browser-realistic reference)** | Everything real looks either procedural (SW) or depends on FFT high-frequency detail; Three keeps parity by lowering resolution on WebGL1 | **Borderline.** FFT via RT ping-pong is portable to GLSL300/WGSL but **not** GLSL100 (no floating-point RT guarantees) — conflicts with mandatory 3-backend parity. Verdict: **defer FFT to Phase B/C** as a WebGL2/WebGPU-only realistic tier; do NOT let it block Phase-A stability. |

### What Small World Machine realistically lacks (realistic path, delta vs industry)
1. **No high-frequency/wave-spectrum detail** — 6 analytic waves can't carry swell+wind chop; FFT or at minimum a dispersion-based procedural normal map would close it (industry has moved past pure Gerstner for open water).
2. **No interaction layer** — no wakes, no contact ripples, no fluid↔collider coupling (Crest/UE2 both treat this as core).
3. **No physics bridge** — buoyancy exists but is box-based and disconnected from the rendered field; the surface plays no part in any rigid-body interaction.
4. **No reflection** — water's only "reflection" is a constant sky tint; a planar or screen-space reflection is missing industry-grade.
5. **Spatially-uniform, camera-agnostic field** — no LOD/tessellation; fidelity is pinned by app-side segment count.

### Adopt / avoid — verdict for a thin, 3-backend, no-fork engine
- **Adopt (realistic, low-risk, parity-safe):**
  - Clapotis as a **gated reflected Gerstner term** in the vertex shader (mirror dominant w1/w2 about a per-pool bounds normal; zero new uniforms — reuse a tag lane or a repurposed slot; only GL2/GPU exact, GL1 gate off). Cheapest honest "physics" win, matches UE/Crest-class standing-wave presence.
  - **Contact ripples / wakes** as depth-gated, object-bounds-projected ring patterns on the water plane (extension of the existing shallow-depth-gate idea, Crest's wake-collider in minimal form; no compute, no collider solver — just distance-to-object-xy from a small uniform list).
  - **Wave-surface probe** (CPU-side analytic Gerstner evaluation at requested XZ) as the single physics↔rendering bridge: buoyancy object positions reference the *actual* rendered field, not a flat AABB top. Cheap, deterministic, testable; feeds both buoyancy (Dave) and contact ripples.
  - **Constant-parameter hardening** (own caustic/crest/spec tunables extracted from the "uniform budget is full" problem via per-styleId constants or a repurposed lane) + a measured regression grid per backend.
- **Avoid for Phase-A:** GPU/spectral FFT (3-backend parity, budget, perf), tessellation/LOD mesh (WebGL1 has no tessellation; screen-space LOD not worth it), SPH/particles, Niagara-style deferred water-particle systems, full underwater volumetrics. All are Phase-B/C research-horizon items.

---

## 4. GOOD / MISSING / STATE

### GOOD (realistic path, keep + protect)
- Physically-correct analytic deep-water dispersion + horizontal-Jacobian whitecap metric, present in **all three backends** with no uniform-cost (G6: this is genuinely the same class of mathematics as Crest's foam). Ref: §1.I-II.
- Live opaque color+depth screen-space refraction with front/behind fallback and Beer-Lambert absorption (GL2/GPU). Ref: §1.IV.
- Post-fix caustic/foam constants prove the audit loop can kill blowouts. Ref: §2.

### MISSING (realistic path)
- Golden-ratio spread (claimed, absent) — the one cheap truth-gap to close.
- Clapotis/wall reflection, contact ripples/wakes, waves↔buoyancy bridge, any water reflection, spectral detail. (§1.V, §3 delta.)
- Any measured quality gate for the realistic constants; no own caustic tunable.
- WebGL1 realistically below bar (accepted, but GL2/GPU-only claim should be stated in docs).

### STATE
Everything that makes OpenWater "realistic" is **shader-procedural and physics-free downstream of six hardcoded waves**. The engine has the correct *math primitives*; it lacks the *data plumbing* (probe, interaction, tuning lane) and the *verification grit* that would make it "hard". Architecture ahead of physics/robustness — aligns with roadmap §2 verdict.

---

## 5. Phase-A goals: stable, hard realistic fluid core

Within the stability-first plan (roadmap §4: measurable acceptance, parity, claims==code, no new glamour). **Bob's realistic-path Phase-A** (Dave owns simulation/kinetics, Erin owns quality gates, Charly owns stylized):

1. **Truth pass (S, no render change):** implement or delete the "golden-ratio spread" claim; align `liquid-improve`/CHANGELOG wording to the real 2+1+2+1 composition; state WebGL1 degradation for the realistic tier in the material doc (`OpenWaterMaterial.ts:12-41`).
2. **Hardened constants, not traps (M, shaders ×3):** promote caustic gain/fade, crest thresholds, spec exponent/gain out of arbitrary literals into named per-style constants or a repurposed slot (uniform budget full — `LiquidWaveMaterial.ts:41-43,99-130`); kill the wall/radial smear structurally (`OpenWater.frag.glsl:123` projection) or physically clamp by `linBgDepth` gradient.
3. **Wave-surface probe (M, engine + physix):** small deterministic `evaluateWaveHeight(x,z,t)` on CPU sharing the exact chunk math (mirror `liquid_gerstner_wave.glsl:5-28`), unit-tested for GL2/GPU parity and used by the buoyancy path — this is the realistic half of "hard". Hand-off: kinetics/wakes to Dave.
4. **Clapotis, minimal form (M, shaders ×3):** gated reflected terms of w1/w2 at pool bounds; GL1 degrades gracefully; new acceptance test asserts term is present in assembly, absent where gated.
5. **Contact wakes, minimal form (S/M):** depth-gated rings projected from an object-interaction mask (Crest-style wake-collider reduced to distance-field rings); no compute, optional in Phase-A; only if (2..4) stay green.
6. **Regression grid (M, Erin-gov):** per-backend screenshots at fixed camera+params after every realistic-path change; Clear/Lava/Slime grade floor raised from "hand-tuned" to "grid-measured"; no dead options, claims==code (matches roadmap §4 acceptance).

Exit criteria for Phase-A realistic path: (a) dispersion+Jacobian+clapotis terms compile in all backends with assembly tests; (b) probe==shader field to within float tolerance on GL2/GPU; (c) clear-water gallery regrades ≥4/5 GL2/GPU with wall-smear measured-gone or motion-scaled to imperceptible; (d) zero claims in docs without code+test backing.

---

**Summary (Bob):** OpenWater already ships physically-plausible primitives — deep-water dispersion (`OpenWater.vert.glsl:91-107`, `liquid_gerstner_wave.glsl:10`), an analytic crest-foam Jacobian (`OpenWater.vert.glsl:113-119`), screen-space refraction with Beer-Lambert absorption — but the composition is mis-documented (no golden-ratio spread, real terms are 2+1+2+1) and quality is fragile: the showcase-measured caustic/spec blowout (Clear 1/5) is only papered over by hand-tuned constants, with the same wall-smear mechanism still in the codebase, and WebGL1 is structurally degraded. Against Godot/Unreal/Unity/Three, SW's gap is not the wave math but the missing data plumbing — no waves↔buoyancy bridge, no clapotis, no wakes, and a fully-occupied uniform layout that turns every tuning knob into a constant trap; FFT/tessellation are the Phase-B research horizon, not Phase-A. For a stable "hard" realistic core Phase-A should close the truth gaps, harden the existing constants into tested artifacts with a per-backend regression grid, and add the minimal physically-honest features (CPU wave probe, gated clapotis, contact rings) rather than new visual surface.
<!-- END liquid-roadmap.round1.Bob.md -->

---

<!-- BEGIN liquid-roadmap.round1.Charly.md sha256=599380fff834ae2a98ada555b50fdca7cf411e510ff6d6439af566fbdeb56930 bytes=16087 -->
# Round 1: Charly (Stylized/NPR Water & Artist Workflow) — 2026-10-05

Scope: stylized/NPR path + artist workflow only. Research only, no code changes. All paths repo-absolute `P=<repo-root>`. Base: HEAD + dirty tree state per showcase10 notes (F22). Grades below are peer-JUDGMENT from screenshots in showcase10-quality/-fixes2, not objective metrics.

## 1. Verified state of the stylized path (file:line)

### 1.1 Style ladder + parameter-vector presets — VERIFIED PRESENT
- 5-style ladder `flat/toon/bold/soft/sparkle/dredge/custom` + `styleId` (0 toon, 1 soft, 2 sparkle, 3 extension, 4 dredge, 5 bold): `StylizedWaterMaterial.ts:79-100` (interface/vector), `:102-178` (`STYLE_PRESETS` as pure parameter vectors), `:203-268` (explicit options override preset defaults). The "Anime" family concept and "looks as parameter vectors" fully match ADR 0025 (`docs/adr/0025-...md:22-24`).
- Shader dispatch from `styleId` float, margin-0.5 integer selectors: `StylizedWater.frag.glsl:55-60`, mirrored `:frag.glsl100:52-57` and `:frag.wgsl:22-27`. Painterly family = `(styleId>0.5 && <2.5) || styleId>3.5` (frag:57).
- Flags hard-branch three different code paths: anime caustic net + soft foam when `styleId>0.5` (frag:102 vs 118 legacy toon), sparkle glint step (frag:176-180), dredge fog (frag:155-160).

### 1.2 Hook mechanism — VERIFIED PRESENT, IN PRODUCTION, but only 2 tokens
- `composeStylizedWaterSources()` + `[WATER_EXT_DECL]`/`[WATER_EXT_SURFACE]`: `StylizedWaterMaterial.ts:17-40`; tokens placed in `StylizedWater.frag.glsl:37,236`, `.glsl100:34,206`, `[WGSL_WATER_*]` in `.frag.wgsl:4,197`.
- Live production use (not toy): `packages/liquid-extras/NoirWaterMaterial.ts:94-135`, `OilSlickMaterial.ts:101-178`; both mirror GLSL300/100/WGSL hook text manually and have tests.
- Confirms inventory cl/e: exactly 2 hooks, not the 5 `#SW_INJECT_*` of the older collaboration premise. The 5-hook design is superseded by ADR 0025 and does not exist in code.

### 1.3 Chunk features — VERIFIED PRESENT
- Anime caustics (F1−SmoothF1 Voronoi line factor + domain warp): `chunks/liquid_caustics.glsl:1-45`, `.wgsl:1-44` (GLSL100 reuses the `.glsl` file per chunk convention).
- Glint 4-point astroid stars, stepped framerate, hash-gated: `chunks/liquid_glint.glsl:4-28`, `.wgsl:3-27`; `stepFps = isSparkle ? 8 : 12` `StylizedWater.frag.glsl:177`.
- `skyTint`-as-reflection (procedural sky, no `u_reflectionMap` sample anywhere in water frags — inventory §5 holds): `StylizedWater.frag.glsl:163-167`; glsl100 `:121-123`.
- Painterly ripple strokes, noise-warped, gated by `depthDiff` (=Δd from refraction depth capture): `StylizedWater.frag.glsl:183-199` (`depthDiff` at `:75`). This matches the inventory: it's decorative near-shore strokes, NOT object wakes.
- `aaStepMask` de-quantizer with `fwidth`-scaled width: `frag.glsl:43-46`; GL1 fixed-width constant (no `OES_standard_derivatives`): `frag.glsl100:41-43`.
- WebGL1 degradation via fresnel-as-depth proxy: `frag.glsl100:103-107` (extension min-depth `:104-106`), edge proxy `:156-158`, foam proxy `:184-189`.

### 1.4 Backend/parity honesty checks
- GLSL300 vert writes `v_displacementY` (`StylizedWater.vert.glsl:75,108`) which is declared-but-NEVER-READ in `frag.glsl:7` (no body use). GLSL100 frag does NOT declare it; the `.glsl100`/`.wgsl` verts (`StylizedWater.vert.wgsl:1-51`) have no displacementY output at all. So the dead varying is a GLSL300-only leftover, ALU wasted on one backend only — and the stylized path has NO crest foam anywhere, unlike OpenWater (inventory §2b holds).
- `u_styleA`/`u_styleB` lane packing: `StylizedWaterMaterial.ts:288-300`; 256-byte slot fully consumed (inventory §6). Extension params ride in repurposed lanes — Noir/Oil both reuse `u_styleA.w` (lineWidth) and force `lineDensity`/`glitterStrength` 0: `NoirWaterMaterial.ts:67-69,104`, `OilSlickMaterial.ts:76-78,120`.
- CONTEXT/ADR naming debt: "Anime Fluid Family" cites `UniversalFluidMaterial` (`CONTEXT.md:7-9`) and ADR 0025 does too (`docs/adr/0025:20`) — class does NOT exist (inventory §1); the modular stylized core is `StylizedWaterMaterial`.

## 2. Measured quality state (showcase10 findings after fixes2)

Critical/major findings F23-F32 (my showcase10-quality round) and their post-fixes2 status (via fixes2 F1/F8/F12 peer reviews):

| Finding (round 1) | Isse | Post-fixes2 status |
|---|---|---|
| F23 ripple bands (fixed) | Painterly strokes now noise-warped; `lineWidth` is thickness 0..1 in painterly (`frag.glsl:185-193`). RESOLVED (Bob F8: soft/sparkle/dredge clean). |
| F24 caustic blobs | Halo/core re-tuned; bold now reads "dark saturated blue caustic net" (Bob F8). RESOLVED on GL2/GPU; never re-audited numerically. |
| F25 white-out patch | GL2/GPU toon has no bright patch (Bob F8); GL1 dredge smudge fixed via spec ×0.5 + edge-weight cap (fixes2 F12). RESOLVED for GL2/GPU; WebGL1 remains one grade below. |
| F26 milky GL1 | No depth on GL1 is inherent; proxies capped (edge 0.3, spec 0.5, fixes2 F12). WebGL1 toon top ~3, dredge ~2.5 (Bob F8). ACCEPTED DEGRADATION, still the weakest lane. |
| F31 ladder indistinguishability | GL2/GPU ladder distinct: toon 3.5 / bold 3.5 / soft 3.5 / sparkle 4 / dredge 3.5 (Bob F8, fixes2). RESOLVED on GL2/GPU; "soft reads calm/painterly" is my unresolved art-direction doubt, not a measured defect. |
| F29 dredge not murky / F30 cyan clip | Dredge murk improved but is still colour-only + depth fog flag, no scatter term (`frag.glsl:155-160`); sparkle shoulder clamps clip (`frag.glsl:201-206`). PARTIALLY RESOLVED. |
| Glint 8 fps stepping | VERIFIED IN MOTION once (Erin fixes2 F3, 48 frames WebGPU: steps ~every 7.5 frames). Soft (12 fps) not observable (glitter 0 → no glints, by design `frag.glsl:176`). |

Honest verdict: the stylized ladder is now borderline production-grade on WebGL2/WebGPU (peer grades 3.5-4 on GL2/GPU) and clearly sub-grade on WebGL1 (2.5-3, proxy-limited). Residual quality risk concentrates in (a) WebGL1, (b) art-direction doubt on "soft = calm/painterly", (c) sparkle/dredge rely on pre-tuned magic constants that only the author can touch.

Remaining measured/structural defects (code-level, from §1): dead `v_displacementY` (glsl300), "Crest Foam" block does only shoreline foam (inventory §2b), no clapotis/wakes/crest anywhere in stylized path.

## 3. Industry comparison — Godot / Unreal / Unity / Three.js

Axes: stylized-water capability, authoring surface, preset/hook model, browser-fit. Small World Machine row included for honesty.

| | Godot | Unreal | Unity | Three.js | Small World Machine (stylized) |
|---|---|---|---|---|---|
| First-party liquid | None (no water body) — stylized water is community `ShaderMaterial` (GDShader) ports of classic toon-water tutorials | Water plugin (River/Lake/Ocean + Water Mesh quadtree LOD) + **Single Layer Water** material; NPR via Unlit domain + WPO | URP/HDRP Shader Graph; HDRP water decals/surface; NPR via lilToon/UTS-style ramp & toon ramp textures | None — GitDep/community "stylized water" examples (Gerstner + toon shading) on WebGL/TSL | `StylizedWaterMaterial` + `liquid-extras` (Noir/Oil) — the only in-repo stylized system |
| Authoring surface | Embedded shader editor, per-material script; no preset/hook system, artists paste script | Node Material graph (industry standard), water parameter collections, heavy (100s of nodes), desktop/console | Shader Graph nodes + sub-graphs + **custom function nodes** (HLSL) + VFX Graph; rich built-in preview | No editor; TSL node composition in code + hot-reload examples; WebGPU-or-nothing for full feature set | TS presets (`STYLE_PRESETS`) + 2 compile-time fragment hooks; **no runtime editor/preview** for liquid (Material Studio tool is PBR-map oriented: `packages/tools/src/material-studio/*`, PRESETS stone/metal/wood) |
| Preset/hook model | None (fork the shader or nothing) | Material instances of master material; no shader-injection hooks | Custom function nodes ≈ closest analog to our hooks; material presets via URP assets | Full source replacement per material | Param-vector presets + `[WATER_EXT_DECL/SURFACE]` hooks — no engine fork needed for Noir/Oil (proven, ADR 0025) |
| Custom shading cost | Free (script) | Node graph, high friction | Medium (graph) | Free / branch-y | Close to free within feature envelope |
| Browser-fit | Web (WebGL1/2, low) | Not browser-native | Not browser-native (WebGL export degrades) | WebGPGPU-focused | 3 backends incl. WebGL1, uniform-budget discipline |

### Verdict
- **What the hook+preset model grants that none of the four give us cleanly**: a style system where new published looks ship as *parameter vectors on an untouched core* (sty-backed: the whole `toon..dredge` ladder is one shader file + one TS table, `StylizedWaterMaterial.ts:102-178`), and extension looks ship as *compile-time fragment injection without forking* (Noir/Oil). Godot/Three require whole-shader replace; Unreal/Unity need heavy node graphs that do not exist in a browser engine and would be enormous build/performance overhead here.
- **What it misses vs material graphs/node editors**: any live or visual authoring. Unity Shader Graph/Unreal nodes give drag-value editing, instant preview, and (Unity) a per-node live evaluator; Three TSL gives code-level hot-reload. Our artists must edit TypeScript and recompile to change a ramp margin or a caustic halo width. The single biggest parity gap of this scope.
- **What we consciously should NOT copy**: the node-graph editor itself (adds editor+serialization+JIT weight absurd for a 256-byte-uniform procedural surface), Unreal's water-body mesh pipeline (our next phase can reuse the existing `Plane` segmentation — inventory §3) and Unity VFX-Graph splash complexity (no particle budget yet).

## 4. GOOD / MISSING / STATE

### GOOD
- Hook/preset architecture (ADR 0025) is, within this comparison set, a defensible unique position: 0 ALU/uniform cost for default styles, extensions without engine forks, ESLint-enforced engine↔extension boundary, back-compat guaranteed for `styleId==0`.
- Painterly art-direction tech (aaStepMask de-quantizer, stepped-fps glints, noise-warped strokes, skin-tone lane reuse) is rare care for a browser engine; 3-backend parity is actually maintained on all three paint branches.
- The "looks as parameter vectors" design genuinely scales within the current feature envelope: any new *vector* is a new table row + a `styleId` integer, no shader edit.

### MISSING (ranked by artist-workflow value)
1. **No runtime/live preview or parameter UI for liquid.** The `for_tools` Material Studio exists but only covers PBR maps (stone/metal/wood presets — `packages/tools/src/material-studio/MaterialStudioController.ts:37`); there is no surface to nudge `rampSoftness`, `causticStrength` or a ramp colour live. This is the #1 parity gap vs Unity/Unreal/TSL.
2. **No palette/ramp editing.** The depth ramp is a hardcoded `mix(shallow→mid→deep)` with fixed half-point colors (`StylizedWater.frag.glsl:138-144`); no curve/ramp import, which is exactly how Ghibli-soft and UTS-ramp norms are tuned in industry.
3. **No per-backend tuning surface.** GL1 degradation knobs are magic constants in shader text (`frag.glsl100:129,159`) — an artist cannot set a "WebGL1 quality budget" per style.
4. **Style map fragility.** Adding a 6th published style edits `STYLE_PRESETS` AND the float switch map with 0.5 margins (`StylizedWater.frag.glsl:55-60`) in 3 backends simultaneously; margins are float-compare, not a registry/enum dispatch.
5. **Only 2 fragment hooks; no vertex/mesh/pass hooks.** Extensions needing vertex-side work (crest foam varying, contact wakes) cannot — the vert is fixed (`StylizedWater.vert.*` has no token). Dead `v_displacementY` (`vert.glsl:108`) is the concrete casualty of this.
6. **Yes-test gap**: `StylizedWaterMaterial` absent from `ShaderAssembly.test.ts`/`ShaderValidation.test.ts` matrices (inventory §7); only `StylizedWaterMaterial.test.ts` (style-ladder/hook composition) and the two extension-package tests cover it.

### STATE — honest
- **Ladder (toon/bold/soft/sparkle/dredge):** borderline production-grade on WebGL2/WebGPU; WebGL1 a documented, accepted degradation but still the visibly weak lane. Not yet "really good, hartes System" in the moderator sense.
- **Extension styles (Noir/Oil):** mechanically 3-backend-clean and tested, artistically the weakest entries (Noir 2.5/5 regression discussion, fixes2 F10) — they live in an extension package, so they are deliverables of community quality, not engine quality.
- **Claims-vs-code:** the "5 hooks", "UniversalFluidMaterial", and "Crest Foam" of the older collaboration are NOT in code; ADR/DOMAIN docs still carry the stale class name (`CONTEXT.md:7-9`, `adr/0025:20`).

## 5. Phase-A goals: stable, artist-usable stylized core

Stability-first: fix claims, close dead code, then give artists the smallest live surface. No new water features (no clapotis/wakes/crest/particles) before the core is honest and hardsurface.

- **P1 (correctness, S):** delete or wire `v_displacementY` (`StylizedWater.vert.glsl:75,108` + `frag.glsl:7`) to an actual crest-foam term or remove it; keep 3-backend parity. Closes measured claim/state mismatch at low risk.
- **P2 (naming debt, S):** fix `UniversalFluidMaterial` → `StylizedWaterMaterial` in `CONTEXT.md:7-9` and `docs/adr/0025:20` (inventory §1). Pure documentation honesty.
- **P3 (artist workflow, M — highest value):** a liquid live-tune surface, minimal version: a debug hotkey/pad in showcase 10 (or an optional Material-Studio "Liquid" pane) mutating `rampSoftness/causticStrength/skyTint/styleId` + a ramp colour, with a "reset to preset" key. This is the minimal parity step toward Unity/TSL live-visibility and directly serves the artist persona.
- **P4 (per-backend budget, S):** promote the hardcoded GL1 clamps (`frag.glsl100:159`, `:129`) to named per-style constants (a `WEBGL1_*` const block shared by the 3 backends where feasible) so artists get an explicit "GL1 quality budget" instead of invisible magic.
- **P5 (scalability of the style map, M):** replace the float-`styleId`-with-0.5-margins dispatch (`StylizedWater.frag.glsl:55-60`) with an explicit integer/enum switch mirrored in 3 backends, and document the "add a style" contract so new published styles touch no shader logic. Keep hook count at 2 for Phase A.
- **P6 (test coverage, M):** add `StylizedWaterMaterial` (and Lava/Slime) to the `ShaderAssembly`/`ShaderValidation` matrices (inventory §7). Härte abnahmefähig: 3-backend parity proven by tests, not claims.
- **Acceptance (all phases):** `npm run lint:fix`, `npm run build:lib`, `npm run test` green; static-analysis-grade "claims==code" on `CONTEXT.md`/ADRs; no dead options; zero new uniform lanes (256-byte slot untouched).

### Vision (beyond Phase A)
Keep the stitizable-stylized core as the *only* NPR liquid and turn the extension package into a reference authoring kit (documented Noir/Oil patterns → "this is how you write a look"). Future styles arrive as parameter vectors or extensions, never engine forks. Härte first: the ladder must read distinct and stable on all tested backends before any new glitz is approved.

---

**Summary (task result):** The stylized path is real, 3-backend-parity, hook-production-proven, and after the fixes2 rounds the toon/bold/soft/sparkle/dredge ladder reads distinct and clean on WebGL2/WebGPU (peer grades 3.5-4), with WebGL1 an accepted but visibly weaker degradation. Its genuinely differentiating assets are the parameter-vector presets and the 2 fragment hooks — but the model only scales within the current visual feature envelope, and the artist workflow (live preview, palette/ramp editing, per-backend tuning) is the largest parity gap versus Unity/Unreal/TSL. Phase A should be stability-honesty: kill the dead `v_displacementY` and stale `UniversalFluidMaterial` claims, then add the smallest live-tune surface and explicit style-map/tests before any new water features.
<!-- END liquid-roadmap.round1.Charly.md -->

---

<!-- BEGIN liquid-roadmap.round1.Dave.md sha256=b7fb80e76c2d1620a9c9a849da5d8f84d5a4fa9d95774ff58305e9c75578b297 bytes=16295 -->
# Round 1: Dave (Simulation & Interactivity) — 2026-10-05

Scope: **kinetics only** — interactive water dynamics, object/contact/react interaction, physics↔render feedback, splash/dropper response, buoyancy honesty. Bob owns realistic optics, Charly stylized look, Erin quality. I cross-check the prior `liquid-improve.md` P1 claims ("contact ripples via scene depth", "Kelvin wakes", "clapotis") against the actual repo HEAD. Result: all three were claimed in `liquid-improve.md:203-208` and its P1 consensus, none are implemented (matches the inventory verdict §2c/d).

## 1. Verified state of dynamics/physics (file:line)

All paths under `P=<repo-root>`. Every statement below re-verified on HEAD (no edits).

- **Physics "fluid" is a flat passive container, decoupled from the visible surface.**
  - `FluidVolume` is a pure data holder: bounds (AABB), density, drag, currentVelocity. **No wave height, no pressure, no surface representation** (`P/packages/engine/src/physix/FluidVolume.ts:10-16`).
  - `BuoyancySolver.applyFluidForces` is static, Archimedes-only `F_buoy = -gravity.y * density * displacedVolume` with submergence from **AABB-overlap against the flat box top** `waterTop = fv.bounds.max.y` (`BuoyancySolver.ts:76-92, 111-124`). Output is body forces/drag only — nothing reads or writes water surface data.
  - `PhysicsSystem` ingests it (`addFluidVolume` `PhysicsSystem.ts:120`, `applyFluidForces` `PhysicsSystem.ts:296`) and feeds Euler integration (`PhysicsSystem.ts:298-304`).
  - **Critical honesty gap:** bodies float on a flat `bounds.max.y` plane (`BuoyancySolver.ts:76`) while the *rendered* surface is a Gerstner sum in the vertex shader. A buoyant barrel therefore bobs on an invisible flat level that does not exist visually. The two subsystems share zero constants.
- **No app wires it up.** `grep -rn "FluidVolume|BuoyancySolver|applyFluidForces" apps/` → **0 hits**. `apps/showcases/10/showcase.ts` has no `PhysicsSystem`/`RigidBody` usage at all (only showcases 21/23 call `physics.step`). Water in every showcase is a static segmented `Plane` (`apps/showcases/10/showcase.ts:~1083`) displaced purely by shaders.
- **No object wakes.** `git grep -i wake` in `packages/engine/src/` → only `RigidBody.ts:200 wakeUp()` (rigid-body sleep, unrelated). 0 hits in `materials/shaders/`.
- **No contact/generated ripples** — only decorative near-shore strokes gated by depth:
  - `depthDiff` built from captured opaque depth at `StylizedWater.frag.glsl:75` (WebGL2/WebGPU only; GL1 uses default far-depth `WebGL1Renderer.ts:688-690`).
  - The only "ripple" is a stroke pattern faded out by depth at `StylizedWater.frag.glsl:183-199` (`… * (1.0 - smoothstep(0.0, 5.0, depthDiff))`, lines 193 & 196). It is **not** generated by any body position/motion — no ring-wave source, no obstacle.
- **No clapotis / standing waves.** `git grep -rni clapotis` repo-wide → 0 hits. No reflected Gerstner term (per-`liquid-improve.md:203-205` Erin plan) exists in any vertex/fragment shader.
- **No splash/dropper-driven response.** The only time input to water materials is a scalar `LiquidWaveMaterial.time` (`LiquidWaveMaterial.ts:54`, bound as `u_time` at :108/:165). Nothing can inject a displacement/splat.
- **No foam advection.** Foam is static procedural (fixed-world-UV cell noise + time): `StylizedWater.frag.glsl:216-230`; OpenWater crest is analytic-at-rest `smoothstep(0.65,0.95,v_crest)` `OpenWater.frag.glsl:114`. No transported/decaying foam field.
- **Dead pre-existing channel:** `v_displacementY` is written (`StylizedWater.vert.glsl:75,108`) but only declared, never read, in the fragment (`StylizedWater.frag.glsl:7`). An already-allocated varying across all 3 backends — free signal lane, currently wasted.

## 2. Wiring constraints (uniform budget, 3-backend, multiple engine instances)

- **256-byte uniform slot is full.** `ObjectUniforms` = 64 floats = 256 bytes (`…/web_gpu/chunks/structs.wgsl:34-58`, `styleA` :56 / `styleB` :57), pinned by `WebGPUObjectUniformPacker.test.ts:89-117` and ring-buffer stride 256 (`GPUObjectRingBuffer.ts:36-39`). `u_styleA`/`u_styleB` are consumed by StylizedWater (`StylizedWater.frag.glsl:26-27`; `StylizedWaterMaterial.ts:288-300`). `LiquidWaveMaterial.ts:41-43` documents **"zero spare float slots left"**. → **No free vec4.** Every interaction signal must arrive via a *repurposed lane* (already the established pattern: `LiquidWaveMaterial.ts:98-130`, `FluidSurfaceMaterial.ts:187-243`) or a *new texture binding*.
- **Texture lane options:** already-bound samplers `u_opaqueMap`/`u_opaqueDepthMap` (`LiquidWaveMaterial.ts:188-189`). Reusing the existing opaque **color** capture as an interaction channel costs **0 new bindings** and even works on WebGL1 where color *is* sampled (`StylizedWater.frag.glsl100:29,62`, `OpenWater.frag.glsl100:28,50`) — depth does **not** (`WebGL1Renderer.ts:688-690` default far-depth). So: depth-gated dynamics = WebGL2/WebGPU; color/emissive "splash paint" trick = all 3 backends.
  - Adding a *new* interaction sampler hits the enforced **16-sampler budget** (`ShaderValidation.test.ts:98,149,179`) → must displace an existing water sampler or extend the budget. Prefer the already-captured lanes.
- **Compute is WebGPU-only** in this engine: compute pipelines exist only in the WebGPU backend (`WebGPURenderer.ts:660` cluster cull, :729 HZB, `post/passes/AOPassGPU.ts:47` AO); **no compute in GL backends**. A compute-driven heightfield sim therefore **breaks 3-backend parity** unless paired with a documented GL fallback (static waves). GL *does* have gated half-float FBO support (`WebGL1Renderer.ts:1119-1120`, `WebGL2Renderer.ts:1614-1617` w/ `EXT_color_buffer_float`) → ping-pong FBO wave sim possible on GL2/WebGPU, risky on GL1.
- **Multiple instances / no singletons:** the sim state must be per-water-plane/per-engine object the app owns. `PhysicsSystem` is already per-engine (constructor-injected `events`, `PhysicsSystem.ts:118`) and is the natural *ingestion* point for interaction events; the *delivery* point to the material needs a typed data contract (see §5, testability) — never a global.
- **Testability ceiling:** only a **pure-JS typed contract** (e.g. a bounded splat/wake buffer the app/physics writes, the renderer samples) is unit-testable today (`FluidVolume.test.ts`, `BuoyancySolver.test.ts` exist). Anything baked only into shader constants is untestable in this repo's harness. Shader-side work is gated by `ShaderValidation.test.ts`/`ShaderAssembly.test.ts` — and **StylizedWater is currently absent from both matrices** (inventory §7, shader validation lists cover FluidSurface/OpenWater only).

## 3. Industry comparison — Godot / Unreal / Unity / Three.js

Axis: how each engine handles *interactive water/sim dynamics* and whether it maps onto Small World Machine's thin, 3-backend, full-uniform design.

| Engine | Dynamic/interactive water approach | Surface type | Cost of the feature there | Transferable to Small World Machine? |
|---|---|---|---|---|
| **Godot 4** | No built-in water sim. Community addons = Gerstner shaders + cheap SSR, particle splashes. Physics = plain rigid-body buoyancy (Area/fluid volumes), no wave feedback. | Shader-side only | Very low; primitive | **Yes conceptually — SW is already here** (shader-side surface + buoyancy solver). Godot proves a small engine can ship *some* interactivity via add-ons, but offers nothing more mature to copy. |
| **Unreal (Water plugin + Niagara Fluids + Zibra)** | WaterBody with runtime mesh + "water info" (GBuffer-stamped depth/flow) driving buoyancy, GBuffer interaction for wakes/foam; Niagara Fluids = SPH/2D fluid compute; ZibraAI = volumetric liquids. | GBuffer-stamped interaction channels + compute, massive fixture/GPU budget | Very high (D3D12/Vulkan compute, per-fixture data) | **Concepts yes, budget no.** Water-info style channel = the *right* pattern (interaction stamped into a channel, sampled by water) and matches SW's "reuse captured lanes" option; but UE's GPU/compute budget exceeds SW by normalizing on the lens, and no 256-byte wall. |
| **Unity (Crest open-source + HDRP Water)** | Crest: GPU-compute cascaded wave spectra, **collider-driven wakes/foam injected into a heightfield**, advected jacobian-foam render targets, Kelvin wake from boat colliders. HDRP: splat interactions. | Compute heightfield + interaction/advection RTs | High (compute, RT ping-pong, not multi-backend) | **The industrial reference for what SW would like**, but Crest is compute-first ⇒ would be **WebGPU-only** here (breaks parity) or a heavy CPU fallback. Rabbit hole at current scale unless a documented GL degradation is accepted. |
| **Three.js (browser)** | interactive heightfields via **ping-pong float FBOs**, wave-equation 5-point stencil, GPU-fluid (Dobryakov), particle splashes — all WebGL2-targeted, single-backend, no uniform budget wall, no WebGL1 obligation. | Fragment/vertex on float FBOs | Medium; proven in-browser | **Techniques feasible in-browser, proven.** But porting to SW means adding the WebGL1 degradation + 256-byte-lane constraints they don't have. Good source of minimal splat/CFL-stable solvers to *mirror in JS* (CPU buffer), not to import as compute. |

**In-browser feasibility verdict for Small World Machine (kinetics only):**
- **Feasible at near-zero cost, 3-backend-safe, now:** buoyancy↔surface *honesty* fix (shared height constants, no shader change); analytic clapotis reflection *per configured wall* inside the existing 6-wave vertex loop (pure vertex math, no new lane); directed splash/dropper via a **repurposed uniform lane** (1-4 simultaneous splats) — bounded, CFL-safe decay.
- **Feasible with 0 new bindings:** contact/splash response delivered through the already-bound **opaque color capture** (emissive "splash source" markers rendered into the scene, sampled by water) — works on WebGL1 (`u_opaqueMap` sampled in `glsl100` at `StylizedWater.frag.glsl100:29,62`), WebGL2, WebGPU. The depth-differential version (true obstacle wakes off `depthDiff`) is WebGL2/WebGPU-only by the existing depth-gap (`WebGL1Renderer.ts:688-690`) — matches the documented-accepted GL1 degradation.
- **Feasible but parity-breaking (must document the GL fallback):** ping-pong FBO / compute heightfield (FFT or 5-point stencil) → WebGPU-compute or GL2-half-float, WebGL1 = static-wave fallback. Architecturally consistent with the precedent of *documented* GL1 gaps, but a large cost — Phase B/C, not Phase A.
- **Rabbit hole, do not now:** full Ningara/Zibra-style **SPH/particles**, volumetric **foam advection RT with connectivity**, **FFT Tessendorf ocean with reflection**, modal **sloshing** solvers, general (non-analytic) wall collision reflection. Each needs compute/RT machinery the engine doesn't yet justify.

## 4. GOOD / MISSING / STATE

**GOOD (verified present, kinetics-relevant)**
- A working, tested `FluidVolume`+`BuoyancySolver` foundation (`FluidVolume.ts`, `BuoyancySolver.ts:36-128`) and clean `PhysicsSystem` ingestion (`PhysicsSystem.ts:120,296`) — the *sink* side of interactivity exists.
- Repurposed-lane culture is established and uniform-budget-tested → new signal lanes are the norm, not an exception (`LiquidWaveMaterial.ts:98-130`; `WebGPUObjectUniformPacker.test.ts:89-117`).
- Already-captured `u_opaqueMap`/`u_opaqueDepthMap` (`LiquidWaveMaterial.ts:188-189`) — the *carrier channel* for contact interaction already exists and is bound in all backends.
- `depthDiff` gate machinery verifiably present (`StylizedWater.frag.glsl:75,193,196`) — the *primitive* for depth-aware interaction is there, just not fed by dynamics.
- Half-float FBO + WebGPU compute primitives exist (`WebGL1Renderer.ts:1119-1120`, `WebGL2Renderer.ts:1614-1617`, `WebGPURenderer.ts:660,729`) — escape hatch for a true sim later.

**MISSING (verified absent)**
- Any dynamics→surface feedback. Physics output stops at `rb.forces` (`BuoyancySolver.ts:114-124`); zero of it reaches renders.
- Object wakes, contact ring-ripples from actual bodies, clapotis/wall reflection, splash/dropper injection, foam advection — all 0 hits (`git grep wake` / `clapotis`) — **the entire "interactivity" axis is unbuilt**, matching inventory §2c/d.
- A typed, testable interaction channel (splat/wake buffer) — nothing between app input and shader exists.
- `StylizedWaterMaterial` in the shader test matrices (`ShaderValidation.test.ts`, `ShaderAssembly.test.ts`) — prerequisite hardening gap for my lane.

**STATE**
- Interactivity: **not started** — the architecture deliberately deferred it; the two hard prerequisites (opaque-capture lanes, repurposed-lane discipline, physics ingestion) are in place and green. The `liquid-improve.md` `[VERIFICATION_PASSED]` (:323) over-claims: only the *shader-side* portion landed; P1 items 3 & 4 (clapotis, contact ripples, item `liquid-improve.md:203-208`) never shipped.

## 5. Phase-A goals: bounded, testable interactivity

Stability-first; every item has a measurable acceptance gate; no compute dependency; keeps WebGL1 documented-degradation only. **Pre-requisite for all of it** (harden the lane): add `StylizedWaterMaterial`, `LavaMaterial`, `SlimeMaterial` to `ShaderValidation.test.ts` / `ShaderAssembly.test.ts` matrices (currently missing, inventory §7) so future shader changes are actually covered.

1. **[P-high, tiny cost] Buoyancy↔surface honesty** — mirror the Gerstner height in a pure-JS surface-query the buoyancy solver calls instead of the flat `fv.bounds.max.y` (`BuoyancySolver.ts:76`). Uses existing `FluidVolume` unchanged; makes a floating object track the *visible* wave. Gate: unit test asserting bob follows registered height function; no shader/uniform change. Highest credibility-per-cost; unlocks every later interaction.
2. **[P-high] Contact/splash response via a typed splat buffer** — a per-water-plane `SurfaceRippleField` (pure JS, owned by app — no singletons) holding a small number of `{pos, time, energy}` splats, the app/physics writes it (this subsumes the "dropper"), the renderer ships it to the shader through a **repurposed lane** (bounded count, e.g. 1-4) or the **already-bound opaque color capture** for many sources. Ripple energy decays with distance from the source (replacing the depth-only decorative gate at `StylizedWater.frag.glsl:193,196` with a genuine source-driven ring). Gate: JS unit test on decay/CFL bound; shader-assembly test green; WebGL1 color-channel fallback documented.
3. **[P-mid] Analytic clapotis at configured walls** — per-wall reflected Gerstner term added to the existing 6-wave vertex loop (`liquid-improve.md:203-205` formula `D_ref = D_inc - 2(D_inc·n)n`, amplitude trap ~2A near the wall), wall list as a per-styleId constant app-documented (no new lane needed if walls are style constants; a dynamic wall would need one repurposed lane). Pure vertex math, 3-backend-safe, ~zero uniform cost. Gate: parade of `[VERIFICATION_PASSED]` replaced by a real shader test asserting `D_ref` sign flip; showcase wall bakes a standing surf. **Explicitly not**: general-geometry reflection.
4. **[P-mid] One moving Kelvin wake** — analytic wake field (19.47° wedge, `liquid-improve.md:93-104`) driven by a single rigid body's pos/vel via one repurposed lane — only when a showcase actually contains a boat/heli; otherwise P2. Gate: wake only appears for a moving body (unit-tested CPU shape + shader gate).
5. **[Defer, documented horizon — rabbit holes**: FFT ocean, SPH/Zibra-style particles, advected foam RT, modal sloshing — all need compute/half-float infrastructure that breaks or heavily loads 3-backend parity; park them behind the WebGPU-compute escape hatch (`WebGPURenderer.ts:660,729`) with a documented WebGL1 static-wave fallback.

**Ordering rationale:** 1+2 give the *perceived* interactivity (things visibly react: buoyant body tracks waves, splash rings emanate from the dropper/wake) at a fraction of the cost of any compute path, on the already-green plumbing, and each carries a JS-level acceptance test. 3 is nearly free and squarely on the "beckenwand" ask. 4 is showcase-dependent. Everything else stays a clearly-labeled future horizon so Phase-A never blocks on compute.
<!-- END liquid-roadmap.round1.Dave.md -->

---

<!-- BEGIN liquid-roadmap.round1.Erin.md sha256=9980615d36c91755c9853dfb5022c7be8894c166a36dc33ea04ba865d4de8d84 bytes=22167 -->
# Round 1: Erin (Quality, Robustness & Performance Audit) — 2026-10-05

> Stance: RED-TEAM, evidence-only. Verified against repo HEAD `b27625d7`. No tests executed (per brief).
> Sources: `liquid-roadmap.md`, `liquid-roadmap-inventory.md` (I re-verified its §2/§7 claims in-tree), `showcase10-quality.md` (F1–F32), `showcase10-fixes2.md` (F1–F15 reviews), `liquid-improve.md` §9–11, test files listed in the brief, `packages/liquid-extras/src/materials/*` current source.
> Notation: VERIFIED = present, matches claim. PARTIAL = present but not what was claimed. ABSENT = claimed, zero code.

---

## 1. Claims vs. reality (liquid-improve items, one by one)

Claim source: `liquid-improve.md` P1 consensus (§9, lines 193–218) and Phase B "verified" summary (§11, lines 309–327, `[VERIFICATION_PASSED]` line 323).

### 1.1 "6-wave cascade with golden ratio directional spread" (Bob, §9 Turn 2, line 229; P1 item 1, line 196)
- **OpenWater: VERIFIED (6 waves, no golden ratio).** `OpenWater.vert.glsl:91–96` defines w1..w6, displacement loop sums six `gerstnerWave()` calls (`:102–107`); mirrored in `.glsl100:29–45` and `.wgsl:21–38`. Deep-water dispersion `w = sqrt(9.81 * k)` lives in the shared chunk `chunks/liquid_gerstner_wave.glsl:10` (verified in-tree; reused by all 3 backends).
- **StylizedWater: PARTIAL.** w1..w6 exist (`StylizedWater.vert.glsl:86–91`) but w3 is gated: `if (w3.w > 0.001)` (`:99–101`) → 5–6 waves.
- **"Golden ratio spread": ABSENT.** No 1.618/0.618/phi anywhere in `packages/engine/src/core/materials/shaders/` (grep = 0). Real composition: 2 dominant + 1 gated threshold wave + 2 90°-perpendicular "Detail wave" (`OpenWater.vert.glsl:94–95`) + 1 60° cross-swell (w6, `:96`). The claimed "2 dominant swells, 2 cross-swells 60°, 2 wind ripples" (`liquid-improve.md:229`) is not what the code builds. Overstated.

### 1.2 "Analytical Jacobian … blended seamlessly with the dual-noise shoreline foam in StylizedWater" (Charly, P1 item 2, lines 199–201; §11 line 314)
- **OpenWater: VERIFIED.** `OpenWater.vert.glsl:113–119` J = `t.x*b.z − t.z*b.x`, analytic partials accumulated in `chunks/liquid_gerstner_wave.glsl:16–26`; identical in `.glsl100:55–57` and `.wgsl:50–52` (carried in `Out.original_uv.x`, not `texIndex`). Consumed: `OpenWater.frag.glsl:113–115`, `.glsl100:109`, `.wgsl:87`.
- **StylizedWater: ABSENT.** No Jacobian in any `StylizedWater.vert.*`. `v_displacementY` is written (`StylizedWater.vert.glsl:75,108`) but **never read** — declared-in-only at `StylizedWater.frag.glsl:7` (1 occurrence total; 0 in `.glsl100`/`.wgsl`). Heading "7. Advanced Procedural Foam (Intersection Foam + Crest Foam)" at `StylizedWater.frag.glsl:208` is a lie-by-label: only "7a. Intersection / Shoreline Foam" (`:215–230`) exists; no crest term.
- Note: doc formula `J = tx*bz − tz²` (`liquid-improve.md:239,314`) differs from the implemented (correct, general) `tx*bz − tz*bx`. Doc imprecision is cosmetic; the headline claim ("in StylizedWater") is FALSE.

### 1.3 "Clapotis basin wall reflection" (Erin, P1 item 3, lines 203–205) — **ABSENT**
`grep -rni clapotis`, `D_ref`, `2A` in material shaders → 0 hits. The only `D_ref` matches are unrelated `kD_refr` PBR variables in Glass/Frostglass/Standard. Never implemented; the §11 "verified" list silently drops it.

### 1.4 "Contact ripples & obstacle wakes" (Dave, P1 item 4, lines 207–208) — **ABSENT as wakes**
`grep -rn wake` in shaders/showcase → 0 hits. The `depthDiff` register reuse claim (`liquid-improve.md:250`) is real (`StylizedWater.frag.glsl:75`), but it drives (a) refraction and (b) decorative **near-shore ripple fading** (`:193,196`), not object-contact ring wakes. No barrels/posts wake code.

### 1.5 "Lava: Bingham plastic flow, dual-scale Voronoi crust (F2−F1), Planck emission" (Frank, P1 item 5, lines 210–211) — **ABSENT**
`LavaMaterial.ts:16–59` is a parameter preset on `FluidSurfaceMaterial` (no shader files of its own — inventory §1). No F2−F1 crust, no Planck/blackbody, no yield stress in any FluidSurface shader. What exists: noise-flow + emissive pulse via repurposed uniform lanes (`FluidSurfaceMaterial.ts:187–232`).

### 1.6 "Slime: Stokes creeping flow, bubble inflation/Taylor–Culick rupture, chromatic Beer–Lambert SSS" (Grace, P1 item 6, lines 213–214) — **PARTIAL / mostly ABSENT**
Only the Beer–Lambert absorption term is real (`FluidSurface.frag.glsl:95–97`; preset in `SlimeMaterial.ts`). Stokes `γ∝k²` damping and bubble kinetics: zero code. Viscosity is a uniform slider, not rheology.

### 1.7 "5 injection hooks #SW_INJECT_*" (premise) → **reduced to 2 tokens**
Only `[WATER_EXT_DECL]` + `[WATER_EXT_SURFACE]` exist and are real end-to-end: `ShaderRegistry.assemble` regex token swap (`ShaderRegistry.ts:134–146`), registered in `CoreShaderChunks.ts:92–93/109–110/120–125`, substituted by `composeStylizedWaterSources()` (`StylizedWaterMaterial.ts:305–306`), in production use by `@small-world-machine/liquid-extras` (`NoirWaterMaterial.ts:123–126`, `OilSlickMaterial.ts:164–168`). The "5" was never promised by ADR 0025 — an overstatement in the collaboration docs, not a code gap.

### 1.8 `[VERIFICATION_PASSED]` (§11, lines 323–327) — **OVERSTATED, 2 of 6 targets absent**
- "All 6 implementation targets verified": FALSE. Targets 3 (clapotis) and 4 (wakes) have zero code; target 2 (Jacobian foam) is OpenWater-only; target 1's golden-ratio spread absent.
- "Cross-backend WebGL1, WebGL2, WebGPU parity maintained": **structural parity only, not qualitative.** All three backends compile and share chunks — but WebGL1 is a documented, accepted degradation (depth gap: `WebGL1Renderer.ts:688–690`; fresnel-as-depth-proxy `StylizedWater.frag.glsl100:101–103,156–157`; no caustics on GL1 `OpenWater.frag.glsl100:56,82,88`). The quality audits rated WebGL1 pools at ~1/5 pre-fix, still visibly lower post-fix (see §3).
- "Zero CPU heap allocations on render hot paths": plausible (engine-wide `ZeroAllocation` tests exist under `tests/physix/`) but no liquid-path-specific allocation proof and no perf test; the only showcase perf data is Dave's weak CPU-submit wall-clock (10.7/5.3/1.5 ms webgl2/gl1/gpu, `showcase10-quality.md` F12, self-declared unreliable).

### 1.9 Dead options found in `showcase10-quality` — **FIXED in current HEAD**
F6 `posterizeSteps`, F7 `iridescenceStrength` were dead at audit HEAD (declaration-only). They are now wired through the `u_styleA.w` lane with transport tests: `NoirWaterMaterial.ts:90` (pack) + `:104` (shader consumes `obj.styleA.w`), `OilSlickMaterial.ts:97` + `:132`; transport/clamp tests at `liquid-extras/tests/NoirWaterMaterial.test.ts:31–42`, `OilSlickMaterial.test.ts:33–43`.
- **New minor claim==code gap introduced by the fix:** Noir's shader computes `inkSteps = max(styleA.w − 1.0, 1.0)` (`NoirWaterMaterial.ts:104`), so option `posterizeSteps = N` produces **N−1 quantization levels**, contradicting the documented semantics "number of ink tone levels (default 4)" (`:11`). `posterizeSteps=2` → 1 level (binary, matches the 2=BW doc by coincidence); `4` → 3 levels. Off-by-one, untested.

---

## 2. Robustness & dead code / dead options inventory

| # | Item | Evidence | State |
|---|---|---|---|
| R1 | **Dead varying `v_displacementY`** | written `StylizedWater.vert.glsl:75,108`; declared-in `StylizedWater.frag.glsl:7`, never read (0 reads; 0 occurrences in `.glsl100/.wgsl`) | **OPEN** — remove or implement crest foam |
| R2 | **Misleading "Crest Foam" heading** | `StylizedWater.frag.glsl:208` promises crest foam; only "7a. Shoreline" exists (`:215–230`) | **OPEN** — relabel or implement |
| R3 | **No TODO/FIXME/XXX/HACK markers** | `grep` across `packages/engine/src/core/materials/` + `shaders/` → 0 hits | **OPEN** — open defects are silently carried |
| R4 | **No per-chunk GLSL100 drift check** | chunks only exist as `.glsl`/`.wgsl`; GLSL100 reuses "ES 1.00-compatible" verbose `.glsl` (`chunks/liquid_gerstner_wave.glsl:3–4`), hand-maintained | **OPEN** — no automated cross-backend semantic drift test |
| R5 | **WebGL1 depth gap** | `WebGL1Renderer.ts:688–690` binds far-depth; proxies: `StylizedWater.frag.glsl100:101–103` `depthProxy = fresnel*10`, `:156–162` edgeBlend grazing-only (post-fixes2 clamp 0.3), `OpenWater.frag.glsl100:32–37` | **OPEN, documented/acceptable**; cel-look proxy leaks at grazing (see §3 STILL-OPEN) |
| R6 | **WGSL crest transport hack** | `OpenWater.vert.wgsl:44–52` — crest smuggled in `Out.original_uv.x` with explicit warning that `texIndex` would clobber it (regex injection into GPUPipelineCache vertex functions) | **OPEN risk** — fragile contract, no regression guard |
| R7 | **Uniform-lane contract collision** | `u_styleA.w` now has 3 meanings by styleId: ripple `strokeThreshold`/frequency (base, `StylizedWater.frag.glsl:146,150`), `posterizeSteps` (Noir), `iridescenceStrength` (Oil). Extension overrides `props["u_styleA"][3]` after `super.getRenderManifest()` (`NoirWaterMaterial.ts:90`, `OilSlickMaterial.ts:97` over `StylizedWaterMaterial.ts:292`) — shared mutable array, one write order bug from corruption | **OPEN** — needs a lane-contract registry (ADR 0025 follow-up) |
| R8 | **Noir posterize off-by-one** | `NoirWaterMaterial.ts:104` `max(styleA.w−1,1)` vs option doc `:11` | **OPEN (minor)** |
| R9 | **`u_styleA`/`u_styleB` fully consumed** | 256-byte slot full: `StandardWebGPULayout.ts:30–31`, `structs.wgsl:56–57`; pin test `WebGPUObjectUniformPacker.test.ts:89–133` (styleA@56, styleB@60); repurposing map `LiquidWaveMaterial.ts:98–130`, `FluidSurfaceMaterial.ts:187–243` | **Constraint** — any new style vec4 needs ADR 0013 layout work |
| R10 | **Test-coverage hole (3 materials)** | `ShaderAssembly.test.ts:75–88` materials list: **FluidSurface + OpenWater only** — StylizedWater/Lava/Slime absent from uniform-dup lint; `ShaderValidation.test.ts:25–39`: **FluidSurface only** among liquids (OpenWater/Stylized/Lava/Slime absent from chunk-completeness AND 16-sampler budget). Lava/Slime share FluidSurface sources → no per-type compile proof | **OPEN** — direct contradiction of "verification gate" promise |
| R11 | **Physics/rendering decoupling** | `FluidVolume.ts` (29 ln) pure data; `BuoyancySolver.ts:113` Archimedes; only consumer `PhysicsSystem.ts:120,296`; zero app wiring; no wave-height feedback | **OPEN (arch.)** — no tests at the seam |

Post-fix robustness wins (verified in-tree): `v_clipPos` depth actual handling is now coherent (review `showcase10-fixes2.md` F6); OpenWater GL1 spec lobe eliminated (`OpenWater.frag.glsl100:72` `smoothstep(0.9993,0.9999)*0.25`); glint stepping is 8/12 fps **by construction** (`StylizedWater.frag.glsl` gated branch), confirmed in motion not just code (fixes2 F3).

---

## 3. Quality scoreboard (measured grades, fixed vs still-open)

Measured pool grades synthesized from `showcase10-quality` + `showcase10-fixes2` peer reviews. "STILL OPEN" = culled from the REVIEW findings (fixes2 F6–F15) and still verifiable in current shaders.

| Pool | Grade (GL2/GPU) | Grade WebGL1 | Fixed since F1–F32 | STILL OPEN |
|---|---|---|---|---|
| Clear (OpenWater) | 3–3.5 | ~2–2.5 | crest-foam clumps, GL1 spec lobe (F4), no backend blowout (F11 review) | teal murk — floor tiles unreadable all backends (F6-1); GL1 far-edge white patch at grazing (F6-2); wall-foam clumps (F11-1) |
| Stylized ladder (toon/bold/soft/sparkle/dredge) | 2.5–4 (toon/bold/soft 3.5, sparkle 4, dredge 3.5) | ~2.5–3 | ripple bands (F23), caustic blobs (F24), white-out mitigation + rim weight 0.2 (F8/F12), GL1 edge clamp 0.3 + spec ×0.5 (F12), sparkle desat (F1) | GL1 grazing haze (F8-1, mitigated not gone); soft/sparkle WebGPU rim still borderline bright (F8-3) |
| Lava | 4 | 4 | hue orange-red, emissive 2.4 (F3) | WebGPU crust striping anomaly (F11, never closed) |
| Slime | 2.5–3.5 (3.5 GL2/GL1, **2.5 WebGPU**) | 3.5 | bubble dark rings (F3), WebGPU blowout (F14) | WebGPU still 2.5 close-range (F7-1); bubble detail tiling patch top-right corner (F7-2) |
| Noir (ext) | 2.5 → ~3 (r6 "fine tonal ink hatch" unverified by peer) | similar/slightly cleaner | hatch chaos (F13, F15), black-bias floor, rim foam | r5 "calm" claim peer-verified only as "TV noise" at r4 (F10); final r6 grade never audited by another peer |
| Oil (ext) | 4 | 4 (dark, viscous) | sunk-object brightening (F9), absorption 1.8/1.5/1.2, rainbow tie to fresnel/sun (F5) | large/blurry rainbow blobs (F10); floaters re-verify needed on WebGPU/GL1 (F10) |
| **Gallery / overview** | 2.5 → 4 (fixes2 F3/F7/F14) | loads, no console errors | camera/sky/FOV/signs/subtitle (F14) | row-A sign legibility at start (F7-3) |

**Verdict:** The ladder is real but uneven — nothing sits at "hard & stable 5/5." Clear is the worst offender (murky, floor unreadable), Slime pins a backend-only defect, Noir's grade history oscillates 2.5→3→2.5→"fixed" without a peer-confirmed terminal grade. WebGL1 is consistently a full grade+ below GL2/GPU and is the least-tested path.

**Fixed (verified in-tree):** dead options wired (1.9), GL1 spec lobe, crest clumps, slime rings/blowout, noir tonal hatch, lava hue, showcase chrome.
**Still open (code-verifiable):** R1/R2 dead varying + false heading, R7 lane contract, R8 off-by-one, R10 test hole, clear-water murk, WebGPU slime grade, GL1 grazing artifacts, WebGPU lava striping.

---

## 4. Stability gate: measurable acceptance criteria

A fluid system is "hard & stable" only if these are machine-checked. All criteria are CI-able today.

- **G1 — Test-matrix completeness.** ShaderAssembly material list must include `StylizedWaterMaterial`, `LavaMaterial`, `SlimeMaterial` (add `OpenWater` to ShaderValidation). Keyword: 100% of public liquid materials in uniform-dup lint, chunk-completeness and 16-sampler budget across glsl300/glsl100/wgsl. Current: 0 of 3 in both; OpenWater absent from ShaderValidation.
- **G2 — Backend-drift proof.** Automated GLSL100 parity check: assemble every liquid source in the 3 backends and assert the same set of feature-bearing tokens/uniforms/varyings (a semantic marker manifest, e.g. the "crest foam" tag). Fails on dead varyings (R1) and on any unported feature. Must also run a texture-interpolant-safety scan (fwidth absence in GLSL100, `texIndex` overwrite risk R6).
- **G3 — Zero dead options.** Lint: every `*MaterialOptions` member must be consumed by `getShaderDefinition()`/`getRenderManifest()` or explicitly marked legacy. Precedent already caught F6/F7 in the quality audit — make it a rule, plus a **uniform-lane contract registry** (`u_styleA.w` semantics per styleId) so collisions like R7 are build-time errors.
- **G4 — Claims == code.** Any `[VERIFICATION_PASSED]`-style block must cite file:line for each item and a test that guards it (e.g. a test asserting StylizedWater fragments contain no unused varying if the header promises crest foam — catches R1/R2). Correct §11 to: 2/6 implemented-and-matching, 1 partial, 2 absent, 1 absent-as-promised.
- **G5 — No showcase regressions.** Screenshot-golden set: 10 pools × (top, oblique) × (GL2, WebGPU) plus a GL1 smoke (loads, 0 console errors, no NaN). Any shader change re-runs it; grade drift > ±0.25 requires an explanation. Catches white-outs like F25/F13 structurally.
- **G6 — Perf budget.** Replace F12's wall-clock with: rAF-interval p95 frame time on a reference device over 300 frames (motion scene), CI-adjacent. Hard ceiling per class (e.g. p95 < 16.6 ms mid-tier). Zero-allocation assertion for the liquid uniform pack path.
- **G7 — Zero TODO drift.** `grep TODO` must match the open-defect list — today it returns 0 while §3 lists ~8 open items. Every open defect is either a code marker or a tracked backlog entry; gate fails on silent defects.

---

## 5. Industry comparison (Godot / Unreal / Unity / Three.js) on QA

- **Godot:** *.gdshader* files are compiled **at import time** by Godot's shader compiler; invalid code fails surfaced in the editor before any render, and capability divergence (mobile/compatibility renderer) is rejected at compile, with `needs_redraw`-style refresh semantics per uniform. Transferable: compile-and-lint-every-shader-every-backend **as an import/CI step**, plus per-backend feature rejection.
- **Unreal:** every material is compiled by the ShaderCompilerWorker and **validated against a target platform matrix**; mismatches (e.g. translucency + scene depth on unsupported platforms) produce explicit editor warnings; expensive features are wrapped in **quality-level / material-quality expressions** (sc.quality); the Water plugin (WaterBody / Single Layer Water) ships with its own scalability + documented platform notes. Transferable: a platform-target matrix (GL100/GL300/WGSL) that is *tested*, not asserted; **quality-gated expensive effects** (crest foam, caustics) with explicit defaults — Small World Machine currently gates nothing (uniform constants only).
- **Unity (esp. Crest Ocean System):** Crest publishes a **validation matrix per Unity version + render-pipeline (Built-in/URP/HDRP)**, version-gating of features, sample scenes as executable QA, and regression-tested shader compilation per SRP. Transferable: a **per-engine-version + per-backend compatibility matrix as a shipped artifact** — the browser equivalent is the 3-backend matrix plus a per-browser-context note.
- **Three.js:** compiles at runtime (WebGLProgram) and surfaces console errors; no per-material automated validation; parity between WebGL and WebGPU renderers is enforced by design/tutorials, not tests — regressions are community-caught. Transferable: what *not* to copy; but the runtime uniform-dup warnings and `onBeforeCompile` hook pattern map onto Small World Machine's `ShaderRegistry`/`[TOKEN]` mechanism, which is the correct place.

**Synthesis — what a thin TS/WebGL/WebGPU engine can genuinely adopt:**
1. Import/CI-time compile+lint over the exact 3 backend dialects (already 80% built — ShaderValidation/ShaderAssembly exist, just under-covered, R10).
2. Capability fallback that is *executed in CI* (GL1 smoke load), not merely documented.
3. Feature-quality gating and a registered uniform-lane/layout contract (replaces UE quality levels in a 256-byte budget).
4. Fail-fast authoring rules: unused-varying lint, dead-option lint, wrong-semantics lint — the analog of Godot import failures.
5. A small screenshot-golden suite for visual regressions (industry does this per-project, not per-engine; the 10-pool gallery is exactly the right corpus).
6. Explicit feature-mismatch warnings at material construction (e.g. "refractionStrength has no effect on this backend") instead of silent no-ops — the F7 lesson.

**Adopt consciously, not:** GPU-compute cascades, terrain-tessellation LOD, SPH — all research-horizon items that the roadmap already defers; they do not de-risk the current stability problem.

---

## 6. Phase-A goals: hardening track

Ordered by stability payoff (all touch *existing* files, no new features):

1. **A1 — Close the test hole (S).** Add `StylizedWaterMaterial`/`LavaMaterial`/`SlimeMaterial` to `ShaderAssembly.test.ts` and (with `OpenWater`) to `ShaderValidation.test.ts`. Add an unused-varying assertion that fails on `v_displacementY`; delete the varying and the false "Crest Foam" label (`StylizedWater.frag.glsl:208`).
2. **A2 — GLSL100 drift fixture (M).** Marker-manifest parity test across the 3 backends (G2) + GL1 gallery smoke as a vitest/CI job.
3. **A3 — Lane-contract registry (M, ADR 0025 follow-up).** Centralized map of every repurposed `ObjectUniforms` lane and its meaning per styleId/material; a lint test pins Noir/Oil overrides to the registry (catches R7, R8 — fix the posterize off-by-one here too).
4. **A4 — Claims correction (S, no code).** Rewrite/annotate `liquid-improve.md` §11 to the honest state (G4): 2/6 matching, 1 partial, 2 absent, 1 scope-reduced. Remove `[VERIFICATION_PASSED]` or attach the corrected matrix. Optionally add TODO markers per G7 where code gaps remain (R1/R2/R6).
5. **A5 — Perf methodology + budget (M).** Proper rAF/readback measurement replacing F12; record a budget in the roadmap (G6) and a zero-allocation assertion on the liquid uniform pack.
6. **A6 — Showcase goldens (M).** Screenshot baseline for 10 pools (G5) + a re-grade of Clear (< 3.5 blocker for "hard"), Noir terminal peer grade, and WebGPU Slime.

Date-target: A1/A4 are prerequisites for any feature work; A2/A3 unblock the extension surface (Noir/Oil) from future silent breakage.

---

## BOTTOM LINE

`[VERIFICATION_PASSED]` is the roadmap's single most misleading claim: of the six "implemented and verified" targets, two (clapotis, obstacle wakes) have zero code in the repo, the Jacobian crest foam exists only in OpenWater (StylizedWater keeps a dead `v_displacementY` and a "Crest Foam" label with no crest), and the "golden ratio spread" and all Lava/Slime rheology were never authored — cross-backend parity is real at the *source* level but the WebGL1 path is an accepted, visually inferior fallback with no automated drift check. The two dead options the quality audit flagged are genuinely fixed, but the fix smuggled in a new semantic bug (posterize N → N−1 levels) and codified a shared-`u_styleA.w` lane collision that will corrupt silently without a registered contract. Measured quality is squarely mid-tier: Clear 3–3.5 with unreadable floors, Slime pins a WebGPU-only 2.5, Noir's terminal grade was never peer-confirmed, WebGL1 sits a full grade below — nothing is "hard & stable 5/5." The system is architecturally ahead of its physics and well behind its own documentation. Hardening is cheap and near-term (test-matrix closure, dead-code removal, lane-contract registry, GL1 drift fixture, claims correction) and is the only responsible Phase A; every expensive research item (FFT, compute, SPH, tessellation) must be gated behind G1/G2/G3 results or this roadmap repeats the same claims-vs-reality failure on a larger stage.
<!-- END liquid-roadmap.round1.Erin.md -->

---

<!-- BEGIN liquid-roadmap.round1.Frank.md sha256=96b0f8a23b3dd517c3c79f42451b01cb32e49ebd2e9749455dc0c439392d23b1 bytes=21057 -->
# Round 1: Frank (Research Horizon & Future Roadmap) — 2026-10-05

> Scope: **Ausblick** — where the liquid system *could* go, clearly separated from the near-term stability plan that Alice/Bob/Charly/Dave/Erin own. Built on the verified inventory (`liquid-roadmap-inventory.md`) and the group's existing Phase-A lanes; I do **not** re-derive current state. No code was changed (research only).
> Evidence tags: `[SOURCED]` = industry fact with a public reference; `[JUDGMENT]` = design judgment for Small World Machine; `[ASSUMED]` = reasonable premise, not verified here.
> Per moderator note `liquid-roadmap.md:72`, copyright/licensing is irrelevant to these decisions — I treat everything as technique reference, not as adoptable code, so no license caution shapes the verdicts. [JUDGMENT]

**Ground rules I respect (from the topic doc, non-negotiable):** 3-backend parity GLSL100/GLSL300/WGSL with documented WebGL1 degradation but no stagnation; no engine forks (extension via chunk/hook, ADR 0025); no global singletons; strict types, no `any`; uniform layout **full at 256 bytes** (`inventory §6`); stability/hardness > new glamour.

---

## 1. Leading-edge techniques map (FFT / GPU fluid / interaction / refraction / tooling) — players + browser-feasibility

### (a) FFT / spectral ocean synthesis (Tessendorf)
- **Benchmark:** Unreal Water System (FFT ocean via GPU compute + Niagara); Fluid Flux (UE5, GPU shallow-water sim for interactive surfaces); Crest Ocean (Unity — GPU-compute cascades, lod0 tile LOD, advertised FFT/spectrum); in-browser proven: single-HTML WebGL2 + three.js FFT with JONSWAP/TMA spectrum, 3 cascades, physical foam/caustics (`github.com/topics/water-simulation`, `[SOURCED]`); Three.js Water Pro / TSL WebGPU ocean (V3 2026, `[SOURCED]`); Godot community FFT (addon, no engine support — modders' workaround, `[JUDGMENT]`).
- **Browser feasibility:** **high as a technique** — already shipped in pure WebGL2 in a single file. **Low as a thin multi-backend feature** without a compute layer. The GPU loop is: FFT cascades downsampled per frame, then an inverse-FFT height/normal field sampled by the surface. WebGPU compute is a natural fit (Small World Machine has compute escape hatches: WGSL compute buffer primitives exist per Dave, `WebGPURenderer.ts:660,729` `[SOURCED-in-repo]`). WebGL2 lacks compute — an FFT must be done as oscilloscope-style ping-pong render-to-texture passes (vertical/horizontal 1D FFT), which is heavy, error-prone, and eats the sampler/uniform budget. WebGL1 gets a fixed Gerstner texture (no FFT at all). [JUDGMENT]
- **Takeaway:** FFT is the single most recognizable "next-gen water" marker, but its value for *stylized + interactive* Small World Machine is lower than for realistic open water. It only pays off if a showcase needs credible open-ocean motion far beyond 6 waves.

### (b) GPU fluid simulation (SPH, particle, shallow-water)
- **Benchmark:** Unreal Niagara Fluids (SPH 3D), ZibraAI (Neural/SPH hybrid smoke+water, sold as middleware), Cross-water shallow-water sims, Matthias-Müller-style height-field solvers (5-point Laplace wave equation — works in the browser via 2D ping-pong FBOs, `[SOURCED]` SimonDev-style WebGL wave sims). WebGPU particle/compute demos exist but remain hobby/research tier — no consolidated library ([JUDGMENT], searches surfaced no mature 2026 WebGPU SPH library `[ASSUMED]`).
- **Browser feasibility:** real SPH is **WebGPU-only** in practice (compute + large particle buffers); WebGL2 can only do cheap 2D height-field wave solvers on a small FBO; WebGL1 does none of it. 2D height-field interaction ("splash rings", "dropper") is fully browser-feasible today and is the *only* genuinely cross-backend interactive-fluid option. [JUDGMENT]
- **Takeaway:** For this engine the interactive-horizon should be **2D height-field / waveform interaction, not 3D SPH**. SPH is a WebGPU-only showcase novelty, never a system.

### (c) Wave interaction / colliders / kinematics (Crest-style)
- **Benchmark:** Crest advertises proportionally-advected foam, wake collider system, and layered Gerstner/FFT with dynamic interaction "sims" — the industry gold standard for *interaction* specifically. Horizon Forbidden West documents contact mist + depth-buffer differential interaction. All analytic (no compute required for the interaction itself — only for the foam advection). [JUDGMENT] built on repo-cited sources (`liquid-improve.md:148`).
- **Browser feasibility:** **very high**. This is depth-differential + distance-field + analytic Kelvin-wake territory — pure vertex/fragment math with the already-bound `u_opaqueMap`/`u_opaqueDepthMap` carriers (`LiquidWaveMaterial.ts:188-189`, `[SOURCED-in-repo]`). Crest proves interaction is decoupled from the wave-generation backend (works over Gerstner OR FFT). [JUDGMENT]
- **Takeaway:** Highest value-per-effort axis on the entire horizon. It is the *perceived* interactivity — objects visibly react — and it does not require compute or reflection infrastructure.

### (d) Refraction / reflection quality (planar, SSR, RT)
- **Benchmark:** Planar mirrors (every engine), SSR (post-processing, UE/Unity), RT reflections on water (UE5 Lumen, paid RT — last-gen of water quality), Horizon Forbidden West screen-space reflections. [JUDGMENT]
- **Browser feasibility:** **Refraction** — already present (screen-space captured opaque color/depth; WebGL1 documented gap), quality-limited by capture resolution, not a future blocker. **Planar reflection** — Small World Machine *already has the node* (`PlanarReflectionNode.ts`, `[SOURCED-in-repo]`) but no water shader samples `u_reflectionMap` (`inventory §5`). Wiring it is backend-agnostic (it's a mirrored camera render, not a shader-language feature) — the 3-backend cost is only writing the sampling code. **SSR** — needs a full post-processing chain + its own pass; medium effort, real quality risk on stylized art. **RT reflections** — rabbit hole for a thin engine (WebGPU ray-query experimental, WebGL2 none).
- **Takeaway:** planar-reflection wiring onto the existing node is the only reflection move that stays thin; SSR only if a realistic showcase demands it; RT never.

### (e) Artist tooling (VFX Graph / ShaderGraph / material layers / live parameter surfaces)
- **Benchmark:** Unreal Material Editor/VFX Graph, Unity ShaderGraph + Crest's inspector panels, Godot visual shaders — all are *graph editors over node graphs*. Small World Machine is not going to build a node graph ([JUDGMENT] — that's an editor feature, out of engine scope).
- **The reachable version of "tooling":** Small World Machine already has the *data* machinery that makes preset systems usable (style ladder as parameter vectors + `styleId` + `WATER_EXT_DECL/SURFACE` hooks, `[SOURCED-in-repo] inventory §2e`). What the industry does that SW does **not** do yet: **live, runtime-adjustable parameter surfaces** — data textures / masked parameter lanes that let *content* (a lake, a stylized pond) drive parameters spatially (wind strength, style amounts) instead of per-material constants. Modern engines steer water via float/texture "bidirectional data" (Crest advertises such I/O, `[JUDGMENT]`). WebGPU's linear-buffer bindings are ideal for this; the constraint is the **full 256-byte uniform slot** (`inventory §6`) — spatial parameterization needs either a *texture* binding (sampler/space budget) or the layout expansion ADR 0013 weighs. [JUDGMENT]
- **Takeaway:** the aspirational tooling goal is **"parameter surfaces, not parameter sliders"** — a WebGPU-era live data channel — and it is a *design* problem first, an engine-width change second.

### (f) Procedural animation & style-aware dynamics
- **Benchmark:** games do style-aware wind/scale/stylized reaction (Wind Waker-ish seas, toon water with art-directed wave banks); Houdini/EmberGen offline sims vendored as stylized textures. [JUDGMENT]
- **Browser feasibility:** **highest of anything on this map.** Style-aware dynamics = CPU-side parameter blends (wind direction per styleId, scale-aware wave parameters, time-warp/step-rate that Charly's ladder already hints at, `[SOURCED-in-repo] stylized-water/README.md:33 F-criteria "stepRate"`).
- **Takeaway:** zero vendor, zero compute, pure TS parameter logic — a cheap differentiator for the *stylized* family, which is the established quality axis of this engine.

---

## 2. Reachable vs rabbit hole (effort S/M/L/XL + risk), for a thin multi-backend TS engine

Read as: cost to land cross-backend (GLSL100/GLSL300/WGSL) inside the laws of §ground rules. Risk = 3-backend parity + uniform-budget + regression risk, not intrinsic difficulty.

| Technique | Verdict for SW | Effort | Risk | Why |
|---|---|---|---|---|
| **Wave-interaction surface** (splat/wake rings, depth-gated contact, Kelvin wake) | **REACHABLE — do it** | M | **Low** | Pure fragment/vertex math on already-bound capture textures; no compute, no new passes, no uniform growth (repurposed lanes). Biggest perceived-interactivity win. Crest-proven decoupled from wave backend. [JUDGMENT] |
| **Clapotis (analytically gated wall reflection)** | **REACHABLE — nearly free** | S–M | Low | Pure vertex math (mirrored wave vector), per-style constants for wall config, GL1 degrades gracefully (`liquid-improve.md:203-205` formula). [JUDGMENT] |
| **CPU wave-height probe → buoyancy truth** | **REACHABLE — cheap** | M | Low | Mirror existing chunk math in TS, unit-test parity (`Bob §5.3`, `Dave §5.1` agree). No GPU change. [JUDGMENT] |
| **Planar water reflection** (wire `PlanarReflectionNode` into OpenWater sampler) | **REACHABLE with effort** | M | **Medium** | Node exists; but planar reflection needs mirror-camera visibility rules, excluded-object lists, per-frame render pass cost, plus 3-backend sampling code. Quality-centric for realistic tier. [JUDGMENT] |
| **2D height-field interaction (FDM wave solver on small FBO)** | **REACHABLE, WebGL2+** | M–L | Medium | Needs render-to-texture + depth of the splash source; WebGL1 static fallback; only where a showcase actually needs persistent splashes. [JUDGMENT] |
| **FFT ocean (Tessendorf) WebGPU-only lane** | **REACHABLE as optional showcase lane** | L | **High** | Proven in-browser; WGSL compute exists in-repo; but it's a whole compile+asset path on ONE backend only → parity pressure, and it competes with the "no new glamour before hard" rule. Park behind H2. [JUDGMENT] |
| **FFT across WebGL2 via ping-pong 1D passes** | **RABBIT HOLE for now** | XL | Very high | Vertical/horizontal oscilloscope FFT in GLSL300 is doable but consumes samplers/registers and delivers less than the Gerstner+probe stack for stylized+interactive. Revisit only if a realistic open-ocean showcase demands it. [JUDGMENT] |
| **SSR (full-screen reflective post pass)** | **RABBIT HOLE for now** | L | High | Needs a post-processing chain this engine doesn't structurally favor for stylized art; wire planar first, re-evaluate from evidence. [JUDGMENT] |
| **RT reflections on water** | **RABBIT HOLE — never** | XL | Very high | WebGL2 none, WebGPU ray-query experimental; cost far above value for a `skyTint`-driven stylized surface. [JUDGMENT] |
| **3D SPH / Niagara / Zibra-style particles** | **RABBIT HOLE (WebGPU-only novelty)** | XL | Very high | No mature browser lib, compute+big buffers, WebGL1/2 get nothing; a showcase gimmick, not a system. [JUDGMENT] |
| **Tessellation / LOD water grid (Unreal/Crest lod0)** | **RABBIT HOLE for now** | L | High | Unreal/Crest do LOD for *FFT sampling density*; SW has no FFT and no tessellation stage. Segment density on `Plane` is app-side already. Guard with doc, don't build a grid yet. [JUDGMENT] |
| **Parameter surfaces / live data textures** | **REACHABLE — design-first, then engine-width** | M (design) / L (engine) | Medium | Needs the layout/texture decision from ADR 0013; high artist value, do as an *extension* (ADR 0025) before any engine-width change. [JUDGMENT] |
| **Procedural / style-aware dynamics (wind, scale, step-rate)** | **REACHABLE — cheapest differentiator** | S | Low | Pure CPU TS; zero shader/backend cost; directly extends Charly's style ladder. [JUDGMENT] |

**Net read:** of 12 candidates, ~4 are genuinely reachable at low/medium risk in-browser today (interaction surface, clapotis, probe→buoyancy, style-aware dynamics), 1 reachable with effort (planar reflection), 1 design-reachable (parameter surfaces), and the rest (FFT×2, SSR, RT, SPH, LOD grid) are rabbit holes that must be explicitly excused from the near-term plan. [JUDGMENT]

---

## 3. Phased future vision — Horizon 1/2/3 with milestones + risks

> This is the **Ausblick**. It is deliberately decoupled from the near-term stability plan (Phase-A hardening, owned by Alice/Bob/Dave/Erin). Each horizon has **1-2 concrete milestones** and its **main risk**. None of H2/H3 is commitment — they are decision gates the engine walks toward without breaking stability.

### Horizon-1 — "Consolidate & harden" (≈ the Phase-A plan, framed here only for separation)
Positioning: the true goal is **claims == code, tested, all 3 backends**, before any new glamour. Ownership and detail live in the other round-1 leaves; I only state the horizon boundary here.
- Milestone H1.1 (acceptance): truth-gap pass — every `liquid-improve.md` claim is either implemented or explicitly deleted; StylizedWater/Lava/Slime enter the `ShaderValidation`/`ShaderAssembly` matrices (`inventory §7`). Risk: scope-creep from "hardening" into "fixing while adding". [JUDGMENT]
- Milestone H1.2 (acceptance): measured regression grid per backend (Erin), uniform layout stays 256B, zero new rabbit-hole features merge. Risk: the group undervalues the **honest WebGL1 lane** and hides degradation instead of documenting it. [JUDGMENT]
- **Main risk:** team discipline — every agent wants its own new toy in H1. The horizon test is: *"would this survive Anne-Frank's 'is it a rabbit hole' filter?"*

### Horizon-2 — "Bounded interactivity & kinetics, then a compute pilot"
The first *new* capability slice after the system is hard. No engine-width rewrite; every piece lands through ADR-0025 hooks/repurposed lanes first.
- **Milestone H2.1 — Interactivity surface (M, low risk):** depth-gated + source-driven ripple/wake rings on the existing capture carriers, one analytic Kelvin wake, probe-fed buoyancy; parity across all 3 backends with WebGL1 documented degradation. **Risk:** cross-agent ownership — the wave data model must be one typed channel, not app spaghetti; guard with the JS-level tests Dave gates on. [JUDGMENT]
- **Milestone H2.2 — Compute pilot decision (risk gate, not build):** a minimal WebGPU-only spectral prototype (FFT or tiled-oscillator noise field) reusing the in-repo WGSL compute buffers, shipped ONLY behind an explicit "WebGPU showcase" flag with a documented WebGL1/2 static fallback. Main risk: this is the first *backend-exclusive* rendering feature in the engine — parity doctrine shifts from "always 3" to "declared tier", which needs an ADR before any code. [JUDGMENT]
- **Main risk of the horizon:** the compute pilot quietly becoming a silent 2-tier system that makes future paranoia-free 3-backend claims impossible. Make the tier explicit or don't do it.

### Horizon-3 — "Ambition: reflection, fluid sim, style-aware simulation"
The genuinely far shelf, reached only if H2 lands green. Each is a showcase-dependent ambition, not a stable-plan item.
- **Milestone H3.1 — Reflection quality:** wire planar reflection from the existing `PlanarReflectionNode` into the realistic open-water shader (deferred from H2 if quality-path priority falls); SSR only if a showcase proves the stylized line needs it. **Risk:** reflection-camera visibility rules and perf (extra full sub-render per frame) quietly double frame cost on mid hardware — must be opt-in per material with a measured budget. [JUDGMENT]
- **Milestone H3.2 — WebGPU-only SPH/particle novelty:** one bounded showcase feature (splash/foam particle blob) using the compute path; explicitly a brochure demo, never a system. **Risk:** time sink with no cross-backend learnings; cap strictly at "one showcase". [JUDGMENT]
- **Milestone H3.3 — Style-aware dynamics:** wind/scale/art-direction steer per styleId via parameter surfaces (texture or data-channel, ADR 0013 decision). **Risk:** this is the only H3 item with engine-width surface area (uniform/sampler layout) — sequence it last and as extension-first. [JUDGMENT]
- **Main risk of the horizon (overall):** letting "ambition" pull H1/H2 into the mud. Every H3 item must be independently cancellable with zero residue.

---

## 4. Explicit out-of-scope list to protect the near-term stability plan

These are **deferred** — not rejected. The group should record them as out-of-scope for Phase-A/H1 so nobody sneaks one in under "just one more thing". [JUDGMENT]

1. **FFT/Tessendorf ocean** — out for H1. Needs compute-tier policy first (H2.2). No FFT in Phase-A, in any backend.
2. **FFT across WebGL2 (ping-pong 1D passes)** — out. Rabbit hole until a specific realistic ocean showcase exists.
3. **Any 3D SPH / particle fluid (Niagara/Zibra-style)** — out until H3.2, and then WebGPU-only showcase-scoped.
4. **SSR / new post-processing water pass** — out; wire the existing planar node when reflection is actually wanted.
5. **RT reflections** — out, forever unless an RT showcase emerges (very unlikely).
6. **Tessellation / dedicated LOD water grid** — out; segment density on app `Plane` stays. Document, don't build.
7. **Any change to the 256-byte uniform layout** — out for H1; ADR 0013 already weighs it and should be **revisited only** when parameter-surfaces (H3.3) become real. All of H1/H2 fits in repurposed lanes + style constants.
8. **New samplers beyond the budget** — out for H1 (16-sampler cap tested, `core/renderers/shaders/ShaderValidation`). Interaction must reuse `u_opaqueMap`/`u_opaqueDepthMap`.
9. **Engine-wide material-graph / node editor** — out; the style-ladder + hooks are the tooling ceiling for the plan period.
10. **Physics↔render bidirectional coupling at scale** — out; keep one-way (CPU probe → buoyancy) for H1/H2. True two-way interaction waves are H3 at best.
11. **Engine forks / vendored water middleware** — out (already law); any future capability enters via ADR-0025 hooks or the extension package.

Ownership note: if any item above *does* get forced into H1, it must pass Erin's stability gates and survive the question "does this survive without a compute tier?"

---

## 5. Phase-A goals: separating today's hardening from tomorrow's ambition

To keep the near-term plan stable, I split the goal space explicitly:

**IN Phase-A / today (hardening — the only commitments):**
- Truth pass: claims == code (`liquid-improve.md` vs inventory `§2`), delete the dead `v_displacementY`, document WebGL1 degradation honestly for the realistic tier.
- Hardened constants, not traps: promote caustic/crest/spec literals to named artifacts (Bob), no new visually-different features.
- Close the coverage hole: StylizedWater/Lava/Slime into the shader test matrices (`inventory §7`).
- Optional-and-cheap, only if green: CPU wave-height probe → buoyancy truth, analytically-gated clapotis at table-configured walls. Both are M-effort, low-risk, and directly serve "hard". [JUDGMENT]

**NOT in Phase-A (parked by explicit decision):** every row of §4. Especially: no FFT, no compute-tier policy, no reflection work, no parameter textures, no SPH, no LOD grid. The single phrase that protects the plan: *"If it can't be tested on all 3 backends today, it's H2/H3."* [JUDGMENT]

**What Phase-A should *produce* for the future:** not features, but **decision data** — a measured per-backend baseline grid, a documented wave-data model (probe + interaction channel), and an up-to-date ADR 0013 verdict on the uniform layout. That is the only "future roadmap" deliverable that belongs in the current stability window: the infrastructure of evidence that H2/H3 decisions get made on instead of vibes. [JUDGMENT]

---

**Summary (Frank):** The realistic future for Small World Machine water is **not** chasing Unreal/Crest/Niagara heavyweight pipelines — FFT across backends, 3D SPH, tessellation LOD, SSR/RT are all rabbit holes for a thin, stability-first, 3-backend TS engine, and should be explicitly excused from the near-term plan. The genuinely reachable, high-value horizon is the **interaction axis** (Crest-proven to decouple from the wave backend: depth/splat-driven rings, analytic clapotis and Kelvin wake, probe-fed buoyancy) built on the already-bound capture textures with repurposed lanes — plus cheap style-aware dynamics and, later, a clearly-tiered WebGPU-only compute pilot behind an explicit ADR. Phase A must ship *evidence infrastructure* (regression grids, a typed wave-data model, an honest ADR 0013 layout verdict) so that any H2/H3 ambition is decided on measured data, never on new glamour.
<!-- END liquid-roadmap.round1.Frank.md -->

---

<!-- BEGIN liquid-roadmap.round2.Alice.md sha256=d3a5b6ce7307f8f337d7769c9929aee34b77c5de47d7f9a6a842d729b4d075c4 bytes=10566 -->
# Round 2: Alice (Architect & Systems Lead) — 2026-10-05

Lens: architecture / ADR coherence / constraint integrity (256-byte slot, 3-backend parity, no-forks, claims==code). All file references verified against HEAD. Paths under `P=<repo-root>`.

## 1. Review of P1 (per package / decision)

- **H1 Testmatrix** — sound, factually correct. Verified gap: `ShaderAssembly.test.ts:75-81` lists only `FluidSurfaceMaterial`+`OpenWaterMaterial`; `ShaderValidation.test.ts:35` covers `FluidSurfaceMaterial` only. `v_displacementY` dead varying confirmed (`StylizedWater.vert.glsl:75,108`, `StylizedWater.frag.glsl:7` never read). Note: deleting the varying is a shader-text edit → must land after the golden baseline (see §3).
- **H2 Claims-Korrektur** — sound, doc-only. Verified `UniversalFluidMaterial` absent (ADR 0025 stale), `[VERIFICATION_PASSED]` overstated (liquid-improve.md:323). **Zero gate role over the S-block**; it is honesty hygiene, not a dependency.
- **H3 Lane-Contract-Registry** — sound and the single most load-bearing item. Verified urgency: the same lane `u_styleA.w` already carries ≥3 live meanings — StylizedWater strokeWidth/ripple (`StylizedWater.frag.glsl:191,195`) AND extension Noir inkSteps (`NoirWaterMaterial.ts:104`). H3 is the hard prerequisite of S2 (splat lane must not add a 4th unregistered meaning).
- **H4 Konstanten** — content sound, **ordering wrong** (see §2/§3): refactoring literals like the caustics anchor (`OpenWater.frag.glsl:123`) changes rendered output, so it must be guarded by H6 goldens; P1 sequences H6 last.
- **H5 Perf-Methodik / H6 Goldens** — essential; H6 in particular is the enforcement substrate for G5 and for any shader-touching H/S item. H5 is the substrate for G8.
- **S1 Probe ↔ Auftrieb** — 256-byte-clean (CPU height mirror, ~0 new uniforms), 3-backend-neutral on the CPU side. WebGL1 mirror parity is only scoped as "Toleranz auf GL2/GPU" — acceptable if WebGL1 is separately documented as degraded parity (§6 note).
- **S2 SurfaceRippleField** — the one item where the full 256-byte slot collides with functionality. P1 leaves the delivery channel open ("repurposed Lane 1–4 Splats ODER schon gebundene Opak-Farb-Capture, auch WebGL1"). Not cost-free either way, and the "oder" hides a semantic collision (see §2).
- **S3 Clapotis** — cleanest package in the plan: pure vertex math, ~0 uniforms, 3-backend. No architecture objection; needs H6 baseline like any shader edit.
- **S4 Kelvin-Wake** — showcase-gated exactly as written is correct; its lane consumption must be registered in H3.
- **OOS-Lock (Frank §4) vs D1** — I checked coherence: **park D1 is the only option coherent with the lock.** Wiring PlanarReflectionNode into a water shader would add a `u_reflectionMap` sampler declaration to the liquid program set (currently only Standard.* declares it — verified: no water `.frag.*` sample it), i.e. a new-sampler change, which OOS-Lock item 8 forbids for the period. Park + proceed as the lock intends.

## 2. Strongest objection

**P1's "Block H" is presented as one homogeneous non-optional dependency chain ("Voraussetzung, nichts davon ist optional") but it is structurally three lanes with different gate relationships, and its ordering makes its own stability claim unenforceable.**

Concretely, this is a coherence defect, not cosmetics:

1. **H4-before-H6 breaks measurability of the period's core promise.** H4 refactors render-affecting shader literals (e.g. `OpenWater.frag.glsl:123` caustics anchor). H6 is scheduled last. Any "no drift" assertion during H4 has no baseline to compare against → the "gemessene, keine behauptete" hardness (Leitprinzip 1) is not machine-enforceable on the exact items that alter output. G5 cannot be green on merge until H6 exists.
2. **H2 inflates the mandatory prerequisite gate with a non-dependency.** H2 is doc-only and gates nothing below it in P1, yet the "nichts davon ist optional" framing forces it into the critical path. That is exactly the scope creep the OOS-Lock exists to prevent: the block claims a strict chain that the S-block does not need beyond {H1, H3, H6, H5}.
3. **S2's double delivery channel is the one hand-waved constraint break.** Under a full 64-float layout (`WebGPUObjectUniformPacker.test.ts:89-132` asserts styleA@56/styleB@60, no spare vec4), "1–4 Splats via repurposed Lane" is 4–16 floats of further lane theft on the already-multi-stamped `u_styleA.w`; "via already-bound opaque-color capture, auch WebGL1" is partially true (`u_opaqueMap` color capture IS bound on WebGL1, `WebGL1Renderer.ts:973`; only the depth path is gapped, `WebGL1Renderer.ts:688`) — but the opaque texture is simultaneously the refraction source read at `OpenWater.frag.glsl100:50`, so the path puts interactive input and refraction in one texture with no stated arbitration. Neither channel is free, and the plan must not defer the choice into the period.

## 3. Amendment required (minimal — becomes P2)

For me to sign, P1 must change as follows (only these changes):

1. **Reorder Block H: H6 (golden baseline + drift tooling) is the first milestone**, not the last. Re-label Block H as two named lanes — **Truth lane** (H1+H2+H3) and **Measurement lane** (H5+H6) — with H4 sequenced *last, after H6*, and the shader-touching subparts of H1/H3 explicitly gated on "H6 baseline exists".
2. **Cut H2 from the S-block gate.** State the hard prerequisite of the S-block exactly: {H1 matrix green, H3 registry green, H6 baseline green, H5 budget harness green}. H2 may run in parallel; it is not a blocker.
3. **S2: commit to exactly one delivery channel for the period** — a single dedicated repurposed vec4 splat lane (max 2 world-quantized splats), registered in H3, with a documented collision check against the existing `u_styleA.w` meanings. Defer the capture-texture route explicitly to after the period unless a concrete showcase requires >2 simultaneous sources. Reword the "auch WebGL1" claim to: "u_opaqueMap color capture is bound on GL1 (WebGL1Renderer.ts:973) but shares the texture with refraction reads (OpenWater.frag.glsl100:50); this semantic collision is why it is not the in-period delivery path."
4. **D5: S1 is mandatory** (see §5) — or, if the group insists on optional, G6 must be re-scoped to "decided" = {integration test present} OR {`FluidVolume`/`BuoyancySolver` exports removed from `packages/engine/src/index.ts`} OR {ADR marking out-of-scope + grep confirms no app/doc claims buoyancy}. Not both S1-optional *and* G6-as-written, which is currently contradictory.

Everything else in P1 (Block S content, OOS-Lock, park-D1, no layout/sampler change) stands as drafted.

## 4. [AGREED: Alice P1]

Accepted **only under the amendment in §3 being folded into P2 before lock**.

Strongest remaining doubt: S2's splat-lane choice will be the first real-world test of the Lane-Contract, and a mis-sized lane budget could recur on the capture path later. That is manageable within the H3 registry, not a structural flaw.

**Withdrawal conditions** (I withdraw acceptance if any of these hold):
- An H/S shader-touching item merges without a GL2/GPU golden baseline (G5 unenforceable).
- `u_styleA.w` ends the period with an unregistered 4th meaning (registry bypass).
- "Hart & stabil" is declared while the S1 CPU-mirror's WebGL1 parity is both untested and undocumented-as-degraded.
- D5 stays optional AND G6 stays worded as "wired+tested OR out" without re-scoping per §3.4.

## 5. Positions D1–D5

- **D1 (reflection): PARK** — agree with the moderator default. Verified coherent with OOS-Lock item 4/8: water does not declare `u_reflectionMap` today; wiring it is a new-sampler change the lock excludes. Record it as a decided, reversible ADR-tracked decision with a grep-able contract: no water fragment samples `u_reflectionMap`; docs call `skyTint` procedural. Revisit behind D2 data (Frank's decision-data logic).
- **D2 (Kelvin-Wake): IN, exactly as showcase-gated in P1.** Analytic, ~0 uniform, 3-backend trivial; lane registered in H3.
- **D3 (style-map enum): IN the period, sequenced after H6 and before S2 — not later.** Rationale: the float-margin dispatch (`StylizedWater.frag.glsl:55-60`) is the same fragile seam H3 must formalize and S2 must consume; the refactor adds no uniforms/samplers, so it is constraint-neutral; it only needs the G2 drift fixture + H6 baseline to de-risk the 3-backend shader edit. Deferring it keeps the fragility alive through the lane work that depends on it.
- **D4 (live-tune): YES, strictly app-scoped (hotkey pad, reset-to-preset, one showcase).** Zero engine-land impact (mutates existing material props), no uniform/sampler/lane cost. It only must not grow into a Material-Studio (OOS).
- **D5 (probe mandatory/optional): MANDATORY.** Under G6, the "offiziell raus" branch leaves `FluidVolume`/`BuoyancySolver` exported-but-orphaned public API (`index.ts`) — itself a claims==code violation the whole period targets. S1 is M-effort, low-risk, 256-byte-clean, and is the only item in P1 that resolves G6 with code instead of a doc statement.

## 6. Gate sanity-check G1–G9 (brief)

- **Runnable as written (CI-tests today):** G1 (matrix list), G2 (drift fixture).
- **Runnable only after milestone lands:** G5 (needs H6 infra), G8 (needs H5 harness). State this explicitly and order H6/H5 first; otherwise "G-grün" cannot be asserted at session end.
- **Need reword + artifact to be machine-checkable:**
  - **G3** "Null tote Optionen": needs an "option" enumeration — use the H3 lane/option registry as the artifact; uncheckable as prose.
  - **G4** "kein VERIFICATION ohne file:line + Test": VERIFICATION is prose today; require a structured marker, e.g. `[VERIFIED: file:line; test=<id>]`, plus a grep/lint rule. Reword.
  - **G6/G7**: decisions, not checks — back them with ADR status + grep contracts ("no water shader samples u_reflectionMap", "FluidVolume instances in apps ≥1 OR export removed").
  - **G9**: overlaps G3; fold into it.
- **Gate-definition conflict:** "keine behauptete-aber-fehlende Funktion offen" is only green if H2 explicitly re-labels Clapotis/Wakes (S-deferred) and FFT/SPH/LOD (OOS) as *"bewusst außerhalb des Zeitraums"*, not merely "absent". Otherwise the gate contradicts the deferred items in its own plan. Add that carve-out wording.

---
*Author note: evidence-bound review of P1 (§7) against HEAD; no tests run, no code modified. The amendment (§3) is the minimal diff from P1 → P2.*
<!-- END liquid-roadmap.round2.Alice.md -->

---

<!-- BEGIN liquid-roadmap.round2.Bob.md sha256=b5bdc53608ed778086e7483f90fba81e8ea31e878f7a3bf461f0d0d2bfa49523 bytes=9138 -->
# Round 2: Bob (Realistic Open-Water & Wave Physics) — 2026-10-05

Lens: realistic tier / wave physics / physical-image. Research only; no code changed. Cited against repo HEAD.

## 1. Review of P1 (per package/decision as needed)

**Block H — agree in substance, dispute one exit gate.**
- H1 / H2 / H3 / H5 / H6: agree, no objection. H1 closes the R10 coverage hole + dead `v_displacementY`; H2 claims==code; H3 lane registry; H5/H6 measurement spine — all correct.
- H4: agree with the work (literal traps → named constants; wall-smear structural kill at `OpenWater.frag.glsl:123`; per-backend regression grid). **Dispute only the exit gate "Clear-Water-Floor ≥ 4/5 (GL2/GPU)"** — a peer-grade is not a hard threshold (§6). Real blocker note: the murk is **structural**, not tuning headroom. The absorption triple already sits on repurposed skeletal lanes `LiquidWaveMaterial.ts:116-118` → `OpenWater.frag.glsl:73`, under a full 256-byte slot (R9); only `u_pad3` (foamDistance) and `u_specColor` (deepWaterColor) remain. Every "↓murk" knob is a lane trade, and the window's own constraint says no-layout-change. So "≥4/5" is partly unreachable *and* unmeasurable as phrased.

**Block S — agree on scope, correct three acceptance/ownership flaws.**
- S1: mandatory (see D5), but the acceptance "Probe==Shader-Feld in Toleranz auf GL2/GPU" is **not measurable**: the vitest harness has no GPU readback to compare a CPU probe against the rendered field, and TS f64 vs GLSL f32 divergence grows per summed wave and with time. Redefine (§3).
- S2: agree (splat/decay, CFL gate, WebGL1 color-capture fallback).
- S3: agree with the feature; the **Bob=vertex/Dave=config split is the wrong seam** — the wall data lives in the material TS file both would edit (`LiquidWaveMaterial.ts:98-130` region + a new lane), i.e. a shared-file conflict (§2.3).
- S4: cut from window (D2, §5).

**Stability gate — agree.** G4 ("kein VERIFICATION ohne file:line + Test") is the correct spine.

## 2. Strongest objection

Two plan-hinges, both pre-consensus blockers:

**2.1 H4 exit = a grade.** The entire "hard & stable" claim for the realistic tier rests on "Clear ≥ 4/5", a rubric-guided peer ordinal with no operational CI definition — the same eyeball-audit loop (`showcase10-quality`) that this session exists to replace. Plan's own data: Clear 3–3.5 with **floor unreadable all backends** (F6-1), blocker structural under the no-layout/no-free-lane constraint. As written, ship/reject for the flagship pool is decided by three humans again.

**2.2 S1 parity claim is unrealizable in this harness.** (a) No GPU readback → "Probe == Shader field" cannot be computed by any existing test. (b) TS `number` is f64; GLSL highp/WGSL f32 accumulate divergence over six summed Gerstner waves, amplified with `time`. A literal tolerance-`==` will either be process-greased or fail on drift that is not a defect.

**2.3 S3 ownership seam is not clean.** "Bob = vertex term, Dave = wall config" draws a line *inside* the data the shader and the config both touch: Dave's wall list must materialize as a constant/lane in `LiquidWaveMaterial.ts` while Bob's term reads it from `OpenWater.vert.*`. Two owners, one material file, plus Dave's "acceptance" is a showcase standing wave that only exists if Bob's mirrored term is correct — each can block the other at the same file. That is not a clean seam.

## 3. Amendment required

Minimal, concrete:
1. **H4 exit → scripted golden-grader** per §6 (differential floor-ROI contrast + clip fraction); human grade demoted to threshold calibration. Add an explicit H4 note: "murk knobs are lane trades under the 256 B constraint — re-tuning absorption must re-pass the differential transmittance gate."
2. **S1 acceptance re-scope** to three CI-runnable items: (a) golden-vector regression of the TS mirror against document-derived values, with explicit f64/f32 tolerance (suggest ≤1e-3 × max amplitude or 5e-4 m, highp verified in GLSL100/300); (b) a G2 marker-manifest assertion that the packed uniform constants (`LiquidWaveMaterial.ts` wave1–3 lanes) equal the mirror constants — this is the real "same field" guarantee; (c) showcase integration showing a rigid body riding the field (Dave). Drop the phrase "== field in tolerance on GL2/GPU".
3. **S3 seam re-split by artifact, single-owner files:** Bob owns `OpenWater.vert.{glsl,glsl100,wgsl}` reflected term + the wall-constant/lane binding + G2/G5 coverage; Dave owns the public wall-config API (`OpenWaterMaterial.ts`), the showcase wall, and the integration test. The H3 lane-registry pins the shared lane contract; no material file has two owners.
4. **H2 golden-ratio → streichen (delete),** see §4. Update H2 acceptance to "claim removed; real 2+1+2+1 composition documented".

## 4. [AGREED: Bob P1] / [OBJECTION: Bob]

**`[AGREED: Bob P1]` conditional.** Strongest doubt: the H-block "hard" gate and S1's acceptance are each phrased in a way the CI infrastructure cannot evaluate (peer-grade; shader-`==`-probe), so the plan could pass P1 with the exact unmeasured-claim failure mode this session exists to kill.

Revocation condition: if P1 keeps the grade exit as-written or keeps S1/S3/S4 in their current form (S4 in-window), I withdraw to `[OBJECTION: Bob]`.

## 5. Positions D1 / D2 / D5

- **D1 — park PlanarReflectionNode wiring, but as a written posture decision, not an open gate.** "Parken hinter D2-Daten" is wrong: Kelvin-wake outcome is unrelated to reflection. Required: record now that procedural skyTint + screen-space refraction is the **official GL1/GL2 reflection posture for the window** (formalize in `OpenWaterMaterial.ts` docs; kill the "silent default skyTint" reading); the node wiring becomes the first named H3 realistic item, gated on "a showcase with visible landscape/sky genuinely needs water reflection," not on D2.
- **D2 — OUT.** Verified: no water showcase wires `PhysicsSystem`/`RigidBody`; showcase 10's only moving object is a kinematic dropper fall (`showcase.ts:110-125`, no body velocity); showcase 21/23 bodies are pegs/spheres not in water. S4 needs a repurposed lane (none free) + a RigidBody drive nobody owns, competing with S2/S3 for the same lane budget. Cut; record as showcase-gated H2 item that lands only when a body-driven water showcase exists.
- **D5 — MANDATORY.** S1 is the only item in the S-block that delivers physics truth (S2 splats and S3 clapotis deliver optics); without it the whole block is an animated shader. Dave's own round-1 rates it `[P-high, tiny cost]`. Making it optional contradicts the brief's "hard & stable" priority and Dave's own data.

## 6. Clear-water "hard" threshold: measurable proxy

**Confirmed dispute.** A 1–5 grade is not a hard metric: rubric-guided ordinal, peer-averaged, scene- and camera-dependent, uncomputable in CI; "4/5" has no operational definition. It belongs only as a calibration step.

Most measurable proxy capturing "no murk, floor readable, no blowout" — differential, scene-normalized, scripted on the **existing H6 golden corpus** (no new passes, no new backend work):

1. **Floor readability = differential contrast retention.** Per pool, a known high-contrast target on the floor (existing tiled floor or a placed chart). Grader computes Michelson contrast C over the floor ROI in the watered shot vs the same pool's dry reference: gate `C_watered / C_dry ≥ C_floor_min` (suggest 0.25). Ratio-within-pool neutralizes scene lighting/camera ⇒ CI-portable.
2. **No murk = measured transmittance.** Murk is the Beer-Lambert path (`exp(-depthDiff * waterAbsorption)`, `OpenWater.frag.glsl:74`) erasing the floor. Gate: the §6.1 differential contrast must hold at the documented `waterAbsorption` triple and pool depth — re-tuning those repurposed skeletal lanes must re-pass, making murk a measured attenuation bound, not a look.
3. **No blowout = clip fraction + spec-lobe bound.** Fraction of pixels saturating to 255 inside the water+floor ROI ≤ ε_sat (suggest 0.5%), plus the specular lobe ROI (`OpenWater.frag.glsl:91` `nDotH^1200`) below the clip bound — catching the F18/F25-class blowout as a number.

This converts "≥4/5" into three CI-runnable inequalities on the existing golden pipeline; the human grade survives only to tune the three thresholds once against historical screenshots, then demoted to spot-check.

---

**Summary (Bob round 2):** P1's H-block is the right spine, but its flagship exit ("Clear ≥4/5") is a peer-grade, not a measurable threshold — the murk it targets is structural under the no-layout, no-free-lane window, so the gate must be a differential floor-contrast / clip-fraction grader on the H6 goldens, not an ordinal. S1's "probe == shader field" parity is uncomputable in this harness and must be re-scoped to a golden-vector regression plus a constant-equality manifest; S3's vertex/config split is a shared-material-file conflict and must be re-split by artifact with single-owner files. Conditional `[AGREED]` stands only with those amendments, S4 cut, a written D1 reflection-posture decision, and D5 kept mandatory.
<!-- END liquid-roadmap.round2.Bob.md -->

---

<!-- BEGIN liquid-roadmap.round2.Charly.md sha256=e156f3ec1ebd0da9ddd201d21ab087be2043a6a2a0c3700f10204831bb01e410 bytes=11971 -->
# Round 2: Charly (Stylized/NPR Water & Artist Workflow) — 2026-10-05

Scope: stylized/NPR path + artist workflow + hooks + style-map lens. Research only, no code changes. Facts re-verified against HEAD source before writing (file:line below); the posterize math was re-derived and numerically simulated, not taken from the round-1 leaves.

## 1. Review of P1 (per package/decision)

### H1 — v_displacementY deletion: safe, but the premise is inverted
- Verified: `v_displacementY` is a **GLSL300-only** dead varying. `StylizedWater.vert.glsl:75` declares `out float`, `:108` writes `v_displacementY = displacement.y`; `StylizedWater.frag.glsl:7` declares `in float` and **no body read**. The `glsl100` vert (`StylizedWater.vert.glsl100`) and the `wgsl` vert (`StylizedWater.vert.wgsl`) have **no displacementY output at all**. Grep confirms no extension/other file references it.
- Consequence: the "3-backend implication" worry is unfounded. Deletion is 3 removed lines in exactly ONE backend (vert-out, vert-write, frag-in). No WGSL edit, no GLSL100 edit. H1 as listed is smaller and cheaper than the moderator's framing implies.
- One required side-note: the dead varying is the **only** crest-foam plumbing anchor on the stylized vert (round-1 MISSING #5 — no vertex hook exists). Deleting it is correct, but H2 must record *why* (crest foam deferred because there is no vertex-side `[WATER_EXT_...]` token) so it is a deliberate, documented decision and not blindly re-added later.

### H3 — lane-contract registry: agree on intent, correct the form
- Verified `u_styleA.w` has **3 documented meanings** behind the same `props["u_styleA"][3]` slot: base `lineWidth` (`StylizedWater.frag.glsl:191,195`), `posterizeSteps` (Noir, `NoirWaterMaterial.ts:90,104`), `iridescenceStrength` (Oil, `OilSlickMaterial.ts:97,132`).
- Important nuance: the 3 meanings are **by-design lane reuse** (ADR 0025) — this is the accepted extension mechanism, not itself a defect. The genuine defect is (a) **zero enforcement**, (b) **shared mutable array write-order fragility** (both extensions override `props["u_styleA"][3]` after `super.getRenderManifest()`), (c) the base-`lineWidth` semantic is silently destroyed for extension styles.
- Form correction: an engine-only runtime registry cannot know Noir/Oil lanes (they live outside the engine). The registry must be a **test/CI declarative artifact spanning engine ↔ extension** (a lane→semantic table imported by a lint/test), not a new runtime abstraction. Keep it S.

### H3 — "Posterize-Off-by-one fixen (NoirWaterMaterial.ts:104)": MISDIAGNOSED. This is my sharpest finding (see §2).
- Erin R8 claims `posterizeSteps = N` → `N−1` levels because of `inkSteps = max(u_styleA.w − 1.0, 1.0)`.
- That claim is factually wrong. `floor(inkTone·(N−1)+0.5)/(N−1)` yields **exactly N distinct output values** — numerically verified:
  - N=2 → 2 levels {0,1} (matches the documented "2 = pure black/white")
  - N=4 → 4 levels {0, ⅓, ⅔, 1}
  - N=8 → 8 levels
- So `u_styleA.w − 1.0` is the **correct** formula for the documented semantics "posterizeSteps: number of ink tone levels" (`NoirWaterMaterial.ts:11`). A "fix" that removes the `−1` changes semantics to N+1 levels and re-widens the top bucket — plausibly re-introducing the blown-out white look that was already measured (noir 2/5, "4-level posterize on already bright image → everything rounds to 1.0", showcase10-quality F5). The `+0.5` asymmetric rounding widens the top bucket — that is an **art** defect (bucket distribution on bright inputs), not an off-by-one.
- The two hook copies (glsl300/glsl100 share the same `surface` text via `composeStylizedWaterSources`, `:17-40`; wgsl is the mirrored `:118`) are already backend-synchronized. No parity bug there.

### H2 / naming debt — agree, no change.

### D1 / D3 / D4 — see §5.

## 2. Strongest objection

**P1 commits a provably false bug as a mandatory harden-step, and demotes the only artist-facing deliverable to optional.**

Primary (concrete): the H3 action "Posterize-Off-by-one fixen (NoirWaterMaterial.ts:104)" targets a line that already implements the documented behavior exactly (N levels, verified). It sits in the **non-optional hardening block** (Block H, "nichts davon ist optional"), so a literal execution either (a) does nothing except churn (if the executor re-derives the math and finds no bug) or (b) actively regresses a graded look by removing `−1` → N+1 levels and re-blowing-out the top tone bucket that was already measured as 2/5. The plan is steering a mandatory edit at a non-bug while mislabeling an *art*-distribution issue as semantics. The "fix" needs a level-count test before AND after, or it is noise in the hardening gate.

Secondary (artist lens): D4 — the **#1 artist-workflow parity gap** vs Unity/Unreal/TSL (every round-1 stylized leaf said so) and the *only* deliverable that serves the actual human artist persona — is left as an open yes/no and queued behind Block S as "optional, gekürzt wenn Zeit" (P1 §7.3). Scoping it tight (S) solves the ballooning fear; leaving it optional solves nothing and confirms the exact industry gap the session itself flags. It must be a committed, tightly-fenced line item — after H, not buried in the if-time block.

## 3. Amendment required

1. **H3 re-scope the posterize action:** delete "Posterize-Off-by-one fixen". Replace with:
   - (a) a **transport + level-count test** asserting `floor(inkTone·(posterizeSteps−1)+0.5)/(posterizeSteps−1)` yields exactly `posterizeSteps` levels for glsl300/glsl100/wgsl (pins semantics, safe),
   - (b) an **optional art bucket-distribution audit** (top-bucket width, `+0.5` rounding on bright inputs) as a separate, non-semantic polish — only if the Noir relook is approved.
2. **H3 lane-contract registry:** implement as a test/CI declarative artifact spanning engine ↔ extension (incl. Noir/Oil lanes), not an engine-only runtime registry.
3. **H1/H2:** add one H2 line recording the `v_displacementY` deletion closes the sole stylized crest-foam anchor (no vertex hook yet) — deliberate, documented.
4. **D4:** promote from open/optional to **committed S-effort line item** sequenced after Block H, with the hard scope fence of §6.

## 4. [AGREED: Charly P1] — strongest doubt + revocation condition

**[AGREED: Charly P1]**, conditional on the amendments in §3.

- Strongest doubt: the plan's fact-basis on the posterize lane is wrong (see §2), and it sits in the mandatory gate; absorbing that unchanged makes "hard & stable" rest on a regressable, misdiagnosed change.
- Revocation condition (I withdraw agreement if, unamended): (1) the H3 posterize item ships without a before/after level-count test, or is "fixed" by removing `u_styleA.w − 1.0`; or (2) the lane registry ships as an engine-only assumption that cannot represent extension lanes; or (3) D4 remains advisory-only with no committed scope in the final plan.

## 5. Positions D1 / D3 / D4 + Noir-grade audit placement

- **D1 (reflection): PARK — agree with moderator.** Minimal planar wiring is a real M-item: new reflection-target render pass, RT binding plumbing + per-frame mirrored re-render across 3 backends (WebGL1 included), and `u_reflectionMap` is today sampled by `StandardMaterial` only — no water frag touches it (verified). The stylized ladder is not mirror-reflective by design; the artist-relevant step is to *formalize* `skyTint`-as-reflection and expose its strength as a named constant, which H2/H4 already cover at ~zero cost. Park as documented, reversible decision; revisit behind D2-data.
- **D3 (style-map float→enum/switch refactor): DEFER — not this period.** The 0.5-margin float dispatch (`StylizedWater.frag.glsl:55-60`, `.glsl100:52-57`, `.wgsl:22-27`) is **not a current defect**: `styleId` is a uniform set from TS, never interpolated, so the margins cannot drift at runtime by float rounding; they are deliberate guards. The only genuine hazard is 3-file Boolean-edit-sync when a 6th style is added — pin that with a **style-identity/registration test** (assert styles 0–5 dispatch correctly AND `styleId==3.0` keeps `isExtension=true`, `painterly=false` — the load-bearing contract for Noir/Oil) at near-zero cost inside H1/H3. The full enum/switch refactor is highest-churn (3 base backends + the extension-package contract: Noir/Oil pass `styleId: 3.0` from TS, any refactor must preserve that band) for lowest urgency → later period, gated on an actually-planned 6th published style.
- **D4 (live-tune surface): YES — committed, tightly scoped, AFTER Block H.** It is directly worthless before H1/H3 (would tune unverified lanes); it is the highest artist-value item after that gate. Reference must be **one single vanilla `StylizedWaterMaterial` instance** (a "tuning pool"), never Noir/Oil — lane reuse in extensions would fight a global tuner on `u_styleA.w`.
- **Noir "terminal peer-grade" audit placement: H6, not H3.** The lane registry is backend mechanics; the peer-grade is a *measured visual* benchmark that belongs in the golden/screenshot platform (H6 showcase-goldens), owned with Erin. H3 should keep only the *claims* cleanup of any "terminal peer-confirmed"-style wording → that specific doc fix goes in H2. H3 loses the visual-audit dependency entirely.

## 6. D4 tightest scope (S, testable, no engine UI)

Hard fences first: **no `packages/engine` edits; no new uniform lane (256 B slot untouched); no persistence/serialization; no pointer/UI framework; no ramp/gradient import; no per-backend toggles; target = one vanilla StylizedWaterMaterial instance in showcase 10 only.**

- Deliverable: ≤1 new file in the showcase app (e.g. `apps/.../showcase10/` debug pad or util) + a key handler. Reuses **existing public properties** of StylizedWaterMaterial — `getRenderManifest()` rebuilds uniform arrays every call (`StylizedWaterMaterial.ts:288-300`), so mutating `rampSoftness`, `skyTint`, `causticStrength`, `specularStrength`, `foamSoftness`, `washAmount`, `lineDensity`, `lineWidth`, `glitterStrength`, `foamCutoff`, `foamDistance`, plus `shallow/deep/edge` Color RGB, flows to the shader **with zero new engine plumbing**.
- Surface: keyboard-first (artist persona, low-friction modal binds): `[`/`]` select knob, ArrowUp/Down adjust (step-scaled), `0` reset current knob to preset, `shift+0` reset entire style to `STYLE_PRESETS` entry (`StylizedWaterMaterial.ts:102-178`), optional `g` snapshot-print of the tuned vector for pasting into a preset table.
- Testable (no GL context): extract the knob/step/clamp/reset logic into a **pure TS controller class** (range-tables per knob, clamp + step, reset target); unit test asserts within-range mutation, clamp behavior, `reset` restores the exact preset vector, and that the controller targets public members of a `StyledWaterMaterial`-like stub. Showcase wiring is a thin key→controller adapter, greppable in code review.
- Acceptance: unit tests green, `npm run lint:fix`/`build:lib`/`test`, golden screenshot drift on the tuning pool stays within H6 tolerance, no engine diff, no lane changes.

---

**Summary:** P1's mandatory H3 posterize item is a misdiagnosis — `floor(inkTone·(N−1)+0.5)/(N−1)` already produces exactly the documented N tone levels, so a literal "off-by-one fix" risks regressing the earlier measured white-out (noir 2/5); the real defect is asymmetric top-bucket art, not semantics. Conditional agreement [AGREED: Charly P1] requires re-scoping that fix to a level-count test plus re-labeling the bucket behavior as art, moving the lane-contract registry and the Noir peer-grade to a test/CI artifact and H6 respectively, deferring the D3 enum refactor in favor of a cheap style-identity test, and promoting D4 from optional to a committed, tightly fenced S-effort showcase pad after Block H — the plan's strongest artist-parity gap must not be the first thing cut.
<!-- END liquid-roadmap.round2.Charly.md -->

---

<!-- BEGIN liquid-roadmap.round2.Dave.md sha256=56caef183c14645adfc6fdd81d12cb7c57945aee0fbad7074444cfd1c5db3f78 bytes=12602 -->
# Round 2: Dave (Simulation & Interactivity) — 2026-10-05

Lens: kinetics — interactive water dynamics, object/contact reaction, physics↔render feedback, "objects visibly react". Research only; no code changed. All file:line verified against HEAD.

## 1. Review of P1 (per package/decision)

- **S1 Probe ↔ Buoyancy** — scope correct, and it is the *only* S item that delivers physics truth (S2 delivers visuals, S3 delivers optics; only S1 makes an object *behave* honestly). The "Probe==Shader-Feld in Toleranz auf GL2/GPU" acceptance is not executable in this harness (no GPU readback; f64↔f32 divergence over 6 summed waves; `liquid-roadmap.md:111`). Vote with Bob rd2 §3.2: replace with (a) golden-vector regression of the TS mirror against document-derived values at explicit tolerance, (b) manifest assertion that the packed wave lanes (`LiquidWaveMaterial.ts:104-108` wave1-3) equal the mirror constants — that manifest *is* the "same field" guarantee — (c) my integration test. My ingestion side is clean; correctness of the seam hinges on that manifest, which must be H3-pinned.
- **S1/S3 ownership split — seam verdict.** S1: acceptable IF the probe API is pinned contract-first (Bob signs the signature/parity; Dave consumes in `BuoyancySolver` + app) and the constant-equality manifest is explicit. S3: Bob is right — "Bob=vertex term / Dave=wall config" draws the line through a shared material file. Re-split **by artifact**: Dave owns the *public wall-config API* (`OpenWaterMaterial.ts` walls list + showcase wall) and integration test; Bob owns the *vertex consumption* (`OpenWater.vert.{glsl,glsl100,wgsl}`) and the constant/lane packing. The **wall-format contract (per-wall normal + half-extent + amplitude-trap range) must be a registered H3 entry**, the single junction — not a file both edit.
- **S3 acceptance ("Shader-Test D_ref-Vorzeichenumschlag", `liquid-roadmap.md:113`)** — not executable as a "shader test". A shader source-text assertion can only grep that the term exists; the sign flip is pure vector math that belongs in a **JS mirror** (same test-class as the S1 probe, without GPU): reflect `D_inc` about the wall normal, assert the wall-normal component reverses sign for an incoming wave traveling toward the wall. Amendment: (a) JS-mirror unit test of the reflected term (sign flip + `~2A` trap bounded by a distance falloff so the standing wave cannot inject unbounded energy), (b) G2-style assembly presence in all 3 vertex sources, (c) showcase golden (standing-wave node position ≈ wall − λ/4).
- **S2 SurfaceRippleField — delivery channel.** The "repurposed Lane 1–4 Splats ODER Opak-Farb-Capture" (`liquid-roadmap.md:112`) hides a semantic collision. Verified: `ObjectUniforms` is 64 floats, 256 B, pinned (`structs.wgsl:34-58`; `WebGPUObjectUniformPacker.test.ts:89-117`), and in the liquid family **every** field is repurposed and load-bearing (`LiquidWaveMaterial.ts:91-130` — shininess=refractionStrength, isSkinned/boneOffset/pad1=absorption, isTerrain/metallic/roughness=foamColor, useEnvMap/useReflectionMap/pad2/pad3=foam params, specColor=deepWaterColor, styleA/B consumed per styleId). There is **zero free float**. So "1–4 Splats via repurposed Lane" = 4–16 floats of eviction + an H3 registration + a per-frame-changing uniform. The capture route adds no uniform but stamps the splash signal into `u_opaqueMap`, which **is simultaneously the refraction source** (`OpenWater.frag.glsl100:50`, colour-bound on GL1 `WebGL1Renderer.ts:973`; NEAREST-filtered on GL1 `WebGL1Renderer.ts:666-667`) → splash input and refraction share one texture with no arbitration, plus shader-side *source detection* (false positives from bright scene content) that is only golden-testable. **Both routes collide — the double channel doubles the surface area (2 code paths, 2× drift/assembly/GL1 handling, an R7-class "which channel wins" ambiguity on a slot that already has 3 meanings per styleId per Erin rd1 R7).** See §3 for the one-channel pick.
- **S4 Kelvin-Wake (D2)** — cut from the window. Verified reason: no in-window showcase drives a body through water (`showcase.ts`: showcase 10's only mover is a falling crate, `SplashDropBehavior.showcase.ts:97-135` kinematic, no body velocity; 21/23 bodies are pegs/spheres not in water). Its natural reaction is an **impact splat (S2)**, not a sustained 19.47° wedge. S4 additionally needs a lane nobody has + a RigidBody drive nobody owns. Record as showcase-gated future item. **D2 = OUT.**
- **Block H** — agree with H1/H3/H5/H6 and the H2 scope; support Alice's H6-first reorder and her H2-cut-from-the-S-gate (H2 is honesty hygiene, gates nothing below it). H4's "Clear ≥4/5" as a grade gate: rely on Bob's differential-grader fix — with Dave's note that murk is structural under the full slot (`OpenWater.frag.glsl:123`), matching Bob rd2 §2.1.

## 2. Strongest objection

**P1's commitment structure silently starves interactivity — the S-block's "erst nach H; optional gekürzt wenn Zeit" (`liquid-roadmap.md:110`) makes the entire kinetics axis the first casualty of any H overrun, and H is scheduled to overrun.**

Concretely:
1. S1 needs **no H item to be correct**. It is a CPU height-mirror + a `BuoyancySolver` swap of the flat `fv.bounds.max.y` (`BuoyancySolver.ts:76`) with the probe — pure JS, pure-JS-gated. It does not touch a material file or a shader. Gating it behind H4 (clear-water grade) and H6 (goldens) — both about the *realistic visual tier* — is pure sequencing waste that holds the physics-truth item hostage to optics.
2. H is heavy and "nichts davon ist optional" (`liquid-roadmap.md:102`), and H4's own gate is contested (Bob). The realistic path outcome: H overruns, S gets "optional gekürzt", and the one thing this brief's showcase cannot fake — an object visibly reacting — silently ships nothing. D5 then becomes a formality: even "S1 mandatory" is hollow if the block above it is optional-via-time.
3. "Optional wenn Zeit" inverts the plan's own purpose. The briefing and three round-1 leaves (mine, Frank's interaction-axis, Bob's probe) rank interactivity as the highest perceived-value, near-zero-cost axis; P1 ranks it as the cut-first item.

This is the single strongest objection because it defeats the *block's* raison d'être before any package detail matters.

## 3. Amendment required (minimal — folds into P2)

1. **De-couple the S-gate from Block H.** Replace "S only after H" with per-item minimal prerequisites: **S1: no H prerequisite** (land first, may interleave with H); **S2: {H1 matrix, H3 registry, H6 baseline}** (all genuinely needed); **S3: {H1, H3, H6}** (shader edit). H2 never gates S. State Block S "A (Pflicht) = S1+S2, B (nach, klar abgrenzbar) = S3" — interactivity is not the cut-line.
2. **S2: exactly ONE delivery channel for the period — a single registered splat lane (one `vec4 = pos.xz + spawnTime + energy`), capped at one active splat per water surface** (the in-window showcase has exactly one periodic dropper, sequentially FALLING→impact, `showcase.ts:97-135`; one active splat is the honest bound). Upload the lane **on impact only, not per frame** (zero packer churn, H5-safe). H3 must specify, per styleId, which existing field the lane displaces and where that field's semantics are **re-homed to a per-style constant — never silently deleted** (enforces G3/no-dead-options). Defer the capture route post-period unless a showcase needs >1 simultaneous source. Note the win this makes explicit: a *uniform* splat lane gives WebGL1 genuine interactivity (no texture dependency), better than the color-capture "auch WebGL1" claim.
3. **S3 acceptance re-scope** per §1: JS-mirror sign-flip/amplitude-trap test (not a shader-source assertion) + 3-backend assembly presence + showcase golden. **S3 ownership re-split by artifact** per §1, wall-format contract registered in H3.
4. **S4: cut to showcase-gated future item; delete from Block S** (D2 = OUT).
5. **D5: S1 is MANDATORY** — it is the only code-path resolution of G6 and the physics-truth backbone; making it optional contradicts the "hard & stable" gate (matches Alice rd2 §3.4, Bob rd2 §5, Frank rd1).

## 4. [AGREED: Dave P1]

`[AGREED: Dave P1]` — conditional on the §3 amendments folding into P2 before lock, plus the H-block corrections I support (Alice H6-first + H2-cut, Bob H4 differential-grader).

Strongest doubt: S2's lane eviction is the first real stress test of the H3 registry, and if the evicted value is re-homed silently or under-linted, we trade one visual feature for a splash. That is auditable and reversible — not structural.

Revocation: I withdraw to `[OBJECTION: Dave]` if (a) Block S stays gated behind the full H or "optional wenn Zeit" survives as the cut priority while S1/S2 are unbuilt; (b) S2 ships with two active delivery channels or with an H3-unregistered splat lane; (c) D5 stays optional and G6 stays "wired+tested OR out" in its current form; (d) S3's acceptance is locked as a shader-source "sign flip" assertion with no JS-mirror test.

## 5. Positions D1 / D2 / D5

- **D1 (reflection) — PARK, as a written posture decision now, decoupled from D2.** Agree with the moderator default and with Alice/Bob's correction: reflection is unrelated to Kelvin-wake outcome, so it must not hang on D2 data. Record the procedural-skyTint + screen-space-refraction posture as a decided, reversible ADR-tracked item (grep-able: no water frag samples `u_reflectionMap`; `skyTint` documented as procedural). Kinetics-neutral; no conflict with the S-block. PlanarReflectionNode wiring = first future realistic item gated on a showcase need, not on D2.
- **D2 (Kelvin wake) — OUT of the window.** No body-driven water showcase; a falling dropper reacts as an impact splat (S2), not a wedge; a lane must be evicted for it; nobody owns the RigidBody drive. Revisit only when a moving-boat showcase exists. Record as showcase-gated future item (aligns Bob rd2 §5).
- **D5 (probe mandatory/optional) — MANDATORY.** S1 is `[P-high, tiny cost]` per my rd1 §5.1, 256-byte-clean, pure-JS-testable, and is the only S item that makes an object behave honestly instead of looking animated. Making it optional contradicts the brief's "hart & stabil" priority and entangles the orphaned-public-`FluidVolume` claims==code violation that G6 exists to close.

## 6. Cheapest high-credibility interactivity miss (if any)

**P1 defines an interactivity *channel* but never names an interaction.** S2's acceptance (`liquid-roadmap.md:112`) is "replaces decorative depth-gate stroke with source rings" — nothing in P1 pins a single concrete, observable event, so "interactivity" ships as a mechanism without a gesture.

Cheap, high-credibility, **already owns its trigger**: tie S2's acceptance to the **existing periodic `SplashDropBehavior` impact** (`showcase.ts:97-135`, dropper wired `showcase.ts:1114`) — on the crate's first contact with the probed surface, the app emits exactly one splat `{pos = impact XZ, energy ∝ impact speed}` into the S2 field; the water responds with one source-driven ring + the crate then bobs on the *real* (S1) surface. No new physics, no new owner, no new asset, one showcase object visibly reacting.

The concrete miss P1 should add as S2 acceptance: "one showcase interaction where a kinematic body contact emits a decaying splash ring via the S2 lane, and the same body subsequently bobs on the probed surface (S1)." That is the single cheapest, highest-credibility proof of "objects visibly react" in the period — and it is absent from P1.

---

**Summary (Dave round 2):** P1's S-block is the right work but the wrong commitment order — "S only after H, optional if time" makes interactivity the guaranteed first cut even though S1 needs no H item and is the plan's only physics-truth package; that ordering must be replaced by per-item gates that keep S1+S2 mandatory before minimum-cost cutting anywhere else. S2's dual delivery channel is a real collision with the full 256-byte slot (zero free floats; capture shares the refraction texture) and must collapse to a single H3-registered splat lane capped at one active event-driven splat, never a second silent channel. S3's "D_ref sign-flip shader test" is unexecutable as stated and must be a JS-mirror test + 3-backend assembly presence, with ownership re-split by artifact. S4/Kelvin is cut (D2=out) and D5=S1 mandatory; D1 parks as a written posture decision, not a gate behind D2. Conditional `[AGREED]` stands only with these amendments folded into P2.
<!-- END liquid-roadmap.round2.Dave.md -->

---

<!-- BEGIN liquid-roadmap.round2.Erin.md sha256=3331a2636d83c154dac558386fff4aa7569356f50bd6eda805cd832c66972470 bytes=15971 -->
# Round 2: Erin (Quality, Robustness & Performance Audit) — 2026-10-05

> Stance: RED-TEAM, evidence-only. All repo facts re-verified against HEAD before writing: `.github/workflows/ci.yml`, `vite.config.ts` (test config), `scripts/check-showcases.js`, `packages/engine/tests/renderers/ShaderAssembly.test.ts`, `packages/engine/tests/core/renderers/shaders/ShaderValidation.test.ts`, `packages/liquid-extras/src/materials/NoirWaterMaterial.ts:104-105,118-119`. No code changed.

---

## 1. Review of P1 (per package/decision as needed)

### 1.1 H-block: not complete, and the gate it feeds is not CI-enforceable today
The premise "Block H — Voraussetzung, nichts davon ist optional" plus the §7.5 definition (`"Hart & stabil" = G1–G9 grün auf default branch`) is **uncheckable by any CI status this repo can currently produce**:

- `npm test` = vitest with `test.environment: "node"` (`vite.config.ts`) → no browser, no GPU, no rAF in the unit-test gate.
- The only rendered-output job, `showcases-smoke-test`, is `continue-on-error: true` with the comment "expected to be flaky … Never block merges on it" (`.github/workflows/ci.yml`). It screenshots to `.agents/scratches/screenshots/` but **only** detects blank canvases (luminance stddev, `check-showcases.js` `BLANK_CANVAS_STDDEV_THRESHOLD`) — there is **no baseline, no diff, no golden compare anywhere** (no pixelmatch/ssim; `pngjs` is used but for blank-detection only).
- So "G-grün" for every G that depends on render output (G5, G8's visual, and the H4 exit) **cannot be asserted by any existing CI job**, and the plan does not add the job — it sequences its only rendering-instrumented item (H6) last and leaves the showcase job non-blocking.

### 1.2 Machine-checkability audit of H1–H6 acceptance criteria
| Item | Acceptance as written | Machine-checkable in this harness? |
|---|---|---|
| H1 | "100 % öff. Liquid-Materialien in beiden Matrizen, 0 unbenutzte Varyings" | **Partly.** Matrix membership + unused-varying = trivially a test (verified today: `ShaderAssembly` lists only FluidSurface+OpenWater; `ShaderValidation` only FluidSurface among liquids). "Backend-Drift-Fixture" is under-defined → belongs to G2. |
| H2 | "grep-Konsistenz Docs↔Code, keine toten Behauptungen" | **NO.** "grep-Konsistenz" is prose; there is no artifact to grep against. Needs a structured marker (`[VERIFIED: file:line; test=]` + lint), else it regenerates exactly the `liquid-improve.md:323` rot. |
| H3 | "Lint-Test gegen Kollisionen; Posterize-Off-by-one fixen; Noir-Peer-Grade" | **Partly.** Lane-collision lint: yes (as test artifact, Charly's form correction stands). **Posterize "fix" is a misdiagnosis — I concede my round-1 R8 fully** (see §1.3). Noir terminal peer-grade audit: needs a peer/a grader → belongs in H6, not H3 (Charly §5; agree). |
| H4 | "Clear-Water-Floor ≥ 4/5 (GL2/GPU) als Härte-Schwelle" | **NO.** A rubric ordinal peer-grade has no operational CI definition; Bob §6's differential grader is the only defensible proxy. |
| H5 | "rAF-p95 < 16.6 ms (Mid-Tier); Zero-Allocation-Assertion" | **Partly.** Zero-alloc assertion: yes (precedent `tests/physix/`). **p95 rAF: not CI-checkable** (headless swiftshader ≠ mid-tier; no timing harness exists; `scripts/test-webgpu.js` is a 6-line adapter probe). Re-scope to dev-machine, recorded. |
| H6 | "Screenshot-Baseline 10 Pools × GL2/GPU + GL1-Smoke; Drift > ±0.25" | **NO today; buildable as the H-first fixture.** Baseline + compare step do not exist. GPU class in CI is documented-flaky. |

**Verdict:** 3 of 6 mandatory acceptance criteria (H2, H4 exit, H5 p95) are not machine-checkable as phrased; H6 requires a fixture that must come **before** every output-changing H/S edit, not after.

### 1.3 R8 correction (conceded, affects H3)
Re-derived from `NoirWaterMaterial.ts:104-105` (glsl) / `:118-119` (wgsl):
```
inkSteps = max(u_styleA.w - 1.0, 1.0);
inkTone  = floor(inkTone * inkSteps + 0.5) / inkSteps;
```
`floor(x·S+0.5)/S` reaches {0/S … S/S} = **S+1** distinct levels. With S = posterizeSteps−1, output level count = posterizeSteps **exactly** (2→2, 4→4, 8→8). **My round-1 "N→N−1" claim was wrong** (I counted S levels, not S+1). The `−1` is correct semantics; there is **no off-by-one**. What remains is an art defect: `+0.5` rounding widens the top bucket on bright inputs → the measured noir blown-out white (showcase10 F5), which is distribution, not semantics. H3's "fixen" as literally written would regress a correct formula. Charly is right; my H1-item in P1 inherited my error.

### 1.4 Dead-option/claims landmines P1's own first pills fail to catch
- **The gate-vacuity landmine.** H1–H2 can go fully green while §7.5's defining sentence stays false: goldens don't exist until H6 (last), perf isn't CI-runnable, dead-option lint is absent, and no CI job is blocking. Executing P1 to the letter still ships a vacuous "hard & stable".
- **G3/G9 has no mechanism.** P1's only lint item is H3's lane-collision check. The F6/F7 *option* class (declared-but-unconsumed `*MaterialOptions` members) is caught by nothing in the plan. "Null tote Optionen" (Leitprinzip 1, G3/G9) is uncheckable prose without an option-enumeration lint.
- **Noir's "terminal" claim stays open.** The plan moves the Noir peer-grade into H3, where there is no grader. Without H6 there is no venue to close "terminal never peer-confirmed" (round-1 §3).

---

## 2. Strongest objection

**P1 defines "hard & stable" as "G1–G9 grün auf default branch", but that state is not producible by any CI status this repo can emit today — and the plan does not build the enforcement, it sequences the only rendered-output measurement (H6 goldens) last, keeps the only rendered-output CI job non-blocking (`continue-on-error: true`), and assigns three non-CI-runnable acceptances (H2 grep-consistency, H4 4/5 grade, H5 p95) to the mandatory block.**

Every questions-of-record resolves to one root: the plan's own "Abnahme messbar" promise is violated by the plan itself. A single missing item hollows the whole claim: **an H-item that makes the render-output gate CI-BLOCKING (golden comparator as a blocking job, baseline committed first), plus the dead-option lint.** Without it, "G-grün" and "Clear ≥ 4/5" and "keine Showcase-Regression" are all decorative file-for-now statements — the precise claims-vs-code failure mode (`liquid-improve.md:323`) reproduced one level up, in the roadmap.

---

## 3. Amendment required (minimal; exact changes to P1 → P2)

1. **Reorder Block H: H6 (golden baseline + comparator tooling) is the FIRST milestone.** Split H into two named lanes — **Truth** (H1+H2+H3) and **Measurement** (H5+H6) — per Alice §3.1. Every output-changing edit (H4; any H1/H3 subpart that touches pixels) merges only after "H6 baseline exists". H6 becomes the enforcement substrate for G5 and the H4 exit.
2. **Cut H2 from the S-block prerequisite.** Hard prereq of Block S = {H1 matrix green, H3 registry green, H6 baseline green, H5 zero-alloc green}. H2 runs in parallel; doc hygiene is not a gate (Alice §3.2).
3. **Replace H4's "Clear ≥ 4/5" exit with the scripted differential grader** (Bob §6): floor-contrast retention + clip fraction + spec-lobe bound on the H6 corpus, **GL2-blocking, GPU-informational**. Human grade demoted to threshold calibration. Add the H4 note: murk knobs are lane trades under the 256-B constraint — re-tuning absorption must re-pass the transmittance gate.
4. **Re-scope H5 to CI-runnable.** CI: zero-allocation assertion on the liquid `getRenderManifest()`/pack path + a static no-per-frame-alloc guard. **rAF p95: dev-machine only**, shipped as `scripts/perf-liquid.mjs`, budget recorded in the roadmap, **not a merge criterion** (guaranteed flaky under swiftshader). Drop "< 16.6 ms mid-tier" from any CI-enforced meaning.
5. **Add an H-item: dead-option lint.** Enumerate every `*MaterialOptions` member (engine + liquid-extras), assert consumed by `getShaderDefinition()`/`getRenderManifest()` or explicitly legacy-tagged. This is the F6/F7 precedent as a rule. Fold G9 here.
6. **H3 posterize: replace "Off-by-one fixen" with (a) a transport + level-count test** asserting exactly `posterizeSteps` output levels across glsl300/glsl100/wgsl (pins the correct `−1` semantics), and **(b) an optional, explicitly non-semantic art audit** of the `+0.5` top-bucket width. Move the Noir terminal peer-grade into H6.
7. **H2 deliverable = G4 marker.** Define `[VERIFIED: <path>:<line>; test=<testId>]` + a lint rule asserting the referenced file:line and test exist. Replace "grep-Konsistenz" with the marker check as the actual acceptance artifact.
8. **State the block/non-block disposition of the gate explicitly** (§6) and add the §7.5 carve-out: Clapotis/Wakes (S-deferred) and FFT/SPH/LOD/SSR (OOS) are labeled "bewusst außerhalb bzw. verzögert", not merely "absent", or the gate contradicts its own plan (Alice §6).

---

## 4. [AGREED: Erin P1]

Conditional on §3 being folded into P2 before lock (else `[OBJECTION: Erin]`).

**Strongest doubt:** the entire wall rests on item 1/8 — a *blocking* golden-comparator CI job and an explicit block/non-block split. It is the easiest thing to quietly drop ("flaky under swiftshader → make it informational"), which re-opens the exact vacuous-gate failure I object to.

**Revocation conditions** (any → withdraw to `[OBJECTION]`):
- The lock keeps "G1–G9 grün auf default branch" with the showcase job still `continue-on-error: true` AND no blocking goldens-comparator job added.
- H4's Clear exit ships as a peer-grade (no scripted grader on the H6 corpus).
- H5's p95 < 16.6 ms is retained as a CI merge criterion without a harness, or dropped entirely (no recorded dev-machine budget).
- H3's posterize "fix" removes the `−1` (provably regresses to N+1 levels — §1.3).
- The dead-option lint (item 5) is omitted while G3/G9 stays "Null tote Optionen" prose.
- D5 (S1) is left optional while G6 stays "wired+tested OR out" (unresolvable contradiction, Alice §3.4).

---

## 5. Positions D1 / D4 / D5

- **D1 (reflection): PARK — as a decided posture with a grep covenant, not an open gate.** Agree with moderator default; Alice's sampler-lock argument is decisive (wiring adds a `u_reflectionMap` sampler declaration to the liquid program set — OOS-Lock item 8). Record now: procedural `skyTint` + screen-space refraction is the official GL1/GL2 reflection posture for the window; grep covenant: "no water fragment samples `u_reflectionMap`"; ADR-tracked, reversible. Revisit gated on a realistic showcase with visible landscape, **not** on D2-data (Bob's correction: Kelvin-wake outcome is unrelated to reflection). From my lens this also keeps a half-frame mirrored sub-render off the H5 hot path.
- **D4 (live-tune): YES — committed, tightly scoped, AFTER Block H.** It is the single highest artist-parity item (Charly), costs zero lanes/uniforms, and its tuned output feeds H4/H6 (tuned state goes into the golden corpus). Red-team conditions: (a) gated on H1/H3 (tuning unverified lanes is noise), (b) bound to one vanilla `StylizedWaterMaterial` instance — never Noir/Oil, whose lane-reuse would fight a global tuner (Charly §5), (c) hard scope fence per Charly §6 (no engine edits, no new lane, keyboard-first, pure-TS controller class unit-tested), (d) drift-checked via H6, (e) it must NOT grow into a Material-Studio (OOS).
- **D5 (S1 probe): MANDATORY.** The only S-item that resolves G6 with code instead of a doc statement; CPU-side keeps it 3-backend-neutral and CI-testable; the "raus" branch leaves `FluidVolume`/`BuoyancySolver` exported-but-orphaned public API — itself the claims==code violation the period targets (Alice §5). If it is made optional, G6 must be re-scoped to Alice's §3.4 ternary. S1's acceptance must be re-scoped from "Probe==Shader-Feld in Toleranz auf GL2/GPU" to Bob §3.2's three CI-runnable items (golden-vector TS-mirror regression with explicit f64/f32 tolerance; G2 constant-equality manifest on packed wave lanes; showcase integration test).

---

## 6. Definitive CI-feasible gate reformulation (G1–G9)

Harness facts behind every row: unit gate = vitest `environment: node` (no GPU/rAF); render smoke = puppeteer, `continue-on-error`, blank-check only; `pngjs` present (`check-showcases.js`), no diff lib.

**MACHINE-CHECKABLE NOW (unit/static gate, merge-blocking):**
- **G1** — Test asserts membership of ALL public liquid materials in the `ShaderAssembly` build matrix and the `ShaderValidation` matrix across glsl300/glsl100/wgsl (existing files = the fixture; today 0 of 3 / OpenWater+Stylized+Lava+Slime missing).
- **G2** — Marker-manifest drift test: assemble every liquid source in all 3 backends; extract the set of feature tokens/uniforms/varyings; assert backend manifests equal. Include an unused-varying assertion (covers H1/R1) and a GLSL100 texture-interpolant scan (`fwidth` absence; `texIndex` overwrite guard R6).
- **G3** — Two lints as test artifacts: (a) **dead-option enumeration** (every `*MaterialOptions` member consumed or legacy-tagged); (b) **lane-contract registry** spanning engine ↔ extension (incl. Noir/Oil), asserting per-styleId lane meanings and write-order safety. G9 folds in here.
- **G4** — `[VERIFIED: file:line; test=]` marker lint: referenced path:line and test must exist. No VERIFICATION prose without markers.
- **G6** — Physics fate: exactly one of {integration test present, exports removed from `index.ts`, ADR OOS + grep-verified no app/doc claims} — Alice §3.4; with D5 mandatory this resolves to branch (a).
- **G7** — D1 recorded as ADR decision + grep covenant (no water fragment samples `u_reflectionMap`).
- **G8-CI-now** — Zero-allocation assertion on the liquid `getRenderManifest()`/pack path; static no-per-frame-alloc guard.

**NEEDS A SMALL FIXTURE FIRST (not checkable today; build as H6-first, then the relevant rows become blocking):**
- **G5** — Committed golden baseline (10 pools × top/oblique × GL2) + a comparator step (1 file on `pngjs` or the ~2 kB `pixelmatch` dep) wired as a **blocking** CI job with per-pool drift threshold. **GPU goldens = informational** (documented-flaky under swiftshader, `ci.yml`); **GL1 = smoke only** (loads, 0 console errors, no NaN — the existing blank-check, made to *not* block). Rationale: ratio-within-pool differential (Bob §6) cancels backend exposure and is the only CI-portable visual gate until GPU CI stabilizes.

**DEV-MACHINE / RECORDED, NOT CI-BLOCKING:**
- **G8-p95** — `scripts/perf-liquid.mjs` rAF-p95 over ~300 frames on a reference device; budget documented in the roadmap; informational. H5's "p95 < 16.6 ms" lives here.
- **G5-GPU / G5-GL1 visual grade** — manual / non-blocking until the harness exists.

**Gate sentence rewrite:** *"Hart & stabil" = alle blocking-Gates grün in CI (G1,G2,G3,G4,G6,G7,G8-CI), informatorische Messungen (G5-GPU, G8-p95) recorded + budgetiert, und keine behauptete-aber-fehlende Funktion offen — mit explizitem Out-of-Window-Carve-out (Clapotis/Wakes = S-verzögert; FFT/SPH/LOD/SSR = OOS).*

---

**Summary (Erin round 2):** P1's H-block is the right spine but ships three uncheckable mandatory acceptances (H2 grep-consistency, H4 "≥4/5" grade, H5 p95) and no mechanism — no blocking render-output gate, no dead-option lint — so its own "G1–G9 grün" definition is vacuous in this repo's harness, whose only rendered-output CI job is non-blocking and diff-less. The plan must reorder H6 to first, convert H4's exit and H5's p95 from peer-grade/CI-impossible to a scripted golden grader and a recorded dev-machine measurement, and add the dead-option lint; I also concede my round-1 R8 posterize misdiagnosis (the `−1` formula yields exactly N levels, so H3's "fix" would regress a correct formula). Conditional `[AGREED: Erin P1]` stands on those amendments and D5 remaining mandatory.
<!-- END liquid-roadmap.round2.Erin.md -->

---

<!-- BEGIN liquid-roadmap.round2.Frank.md sha256=dd4531a749ca68ef9831139bf06a5b211e4239c709b234edbfd8a320506c19a6 bytes=9994 -->
# Round 2: Frank (Research Horizon & Future Roadmap) — 2026-10-05

> Role: red-team, horizon-separation / rabbit-hole discipline / scope-lock lens. Research only. Terse.
> Tags: `[SOURCED]` = verified in repo or cited source; `[JUDGMENT]` = design judgment; `[ASSUMED]` = premise, not verified here.
> Scope-lock reference: my round-1 §4 (11-item out-of-scope list = [L1]…[L11]); P1 Principle 3 ("kein Layout-/Sampler-Ausbau; ADR 0013-Verdikt aktualisieren statt erweitern").

## 1. Review of P1 (rabbit-hole audit per item)

Audit question per item: (a) lock-conformant to [L1]–[L11] + Principle 3? (b) any back-door compute / LOD / layout / sampler change?

| Item | Lock-conformant | Back-door check | Verdict |
|---|---|---|---|
| H1 test matrix | ✅ | None. Matrix extension + dead-varyings removal only. | clean |
| H2 claims-correction | ⚠️ | "golden-ratio-spread implementieren ODER streichen" — a new visual feature hiding in a truth pass. Bound or strike; strike-default. | bounded |
| H3 lane-contract registry | ✅ | Pure bookkeeping + bugfix, but see objection: this is the **gate the S-block silently depends on** and P1 does not declare it so. | gating |
| H4 constants hard | ⚠️ | "Wall-/Radial-Smear **structural** fix" must be pure-math restructure, no new samplers/uniforms; bound it explicitly or it expands. | bounded |
| H5 perf methodology | ✅ | None. | clean |
| H6 goldens | ✅ | = my round-1 "baseline grid" evidence deliverable. | clean |
| S1 probe/buoyancy | ✅ | No new uniform (probe mirrors existing height fn). f32/f64 parity trap is a test-design issue, not layout (see D5). | clean, conditioned |
| S2 ripple field | ⚠️ | **Inbound channel unproven.** "Repurposed lane (1–4 splats)" on a full style struct whose `u_styleA.w` already carries 2–3 meanings; or opaque-color capture (confirmed bound on all 3 backends `[SOURCED]` — `WebGL1Renderer.ts:973`, `WebGL2Renderer.ts:1310`, `WebGPURenderer.ts:1861`). Occlusion-capture path is lock-clean; unallocated lane path is a back door. | **flagged** |
| S3 clapotis | ✅ | Pure vertex math, ~0 uniform — matches my round-1 "nearly free". Cleanest S item. | clean |
| S4 Kelvin wake | ⚠️ | Same inbound-channel question as S2 (motion lane). Plus a soft deviation from [L10] (new body→water coupling direction my lock reserved for H3). Contained only because showcase-gated + droppable. | **flagged, monitored** |

Compute: none of P1 introduces compute (Principle 2 holds) ✅. LOD/tessellation: absent ✅. Layout: S2/S4 + D4 are the only risks. Samplers: S2's capture path reuses bound textures ✅; confirm WebGL1 fallback branch for `u_opaqueMap` maps to a real capture, else document gap.

## 2. Strongest objection

**Decision: the S-block's required inbound data channel is not held back by a hard, preceding H-gate, so P1's own scope-lock (Principle 3, [L7]–[L8]) can be silently violated via lane-overloading instead of an honest layout change.**

Concrete chain: P1 §7.2 asserts no layout/sampler change; S2 needs 1–4 splats, S4 needs a motion channel inbound. The only lock-legal carriers are (i) repurposed lanes and (ii) already-bound captures. But (i) is on a **full** ObjectUniforms style struct whose `u_styleA.w` already has **2 code-verified meanings** (`NoirWaterMaterial.ts:22,104` = posterizeSteps; `OilSlickMaterial.ts:23,132` = iridescenceStrength) plus the styleId row (`[SOURCED]`), and §7.1 itself flags it as a collision. Every S2/S4 lane added on top deepens that exact fragility — which is precisely D3's "style-map fragility". So P1 ships the interaction block on top of the defect it separately flags, **without requiring the lane-contract (H3) + styleId-enum (D3) to land first**. If H3/D3 are post-hoc or dropped, the S-items forced through the full/colliding slot become a de-facto layout extension wearing a "repurposed" label — the rabbit hole excluded by Principle 3 re-enters through the back door, costlier than an honest ADR-0013 expansion would have been. `[JUDGMENT]` grounded on `[SOURCED]` lane reuse.

## 3. Amendment required (concrete, minimal)

**A1** — Promote H3 lane-contract registry to a **hard, synchronous gate before S-block start** (G-item): S2/S4 may not begin until every inbound lane is allocated with documented provenance (which existing lane / which styleId meaning, or which already-bound capture) and the lint collision test (R7) is green over the full liquid pack. No new lanes = no new bytes.
**A2** — Resolve **D3 = YES in this period** (float styleId → explicit enum across 3 backends) **before the S-block**, not "später". Precondition for A1; otherwise S2/S4 stack meanings onto a collision.
**A3** — Add explicit single-line bounds: H2 golden-ratio = strike-default (or implement only as one bound constant set matching current 6-wave behavior); H4 smear restructure = math-only, no new samplers/uniforms.
**A4** — Restore the dropped evidence deliverable (see §6): ADR 0013 verdict update must be an **owned work package with acceptance**, not a principle phrase; the wave-data model (probe + interaction channel) needs a documented canonical form, not only code+tests.
Each amendment is a guard sentence or an ordering rule — no new engines, no scope growth. `[JUDGMENT]`

## 4. [AGREED: Frank P1] — strongest doubt + revocation condition

P1's H-block, the golden/capture/regression infrastructure, S3, and the Principle-3 framing are the correct shape and honestly reflect the measured state; it deserves conditional acceptance.

**Strongest doubt:** the S-block's lane-allocation unprovenness (objection §2) — if S2/S4 ship without the A1/A2 gate, the scope-lock collapses and P1 inherits the exact rabbit hole it claims to exclude.

**Revocation condition:** I revoke — i.e., the S-block as integrated fails my gate — if any of: (a) S2/S4 merge before H3 lane-contract + D3 enum resolution; (b) any S/H item merges a new uniform byte, a new sampler, or a compute/lod construct without an explicit ADR-0013-lite justification in its acceptance; or (c) the ADR 0013 verdict update (A4) is absent from the locked plan. All three are verifiable from the diff, and (c) from the ADR trail.

## 5. Positions D1 / D4 / D5

- **D1 (reflection park):** AGREE with parking, with a condition. Park as an explicit, documented, reversible decision (`[SOURCED]`-concordant: planar node `PlanarReflectionNode` exists, no shader samples `u_reflectionMap`) with a concrete re-open trigger (realistic open-water showcase needing it + measured frame budget), NOT a silent drop. The park must be recorded in the plan/ADR trail so the decision is auditable. `[JUDGMENT]`
- **D4 (live-tune surface):** YES in period, minimal form only. Logical bottom: to give artists a real rational-tools lever, S-scope, showcase-level hotkeys, **no engine UI**, and it MUST drive only hardened per-style constants from H4 — no new debug uniform lanes, or it re-triggers the §2 back door. This closes no layout; verify it keeps the lock. `[JUDGMENT]`
- **D5 (probe mandatory):** Keep S1 mandatory — it is the single highest-credibility "hard" deliverable and the anchor for buoyancy truth (my round-1 §1c position) — but its mandatory status is **conditional on an honest parity test**: (1) the TS mirror must run in **f32 semantics** (`Math.fround`/`Float32Array`), otherwise the test measures TS-f64-vs-GPU-f32 divergence and produces misleading tolerances that fail on real rides; (2) tolerance **derived from measured backend precision per tier, not hand-picked**, and (3) coverage across the style ladder incl. worst case (max waves, long t). If an honest test cannot be constructed within the lock, downgrade to "probe as neutral debug aid only" rather than claim parity. Also: probe must not become a per-frame gameplay readback in this period — test-time only (Dave's cost point is fair; bounded readback of a few points keeps it cheap and honest). `[JUDGMENT]`

## 6. Evidence-infrastructure deliverable check

Against my round-1 §5 ("Phase A must produce **evidence infrastructure**, not features — baseline grid, wave-data model, ADR 0013 verdict"):

| Required deliverable | In P1? | Verdict |
|---|---|---|
| Measured per-backend baseline grid | H4 regression-grid + H6 goldens | ✅ present, owned, accepted |
| Wave-data model (probe + interaction channel), canonical & documented | S1 "ingestion contract" (Dave) + S2 typed `SurfaceRippleField` | ⚠️ code-level only; no documented canonical form/deliverable entry → add to A4 |
| ADR 0013 verdict updated (layout stays, with a stake in the ground for parameter-surfaces/LOD) | only Principle-3 phrase, no owner/acceptance | ❌ **dropped by consolidation** — add (A4) |

The "evidence infrastructure for the future" framing was **partially dropped**: the ADR-0013 verdict is demoted from deliverable to a principle phrase, and the wave-data model has no doc deliverable. That framing is precisely what makes this a *roadmap* and not a feature sprint, so it should be restored as owned work packages (A4). `[JUDGMENT]`

---

**Summary (Frank):** P1's shape is sound and honestly reflects the measured inventory, so I give a *conditional* `[AGREED: Frank P1]` — but the S-block's inbound channels (S2/S4) sit on a full, already-colliding uniform slot (`u_styleA.w` verified with 2–3 meanings), and unless the H3 lane-contract and D3 styleId-enum land as a blocking gate before the S-block, the "no layout change" lock re-enters as a silent back door. Amendment A1/A2/A3 are ordering and guard sentences, not scope growth; A4 restores the one genuinely dropped deliverable — an owned ADR 0013 verdict update — that distinguishes a roadmap from a feature sprint. D1 park agreed (with auditable record), D4 approved only under the H4-constant/lane lock, D5 probe mandatory but only with an f32-honest, precision-calibrated, ladder-wide parity test; the whole plan is revocable on three verifiable conditions.
<!-- END liquid-roadmap.round2.Frank.md -->

---

<!-- BEGIN liquid-roadmap.round3.Alice.md sha256=7e5d2f71f488167b30bbf8af41d18edd7944cd6f2dc9987568ae93fa831ccde8 bytes=3108 -->
# Round 3: Alice (Architect & Systems Lead) — 2026-10-05

## Amendment check (mine, vs P2 §8)

All of my round-2 amendments (§3, §5, §6 of `liquid-roadmap.round2.Alice.md`) are folded into P2 §8, verified line-by-line against the topic doc:

| My amendment (round 2) | P2 location | Status |
|---|---|---|
| H6 golden baseline first (M1-first reorder) | §8.2 Block M "ZUWERST"; §8.8 1) M1+M2; H4 "erst nach M1-Baseline" | present |
| H2 cut from the S-block gate (doc-only, parallel) | §8.2 T2 "Dokumentation, kein Gate"; S1 "keine H-Vorbedingung"; S-block gate = {T1, T3, M1} | present |
| S2: exactly ONE delivery channel — single registered splat lane, capture route deferred, refraction semantic collision documented | §8.2 S2 "genau EIN Lieferkanal — eine einzig registrierte Splat-Lane … Capture-Textur-Route post-period (Semantik-Kollision mit Refraktion auf `u_opaqueMap` dokumentiert)" | present |
| D5: S1 mandatory (G6 code-resolution) | §8.3 D5 "Sonde = PFLICHT (S1)"; §8.2 S1 PFLICHT | present |
| D1 reflection = PARK, ADR-tracked, grep-covenant, decoupled from D2 data | §8.3 D1 = PARK, "entkoppelt von D2-Daten", Re-Open-Gate | present |
| D3: minimal in-period, full float→enum refactor deferred until a 6th published style | §8.2 T4 D3-minimal; full refactor "zurückgestellt" | present |
| Gate carve-out: Clapotis/Wakes = S-deferred, FFT/SPH/LOD = OOS, else gate contradicts itself | §8.2 T2 Deferred/OOS labels; §8.5 explicit Carve-out in the Gate-Satz | present |
| G4 machine-checkable marker `[VERIFIED: file:line; test=]` + lint | §8.2 T2 marker + Lint (G4); §8.5 G4 blocking in CI | present |
| G3 registry as artifact / G9 folded / G6+G7 as ADR+grep contracts | §8.2 T3 test-declarative artifact; §8.5 blocking set G1–G4, G6, G7, G8-CI (G9 absent → folded); §8.4 shared ownership | present |

S2 lane budget tightened from my "max 2 splats" to "max 1 active splat per surface" — a stricter version of my own lane-conservation position; I accept it.

Note: D2 (Kelvin-Wake) landed OUT (§8.2 S4, §8.3 D2) vs. my round-2 "IN as showcase-gated". Not in my §3 hard-requirement list; the gate condition proved vacuous (no body moves through water in the period; dropper responds via S2 impact splat). Accepted as group consensus, documented as future item.

## [AGREED: Alice P2]

## Strongest remaining doubt + withdrawal condition

Strongest remaining doubt: S2 remains the first real-world test of the Lane-Contract (T3); if the T3 registry or the M1 GL2 golden baseline slips, the period's central "measured, not claimed" promise is again unenforceable — the exact failure mode P1 had.

Withdrawal conditions (I withdraw acceptance if any hold): any H/S shader-touching item merges without the M1 GL2 golden baseline (G5 unenforceable); `u_styleA.w` (or any other lane) acquires an unregistered meaning beyond the T3 registry during the period; S2's splat lane is not registered in T3 before the first S2 merge; D5/S1 reopens to optional without re-scoping G6; "Hart & stabil" is declared against P2 §8.5 while a Blocking-Gate is red in CI.
<!-- END liquid-roadmap.round3.Alice.md -->

---

<!-- BEGIN liquid-roadmap.round3.Bob.md sha256=4bf69e0ab749b83cebb75bc649c8d5a5a368939d30dd15b958e3052fe0246865 bytes=3054 -->
# Round 3: Bob (Realistic Open-Water & Wave Physics) — 2026-10-05

Lens: realistic tier / wave physics / physical-image. Research only; no code changed. Cited against P2 §8.

## Amendment check (mine, vs P2 §8)

1. **H4 exit = scripted differential grader (not peer grade) + murk-as-lane-trade note** — ✅ present, §8.2 H4: "Exit kein Peer-Grade '≥4/5' sondern skriptierter Differential-Grader auf dem M1-Korpus (Floor-Kontrast-Erhalt, Clip-Fraction ≤, Spec-Lobe-Bound; GL2-blocking, GPU-informational)" + "Murk = Lane-Trade unter 256-B-Constraint … Transmittance-Gate erneut passieren".
2. **S1 = golden-vector regression, precision-derived f32 tolerance, G2 constant-equality manifest, integration test; no "probe==field" float claim** — ✅ present, §8.2 S1: f32-Semantik (Math.fround/Float32Array), präzisionsabgeleitete Toleranz (nicht Handwahl), G2-Konstantengleichheits-Manifest = "same field"-Beweis, Showcase-Integrationstest; die P1-Phrase "== field in Toleranz auf GL2/GPU" ist ersatzlos entfernt.
3. **S3 ownership re-split by artifact (Bob = vertex/wall-binding, Dave = wall-API+integration), wall contract in H3/T3** — ✅ present, §8.2 S3: Bob = `OpenWater.vert.{glsl,glsl100,wgsl}` + Lane-Binding + G2/G5; Dave = `OpenWaterMaterial.ts` wall-API + Showcase-Wand + Integrationstest; Wall-Format-Contract in T3 registriert; "kein Materialfile hat zwei Owner".
4. **golden-ratio STRIKEd** — ✅ present, §8.2 T2: "golden-ratio-Spread STREICHEN (real 2+1+2+1 dokumentieren)".
5. **D2 (Kelvin) OUT** — ✅ present, §8.3 D2 = OUT, §8.2 S4 = RAUS.
6. **D5 (probe) MANDATORY** — ✅ present, §8.3 D5 = PFLICHT (S1), S1 als Pflicht-Block §8.2; einzige G6-Code-Auflösung.
7. **D1 park als schriftliche Haltung, entkoppelt von D2** — ✅ present, §8.3 D1 = PARK als schriftliche ADR-getrackte Haltung (skyTint + SS-Refraktion = offizielle GL1/GL2-Position, Grep-Covenant), "entkoppelt von D2-Daten", Re-Open-Gate realistisch.

Alle 7 Amendments sind in P2 eingearbeitet. Nichts fehlt.

## [AGREED: Bob P2]

## Strongest remaining doubt + withdrawal condition

**Doubt:** Die H4-Grader-Schwellen (C_floor_min, Clip-Fraction ε_sat, Spec-Lobe-Bound) selbst werden einmalig gegen historische Goldens kalibriert und dann merge-blockend. Bis zur ersten signierten Baseline sind diese Konstanten nicht aus einem harten Prinzip abgeleitet — eine fehlkalibrierte Schwelle lässt entweder einen murkigen Floor durch oder blockiert endlos. Zusätzlich hängt die Glaubwürdigkeit von S1 vollständig an der T3-Registry, die die Lane-Konstanten manifestiert; jede Abschwächung dort entwertet den "same field"-Beweis.

**Withdrawal condition:** Ich ziehe die Zustimmung zurück, wenn (a) H4 mit nicht-kalibrierten/operational schwammigen Grader-Schwellen als CI-blocking scharfgeschaltet wird (statt pro-Schwelle-Signatur + Spot-Check-Kalibrierstatus), (b) die T3-Lane-Registry so gedehnt wird, dass S1/S3-Konstanten vom manifestierten Pack abweichen dürfen, oder (c) D5/S1 seinen Pflichtstatus in der Umsetzung verliert.
<!-- END liquid-roadmap.round3.Bob.md -->

---

<!-- BEGIN liquid-roadmap.round3.Charly.md sha256=7171656ff0a1259df0425143833590cd81523fc064d8f4535b97a1dba2f6286d bytes=2983 -->
# Round 3: Charly (Stylized/NPR Water & Artist Workflow) — 2026-10-05

## Amendment check (mine, vs P2 §8)

All six round-2 amendments verified line-by-line against P2 §8 (liquid-roadmap.md:126-181):

1. **Posterize — no off-by-one fix, transport + level-count test, `−1` semantics preserved:** ✅ P2 §8.2 T3 (line 143): "Posterize: kein Off-by-one-Fix — stattdessen Transport- + Level-Count-Test (glsl300/100/wgsl, N Ebenen) + optionale Art-Bucket-Audit (`+0.5`-Topbucket auf hellen Inputs)". The truncation action is gone; `u_styleA.w − 1.0` stays untouched in NoirWaterMaterial.ts:104. Art-bucket audit correctly separated as optional polish.
2. **Lane-contract registry as test/CI declarative artifact spanning engine ↔ extension:** ✅ P2 §8.2 T3 (line 143): "test-/CI-deklaratives Artefakt Engine ↔ Extension inkl. Noir/Oil-Lanes (nicht Engine-Only-Laufzeit)". Plus S2-Splat- and S3-Wall-contract registration and eviction/re-homing rules (never silent delete).
3. **v_displacementY removal + H2 record of why (crest-foam anchor deferred, no vertex hook):** ✅ P2 §8.2 T1 (line 141): dead varying removed "in H2 Begründung festhalten: einziger Stylized-Crest-Foam-Anker, kein Vertex-Hook → bewusst zurückgestellt".
4. **Noir peer-grade moved to H6/M1, not H3:** ✅ P2 §8.2 T3 (line 143): "Noir-Peer-Grade → M1/H6" (M1 = H6 goldens). H3 keeps only the registry plus claims-cleanup path in H2 — no visual-audit dependency.
5. **D3-minimal in-period, full enum refactor deferred:** ✅ P2 §8.2 T4 (line 144): style-identity/registration test in-period (styles 0–5 dispatch, `styleId==3.0` ⇒ isExtension); full float→enum refactor explicitly deferred, gated on a planned 6th published style. Owner: Charly.
6. **D4 promoted to committed, tightly scoped showcase pad AFTER Block H:** ✅ P2 §8.3 D4 (line 160): "committet, NACH Block H", keyboard-first pad, one vanilla StylizedWaterMaterial instance (never Noir/Oil), no engine edits / no new lane / no persistence / no material studio, pure-TS controller class unit-tested, tuned state feeds M1 corpus. Owner: Charly, acceptance bound per my §6. Sequencing confirmed in §8.8 (D4 at step 6, after H4 step 4).

No missing item. All blocking conditions of my round-2 revocation clause are resolved.

## [AGREED: Charly P2]

## Strongest remaining doubt + withdrawal condition

Strongest remaining doubt: execution order §8.8 places the D3-minimal style-identity test (T4) and the posterize level-count test (T3) inside the Truth gate that must pass before Block S — if implementation pressure ever re-folds those tests into "the fix is obvious, skip the assertion", the measured white-out regression window reopens. Withdrawal condition: I withdraw agreement if the posterize `−1` semantics get removed or the level-count test (T3) or the style-identity test (T4) is silently dropped from the T-gate before Block S runs, or if D4 loses its committed post-H slot and reverts to advisory.
<!-- END liquid-roadmap.round3.Charly.md -->

---

<!-- BEGIN liquid-roadmap.round3.Dave.md sha256=e6a408d9fe1881f16ca6acc30031c438d230f14a8f37d0000e98da6cf502b400 bytes=2649 -->
# Round 3: Dave (Simulation & Interactivity) — 2026-10-05

## Amendment check (mine, vs P2 §8)

Verified item-by-item against `liquid-roadmap.md` §8.2/§8.3 (HEAD):

1. **S-gate de-coupling / interactivity is not the cut-line** — PRESENT. Block S: "S1+S2 Pflicht; S3 danach; Interaktivität ist NICHT die Cut-Linie" (l.150). S1 "PFLICHT, KEINE H-Vorbedingung (darf als Erstes, mit Block T interleavt)" (l.151). S2 gate `{T1,T3,M1}` = H1/H3/H6, exact match to my requested set (l.152). S3 gate `{T1,T3,M1}` (l.153). H2/T2 explicitly "kein Gate" (l.142).
2. **S2 single delivery channel** — PRESENT. Exactly ONE splat lane (`vec4 = pos.xz + spawnTime + energy`), max 1 active per surface, upload on impact only, never per frame; evicted-field re-homed per T3 (never silent delete); capture-texture route deferred post-period with the `u_opaqueMap` refraction collision documented (l.152).
3. **S3 acceptance re-scope** — PRESENT. JS-mirror sign-flip/energy-trap test + 3-backend assembly presence + showcase golden (node ≈ wall − λ/4); explicit "kein reiner Shader-Text-Assert" (l.153).
4. **S3 ownership re-split by artifact** — PRESENT. Bob = vertex consumption (`OpenWater.vert.{glsl,glsl100,wgsl}` + lane binding + G2/G5); Dave = public wall-config API (`OpenWaterMaterial.ts`) + showcase wall + integration test; wall-format contract (normal + half-extent + trap range) registered in T3 — no material file with two owners (l.153). Overlaps closed in §8.4.
5. **S4/Kelvin OUT** — PRESENT. D2=OUT, showcase-gated future item, reason recorded (l.154, l.158).
6. **D5 probe MANDATORY** — PRESENT. D5 = PFLICHT (S1), sole G6 code-resolution, survives even in the honest-f32-parity fallback (l.161).
7. **Concrete S2 acceptance = the SplashDropBehavior impact** — PRESENT, verbatim intent: periodic impact emits decaying ring via S2 lane AND the crate then bobs on the real (S1) surface = visible "object reacts" proof (l.152).

## [AGREED: Dave P2]

## Strongest remaining doubt + withdrawal condition

Strongest residual doubt: S2's lane-eviction re-homing is the first real stress test of the T3 registry — if the evicted field's semantics are re-homed silently or under-linted, we trade one visual parameter for the splash. This is auditable (T3 lint + G3), reversible, and not structural.

Withdrawal condition: I revert to `[OBJECTION: Dave]` if P2 §8.2 order/commitment is regressed during execution so that S1/S2 become time-optional (the "interactivity is not the cut-line" clause breaks), or if S2 ships with more than one active delivery channel, or with an unregistered splat lane that silently evicts a field.
<!-- END liquid-roadmap.round3.Dave.md -->

---

<!-- BEGIN liquid-roadmap.round3.Erin.md sha256=05fff8cf675b0241b73c10b4680a5314b6dd44cd9e998f0b3df55a6900cf2525 bytes=3887 -->
# Round 3: Erin (Quality, Robustness & Performance Audit) — 2026-10-05

> Stance: RED-TEAM, evidence-only. Verified against `.agents/collaborate/liquid-roadmap.md` §8 (P2, lines 126–182) and my round-2 leaf (`liquid-roadmap.round2.Erin.md`). No code changed.

## Amendment check (mine, vs P2 §8)

Each round-2 amendment (§3 items 1–8) checked against P2 §8:

1. **H6/M1 FIRST + blocking goldens comparator** — ✅ M1 = H6 goldens is the first block ("Block M — ZUWERST"), shipped with "Comparator (Blocking-CI-Job, `pngjs`/`pixelmatch`), pro-Pool-Drift-Schwelle"; GPU goldens informational; GL1 = smoke only (§8.2 M1, lines 136–137; §8.8 step 1). Baseline-before-merge rule present.
2. **Truth (T)/Measurement (M) lane split** — ✅ Block M = Messtechnik & Baseline, Block T = Wahrheit, dependencies explicit (§8.2).
3. **H2 cut from S-gate + G4 marker lint** — ✅ T2 = "Dokumentation, kein Gate"; `[VERIFIED: datei:zeile; test=]`-Marker + Lint (T2 line 142); S2/S3 gates are {T1, T3, M1} only (§8.2); G4 blocking in CI (§8.5 line 169). Note: doc spells it "VERIVIED" (typo) — semantically the marker lint is present.
4. **H4 exit = scripted differential grader** — ✅ "Exit kein Peer-Grade '≥4/5' sondern skriptierter Differential-Grader auf dem M1-Korpus … GL2-blocking, GPU-informational" + murk lane-trade/transmittance-gate note (§8.2 H4 line 147).
5. **H5 p95 = dev-machine, CI = zero-alloc + static no-per-frame-alloc** — ✅ M2: CI zero-alloc assertion + static guard; p95 dev-machine-only `scripts/perf-liquid.mjs`, informational, kein Merge-Kriterium (§8.2 M2 line 138).
6. **NEW dead-option lint (H5, G3/G9)** — ✅ §8.2 H5 = Dead-Optionen-Lint (all `*MaterialOptions`, consumed-or-legacy-tagged); G3 blocking in CI (§8.5 line 169).
7. **Posterize = level-count test, no `−1` removal (R8 conceded)** — ✅ T3: "kein Off-by-one-Fix — stattdessen Transport- + Level-Count-Test (glsl300/100/wgsl, N Ebenen) + optionale Art-Bucket-Audit" (§8.2 T3 line 143).
8. **Noir peer-grade → M1/H6** — ✅ T3 "Noir-Peer-Grade → M1/H6" (§8.2 T3).
9. **Explicit block/non-block gate disposition + §8.5 carve-out sentence** — ✅ §8.5 splits "Blocking in CI" (G1,G2,G3,G4,G6,G7,G8-CI) vs "Informational/recorded" (G5-GPU, G8-p95, GL1-Smoke, visuelle Grades); gate sentence carries explicit carve-out (Clapotis/Wakes = S-verzögert; FFT/SPH/LOD/SSR = OOS) (§8.5 lines 168–171).

Cross-checks: D5 (S1 Sonde) = PFLICHT, no H-prereq, G6 resolved via S1 integration test (lines 151, 161) — revocation condition 6 clear. D1 = PARK with grep covenant (G7 blocking). All six round-2 revocation conditions (round2 §4) resolve to non-triggered.

## [AGREED: Erin P2]

**Strongest remaining doubt:** P2's "Blocking in CI" list (§8.5) enumerates G1–G8 excluding **G5**, listing only "G5-GPU-Goldens" as informational — while the GL2 blocking goldens comparator necessarily must block (M1 declares it "Blocking-CI-Job"). The disposition is present in the package, but §8.5 as the *authoritative* gate sentence is internally inconsistent and G5-GL2 could silently drift to informational ("flaky under swiftshader").

**Withdrawal condition:** if the GL2 golden-comparator job (M1) is demoted to informational/continue-on-error, or the §8.5 "Blocking in CI" enumeration is amended to exclude the GL2 goldens/H4 grader as blocking, I revert to `[OBJECTION]` — that re-opens the exact vacuous-gate failure P2 was built to close.

**Summary (Erin round 3):** All 8 amendments and the required minimal set (blocking goldens comparator via M1, explicit block/non-block split, dead-option lint) are verifiably present in P2 §8; all six revocation conditions from round 2 are non-triggered, so I sign off. Only residual: the §8.5 blocking-set enumeration omits G5-GL2, a consistency gap to lock in the final gate sentence, not a blocker.
<!-- END liquid-roadmap.round3.Erin.md -->

---

<!-- BEGIN liquid-roadmap.round3.Frank.md sha256=1651fbe9f9e176f7fa7a52d165b4046272a7eb7b51ed6e9e4cacb0af863e1b98 bytes=2975 -->
# Round 3: Frank (Research Horizon & Future Roadmap) — 2026-10-05

## Amendment check (mine, vs P2 §8)

| Amendment (round-2) | P2 location | Present |
|---|---|---|
| A1 — H3 lane-contract as HARD gate before S-block; Engine↔Extension incl. Noir/Oil lanes; per-styleId semantics + Write-Order-Safety; lint vs collisions; eviction = re-home, never silent delete | T3 = "HARTES GATE vor Block S"; S2/S3 Gate {T1,T3,M1}; S2 splat-lane + S3 wall-contract registered; S1 API contract-first in T3 | ✅ |
| A2 — D3 style-identity test in-period before S; full enum refactor deferred | T4 = D3-minimal "im Zeitraum, vor S" (styles 0–5 dispatch, styleId==3.0⇒isExtension, lane-contract-Abgleich); full enum stays zurückgestellt | ✅ |
| A3 — single-line bounds: golden-ratio struck; H4 math-only, no new samplers/uniforms | T2 "golden-ratio-Spread STREICHEN"; H4 "rein mathematisch… gebunden: keine neuen Sampler/Uniforms" | ✅ |
| A4 — evidence deliverables restored as OWNED work packages (ADR 0013 verdict + wave-data canonical form) | §8.6 explicitly "wiederhergestellt als Owned-Deliverables — Frank A4": ADR-0013 verdict = owned w/ acceptance (Alice); wave-data model canonical form = deliverable (Bob+Dave, accepted in T3/S1/S2); step 8 | ✅ |
| D1 park with auditable record | §8.3 D1 = ADR-getrackt, reversibel, Grep-Covenant, re-open gate — auditable | ✅ |
| D4 minimal under H4-constant/lane lock | §8.3 D4: showcase-only, one Vanilla-StylizedWater instance (never Noir/Oil), no engine edits, no new lane, no persist, post-H, feeds M1 corpus | ✅ |
| D5 probe mandatory, f32-honest + precision-calibrated parity test, downgrade-to-debug clause preserved | §8.3 D5 PFLICHT (S1) + downgrade clause; S1: `Math.fround`/`Float32Array` f32 semantics, precision-derived tolerance (not hand-picked), ladder-wide incl. worst case, G2 constant-equality manifest | ✅ |

Overlaps resolved (§8.4), scope-lock intact (§8.7, D2=OUT), ordering sane (§8.8: M1 basline → T → S1 → H4 → S2 → D4 → S3 → evidence deliverables).

## [AGREED: Frank P2]

## Strongest remaining doubt + withdrawal condition

Doubt: the "hard & stable" claim now rests on CI gates actually being built and green (M1 baseline before any output-changing edit, T3 registry + G2/G3 lint, S1 f32 parity owning G6) — a testing-discipline load, not a design flaw; if the measurement/registry harnesses are built last or skimp, the plan silently regresses to claim-over-code. I withdraw → the S-block as integrated fails my gate — on any of: (a) S2/S3 merge before T3 registry (incl. Noir/Oil lanes) is CI-green and S1's f32-lane manifest passes; (b) any H/S item merges a new uniform byte, sampler, or compute/LOD construct without ADR-0013-lite justification in its acceptance; (c) the §8.6 owned deliverables (ADR-0013 verdict update, wave-data canonical form) do not actually land as committed artifacts in step 8. All verifiable from diff + CI + ADR trail.
<!-- END liquid-roadmap.round3.Frank.md -->
