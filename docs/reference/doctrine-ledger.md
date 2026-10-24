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
