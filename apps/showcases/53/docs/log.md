# Showcase 53 – Dark Fortress – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-16 — Initial build (collaborate `dark-fortress-impl`)

- **Architecture & Geometry (`public/assets/showcases/53/models/`):**
  - Multi-part beveled `fortress.glb` (3,476 tris, `y = -6..52.8 m`, metric world-space UVs) split across `BastionBase`, `BastionRock` (18 multi-tiered volcanic basalt crags), `MainWedge`, `TrimFins` (forward prow spine starting cleanly above the front hangar lintel at `y = 17.3 m`), `WindowBand`, `CommandCrown` (widened canyon & sharpened visor), `BridgeVisor`, and `HangarGlow` (flush/proud front and flank forcefield portals).
  - Modular instanced props (`landing_pad.glb` 228 tris, `turbolaser.glb` 224 tris, `imperial_shuttle.glb` 1,016 tris) arranged part-major for ADR 0046 auto-instancing (Tripo3D API key verified `HTTP 200`, `balance: 0`, so modular TS-baked GLBs serve as the clean primary prop set).
- **Textures & Storm IBL (`public/assets/showcases/53/textures/`, `ibl/`):**
  - 2K CC0 PBR sets converted to WebP (`-lossless` for data maps, `-q 90` for albedo): 2K staggered rectilinear Imperial durasteel hull plates + recessed louvers + beveled seams composited over ambientCG `Metal046B` (`armor_*`), `Metal046B` (`trim_*`), Poly Haven `dark_rock_02` (`rock_*`), plus sharp `1024×1024` imperial slit window trim (`window_*`).
  - Dark stormy ocean IBL baked via `swm ibl` (`brdf_lut.webp`, `env.webp`, `irradiance.webp`, `prefilter/mip0..4.webp`).
- **Materials & Ocean (`apps/showcases/53/FortressMaterials.ts`, `showcase.ts`):**
  - Showcase-local 3-tier `CustomShaderMaterial` (`StandardWebGPULayout`) wrapping `Standard.frag.{wgsl,glsl,glsl100}` for animated wave-lap waterline wetness (`y = 0..4 m`, darker wet albedo + `roughness 0.06..0.12`), preserving `GlobalUniforms` & ADR 0047.
  - `OpenWaterMaterial` (`720 m` grid at `240` segments, Nyquist-safe Gerstner wavelengths `[46, 27, 16] m`) + `PlanarReflectionNode` (`clipPlaneOffset: -0.25`, `poolHalfExtent: 0`, deep `WassermondSeaBed` at `y = -14 m` for finite `OpaqueCapture` depth) reflecting the dark sky, fortress wedge, and crimson hangar emissives across all 3 tiers (`WEB_GPU`, `WEB_GL2`, `WEB_GL1`).
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
  - Rebuilt Dark Fortress to the canonical _Obi-Wan Kenobi_ Part IV / Alex Nice monolith silhouette (`y = -8..76 m` / `76 m` above waterline): continuous tapered obsidian-durasteel lower obelisk (`BastionBase`) with Boolean-carved vertical front notch (`GN_NotchMachinery` dual-mesh mechanical louvers), cantilevered mid-height through-flight shelf (`FlightDeck` at `y = 30.15..30.80 m`) notched at front center, central basalt-and-pilaster hangar core spine (`BastionRock` sculpted bay walls + `TrimFins` steel pilasters and blast doors), and a cleanly separated twin-blade apex (`CommandCrown` lofted solid blades at `y = 58..76 m` above `MainWedge` sequential non-coplanar Boolean clefts).
  - Suspended `10` hexagonal-wing TIE/ln fighter silhouettes from ceiling gantry trusses (`y = 38.45 m`) under the upper overhang, framed by razor-thin cool vertical pilaster LEDs (`HangarLights`, emissive `1.65`), crimson bridge slit & perimeter warning beacons (`BridgeVisor`), and blast-door trims (`HangarGlow`).
