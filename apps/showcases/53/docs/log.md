# Showcase 53 – Fortress Inquisitorius – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-16 — Initial build (collaborate `fortress-inquisitorius-impl`)

- **Architecture & Geometry (`public/assets/showcases/53/models/`):**
  - Multi-part beveled `fortress.glb` (3,476 tris, `y = -6..52.8 m`, metric world-space UVs) split across `BastionBase`, `BastionRock` (18 multi-tiered volcanic basalt crags), `MainWedge`, `TrimFins` (forward prow spine starting cleanly above the front hangar lintel at `y = 17.3 m`), `WindowBand`, `CommandCrown` (widened canyon & sharpened visor), `BridgeVisor`, and `HangarGlow` (flush/proud front and flank forcefield portals).
  - Modular instanced props (`landing_pad.glb` 228 tris, `turbolaser.glb` 224 tris, `imperial_shuttle.glb` 1,016 tris) arranged part-major for ADR 0046 auto-instancing (Tripo3D API key verified `HTTP 200`, `balance: 0`, so modular TS-baked GLBs serve as the clean primary prop set).
- **Textures & Storm IBL (`public/assets/showcases/53/textures/`, `ibl/`):**
  - 2K CC0 PBR sets converted to WebP (`-lossless` for data maps, `-q 90` for albedo): 2K staggered rectilinear Imperial durasteel hull plates + recessed louvers + beveled seams composited over ambientCG `Metal046B` (`armor_*`), `Metal046B` (`trim_*`), Poly Haven `dark_rock_02` (`rock_*`), plus sharp `1024×1024` imperial slit window trim (`window_*`).
  - Dark stormy ocean IBL baked via `swm ibl` (`brdf_lut.webp`, `env.webp`, `irradiance.webp`, `prefilter/mip0..4.webp`).
- **Materials & Ocean (`apps/showcases/53/FortressMaterials.ts`, `showcase.ts`):**
  - Showcase-local 3-tier `CustomShaderMaterial` (`StandardWebGPULayout`) wrapping `Standard.frag.{wgsl,glsl,glsl100}` for animated wave-lap waterline wetness (`y = 0..4 m`, darker wet albedo + `roughness 0.06..0.12`), preserving `GlobalUniforms` & ADR 0047.
  - `OpenWaterMaterial` (`720 m` grid at `240` segments, Nyquist-safe Gerstner wavelengths `[46, 27, 16] m`) + `PlanarReflectionNode` (`clipPlaneOffset: -0.25`, `poolHalfExtent: 0`, deep `NurSeaBed` at `y = -14 m` for finite `OpaqueCapture` depth) reflecting the dark sky, fortress wedge, and crimson hangar emissives across all 3 tiers (`WEB_GPU`, `WEB_GL2`, `WEB_GL1`).
  - Post-processing: `HbaoElement`, `BloomElement` (`threshold: 1.0`), `VolumetricFogElement`, and `ToneMappingElement` (`AgX`).
- **Controls & QA:** `1–4` camera presets, `L` atmosphere cycle (`storm`, `twilight`, `redAlert`), `R` reset, closed-by-default drawer (`I` / `⚙`), `window.__qaSwm53` hook. Verified via `verifyLodGlb`, `lint:glsl`, `lint:wgsl`, `check:doctrine`, and `check-showcases.js 53` across `WEB_GL1`, `WEB_GL2`, and `WEB_GPU` (`0` errors, `7/7` multi-angle screenshots inspected).

## 2026-11-16 — Blender 5.3 Geometry Nodes & Boolean Architecture Upgrade

- **Native Blender 5.3.0 Geometry Nodes & Hard-Surface Rebuild (`fortress.glb`, `landing_pad.glb`, `turbolaser.glb`, `imperial_shuttle.glb`):**
  - Replaced the baseline TS-baked GLBs with a deterministic headless Blender 5.3.0 (`bpy` / `bmesh`) pipeline (`.agents/scratches/fortress-prep/build_fortress_blender.py`) preserving all `showcase.ts` node contracts (`BastionBase`, `BastionRock`, `MainWedge`, `TrimFins`, `WindowBand`, `CommandCrown`, `BridgeVisor`, `HangarGlow`, plus modular prop nodes).
  - **Procedural 3D Armor Panels & Dual-Mesh Greebles:** Applied native Geometry Nodes modifier chains (`Subdivide Mesh -> Split Edges -> Scale Elements -> Extrude Mesh` 2-tier hull cladding on `BastionBase`, `MainWedge`, and `CommandCrown`; plus `Subdivide Mesh -> Dual Mesh -> Split Edges -> Scale Elements -> Extrude Mesh` mechanical louver greebles on `TrimFins`) with 1-segment `Bevel`, `WeightedNormal` (`keep_sharp=True`), and metric world-space tri-planar UVs (`16,518` tris for `fortress.glb`, `~31,660` scene tris).
  - **Boolean Deep Hangars, Hooded Bridge Mullions & Dock Anchoring:** Carved `MainWedge` front and flank hangar caverns via `EXACT` Boolean difference with interior `TrimFins` ceiling gantry trusses and recessed `HangarGlow` shields; added hooded `TrimFins` vertical bridge mullions in front of `BridgeVisor`, a forward armored causeway pier anchoring the front `landing_pad.glb`, and a broad tri-wing swept `imperial_shuttle.glb`.
  - **Verified:** `verifyLodGlb` + `GltfBinaryParser` (`1` primitive per mesh, required `POSITION`/`NORMAL`/`TEXCOORD_0`), `npm run build:showcases`, `check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`, `firstPassFailures=0`), and `7/7` multi-angle screenshots inspected with `0` console/page/WebGPU errors.

