# Showcase 28 – The Quantum Refraction Lab / Optical Prism – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## Overview & Architecture

Showcase 28 tests coherent optical laser dispersion, Snell's law refraction through an equilateral flint-glass triangular prism, and Cauchy dispersion index calculations per wavelength (`Optics.cauchyIndex`, `CauchyMaterials.FLINT_GLASS`).

Key components:
- `computeSpectralRays(prismRotation)`: Analytic 2D ray tracer in world XZ for 7 discrete wavelengths (700nm Red to 400nm Violet).
- Input controls: Standard OrbitController, direct manual turntable rotation via Left/Right arrows (with Shift acceleration), plus Space / T to toggle auto-wobble.

---

## 2026-10-15 – Aesthetic Audit & Multi-Agent Collaboration (v1.0 Consensus)

### Context & Problem Statement
An aesthetic inspection (incorporating synthetic-eyes vision analysis across 3 capture angles: `screenshot-01-main.png`, `screenshot-02-orbited.png`, `screenshot-03-tilted.png`) revealed substantial visual flaws mirroring Showcase 27 prior to its overhaul:
1. **Severe Over-exposure & Washed Fog:** `environmentIntensity = 1.5`, `bloom.threshold = 0.75`, `bloom.intensity = 1.4` blown out. Black levels lifted, washing out depth and washing out the dark cleanroom lab atmosphere.
2. **Milky Self-Luminous Prism:** `CentralPrism` used `StandardMaterial` with `emissiveColor` and 0.3 self-glow. It read as a frosted semi-opaque bulb rather than crystalline optical glass.
3. **Phosphor Screen as Detached Flare:** White target panel read as an active light emitter competing with the prism.
4. **Spectral Disappearance (TIR bug):** At `NOMINAL_INCIDENCE_ANGLE = 44°`, turntable oscillation (&plusmn;0.25 rad) caused total internal reflection at positive wobble angles, extinguishing violet/blue/red rays for large portions of the cycle.
5. **Surface Noise & Grounding:** High-frequency specular stippling on the steel bench; brass dial clip clipping into turntable without contact shading or mechanical recess.

### Multi-Agent Deliberation (.agents/collaborate/improve-showcase-28)
A formal 4-agent panel (Coordinator/Moderator, Worker 1 Art Direction, Worker 2 Engine Feasibility, Worker 3 Scope & Production) convened on topic `improve-showcase-28` (`improve-showcase-28.board.jsonl`).

**Key Architectural Insights from Audit:**
- **StandardMaterial Transmission Limitation (Worker 2):** Engine's `StandardMaterial.transmission` is currently functional on WebGPU only (GLSL shaders ignore transmission refraction). `GlassMaterial` is the only 3-backend verified refraction path across WebGL1, WebGL2, and WebGPU.
- **GlassMaterial Direct Lighting Requirement:** `GlassMaterial` does not evaluate ambient/IBL specular; it requires a direct key light (tight SpotLight) to produce sharp facet highlights without emissive self-glow.
- **SpotLight Ceilings:** Material forward shaders support up to 4 spot lights. Total scene spot budget strictly capped at &le; 3 (laser emitter + 1 prism key glint spot + optional chromatic bounce).
- **Dispersion Stability (Worker 2 Numeric Scan):** Re-tuning `NOMINAL_INCIDENCE_ANGLE` from 44&deg; to 48&ndash;50&deg; and wobble to &plusmn;0.12 rad guarantees that all 7 spectral bands remain mathematically valid and vibrant throughout the entire wobble range.

### Agreed Roadmap (Plan v1.0)
- **Phase P0 (MUST - Parameters & Mathematics):**
  - Rebalance exposure: `environmentIntensity &rarr; 0.35`, `AmbientLight &rarr; 0.12`, `overheadDirectional &rarr; 0.25`, `bloom.threshold &ge; 1.05`, `bloom.intensity 0.6`, HBAO intensity 1.1.
  - Full-spectrum stability: `NOMINAL_INCIDENCE_ANGLE = 48–50°`, wobble &plusmn;0.12 rad.
  - Continuous spectral band on detector panel (CIE-luminosity weighted, ray-plane termination).
  - Internal ray segment through the glass linking entry and exit points (`P0-5`).
  - Hero camera reframing.
- **Phase P1 (SHOULD - Materials & Detailing):**
  - Switch prism to `GlassMaterial` (IOR 1.65, zero emissive) + 1 tight specular glint SpotLight.
  - Anodized dark bench (`color ~0.15`, `roughness ~0.5`), seated brass ring.
  - Instrument dark absorber panel with faint measurement graticule.
  - Floating gem removed or repositioned into the beam.