- **Showcase Scene, Materials & Framing (`apps/showcases/53/showcase.ts`):**
  - Wired `FlightDeck` (`deckMat`, `roughness: 0.22`) and `HangarLights` (`coolLightMat`), darkened `armorMat` to matte obsidian-durasteel, deepened `OpenWaterMaterial` storm ocean tint, added overhead cyan hangar deck `PointLight`s (`_deckLights`) alongside crimson spine lights (`_hangarLights`), relocated the sentry `landing_pad` to the sea-level port pier (`-25.5, 2.32, 10.5`), moved `2` landed _Lambda_ shuttles onto `FlightDeck` (`y = 30.8`), and positioned the hovering approach shuttle cleanly in the starboard-aft corridor (`28.0, 33.4, -8.5`).
  - Refined `CAMERA_VIEWS` (`wide`, `crown`, `hangar`, `waterline`) so the `76 m` pinnacle and open twin-blade sky cleft have clean headroom below the HUD title banner.
- **Verified:** `npm run typecheck`, `npm run lint`, `npm run check:doctrine`, `npm run build:showcases`, `check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`, `firstPassFailures=0`), and `7/7` multi-angle screenshots inspected with `0` console/page/WebGPU errors.

## 2026-11-17 — Turbulent Storm Ocean & Obsidian Contrast Upgrade

- **Animation, Planar Reflection & Near-Field Mesh Density (`apps/showcases/53/showcase.ts`):**
  - Wired `this._oceanMaterial.time = this._elapsed` and `this._reflection?.updateReflection(this.scene, this.camera, this.renderer)` inside `update()` so Gerstner swells animate and `PlanarReflectionNode` renders live reflections of the fortress and crimson hangar glow instead of sampling an uninitialized target.
  - Applied a non-linear radial warp (`0.28 * n + 0.72 * n^3`) to the `240×240` `Ground` (`820 m`), concentrating `~0.95 m` vertex resolution around the fortress and camera corridor while remaining within WebGL1 `Uint16` vertex limits (`<= 65,535` vertices), and lowered `WassermondSeaBed` to `y = -18 m`.
- **Showcase-Local Storm Ocean Shader (`apps/showcases/53/FortressMaterials.ts`, `WassermondStormOceanMaterial`):**
  - Extended `OpenWaterMaterial` across all 3 tiers (`wgsl`, `glsl300`, `glsl100`) strictly within `apps/showcases/53/` (ADR 0047): replaced orthogonal 6-wave crests with an 8-wave incommensurate wind spectrum (`[44.0, 27.3, 16.9, 11.6, 7.9, 5.4, 3.8, 2.6] m`), added 4-octave distance-attenuated procedural chop normal perturbation for crisp wavelet reflections and dual-lobe moonlight glints, added cold petrol-teal crest subsurface scattering, replaced uniform crest whitecaps with gust-gated wispy foam webs plus wind-sheared spindrift streaks, and removed shallow-pool caustics so WebGL1 renders deep abyssal storm water cleanly.
- **Atmosphere & Volumetric Fog Balance (`apps/showcases/53/showcase.ts`):**
  - Angled `storm.moonDirection` to grazing port moonlight `(-0.62, -0.50, -0.26)` and tuned `VolumetricFogElement` (`density: 0.0018`, `heightFalloff: 0.036`, `asymmetry: 0.22`, `ambientInject: 0.08`) so sea mist hugs the churning swells while keeping the obsidian obelisk jet-black and crisp.
- **Verified:** `npm run typecheck`, `npm run lint`, `npm run check:doctrine`, `npm run build:showcases`, and `check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`), with `WEB_GPU`, `WEB_GL2`, and `WEB_GL1` screenshots visually inspected (`0` errors).

## 2026-11-18 — First-Class Open Ocean Subsystem Migration (ADR 0062)

- **Core Engine Open Ocean (`@small-world-machine/engine`, ADR 0062):**
  - Replaced the `820 m` warped `Ground` + showcase-local `WassermondStormOceanMaterial` patch with first-class `OceanGridGeometry` (`radius: 2400 m`, `160×192` concentric rings, `3.4` radial exponent, `380 m` near-field ring focus, `30,721` vertices within `Uint16` WebGL1 limits) and `OceanMaterial` (`MaterialType.OCEAN`).
  - Added dedicated opaque-ocean sub-phase `"main:ocean"` in both WebGPU (`MainRenderPass`) and WebGL (`WebGLMainPass`): opaque depth/color are captured right before Ocean draws and Ocean still writes wave depth & RG16F normals prior to decals, transparents, HBAO, and VolumetricFog.
  - Added deterministic seamless periodic `OceanWaveNormalGenerator` (3-layer world-XZ cascade), Tokuyoshi Specular AA (`specularAntiAliasing`), dual-lobe GGX moonlight glints, Schlick Fresnel IBL + smooth edge-faded `PlanarReflectionNode`, wave-crest backlight subsurface scattering, FBM whitecaps, and horizon-flush swell attenuation.
