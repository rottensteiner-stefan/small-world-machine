# ADR 0059: GPU-driven vegetation rendering — instance fields, LOD buckets, impostors, far field

- **Status:** Proposed (2026-11-07). Steps 0–6 below are a menu: each step is accepted, deferred or rejected on its own after the previous step's measurement gate. Accepting this ADR accepts the *shape*; it does not commit to every step.
- **Related:** ADR 0008 (HZB occlusion, WebGPU-only), ADR 0035 (quality tiers), ADR 0036 (TS stays, no WASM at runtime), ADR 0046 (automatic instancing), ADR 0047 (doctrine), ADR 0057 (tier parity matrix), ADR 0022 (GPU-instanced VFX / extras package pattern)
- **Trigger:** custom-engine forest demo, video "Custom Engine Forest Showcase" (YouTube `uR5EvBWxN14`, 2026-11-03, 165 s) + PCGH news 2026-11-07. Unbenchmarked, single-purpose, static scene; taken as direction, not as target numbers.
  - **Author's own statements** (video description + pinned comment): CLODs (virtual geometry) with **voxels for far representations, explicitly no impostors**; screen-space + voxel hybrid GI, no ray tracing; proxies without instance data for very far representations; weather systems as design goal. RTX 3080: avg 130 fps uncapped, 200 aerial, 80 in dense forest; RTX 3070 mobile ~60 fps; minimum RTX 2060 / RX 6400 "because of the GPU features" (= DX12-Ultimate class: mesh shaders / 64-bit atomics / sampler feedback — inference, not stated).
  - **Author's comment replies:** D3D12 only (Vulkan maybe later); C++ engine, Luau scripting; 1440p; min spec is due to **mesh shaders**; **no hardware RT anywhere** (GI = screen space + voxel; water = planar reflections + SSR); CLOD built with **meshoptimizer, modified to also emit voxels during the CLOD build** (one offline bake for clusters and far voxels); foliage temporal artefacts handled by **mip bias on alpha-tested grass + a motion-based "smear mask" with selective sharpening** (reactive masks did not help; trees are unproblematic, grass smears); cliffs/rocks unsolved (scatter looks wrong, terrain extrusion = too much unique geometry).
  - **Not from the author:** "3 M trees with 4 M polygons each" originates from a viewer comment, picked up by PCGH. Discarded.
  - **Community feedback (most liked critique, ~400 likes):** visible LOD transitions, mainly in fast flight. Wind praised for not moving in unison; requested: waves travelling across the field.
  - **Earlier Godot videos by the same author** (2025-09/11, descriptions): ground vegetation **does not render into the shadow map**, instead screen-space shadows (loosely after Bend Studio) + micro shadows blended with AO and N·L, per-object strength via an extra render target; **alpha test only in the depth pre-pass**, simplified shadow/pre-pass shaders; manual LOD crossfade because Godot's fade used the shadow camera distance (broke shadows); SSILVB as crude GI at ~0.7 ms, darkens forest interiors.
  - **Frame analysis** (in-video overlay, recording capped at 60 fps): **CPU 0.9–1.9 ms flat across all shots**, GPU 5.9–8.8 ms meadow/aerial, 10–12.8 ms dense forest. → Fully GPU-driven; CPU cost independent of scene content is the real headline.
  - **Visual content:** the dominant instance population is **dense grass + flowers + forest-floor debris (sticks, leaves)**, not trees; strong wind animation on grass; distant forest reads as a fused canopy mass; aerial perspective/height fog; volumetric clouds and overcast weather states; rock cliffs are textured heightfield (visible weakness).

## Context

- **Invariant: frame cost must scale with pixels, not with scene content.** 1440p = 3.7 M pixels; more than ~1 triangle per pixel is invisible. Millions of instances are only affordable when (a) almost all are culled or aggregated before the vertex stage and (b) detail per survivor is chosen by screen-space error.
- **Current engine cannot do this:**
  - Every renderable is a CPU scene-graph object; `Scene._collectVisible()` walks all of them every frame.
  - ADR 0046 auto-instancing batches *consecutive CPU objects* (keeps picking/behaviors/bounds per object) — right for hundreds to thousands, wrong for 10⁵–10⁶.
  - `InstancedMesh` draws all instances, no per-instance culling, no LOD.
  - `HzbOcclusionSystem` tests per object and reads results back to the CPU (`MAX_HZB_TESTED_OBJECTS = 8192`, 1–3 frames latency). Readback cannot scale to millions.
  - Indirect draws exist only in the GPU particle path (`GpuParticleSystemHost`).
  - No LOD system for meshes, no impostors, no far-field aggregation. `BillboardInstancer` is CPU-scattered sprites without culling.
