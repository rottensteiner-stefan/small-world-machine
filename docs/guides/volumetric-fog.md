# Volumetric Fog (Froxels)

True 3D volumetric fog ("Froxel Stage 3", Stufe 3 of the fog & volumetric lighting roadmap) —
a frustum-aligned 3D volume that accumulates in-scattering against local and directional lights
and composites it into the scene *before* tonemapping. Design and decisions: ADR 0031; the
binding grid formula lives in `packages/engine/src/math/froxel.ts`.

This effect is **opt-in** and supported with full parity across both **WebGPU** (3D compute injection, temporal reprojection, in-register integration, and single-tap trilinear composite) and **WebGL2** (half-resolution screen-space raymarching with depth-aware cross-bilateral upsampling). WebGL1 stays on the analytic fog of `Scene.fog`.

## Relationship to the other fog layers

| Layer | Purpose | Backends |
|---|---|---|
| `Scene.fog` (analytic) | Stufe 1 distance/height fog, always available | WebGL1 / WebGL2 / WebGPU |
| `LightShaftsElement` | Stufe 2 crepuscular rays against CSM | All (hybrid tiers) |
| `VolumetricFogElement` | Stufe 3 true 3D volume, local + directional light | WebGPU & WebGL2 |

The analytic fog stays active in parallel; the volumetric contribution is **strictly additive**
to it, never a replacement.

## Enabling the effect

`VolumetricFogElement` is a post-processing element, off by default like `LightShaftsElement`:

```ts
const fog = new VolumetricFogElement();
fog.enabled = true;
fog.density = 0.02;        // scattering extinction coefficient of the medium
fog.maxDistance = 80;      // clamped against the scene far plane
fog.intensity = 1.0;       // overall in-scattering multiplier
app.postProcessing.add(fog);
```

## Parameters (`VolumetricFogElement`)