- **Showcase 53 Scene & Lighting (`apps/showcases/53/showcase.ts`, `FortressMaterials.ts`):**
  - Removed showcase-local `WassermondStormOceanMaterial`, `StormOceanOptions`, `WassermondSeaBed`, and shader-patching code from `FortressMaterials.ts`.
  - Increased `defaultFar` to `2800` and skybox size to `2600` so the `2400 m` ocean radial disc meets the stormy horizon cleanly with zero far-clip cutout.
  - Re-angled `ATMOSPHERES.*.moonDirection` to 3/4 backlight (`(0.38, -0.4, 0.83)`) so moonlight rakes across wave crests and creates a silver-blue glitter path across the water toward the camera.

## 2026-11-18 — Phase 2 Open Ocean Quality Upgrade (JONSWAP FFT, Moving Grid, Storm Rain & Sea Spray)

- **Camera-Tracked Ocean & WebGPU Compute JONSWAP 2D IFFT (`OceanFftSystem`, `OceanMaterial`, `Ocean.{vert,frag}.*`):**
  - Enabled camera-centered radial swell/horizon attenuation (`wp.xz - viewPos.xz`) across all 3 shader dialects paired with `OceanGridGeometry.snapToTarget(ocean, cam.x, cam.z, 8)` in Showcase 53 so the high-detail near-field mesh follows the roving camera smoothly over infinite ocean coordinates.
  - Added WebGPU compute `256×256` JONSWAP directional spectrum (`ocean_spectrum_init/step/ifft_pass/assemble.wgsl`, `ShaderFlag.OCEAN_FFT`) synthesizing periodic `rgba16float` displacement + slope/Jacobian/persistent-foam maps sampled at two incommensurate rotated octaves (`WEB_GPU`), with clean fallback on `WEB_GL2`/`WEB_GL1`.
- **Shoreline Surf, WebGL1 Horizon Continuity & Storm Atmosphere (`Ocean.frag.*`, `RainStreaks`, Showcase 53):**
  - Refined shoreline surf into broken, organic foaming tongues with open rocky contact gaps, shallow aeration, and receding foam wakes (`Ocean.frag.{wgsl,glsl}`).
  - Eliminated the dark outer horizon ring on `WEB_GL1` (`Ocean.frag.glsl100` post-fog `u_envMap` skybox blend + Showcase 53 `skyCube` `envMap` wiring on `WEB_GL1`).
  - Added wind-slanted storm `RainStreaks` (`followCameraY: true`) and a zero-alloc perimeter crashing **Sea-Spray Mist** (`ParticleSystem` + `ParticleMeshRenderer` + `SmokeSpriteMaterial` soft particles & 6-way volumetric lighting, excluded from `PlanarReflectionNode`).

## 2026-11-18 — Gischtkronen & Wellenbrecher: Foam Model Upgrade

- **Fragment foam model (`Ocean.frag.{wgsl,glsl,glsl100}`, ADR 0062 Phase 2b):**
  - Added `oceanFoamCells` (F1 Worley bubble lace, Worley 1996) → `foamLace`, and wind-streak modulation → `crestTexture`, so whitecaps read as streaky, wind-combed bubble lace instead of smooth blobs. Foam also gets an ambient fill term so shadowed foam stays white-ish.
  - Shoreline: sawtooth `borePhase`/`boreFront` bore front travelling toward the rock (sharp breaking leading edge, long receding-foam tail) plus an HDR `contactSplash` flash at rock contact (>1 so Bloom picks it up).
  - Tier differences: fold crest (`fftCrestAccum`/`foldCaps`, instantaneous Jacobian `nfA.z`) only on WebGPU; WebGL2 has lace + bore front + splash with analytic crest caps; WebGL1 gets the reduced lace/crest texture only (no shore/depth terms there, so no bore front or splash).
- **Tests & docs:** per-dialect shader-contract assertions in `OceanMaterial.test.ts`, new CPU-mirror `OceanFoamMath.test.ts` (bore front shape + travel direction, Worley F1 bounds), `REFERENCES.md` entries (Worley 1996; wind-streak/bore-front as original construction).

