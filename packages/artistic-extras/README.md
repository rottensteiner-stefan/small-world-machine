# @small-world-machine/artistic-extras

> Stylized and mixed-media materials and post-processors for **Small World Machine**. Depends on `@small-world-machine/engine`.

## Contents

- **Materials:** `MetalReliefMaterial`, `MetalReliefScreenMaterial`, `ImpastoStrokeMaterial` (palette-knife impasto).
- **Post:** `MetalReliefPostProcessor` (WebGL2 and WebGPU paths).
- **Math:** `ArtisticColorUtils`, `StrokeRaster`.

## Tier support

GLSL (WebGL2) and WGSL (WebGPU) material paths. `MetalReliefPostProcessor.applyToCanvas` runs on its own canvas context (`webgl2`, falling back to `webgl`) and throws only if neither is available (fail fast on active use). Materials have no dedicated WebGL1 variant and are not covered by tests there.

## Usage

```typescript
import { ImpastoStrokeMaterial } from "@small-world-machine/artistic-extras";
```
