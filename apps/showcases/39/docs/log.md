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