## 2026-11-18 — Phase 3 Open Ocean Buoyancy, Caustics, Rotor Downwash, Synchronized Wetness & Storm Lightning

1. **Zero-Allocation CPU Wave Sampling (`OceanMaterial.sampleWaveAt`):**
   - Added `OceanWaveSample` and `OceanMaterial.sampleWaveAt(worldX, worldZ, out, cameraX, cameraZ)` mirroring the 5-wave Gerstner dispersion, cross-wave group envelope, analytical surface normal, Jacobian pinch `crest`, and camera-centered horizon `swellFade` on the CPU with zero heap allocations.
   - Enables wave-coupled sea-spray emitter heights/normals and near-waterline camera clamping against live swells.
2. **Shallow-Water Dual-Worley Caustics (`Ocean.frag.{wgsl,glsl}`, `u_matParam9.w` = `causticsStrength`):**
   - Added wave-refracted dual-layer F1 Worley ridge caustics (`causticNet`) over submerged basalt crags and foundation shelves (`depthDiff < 12 m`) on `WEB_GPU` and `WEB_GL2`, modulated by Beer-Lambert `transmittance`, directional shadow `surfaceShadow`, and `(1 - fresnel)` (cleanly omitted on `WEB_GL1` where `u_opaqueDepthMap` is unavailable).
3. **Guarded Rotor / Repulsorlift Downwash (`Ocean.frag.{wgsl,glsl,glsl100}`, `u_matParam6`):**
   - Packed `[downwashCenter.x, downwashCenter.y, downwashRadius, downwashStrength]` into `u_matParam6` across all 3 dialects, guarded by `if (downwashRadius > 0.1 && downwashStrength > 0.001 && dwNorm < 1.0)` so outward-travelling concentric capillary ripples and an annular `downwashFoam` spindrift ring appear under the hovering approach _Lambda_ shuttle with zero cost when disabled.
4. **Synchronized Bore-Front Waterline Wetness (`apps/showcases/53/FortressMaterials.ts`):**
   - Coupled the 3-tier `CustomShaderMaterial` waterline wetness shader (`WGSL_WATERLINE_BLOCK` / `GLSL_WATERLINE_BLOCK`) to the ocean's `0.21 Hz` bore frequency (`borePhase = fract(time * 0.21 - spatialWave)`), driving an asymmetric `boreSurge` run-up, a glossy receding `drainFilm` (`roughness -> 0.04`), and an upper `saltBand` crust on `BastionBase` and `BastionRock`.
5. **Deterministic Storm Lightning & Tests (`apps/showcases/53/showcase.ts`, `OceanMaterial.test.ts`, ADR 0062):**
   - Added deterministic storm lightning pulses in `storm` atmosphere mode (briefly boosting `DirectionalLight` moonlight, `AmbientLight`, and `environmentIntensity` for dramatic silhouette & wave-crest flashes while keeping `t = 0` deterministic for golden snapshots) and extended `OceanMaterial.test.ts` to cover `sampleWaveAt`, `u_matParam6`/`u_matParam9` packing, cloning, and per-dialect `causticsStrength`/`causticNet`/`downwash*` shader contracts.

## 2026-11-18 — Showcase 53 Sweeping Searchlights, Basalt Trench Camera & Live Ocean HUD

- **Preset 5 — Basalt Trench Camera (`apps/showcases/53/showcase.ts`):**
  - Added `CAMERA_VIEWS.trench` (`position: (-22, 3.6, 36)`, `target: (-6, 1.8, 12)`) and bound `Digit5` in `onKeyDown` for inspecting shallow-water caustics and wave-coupled Imperial signal buoys.
- **Sweeping Imperial Searchlights (`SpotLight`):**
  - Mounted 2 shadowless `SpotLight`s on the port/starboard hangar wing edges (`(±13.5, 31.4, 9.5)`, `color: (0.75, 0.90, 1.0)`, `intensity: 280`, `distance: 155`, `angle: 0.24`, `penumbra: 0.65`, `decay: 1.4`) and swept their normalized `direction` vectors over the swells in `update()` with zero per-frame allocations.
- **Live Ocean & Storm Controls (`Hud` + `sceneParams` + `__qaSwm53`):**
  - Registered `waveScale`, `windSpeed`, `choppiness`, `caustics`, and `foamCoverage` with `this.sceneParams.addParam(...)`, wired all new `FortressHudActions` (`toggleSearchlights`, `triggerLightning`, and live ocean parameter setters) and `_state()` fields, and extended `QaSwm53Hook` with `setSearchlights`.

