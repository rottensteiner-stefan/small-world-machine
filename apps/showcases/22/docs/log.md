# Showcase 22: Living Development Log

**Showcase:** 22 (Gargantua — Black Hole Accretion Disk & Relativistic Gravitational Lensing)  
**Primary Memory:** Entstehungsgeschichte, physikalische Herleitungen und Architektur-Evolution.

---

## 2026-09-25 — Initial CPU N-Body Prototype & Relativistisches Post-Processing

- **Initialer Aufbau:**
  - 400 einzelne `Sphere`-Meshes mit individuellen `RigidBody`-Komponenten im klassischen Szenengraphen.
  - Zentripetale Gravitation und Kepler-Bahnen mit $\mathcal{O}(N^2)$ Pairwise-Interaktionen.
  - Erste Post-Processing-Filterstufe mit Gravitationslinsen-Verzerrung und einfachem Einstein-Ring.
- **Identifizierte Engpässe:**
  - 400 separate Draw Calls und SAT-Kollisionschecks überlasteten Mobilgeräte und führten zu FPS-Drops.
  - Abruptes Verschwinden von Partikeln beim Überschreiten des Ereignishorizonts ($r < 0.4$).

---

## 2026-09-26 — Astrophysikalisches Upgrade, Spaghettisierung & Fading-Zone

- **Gravitative Rotverschiebung & Fading-Zone:**
  - Einführung einer kontinuierlichen Fading-Zone zwischen $r = 0.55$ und $r = 0.35$.
  - Partikel-Opacity dimmt sanft gegen Null; Deaktivierung von SAT-Kollisionen im inneren Trichter.
  - Shifting der Partikelfarbe in tiefes, sterbendes Dunkelrot kurz vor der Absorption.
- **Relativistisches Doppler-Beaming & Spaghettisierung im Shader:**
  - Geometrische Dehnung der UV-Koordinaten entlang des Gravitationsfallvektors ($\propto (r_{eh}/d)^3$).
  - Asymmetrisches Doppler-Beaming: Entgegenkommende Materie wird verstärkt und blauverschoben ($[0.8, 1.0, 1.4]$), abfließende Materie wird abgedunkelt und rotverschoben ($[1.2, 0.6, 0.4]$).
  - Dynamischer Einstein-Ring mit kubischem Glow-Falloff.
- **SkyDome Background:**
  - Einbindung des ESO-Milchstraßen-Panoramas ([`eso0932a.jpg`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/apps/showcases/22/assets/eso0932a.jpg)) und Eintrag in [`REFERENCES.md`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/REFERENCES.md).

---

## 2026-09-26 — Strategischer Architektur-Umbau & Ökosystem-Extraktion (`@small-world-machine/vfx-extras`)

- **Paket-Extraktion:**
  - Gründung des Ökosystem-Pakets [`@small-world-machine/vfx-extras`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/vfx-extras/) (ADR 0022).
  - Implementierung von [`ParticleMeshRenderer`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/vfx-extras/src/ParticleMeshRenderer.ts) zur GPU-Instanzierung: Tausende Partikel laufen bei 60 FPS in **1 Draw Call**.
  - Erstellung von 10 universellen Kraftfeld- und VFX-Affektoren (`PointAttractorAffector`, `VortexAffector`, `PlanarSpringAffector`, `ThermalCoolingAffector`, `FadeOutZoneAffector`, `TurbulenceAffector`, `DragAffector`, `ColorOverLifeAffector`, `SizeOverLifeAffector`, `BouncePlaneAffector`).
  - Implementierung des [`AccretionDiskEmitter`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/vfx-extras/src/AccretionDiskEmitter.ts) für gebrauchsfertige Akkretionsscheiben-Simulationen.
- **Kern-Erweiterungen:**
  - [`Color.blackbody()`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/core/colors/Color.ts) und [`Color.fromTemperature()`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/core/colors/Color.ts) (analytischer Planckian Locus Fit).
  - [`GravitationalLensingElement`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/renderers/post/elements/GravitationalLensingElement.ts) mit vollständiger Shader-Parität zwischen WebGL2 und WebGPU (160-Byte-Puffer).
  - [`FollowCameraBehavior`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/core/behaviors/FollowCameraBehavior.ts) für weiche Kameraverfolgung.
- **Showcase 22 Upgrade:**
  - Vollständiger Umbau von [`showcase.ts`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/apps/showcases/22/showcase.ts) auf die hochdichte Instanz-Pipeline.
