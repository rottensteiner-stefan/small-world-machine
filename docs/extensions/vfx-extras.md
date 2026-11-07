# VFX Extras (`@small-world-machine/vfx-extras`)

`@small-world-machine/vfx-extras` is an optional ecosystem package that provides a particle system with force-field affectors and GPU-instanced rendering. It depends on `@small-world-machine/engine`.

## Import

```typescript
import {
  ParticleSystem,
  ParticleMeshRenderer,
  AccretionDiskEmitter,
  PointAttractorAffector,
  VortexAffector,
  TurbulenceAffector,
  DragAffector,
  ColorOverLifeAffector,
  SizeOverLifeAffector,
  BouncePlaneAffector,
} from "@small-world-machine/vfx-extras";
```

## Components

### `ParticleSystem`

Fixed-capacity particle pool (`capacity`, default 1000) in structure-of-arrays form: one `Float32Array` per field, addressed by slot index. Freed slots are reused through a free list; `update()` allocates nothing.

| Member | Description |
|---|---|
| `emit(options)` | Spawns a particle and returns its slot index |
| `update(dt)` | Integrates and applies all affectors |
| `affectors`, `addAffector()`, `removeAffector()` | Manage the affector list |
| `compact()`, `clear()` | Reclaim dead slots / remove all particles |
| `activeCount`, `isAlive(index)` | State queries |
| `onParticleDied(index)` | Optional callback with the slot index |

```typescript
const system = new ParticleSystem({
  capacity: 2000,
  onParticleDied: (index) => {
    // e.g. respawn
  },
});
```

### `ParticleMeshRenderer`

Renders a `ParticleSystem` as one `InstancedMesh` (one draw call). `sync()` writes matrices and, if `enableColorBuffer` is true (default), RGBA colors into the instance buffers. Dead or invisible particles get scale 0.

```typescript
import { Sphere, StandardMaterial } from "@small-world-machine/engine";

const renderer = new ParticleMeshRenderer({
  system,
  geometry: new Sphere({ radius: 0.05 }).getGeometryData(),
  material: new StandardMaterial(),
});
scene.add(renderer.mesh);

// each frame
system.update(dt);
renderer.sync();
```

### Affectors

Affectors modify `position`, `velocity`, `acceleration`, `color`, `size`, `alpha` and `heat` per time step.

| Affector | Effect |
|---|---|
| `PointAttractorAffector` | Gravity-like attraction, Plummer potential: $F = \frac{G \cdot M \cdot r}{(r^2 + \epsilon^2)^{3/2}}$ |
| `VortexAffector` | Tangential acceleration plus centripetal pull |
| `PlanarSpringAffector` | Damped spring toward a plane: $F_y = -k \cdot y - d \cdot v_y$ |
| `ThermalCoolingAffector` | Compression heating and radiative cooling |
| `FadeOutZoneAffector` | Alpha ramp between `r_in` and `r_out` |
| `TurbulenceAffector` | Trigonometric 3D curl noise |
| `DragAffector` | $\mathbf{F} = -(\gamma_1 + \gamma_2 \|\mathbf{v}\|) \mathbf{v}$ |
| `ColorOverLifeAffector` | Color and alpha gradient over lifetime |
| `SizeOverLifeAffector` | Scale curve over lifetime |
| `BouncePlaneAffector` | Elastic reflection at the plane $y = y_0$ |

### `AccretionDiskEmitter`

Prebuilt accretion-disk simulation with a Keplerian orbital velocity $v(r) = \sqrt{M / r} \cdot f_{\text{drift}}$, event-horizon absorption, redshift fade and thermal cooling. It exposes its `system` and the affectors it created (`attractor`, `planarSpring`, `thermal`, `fadeOut`).

| Option | Default |
|---|---|
| `particleCount` | 400 |
| `center` | `(0, 0, 0)` |
| `innerRadius` / `outerRadius` | 0.6 / 3.0 |
| `eventHorizonRadius` | 0.35 |
| `fadeStartRadius` | 0.55 |
| `mass` | `particleCount` |
| `diskThickness` | 0.2 |
| `driftFactor` | 0.98 |

```typescript
const disk = new AccretionDiskEmitter({ particleCount: 1500, outerRadius: 3.2, mass: 1500 });
const renderer = new ParticleMeshRenderer({
  system: disk.system,
  geometry: new Sphere({ radius: 0.04 }).getGeometryData(),
  material: new StandardMaterial(),
});
scene.add(renderer.mesh);

// each frame
disk.update(dt);
renderer.sync();
```

## Related

[ADR 0022](/adr/0022-gpu-instanced-vfx-pipeline-and-extras-package)