## 2026-11-18 — 1:1 Scale Closed _Obi-Wan Kenobi_ Basalt Obelisk, Hangar Interior & Concept Dossier (`1A/2A/3A`)

- **Architectural Decisions & Concept Dossier ([concept-dossier.html](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/docs/concept-dossier.html)):**
  - Documented the canonical 1:1 design decisions (`1A` closed _Obi-Wan Kenobi_ silhouette with zero upper spire split, `2A` monumental `485 m` scale anchored to `20.0 m` _Lambda_ shuttles and `8.82 m` TIE/ln fighters, `3A` `1.82 m` Space Trooper & deck prop scale anchors, plus outer Mustafar volcanic stone vs. interior Imperial durasteel separation).
- **Blender 5.3.0 Geometry Nodes & 1:1 Modular GLB Rebuild ([build_fortress_blender.py](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/.agents/scratches/fortress-prep/build_fortress_blender.py)):**
  - Rebuilt `fortress.glb` (`36,918` tris, `y = -45..485 m`, `248 m` waterline base width, `35 m` truncated flat summit with subtle comms/sensor pads, `180 m` waist + `252 m` wing aprons, `24.0 m` clear hangar height `y = 116..140 m`): replaced outer geometric cladding plates with 3D Geometry Nodes horizontal basalt strata (`GN_LowerVolcanicBasalt`, `GN_MidVolcanicBasalt`, `GN_TopVolcanicBasalt`, `GN_HangarRockStrata`), isolated Boolean notch subtractions (`LowerNotchCut`, `DeckFrontNotch`) before joining wing aprons/causeways so all meshes stay manifold, and removed the unused outer `WindowBand`.
  - Built full hangar details: `3.5 m`-module `FlightDeck` (`armor_*` UV `1/14.0 m`), `0.95 m` perimeter barriers & exterior catwalk ribs, curved-base pilasters above `2.5 m` plinths with vertical cool LEDs, `4.2 m` blast doors with 7-segment red slits (`HangarGlow`), central front crimson core portal (`BridgeVisor`), backlit overhead gantry trusses (`HangarLights`), and `16` 1:1 suspended TIE/ln fighters (`8.82 m H × 6.70 m W × 7.24 m L`).
  - Scaled `imperial_shuttle.glb` (`2,262` tris, `20.0 m L × 19.09 m H`), `landing_pad.glb` (`1,280` tris, `~34 m` oct-pad), `turbolaser.glb` (`988` tris, `7.44 m` turret H), and added `deck_props.glb` (`436` tris: `1.82 m` `SpaceTrooper`, `2.52 m` `CargoCrate`, `1.22 m` `FuelDrumCluster`).
- **Materials, Scene Framing & Outward Searchlights (`FortressMaterials.ts`, `showcase.ts`, `index.html`):**
  - Assigned matte Mustafar basalt `rockMat` (`roughness: 0.88`, `metallic: 0.02`, `normalScale: 1.55`, `wetBandHeight: 9.5 m`) to `BastionBase`, `BastionRock`, `MainWedge`, and `CommandCrown`; reserved `deckMat` (`armorMaps`, `roughness: 0.21`) and `trimMat` (`trimMaps`, `roughness: 0.34`) strictly for the human-built hangar, trusses, doors, and props.
  - Added auto-instanced `SpaceTrooper` honor-guard formation (20 troopers + 8 blast-door sentries), cargo crates, and fuel drum clusters; rescaled `OceanGridGeometry` (`radius: 4400`, `detailRadius: 900`), `defaultFar: 5200`, skybox (`4800`), `CAMERA_VIEWS` headroom, volumetric fog, rain, and sea-spray emitters for the `485 m` monolith; aimed port/starboard searchlights outward over the ocean swells (`(±108, 114.8, 42)`, `baseYaw: ±0.78`, intensity `1200`) to eliminate cliff glare.
- **Verified:** `npm run typecheck`, `npm run lint`, `npm run lint:glsl`, `npm run lint:wgsl`, `npm run check:doctrine`, `npm run build:showcases`, `SHOWCASE_TEST_CONCURRENCY=1 node .agents/scripts/check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`, `failed=0`), and 7 multi-angle screenshots (`wide`, `hangar`, `crown`, `waterline`, `trench`, `redAlert_hangar`, `rear_obelisk_twilight`) inspected with `0` console/page/WebGPU errors (`~62,958` scene tris).

