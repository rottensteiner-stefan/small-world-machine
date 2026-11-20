# @small-world-machine/liquid-extras

> Art-direction liquid materials and drop physics for **Small World Machine**. Depends on `@small-world-machine/engine`. Core liquids (`OpenWaterMaterial`, `StylizedWaterMaterial`, `LavaMaterial`, `SlimeMaterial`) live in the engine (`core/materials/liquid/`), not here.

## Contents

- **Materials:** `NoirWaterMaterial`, `OilPuddleMaterial`, `OilSlickMaterial`, `RainPuddleMaterial`.
- **Shading:** thin-film interference (`shading/thinFilm`).
- **Drops:** `DropImpactSystem`, `DropProperties`, `DropRegime`, `DropSurfaceParams`, `FluidProperties`.

## Tier support

GLSL (WebGL2) and WGSL (WebGPU) variants ship per material. WebGL1 has no dedicated variant and is not covered by tests.

## Usage

```typescript
import { RainPuddleMaterial } from "@small-world-machine/liquid-extras";
```

Showcase: `apps/showcases/10` (liquid gallery).
