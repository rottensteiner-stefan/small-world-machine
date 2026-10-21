# Exotische Geometrien (`@small-world-machine/geometry-extras`)

Das Paket `@small-world-machine/geometry-extras` erweitert den Kern-Primitiven-Katalog (u. a. `Cube`, `Sphere`, `Plane`, `Cylinder`, `Tube`, `Torus`, `Capsule`) um eine umfangreiche Sammlung prozeduraler, parametrischer und mathematisch exotischer 3D-Geometrien.

## Installation & Import

```bash
npm install @small-world-machine/geometry-extras
```

```typescript
import {
  Supershape,
  TorusKnot,
  MobiusStrip,
  Lathe,
  PlatonicSolid,
  ParametricSurface,
  FilledPolygon,
  VoronoiShardGeometry,
  VoronoiCells,
  poissonDiskSample,
  MarchingCubes,
  metaballField,
} from "@small-world-machine/geometry-extras";
import { Vector3D } from "@small-world-machine/engine";
```

---

## Geometrie-Katalog

### 1. `Supershape` (Superformel nach Gielis)
Generiert 3D-Supershapes aus zwei gekoppelten 2D-Superformeln. Erzeugt Seesterne, Muscheln, Kristalle und organische Blütenformen.

```typescript
const supershape = new Supershape({
  radius: 1.0,
  longitude: { m: 7, n1: 0.2, n2: 1.7, n3: 1.7 }, // Formel 1 (horizontal)
  latitude: { m: 7, n1: 0.2, n2: 1.7, n3: 1.7 },  // Formel 2 (vertikal)
  longitudeSegments: 64,
  latitudeSegments: 64,
});
```

### 2. `TorusKnot`
Erzeugt verschlungene $(p, q)$-Torus-Knoten und Schlingen entlang eines torusförmigen Pfads.

```typescript
const knot = new TorusKnot({
  radius: 1.0,
  tube: 0.25,
  tubularSegments: 128,
  radialSegments: 16,
  p: 2,
  q: 3, // Kleeblattschlinge (Trefoil knot)
});
```

### 3. `MobiusStrip`
Parametrisches Möbius-Band mit kontinuierlicher Halb-Verdrillung.

```typescript
const mobius = new MobiusStrip({
  radius: 1.0,
  width: 0.4,
  segments: 96,       // Segmente entlang der Länge
  widthSegments: 8,   // Segmente über die Breite
  twists: 1,          // Halbverdrillungen pro Umlauf
});
```

### 4. `Lathe` (Rotationskörper)
Rotiert einen 2D-Pfad aus Punkten um die Y-Achse, um Vasen, Säulen, Flaschen oder Becher zu erzeugen.

```typescript
// Profil: x = Radius, y = Höhe, von unten nach oben (Vector3D)
const profile = [
  new Vector3D(0.0, 0.0, 0),
  new Vector3D(0.5, 0.2, 0),
  new Vector3D(0.3, 1.0, 0),
  new Vector3D(0.6, 1.8, 0),
];
const lathe = new Lathe({ profile, segments: 32 }); // optional: closed, startAngle, arcAngle
```

### 5. `PlatonicSolid`
Platonische Körper: Tetraeder, Oktaeder, Dodekaeder und Ikosaeder; `detail` unterteilt die Flächen.

```typescript
const dodecahedron = new PlatonicSolid({
  solid: "dodecahedron", // tetrahedron | octahedron | icosahedron | dodecahedron
  radius: 1.0,
  detail: 0,
});
```

### 6. `ParametricSurface`
Fläche aus einer beliebigen Funktion `(u, v) => Vector3D`.

```typescript
const wave = new ParametricSurface({
  surface: (u, v) => new Vector3D(u, Math.sin(u * 4) * Math.cos(v * 4) * 0.2, v),
  uMin: -1, uMax: 1, vMin: -1, vMax: 1,
  uSegments: 64, vSegments: 64, // optional: closedU, closedV
});
```

### 7. `FilledPolygon` & `VoronoiShardGeometry`
* **`FilledPolygon`:** Triangulierung beliebiger Polygone (`outer`, optional `holes`, auch nicht-konvex) mittels Ear-Clipping.
* **`VoronoiShardGeometry`:** Konvexes Voronoi-Zellenfragment aus einer Liste von Flächen, für Zerstörungssimulation und Bruchdarstellung.

### 8. `VoronoiCells` & `poissonDiskSample`
* **`VoronoiCells`:** Zerlegt eine Box (`bounds`) in 3D-Voronoi-Zellen (`points` oder `pointCount`, `seed`, `weights`, `cellPadding`, `relaxationIterations`). Hilfsfunktionen: `computeCellFaces`, `relaxPoints`, `cellCentroid`.
* **`poissonDiskSample`:** Gleichmäßig verteilte Zufallspunkte mit Mindestabstand (`bounds`, `minDistance`, `seed`, `maxAttempts`).


### 9. `MarchingCubes`
Erzeugt Polygon-Meshes aus 3D-Skalarfeldern (SDFs, Iso-Flächen, Metaballs).

```typescript
const blob = new MarchingCubes({
  sample: metaballField([{ x: 0, y: 0, z: 0, radius: 1, strength: 1 }]), // (x, y, z) => Wert
  isoLevel: 0.5,
  min: { x: -2, y: -2, z: -2 },
  max: { x: 2, y: 2, z: 2 },
  resolution: 32,
});
```