## 2026-11-18 — 4K Cycles-Baked WebP PBR Texture Sets (`armor_*`, `trim_*`, `rock_*`)

- **Blender 5.3.0 Cycles 4K Baking & CC0 Photogrammetry ([bake_4k_textures.py](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/.agents/scratches/fortress-prep/bake_4k_textures.py), [encode_webp_4k.sh](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/.agents/scratches/fortress-prep/encode_webp_4k.sh)):**
  - Upgraded all `13` primary Fortress PBR maps in `public/assets/showcases/53/textures/` to `4096×4096` WebP (`-q 92` for albedo, `-lossless` for tangent normal/roughness/metallic/AO) baked via periodic `3×3` high-poly geometry and 4D-torus seamless Cycles shaders (`179.3 s` CPU bake):
    - `armor_*` (`14 m` tile; _Jedi: Fallen Order_ ref `069`): `4×4` asymmetric Imperial durasteel plates, recessed hexagonal honeycomb grates, service louver hatches, drainage trenches, anchor bolts, Cycles `AmbientOcclusion(inside=True)` edge wear, and seamless rain-puddle roughness (`0.09..0.76`) composited from 4K CC0 Poly Haven `blue_metal_plate` & ambientCG `Metal046B` (`albedo 999K`, `normal 4.4M`, `roughness 7.2M`, `metallic 1.7M`, `ao 2.1M`).
    - `trim_*` (`8 m` tile): structural stiffener ribs, rivet strips, mechanical louvers, and gusset plates (`albedo 1.5M`, `normal 5.8M`, `roughness 5.4M`, `metallic 849K`).
    - `rock_*`: full 4K Poly Haven `dark_rock` photogrammetry shifted to cold Mustafar obsidian-slate with non-periodic 4D weathering & damp seam variation (`albedo 1.3M`, `normal 23M`, `roughness 5.0M`, `ao 7.0M`).
- **Material Calibration & Docs ([showcase.ts](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/showcase.ts), [FortressMaterials.ts](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/FortressMaterials.ts), [concept-dossier.html](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/docs/concept-dossier.html)):**
  - Lifted `rockMat` (`color: (0.46, 0.49, 0.54)`, `roughness: 0.9`), `deckMat` (`color: (0.76, 0.8, 0.86)`, `metallic: 0.96`, `roughness: 0.92`, `normalScale: (1.35, 1.35)`), and `trimMat` (`color: (0.64, 0.68, 0.75)`, `metallic: 0.96`, `roughness: 0.88`, `normalScale: (1.25, 1.25)`) so the baked 4K dynamic range and hangar puddle contrast read cleanly without darkening crush.
  - **Outer Wall Silhouette Fix (`build_fortress_blender.py`, `bake_4k_textures.py`):** Removed the periodic Geometry-Nodes sine wave (`strata_amp = 0.0`, `sharp_deg = 44°`, gentle `0.30..0.75 m` low-frequency organic undulation) and the `8×/16×` horizontal sine bands in `rock_*`, eliminating the distant washboard ripple pattern so the outer slopes read as crisp, planar volcanic basalt slabs.
- **Verified:** Direct `dwebp` + `analyseRgb` verification on all three `4096×4096` WebP normal maps (`armor_normal.webp`: `meanBlue=0.950`, `neighbourDeg=1.76°`; `trim_normal.webp`: `meanBlue=0.983`, `neighbourDeg=0.75°`; `rock_normal.webp`: `meanBlue=0.975`, `neighbourDeg=4.26°`), `npm run typecheck`, `npm run lint`, `npm run lint:glsl`, `npm run lint:wgsl`, `npm run check:doctrine`, `npm run build:showcases`, `SHOWCASE_TEST_CONCURRENCY=1 node .agents/scripts/check-showcases.js 53` (`3/3` OK across `WEB_GL1`, `WEB_GL2`, `WEB_GPU`, `firstPassFailures=1`, `recoveredByRetry=1`, `failed=0`), and multi-angle WebGPU renders (`0` errors, `62,958` scene tris).

## 2026-11-18 — Curved Preset Camera Fly-Through (`CameraFlyToBehavior`)

