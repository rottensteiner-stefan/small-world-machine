# Showcase 13: Damaged Helmet Development Log

## 2026-10-31 · PBR & GLTF Analysis, Interactive Helmet Lab HUD

### Context & Asset Analysis
- **Model:** `DamagedHelmet.glb` (Battle Studio, Khronos glTF 2.0 PBR Metallic-Roughness sample asset).
- **Format:** Pure core glTF 2.0 binary (`extensionsUsed: undefined`, `extensionsRequired: undefined`).
- **Texture channels:** Base color (albedo), packed metallicRoughness (G=roughness, B=metallic), normal map (tangent space), occlusion (AO in R channel), emissive map + emissiveFactor.
- **Rendering setup:** Split-sum IBL (`env.webp` skybox + irradiance/prefilter/BRDF LUT), multi-light studio setup (Directional sun, directional cool rim/fill, orbiting key spotlight with 2048 shadow resolution), HDR bloom (0.8 threshold for visor glow).

### Engine Capabilities & Extension Benchmark
- **Implemented in Engine:**
  - `KHR_lights_punctual` (point, spot, directional with range and angles)
  - `KHR_materials_emissive_strength`
  - `KHR_materials_clearcoat` (factor, roughness, texture maps)
  - `KHR_materials_sheen` (color, roughness, maps)
  - `KHR_materials_transmission` & `KHR_materials_volume` (Beer-Lambert attenuation, thickness)
  - `KHR_materials_ior`
  - `KHR_materials_variants`
  - `KHR_mesh_quantization`
  - `EXT_texture_webp`
  - Engine extensions: `SWM_prefab_instance`, `SWM_stage_zone`, `SWM_decal`, `SWM_lights_ambient`
- **Historical Baseline (2026-10-31) — Previously Missing GLTF Extensions *(all resolved as of 2026-11-22)*:**
  - `KHR_draco_mesh_compression` (runtime Draco geometry decoding — *now in `@small-world-machine/gltf-extensions`*)
  - `KHR_texture_basisu` (KTX2 / Basis Universal supercompressed textures — *now in `@small-world-machine/gltf-extensions`*)
  - `KHR_texture_transform` (per-material texture scale, offset, and rotation — *now in `GltfMaterialParser` & all tiers*)
  - `KHR_materials_iridescence` (thin-film interference — *now in `StandardMaterial` + WebGPU/WebGL2/WebGL1 shaders*)
  - `KHR_materials_anisotropy` (directional microfacet reflection — *now in `StandardMaterial` + WebGPU/WebGL2/WebGL1 shaders*)
  - `KHR_materials_specular` (non-metal specular tint & F0 adjustment — *now in `StandardMaterial` + WebGPU/WebGL2/WebGL1 shaders*)
  - `KHR_materials_unlit` (unshaded material fallback — *now via `ShaderFlag.UNLIT` across all tiers*)

### Interactive Inspector HUD (`Hud.ts` on `ShowcaseDrawer`)
- Extracted interactive control into `apps/showcases/13/Hud.ts` following modern showcase standards (1, 20, 28, 40, 42, 43, 45).
- **Lighting Mood Presets:**
  - `1 · Studio`: Warm key spotlight, balanced directional sunlight, soft cool fill.
  - `2 · Cyberpunk`: Electric cyan key spotlight, neon magenta sun, boosted cyan visor emissive, HDR bloom.
  - `3 · High Noon`: 3.2 intensity directional sun, ambient sky fill, crisp outdoor shadows.
  - `4 · Noir`: Single stark silver 8.0 key spotlight, sun off, pitch black contrast.
- **Turntable & Animation:** Auto-rotate helmet on/off, speed slider, orbiting key spotlight switch.
- **PBR Tweaks:** Emissive visor glow boost, roughness & metallic factors, automotive clearcoat lacquer slider, IBL reflection toggle.
- **Camera Views:** 4 smooth `flyTo` camera angles (Hero Front, Visor Macro, Side Profile, Dramatic Top).
- **Keyboard Shortcuts:** `I`/`H` (Toggle Drawer), `Space` (Pause/Play turntable), `1`–`4` (Lighting Moods), `R` (Reset to default).

- 2026-11-02 review fix: `Hud.dispose()` (drawer + footer button) called from a new `destroy()` override (`super.destroy()` kept).

## 2026-11-22 · Directional Sun, Ambient Light + IBL & glTF Extension Catch-up

- **Directional Sun (`_mainLight`):** `_fillLight` was previously instantiated as a second `DirectionalLight` added after `_mainLight`, overwriting the single directional light slot (`dDir`/`dCol`/`dIntensity`/`dLight`) every frame in `AbstractRenderer.extractLights`. Replaced `_fillLight` with a non-shadowing `PointLight` (`distance: 80`, `decay: 0`) so `_mainLight` remains the sole `DirectionalLight` and drives intensity, preset color, and CSM shadows.
- **Ambient Light + IBL:** Engine PBR shaders (`lighting_pbr.wgsl` and WebGL2 `light_calc_pbr.frag.glsl`) now add `ambientColor` to IBL `irradiance` (fixing the double `kD_ambient` scaling in WGSL too) instead of discarding `AmbientLight` whenever `u_irradianceMap` is active. `_toggleEnvMap` and `_resetToReference` also toggle `scene.environmentIntensity` (`1.0` / `0.0`).
- **glTF 2.0 Extension Benchmark Status:** All seven extensions originally noted as missing on 2026-10-31 are now shipped (`KHR_draco_mesh_compression` + `KHR_texture_basisu` via `@small-world-machine/gltf-extensions/register`; `KHR_texture_transform`, `KHR_materials_iridescence`, `KHR_materials_anisotropy`, `KHR_materials_specular`, `KHR_materials_unlit` built into `GltfMaterialParser` and all three renderer tiers, with extension texture maps supported on WebGL2 + WebGPU and factor fallbacks on WebGL1).