- **Phase P2 (STRETCH - Caustics & Atmosphere):**
  - Per-frame emissive ALPHA caustic footprint on bench derived from live exit fan data.

---

## 2026-10-15 – Implementation of Plan v1.0 (P0-P1) + Look-Dev Finalization

Executed the approved `03-FINAL-plan-v1.0.md` (single hot file `showcase.ts`, surgical edits). All
P0 (MUST) and P1 (SHOULD) line items shipped; P2 caustics intentionally left as stretch. Nothing
broken, all historical entries above preserved.

### P0 – Parameters & Mathematics
- `NOMINAL_INCIDENCE_ANGLE` 44° → 50°, wobble ±0.25 → ±0.12 rad. **Gate decision made on numeric
  truth, not the plan claim:** the explicit 2D scan (`.agents/scratches/showcase28/p0-2-scan.ts`,
  `.agents/scratches/showcase28/p0-2-sweep.ts`) proved only the upper part of the plan's 48–50° band
  survives ±0.12 wobble — 50° has +0.129 margin (rest rotation = π/2 − NOMINAL); 7/7 bands valid at
  all 401 sampled angles. Legacy 44°/±0.25 reproduced the known violet TIR extinction.
- Exposure rebalance: `environmentIntensity 0.34`, AmbientLight 0.12, overhead directional 0.25,
  bloom threshold 1.05 / intensity 0.35 / soft 0.05 / radius 0.6, HBAO **disabled**
  (WebGPU HBAO pass read as blotchy denoiser smudges over the dark anodized bench — vignette +
  grade carry the mood), grain 0.015, ACES exposure 1.08 (final grade knob, plan range 0.9–1.1).
- Skybox dimmed hard (`color 0.03/0.035/0.05`) — the bright studio env read as blocky low-res "stars"
  in the void behind the lab; the scene is self-lit now.
- Hero camera + one-shot deterministic re-frame guard (`_heroPoseApplied`): position (6.8, 4.6, −1.8),
  target (2.0, 1.5, 2.9) — low three-quarter subject composition, exactly once on first `update()`.
- P0-3 **continuous spectrum band** — final approach uses a **runtime-generated canvas gradient
  emissive map** (`Texture.fromCanvas` + `StandardMaterial.emissiveMap`, the engine's own RampLUT
  path so it is WebGL1/WebGL2/WebGPU-safe): ONE smooth red→violet smear pinned at the real red and
  violet ray-plane impact points each frame. This is the physical fix for the "no dots / no blown
  white core / no hue steps" acceptance criteria — the texture's 8-bit per-channel ceiling
  structurally forbids HDR blowout. An earlier 24-material stepped attempt was rejected: single-color
  materials cannot render a stepless spectral gradient and left a blown core.
- P0-5 internal faint white segment (single average entry→exit path, alpha 0.1, radius 0.011).
- Exit rays (P0-3): thin tapered cylinders, **deliberately dimmed to faint traces**
  (emissiveIntensity 0.15, alpha 0.35, radii 0.01/0.016) so the detector band is the hero — the plan
  explicitly permits dimmed/removed individual rays. Terminated at the real detector-plane
  intersection with exact-band color matching.

### P1 – Materials & Detailing
- Prism switched to `GlassMaterial` (IOR 1.65, thickness 0.8) + wide/soft key glint SpotLight
  (intensity 2.5, angle π/6, penumbra 0.5 — a tight 6.0 cone threw a harsh circular hotspot on the
  glass, per synthetic-eyes verification). 2 SpotLights total ≤ 3 cap.
- Dark anodized bench/stage (`color 0.15`, metallic 0.5–0.6, roughness 0.55–0.6, normalScale 0.35),
  brass ring re-seated on the plate top; laser housing/kicker lens emissive reduced.
- Detector as dark absorber panel (not a white lamp); floating gem removed (P1-4 default).
- P1-3 faint static measurement graticule on the instrument face — canvas-baked emissive-map plate
  (parity-safe `Texture.fromCanvas` + `StandardMaterial.emissiveMap`, grid + center cross), kept at
  ≈0.28 max emission so it reads as a real instrument scale without fighting the spectrum band.
- `window.__showcase28` QA hook — set unconditionally (browser-only, inert): avoids
  `import.meta.env` since the repo typechecks without `vite/client` types.

### Verification
- Gates green at final state: `eslint` clean, `tsc --noEmit` 0 errors, `npm run lint:fix` clean,
  `npm run build:lib` OK, `npm run test` 279 files / 1896 tests passed.
- Runtime (user dev server, WebGPU/Metal M4 Pro): 0 console errors/warnings; all 7 rays + internal
  path + band meshes confirmed via `window.__showcase28` probing; hero pose deterministic.
