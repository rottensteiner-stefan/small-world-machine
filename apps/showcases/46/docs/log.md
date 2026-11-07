# Showcase 46 — Particle Physics Lab (Living Log)

Append-only. Newest at the bottom. Tracked on branch `particle-system-s34` (campaign `particle-system-s34`, coordinator: Alice / `particle-s34`).

---

## 2026-10-31 — v0 skeleton (Stage 1+2 baseline), compiled on branch base

- **Decision (moderator):** Showcase 46 is a **dedicated Particle Physics Lab**, not an upgrade of 38/44 — keeps golden baselines `fire45`/`pbr38` untouched. Recorded as finding F1 on the campaign board.
- **Created:** `index.html` (showcase-layout, nav ring 45 → 46 → 24), `showcase.ts` (compilable v0 against branch-base APIs), `docs/concept-dossier.html`, this log.
- **v0 lanes (already live on branch base):** forge sparks (`ParticleSystem` 700 + `GravityAffector` + `SdfColliderAffector` sphere/box anvil, restitution 0.42 / friction 0.28), impact `SubEmitter` (sparks → embers ring buffer), obstacle-aware smoke swirl (`CurlNoiseAffector` 260 + `SmokeSpriteMaterial`, `foldAlphaIntoScale: false`, octagon).
- **Deliberately NOT referenced yet (compile-safe):** soft particles, 6-way lighting, trails, WebGPU `GPUParticleSystem`, heightfield rain — wiring lands with board tasks T2/T3/T4/T5/T7/T9.
- **Gates:** worktree typecheck + build verified green (path-scoped commit of own files only).

---

## 2026-11-01 — S34 Stage-3+4 wiring (T1/T2/T3/T4 live), golden-safe

