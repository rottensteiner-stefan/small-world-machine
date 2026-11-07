# ADR 0023: Modernisierung der Physik-Engine & Constraint-System

> **Stand-Hinweis (2026-10-21):** Status: Akzeptiert, umgesetzt. `SweptVolumeCCD` liegt in `physix/ccd/SweptSphereCCD.ts` (Alias `SweptSphereCCD`; siehe ADR 0005).

## Kontext & Problem

Die ursprüngliche Physik-Engine von Small World Machine war auf elementare Zentralstöße von Kugeln und einfache AABBs beschränkt. Mit wachsenden Anforderungen an komplexe Gameplays (z. B. Character-Controller, Scharniere, Seile, sensorische Trigger-Zonen, Raycasts für Waffen und Sichtlinien sowie realistische Kanten-Kollisionen und Kisten-Stapel) zeigten sich folgende architektonische Limitierungen:
1. **Fehlende Kollisionsfilterung & Sensor-Lifecycle:** Alle Collider interagierten miteinander; es gab keine Bitmasken (`collisionLayer`/`collisionMask`) und keine sauberen `enter`/`stay`/`exit`-Trigger-Events ohne Impulsübertragung.
2. **Fehlende Raycast- & Sweep-Queries:** Spielcode konnte keine schnellen Sichtlinien-, Boden- oder Kugel-Sweeps gegen den Physik-Zustand durchführen.
3. **Punktmasse-Begrenzung & fehlende Trägheitsmomente:** Körper besaßen keinen 3D-Trägheitstensor; Stöße an Kanten erzeugten rein lineare Reaktionen ohne physikalisches Abkippen/Taumeln oder Rollmoment.
4. **Fehlendes Constraint- & Joint-System:** Es gab keine Möglichkeit, Körper durch Gelenke (Pendel, Federn, Kugelgelenke, Scharniere mit Motoren) miteinander zu verbinden.

## Entscheidung

1. **Collision Layers, Bitmasken & Trigger-Lifecycle (Option D):**
   - Einführung von `collisionLayer: number` (Standard: `1`), `collisionMask: number` (Standard: `0xFFFFFFFF`) und `isTrigger: boolean` auf allen `Collidable`-, `Object3D`- und `StaticCollider`-Entitäten.
   - `PhysicsBroadphase.canCollide(a, b)` filtert unpassende Paare vor der Narrowphase heraus.
   - Zero-Allocation Lifecycle-Events: `physics:trigger-enter`, `physics:trigger-stay`, `physics:trigger-exit`, `physics:collision-enter`, `physics:collision-stay`, `physics:collision-exit`.
   - CCD (`SweptVolumeCCD`) überspringt Sensorvolumina ohne Positionsklemmung.

2. **Physics Raycast & Shape-Cast Query API (Option B):**
   - Neues typisiertes Interface [`RaycastHit`](../../packages/engine/src/physix/RaycastHit.ts) (`distance`, `point`, `normal`, `collider`, `object`).
   - Analytische Schnittpunktsberechnungen für `BoundingSphere`, `BoundingBox` und `OBB` auf `Ray`.
   - High-Level-APIs `physics.raycast(...)`, `physics.raycastAll(...)` (distanzsortiert) und `physics.sphereCast(...)` auf `PhysicsSystem`.

3. **3D-Trägheitstensor, Drehmoment & Außermittige Stöße (Punkt 5):**
   - Erweiterung von `RigidBody` um 3D-Hauptträgheitsachsen (`inertiaTensor: Vector3D`, `inverseInertiaTensor: Vector3D`), Form-Helfer (`setInertiaForBox`, `setInertiaForSphere`, `setInertiaForCylinder`) und exzentrische Impuls-/Kraftbeaufschlagung (`applyImpulseAtPoint`, `applyForceAtPoint`).
   - Narrowphase-Solver berechnet exakte Kontaktoberflächen-Geschwindigkeiten ($\vec{v} + \vec{\omega} \times \vec{r}$), effektive 3D-Rotationsmassen $K_N, K_T$ und reaktive Coulomb-Drehmomente.

4. **Projected Gauss-Seidel Constraint- & Joint-System (Option C):**
   - Modulare Gelenkhierarchie unter `packages/engine/src/physix/joints/`:
     - [`Joint`](../../packages/engine/src/physix/joints/Joint.ts): Basisklasse mit Weltanker-Projektion, `breakForce` und `collideConnected`.
     - [`DistanceJoint`](../../packages/engine/src/physix/joints/DistanceJoint.ts): Feste und bereichsbegrenzte Distanz-Constraints.
     - [`SpringJoint`](../../packages/engine/src/physix/joints/SpringJoint.ts): Hooke'sche Federkräfte mit viskoser Dämpfung.
     - [`BallSocketJoint`](../../packages/engine/src/physix/joints/BallSocketJoint.ts): 3-DOF sphärische Punkt-zu-Punkt-Gelenke.
     - [`HingeJoint`](../../packages/engine/src/physix/joints/HingeJoint.ts): 1-DOF Drehgelenke mit Achsensperre, Winkel-Limits und bidirektionalem Motor.
   - Nahtlose Integration in `Scene.joints` und die iterative PGS-Schleife von `PhysicsSystem`.

## Konsequenzen

- **Dramatisch erweiterte Ausdruckskraft:** Vollständige Unterstützung für Gameplay-Mechaniken (Türen, Seile, Bungees, Ragdolls, Waffen-Hitscans, Sensor-Zonen).
- **Strikte Zero-Allocation:** Sämtliche Impuls-, Drehmoment-, Raycast- und Joint-Berechnungen nutzen `MathPool` und gecachte Zustandsobjekte.
- **100% Determinismus & Abwärtskompatibilität:** Bestehende Szenen und Tests funktionieren unverändert weiter (`isSensor` als Alias, Standard-Masken für offene Kollision).
