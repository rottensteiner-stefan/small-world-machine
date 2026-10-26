# Asset Sourcing, Budgets & Modular Environments

This guide establishes the engine-wide doctrine for sourcing 3D assets, structuring texture libraries, managing geometric triangle budgets, and authoring modular game environments in Small World Machine.

---

## 1. Sourcing Philosophy: Pragmatism & The "Handful" Rule

When building scenes, prototypes, or production dioramas, adhere to three core sourcing principles:

### Pragmatism Over Reinvention
Whenever standard 3D meshes or baseline materials are needed, leverage established, high-quality open repositories rather than modeling from scratch:
* **ambientCG (Lennart Demes):** >1,800 CC0 PBR materials. Essential for bunker concrete, damp tunnel walls, brick, mud, tiles, and weathered metals.
* **Poly Haven:** High-fidelity CC0 assets and physically calibrated PBR maps (Normal, Roughness, AO).
* **Kenney Assets:** Modular prototyping kits, furniture, and clean UI symbols.
* **Sketchfab (CC0 / CC-BY):** Detailed reference props and mechanical models.
* **Tripo3D API & AI Ingestion:** Rapid generation of bespoke low-poly props (`.glb` with optimized PBR atlas) based on 2D concept sketches or prompt briefs.

### The "Handful" Rule (3–5 Candidates)
Before settling on an asset or investing hours in custom modeling:
1. Source and download **3 to 5 candidate variants**.
2. Place them side-by-side in a test diorama or dev scene.
3. Compare them directly under engine lighting for **style consistency, silhouette clarity, polycount, and texture scale**.
4. Discard the unfitting candidates and commit only the winning asset.

### User Responsibility & Tooling Freedom
The user carries the sole responsibility for all prompts, assets, and licenses. The engine and its developer tools intentionally impose zero patronizing copyright checks or moralizing barriers. Build pragmatic, high-performance tools.

---

## 2. Texture Strategy: PBR vs. Shader Styling vs. Hero Props

Not all surfaces should be created the same way. Balance visual fidelity and production speed according to surface category:

| Surface Category | Recommended Source | Workflow & Technical Rationale |
| :--- | :--- | :--- |
| **Generic Surfaces**<br>*(Concrete, asphalt, masonry, gravel, rusted sheet metal, wooden planks)* | **Calibrated CC0 Packages**<br>*(ambientCG, Poly Haven)* | Physically calibrated PBR maps (Normal, Roughness, AO) with zero AI artifacts. Eliminates hundreds of hours of manual texture painting and baking. |
| **Stylized Graphic Looks**<br>*(Ink hatching, hand-drawn grooves, comic outlines)* | **Shader Stage & Post-Processing** | The engine's post-processing passes (`OutlineElement`, custom composite shaders) apply a consistent cross-scene graphic treatment uniformly over all PBR materials without dirtying source textures. |
| **Story-Critical Key Props**<br>*(Hero machinery, labeled cans, custom terminals, signs)* | **Bespoke Authoring**<br>*(AI Generation + SVG/CAD + PBR Finish)* | Narrative uniqueness and localized typography demand tailored wear patterns, exact labels, and dedicated UV layouts. |

---

## 3. The 4-Tier Polycount & Geometry Budget ([ADR 0011](/adr/0011-modular-asset-kits-and-remote-catalog))

To avoid **sub-pixel quad overdraw** (where micro-triangles smaller than a 2×2 pixel fragment quad choke mobile TBDR rasterizers) and keep initial load times minimal, every 3D asset must adhere to a strict geometry budget based on its maximum bounding box dimension ($L_\text{max}$):

| Tier | Object Category | Max Dimension ($L_\text{max}$) | Target Budget (Tris) | Typical Examples |
| :---: | :--- | :---: | :---: | :--- |
| **Tier 1** | Clutter & Small Items | $\le 0.35\,\text{m}$ | **$800 – 1,500$** | Cups, plates, cutlery, switches, notes, bullets, small tools. |
| **Tier 2** | Medium Props | $0.35 – 1.0\,\text{m}$ | **$2,500 – 4,500$** | Boots, lamps, stools, buckets, toolboxes, wall vents. |
| **Tier 3** | Furniture & Machinery | $1.0 – 2.5\,\text{m}$ | **$6,000 – 10,000$** | Desks, bunk beds, lockers, industrial barrels, terminals. |
| **Tier 4** | Hero Props & Architecture | $> 2.5\,\text{m}$ | **$10,000 – 16,000$** | Heavy blast doors, wall breaches, rubble mounds, vehicles. |

> [!TIP]
> Budgets are enforced **upstream** during initial modeling, decimation, or via export parameters (e.g. Tripo `face_limit` or Blender remeshing with normal baking). Never ship raw multi-million polygon photogrammetry scans into web runtimes.

---

## 4. The 4-Pillar Modular Environment Doctrine ([ADR 0019](/adr/0019-modular-environment-texturing-and-scale-doctrine))

