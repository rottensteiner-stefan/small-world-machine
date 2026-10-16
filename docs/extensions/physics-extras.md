# Physik-Extras (`@small-world-machine/physics-extras`)

Das Paket `@small-world-machine/physics-extras` kombiniert die Kern-Physik-Engine (`@small-world-machine/engine`) mit prozeduraler Geometriezerlegung (`@small-world-machine/geometry-extras`), um dynamische Zerstörung, Brucheffekte und Trümmersimulationen bereitzustellen.

## Installation & Import

```bash
npm install @small-world-machine/physics-extras
```

```typescript
import { fractureObject, VoronoiFractureOptions } from "@small-world-machine/physics-extras";
```

---

## Voronoi-Frakturierung (`fractureObject`)

`fractureObject` nimmt ein beliebiges `Object3D`, zerlegt dessen Bounding-Volumen über ein 3D-Voronoi-Diagramm in konvexe Zellensplitter und erzeugt für jedes Bruchstück ein eigenständiges `Object3D` mit einem passenden `ConvexHull`-Kollider und `RigidBody`.

### Wichtigste Optionen

* **`pointCount`:** Anzahl der erzeugten Splitter (Standard: `12`).
* **`seed`:** Seed für deterministische, reproduzierbare Splitterformen.
* **`relaxationIterations`:** Anzahl der Lloyd-Relaxationsschritte für gleichmäßigere Zellengrößen.
* **`cellPadding`:** Skalierungsfaktor pro Fragment zur Erzeugung sichtbarer Risse vor dem Einsturz (Standard: `0.92`).
* **`impactPoint` & `explosionStrength`:** Schlagpunkt in Weltkoordinaten, von dem aus ein radialer Explosionsimpuls auf alle Trümmerstücke ausgeübt wird.
* **`totalMass`, `restitution`, `friction`:** Physikalische Materialeigenschaften für die Trümmer-`RigidBody`s.

### Beispiel

```typescript
import { Object3D, Cube, StandardMaterial, Vector3D } from "@small-world-machine/engine";
import { fractureObject } from "@small-world-machine/physics-extras";

// 1. Zu zerstörendes Objekt
// Hinweis: Object3D akzeptiert nur einen Namen als Konstruktor-Argument; Geometrie und
// Material werden danach explizit zugewiesen (Cube nimmt ausschließlich `size` entgegen).
const pillar = new Object3D("Pillar");
pillar.geometry = new Cube({ size: 1 }).getGeometryData();
pillar.material = new StandardMaterial();
pillar.position.set(0, 2, 0);
scene.add(pillar);

// 2. Objekt bei Treffer in 20 Splitter zerbrechen
const shards = fractureObject(pillar, {
  pointCount: 20,
  impactPoint: new Vector3D(0, 2, 0.5),
  explosionStrength: 5.0,
  restitution: 0.2,
  friction: 0.8,
});

// 3. Ursprüngliches Objekt entfernen und Splitter zur Szene hinzufügen
scene.remove(pillar);
for (const shard of shards) {
  scene.add(shard);
}
```