| Property | Default | Meaning |
|---|---|---|
| `density` | `0.02` | Global baseline scattering/extinction coefficient; denser volume = more pronounced shafts. |
| `height` | `0.0` | World-space baseline of the exponential fog layer; density falls off above it. |
| `heightFalloff` | `1.0` | Exponential height falloff coefficient (`0` = uniform density volume). |
| `maxDistance` | `80.0` | Max world-space evaluation distance (clamped to the far plane). |
| `intensity` | `1.0` | Multiplier of the accumulated in-scattering, applied once in the composite pass (transmittance is unaffected). |
| `scatteringAlbedo` | `1.0` | Single-scattering albedo $\omega = \sigma_s / \sigma_t$ (0..1). Lower values absorb more of the extinction: smoke and dust that darken instead of glow. |
| `localLightShadows` | `true` | Spot lights that cast shadows also shadow their fog in-scattering (objects cut shafts and dark wedges out of the cones). Reuses the existing spot shadow maps, at most 4, no extra render pass. Point lights have no shadow maps in the engine and scatter unshadowed. |
| `ambientInject` | `0.0` | How strongly scene ambient light and the IBL irradiance from above (`Scene.irradianceMap`, both backends) scatter in the fog; lifts fog in shadow (like Godot's Ambient Inject). |
| `asymmetry` | `0.4` | Henyey-Greenstein asymmetry factor $g \in (-1, 1)$. Positive = forward scattering towards the light. |
| `castDirectionalShadow` | `true` | Directional (sun/moon) self-shadowing through the existing CSM. |
| `color` | `Color(1, 1, 1)` | Tint of the scattered light (sun, local lights and ambient), on top of each light's own colour. |
| `jitter` | `0.25` | Sub-voxel jitter strength. `0` disables jitter *and* the temporal filter (history weight 0.9 while jittering, 0 otherwise). |

---

## Dynamic Fog Volumes (`FogVolume`)

`FogVolume` objects are scene-graph nodes (`Object3D`) that inject localized analytical participating media into the 3D froxel grid (WebGPU) or screen-space raymarch volume (WebGL2).

```ts
import { FogVolume, FogVolumeShape, Vector3, Color } from '@small-world-machine/engine';

// Positive mist volume with procedural turbulence
const mist = new FogVolume({
  shape: FogVolumeShape.Sphere,
  size: new Vector3(8, 8, 8),
  density: 0.15,
  albedo: new Color(0.2, 0.7, 0.9),
  edgeFade: 0.25,
  noiseScale: 0.35,
  noiseAmount: 0.6,
  noiseSpeed: 0.25,
});
mist.position.set(0, 1.5, -12);
scene.add(mist);
```

### FogVolume Parameters

| Property | Default | Meaning |
|---|---|---|
| `shape` | `FogVolumeShape.Box` | Analytical SDF primitive: `Box`, `Sphere`, or `Cylinder`. |
| `size` | `Vector3(2, 2, 2)` | Extents / dimensions in local space (width, height, depth). |
| `density` | `1.0` | Local extinction coefficient. **Negative values carve out fog!** |
| `edgeFade` | `0.1` | Fraction of volume radius/half-extents over which boundary softly fades to zero. |
| `albedo` | `Color(1, 1, 1)` | Single-scattering albedo color tint. |
| `emission` | `Color(0, 0, 0)` | Self-luminous volumetric emission color (e.g. fire, glowing braziers, neon portals). |
| `noiseScale` | `0.0` | World-space frequency of the 3D procedural value noise / fBm. |
| `noiseAmount` | `0.0` | Modulation amplitude of 3D turbulence ($0.0$ = smooth medium, $1.0$ = deep billowy clouds). |
| `noiseSpeed` | `0.0` | Velocity of time-based wind drift through the noise field. |

### Interior Carving (Negative Density)

To keep interior spaces (such as indoor vaults, underground bunkers, crypts, or caves) completely fog-free without requiring expensive geometry clipping or stencil passes, simply place a `FogVolume` with negative density encompassing the room:

```ts
// Interior room carving: zeroes out participating extinction
const interiorCarver = new FogVolume({
  shape: FogVolumeShape.Box,
  size: new Vector3(12, 6, 16),
  density: -1.2, // Clamps extinction: max(0.0, globalExtinction + volDensity)
  edgeFade: 0.05,
});
interiorCarver.position.set(0, 3, -25);
scene.add(interiorCarver);
```

Both backends clamp participating medium extinction via $\text{extinction} = \max(0.0, \text{extinction} + \text{volDensity})$, cleanly eroding all global fog and shafts within the volume bounds.

---

## How It Works

### WebGPU (Compute Tier)
1. **Froxel Injection (`froxel_inject.wgsl`):**
   - Dispatches over the clustered light grid itself (16 px screen tiles, log-staggered depth slices), one froxel per cluster cell.
   - Injects exponential height-falloff media and evaluates analytical `FogVolume` SDFs with 3D procedural noise.
   - Accumulates in-scattered light $\sigma_s \cdot L$ from the Clustered Forward+ light lists (ADR 0007 / Option R) with a Henyey-Greenstein phase, scaled per light by `AbstractLight.volumetricIntensity`, plus optional ambient inject. Local lights are unshadowed; only the sun is shadowed (CSM, in the integration pass).
2. **3D Temporal Reprojection (`froxel_reproject.wgsl`):**
   - Applies sub-voxel jitter $(j_x, j_y, j_z)$ per frame.
   - Reprojects previous frame samples using inverse camera view-projection matrices.
   - Evaluates a 7-tap 3D neighborhood to construct a tight AABB and clamps history with 5% hysteresis, eliminating camera-motion ghosting while suppressing spatial aliasing.
3. **In-Register Z-Integration (`froxel_integrate.wgsl`):**
   - Dispatches one workgroup per screen tile (`@workgroup_size(8, 8, 1)`).
   - Accumulates front-to-back optical depth $\tau$, transmittance $T = e^{-\tau}$, and in-scattered radiance along camera depth slices using workgroup registers.
   - Adds the sun ($\sigma_s \cdot L_{sun} \cdot$ CSM shadow $\cdot$ phase) and applies a Decima-style powder term to the in-scattered light only; the transmittance stays plain Beer-Lambert. The value stored per slice is the integral up to the slice centre.
4. **Fullscreen Composite (`VolumetricFog.frag.wgsl`):**
   - Performs a single $O(1)$ trilinear texture sample into the 3D integrated volume at the fragment's reconstructed screen-space view depth.
   - `PostProcess.frag.wgsl` attenuates the HDR scene by the transmittance and adds the in-scattering *before* tonemapping.

### WebGL2 (Fragment Tier)
1. **Half-Resolution Raymarching (`VolumetricFogPassGL`, `VolumetricFog.frag.glsl`):**
   - Raymarches 16–24 logarithmic steps between camera near and opaque depth buffer.
   - Uses Interleaved Gradient Noise (IGN) jitter to disperse step banding.
   - Evaluates directional CSM self-shadowing and analytical `FogVolume` SDFs (including negative density carving).
2. **Depth-Aware Cross-Bilateral Upsampling (`VolumetricFogBilateral.frag.glsl`):**
   - Reconstructs full-resolution fog using depth-weighted bilateral cross-filtering.
   - Prevents haloing and bleeding across high-frequency geometry silhouettes.
3. **Composite:**
   - Attenuates the scene by the transmittance and adds the in-scattering pre-tonemapping through `PostProcess.frag.glsl`. The WebGL2 path is a per-pixel raymarch, so the look is close to, but not identical with, WebGPU (no local-light scattering).

---

## Interactive Showcase

Check out **Showcase 39 ("Atmospheric Sanctum")** at [`apps/showcases/39/`](file:///Users/srottensteiner/PhpstormProjects/rottensteiner-stefan/small-world-machine/apps/showcases/39/):
- Monumental colonnade nave with high clerestory skylight casting sharp 4-cascade CSM shafts.
- Swirling cyan mist with rolling 3D noise turbulence at the altar.
- Warm amber emissive brazier sphere.
- Negative density interior carving volume ($Z = -21$, density = -1.2) keeping the rear vaulted sanctuary crystal clear.
- Interactive controls: `[F]` toggle fog, `[C]` toggle interior carving, `[N]` toggle 3D noise, `[1]`/`[2]` rotate sun angle, `[V]` switch fly/orbit camera.

---

## Time and frame context

Everything that animates (mist drift, jitter) reads `renderer.frameInfo` (`FrameInfo`), written by `SmallWorldMachine.step()`: gameplay `time` (hit-stop scaled, drives the fog), `realTime` (unscaled, drives post effects such as grain) and `frameIndex`. Set `SmallWorldMachine.captureFrameRate` (e.g. `60`) to advance the realtime loop by a fixed `1 / captureFrameRate` per frame for reproducible recordings; call `step()` a few frames first so the temporal history converges.

Every showcase accepts `?captureFps=60`, which sets `captureFrameRate` before the first frame. Measured on WebGPU with Showcase 39 (2026-10-17, one device/driver): two fresh page loads with `?captureFps=60` produced identical full-resolution pixel hashes at frames 10, 30, 300, 420 and 600 (frame 600 = exactly 10.0 s), i.e. the temporal fog history is deterministic given the frame index. With the scene frozen (`step(0)`) the image was already inside the jitter noise floor (0.4-0.8 of 255 mean absolute difference at 96x54, no downward trend) 4 frames after the start, so no visible warm-up is needed for this scene; scenes with strong, fast-changing light still smear by the 0.9 history weight. Equality is expected only on the same device and driver.

`npm run test:fog-capture` automates this check (`scripts/check-fog-capture.js`): it loads Showcase 39 (fog) and Showcase 28 (glass, emissive textures) in two fresh pages per backend (WebGL1, WebGL2, WebGPU; WebGPU is skipped if unusable) at 640x360, hashes frames 10, 30 and 120 and fails on any difference (~90 s; `--showcases`, `--backends`, `--runs`, `--frames` override). A showcase needs a `window.__showcase<id>` QA hook. In CI it is the manual `capture-determinism` job (Actions > CI > Run workflow, input `capture`): WebGL1 and WebGL2 on the runner's software GPU, informational (`continue-on-error`) until it has proven itself there; hashes are compared only between the two runs inside that job, never across machines. Run it against a frozen build (`BASE_URL=...` pointing at a static copy of `dist/`), not against a dev server whose source is being edited: a live-edited tree makes WebGL2 look non-deterministic. Verified: all three backends identical on a frozen build, and a negative control with a varying `captureFps` is reported as DIFF.
