# @small-world-machine/physics-extras

> Physics-side extensions for the **Small World Machine 3D Engine** that legitimately need both `@small-world-machine/engine`'s physics _and_ a geometry package -- so they can't live in a geometry-only package without giving it a physics dependency, and don't belong in the engine core either.

---

## 📦 Overview

`@small-world-machine/geometry-extras`'s `VoronoiCells` is an obvious fit for physics-based destruction (each cell as its own rigid body), but that needs the engine's physics on top of pure geometry. This package is where that combination lives instead, following the same decoupled extension pattern as `@small-world-machine/gltf-extensions` and `@small-world-machine/geometry-extras`.

Currently included:

1. **`fractureObject()`**: shatters an `Object3D` into N convex Voronoi fracture shards, each with its own renderable geometry and its own `ConvexHull`-bounded `RigidBody`.

This relies on `packages/engine/src/physix/ConvexHull.ts` -- a generic convex-polyhedron collider with a full face+edge Separating Axis Theorem test against `Sphere`/`Box`/`OBB`/`ConvexHull` (see the engine's own `Collision`/`ConvexHull` for that part; it's a core engine feature, not specific to this package).

---

## 🚀 Installation & Usage

```typescript
import { fractureObject } from "@small-world-machine/physics-extras";
import { Object3D, Cube, StandardMaterial, PhysicsSystem } from "@small-world-machine/engine";

const vase = new Object3D("Vase");
vase.geometry = new Cube({ size: 2 }).getGeometryData();
vase.material = new StandardMaterial();
scene.add(vase);

// Later, on impact:
const shards = fractureObject(vase, {
  pointCount: 16,
  cellPadding: 0.9, // opens visible cracks between pieces
  totalMass: 4, // split evenly across every produced shard
  impactPoint: { x: hitX, y: hitY, z: hitZ },
  explosionStrength: 3,
});
// `vase` is already replaced by `shards` in the scene graph (it had a parent);
// PhysicsSystem picks the new RigidBody/ConvexHull-bounded shards up next step.
```

`fractureObject()` derives its clipping bounds from `target.geometry.getBoundingVolume()` by default (override with `bounds`), reuses `@small-world-machine/geometry-extras`'s seed-point generation (including Lloyd relaxation and power-diagram `weights`), and gives each shard's local origin its own center of mass rather than the original object's origin -- required for its `ConvexHull` and `RigidBody` rotation to behave correctly once it's independent.

See [`REFERENCES.md`](../../REFERENCES.md) for the underlying technique.