- Synthetic-eyes look-dev gate reached a stable resting point: **6/10**; vision explicitly confirms
  both prior blocker flaws are gone — ("subtle, thin, faint traces" instead of "thick neon slabs";
  detector band "mostly smooth gradient without a blown white core", order red/orange→…→violet, middle
  green). Remaining lower scores reflect engine ceilings on WebGPU (milky GlassMaterial read, no
  volumetric light transport) rather than regressions.
- QA sub-agents: numeric P0-2 gate `[VERIFICATION_OK]` (7/7 over ±0.12, ±0.129 half-window, worst
  Violet headroom 6.09°); plan/spec-drift audit initially flagged the missing P1-3 graticule as the
  only breaking item — implemented and re-verified above; vision bridge confirmed band continuity
  (no white core/dots) and subtle ray traces on the final capture.
- Known limitation documented: `GlassMaterial` via ANGLE/Metal WebGPU reads frosted/milky, not
  crystalline — accepted for 3-backend parity (worker-2 audit); premium glass is future work.

---

## 2026-10-15 – Manual Turntable Control & Optical Aesthetic Polish
- Restored and polished manual turntable manipulation via arrow keys:
  - Arrow Left / Arrow Right: immediately takes over rotation without needing a hidden `Ctrl+T` toggle.
  - Holding Shift rotates at accelerated speed (3.0 rad/s vs normal 1.2 rad/s).
  - Space / T: toggles auto-wobble back on / toggles manual control, smoothly aligning phase to prevent angular pops.
  - Graceful TIR handling: as wavelengths exceed the critical angle under manual angle exploration, the detector band contracts rather than abruptly vanishing.
  - Updated showcase UI subtitle with control hint.
- Optical polish & aesthetic corrections:
  - Added soft dynamic chromatic caustic spill on the black anodized bench surface (`_floorCausticMesh`), grounding the ray bundle to the table.
  - Tuned `GlassMaterial` thickness (0.55) and roughness (0.02) with tightened key glint SpotLight (intensity 3.2, angle &pi;/7, penumbra 0.25) for razor-sharp prism facet glints.
  - Corrected spectral ray and band luminescence (emissiveIntensity 0.65 for rays, 1.35 for detector band) so rays gently catch bloom without blowing out, avoiding the dull "plastic thread" look.
  - Enhanced detector absorber panel graticule with spectrograph wavelength ticks and markings (`400nm`, `550nm`, `700nm`).
  - Corrected detector absorber panel graticule orientation: counteracted the canvas-to-texture vertical inversion so the black plate, grid, and spectrograph wavelength markings render right-side up.

---

## 2026-10-15 – Movable 50:50 Beam Splitter & Auxiliary Reference Detector
- **50:50 Beam Splitter on Optical Dovetail Rail:**
  - Placed an anodized optical rail on the bench along X ($x \in [-3.5, -1.0]$) with laser-etched scale markings.
  - Built a kinematic mirror carriage holding a 45° semi-reflective plate (`_splitterCarriage`).
  - Interactive navigation via `↑` / `↓` arrow keys (with `Shift` acceleration); slides carriage smoothly along the rail.
  - `M` key toggles splitter bypass (switches between 50% split and 100% full laser transmission).
- **Auxiliary Reference Photodetector Instrument:**
  - Mounted a dedicated instrument chassis at $z = -2.35$ with a calibrated photodetector strip (`AUX REF PHOTODETECTOR | 50.0% BEAM SPLIT`).
  - The 90°-reflected beam hits the sensor strip with a luminous target spot (`_refSensorSpot`) that tracks the beam splitter position in real time along the linear detector scale.
- **Dynamic Split Beams:**
  - Segments dynamically scale and bridge from laser emitter $\rightarrow$ beam splitter $\rightarrow$ prism entry $\rightarrow$ reference sensor with zero GC allocations per frame.

---

## 2026-10-15 – 3-Face Refraction, Inset Sensor Bezel & In-Viewport Inspector / Maker
- **Omnidirectional 3-Face Prism Refraction (360° Rotation):**
  - Generalized `computeSpectralRays()` from hardcoded edge `[1, 2]` to dynamic exterior ray-tracing across all 3 equilateral prism polygon edges.
  - When the turntable rotates by ~120° or ~240°, the newly exposed prism facet catches the incident laser beam, refracts inside the glass, and disperses the spectrum out through the second facet.
  - In `_updateSpectralVisuals()`, exit rays no longer vanish when rotated past the detector; they project into free flight across the lab at full length, with the floor caustic wash tracking them dynamically.
