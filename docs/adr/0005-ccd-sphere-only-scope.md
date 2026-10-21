# Continuous Collision Detection (CCD) deckt nur Kugel-Körper ab

`PhysicsSystem.ccdMotionThreshold` fegt einen Körper automatisch auf Tunneling ab nur dann, wenn
es sich um eine Kugel handelt, die sich in einem Substep weiter als `radius * ccdMotionThreshold`
bewegt. Box-/OBB-Körper bleiben rein diskret — kein Sweep, kein CCD — obwohl auch sie bei hoher
Geschwindigkeit durch dünne Geometrie tunneln können. Echtes Swept-OBB-CCD bräuchte
GJK-/Conservative-Advancement-artige kontinuierliche Mathematik; Kugel-Sweeps reduzieren sich auf
geschlossene Ray-/Slab-Tests, die wir schon hatten (`Ray.intersectsBox`, radiusexpandiert). Kugeln
decken in der Praxis außerdem die überwältigende Mehrheit der echten Tunneling-Fälle ab (schnelle
Bälle/Projektile), zu einem Bruchteil des Implementierungsaufwands.

**Das hier überdenken, wenn:** ein Showcase schnell bewegte Box-/OBB-Körper braucht, die durch
dünne Wände/Böden tunneln. Das ist neue Arbeit (echte Convex-Sweep-Mathematik), kein Bugfix am
bestehenden CCD-Pfad — von `ccdMotionThreshold` ist so, wie es ist, keine Hilfe für Box-Körper zu
erwarten.

> **Status (2026-10-21): überholt.** `SweptVolumeCCD` (`packages/engine/src/physix/ccd/SweptSphereCCD.ts`) sweept inzwischen auch Box und OBB (`CollisionSweepSolver`). Dieser ADR beschreibt den ursprünglichen Stand.
