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
- `rendererType` (string): The preferred renderer (e.g. `BEST`, `WEB_GPU`, `WEB_GL2`).
- `projectionType` (string): Either `PERSPECTIVE` or `ORTHOGRAPHIC`.
- `fullscreen` (boolean): Whether the canvas should automatically scale to the window size.
- `gravity` (number[]): A 3-element array defining the physics gravity vector (e.g. `[0, -9.81, 0]`).

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

- `autoDowngrade` (boolean, default: true): When `true`, the engine automatically overrides expensive settings (such as MSAA or HDR) once it detects a low-power device (e.g. smartphones).
- `maxPixelRatio` (number, default: 2): Caps `window.devicePixelRatio`. Extremely high-resolution displays (like modern smartphones with a DPR of 3.0 or 4.0) can cause massive GPU bottlenecks. Capping this at `2` or `1.5` keeps framerates smooth without a noticeable loss of quality.
- `msaa` (number): Multisample anti-aliasing level (0, 2, 4, 8).
- `maxAnisotropy` (number): Anisotropic filtering level (1, 4, 8, 16) for sharper textures at shallow viewing angles.
- `hdr` (boolean): Enables high-dynamic-range (Float16) rendering pipelines.
- `toneMapping` (string): The tone mapping algorithm to use (e.g. `aces`, `reinhard`, `none`).
- `maxShadowResolution` (number): Maximum texture size for shadow maps.
- `disableTextures` (boolean): When `true`, all textures are bypassed and fallback colors are rendered (useful for debugging).

### Post-processing (`postProcessing`)

Configures the post-processing pipeline. General pipeline settings (`enabled`, `filterMode`) sit at the top level; each individual effect's own tunable values are nested one level deeper, under `effects` — a flat object with one optional key per effect, not a `type`-tagged array (the pipeline's effect order is hardwired internally and doesn't depend on config order). Each individual effect also has its own `enabled` flag, so settings for an effect can be stored without switching it on yet.

```json
"postProcessing": {
  "enabled": true,
  "effects": {
    "toneMapping": { "enabled": true, "mode": "aces", "exposure": 1.0, "gamma": 2.2 },
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

Every field is optional and only overrides that specific value on top of the effect's own defaults — fields that shouldn't be changed don't need to be specified.

- **`bloom`** — soft glow around bright areas via dual-Kawase blur filtering (see `REFERENCES.md`). `color` can also be set as `{ "r", "g", "b" }` or a 3-element array.
- **`vignette`** / **`grain`** / **`quantize`** — classic edge darkening, film-grain noise, and color banding/posterization, respectively.
- **`hbao`** — screen-space ambient occlusion (a simplified HBAO, not GTAO — see `docs/research/aaa-engine-techniques.md` for the exact scope). WebGL/WebGPU only.
- **`taa`** — simplified temporal anti-aliasing: sub-pixel camera jitter plus an exponential history blend, no motion-vector reprojection. Smooths edges in static/slow-moving scenes; visible ghosting during fast motion. WebGL/WebGPU only.
- **`motionTrail`** — a *deliberate* ghost/afterimage effect (not anti-aliasing) that reuses the same history-blend mechanism as `taa` with a significantly higher feedback value. WebGL/WebGPU only.

### Projections & audio

- `projection`: Camera options such as `fov`, `near`, `far`, etc.
- `audio`: Sound configuration (e.g. global volume, distance model).

## Full configuration example

```json
{
  "canvasId": "SmallWorldMachine",
  "rendererType": "BEST",
  "projectionType": "PERSPECTIVE",
  "fullscreen": true,
  "gravity": [0, -9.81, 0],
  "quality": {
    "autoDowngrade": true,
    "maxPixelRatio": 2,
    "hdr": true,
    "toneMapping": "aces",
    "msaa": 4,
    "maxAnisotropy": 16,
    "maxShadowResolution": 2048
  },
  "postProcessing": {
    "enabled": true,
    "effects": {
      "bloom": { "enabled": true, "intensity": 0.8 }
    }
  }
}
```