- **Web constraints (WebGPU core, 2026):** compute + storage buffers + `drawIndirect`/`drawIndexedIndirect` available; **no** mesh shaders, **no** multi-draw-indirect in core, **no** portable 64-bit atomics (software raster of micro-triangles à la Nanite is out), `firstInstance != 0` in indirect args needs optional feature `indirect-first-instance`. WebGL2: no compute, no base-instance without extension.
- **Consumers (Rule of Three, ADR 0047):** Minceraft flora, YAD outdoor areas, a standalone app's exteriors, plus `BillboardInstancer` (grass) as a later migration candidate.

## Decision

### Shape (binding if accepted)

- **New engine node `InstanceField`** (`packages/engine/src/core/`): one scene-graph node owning N instances of 1..k *prototypes* (one prototype = LOD chain + material(s) + bounding sphere). Instances are **not** scene-graph objects: no per-instance picking, behaviors or octree entry. Deliberate split from ADR 0046: auto-instancing for "many objects", `InstanceField` for "a population".
- **Instance record = 16 B** (`vec3f` position + `u32` packed yaw 16 bit / uniform scale 16 bit). 1 M instances = 16 MB GPU. Tint/variation derived from a position hash in the shader, not stored.
- **Instances are spatially sorted into cells** (fixed world grid, cell size per field). Cells are the unit for CPU culling (WebGL2/1), streaming and far-field aggregation; GPU culling goes per instance.
- **Engine owns** culling, LOD selection, indirect draw integration into opaque, depth pre-pass and shadow passes. **`@small-world-machine/vegetation-extras` owns** tree-specific parts (impostor material, canopy shell, wind, species presets). **`tools` owns** offline bakes (LOD generation, impostor atlas, cluster DAG). Apps consume via root imports only.
- **No CPU readback in the render path.** Stats (visible counts per bucket) only via opt-in async debug readback for the HUD.
- **LOD selection metric = projected sphere diameter in pixels** (resolution/FOV-independent), not world distance. Distances may be offered as authoring sugar, converted once.
- **Tiers (Tiered Renderer Autonomy):** WebGPU = full GPU path. WebGL2 = CPU cell culling + per-cell LOD + instanced draws, smaller budget. WebGL1 = same with `ANGLE_instanced_arrays`, impostors + far field only beyond a short mesh radius. Every tier absence gets a row in `docs/reference/tier-parity.json` in the same change.

### Plan (menu, ordered by leverage/cost)

| Step | Content | Tiers | Size | Gate to continue |
|---|---|---|---|---|
| 0 | Measurement first | all | S | numbers exist |
| 1 | GPU instance culling + indirect draw | GPU (GL2/GL1 CPU fallback) | M | ≥10× visible-instance budget vs. CPU path at same frame time; CPU frame time flat vs. instance count |
| 1b | Procedural ground cover (grass/flowers/debris generated per frame, no stored instances) + wind | GPU (GL2/GL1 reduced) | M | ground cover to horizon of the cover ring at ≤ 2 ms GPU |
| 2 | LOD buckets + dithered crossfade | all | S–M | no visible pops at TAA on/off, triangle count flat vs. instance count |
| 3 | Octahedral impostors | all | M | impostor ring indistinguishable at ≥ handover size in A/B screenshots |
| 4 | Far field without instances | all | M | horizon forest costs O(1) draws, seam invisible in fog |
| 5 | Clustered LOD (Nanite-like) | GPU only | L | only if step 0–4 measurements show near-field triangle/vertex bound |
| 6 | Forest lighting / GI | all (6a), GPU (6b) | S (6a) / L (6b) | 6b only as research spike |

