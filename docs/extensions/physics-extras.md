# Physics Extras (`@small-world-machine/physics-extras`)

`@small-world-machine/physics-extras` is an optional ecosystem package that provides higher-level physics building blocks. It depends on `@small-world-machine/engine` and `@small-world-machine/geometry-extras`.

## Import

```typescript
import { fractureObject } from "@small-world-machine/physics-extras";
```

## `fractureObject(target, options)`

Splits an `Object3D` into convex Voronoi shards. Each shard is a new `Object3D` with a `ConvexHull` collider and a `RigidBody`. The function returns the shards; the caller removes the original and adds the shards to the scene.

| Option | Default | Description |
|---|---|---|
| `points` | none | Seed points in the target's local space; if omitted, `pointCount` random points are used |
| `pointCount` | 12 | Number of shards |
| `seed` | 1 | Seed for reproducible shapes |
| `weights` | none | Per-point weights (power diagram, see `VoronoiCells`) |
| `bounds` | geometry bounds | Clipping box in local space |
| `relaxationIterations` | 1 | Lloyd relaxation rounds |
| `cellPadding` | 0.92 | Shrinks each shard toward its centroid to open cracks |
| `totalMass` | 1 | Total mass, split evenly across shards |
| `restitution` | 0.3 | Shard `RigidBody` restitution |
| `friction` | 0.9 | Shard `RigidBody` friction |
| `material` | target's material | Material of all shards |
| `impactPoint` | none | World-space origin; if set, shards receive an outward impulse |
| `explosionStrength` | 2 | Strength of that impulse |

## Example

```typescript
import { Object3D, Cube, StandardMaterial, Vector3D } from "@small-world-machine/engine";
import { fractureObject } from "@small-world-machine/physics-extras";

const pillar = new Object3D("Pillar");
pillar.geometry = new Cube({ size: 1 }).getGeometryData();
pillar.material = new StandardMaterial();
pillar.position.set(0, 2, 0);
scene.add(pillar);

const shards = fractureObject(pillar, {
  pointCount: 20,
  impactPoint: new Vector3D(0, 2, 0.5),
  explosionStrength: 5,
});

scene.remove(pillar);
for (const shard of shards) scene.add(shard);
```

## Related

[ADR 0021](/adr/0021-ecosystem-packages-exotic-geometry-and-physics), [Physics guide](/guides/physics)
