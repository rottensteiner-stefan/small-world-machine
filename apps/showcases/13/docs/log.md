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
- **Missing / Not Yet Implemented GLTF Extensions:**
  - `KHR_draco_mesh_compression` (runtime Draco geometry decoding)
  - `KHR_texture_basisu` (KTX2 / Basis Universal supercompressed textures)
  - `KHR_texture_transform` (per-material texture scale, offset, and rotation)
  - `KHR_materials_iridescence` (thin-film interference)
  - `KHR_materials_anisotropy` (directional microfacet reflection)
  - `KHR_materials_specular` (non-metal specular tint & F0 adjustment)
  - `KHR_materials_unlit` (unshaded material fallback)

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
