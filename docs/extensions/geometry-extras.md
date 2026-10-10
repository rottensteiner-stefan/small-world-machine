# Exotische Geometrien (`@small-world-machine/geometry-extras`)

Das Paket `@small-world-machine/geometry-extras` erweitert den Kern-Primitiven-Katalog (`Cube`, `Sphere`, `Plane`, `Cylinder`, `Tube`) um eine umfangreiche Sammlung prozeduraler, parametrischer und mathematisch exotischer 3D-Geometrien.

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
  MarchingCubes,
} from "@small-world-machine/geometry-extras";
```

---

## Geometrie-Katalog

### 1. `Supershape` (Superformel nach Gielis)
Generiert 3D-Supershapes aus zwei gekoppelten 2D-Superformeln. Erzeugt Seesterne, Muscheln, Kristalle und organische Blütenformen.

```typescript
const supershape = new Supershape({
  m1: 7, n1_1: 0.2, n2_1: 1.7, n3_1: 1.7, // Formel 1 (horizontal)
  m2: 7, n1_2: 0.2, n2_2: 1.7, n3_2: 1.7, // Formel 2 (vertikal)
  radialSegments: 64,
  heightSegments: 64,
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
  segments: 64,
  strips: 16,
});
```

### 4. `Lathe` (Rotationskörper)
Rotiert einen 2D-Pfad aus Punkten um die Y-Achse, um Vasen, Säulen, Flaschen oder Becher zu erzeugen.

```typescript
const points = [
  { x: 0.0, y: 0.0 },
  { x: 0.5, y: 0.2 },
  { x: 0.3, y: 1.0 },
  { x: 0.6, y: 1.8 },
];
const lathe = new Lathe({ points, segments: 32 });
```

### 5. `PlatonicSolid`
Exakte platonische Körper: Tetraeder, Oktaeder, Dodekaeder und Ikosaeder mit scharfen oder geteilten Flächennormalen.

```typescript
const dodecahedron = new PlatonicSolid({
  type: "dodecahedron",
  radius: 1.0,
});
```

### 6. `FilledPolygon` & `VoronoiShardGeometry`
* **`FilledPolygon`:** Triangulierung beliebiger 2D-Polygone (auch nicht-konvex / mit Löchern) mittels Ear-Clipping.
* **`VoronoiShardGeometry`:** Konvexe Voronoi-Zellenfragmente zur realistischen Zerstörungssimulation und Bruchdarstellung.

### 7. `MarchingCubes`
Erzeugt Polygon-Meshes aus 3D-Skalarfeldern (SDFs, Iso-Flächen, Metaballs).
