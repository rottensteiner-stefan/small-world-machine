# ADR 0040: BoundingVolume-Vollendung, Collision-Kern-Zerlegung & Revolve-Generator (Wave 2, Paket D)

> **Status: ACCEPTED** — 2026-10-19 (Maintainer-Abnahme; ursprünglich DRAFT vom 2026-10-19, Session `swm-wave2-d`).
> Grundlage: Thermo-Audit `.agents/scratches/thermo-1014/07-physix-math.md` (BV-/Collision-/Trägheits-
> Themen), `06-geometry.md` (Revolve), Roadmap 15 §2.1 (BoundingVolume), §2.11 (Revolve), §5 Welle 2
> (Collision-Kern), §6 (offene Verifikation Physik); Paket-Spezifikation
> `.agents/scratches/wave2-package-D.md`.
> **Übernommen am 2026-10-19 (Maintainer-Abnahme):** ACCEPTED; der DRAFT-Vorbehalt ist obsolet.
> **Pfade/Commits bezogen auf `HEAD d7aa4c97` (2026-10-19); parallele Sessions verschieben Zeilen — vor
> weiterer Umsetzung re-validieren. Wave-2-ADR-Nummern: 0037=A (GPU), 0038=B (WebGL), 0039=C
> (Materialien), 0040=D (Physix/Geometrie, dieses), 0041=Ops-B (Anwendungspersistenz);
> `docs/adr/index.md` schreibt zentral die Koordination.**

## Kontext & Problem

Drei auditierte Mängel im Quellstand vor Paket D (Messungen bezogen auf HEAD vor Paket D):

1. **`Collision.ts`-Monolith (1326 Zeilen).** Die gesamte Kollisions-Detektion/-Auflösung
   (Kugel/Box-Primitive, OBB-SAT, Konvex-Hull-SAT, CCD-Sweeps, `sweep`-/`sweepRayVolume`-Dispatcher)
   lag in einer statischen Klasse. Neuer Code (z. B. Sweep-Varianten) musste in dieselbe Datei,
   Scratch-State war im Klassenkörper vermischt, und die Datei war die größte der Physix-Schicht.
2. **15 `as unknown as OBB`-Casts + Aufruf-Leitern.** `BoundingVolume`-Konsumenten
   (`Ray`/`Raycaster`, `Collision.sweepRayVolume`, `BuoyancySolver`, `PhysicsBroadphase`,
   `ContactSolver`, `SpatialQueries`, `Object3D.computeBounds`, `MakerPrefabPipeline`) erzwangen
   Shape-Downcasts statt der Diskriminierten-Union-Methoden aus `interfaces/BoundingVolume.ts`
   (`getAabb`, `translate`, `intersectsRay`, `surfaceNormalAt`, `volume`, `closestPoint`,
   `cloneEmpty`/`setFromLocal`). Ein Cast-freier Aufruf durchkreuzt diese Laddern und reduziert
   die Fehlerfläche bei neuen Shapes.
3. **Revolve-Generierung über 9 Geometrien dupliziert.** Zylinder/Kegel/Hohlformen entstanden aus
   jeweils eigenen Scheitelpunkt-Schleifen mit driftenden Winding-/Kappen- und
   Normalen-Handlings (Roadmap 15 §2.11); `CylinderSector.ts` trug eine eigene, leicht divergente
   Implementierung. Ergebnis: gespiegelte Geometrie-Stapel statt eines gemeinsamen Erzeugerkerns.

## Entscheidung

1. **Collision-Kern-Zerlegung (Task 3, zuletzt — erst nach vorab geschriebenen Pin-Tests).**
   `Collision.ts` wird zu einer dünnen Fassade: sie behält den generischen `test`/`resolve`-Dispatch,
   die Kugel/Box-Primitive (`resolveSphereBox`, `resolveSphereSphere`, `resolveBoxBox`,
   `_sphereSphere`, `_boxBox`, `_sphereBox`) und für jede getypte öffentliche Methode einen
   Einzeiler-Delegator. Die Algorithmik wandert wert-erhaltend (Verbati‌m-Extraktion) in drei neue
   Kernel-Module:
   - `CollisionSweep.ts` → `CollisionSweepSolver` (CCD-Sweep-TOIs, `_sweepRayBox`, `sweep`,
     `sweepRayVolume`),
   - `CollisionObb.ts` → `CollisionObbSolver` (OBB-SAT-Test/MTV inkl. Sphere/Box-OBB),
   - `CollisionHull.ts` → `CollisionHullSolver` (Konvex-Hull-SAT inkl. Hull-vs.-Sphere/Box/OBB).
   `this.`-Semantik und Scratch-State ziehen mit den jeweiligen Kerneln um; kein
   Verhaltens-Delta. Die Pin-Tests wurden **vor** dem Refactor geschrieben
   (`CollisionKernelPin.test.ts`, Muster Wave-1) und `Collision*`-/`Sweep`-Tests bleiben
   bit-identisch grün (STOP-Regel: nie ohne die Pin-Tests committen).
