# Artistic Extras (`@small-world-machine/artistic-extras`)

Das Paket `@small-world-machine/artistic-extras` enthält malerische Materialien und Bildverarbeitung für stilisierte Looks: Metall-Wandrelief, Impasto-Pinselstriche und selektive Farbisolation. Es hängt nur von `@small-world-machine/engine` ab. Referenz-Anwendung: Showcase 41 (*Metal Wall Relief & Assemblage Art*, `apps/showcases/41/`).

## Installation & Import

```bash
npm install @small-world-machine/artistic-extras
```

```typescript
import {
  MetalReliefMaterial,
  MetalReliefScreenMaterial,
  ImpastoStrokeMaterial,
  MetalReliefPostProcessor,
  ArtisticColorUtils,
} from "@small-world-machine/artistic-extras";
// Reine Strich-Mathematik für das Impasto-Studio: pressureToBrush, interpolateStrokeSteps, buildStrokeSplats, ...
```

---

## Komponenten

### 1. `MetalReliefMaterial`
Material für skulpturale Metall-Wandreliefs: Spachtelstriche (`paletteKnifeStrength`, `paletteKnifeScale`), Schleifspuren (`scratchIntensity`, `scratchScale`), Kantenabschrägung (`edgeBevelStrength`), Drahtgitter (`wireMeshStrength`, `wireMeshScale`), Regenspuren (`wetRainStreaks`), Rost (`rustStrength`), selektive Farbisolation (`colorPopTargetHue`, `colorPopTolerance`, `colorPopDesaturation`) sowie `metallic` und `roughness`. Eine Textur wird über `diffuseMap` gesetzt.

### 2. `MetalReliefScreenMaterial`
Leinwand-/Screen-Material: Verwandelt ein beliebiges 2D-Bild (`diffuseMap`) per Sobel-Prägung (`reliefStrength`), Spachtelstrichen, Kratzern und Farbisolation (`targetHue`, `hueTolerance`, `desaturation`) in ein Metallrelief. `splitPosition` blendet ein Vorher/Nachher-Splitscreen ein.

### 3. `ImpastoStrokeMaterial`
Interaktives Impasto-Material: Höhenfeld und Strichrichtung kommen aus zwei Canvas-Texturen, die die App beim Malen neu hochlädt (`paintMap`, `dirMap`, dazu die Grundschicht `baseMap`; alle drei sind erforderlich). Parameter: `brushRelief`, `smearDistance`, `edgeLift`, `paintOpacity`, `metallic`, `roughness`. Die Strich-Mathematik (Druck → Pinselzustand, Segment-Interpolation, Splats) liegt DOM-frei in `StrokeRaster` und ist in Node testbar.

### 4. `MetalReliefPostProcessor`
Bildschirm-Postprocessor für Render, Foto oder Canvas mit denselben Parametern wie das Screen-Material (`reliefStrength`, `paletteKnifeStrength`, `scratchIntensity`, `targetHue`, `rustStrength`, `edgeGlintStrength`, `wireMeshStrength` ...). `applyToCanvas(sourceCanvas, targetCanvas?)` filtert ein Quell-Canvas per WebGL in ein Ziel-Canvas (Standard: dasselbe); es existieren Shader für WebGL1, WebGL2 und WebGPU.

### 5. `ArtisticColorUtils`
Farbraum-Helfer: RGB↔HSV, selektive Farbisolation („Color Pop") und malerisches Rost-/Stahl-Tonemapping.

---

## Beispiel

```typescript
const relief = new MetalReliefMaterial({
  diffuseMap: await Texture.fromUrl("/assets/painting.webp", { flipY: true }),
  paletteKnifeStrength: 0.8,
  scratchIntensity: 0.5,
  colorPopTargetHue: 0.0, // Rot bleibt farbig, der Rest wird entsättigt
});
plane.material = relief;
```
