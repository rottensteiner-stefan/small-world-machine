# Liquid Extras (`@small-world-machine/liquid-extras`)

`@small-world-machine/liquid-extras` is an optional ecosystem package that provides art-directed liquid materials and a drop-impact system. It extends `StylizedWaterMaterial` through shader hooks and depends on `@small-world-machine/engine`.

## Import

```typescript
import {
  NoirWaterMaterial, OilSlickMaterial, OilPuddleMaterial, RainPuddleMaterial,
  DropImpactSystem, FluidPreset, FLUID_PRESETS, DropPreset,
} from "@small-world-machine/liquid-extras";
```

## Materials

| Material | Description |
|---|---|
| `NoirWaterMaterial` | Desaturated water with white ink ripples around floating objects (`rippleCenter`, `rippleCenter2`, `rippleCenter3`), contact shadow, crisp shoreline and tone posterizing (`posterizeSteps`) |
| `OilSlickMaterial` | Dark crude-oil surface with muted thin-film sheen (`iridescenceStrength`, default 0.6, 0 = pure black) |
| `OilPuddleMaterial` | Oil puddle with six looks (`OilPuddleLook`: `mutedSheen`, `tar`, `chiaroscuro`, `tarSkin`, `whaleOil`, `posterRings`) and three fluids (`OilPuddleFluid`: `crude`, `petrol`, `diesel`). Options include `color`, `highlightColor`, `highlightPoint`, `outlineWidth`, `meniscusStrength`, `envColor`, `ringEnabled`, `ringCount`. |
| `RainPuddleMaterial` | Physically based rain puddle on a street: dielectric Fresnel, dispersive rain rings, frayed shorelines. Use one large transparent plane just above the street. Up to `RAIN_PUDDLE_MAX_BASINS` (4) `basins`; options `asphaltMap`, `reflectionMap`, `rainIntensity`, `dripIntensity`. Each frame advance `time` and call `setCameraFootprint(...)`; exclude the plane from the reflection node (`excludedObjects`). |

The shared thin-film shading is exported as `THIN_FILM_GLSL_DECL` and `THIN_FILM_WGSL_DECL`.

## `DropImpactSystem`

Derives regime and optics parameters from the liquid (`fluid`) and the drops (`drops`) once and pushes them to any number of surfaces (`DropImpactSurface`, e.g. `RainPuddleMaterial`). A different liquid is a different `fluid` value, not new code.

```typescript
const drops = new DropImpactSystem({ fluid: FLUID_PRESETS[FluidPreset.WATER] });
drops.addSurface(puddleMaterial);

// each frame; recomputes only after fluid or drops changed
drops.apply();
```

* `FluidPreset`: `WATER`, `SEAWATER`, `BLOOD`, `OLIVE_OIL`, `USED_MOTOR_OIL`, `SULFURIC_ACID_98`, `BATTERY_ACID`
* `DropPreset`: `DRIZZLE`, `RAIN`, `HEAVY_RAIN`, `BRANCH_DRIPS`
* Helpers: `terminalVelocity(diameter)`, `dripImpactVelocity(diameter, fallHeight)`

## Related

[ADR 0025](/adr/0025-stylized-liquid-looks-engine-vs-extension), [ADR 0042](/adr/0042-drop-impact-system), Showcase 30 (rain puddle), Showcase 10 (`NoirWaterMaterial`)