2. **BoundingVolume-Vollendung (Task 2).** Die 15 `as unknown as OBB`-Casts und die
   Aufruf-Leitern migrieren auf den typisierten Methodensatz der Diskriminierten-Union;
   `Object3D.computeBounds`/`MakerPrefabPipeline` nutzen die BV-API. Die offenen Verifikationen aus
   Bericht 07 wurden geprüft und dokumentiert (kein Bug): `BoundingSphere.transform`-Aliasing mit
   `obj.position` ist produktiv nicht vorhanden (alle Konstruktionen klonen), und
   `Frustum.setFromMatrix` ist das Standard-Gribb-Hartmann-Extraktionsverfahren — die WebGPU-Pfade
   premultiplizieren `Matrix4.ZO_CORRECTION` korrekt vor der Extraktion.
3. **Revolve-Generator (Task 1, zuerst/separat lieferbar).** Neue geteilte Erzeugerkern
   `LatheGeometry.ts` (`LatheGeometry` + `RevolveBuilder`: solide/hohle Wände, Scheiben-/Ring-
   Deckel, Sektor-Seitendeckel, Cap-UV-Taper, expliziter Per-Quad-Winding über
   `AbstractGeometry.addQuad`, `computeNormals`). Fünf Formen sind dünne Wrapper um den Kern;
   `Cone` erweitert `Cylinder`; `CutCylinder`/`PointedPillar` bleiben eigenständig (oblique
   theta-varying Top-Fläche bzw. explizite Sharp-Ridge-Normalen — genuine Divergenz), nutzen aber
   die gemeinsamen Helfer. `CylinderSector.ts` wird **gelöscht** (4 Call-Sites umgestellt).
   `AbstractGeometry` gewinnt `setBuffers`, `addQuad`, `gridIndices`, `gridWireframe`, `rebuild`.

## Konsequenzen

- **Collision-Werte bit-identisch:** Pin-Suite (5 Tests, exakte Literale/`expectZero`) + bestehende
  `Collision.test`/`HullCollision.test`-Sweeps grün auf dem unveränderten wie auf dem zerlegten
  Stand; volle Testsuite und Showcase-Shards (Physik-Showcases 6/10/15 WebGL + WebGPU-Shard)
  grün. `MathPool`-Balance-/Zero-Allocation-Pfade der berührten Physik bleiben grün.
- **Grep-Gate:** `as unknown as OBB` im Source **0** (einzig verbleibender Treffer ist ein
  Doc-Kommentar-Verweis in `interfaces/BoundingVolume.ts`).
- **Verhaltensänderungen (Physik-seitig, dokumentiert):** `MakerPrefabPipeline._boundsToAabb` →
  `getAabb` (der OBB/HULL-Frame war zuvor undefined), `CollisionResolution`-Else-Zweig → `Collision.resolve`,
  `CollisionVisualizer`/`VoronoiFracture` → `getBroadRadius`/`getAabb`. Wert-erhaltend: Revolve
  (Konsolidierung, kein Render-Delta), Collision-Kern (bit-identisch).
- **Revolve-Zeilenzahlen:** alte Familie ≈ 2269 Zeilen (9 Geometrien inkl. `CylinderSector`)
  → gefaltete Familie 2008 Zeilen (8 Wrapper + gemeinsamer Kern `LatheGeometry` 431) nach Delete
  von `CylinderSector.ts`; der `<500`-Netto-Zielwert ist nicht erreichbar, weil der durch Tests
  gepinnte öffentliche Mathe-/Getter-Surface der Formen (~415 Zeilen) erhalten bleiben muss — die
  **Generierungs**-Footprints sind auf einen geteilten Pfad kollabiert.
- **Commits Paket D (lokal, kein Push):** `d8a2da0b` (Task 1 Revolve), `5c69fb3c` (Task 2
  BoundingVolume), `d7aa4c97` (Task 3 Collision-Kern) sowie der ADR/CHANGELOG-Commit dieses Endes —
  nicht Teil eines Releases; kein Version-Bump. ADR-Index-Zeile (0037–0041) ergänzt zentral die
  Koordination nach Abnahme.