When assembling environments ranging from a small 7×7 m room to a 50 m hall, repetition and tiling artifacts destroy immersion. All modular kits follow four architectural pillars:

### 1. Multizonal PBR Palettes
Every architectural kit provides at least **4 distinct PBR material variants** representing different environmental states:
* *Base Structural Concrete* (e.g. board-formed concrete)
* *Smooth Panel Concrete* (refined architectural cassettes)
* *Damp / Saltpeter Concrete* (water leakage and mineral efflorescence for lower wall sections)
* *Heavy Reinforced Concrete* (fortress-grade aggregate for pillars and lintels)

### 2. Architectural Cadence & Modular Grids (3 m / 5 m)
Break up expansive flat surfaces rhythmically:
* Divide walls with structural **pilasters** (wall columns) every 3 m or 5 m.
* Use overhead **ceiling beams** to guide the eye and compartmentalize light volumes.
* Apply a darker, rougher **damp baseboard** zone along floor intersections to ground the architecture.

### 3. Dual Decal Layering (Macro vs. Micro)
Apply decals ([see Decals Guide](./decals.md)) in two distinct conceptual passes:
* **Macro-Decals (Wear & Destruction):** Large-scale water seepages, rust tracks, concrete spalling (`rebar_damage`), and scorch marks spanning 2–5 meters.
* **Micro-Decals (Signage & Narrative Detail):** Local stenciled numbers, warning labels, hazard stripes (`hazard_stripes`), and luminescent route markings (`guide_stripe_glow`).

### 4. Deterministic UV Jitter
To prevent adjacent modular wall chunks from displaying identical recognizable texture knots or stains, apply an instance-based UV offset:
```typescript
const jitterX = (chunkWorldX * 0.37) % 1.0;
const jitterZ = (chunkWorldZ * 0.37) % 1.0;
material.diffuseMap.offset.set(jitterX, jitterZ);
```
This guarantees continuous variation across modular tiling geometry with zero runtime memory overhead.

---

## 5. DCC Export Contract & Coordinate Invariants

> Every entry is tagged `[VERIFIED]` (confirmed against current engine source) or `[PROPOSED]`
> (authoring/export rule derived from verified engine behavior). Nothing here is invented. This is the
> **binding pipeline contract** for all assets exported from DCC tools (Blender, Tripo3D, Mixamo, ...)
> into Small World Machine. Terminology references the [coordinate-system guide](./coordinate-system.md).

### Units & Scale

| # | Rule | Status |
| :--- | :--- | :--- |
| U1 | Assets are authored in **metric 1‑meter units** (1 scene unit = 1 m). This matches the engine's physics calibration: default global gravity is `[0, -9.81, 0]` (`PhysicsSystem.ts`, §"Initial gravity..."), i.e. earth gravity on the Y axis. | `[VERIFIED]` |
| U2 | No arbitrary "unit multipliers" on import. The glTF loader applies node transforms verbatim; unit fidelity is the exporter's responsibility. | `[VERIFIED]` (loader) / `[PROPOSED]` (exporter) |

### Orientation & Handedness

| # | Rule | Status |
| :--- | :--- | :--- |
| O1 | The engine is **right-handed**: `+X` = right, `+Y` = up, `+Z` = backward, `-Z` = forward/front. Export must match this handedness exactly (no mirroring, no axis-swap on export). | `[VERIFIED]` |
| O2 | The glTF loader applies a node's local transform **verbatim** — it performs **no yaw compensation** (e.g. it never adds `+90°` to make a model "face forward"). A character that appears to walk backward is a **DCC authoring/orientation error**, not an engine bug; fix the export (rotate the root node into `-Z`-facing). See the [coordinate-system guide](./coordinate-system.md). | `[VERIFIED]` |
| O3 | **Pivot doctrine:** every mesh node's origin must sit at its world-space anchor (character at the feet/root bone, prop at the mount point). Exporting "floating" origins drifts physics/spawn logic. | `[PROPOSED]` |
| O4 | **Transforms frozen:** freeze scale and rotation (apply + reset, Ctrl/Cmd‑A) before export; do not ship a node hierarchy containing baked rotations or non‑1 scales on the root. This keeps the bind-pose skinned-mesh bounds minimal. | `[PROPOSED]` |
| O5 | **No negative scale anywhere.** Negative scale reverses parity, flips winding and mirrors UV orientation; it is also the classic cause of inverted tangent handedness. Remove `scale = -1` reflections before export (flip the geometry/UVs in the DCC instead). [See the 2.5D negative-scale note.](./coordinate-system.md) | `[VERIFIED]` (rendering behavior) / `[PROPOSED]` (linter rule) |

### Tangents & Normal Mapping