## 2026-11-16 — Canonical Obelisk & Mid-Height Through-Flight Hangar Deck Rebuild

- **Architecture & Blender 5.3 Pipeline (`fortress.glb` 22,126 tris, `~35,262` scene tris):**
  - Rebuilt Fortress Inquisitorius to the canonical *Obi-Wan Kenobi* Part IV / Alex Nice monolith silhouette (`y = -8..76 m` / `76 m` above waterline): continuous tapered obsidian-durasteel lower obelisk (`BastionBase`) with Boolean-carved vertical front notch (`GN_NotchMachinery` dual-mesh mechanical louvers), cantilevered mid-height through-flight shelf (`FlightDeck` at `y = 30.15..30.80 m`) notched at front center, central basalt-and-pilaster hangar core spine (`BastionRock` sculpted bay walls + `TrimFins` steel pilasters and blast doors), and a cleanly separated twin-blade apex (`CommandCrown` lofted solid blades at `y = 58..76 m` above `MainWedge` sequential non-coplanar Boolean clefts).
  - Suspended `10` hexagonal-wing TIE/ln fighter silhouettes from ceiling gantry trusses (`y = 38.45 m`) under the upper overhang, framed by razor-thin cool vertical pilaster LEDs (`HangarLights`, emissive `1.65`), crimson bridge slit & perimeter warning beacons (`BridgeVisor`), and blast-door trims (`HangarGlow`).
- **Showcase Scene, Materials & Framing (`apps/showcases/53/showcase.ts`):**
  - Wired `FlightDeck` (`deckMat`, `roughness: 0.22`) and `HangarLights` (`coolLightMat`), darkened `armorMat` to matte obsidian-durasteel, deepened `OpenWaterMaterial` storm ocean tint, added overhead cyan hangar deck `PointLight`s (`_deckLights`) alongside crimson spine lights (`_hangarLights`), relocated the sentry `landing_pad` to the sea-level port pier (`-25.5, 2.32, 10.5`), moved `2` landed *Lambda* shuttles onto `FlightDeck` (`y = 30.8`), and positioned the hovering approach shuttle cleanly in the starboard-aft corridor (`28.0, 33.4, -8.5`).
  - Refined `CAMERA_VIEWS` (`wide`, `crown`, `hangar`, `waterline`) so the `76 m` pinnacle and open twin-blade sky cleft have clean headroom below the HUD title banner.
- **Verified:** `npm run typecheck`, `npm run lint`, `npm run check:doctrine`, `npm run build:showcases`, `check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`, `firstPassFailures=0`), and `7/7` multi-angle screenshots inspected with `0` console/page/WebGPU errors.

## 2026-11-17 — Turbulent Storm Ocean & Obsidian Contrast Upgrade

- **Animation, Planar Reflection & Near-Field Mesh Density (`apps/showcases/53/showcase.ts`):**
  - Wired `this._oceanMaterial.time = this._elapsed` and `this._reflection?.updateReflection(this.scene, this.camera, this.renderer)` inside `update()` so Gerstner swells animate and `PlanarReflectionNode` renders live reflections of the fortress and crimson hangar glow instead of sampling an uninitialized target.
  - Applied a non-linear radial warp (`0.28 * n + 0.72 * n^3`) to the `240×240` `Ground` (`820 m`), concentrating `~0.95 m` vertex resolution around the fortress and camera corridor while remaining within WebGL1 `Uint16` vertex limits (`<= 65,535` vertices), and lowered `NurSeaBed` to `y = -18 m`.
- **Showcase-Local Storm Ocean Shader (`apps/showcases/53/FortressMaterials.ts`, `NurStormOceanMaterial`):**
  - Extended `OpenWaterMaterial` across all 3 tiers (`wgsl`, `glsl300`, `glsl100`) strictly within `apps/showcases/53/` (ADR 0047): replaced orthogonal 6-wave crests with an 8-wave incommensurate wind spectrum (`[44.0, 27.3, 16.9, 11.6, 7.9, 5.4, 3.8, 2.6] m`), added 4-octave distance-attenuated procedural chop normal perturbation for crisp wavelet reflections and dual-lobe moonlight glints, added cold petrol-teal crest subsurface scattering, replaced uniform crest whitecaps with gust-gated wispy foam webs plus wind-sheared spindrift streaks, and removed shallow-pool caustics so WebGL1 renders deep abyssal storm water cleanly.
- **Atmosphere & Volumetric Fog Balance (`apps/showcases/53/showcase.ts`):**
  - Angled `storm.moonDirection` to grazing port moonlight `(-0.62, -0.50, -0.26)` and tuned `VolumetricFogElement` (`density: 0.0018`, `heightFalloff: 0.036`, `asymmetry: 0.22`, `ambientInject: 0.08`) so sea mist hugs the churning swells while keeping the obsidian obelisk jet-black and crisp.
- **Verified:** `npm run typecheck`, `npm run lint`, `npm run check:doctrine`, `npm run build:showcases`, and `check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`), with `WEB_GPU`, `WEB_GL2`, and `WEB_GL1` screenshots visually inspected (`0` errors).

