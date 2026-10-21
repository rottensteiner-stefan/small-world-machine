# Materials & Shaders

Small World Machine uses a flexible, physically-based rendering (PBR) foundation with a strong focus on custom shader integration.

## Core materials

- `StandardMaterial`: The primary PBR material, based on the Cook-Torrance BRDF model. Supports `color`, `metallic`, `roughness`, and diffuse, normal, roughness, and emissive textures.
- `PhongMaterial` & `LambertMaterial`: Non-PBR specular and diffuse materials, for classic stylized rendering.
- `BasicMaterial` & `WireframeMaterial`: Unlit materials for wireframe debugging, UI elements, or flat stylized assets.
- `GlassMaterial` & `FrostglassMaterial`: Glass and frosted-glass materials with configurable `ior`, `thickness`, and `transmission`.
- `DecalMaterial`: Projected box decals (see [Decals](./decals.md)).
- `CustomShaderMaterial`: User-supplied shader sources (see [Shader Importers](./shader-importers.md)).
- `SpriteMaterial`: 2D/2.5D camera-facing billboards and particles.
- `RetroScreenMaterial`: A specialized material that mimics old CRT monitors with scanlines and chromatic aberration.

---

## Fluid & liquid surfaces (ADR 0013)

Per **ADR 0013**, Small World Machine provides a unified architecture for liquids, split into two main families that share optimized shader chunks (`liquid_gerstner_wave`, `liquid_worley_noise`):

### 1. Wave family (transparent & refractive)

Driven by mathematical Gerstner wave displacement in the vertex shader and Worley-noise intersection foam in the fragment shader.

- `OpenWaterMaterial`: Realistic PBR ocean/water material with Gerstner waves, Fresnel reflections, and **opaque depth fade** for soft shorelines.
- `StylizedWaterMaterial`: Lightweight toon/anime water with sharp foam bands and cel-shading tint parameters.

```typescript
import { Object3D, Plane, OpenWaterMaterial, Color } from "@small-world-machine/engine";

const ocean = new Object3D("Ocean");
ocean.geometry = new Plane({
  width: 100,
  height: 100,
  widthSegments: 128, // High tessellation for Gerstner wave vertex displacement
  heightSegments: 128,
}).getGeometryData();

ocean.material = new OpenWaterMaterial({
  waterColor: new Color(0.1, 0.4, 0.6),
  deepWaterColor: new Color(0.01, 0.05, 0.2),
  speed: 1.0,
  foamDistance: 0.8,
});

this.scene.add(ocean);
```

### 2. Flow family (noise-driven & emissive-capable)

Driven by procedural noise flow and distortion on the surface, supports opaque depth-writing or translucent blending.

- `FluidSurfaceMaterial`: The generalized base class for flow-based liquids.
- `LavaMaterial`: Opaque molten rock with adjustable emissive glow intensity and thermal heat gradients.
- `SlimeMaterial`: Translucent, dripping toxic slime with ambient edge glow and high surface viscosity.

```typescript
import { Object3D, Plane, LavaMaterial, Color } from "@small-world-machine/engine";

const lavaPool = new Object3D("LavaPool");
lavaPool.geometry = new Plane({ width: 30, height: 30 }).getGeometryData();
lavaPool.material = new LavaMaterial({
  color: new Color(0.25, 0.03, 0.0),
  edgeColor: new Color(0.15, 0.02, 0.0),
  emissiveColor: new Color(1.0, 0.35, 0.05),
  emissiveStrength: 2.0,
  flowSpeed: 0.3,
  viscosity: 14.0,
});

this.scene.add(lavaPool);
```
