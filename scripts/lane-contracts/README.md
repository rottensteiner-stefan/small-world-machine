# Lane-Contract-Registry (T3)

Kanonisches, test-deklariertes Verzeichnis aller repurposed `ObjectUniforms`-Lanes des
Liquid-Style-Structs — **Engine ↔ `@small-world-machine/liquid-extras` (Noir/Oil)**.

Teil von **T3** der Flüssigkeits-Roadmap: `.agents/collaborate/liquid-roadmap.md` §8.2/T3.
Es ist ein **hartes Gate vor Block S**: Jede neue Lane (z.B. S2-Splat-Lane, S3-Wall-Contract)
muss vor der Implementierung hier registriert sein. Eviction einer Lane ⇒ **Re-Homing auf
Per-Style-Konstante, nie silent delete** (G3).

## Dategröße
- `lane-contracts.json` — das deklarative Artefakt (Schema stabil, siehe unten).
- `scan.js` — statischer Scanner: prüft die realen Shader-/TS-Quellen gegen die Registry und
  meldet Kollisionen/Writing-Drift. Exit 0 ok · 1 Verletzung · 2 technisch.
- `README.md` — diese Datei.

## Schema (stabil — neue Einträge nur als zusätzliche Objekte)
Jede Lane-Zeile: `lane`, `meaning`, `materialTypes`, `styleIds`, `writeOrder`,
`range`, `evictionPolicy`, optional `collision`. Zusätzlich `registration[]` für future lanes
(status `reserved`). Konsumenten (T4-Style-Dispatch-Test, CI) LESEN dieses File; der Scanner
schreibt nichts zurück.

## Wichtige Fakten (verifiziert gegen HEAD)
- Uniform-Slot `ObjectUniforms` ist **voll** (256 B) — neue Parameter nur per repurposed Lane
  oder Per-Style-Konstanten.
- Basis-Lanes (StylizedWaterMaterial, Styles 0/1/2/4/5): `u_styleA = [rampSoftness, washAmount,
  lineDensity, lineWidth]`, `u_styleB.w = styleId`.
- **`u_styleA.w`-Kollision (3 verifikationen, je Materialtyp):** Basis = `lineWidth`;
  NoirWaterMaterial (styleId 3.0) = `posterizeSteps`; OilSlickMaterial (styleId 3.0) =
  `iridescenceStrength`. Gültig NUR weil `styleId==3.0` (isExtension) + `mat.type`-Dispatch
  exakt einen Pfad aktiviert. Registry-`collision`-Feld dokumentiert das.
- Hooks: `[WATER_EXT_DECL]` / `[WATER_EXT_SURFACE]` (ADR 0025); Erweiterungen nutzen die
  Surface-Hook-Injektion.

- OpenWater-Lanes: `u_styleA` = Splat `[x, z, spawnTime, energy]`, `u_matParam2.w` =
  `poolHalfExtent` (Clapotis-Wände, 0 = aus, Default 4.0). Beide werden von
  `OpenWaterMaterial._packVariantLanes()` geschrieben und von `OpenWaterSurfaceProbe` gespiegelt.

## Was der Scanner (nicht) beweist
Marker sind Substring-Treffer im kommentarbereinigten Quelltext: er beweist, dass ein deklarierter
Lane-Write noch **vorhanden** ist, nicht dass er korrekt ist oder der Shader ihn wie deklariert
liest. Jede Registry-Bedeutung ohne Marker-Mapping in `scan.js` ist eine Verletzung. Namens-
Zuordnung Shader <-> Material prüft `LiquidUniformNameParity.test.ts`.

## Nutzung
```bash
node scripts/lane-contracts/scan.js
```
Der Scanner wird von `packages/engine/tests/renderers/shaders/LiquidLaneContracts.test.ts`
und `packages/liquid-extras/tests/LaneTransport.test.ts` referenziert (Stichprobe gegen reale
Quellen). S2-Splat-Lane und S3-Wall-Contract sind als `reserved` registriert und müssen vor
Umsetzung durch diesen Registry-Pass.
