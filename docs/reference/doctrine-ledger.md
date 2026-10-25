# Doctrine-Ledger — KPI- und Fang-Nachweis (Whack-a-Mole-Doktrin, ADR 0047)

> **Zweck (committed; D15/R6):** Dieses Ledger ist der **verbindliche, versionierte** Nachweis von
> Fängen, Rekalibrierungen und Sunset-Entscheidungen der Whack-a-Mole-Doktrin (ADR 0047). Es ist
> bewusst **committed** (`.agents/notes` ist gitignored und in Fresh-Clones abwesend — D15) und lebt
> in Deutsch wie alle committed Doktrin-Dokumente (D14/Q7). `.agents/notes/backlog.md` bleibt nur die
> operative Scratch-Tracking-Stelle.
>
> **Semantik der Spalten:**
> `Datum` Gate-/Fang-Datum · `Prinzip` referenziert P1–P5 (ADR 0047 §D1) · `Fundstelle` file:line-Anker
> auf dem jeweiligen HEAD · `Typ` **A** = Korrektheits-Kontrakt (bindet sofort) bzw. **B** =
> Verhaltens-Heuristik (Klasse-B, verdient Schärfe per eigener Rule of Three) · `Status` `offen` /
> `behoben` / `archiviert` (Sunset) · `Veto-Grund` Begründung bei bewusster Abweichung, sonst `—`.
>
> **Klasse-B-Förderung (Rule of Three):** Eine Heuristik startet advisory; ihre ersten **3
> unabhängigen Echtfänge** (Defekt mit file:line + rotierendem Test, hier verbucht) heben sie auf
> Warn-, dann Error-Tier. **Sunset:** 2 aufeinanderfolgende Quartale mit 0 Fängen → archivieren
> (Begründung bleibt hier erhalten). **Rekalibrierung:** Reversions > Fänge am nächsten Gate.

## Seed (Stand: P1-Gate, 2026-10-24)

Bewusst **nur vorbefüllt** mit den bereits real umgesetzten Phase-1-Exempeln (als `behoben`) — das
Ledger ist damit ehrlich und nicht leer; es erfindet keine offenen Fälle. Offene Zeilen werden ab
dem ersten neuen Fang ergänzt.

| Datum | Prinzip | Fundstelle (file:line) | Typ | Status | Veto-Grund |
|---|---|---|---|---|---|
| 2026-10-24 | P1 | `packages/engine/src/core/controllers/OrbitController.ts` (Dead-Knob `minPhi`/`maxPhi` entfernt; grep → 0 Treffer) | B | behoben | — |
| 2026-10-24 | P1/P3 | `packages/engine/src/core/cameras/strategies/FPSStrategy.ts:18–23,34–35` (`invertY` = Natural-Pitch-Escape) | A | behoben | — |
| 2026-10-24 | P5/P4 | `packages/engine/src/core/Object3D.ts:94–102` (BoundingSphere-/`isCollidable`-Vertrag) | A | behoben | — |
| 2026-10-24 | P3/P1 | `packages/engine/src/core/cameras/strategies/FPSStrategy.ts:26–31` (Sentinel `targetPos !== camera.target` gelöscht) | B | behoben | Sentinel-Identität: Fang #1 der M3b-Heuristik (Evidenz-Zähler beginnt) |
| 2026-10-24 | P3 | `packages/engine/src/core/cameras/Camera.ts:229–243` (`setStrategy` konvertiert theta/phi explizit, D3) | A | behoben | — |
| 2026-10-24 | P3 | `packages/engine/src/core/Object3D.ts:104–117` + `core/Scene.ts:214–216` (`isStatic` = Absicht, kein Optimierungs-Hebel) | A | behoben | — |
| 2026-10-24 | P5/P4 | `packages/engine/tests/core/CameraDegenerateSoftFail.test.ts` (Soft-Fail-Verträge gepinnt, D8/H2) | A | behoben | — |

## Nutzung & Veto-Regeln

