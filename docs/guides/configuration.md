# Configuration (EngineOptions)

Small World Machine is designed for extensive configurability. Passing an `EngineOptions` object to the `SmallWorldMachine` constructor lets you fine-tune rendering capabilities, post-processing pipelines, quality limits, and physics.

> **Note:** The engine used to attempt loading `small-world-machine.json` at runtime via an internal HTTP request. This was removed in favor of **Inversion of Control (IoC)**. Configuration must now be passed explicitly.

## Basic setup

In modern build tools like Vite or Webpack, the JSON file can simply be imported and passed to the engine.

```typescript
import config from "./config/small-world-machine.json"; // The bundler handles this automatically
import { SmallWorldMachine } from "@small-world-machine/engine";

class MyGame extends SmallWorldMachine {
  constructor() {
    super(config); // Inject configuration
  }

  protected async setupScene() {
    // ...
  }
}
```

## The EngineOptions structure

The `EngineOptions` object defines the entire state of the core engine. Below are the most important sections of the configuration object.

### Root options

- `canvasId` (string): The ID of the HTML canvas element to render into.
- `rendererType` (string): The preferred renderer (e.g. `BEST`, `WEB_GPU`, `WEB_GL2`, `CANVAS`).
- `projectionType` (string): One of `PerspectiveProjection`, `OrthographicProjection` or `ObliqueProjection` (see `ProjectionType`).
- `fullscreen` (boolean): Whether the canvas should automatically scale to the window size.
- `gravity` (number[]): A 3-element array defining the physics gravity vector (e.g. `[0, -9.81, 0]`). Only takes effect with `enablePhysics: true` (default `false`).
- `enablePhysics` (boolean), `enableOcclusionCulling` (boolean), `width` / `height` (number), `inputMode`: further root options, see `EngineOptions`.

### Renderer backend attributes (`renderer`)