| # | Rule | Status |
| :--- | :--- | :--- |
| T1 | Tangents use the **MikkTSpace/glTF vec4 contract** `(tx, ty, tz, w)` with `w = ±1` bitangent handedness. The engine derives `w` on the CPU (`AbstractGeometry.computeTangents`) and forwards DCC-baked `glTF TANGENT` verbatim including `w`; every shader tier folds the sign into `B = cross(N, T) * w`. Exporting **without** tangents is fine (engine generates them), but a UV island mirrored against its geometry must then have its `w` derived correctly — never bake `w = +1` for mirrored islands. | `[VERIFIED]` — implemented 2026‑10‑24 (S5 gate, EP‑1) |
| T2 | Do not "fix" relief direction by flipping `normalMap` channels in-engine; correct the handedness in the DCC (`w` is then derived/carried automatically). | `[PROPOSED]` |

### Texture & Color Space

| # | Rule | Status |
| :--- | :--- | :--- |
| C1 | **No hardware-sRGB framebuffer/texture path exists** today; all textures are decoded in software shader code. Artist textures (albedo/diffuse, emissive) are shipped **sRGB-encoded**; the engine linearizes them in-shader (`sRGBToLinear = pow(x, 2.2)`, ADR 0049). Normal, metallic/roughness and AO maps are **linear data** and must be shipped raw. | `[VERIFIED]` |
| C2 | **Every engine `Color` is sRGB-authored** ([ADR 0050](/adr/0050-all-colours-srgb-authored), Unity/Godot convention): material, emissive, sheen, attenuation, light, ambient, fog, clear, volumetric-fog/`FogVolume` and bloom/shafts tints. The engine linearizes each exactly once (shader or `Color.toLinear`). glTF-linear factors (`baseColorFactor`, `emissiveFactor`, `sheenColorFactor`, `attenuationColor`, `KHR_lights_punctual` colours) are encoded **once** by the loader and decoded back by `WorldWriter`. Never pre-darken colors "because the engine is dark". | `[VERIFIED]` |
| C3 | Normal maps ship **green-up, DirectX-convention-compatible in-engine**: the engine reads the green channel directly; DCC green-down assets can be handled per-asset via `normalScale.y = -1`. (`NormalMapFormat` remains a Tools-side generator concept.) | `[VERIFIED]` (engine reads green) / `[PROPOSED]` (export = green-up) |
| C4 | ORM-channel packing: metallic and roughness (and AO) are **separate maps** in the current pipeline — the engine does not consume a single packed `ORM` texture today. Export/import the channels separately; a packed-ORM composite is the documented target contract, not today's state. | `[VERIFIED]` (today) |
| C5 | **Alpha textures (transparency/cutout) must be mip-backed in premultiplied space** to avoid black halos from straight-alpha mip filtering (S5 EP‑10). Engine side: GPU premultiply support exists (`PREMULTIPLIED_ALPHA`), used once a halo-reproducing golden asset appears. | `[PROPOSED]` (DCC enforcement; engine option deferred) |
| C6 | The engine's sRGB decode/encode is a **pow approximation** with a quantified worst-case deviation of **0.0085** (decode) / **0.0335** (encode) in deep shadows vs. IEC 61966‑2‑1. This is documented, golden-stable, and scheduled to be swapped to the exact curve together with the next S5/S1 color release. | `[VERIFIED]` (quantified) |
| C7 | **Baked IBL files are sRGB-encoded 8-bit** ([ADR 0048](/adr/0048-ibl-srgb-colorspace-contract)): `env`, `irradiance` and `prefilter/mipN` are decoded with `sRGBToLinear` like albedo; `brdf_lut` is linear data. `ibl-gen`/`scripts/ibl-bake.ts` decode the input panorama, convolve linear and write sRGB; there is no linear export any more. `sRGBToLinear` decodes with a fixed 2.2 on every tier, with or without post-processing ([ADR 0049](/adr/0049-decode-vs-output-gamma)); engine-rendered inputs (opaque capture, planar reflection, reflection probes) use `targetToLinear` instead. | `[VERIFIED]` |
| C8 | **Normal maps are real, calm tangent-space maps** ([ADR 0051](/adr/0051-geometric-specular-anti-aliasing)): never a greyscale height/edge image under `*_normal.*`, mean neighbour angle ≤ 20° (good maps: 3–10°), mean tilt typically 10–25°. Ship them as **lossless WebP** (lossy WebP subsamples chroma 4:2:0 and breaks normals). Generate from a height map with the Material Studio / `TextureFilters.generateNormalMap`. Checked by `npm run check:normal-maps`. | `[VERIFIED]` |

### Geometry Contract (engine side, informational)

- `SkinnedMesh` computes **conservative pose-aware bounds** (union over bones) for culling — a character posed far from its bind pose is no longer frustum/occlusion/shadow-culled by mistake (S5 EP‑2).
- `KHR_mesh_quantization`: quantized `POSITION` is **dequantized** onto the accessor's declared `min/max` domain on load (S5 EP‑7); accessor `min/max` is trusted for **Float32** POSITION only. Export with real-world bounds in `min/max`.
- Cutout materials (`alphaMode = MASK`) stay in the **opaque** batch (depth-writing discard); do not author them as transparent. (`alphaMode = BLEND` is the only transparent mode.)