- **Testabdeckung & Parität:**
  - 1034 Unit- und Paritäts-Tests verifiziert.

---

## 2026-09-26 — Physics Engine: Bewegungskohärenz & Netcode-Determinismus

- **Bewegungskohärenz & Temporales Caching (`PhysicsBroadphase` & `Octree`):**
  - Fat AABBs (`fatBounds`, `fatMargin`) für Collider: Ruhende oder sich nur innerhalb der Sicherheitshülle bewegende Objekte triggern $0$ Neu-Einsortierungen/Baum-Entfernungen und $0$ Speicherallokationen (`skippedCount`).
  - Inkrementelles Entfernen (`Octree.remove`) und automatisches Kollabieren (`_tryCollapse()`) von Octree-Teilbäumen beim Entfernen oder Verschieben von Objekten.
- **Determinismus & Netcode-Pfad (`PhysicsSystem` & `Collision`):**
  - Eindeutige, kontrollierbare Entitäts-IDs (`Object3D.id`, `StaticCollider.id`, `Collidable.id`).
  - Kanonische, allokationsfreie Kollisionspaar-Deduplizierung via 64-Bit-Paarschlüssel (`idA * 4294967296 + idB`).
  - Kanonisch sortierter Solver-Durchlauf: Deterministische Simulationsergebnisse und identische Impuls-/Ereignisreihenfolge unabhängig von der Einfügereihenfolge der Objekte in der Szene.
  - Universeller `Collision.resolve(boundsA, boundsB, outResult)` Dispatcher für alle 16 Bounding-Volumen-Kombinationen.
- **Coulomb-Kontakt-Reibung (`PhysicsSystem` & `EulerIntegrator`):**
  - Echter tangentialer Reibungsimpuls $j_T = \min(|j_T^{\text{ideal}}|, \mu \cdot j_N)$ über den Coulomb-Reibungskegel.
  - Exakte Modellierung von Haftreibung (vollständiges Stoppen bei niedrigen Tangentialgeschwindigkeiten) und Gleitreibung.
  - Saubere Entkopplung von `linearDamping` (freie atmosphärische Luftreibung) und `friction` (Oberflächenreibung).
- **RigidBody Sleeping & Inaktivitäts-Caching (`PhysicsSystem` & `RigidBody`):**
  - `isSleeping`-State mit Schwellenwerten (`sleepLinearThreshold`, `sleepAngularThreshold`, `sleepTimeThreshold`).
  - $\mathcal{O}(1)$ Integration- und Broadphase-Query-Skips für ruhende Körper.
  - Automatisches Aufwecken (`wakeUp()`) bei physischer Kollision mit aktiven, bewegten Körpern oder externer Krafteinwirkung (`applyForce`, `applyImpulse`, `applyTorque`).
- **Multi-Iteration Solver & Stacking-Stabilität (`PhysicsSystem` & PGS-Relaxation):**
  - Konfigurierbare Solver-Iterationen (`solverIterations: number = 4..8`) mit symmetrischer Gauss-Seidel-Relaxation (alternierende Vorwärts- und Rückwärtsdurchläufe).
  - Manifold-Persistenz: Kontakt-Constraints bleiben über alle Iterationsdurchläufe aktiv für vollständigen Impuls- und Unterstützungstransfer.
  - Resting-Contact-Velocity-Stabilisierung zur Eliminierung von diskreten Schwerkraft-Grenzzyklen auf ruhenden Stapeln.
  - Vollständige Stacking-Stabilität für vertikale Kisten- und Trümmerstapel ohne Einsinken oder Oszillation.
- **Continuous Collision Detection Expansion (`SweptVolumeCCD` & `Collision.sweep*`):**
  - Erweiterung von rein kugelförmigem CCD auf swept AABBs (`BoundingBox`), `OBB`s und schnelle Raycast-Projektile (`sweepRayVolume`).
  - Analytische swept Intersection-Solver: `sweepBoxBox`, `sweepBoxSphere`, `sweepBoxObb`, `sweepObbSphere`, `sweepObbBox`, `sweepObbObb`, `sweepRayVolume`.
  - Universeller `Collision.sweep(...)`-Dispatcher mit Unterstützung für variable Startursprünge (`origin`) und Enddisplacements (`delta`).
  - Zuverlässige Verhinderung von Tunneling-Effekten bei schnellen Quadern, Kisten und Hochgeschwindigkeitsprojektilen gegen dünne Wände.
  - 100% abwärtskompatibler Export von `SweptSphereCCD` als Alias für `SweptVolumeCCD`.

