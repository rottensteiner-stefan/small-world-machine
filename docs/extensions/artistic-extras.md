# Artistic Extras (`@small-world-machine/artistic-extras`)

`@small-world-machine/artistic-extras` is an optional ecosystem package that provides painterly materials and image processing: metal wall relief, impasto strokes and selective color isolation. It depends on `@small-world-machine/engine`.

## Import

```typescript
import {
  MetalReliefMaterial,
  MetalReliefScreenMaterial,
  ImpastoStrokeMaterial,
  MetalReliefPostProcessor,
  ArtisticColorUtils,
} from "@small-world-machine/artistic-extras";
```

`StrokeRaster` exports the DOM-free stroke math (`pressureToBrush`, `interpolateStrokeSteps`, `buildStrokeSplats`).

## Components

| Class | Description |
|---|---|
| `MetalReliefMaterial` | Metal wall relief material. Options: `diffuseMap`, `color`, `paletteKnifeStrength`, `paletteKnifeScale`, `scratchIntensity`, `scratchScale`, `edgeBevelStrength`, `wireMeshStrength`, `wireMeshScale`, `wetRainStreaks`, `rustStrength`, `colorPopTargetHue`, `colorPopTolerance`, `colorPopDesaturation`, `metallic`, `roughness` |
| `MetalReliefScreenMaterial` | Turns a 2D image (`diffuseMap`) into a metal relief with Sobel embossing (`reliefStrength`), palette knife, scratches and color isolation (`targetHue`, `hueTolerance`, `desaturation`). `splitPosition` shows a before/after split. |
| `ImpastoStrokeMaterial` | Live impasto material. `paintMap`, `dirMap` (canvas textures the app re-uploads while painting) and `baseMap` are all required. Options: `brushRelief`, `smearDistance`, `edgeLift`, `paintOpacity`, `metallic`, `roughness`. |
| `MetalReliefPostProcessor` | Screen-space version of the relief effect with the same parameters. `applyToCanvas(sourceCanvas, targetCanvas?)` filters a canvas through WebGL; shaders exist for WebGL1, WebGL2 and WebGPU. |
| `ArtisticColorUtils` | RGB/HSV conversion, color-pop isolation, rust/steel tone mapping |

## Example

```typescript
plane.material = new MetalReliefMaterial({
  diffuseMap: await Texture.fromUrl("/assets/painting.webp", { flipY: true }),
  paletteKnifeStrength: 0.8,
  scratchIntensity: 0.5,
  colorPopTargetHue: 0.0, // red stays colored, the rest is desaturated
});
```

## Related

Showcase 41 (`apps/showcases/41/`)
