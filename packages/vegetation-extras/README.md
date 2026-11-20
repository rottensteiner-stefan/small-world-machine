# @small-world-machine/vegetation-extras

> Vegetation building blocks for **Small World Machine**: wind, ground cover, canopy coverage, foliage looks. Depends on `@small-world-machine/engine`.

## Contents

- **Wind:** `WindField`, `windShaders`.
- **Ground cover:** `GroundCoverSystem` (camera-centred rings), `GroundCover`, `GrassClump`.
- **Canopy:** `CanopyCoverage`.
- **Look:** `FoliageLook` presets, `ForestLookBlender`.
- **Species:** `VegetationSpecies`.

## Tier support

GLSL (WebGL2) and WGSL (WebGPU) paths. The instance-field wind lane is WebGPU + WebGL2; WebGL1 has no wind or dedicated variant and is not covered by tests.

## Usage

```typescript
import { WindField, GroundCoverSystem } from "@small-world-machine/vegetation-extras";
```

Showcases: `apps/showcases/51`, `apps/showcases/52` (foliage look lab).