---

## 2026-09-26 — Physics Engine: Layers & Triggers, Raycast API, 3D Angular Impulses & Constraints

- **Collision Layers, Bitmasks & Trigger Lifecycle System (Option D):**
  - Bitmask-Filterung (`collisionLayer: number = 1`, `collisionMask: number = 0xFFFFFFFF`, `isTrigger: boolean = false`) auf `Collidable`, `Object3D` und `StaticCollider`.
  - `PhysicsBroadphase.canCollide(a, b)` statische Filterung vor Narrowphase-Kollisionschecks zur Einsparung von Rechenzeit.
  - Zero-Allocation Trigger- und Collision-Lifecycle-Events: `physics:trigger-enter`, `physics:trigger-stay`, `physics:trigger-exit`, `physics:collision-enter`, `physics:collision-stay`, `physics:collision-exit` (sowie abwärtskompatibles `physics:trigger` und `physics:collision`).
  - Trigger-Immunität in CCD (`SweptVolumeCCD`), um Sensorvolumen ohne physisches Stoppen zu durchdringen.
- **Physics Raycast & Query API (Option B):**
  - Neues Schnittstellen-Interface [`RaycastHit`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/physix/RaycastHit.ts) (`distance`, `point`, `normal`, `collider`, `object`).
  - Analytische Ray-Intersection-Methoden `Ray.intersectVolume` und `Ray.intersectVolumeDetailed` für `BoundingSphere`, `BoundingBox` und `OBB` zur exakten Berechnung von Trefferpunkt und Oberflächennormale.
  - High-Level-APIs auf `PhysicsSystem`: `physics.raycast(...)`, `physics.raycastAll(...)`, `physics.sphereCast(...)` mit Layer-Masken-Filterung.
- **Außermittiger Stoß, Drehmoment & 3D-Trägheitstensor (Punkt 5):**
  - Erweiterung von `RigidBody` um 3D-Hauptträgheitsachsen (`inertiaTensor: Vector3D`, `inverseInertiaTensor: Vector3D`), Form-Helfer (`setInertiaForBox`, `setInertiaForSphere`, `setInertiaForCylinder`) und außermittige Impuls-/Kraftbeaufschlagung (`applyImpulseAtPoint`, `applyForceAtPoint`).
  - Upgrade des Impuls-Solvers in `PhysicsSystem._resolveCollisions` um exakte Kontaktpunkt- und Hebelarm-Geometrie ($\vec{r}_A, \vec{r}_B$), Kontaktoberflächengeschwindigkeiten ($\vec{v} + \vec{\omega} \times \vec{r}$), 3D-Rotations-Effektivmassen ($K_N, K_T$) und reaktive Coulomb-Drehmomente (z. B. realistisches Abrollen und Taumeln von Kantenkontakten).
- **Physics Constraints & Joint System (Option C):**
  - Abstrakte Basisklasse [`Joint`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/physix/joints/Joint.ts) (`bodyA`, `bodyB`, `anchorA`, `anchorB`, `breakForce`, `collideConnected`).
  - [`DistanceJoint`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/physix/joints/DistanceJoint.ts): PGS-Geschwindigkeits- und Positionsprojektions-Constraint für feste oder elastisch begrenzte Abstände (z. B. Pendel, Seile, Stangen).
  - [`SpringJoint`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/physix/joints/SpringJoint.ts): Dämpfungsfähiges Hooke'sches Federkraft-Constraint für elastische Aufhängungen und Bungees.
  - [`BallSocketJoint`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/physix/joints/BallSocketJoint.ts): 3-DOF Kugelgelenk / Punkt-zu-Punkt-Constraint zur Fixierung von Ankerpunkten bei freier 3D-Rotation.
  - [`HingeJoint`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/packages/engine/src/physix/joints/HingeJoint.ts): 1-DOF Drehgelenk / Scharnier mit Achsen-Constraint, Winkel-Limits (`minAngle`, `maxAngle`) und bidirektionalem Motor (`motorSpeed`, `maxMotorTorque`).
  - Nahtlose Integration in `Scene.joints` und `PhysicsSystem` PGS-Solver iterations & force pass.
- **Testsuite & Stabilität:**
  - 190 Test-Suites mit 1090 bestandenen Tests (100% Pass-Rate).




