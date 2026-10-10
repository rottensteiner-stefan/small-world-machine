# @small-world-machine/geometry-extras

> Exotic and procedural geometries for the **Small World Machine 3D Engine**: shapes that are legitimately useful for someone, somewhere, but too niche to justify a permanent slot in the engine core.

---

## 📦 Overview

The engine core (`@small-world-machine/engine`) ships a lean, general-purpose set of primitives (`Cube`, `Sphere`, `Torus`, `Cylinder`, ...). This package is the home for everything more exotic, following the same decoupled extension pattern as `@small-world-machine/gltf-extensions`: it depends on the engine, never the other way around, and the core stays untouched.

Every geometry here extends the engine's `AbstractGeometry` and only implements `generateGeometryData()` -- the same extension point any third-party geometry package would use.

Currently included:

1. **`Supershape`**: a Gielis superformula surface -- two independent 2D profiles (longitude/latitude) combined into organic, crystalline, or star-like closed surfaces.
2. **`TorusKnot`**: a (p,q) torus knot curve, swept into a tube.
3. **`MobiusStrip`**: a single (or multi-) half-twist non-orientable ribbon.
4. **`Lathe`**: a surface of revolution -- a 2D radius×height profile rotated around the Y axis, for vases, bottles, goblets and rings.
5. **`PlatonicSolid`**: the regular tetrahedron/octahedron/icosahedron/dodecahedron (the dodecahedron is constructed as the polar dual of the icosahedron), optionally refined into a geodetic sphere via subdivision.
6. **`ParametricSurface`**: a generic `(u, v) → point` surface grid for waves, flags, helixes and other procedurally defined shapes.
7. **`FilledPolygon`**: ear-clipped fill of an arbitrary (possibly concave) planar polygon with optional holes -- unlike the core `PolygonFan`, which only fills star-shaped profiles.
8. **`VoronoiCells`**: a 3D Voronoi diagram (or, with `weights`, a power/Laguerre-Voronoi diagram) built from half-space clipped convex cells, with an optional shrink-towards-centroid padding for a "shattered crystal" look, optional Lloyd relaxation (`relaxationIterations`) for more even cell sizes, and `poissonDiskSample()` as an alternative seed-point generator.
9. **`MarchingCubes`**: an isosurface (e.g. blended metaballs, or any custom scalar field) extracted via marching tetrahedra.

Not a geometry: physics is deliberately **not** wired up here (e.g. "each Voronoi cell as its own rigid body" fracture). See the note at the bottom of this file.

See [`REFERENCES.md`](../../REFERENCES.md) for the underlying formulas and sources.

---

## 🚀 Installation & Usage

```typescript
import {
  Supershape,
  TorusKnot,
  MobiusStrip,
  Lathe,
  PlatonicSolid,
  ParametricSurface,
  FilledPolygon,
  VoronoiCells,
  MarchingCubes,
} from "@small-world-machine/geometry-extras";
import { Object3D, StandardMaterial } from "@small-world-machine/engine";

const knot = new Object3D("Knot");
knot.geometry = new TorusKnot({ p: 3, q: 7, tube: 0.15 }).getGeometryData();
knot.material = new StandardMaterial();

const crystals = new Object3D("Crystals");
crystals.geometry = new VoronoiCells({ pointCount: 20, cellPadding: 0.85 }).getGeometryData();
crystals.material = new StandardMaterial();
```

Each geometry takes a single options object (see the exported `*Options` interfaces for defaults). Like every core geometry, it's assigned to `Object3D.geometry` via `getGeometryData()` (not passed to the `Object3D` constructor, which only takes an optional name), and exposes `getBoundingVolume()` for the renderers and physics system to consume directly.

## 🧭 Adding a new exotic geometry

1. Extend `AbstractGeometry` from `@small-world-machine/engine`.
2. Implement `protected generateGeometryData(): void`, filling `_vertices`/`_indices`/`_uvs` (normals/tangents/wireframe are derived automatically by the base class if omitted).
3. Export it from `src/index.ts`.
4. Add a NaN-guard test under `tests/` (zero segments, zero/degenerate parameters) following the existing tests.
5. Document the underlying formula/inspiration in the root [`REFERENCES.md`](../../REFERENCES.md).

## ⚠️ Why there's no "Voronoi fracture" here

`VoronoiCells` is an obvious fit for physics-based destruction (each cell as its own rigid body). That deliberately isn't built here: it needs both `@small-world-machine/engine`'s physics _and_ this package's geometry, so it lives in its own separate package, `@small-world-machine/physics-extras`, instead of adding a physics dependency to a geometry-only one. `VoronoiShardGeometry` (a single already-clipped cell as its own renderable `AbstractGeometry`) and the `computeCellFaces`/`cellCentroid` building blocks that package uses to get there both live here.
