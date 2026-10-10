# Modular Ecosystem & Domain Layering

Per **ADR 0014**, Small World Machine follows a strict 4-tier domain architecture instead of a generic catch-all folder.

## Package landscape

Since the npm-workspaces restructuring, the engine lives in a single package (`@small-world-machine/engine`, `packages/engine/`), and optional, domain-specific code is factored out into **separate ecosystem packages** that depend exclusively on `@small-world-machine/engine` — never the other way around. This keeps the core lean and lets third-party developers contribute their own packages following the same pattern.

| Package | Directory | Purpose |
| --- | --- | --- |
| `@small-world-machine/gltf-extensions` | `packages/gltf-extensions/` | Data-level glTF extensions (Draco, BasisU/KTX2) — see ADR 0017/0018 |
| `@small-world-machine/geometry-extras` | `packages/geometry-extras/` | Exotic & procedural geometries (supershapes, torus knots, lathe, Platonic solids, parametric surfaces, filled polygons, Voronoi cells, marching cubes) outside the core primitive catalog |
| `@small-world-machine/physics-extras` | `packages/physics-extras/` | Higher-level physics building blocks (e.g. Voronoi fractures with `ConvexHull` colliders) |
| `@small-world-machine/vfx-extras` | `packages/vfx-extras/` | GPU-instanced particle/VFX pipeline (`ParticleSystem`, `ParticleMeshRenderer`, `AccretionDiskEmitter`, force-field affectors such as `PointAttractorAffector`/`VortexAffector`/`TurbulenceAffector`) — see [ADR 0022](/adr/0022-gpu-instanced-vfx-pipeline-and-extras-package) |
| `@small-world-machine/tools` | `packages/tools/` | Development tools (Maker, Material Studio, Pixler, Xtractor, Map Generator, Forge) — see [ADR 0024](/adr/0024-tools-ecosystem-package) |

Each extras package extends central public engine contracts (`AbstractGeometry`, `GltfExtensionPlugin`, ...) and is independently testable — the same extension principle that ADR 0018 establishes for the glTF data level and ADR 0021 establishes for geometry/physics.

## Domain structure

1. **Tier 1 — Core engine (`packages/engine/src/core/`, `packages/engine/src/renderers/`, `packages/engine/src/geometry/`, `packages/engine/src/math/`):**
   Math, scene graph, cameras, renderers, passes, shaders, and core primitives (including `BillboardInstancer` and `ImposterBaker`).
2. **Tier 2 — Environment & atmosphere (`packages/engine/src/environment/`):**
   Weather, atmospheric particle systems (`WeatherEmitter`), sky systems, and liquid surfaces.
3. **Tier 3 — Behaviors & simulation (`packages/engine/src/core/behaviors/`, `packages/engine/src/behaviors/`):**
   Controllers, sensors, animation loops, and ambient creature life (`RatGroomingBehavior`, `GroomingRat`).
4. **Tier 4 — ProcGen & tool extension point (`packages/engine/src/geometry/procgen/`, `packages/engine/src/core/forge/ForgeTool.ts`):**
   Procedural level generators (`GridLevelBuilder`) and the `ForgeTool` interface. The concrete authoring tools themselves (`MakerApp`, `MapGenerator`, `Pixler`, `Xtractor`, `Forge`) have lived in their own `@small-world-machine/tools` package since [ADR 0024](/adr/0024-tools-ecosystem-package), no longer in the core.

## Example: Procedural grid generation (`GridLevelBuilder`)

`GridLevelBuilder` lives in `packages/engine/src/geometry/procgen/` (exported through the `@small-world-machine/engine` tooling surface, a genuine runtime feature rather than a development tool) and lets you define 3D levels from ASCII grids.

### Usage

```typescript
import { GridLevelBuilder, GridLevelConfig, Object3D } from "@small-world-machine/engine";

const builder = new GridLevelBuilder();

// Define the legend that maps ASCII characters to meshes or logic
const config: GridLevelConfig = {
  gridSize: 2.0,
  legend: {
    "#": {
      type: "custom",
      onBuild: (x, y, worldX, worldZ) => {
        const wall = new Object3D(`Wall_${x}_${y}`);
        // Add geometry, materials...
        wall.position.set(worldX, 1.0, worldZ);
        return wall; // Returned object is automatically added to the scene
      },
    },
    "P": {
      type: "custom",
      onBuild: (x, y, worldX, worldZ) => {
        this.camera.position.set(worldX, 1.0, worldZ);
        return undefined; // We add no object, we just move the camera
      },
    },
  },
};

// Define the map as a single, newline-separated string
const myMap = ["#######", "#P    #", "#######"].join("\n");

// Build the map (async — resolves to the world position of the first "P" spawn, or the map center)
await builder.build(this.scene, myMap, config);
```