- **Landing (branch commits):** Dave T1–T4 `0d63badb` (ParticleLightPool, SmokeSpriteMaterial soft+6-way, ParticleTrailRenderer, 891 lines, canonical invariant IDs verbatim), Charlie T8 `00af4b91` (C2 matrix), my `dispose()` reuse-fix `aaf6b4d6` (ring `_head` reset to `maxHistory-1` on dispose — closes the reuse-hole Charlie's trail-connectivity test exposed). All pushed to `origin/particle-system-s34`.
- **Wired into `showcase.ts` (this app):**
  - **T1 `ParticleLightPool`** on the sparks lane (`maxActive: 6`, `lightDistance: 2.6`, `intensityScale: 3.2`, `minScore: 0.2`) — sparks now author `heat` so the read-only hotness ranking can claim pooled lights; budget shares the 16-slot dynamic-light cap with `FireLightBudget`.
  - **T2+T3 `SmokeSpriteMaterial`**: `softFadeDistance: 0.55` activates the `u_opaqueDepthMap` soft-particle fade; `lightIntensity: 1.6` + `lightDirection`/HG `forwardScatter`/`selfShadowStrength` activate the analytic closed-form 6-way volume lighting. No new bindings, 0 MB.
  - **T4 `ParticleTrailRenderer`** behind a **tracer spark emitted into the shared `_sparks` system** (`maxHistory: 384`, `width: 0.16`, `fadeTime: 0.7`, `camright`-free camera-aligned quads). The tracer runs through the real gravity+SDF-collision affectors; SHIFT spawns a fresh one, auto-refire keeps the lane observable.
- **Honest gates at this milestone:** worktree `tsc --noEmit` **0 errors** (incl. Bob's mid-WIP — he fixed his TS2769/TS2307 + mounted `WeatherEmitter` in the working tree, uncommitted), `build:lib` green, eslint quiet. **Runtime pixel output of soft/sixway not yet browser-verified** — the two features are default-off-safe by construction (no FP divergence on the disabled path); `fire45`/`pbr38` goldens deferred to post-merge (unchanged baselines).
- **Still pending (compiled against, not yet live):** WebGPU `GPUParticleSystem` lane (T5/T7 — Bob, mid-WIP in tree), `WeatherHeightfieldCollider` rain lane (T9 — Bob, mid-WIP; `WeatherEmitter` mount visible). Both wire in once Bob commits.
- **Padding:** `SPACE` spark burst, `SHIFT` tracer, `Alt+1/2/3` renderer switch. HUD reflects live vs pending lanes.

---

## 2026-11-01 — T9 weather lane live + merge main + full suite green

- **Bob's lane secured** as save-point `b008cfa5` (transport-stuck session; his 13 files, `verify-your-claims` scope, all lanes' invariants verbatim — Bob confirmed the commit contains exactly his work). Pushed.
- **Merge `main` (78c49b08) into branch** `b7b6f77e`: brings the 9 unpublished glTF-session commits (aniso/irid textures, ShaderFlag preprocessor, ADR 0054/0055 corrections). Resolved: `docs/adr/0047` (kept branch v2-registry with all 10 canonical S34 IDs incl. `S34-POOL-PARTITION`/`S34-SCREEN-COLLISION-TAPS`; main annex untouched) + `WebGPURenderer.ts` (merged WGSL particle imports with `ShaderFlag` import).
- **Gallery wiring fixed** `4bb26b42`: Showcase 46 added to `public/index.html` gallery (+counter 45 Demos) and to the curated tour in `tests/scripts/showcaseWiring.test.ts` (44→45→46→24); `24/index.html` prev re-pointed to 46. `showcaseWiring.test.ts` 13/13 green.
- **T9 wired into showcase** `e5e33998`: `WeatherEmitter` rain lane (`count: 420`, roof-aware via `WeatherHeightfieldCollider` 64×64 baked from procedural roof source, cadence 2 s) with `onRoofImpact` → splash `SubEmitter`-style bursts (`_splashSource`, 220). T5/T7 GPU lane remains a documented wiring hook (needs live WebGPU device; parity covered by tests).
- **Full T11 gate status:** `tsc` 0 errors, `check:doctrine` clean, `lint` clean, full `vitest run` **508/508 files, 3894 passed / 10 todo**. `ParticlePerformanceGates` p95 flake is load-noise only (3/3 isolated green — known, documented).
- **NOT yet run:** `fire45`/`pbr38` goldens (manual browser capture audits, ~25 min each, post-merge as planned).

---

## 2026-11-01 — Showcase 46 → Particle Variant Lab (fire-45 style), branch `showcase46-particle-variants`

- **Auftrag (User):** Showcase für das Partikelsystem „mit verschiedenen Varianten, in der Art wie für das Feuer" (fire45). Entscheidungen: **46 AUSBAUEN** (kein neues 47), **Beides** = Effekt-Varianten UND Kamerapools. Multi-Session: parallel zur glTF-Session (`small-world-machine-72`) auf `main`; dieser Branch enthält ausschließlich Eigene-Pfade (Mailbox-konform).
- **Architektur-Entscheidung (Sparring, bewusst schlank):** Varianten steuern **Sichtbarkeit + Emission + Kamera** — KEINE dispose/rebuild-Zyklen, keine Ressourcen-Flips. Lanes bleiben simuliert (regular update) und nur im aktiven Varianten-Fokus sichtbar/gefeedt. Zero-GC-freundlich, robust, deterministisch testbar.
- **`Variants.ts` (NEW, einzige Spec-Quelle):** `PARTICLE_VARIANTS` (overview/forge/smoke/trails/weather/gpu, je `VariantLanes`-Maske), `CAMERA_POOLS` (overview/closeup/budget, Tuples statt `Vector3D` — allokationsfrei im Modul-Load), `resolveVariant` degradiert robust auf overview (Garbage-Query-Params). Exportiert `CAMERA_POOLS`/`cameraFrom`/IDs für Showcase+HUD+GoldenCapture.
- **`GoldenCapture.ts` (NEW, 45-Adaption):** Pool-Keys `part46-<variant>-<pool>`; kuratierte `GOLDEN_POOLS` (5 Pools: overview-overview, forge/smoke/trails/weather × closeup). Host als `SmallWorldMachine` typisiert, `host.canvas` + `renderer.setSize` + `camera.aspect/updateProjectionMatrix` pin, `_hideUi` (buttons/header/app-footer/showcase-layout/drawer), `_startRepaint` replayt `step(0)`. `parseGoldenSpec` + `GoldenCapture.run` deterministisch (stop → clock-reset → variant/pool → soak 700 ms → N×`step(1/60)` → ready).
- **`Hud.ts` (NEW, ShowcaseDrawer):** Varianten-Umschalter (Tasten 1–6), Kamera-Pools (7–9), Live-Regler Funken-Menge/Rauch-Dichte/Niederschlag (0-fähig), WebGPU-Schalter (`gpuAllowed`), Pause (`P`) + Tempo-Skala (`T` 1→0.5→0.25→0.1→2), Readout (~3 Hz), `handleKey`/`sync`/`dispose` (Proxy auf `ShowcaseDrawer.dispose`).
- **`showcase.ts`-Umbau:** Imports/Header, Varianten-/HUD-/Golden-/GPU-RNG-State, `start()` (golden vs. interactive), `destroy()` (goldenCapture/hud/gpuSystem dispose), `onKeyDown`-Routing zu `_hud.handleKey` (Modifier-/INPUT-Guard wie 45), `_applyVariant` (isVisible-Masken, `gpu`-Fallback auf `forge` ehrenvoll), `_applyCameraPool` (`setInitialCamera`), `_applySettings` (Variant + Kamera-nur-bei-Poolwechsel via `_lastPool`), `_mountGpuLane` (echte `GPUParticleSystem`, `WebGPURenderer`-Gate + `navigator.gpu`, registration idempotent), `update`-Rewrite (timeScale/paused, Varianten-Gating, **ratenbasierte Auto-Emission** seed-pinned, GPU-Lane-Treiber, HUD-Readout). `Math.random()` → `mulberry32(20260718)` in allen Emittern.
- **Ehrliche GPU-Autonomie:** `gpu`-Variante = echte WebGPU-Compute-Lane hinter `WebGPURenderer`+`navigator.gpu`; ohne Device oder bei `gpuAllowed=false` ehrlicher Fallback auf `forge` (sichtbare CPU-Funken), Readout zeigt Zustand (live / deaktiviert / nicht verfügbar).
- **Showcase-Wiring unverändert:** 46 bleibt 46 in Tour+Gallery (Tests unangetastet), `showcaseWiring.test.ts` 13/13.
- **Gates (Worktree, eigenes `node_modules` via `npm ci`):** `tsc --noEmit` 0 Fehler, `lint` clean, `build:lib` OK, `showcaseWiring` 13/13, volle Suite 3902 passed (2 `ParticlePerformanceGates`-Flakes = CPU-Load der parallelen glTF-Session; isoliert 2/2 grün, bekannt dokumentiert).
- **Goldens-Config:** `.agents/scripts/goldens/config.json` Scene `46` mit 5 `part46-*`-Pools (1280×720, 60 Frames) — Browser-Audit nach Merge (wie `fire45`).
- **Worktree-Stand:** `node_modules`-Symlink auf main schlug fehl (Dual-Instance-Typkollision) → durch echtes `npm ci` im Worktree ersetzt (Workspace-Links zeigen auf Worktree-Pakete).

---

## 2026-11-01 — Merged to main + Golden baseline audit `part46-*` (GL2, byte-stable)

- **Merged:** showcase-46 variant lab on `origin/main` `efbd99b7` (rebase onto glTF `38a29bb2` + FF; content byte-identical to `2db7425`). Branch stays the shared vehicle for `swm-webgpu-maps` (ADR-0054 WebGPU maps; their renderer files vs `38a29bb2` need conflict resolution at THEIR later merge — showcase paths unaffected).
- **Determinism hardening `286873e7`:** golden mode now pauses the lab BEFORE the realtime warm-up frames (`AbstractShowcase.start()` waits for a first painted frame whose real raf dt varies between captures — with paused=true those frames run `dt=0` and touch no system state/RNG). `_freezeForCapture()` re-pins `EMISSION_SEED` RNG + resets all accumulators. Verified: **two independent GL2 capture runs → all 5 pool PNGs byte-identical (sha256)**; official `compare.js` reports `5/5 cells 0.0000% diff (threshold 0.5%)`.
- **Baseline committed under `.agents/goldens/part46/baseline/`** (5 cells, 1280×720, 60 frames, pool keys `part46-<variant>-<pool>`; convention mirrors fire45/pbr38/fog39/st43). Captured on main tip `286873e7`.
- **Visual review (vision-bridge + pixel-component analysis):** variant isolation verified per pool — forge: sparks/embers only; smoke: smoke only; trails: sparks + connected ribbon (dominant 664-block orange component, NOT degenerate; overview shows the full curved arc); weather: rain + splashes only; overview: multi-lane. No blank/broken frames.
- **Caveats (honest):** (1) baseline was captured on main tip **with glTF's in-progress uncommitted WIP in the sources** (`QualityConfigResolver`, `AbstractRenderer`, `EngineOptions`, `PlanarReflectionNode`, showcases 10/15/16/30) — re-verify the baseline after their work lands, then re-capture if output differs. (2) Composition note: the `closeup` camera targets the anvil (`y 0.55`), but the trails lane's ribbon band flies high (`y 2.5–6`) → `part46-trails-closeup` frames only the ribbon's upper edge. Functional and deterministic, but aesthetically suboptimal — candidate for a future per-variant camera refactor (follow-up, not a defect). (3) `gpu` variant + `part46`-goldens run WEB_GL2 only (Match fire45 convention); WebGPU is informational.

---

## 2026-11-01 (2) — Per-variant camera for `trails` + baseline re-verification

- **State change discovered:** the formerly-uncommitted renderer WIP that was in the tree during the first baseline capture is now **committed on origin/main as `b809efbd`** ("The best is the enemy of the good.") — PlanarReflection mirror-pass resolution scaling (QualityConfigResolver/PlanarReflectionNode/EngineOptions/AbstractRenderer/showcases 10/15/16/30). It was already carried to origin by the baseline push `a400da42`.
- **Baseline re-verification (item 1):** fresh capture against the committed tree vs the committed baseline → **4/5 pools byte-identical (0.0000 %)**, only `trails-closeup` differs (expected, camera change). This confirms b809efbd does NOT alter showcase-46 rendering; the earlier "uncommitted WIP" caveat is resolved.
- **Per-variant camera (item 3, approved):** `Variants.ts` gains `CAMERA_OVERRIDES` + `cameraFor(variantId, pool)` — a variant owns its composed framing; the trails variant overrides the `closeup` pool with a tight burst-corridor framing (`position [0,1.0,2.3]`, `target [0,2.3,0]`). `showcase.ts` `_applyCameraPool` resolves via `cameraFor`; the `_applySettings` gate now keyed on `variant|pool` (was pool-only) so a variant switch re-frames even with a fixed pool. Base pools untouched for all other combinations.
- **Correction of earlier measurement note:** the ribbon corridor is **world y ~1.5–3.5** (not 2.5–6 — that estimate misread the previous top-clipped capture). Iterated framing 1→2→3 (measured: bbox span 44.3% → 51.1% → 56.7 % frame height; centroid y 485 → 349 → 366; no edge clipping in any final candidate). Locked framing3: centered, tight closeup, no clip.
- **Baseline re-captured** `.agents/goldens/part46/baseline/` (5 cells). Official independent second capture → **5/5 byte-identical (0.0000 %)**. Determinism re-confirmed over 4 independent runs.
- **Caveats (honest, rendering-level, OUT of camera scope):** (1) ribbon renders as flat segmented quads with visible facets — tessellation/presentation follow-up, applies to every variant; (2) no bloom/emissive glow in golden mode — consistent post config for the whole lab, not a framing issue; (3) vision-bridge models under-report dark-scene fill (said "5-10 %" while pixel metrics measure 56.7 % frame-height span) — pixel analysis is ground truth for composition.

- 2026-11-02 review fix: `destroy()` unregisters the GPU particle system via `WebGPURenderer.unregisterGpuParticleSystem` (which also disposes it; non-WebGPU path disposes directly). `Hud.dispose()` also removes its `<style>`. `Hud` calls `_onChange()` before `sync()` so the HUD shows the variant after the gpu->forge fallback. `_emitSparkBurst` reuses scratch `_burstOptions` (no per-spark allocation; RNG call order unchanged, golden-safe).


## Translated user-facing strings

Translated user-facing strings to English.

- 2026-11-02 fix: `resolveVariant("toString")` no longer returns an `Object.prototype` member (lookup via `find`). Tests: `46/tests/Variants.test.ts`.

### 2026-11-02 — GoldenCapture on shared base
- `GoldenCapture.ts` now delegates query parsing, surface pinning, resize handler, ready signal, frame stepping and repaint to `apps/showcases/shared/GoldenCapture.ts` (`GoldenSession`, `parseGoldenSpec`, `lookupOwn`); only the showcase-specific mapping/hooks stay here. Public API (`GoldenCapture`, `parseGoldenSpec`, options) unchanged, `showcase.ts` untouched.
- Pool-key lookups are prototype-safe (`__golden=constructor` -> `Unknown __golden pool` in `meta.error`, no TypeError).
- Byte-stability verified: pre/post gl2 captures pixel-identical (see `apps/showcases/tests/GoldenCapture.test.ts` for parser/session tests).