- **Cinematic Arc Transitions ([showcase.ts](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/showcase.ts)):**
  - Replaced instant preset jumps on `Digit1`–`Digit5`, HUD preset buttons, and `R` / `resetCamera()` with smooth Catmull-Rom `camera.flyTo()` arc trajectories (`Easing.easeInOutCubic`, `1.65..3.15 s` scaled to arc length, `0.65 s` re-center when already at the target position).
  - `_buildCameraArcWaypoints` computes polar arcs around `(0, 0)` with subtle lateral banking on near-radial moves, vertical crane lift (`8..46 m`, minimum `y >= 16 m` wave clearance), and a tapered fortress clearance envelope (`_minFortressClearanceRadius`: `178 m` below `y = 145 m`, tapering to `58 m` at `485 m`) so cross-obelisk transitions sweep cleanly around the bastion instead of clipping through the hull.
  - Temporarily pauses `FlyController` during flight (`_syncCameraController`), cancels immediately on manual flight keys (`WASD`/arrows/`Space`/`E`/`Q`/`C`) or canvas `pointerdown`, and preserves instant snapping on initial scene load and `window.__qaSwm53.setCameraPreset(preset, instant = true)`.

## 2026-11-19 — MacBook Metal GPU Profiling & 60 FPS Optimization

- **Root-Cause Profiling (Headless Chromium on MacBook Pro Metal GPU, `1728×1117` CSS):**
  - Identified three stacked fragment/pixel bottlenecks dropping close-up presets (`hangar`, `waterline`, `trench`) from `60 FPS` to `28.2–30.4 FPS` (`~33–35.5 ms`) on WebGPU and `10.1–20.3 FPS` on WebGL2:
    1. **Full-Resolution HBAO (`AOPassGPU`):** `hbao.enabled = true` dispatched 69 uncached `textureLoad` depth taps/pixel across the full Retina backing buffer (`radius: 2.8 m`), costing `~12–15 ms` per frame in interior/basalt close-ups even though `armor_ao.webp` and `rock_ao.webp` already carry 4K Cycles-baked AO.
    2. **`maxPixelRatio: 1.5` (`2592×1675` = `4.34M px`):** Excessive pixel fill for post-processing + PBR/ocean passes compared to `1.15` (`1987×1284` = `2.55M px`, `-41%` pixels).
    3. **Secondary Render & Particle Costs:** Full `1024×1024` `PlanarReflectionNode` scene re-render + mipgen feeding wavy `reflectionDistortion: 0.11` storm water, `168×192` ocean radial rings, `9000` rain particles, and `24`-step WebGL2 `VolumetricFogElement` raymarching.
- **Showcase-Local Optimization & Opt-In Quality Toggles ([showcase.ts](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/showcase.ts), [Hud.ts](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/Hud.ts)):**
  - Set default `quality.maxPixelRatio = 1.15` (`DEFAULT_MAX_PIXEL_RATIO = 1.15`, `1987×1284`), disabled default screen-space `HBAO` (`_hbaoEnabled = false`, relying on the 4K Cycles-baked `armor_ao`/`rock_ao` maps), lowered `PlanarReflectionNode` to `512×512`, tightened `OceanGridGeometry` to `128×160` (`20,481` verts), trimmed `RainStreaks` to `4500` (`halfExtent: 26`), and set `vfog.samples = 12` (WebGL2 fog raymarch relief).
  - Exposed live **`HBAO AO`** (`#btnHbao`) and **`HiDPI 1.5×`** (`#btnHiDpi`, live `renderer.quality.maxPixelRatio` + `renderer.setSize()`) toggles in the HUD drawer and on `window.__qaSwm53` (`setHbao`, `setHiDpi`) so users on desktop GPUs can opt back into maximum fidelity without penalizing laptop frame rates.
- **Verified Before / After (`1728×1117`, `deviceScaleFactor: 2`):**
  - **WebGPU:** `wide` `60.0 -> 60.0 FPS`, `hangar` `28.2 -> 60.0 FPS` (`16.67 ms`, `cpu ~2.7 ms`), `crown` `60.0 -> 60.0 FPS`, `waterline` `28.6 -> 60.0 FPS`, `trench` `30.4 -> 60.0 FPS`, curved flight `wide -> hangar` `60.0 FPS` (`p95 16.8 ms`, `0` errors).
  - **WebGL2 (`?rendererType=WEB_GL2`):** `wide` `20.3 -> 60.0 FPS`, `hangar` `10.1 -> 44.8 FPS`, `crown` `60.0 FPS`, `waterline` `11.7 -> 52.4 FPS`, `trench` `53.1 FPS`, curved flight `60.0 FPS` (`0` errors).