#### Step 0 — Measurement
- New showcase `apps/showcases/51` "forest": terrain + `InstanceField` stub, procedural or 2–3 CC0 tree species, scalable instance count via URL param (`?n=`), fly-through camera path for reproducible runs.
- Wire `timestamp-query` (feature already requested, K5 in `WebGPURenderer`) into a per-pass GPU timing ring (async resolve, no stall); HUD shows ms per pass + visible instances/triangles per bucket.
- Baseline with today's tools (ADR 0046 auto-instancing, `InstancedMesh`) to quantify the gap.
- HUD layout like the reference overlay: `fps | cpu ms | gpu ms` always visible, so screenshots/videos carry their own numbers. Key acceptance curve: CPU ms vs. `?n=` must stay flat once step 1 lands. Initial targets, calibrated after measurement: WebGPU M1-class laptop 1080p 60 fps with ≥250 k field instances; WebGL2 same device ≥20 k.

#### Step 1 — GPU instance culling + indirect draw (WebGPU)
- Per frame, per *view* (main camera, each CSM cascade, spot/point shadow faces that see the field): one compute dispatch over the field's instances.
- Tests: frustum (bounding sphere, conservative), max cull size (sub-pixel instances dropped), then HZB against the **previous frame's** pyramid (reuse `hzb_downsample_max.wgsl`; no readback). Camera cut / teleport → skip HZB for one frame.
- Survivors are `atomicAdd`-compacted into per-(view × LOD bucket) segments of a visible-index buffer; the same atomics fill `drawIndexedIndirect` args. Vertex shader reads `instances[visible[segmentBase + instance_index]]` (vertex pulling from storage buffer) → no `indirect-first-instance` dependency.
- Indirect args reset by a tiny compute or `writeBuffer` of a template per frame.
- Shadows: casters culled against the cascade volume extruded toward the light; shadow pass may use a coarser LOD bias (step 2).
- Two-phase occlusion (draw last frame's visible set → rebuild HZB → test rest, Wihlidal 2015 / Haar & Aaltonen 2015) is the documented upgrade if single-phase popping is visible; not V1.
- Renderer integration through one internal `IndirectDrawSource` contract (consumers: GPU particles, `InstanceField`, impostors/clusters) instead of per-feature branches in `WebGPURenderer`.
- **Alpha-tested foliage keeps early-Z:** alpha test (`discard`) runs only in `DepthPrePassGPU`; the colour pass draws the same geometry with `depthCompare: "equal"`, no `discard`, no depth write. Shadow and pre-pass use stripped shaders (position + alpha UV only). Verify first whether today's colour pass still discards for alpha-cutout materials; if so this is an engine-wide win independent of `InstanceField`. WebGL2: same via `gl.EQUAL`.
- **WebGL2/WebGL1 fallback:** CPU frustum test per cell AABB, per-cell LOD (distance of cell center), instance VBO sorted by cell, `vertexAttribPointer` offset rebinding per visible cell range (no base-instance extension needed). Budget via ADR 0035 tier.

#### Step 1b — Procedural ground cover
- Rationale: in the reference video the visible instance count is dominated by grass, flowers and floor debris. Storing these as instances wastes memory and bandwidth; they are a function of terrain + density maps.
- Compute generates candidates each frame in a camera-centred ring of tiles: jittered grid per tile, stable per-tile hash seed (no swimming when the camera moves), density/species from terrain splat or density textures, height/normal from terrain. Candidates go through the same cull + LOD-bucket compaction as step 1 and are drawn indirectly. Benchmark: Ghost of Tsushima grass (Wohllaib, GDC 2021), Unity/Unreal procedural foliage, Godot `MultiMesh` + terrain plugins.
- Density thins with distance (stochastic drop by projected size, compensated by blade width) until the terrain material's own grass shading takes over → no visible cover edge.
- Wind: shared global wind field (direction, gust noise texture scrolled in world space) consumed by ground cover, tree LODs and impostors alike, so all layers move coherently.
- WebGL2/WebGL1: pre-generated per-tile instance VBOs for a smaller ring, same tile seeding, same wind math.
- **Ground cover casts no shadow-map shadows.** It receives the shadows of trees/terrain, its own self-shadowing comes from screen-space shadows (engine feature, separate backlog item; Bend Studio *Days Gone* method) blended with AO and N·L. Removes the most expensive caster population from every cascade.
- **Wind as travelling waves:** gust noise scrolled along the wind direction in world space, per-instance phase from position hash, so gusts visibly roll across the field and neighbours never move in unison.
- **Temporal stability:** negative mip bias on alpha-tested ground cover textures (keeps coverage at distance) plus a motion-based smear mask (velocity buffer) that lowers TAA history weight / sharpens selectively on moving foliage before `TaaElement`. Reactive-mask approaches were reported as ineffective by the reference author; measure before adopting.

#### Step 2 — LOD buckets + crossfade
- Prototype = LOD0..LODn meshes + impostor (step 3) as final bucket; thresholds in projected pixels with per-tier bias (ADR 0035).
- Crossfade band: instance written to both adjacent buckets with a fade factor, fragment shader does screen-door dither (Bayer/blue noise, complementary masks); TAA (`TaaElement`) resolves the dither. Benchmark: Unity `LODGroup` cross-fade, Unreal dithered LOD transition.
- **Invariant: LOD is always selected from the main camera**, in every view including shadow passes (shadow views reuse the main camera's bucket choice, optionally biased coarser). Selecting per view (shadow camera distance) breaks shadows — the documented Godot failure the reference author had to work around.
- Visible LOD transitions were the reference demo's most criticised artefact; the step-2 gate is therefore checked in fast flight (showcase 51 camera path at high speed), not only at walking speed.
- LOD source: glTF meshes named `*_LOD<n>` (or `MSFT_lod`), else generated offline by a `tools` CLI command using meshoptimizer simplification (offline tooling only; runtime stays TS per ADR 0036).

#### Step 3 — Octahedral impostors
- Bake (browser tool in `tools`, renderer needed): prototype captured from N×N (e.g. 12×12) hemi-octahedral directions (full octahedral as option for flight cameras) into two atlases: albedo+alpha, normal+depth. Export KTX2 (BC7/ASTC already supported) + JSON metadata. Benchmark: Ryan Brucks' UE ImpostorBaker (2018), Godot/three.js octahedral impostor plugins.
- Runtime: camera-facing quad per instance; view direction → octahedral cell, blend 3 nearest frames, depth-based parallax correction; lit with stored normals through the shared PBR lighting chunk, receives shadows; alpha-tested depth write so impostors cast shadows and intersect terrain correctly.
- Wind (vertex sway) is a `vegetation-extras` concern; impostors get a cheap global sway only.
- **Deliberate deviation from the reference:** the reference author explicitly avoids impostors and uses voxels instead (typical impostor weaknesses: frame-blend ghosting, parallax error up close, lighting/GI mismatch against real geometry, atlas memory per species). We keep impostors because they work on every tier incl. WebGL1 and cost one quad per tree; the WebGPU-only alternative is a per-prototype **voxel LOD** (prefiltered sparse brick volume, raymarched in the fragment shader) as a later replacement for the impostor bucket if A/B shows impostor artefacts. Decide after step 3 measurement, not before.

#### Step 4 — Far field without instances
- Beyond the impostor ring, cells drop their instances entirely. V1 = **canopy shell**: terrain-following mesh offset by a per-cell canopy height/density map baked from the instance population, shaded with a canopy material (noise normals, density-driven AO and color variation), one draw per terrain chunk; dithered handover to impostors; existing fog/aerial perspective hides the seam.
- Alternatives kept for later: per-cell aggregate impostors (HLOD, Unreal HLOD style) if the shell looks flat from low altitude; WebGPU-only voxel canopy volume (3D density texture, raymarched, re-using froxel infrastructure) — closest to the referenced demo, highest cost.
- Reference video check: from aerial views the distant forest reads as a fused canopy mass with per-crown silhouettes only near the horizon line and heavy aerial perspective — the shell + fog is plausible for that look; silhouettes against the sky are the weak point and get a dedicated A/B shot in showcase 51.

#### Step 5 — Clustered LOD (Nanite-like), WebGPU only
- Offline (`tools`): split mesh into clusters (≤128 tris / ≤64 verts), group neighbours, simplify groups with locked group borders, re-split, repeat → DAG with per-cluster error bounds (Karis, "A Deep Dive into Nanite Virtualized Geometry", SIGGRAPH 2021; meshoptimizer clusterizer + simplifier).
- **One bake for clusters and far voxels** (as in the reference: meshoptimizer extended to emit voxels during the CLOD build): when the DAG's coarsest levels stop being meaningful as triangles, the same bake emits the voxel representation used by the WebGPU voxel-LOD/far-field alternatives of steps 3 and 4. If step 5 is ever accepted, re-evaluate step 4's voxel option together with it.
- Runtime: per-instance cull (step 1) → cluster cut selection in compute (cluster drawn iff own error < 1 px and parent error ≥ 1 px; locally decidable, no traversal order) → cluster frustum/HZB/backface-cone cull → one `drawIndirect` with vertex pulling (instance = visible cluster, vertex = triangle corner, padded to 128 tris).
- Out of scope: software rasterization of micro-triangles and visibility buffer (no portable 64-bit atomics), streaming of cluster pages.
- Known weakness: alpha-masked foliage and leaf cards simplify poorly; trees likely keep step-2/3 handling for leaves and use clusters for trunks/rocks/architecture.
- WebGL2/WebGL1: `deliberate` absence (no compute); discrete LOD from step 2 is the fallback.

#### Step 6 — Forest lighting / GI
- **6a (all tiers, cheap, recommended):** canopy-aware ambient: density map from step 4 darkens/tints sky + IBL ambient below the canopy; per-vertex/per-instance AO baked into prototypes; HBAO (`HbaoElement`) for contact. Most of the "forest feel" at near-zero cost.
- **6a+ (WebGPU/WebGL2, candidate):** SSILVB — screen-space indirect lighting with visibility bitmask (Therrien, Levesque & Gilet 2023), extending the GTAO-style `HbaoElement` horizon search; reference author measured ~0.7 ms with reduced precision and used it to darken forest interiors instead of distance-field AO.
- **6b (WebGPU, research spike only):** hybrid voxel GI (scene voxelization into a clipmap via compute, cone tracing or probe update; benchmark Godot `VoxelGI`/`SDFGI`, NVIDIA VXGI, Crassin 2011). Own ADR before any implementation.

## Considered options

- **Extend ADR 0046 auto-instancing to millions of CPU objects:** rejected — per-object CPU cost (scene walk, bounds, sort) is the bottleneck, not draw calls.
- **Extend `HzbOcclusionSystem` readback to more objects:** rejected — readback latency and CPU apply cost scale linearly; GPU-side compaction has no such limit.
- **Nanite-like clustered LOD first:** rejected as starting point — highest cost, WebGPU-only, weak for foliage; steps 1–3 cover the common case on every tier.
- **Mesh merging per cell (static batching):** rejected — memory per cell × LOD, no per-instance culling, rebuild on edit.
- **Per-instance matrices (64 B):** rejected — 4× bandwidth for uniform-scale vegetation; non-uniform scale/full rotation can come as a second record layout if a consumer needs it.
- **Voxel far field as V1:** deferred — WebGPU-only and expensive; canopy shell serves all tiers first.

## Consequences

- New public API surface (`InstanceField`, prototype/LOD descriptors, impostor descriptor) must be classified per ADR 0047 when implemented.
- Renderer gains an indirect-draw path in opaque, depth pre-pass and shadow passes on WebGPU; GL renderers gain a cell-culled instanced path.
- Tier parity rows: `instance_field_gpu_cull` (GL2/GL1 `deliberate`, CPU fallback), `clustered_lod` (GL2/GL1 `deliberate`), `voxel_gi` (if 6b ever lands).
- New REFERENCES.md entries per implemented step (Wihlidal 2015, Haar & Aaltonen 2015, Brucks 2018, Karis 2021, Crassin 2011, Therrien et al. 2023, Bend Studio screen-space shadows).
- `BillboardInstancer` stays as is; migration onto `InstanceField` is a separate decision after step 2.
- Picking individual trees needs a CPU-side query over the field's cell grid (not provided by V1).

## Doctrine compliance (pre-check, re-verify per step)

- **New public hot-scope parameters:** expected `@domain` (`lodPixelThresholds`, `cullPixelSize`, `cellSize`, `shadowLodBias`), `@fixed` (instance record layout, impostor grid size per bake). Classified in code when introduced.
- **Shared abstraction ≥ 3 consumers:** `IndirectDrawSource` — GPU particles, `InstanceField`, impostor/cluster buckets. `InstanceField` itself — Minceraft, YAD, a standalone app.
- **Modeful objects:** LOD crossfade state (in band / settled) is stateless per frame (derived from projected size) → no transition state machine; camera-cut HZB skip is an explicit one-frame transition with a test.
- **Mathematical claims:** conservative sphere-frustum and sphere-HZB tests (no false negatives) and projected-size metric get `@invariant` IDs and CPU reference tests.
- **Fail-closed / honest fallback:** compute is render-critical for the GPU path; absent compute → CPU cell path, never a silent empty field.
