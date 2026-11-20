# @small-world-machine/vfx-extras

> Particle and VFX pipeline for **Small World Machine**. Depends on `@small-world-machine/engine`, never the other way around ([ADR 0022](../../docs/adr/0022-gpu-instanced-vfx-pipeline-and-extras-package.md)).

## Contents

- **CPU particles:** `ParticleSystem` (SoA `Float32Array`, zero-GC tick), `ParticleMeshRenderer`, `ParticleTrailRenderer`, `ParticleLightPool`.
- **GPU particles:** `GPUParticleSystem` (WebGPU compute).
- **Affectors & spawners:** `affectors/*` (attractor, vortex, turbulence, curl noise, SDF collider), `EmitterShapes`, `SubEmitter`.
- **Math:** `Curve1D`, `ColorRamp`.
- **Prefabs:** `Fire` (`fire/*`), `AccretionDiskEmitter`.
- **Geometry:** `OctagonBillboardGeometry`.

## Tier support

| Feature                   | WebGL1                | WebGL2 | WebGPU |
| ------------------------- | --------------------- | ------ | ------ |
| CPU particles / renderers | yes                   | yes    | yes    |
| Soft particles (smoke)    | degraded (hard edges) | yes    | yes    |
| `GPUParticleSystem`       | —                     | —      | yes    |

## Usage

```typescript
import { ParticleSystem, ParticleMeshRenderer } from "@small-world-machine/vfx-extras";
```

Showcases: `apps/showcases/45` (fire), `apps/showcases/46` (particle variants).
