# Showcase 39: Atmospheric Sanctum — Dev Log

## 2026-10-16 — Initial Implementation (Froxel Volumetric Fog, Carving & Mist)

### Objective
Create a flagship showcase benchmarking the newly completed Small World Machine Froxel Volumetric Fog architecture (Phases 1–5), including:
- In-register optical depth integration (WebGPU) and cross-bilateral raymarching fallback (WebGL2).
- Cascaded Directional Light Shadows (CSM) projecting sharp, self-shadowed light shafts through clerestory openings.
- Positive localized mist `FogVolume` (Cylinder & Sphere) with animated 3D procedural noise and emission.
- Negative density interior carving `FogVolume` (Box, density = -1.2) carving clear space inside an enclosed chamber.
- Interactive keyboard shortcuts ([F], [C], [N], [1], [2], [V]) and runtime HUD.

### Decisions & Implementation
- Constructed a monumental sanctum hall with basalt, sandstone, and gold trim materials.
- Placed 12 colonnade pillars flanking the central aisle with transverse ceiling arch beams.
- Integrated `VolumetricFogElement` into post-processing chain alongside ACES Filmic tonemapping, bloom, HBAO, and vignette.
- Added HUD with live backend detection (`WebGPU (Froxel 3D)` vs. `WebGL2 (Raymarch Fallback)`).
- Documented keybindings and inspection workflow in `concept-dossier.html`.

---

## 2026-10-17 — Aesthetic Retuning, Ambient In-Scattering & Frame-Kontext

### Objective
Recalibrate Showcase 39 after the v0.110.0 volumetric shader overhaul to eliminate milky washout, balance indoor shadow levels, and tie dynamic mist motion directly to the engine's deterministic frame context.

### Visual & Physical Retuning
- **Transmittance Scene Attenuation:** With the post-processing composite now attenuating background scene radiance by fog transmittance $T = e^{-\tau}$ (instead of purely additive blending), the original density of 0.08 caused an overly bright, milky haze across the nave.
- **Calibrated Parameters:**
  - `fog.density`: Re-tuned from 0.07 (with `intensity` 1.2) down to `0.025` for crisp cathedral depth and clear silhouette contrast.
  - `fog.intensity`: Set to `1.0` (applied once in the composite pass, resolving the previous double-squared intensity on local lights and volumes).
  - `fog.ambientInject`: Set to `1.5`, scattering scene ambient light and the upper IBL irradiance map (`Scene.irradianceMap`) into the participating medium to naturally lift shadows inside the cathedral without flattening contrast.
  - `fog.scatteringAlbedo`: Kept at `1.0` for pure atmospheric moisture, while the warm brazier and moonlight spot preserve per-light `volumetricIntensity = 1.0`.
- **Frame-Kontext Integration:**
  - Replaced uncoordinated wall-clock sampling with `renderer.frameInfo.time` and `frameInfo.deltaTime` for smooth, deterministic wind advection in procedural 3D mist noise.
  - Checked on WebGPU (in-register prefix-sum froxels) and WebGL2 (bilateral upsampled raymarch) with `check-showcases 39`; the looks are close but not identical (the WebGL2 path does not scatter local lights). No performance measurement was taken.


---

## 2026-10-17 – Local light fog intensity

With the WebGL2 fog now scattering local lights (v0.111.0) the altar and brazier point lights barely showed up in the fog at the default `volumetricIntensity` of 1 (frozen-frame difference vs. off: mean 0.025/255, max 6/255 on WebGL2). Both lights now use `volumetricIntensity: 6`, which makes their glow visibly scatter on WebGL2 and WebGPU without blowing out (checked by eye on both backends at 60 % screenshot size; no numbers taken for the new value). Surface lighting is unchanged, `volumetricIntensity` only scales the fog contribution.

---

## 2026-10-22 — WebGPU Froxel Anti-Flicker & Coherent Skylight God Rays

### Root-Cause Analysis
1. **Temporal Strobe / Flicker in WebGPU (`froxel_inject.wgsl` + `froxel_reproject.wgsl`):**
   - With `near = 0.1, far = 100` and 24 logarithmic slices, 15 of the 24 slices lay in `[0.1m, 7.5m]` ahead of the first pillar, leaving only 6 coarse Z-slices (`6–8m` thick) across the entire nave.
   - `froxel.jitter` shifted the entire 3D grid by `±0.4` slices (`±2.5–3.5m` in Z), causing the single slice covering the Brazier (`r = 2.4m`) and Altar (`r = 4.2m`) to jump in and out of the volume and point-light core every frame (`37×` intensity swing).
   - `froxel_reproject.wgsl` compounded this by adding `jitter` to the history lookup coordinates (causing random `±0.4`-texel self-advection on a stationary camera) and clamping `historySample` to the current frame's 7-tap neighborhood AABB (`boxMax ≈ 0` whenever `jz` stepped off the volume).
2. **Missing Volumetric God Rays:**
   - `_sunLight.direction.z` was negative (`-0.64` / `-0.22`), placing the sun *behind* the camera ($\cos\theta = -0.67$) where the forward Mie Henyey-Greenstein phase (`g = 0.68`) attenuated 98.8% of the sun's volumetric scattering (`hgPhase = 0.0116`), while `ambientInject = 1.5` washed out the shadowed air.
   - `CeilingLeft` / `CeilingRight` were single-sided `Plane`s and the rear outer cathedral wall was open, leaking unshadowed light.

### Fixes
- **Engine (`froxel_inject.wgsl`, `froxel_reproject.wgsl`, `froxel_integrate.wgsl`):**
  - Reconstructed canonical (unjittered) froxel world coordinates in `froxel_reproject.wgsl` so stationary-camera history lookups sample exact texel centers, with variance-tolerant `boxPadding`.
  - Evaluated analytical `FogVolume` SDFs at canonical froxel centers and damped sub-voxel jitter (`0.12` XY, `0.15` Z) in `froxel_inject.wgsl`.
  - Added 3-point stratified sub-slab shadow quadrature across `[bounds.x, bounds.y]` in `froxel_integrate.wgsl` so diagonal light shafts crossing slice boundaries preserve constant energy without staircase blotches.
- **Showcase 39 (`showcase.ts`):**
  - Configured `clusteredLighting: { tileSize: [8, 8], zSlices: 64 }` and `near = 0.5, far = 85.0` for high-resolution 3D froxels across the nave.
  - Replaced single-sided ceiling planes with solid shadow-casting `Cube` slabs, enclosed the rear cathedral wall, and added longitudinal skylight tracery mullions (`SkylightMullion_*`) that carve coherent 3D curtains of light along the camera sightlines.
  - Oriented both sun presets (`Golden Hour` and `High Noon`) into forward Mie scattering ($\cos\theta > 0$, `volumetricIntensity = 3.8`, `ambientInject = 0.16`) and added live HUD sliders for `Fog Density`, `God Ray Strength`, and `Mie Asymmetry (g)`.
