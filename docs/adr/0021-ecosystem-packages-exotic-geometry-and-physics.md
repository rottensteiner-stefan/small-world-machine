# ADR 0021: Ökosystem-Pakete für exotische Geometrien (`@small-world-machine/geometry-extras`) & höherstufige Physik (`@small-world-machine/physics-extras`)

## Kontext & Problem

Die Kern-Engine verfolgt die Philosophie eines ultraleichten Kerns ohne externe Abhängigkeiten. In ADR 0018 wurde bereits ein separater Weg etabliert: datenkomprimierende glTF-Extensions (Draco, BasisU) leben nicht im Kern, sondern im Ökosystem-Paket `@small-world-machine/gltf-extensions`.

Dieselbe Realität ergibt sich für den Geometrie- und Physikbereich:

1. **Exotische & prozedurale Geometrien** — Supershapes, Torus-Knoten, Möbius-Bänder, Lathe-Körper, Platonische Körper, generische parametrische Flächen, konkave Polygon-Füllungen mit Löchern, 3D-Voronoi-Zellen, Marching-Cubes-Isosurfaces. Weltweit "legitimately useful", aber zu nischig für einen permanenten Platz im Kern-Primitiven-Katalog (`Cube`, `Sphere`, `Torus`, ...). Ein fester Einbau hunderter Figuren würde die Kern-Belegung aufblähen und das öffentliche API-Oberflächen-Volumen des Kerns beliebig wachsen lassen.

2. **Höherstufige Physik-Bausteine** — z. B. Voronoi-Frakturen: jedes Zell-Fragment als eigenes `RigidBody`. Dies braucht sowohl die Physik des Kerns `@small-world-machine/engine` **als auch** die Geometrie von `@small-world-machine/geometry-extras` — es gehört also weder in ein rein-geometrisches Paket (das würde eine Physik-Abhängigkeit erzwingen, die es nicht braucht) noch in den Kern.

## Entscheidung

1. **Anerkennung des Ökosystem-Musters als allgemeines Prinzip** (nicht nur für glTF-Datenebenen, sondern für beliebige domänenspezifische Erweiterungen) und seine Festlegung als dokumentierter Standard:
   - **Kern-Engine** (`@small-world-machine/engine`) bleibt der einzige Ort für Universelles (Math, Szenengraph, Renderer, Kern-Primitive, Kern-Physik).
   - **Optionale, domänenspezifische Pakete** (`@small-world-machine/gltf-extensions`, `@small-world-machine/geometry-extras`, `@small-world-machine/physics-extras`, ...) hängen ausschließlich von `@small-world-machine/engine` ab — nie umgekehrt.
2. **`@small-world-machine/geometry-extras` (`packages/geometry-extras/`)** ist das Zuhause für alles Exotische, das durch das öffentliche `AbstractGeometry`-Erweiterungsprinzip eingehakt wird (jede Geometrie implementiert nur `generateGeometryData()`). Tree-Shaking hält ungenutzte Formen aus dem Verbraucher-Bundle; eine Registrierung wie bei gltf-Extensions ist dafür bewusst **nicht** nötig, da Geometrien als direkte Klassen konsumiert werden (`new Lathe({...}).getGeometryData()`).
3. **`@small-world-machine/physics-extras` (`packages/physics-extras/`)** ist das Zuhause für Kombinationen aus Kern-Physik und Geometrie-Paketen (z. B. `fractureObject()` unter Wiederverwendung des Kernteen-`ConvexHull`-Kolliders).
4. **Dokumentation & Tests bleiben kolokal:** jedes Ökosystem-Paket hat ein eigenes `README.md`, eigene `tests/` und pflegt seine Formeln/Inspirationen in der Root-`REFERENCES.md` (vgl. ADR 0018, gleiche Anforderung).

## Konsequenzen

- **Kern bleibt schlank:** der Primitive-Katalog und die Physik-API wachsen nicht um hunderte Nischen-Figuren.
- **Reicher Erweiterungspfad für Dritte:** Entwickler können eigene Geometrie- oder Physik-Pakete nach exakt demselben Muster beisteuern (vergleiche `geometry-extras/README.md` "Adding a new exotic geometry").
- **Grenzen:** Nur was über zwei unabhängige Projekte hinweg als universell nachgewiesen ist, wandert zurück in den Kern (vgl. ADR 0015 "App-First-Regel").
- **Kopplung zwischen Extras-Paketen erlaubt, aber azyklisch:** `physics-extras` darf `geometry-extras` importieren; kein Extras-Paket darf je `@small-world-machine/engine` importieren und dabei den Kern aufblähen.