## 2026-11-19 — Film-Accurate CC BY 4.0 TIE/ln Fighters & _Lambda_-Class T-4a Shuttles

- **TIE/ln Fighter Replacement ([tie_fighter.glb](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/public/assets/showcases/53/models/tie_fighter.glb), `574 KB`, `10,365` tris):**
  - Replaced the 16 low-poly procedural TIE meshes baked inside `fortress.glb` with Daniel Andersson's CC BY 4.0 _Star Wars: TIE/ln Fighter_, prepared in Blender 5.3.0 ([build_tie_blender.py](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/.agents/scratches/fortress-prep/build_tie_blender.py)) at `8.82 m` height (`-Z` forward, origin at cockpit center) across 5 PBR sub-meshes (`TieHull` `7,598`, `TieDarkTrim` `2,400`, `TieCockpit` `171`, `TieEngines` `156`, `TieSolar` `40`).
  - Replaced the fused TIE hulls in `fortress.glb` (`32,822` tris, `1.9 MB`) with clean overhead gantry clamp pylons (`add_tie_clamp_pylon`, `--only-fortress`) at collision-free hangar bay coordinates (`x = ±72`, `z ∈ [-46, -30, -14, 44]`; `x = ±58`, `z ∈ [-38, -22, 42]`; forward `x = ±26, z = 70`), auto-instanced 16× in `showcase.ts`.
- **_Lambda_-Class T-4a Shuttles & Shared 1K Baked WebP PBR Atlas ([imperial_shuttle.glb](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/public/assets/showcases/53/models/imperial_shuttle.glb) `757 KB` / `13,140` tris, [imperial_shuttle_flight.glb](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/public/assets/showcases/53/models/imperial_shuttle_flight.glb) `817 KB` / `14,207` tris):**
  - Derived landed/folded-wing (`21.50 × 18.44 × 22.09 m`, `minY = 0.000`, `1.11 m` ceiling clearance in the `23.20 m` hangar) and deployed-wing flight variants from tegnemaskin's CC BY 4.0 _Star Wars Lambda Imperial Shuttle_ ([build_shuttle_blender.py](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/.agents/scratches/fortress-prep/build_shuttle_blender.py)): trimmed inner hinge-cam geometry for clean `120°` wing folding, added landing skids, twin cannons, recessed rear ion manifolds (`ShuttleEngines`), and smoked viewport canopies (`shuttleVisorMat`, metallic dark reflective glass), stripped duplicate UV layers, and Cycles-baked shared `1024×1024` tangent-space PBR maps (`shuttle_{albedo,normal,roughness}.webp`, `148 KB` / `981 KB` / `478 KB`).
- **Performance, Provenance & QA ([showcase.ts](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/apps/showcases/53/showcase.ts), [REFERENCES.md](file:///Users/stefan.rottensteiner/Projekte/rottensteiner-stefan/small-world-machine/REFERENCES.md)):**
  - Unthrottled WebGPU benchmark (`1987×1284` backing, `269,281` scene tris) confirms locked `60 FPS` headroom across all views (`hangar` `avg 9.49 ms / 105.4 FPS`, `crown` `11.50 ms / 87.0 FPS`, `waterline` `11.14 ms / 89.8 FPS`, `trench` `11.62 ms / 86.1 FPS`, `wide` `p50 7.4 ms`).
  - Documented CC BY 4.0 attributions in `REFERENCES.md` and backed up raw GLBs + Blender build scripts to Google Drive per ADR 0058.

## 2026-11-19 — Terminology Alignment (`Dark Fortress`, `Wassermond`, `Space Trooper`)

- **Code, Assets & Docs Rename:**
  - Renamed `Fortress Inquisitorius` -> `Dark Fortress`, ocean moon `Nur` -> `Wassermond`, and `Stormtrooper` -> `Space Trooper` (`SpaceTrooper` mesh/node identifier in `deck_props.glb`, `showcase.ts`, `Hud.ts`, `FortressMaterials.ts`, `index.html`, `public/index.html`, `concept-dossier.html`, `log.md`, `CHANGELOG.md`, and `docs/adr/0062-open-ocean-geometry-and-material.md`).