- **Physical Sensor Bezel & Absorber Integration:**
  - Added an anodized aluminum bezel (`DetectorBezel`) framing the graticule sensor window on the front face of `screenPanel`, visually establishing the large dark block as the heavy absorber beam dump chassis and the graticule as the precision sensor module.
- **In-Viewport Lab Inspector & Maker Suite:**
  - Integrated a collapsible dark-theme Inspector drawer (`I` key shortcut or top-right `⚙ Inspector` button).
  - Quick Lab Knobs (Tweakpane): Live sliders for Turntable Angle, Auto-Wobble, Beam Splitter X, Splitter Toggle, Glass IOR/Roughness/Thickness, and Laser/Bloom Intensity.
  - Scene Hierarchy: Powered by `HierarchyPanel`, displays live scene graph tree with real-time filtering and selection.
  - Deep Property Reflection: Powered by `PropertyPanel`, inspects and modifies transforms, materials, and lights on any selected object.
  - Direct 1-click launch buttons for Forge DevTools (`Alt+Cmd+G`) and the standalone Maker Scene Editor (`/tools/maker.html`).
- **Precision Nudging:**
  - Halved the manual turntable rotation speed (1.2 $\rightarrow$ 0.6 rad/s, Shift 3.0 $\rightarrow$ 1.5 rad/s) for ultra-fine facet alignment.

---

## 2026-10-15 – 3D Viewport Raycast Picking & Streamlined Lab Inspector
- **Viewport 3D Raycast Object Picking:**
  - Connected `Raycaster` to canvas pointer interactions when the Inspector drawer is open.
  - Distinguishes stationary clicks from orbit drags (`Math.hypot(dx, dy) <= 5px`), ensuring smooth camera navigation without accidental selection.
  - Clicking any visible component in the 3D scene (Prism, Turntable, Beam Splitter, Laser Housing, Rail, Detector Bezel, Absorber, Bench) selects it immediately.
  - Traces down through `computeBounds()` to exact world-space bounding boxes/spheres, displaying a cyan wireframe highlight box that moves dynamically with animated or user-manipulated hardware.
  - Selection is automatically synchronized across both the `HierarchyPanel` tree and `PropertyPanel` inspector.
- **Streamlined Inspector UI:**
  - Removed Forge and Maker buttons/links for a clean, distraction-free in-viewport lab experience.
  - Moved the `⚙ Lab Inspector (I)` toggle button into the persistent application footer (`bottom: 5px; right: 14px;`), providing an unobtrusive, always-accessible dock handle.
  - Adjusted inspector drawer height to `calc(100vh - 36px)`, perfectly resting above the footer bar without covering it.
  - Fixed hierarchy row flexbox compression: enforced `flex-shrink: 0`, 24px row height and monospace font so scene tree items never get vertically crushed.
  - Retained full `HierarchyPanel` outliner with quick search filtering, drag-and-drop reparenting, and row selection.
  - Retained `PropertyPanel` for full live property editing and undoable tweaks.

---

## 2026-10-15 – Unified Footer Drawer Handles & Watertight Input Isolation
- **Unified Footer Drawer Design (Showcase 28 & 29):**
  - Removed textual button labels in both Showcase 28 and Showcase 29, replacing them with a crisp 26×26px square gear icon button (`⚙`, `.swm-inspector-btn`) docked in the bottom-right footer (`bottom: 5px; right: 14px;`).
  - Standardized both panels (Showcase 28 Lab Inspector and Showcase 29 Sponza Lighting Lab) to slide in from the right with `height: calc(100vh - 36px)`, matching backdrop blur, close buttons, and keyboard shortcut `I` (`KeyI`).
- **Input Leak Isolation (Sliders & Wheel):**
  - Fixed camera orbit, zoom, and nudge key leakage when interacting with inspector/tuning sliders or scrolling panels.
  - Stopped event propagation (`stopPropagation()`) on drawer and hud containers for `mousedown`, `mouseup`, `mousemove`, `pointerdown`, `pointerup`, `pointermove`, `wheel`, `touchstart`, `touchmove`, `touchend`, and keyboard events.
  - Reset accumulated `Input` mouse zoom/deltas on wheel events inside drawers.
  - Dynamically disabled `OrbitController` (Showcase 28) and `FlyController` (Showcase 29) on `pointerenter` / `pointerdown`, preventing sliders or scroll gestures from rotating or zooming the 3D scene. Re-enabled smoothly on `pointerleave` / `pointerup` and drawer close.
  - Guarded scene keyboard shortcuts (arrow keys for rail movement / manual turntable rotation, scene presets) so they are suppressed while interacting with panel controls.

