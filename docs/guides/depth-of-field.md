# Depth of Field (Thin Lens)

Physically based depth of field driven by real lens parameters. The circle of confusion (CoC)
follows the thin-lens model

```
c(d) = A·f·|d − d_f| / (d·(d_f − f)),   A = f / N
```

with focal length `f`, f-number `N`, focus distance `d_f` and linear view depth `d`. The CoC on the
sensor is mapped to pixels via `sensorHeight` and the viewport height, and clamped to
`maxCocRatio × viewport height`.

For a blur that matches the framing, derive `focalLength` from the camera's vertical FOV instead of
picking it freely: `focalLength = sensorHeight / (2·tan(fovY / 2))`. A 70 mm lens on a 48° camera
blurs like a telephoto while framing like a 27 mm wide angle.
The same math is exported for CPU use as `computeCocScalePx()` / `computeSignedCocPx()`
(`renderers/post/elements/DepthOfFieldElement.ts`).

## Enabling the effect

```ts
renderer.postProcessing.enabled = true;
const dof = renderer.postProcessing.get<DepthOfFieldElement>(PostProcessingEffectType.DEPTH_OF_FIELD)!;
dof.enabled = true;
dof.focusDistance = 0.8; // metres
dof.focalLength = 85;    // mm
dof.fStop = 1.4;
```

Or via config: `postProcessing.effects.depthOfField = { enabled: true, focusDistance: 0.8, ... }`.

| Field | Default | Meaning |
|---|---|---|
| `focusDistance` | `2.0` | Distance of the plane in perfect focus (m) |
| `focalLength` | `50` | Lens focal length (mm) |
| `fStop` | `2.0` | Aperture f-number; smaller = more blur |
| `sensorHeight` | `24` | Sensor height (mm), maps sensor CoC to pixels |
| `maxCocRatio` | `0.015` | CoC diameter cap as a fraction of the viewport height (~16 px at 1080p); resolution- and DPR-independent |
| `focusScreenY` | `0.5` | WebGL1 only: focus row of the tilt-shift fallback (0 = bottom) |

## Per API tier

| Tier | Algorithm |
|---|---|
| WebGPU | Half-res CoC prefilter → 64-tap golden-angle (Vogel) scatter-as-gather bokeh → full-res composite with CoC-aware bilateral upsample |
| WebGL2 | Same passes, 32 gather taps |
| WebGL1 | No opaque-depth capture on this tier, so a screen-space tilt-shift: sharp band around `focusScreenY`, ramping to the lens' far-field CoC (`min(S, maxCocRatio × height)`) |

The gather treats each tap as "does this sample's blur disc reach me?". Samples behind the centre
may spread no wider than the centre's own CoC, so a sharp foreground is never overdrawn by the
blurred background, while a defocused foreground bleeds over in-focus pixels as a real lens does.

## Position in the post chain

TAA → motion trail → **depth of field** → bloom → HBAO / light shafts / volumetric fog → uber pass
(tone mapping, grading, vignette, grain). DoF works on linear HDR radiance so bright highlights
form bokeh discs before bloom and tone mapping. AO, light shafts and volumetric fog are composited
in the uber pass and are therefore not defocused — acceptable for these low-frequency terms.
