# Liquid Extras (`@small-world-machine/liquid-extras`)

Das Paket `@small-world-machine/liquid-extras` bündelt Art-Direction-Pakete und hook-basierte Shader-Erweiterungen für Flüssigkeiten. Es erweitert die Engine-Materialien (`StylizedWaterMaterial`), ohne den Kern zu forken (siehe [ADR 0025](/adr/0025-stylized-liquid-looks-engine-vs-extension) und [ADR 0042](/adr/0042-drop-impact-system)). Es hängt nur von `@small-world-machine/engine` ab.

## Installation & Import

```bash
npm install @small-world-machine/liquid-extras
```

```typescript
import {
  NoirWaterMaterial,
  OilSlickMaterial,
  OilPuddleMaterial,
  RainPuddleMaterial,
  DropImpactSystem,
  FluidPreset,
  FLUID_PRESETS,
  DropPreset,
} from "@small-world-machine/liquid-extras";
```

---

## Materialien

| Material | Beschreibung |
|---|---|
| **`NoirWaterMaterial`** | Aufsatz auf `StylizedWaterMaterial`: Wasser auf Luma entsättigt, konzentrische weiße Tuschewellen um schwimmende Objekte (`rippleCenter`, `rippleCenter2`, `rippleCenter3`), Kontaktschatten, scharfe Uferlinie, Tonwert-Posterisierung (`posterizeSteps`). |
| **`OilSlickMaterial`** | Dunkle, zähe Rohölfläche auf Basis von `StylizedWaterMaterial`; gedämpfte Dünnschicht-Interferenz (`iridescenceStrength`, Standard 0.6, 0 = reines Schwarz). |
| **`OilPuddleMaterial`** | Ölpfütze in sechs Looks (`OilPuddleLook`: `mutedSheen`, `tar`, `chiaroscuro`, `tarSkin`, `whaleOil`, `posterRings`) und drei Ölsorten (`OilPuddleFluid`: `crude`, `petrol`, `diesel`). Optionen u. a. `color`, `highlightColor`, `highlightPoint`, `outlineWidth`, `meniscusStrength`, `envColor`, `ringEnabled`, `ringCount`. |
| **`RainPuddleMaterial`** | Physikalisch basierte Regenpfütze auf einer Straße: Fresnel-Reflexion, dispersive Regenringe, ausgefranste Ufer. Gedacht für eine große transparente Ebene knapp über der Straße; bis zu `RAIN_PUDDLE_MAX_BASINS` (4) Mulden (`basins`), `asphaltMap`, `reflectionMap` (z. B. `PlanarReflectionNode.renderTarget`), `rainIntensity`, `dripIntensity`. Pro Frame muss `time` fortgeschrieben und `setCameraFootprint(...)` aufgerufen werden; die Ebene gehört in die `excludedObjects` des Reflexionsknotens. |

Das gemeinsame Dünnschicht-Shading (`thinFilm`, GLSL- und WGSL-Variante) ist als `THIN_FILM_GLSL_DECL` / `THIN_FILM_WGSL_DECL` exportiert.

---

## `DropImpactSystem` (ADR 0042)

Tropfen-Einschläge sind ein eigenes System statt eines Materials: Stoffwerte der Flüssigkeit (`fluid`) und der Tropfen (`drops`) werden einmal zu Regime- und Optik-Parametern verrechnet und an beliebig viele Oberflächen (`DropImpactSurface`, z. B. `RainPuddleMaterial`) verteilt. Paarungen sind Daten: Blut statt Wasser ist ein anderes `fluid`, kein neuer Code.

```typescript
const drops = new DropImpactSystem({
  fluid: FLUID_PRESETS[FluidPreset.WATER],
  // drops: DropProperties (Regen-Presets: DropPreset.DRIZZLE | RAIN | HEAVY_RAIN | BRANCH_DRIPS)
});
drops.addSurface(puddleMaterial);

// Pro Frame (billig, rechnet nur nach Änderungen neu):
drops.apply();
```

Flüssigkeits-Presets (`FluidPreset`): `WATER`, `SEAWATER`, `BLOOD`, `OLIVE_OIL`, `USED_MOTOR_OIL`, `SULFURIC_ACID_98`, `BATTERY_ACID`. Hilfsfunktionen: `terminalVelocity(diameter)`, `dripImpactVelocity(diameter, fallHeight)`.

Referenz-Anwendungen: Showcase 30 (Regenpfütze) und Showcase 10 (`NoirWaterMaterial`).
