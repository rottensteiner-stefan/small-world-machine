# Geometry Extras (`@small-world-machine/geometry-extras`)

`@small-world-machine/geometry-extras` is an optional ecosystem package that provides procedural and parametric geometries beyond the core primitives (`Cube`, `Sphere`, `Plane`, `Cylinder`, `Tube`, `Torus`, `Capsule` and others). It depends on `@small-world-machine/engine`.

## Import

```typescript
import {
  Supershape, TorusKnot, MobiusStrip, Lathe, PlatonicSolid, ParametricSurface,
  FilledPolygon, VoronoiShardGeometry, VoronoiCells, poissonDiskSample,
  MarchingCubes, metaballField,
} from "@small-world-machine/geometry-extras";
import { Vector3D } from "@small-world-machine/engine";
```

## Geometries

All classes extend `AbstractGeometry`; use `getGeometryData()` to assign them to an `Object3D`.

| Class | Options |
|---|---|
| `Supershape` | `radius`, `longitude`, `latitude` (each `{ m, n1, n2, n3, a, b }`), `longitudeSegments`, `latitudeSegments` |
| `TorusKnot` | `radius`, `tube`, `p`, `q`, `tubularSegments`, `radialSegments` |
| `MobiusStrip` | `radius` (1), `width` (0.4), `segments` (96), `widthSegments` (8), `twists` |
| `Lathe` | `profile` (`Vector3D[]`, x = radius, y = height, bottom to top), `segments`, `closed`, `startAngle`, `arcAngle` |
| `PlatonicSolid` | `solid` (`tetrahedron`, `octahedron`, `icosahedron`, `dodecahedron`), `radius`, `detail` |
| `ParametricSurface` | `surface` `(u, v) => Vector3D`, `uMin`, `uMax`, `vMin`, `vMax`, `uSegments`, `vSegments`, `closedU`, `closedV` |
| `FilledPolygon` | `outer`, `holes`; ear-clipping triangulation, concave polygons allowed |
| `VoronoiShardGeometry` | Constructor takes a list of convex cell faces |
| `MarchingCubes` | `sample` `(x, y, z) => number`, `isoLevel`, `min`, `max`, `resolution` |

### Voronoi and sampling helpers

* `VoronoiCells`: splits a box (`bounds`) into 3D Voronoi cells. Options: `points` or `pointCount`, `seed`, `weights`, `cellPadding`, `relaxationIterations`. Helpers: `computeCellFaces`, `relaxPoints`, `cellCentroid`.
* `poissonDiskSample`: random points with a minimum distance. Options: `bounds`, `minDistance`, `seed`, `maxAttempts`.
* `metaballField(balls)`: scalar field for `MarchingCubes` from `{ x, y, z, radius, strength }` entries.

## Examples

```typescript
const shape = new Supershape({
  radius: 1,
  longitude: { m: 7, n1: 0.2, n2: 1.7, n3: 1.7 },
  latitude: { m: 7, n1: 0.2, n2: 1.7, n3: 1.7 },
  longitudeSegments: 64,
  latitudeSegments: 64,
});

const vase = new Lathe({
  profile: [new Vector3D(0, 0, 0), new Vector3D(0.5, 0.2, 0), new Vector3D(0.3, 1, 0), new Vector3D(0.6, 1.8, 0)],
  segments: 32,
});

const blob = new MarchingCubes({
  sample: metaballField([{ x: 0, y: 0, z: 0, radius: 1, strength: 1 }]),
  isoLevel: 0.5,
  min: { x: -2, y: -2, z: -2 },
  max: { x: 2, y: 2, z: 2 },
  resolution: 32,
});
```

## Related

[ADR 0021](/adr/0021-ecosystem-packages-exotic-geometry-and-physics)