Context attributes per backend (passed to `getContext()`), indexed by backend name — **not** a fallback-order list. The actual fallback chain (WebGPU → WebGL2 → WebGL1, when a backend isn't supported) is hardwired into the engine and doesn't depend on this object at all — so there is no `type`-tagged array here, as might otherwise seem necessary.

```json
"renderer": {
  "WEB_GPU": {},
  "WEB_GL2": { "attributes": { "antialias": false } },
  "WEB_GL1": {}
}
```

### Quality options (`quality`)

These control the engine's graphical fidelity.

- **Automatic quality tiers (ADR 0035):** The engine detects the device tier once
  (`DeviceCaps.getPerformanceTier()`: `LOW`/`MEDIUM`/`HIGH`) before the renderer is created and
  applies a per-tier policy (HDR/MSAA/anisotropy/shadow caps, plus per-effect post toggles on
  `LOW`). The configuration is resolved exactly once and then closed — nothing mutates
  `quality`/`postProcessing` afterwards. Every field you set **explicitly** in your own
  `quality`/`postProcessing` wins against the tier (generic override lock, "author choice
  locks out auto"); leave a field unset to let the tier decide. `HIGH` reproduces today's
  desktop behavior untouched. (The former manual `autoDowngrade` boolean is gone.)
  **Testing override:** the URL parameter `?tier=low|medium|high` (or `DeviceCaps.forcedTier`)
  bypasses detection to simulate a device class — deterministic golden renders, ADR-0035
  counter-checks on a forced `LOW`.
- `maxPixelRatio` (number, default: 2): Caps `window.devicePixelRatio`. Extremely high-resolution displays (like modern smartphones with a DPR of 3.0 or 4.0) can cause massive GPU bottlenecks. Capping this at `2` or `1.5` keeps framerates smooth without a noticeable loss of quality.
- `msaa` (number): Multisample anti-aliasing level (0, 2, 4, 8).
- `maxAnisotropy` (number): Anisotropic filtering level (1, 4, 8, 16) for sharper textures at shallow viewing angles. Enforced on mipmapped linear-filtered 2D textures on all backends (WebGL1/WebGL2 via the extension, WebGPU via `GPUSamplerDescriptor.maxAnisotropy`, both clamped to 16). A texture's `anisotropy` option inherits this engine level by default; `0` on a texture disables it for that texture.

  **Checking it by eye:** Showcase 10 accepts `?aniso=N` (cap at N, `1` = off; without it the engine default of 4 applies). On an Apple M4 Pro the detail in the far field rose by about 20 % from level 1 to 4, by 4 % more from 4 to 8 and by 1 % from 8 to 16, on both backends.
- `hdr` (boolean): Enables high-dynamic-range (Float16) rendering pipelines.
- `toneMapping` (string): The tone mapping algorithm to use (e.g. `aces`, `reinhard`, `none`).
- `autoInstancing` (boolean, default `true`, ADR 0046): The renderer draws consecutive opaque
  objects that share a geometry and a material as **one** instanced draw (main pass, shadow
  passes, depth pre-pass; WebGPU and WebGL2). The scene graph is untouched: every object keeps
  its own picking, behaviors, culling and bounds. Runs start at 4 objects; skinned meshes,
  sprites, decals, vertex-colored geometry and `InstancedMesh` stay on their own paths. An
  object with its own material instance (e.g. a recolored one) simply leaves the run. Set
  `false` to debug per-object draws. Showcase 19 (1600 cubes): 6695 → 6 draws per frame on
  WebGPU, 5660 → 5 on WebGL2.
- `shadowMode` (`"pcss"` | `"evsm"`): Optional directional-shadow algorithm. `"evsm"`
  (Exponential Variance Shadow Maps, see `docs/guides/shadows.md` and ADR 0043) renders
  warped variance moments and evaluates a Chebyshev bound with light-bleeding reduction;
  `"pcss"` — the default — keeps PCSS on WebGPU and WebGL2. `"evsm"` requires WebGPU or
  WebGL2 with `EXT_color_buffer_float`; WebGL2 falls back to PCSS with a console warning
  when the extension is missing, and WebGL1 ignores it entirely.
- `shadowSoftness` (number): PCSS penumbra multiplier (default 1, `0` = hard 3×3 PCF; see
  `docs/guides/shadows.md`). Directional lights on WebGPU and WebGL2, spot lights on WebGPU
  only. `"evsm"` uses its own fixed penumbra filtering.
- `shadowMaxPcfRadius` (number): cap on the PCSS filter radius in shadow-map texels (default 4),
  same scope as `shadowSoftness`.
- `disableTextures` (boolean): When `true`, all textures are bypassed and fallback colors are rendered (useful for debugging).

### Post-processing (`postProcessing`)

Configures the post-processing pipeline. General pipeline settings (`enabled`, `filterMode`) sit at the top level; each individual effect's own tunable values are nested one level deeper, under `effects` — a flat object with one optional key per effect, not a `type`-tagged array (the pipeline's effect order is hardwired internally and doesn't depend on config order). Each individual effect also has its own `enabled` flag, so settings for an effect can be stored without switching it on yet.

```json
"postProcessing": {
  "enabled": true,
  "effects": {
    "toneMapping": { "enabled": true, "mode": 3, "exposure": 1.0, "gamma": 2.2 },
    "vignette": { "enabled": true, "offset": 0.8, "darkness": 0.5, "roundness": 2.0 },
    "grain": { "enabled": true, "intensity": 0.05 },
    "bloom": { "enabled": true, "threshold": 1.0, "softThreshold": 0.5, "intensity": 1.0, "radius": 0.85 },
    "quantize": { "enabled": false, "steps": 8 },
    "hbao": { "enabled": false, "radius": 0.5, "intensity": 1.0 },
    "taa": { "enabled": false, "feedback": 0.9 },
    "motionTrail": { "enabled": false, "feedback": 0.92 }
  }
}
```

> **Note — not exhaustive:** The `effects` schema above is a *selection*; the same flat
> `effects` structure contains further effects (`flash`, `colorGrading`, `gravitationalLensing`,
> `lightShafts`, `volumetricFog`, `depthOfField`) that can be configured in the same style.
> `toneMapping.mode` here is the numeric `ToneMappingMode` (`NONE`=0, `REINHARD`=1, `CINEON`=2, `ACES_FILMIC`=3); only `quality.toneMapping` takes strings such as `"aces"`.

Every field is optional and only overrides that specific value on top of the effect's own defaults — fields that shouldn't be changed don't need to be specified.

- **`bloom`** — soft glow around bright areas via dual-Kawase blur filtering (see `REFERENCES.md`). `color` can also be set as `{ "r", "g", "b" }` or a 3-element array.
- **`vignette`** / **`grain`** / **`quantize`** — classic edge darkening, film-grain noise, and color banding/posterization, respectively.
- **`hbao`** — screen-space ambient occlusion (a simplified HBAO, not GTAO — see `docs/research/aaa-engine-techniques.md` for the exact scope). WebGL/WebGPU only.
- **`taa`** — simplified temporal anti-aliasing: sub-pixel camera jitter plus an exponential history blend, no motion-vector reprojection. Smooths edges in static/slow-moving scenes; visible ghosting during fast motion. WebGL/WebGPU only.
- **`motionTrail`** — a *deliberate* ghost/afterimage effect (not anti-aliasing) that reuses the same history-blend mechanism as `taa` with a significantly higher feedback value. WebGL/WebGPU only.

### Projections

- `projectionOptions`: Camera options `fov` (in **radians**), `near`, `far`, `orthoSize`.
- `projectionInstance`: A ready-made projection instance instead of options.

## Full configuration example

```json
{
  "canvasId": "SmallWorldMachine",
  "rendererType": "BEST",
  "projectionType": "PerspectiveProjection",
  "fullscreen": true,
  "gravity": [0, -9.81, 0],
  "quality": {
    "maxPixelRatio": 2,
    "hdr": true,
    "toneMapping": "aces",
    "msaa": 4,
    "maxAnisotropy": 16
  },
  "postProcessing": {
    "enabled": true,
    "effects": {
      "bloom": { "enabled": true, "intensity": 0.8 }
    }
  }
}
```