- **Klasse-A-Kontrakte** (Klassifikation, Registry-ID, Transitionstest, ADR-Compliance) werden im
  Regelfall direkt erfüllt; ein gezielter Verstoß wird hier als `behoben`-oder-`offen`-Zeile mit
  Veto-Grund verbucht (verpflichtender Escape-Hatch-Grund, ADR 0047 §„Escape-Hatch").
- **Klasse-B-Heuristiken** (`dead-knob`, `sentinel-identity`, `untagged-param`,
  `unguarded-division`, …) konsumieren die Outputs von `npm run check:doctrine -- --enable-advisory`;
  jeder **Echtfang** (Defekt bewiesen mit file:line + rotierendem Test) wird hier als neue Zeile
  eingetragen und startet den 3-Fänge-Zähler der jeweiligen Heuristik.
- **Sunset/Rekalibrierung:** nach 2 Quartalen ohne Fang bzw. bei Reversions > Fängen (siehe oben); die
  Begründung wird in dieser Datei archiviert und nie still gelöscht (Daten-Integrität, AGENTS.md §1).

## P5-Gate: Seed-Erweiterung 15 IDs (DP-1, 2026-10-25)

Der P5-Beschluss (Option A) erweitert die Invarianten-Registry (ADR 0047) um **15 IDs** der
S4-Matrix (1.1–3.2) + P4-DP-7-Fläche. Jede ID ist auf HEAD **real verankert** (Registry + ADR-0047-
Seed-Tabelle + Test-Anker in einem Commit, damit `check:doctrine` Exit 0 bleibt — die Registry ist
exakt die Menge verankerter Invarianten, keine Wunschliste):

| Datum | Prinzip | Fundstelle (file:line) | Typ | Status | Veto-Grund |
|---|---|---|---|---|---|
| 2026-10-25 | P2/P5 | `scripts/check-doctrine.ts` `INVARIANT_REGISTRY` (Seed +15) + ADR-0047-Seed-Tabelle | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/physix/FpsChunkingEquivalence.test.ts` (`FPS-CHUNKING-EQUIVALENCE`, physik-scoped A8) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/physix/StandingInvariant.test.ts` (`PHYS-STANDING`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/core/behaviors/BehaviorMutationFuzz.test.ts` (`BEHAVIOR-MUTATION-SAFETY`, seed-gepinnt) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/physix/PhysicsDeterminism.test.ts` (`STATIC-ORDER-INVARIANCE`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/renderers/HzbReadbackWindow.test.ts` (`HZB-READBACK-WINDOW`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/renderers/FroxelReprojection.test.ts` (`FROXEL-TELEPORT-MATH`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/materials/PbrEnergyConservation.test.ts` (`PBR-ENERGY-CONSERVATION`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/renderers/PcssMonotonicity.test.ts` (`SHADOW-PCSS-MONOTONICITY`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/renderers/CsmC0Continuity.test.ts` (`CSM-C0-CONTINUITY`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/core/CameraStrategyTransitionInvariant.test.ts` (`CAM-TRANSITION-INVARIANCE`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/core/FrustumDualSpace.test.ts` (`FRUSTUM-DUAL-SPACE`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/math/ClusterGrid.test.ts` (`CLUSTER-NON-SINGULAR`) | A | behoben | — |
| 2026-10-25 | P2/P5 | `packages/engine/tests/math/MirrorReversibility.test.ts` (`TRANSFORM-REVERSIBILITY`) | A | behoben | — |
| 2026-10-25 | P4/P5 | `SmallWorldMachine.ts` `notifyCameraTeleport` + `tests/core/SmallWorldMachineTeleport.test.ts` (`TELEPORT-RESET-SYNC`, S3-DP-4A, bereits geverankt) | A | behoben | — |

## Kampagnen-Abschluss: verifizierte Marker (S3/E10, 2026-10-25)

Nach Ablauf der Verifikations-Fangnetz-Phase nachgetragen (keine Duplikate): Die 15 P5-IDs oben sind
vollständig im Ledger verankert. Die beiden folgenden Marker sind auf HEAD real verankert, fehlten im
Ledger aber noch.

| Datum | Prinzip | Fundstelle (file:line) | Typ | Status | Veto-Grund |
|---|---|---|---|---|---|
| 2026-10-25 | P3 | `packages/engine/tests/core/SmallWorldMachinePhaseOrder.test.ts` — Registry-ID `FRAME-ORDER` (S3 DP-1A, Phase-Order-Oracle; verifiziert nachgetragen) | A | behoben | — |
| 2026-10-25 | P3 | `packages/engine/src/core/lights/DirectionalLight.ts:65–68,192–206` — `@fixed k = 1.2` (E10/DP-13): bewusst eingefrorener per-Kaskaden-Normal-Offset-Schatten-Bias-Koeffizient (kein Knob), gebacken in `updateCascades`; Bezug zu `CSM-C0-CONTINUITY` (derselbe `updateCascades`-Real-Pfad, per-Kaskaden-Lane); `GlobalUniformLayout.ts:133–134` | A | behoben | — |

### Fang: `SCENE-HIERARCHICAL-CONTAINMENT` (genuine Lücke, D17-escalated)

Der S4-3.1-Scope-Erstlauf deckte eine **echte Lücke** auf (kein Audit-Artefakt): Der Parent-
early-return in `_collectVisible` kann In-Frustum-Kinder **innerhalb eines sichtbaren Parents**
verschlucken, wenn das Parent schon vorher per Frustum ausscheidet. Der Fokus-Test ist als
`it.todo` verankert (bewusster, ehrlicher roter Fleck statt stillem grünem Schein), begleitet von
durchlaufenden Happy-Path-/Traversal-Sub-Tests. Die Lücke ist an den Moderator eskaliert (P5-IMPL-
Blocker-Eskalation, `SCENE-HIERARCHICAL-CONTAINMENT`).
→ Update 2026-10-25: Engine-Fix als eigener Beschluss umgesetzt (`1b8968a1`), `it.todo` auf grün
gedreht (echter Test), Engpass geschlossen — Status `behoben`.

| Datum | Prinzip | Fundstelle (file:line) | Typ | Status | Veto-Grund |
|---|---|---|---|---|---|
| 2026-10-25 | P2 | `packages/engine/tests/core/SceneContainment.test.ts` (`SCENE-HIERARCHICAL-CONTAINMENT` `it.todo`) | A | behoben | → Update 2026-10-25: Engine-Fix `1b8968a1` (Parent-Early-Return entfernt), Test grün — Lücke geschlossen (historischer Fang bleibt verbucht) |
