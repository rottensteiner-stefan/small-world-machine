# Decals

A `Decal` projects a texture onto whatever opaque geometry lies inside its box: stripes on a
floor, a sign on a wall, grime around a pedestal. It is implemented on **WebGL2 and WebGPU**;
WebGL1 has no samplable depth and no MRT, so decals are ignored there. The design decisions
behind the normal buffer are in [ADR 0028](/adr/0028-thin-normal-buffer-mrt).

## Creating a decal

```typescript
import { Decal, DecalMaterial, Texture } from "@small-world-machine/engine";

const stripes = await Texture.fromUrl("/assets/kits/flakturm/decals/hazard_stripes.png");

const decal = new Decal(new DecalMaterial({ diffuseMap: stripes }), "FloorStripes");
decal.setPosition(-1.6, 0, 0.6).setScale(3, 0.8, 1);
scene.add(decal);
```

A `Decal` is an `Object3D` with a shared unit cube as geometry. The box spans [-0.5, 0.5] on
each axis and `scale` is its world size. It is never a physics collider, never a raycast
target and casts/receives no shadows; its bounds exist only for frustum culling.

## `DecalMaterial` options

| Option              | Default | Meaning                                                                                                  |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `color`             | white   | Tint multiplied onto the albedo; its alpha scales the whole decal.                                       |
| `diffuseMap`        | none    | Albedo (rgb, sRGB) and coverage (a).                                                                     |
| `normalMap`         | none    | Tangent-space normal map, applied on top of the receiver's normal.                                       |
| `ormMap`            | none    | Packed map: R = AO, G = roughness, B = metallic (linear). Multiplied with the scalars; R scales ambient. |
| `emissiveMap`       | none    | Emissive texture (sRGB), times `emissiveColor` x `emissiveIntensity`. Lit decals only.                   |
| `emissiveColor`     | black   | Emissive tint; black means no emission, even with an `emissiveMap`.                                      |
| `emissiveIntensity` | `1`     | Emissive strength.                                                                                       |
| `roughness`         | `0.8`   | PBR roughness (clamped to 0.05..1 in the shader).                                                        |
| `metallic`          | `0`     | PBR metallic.                                                                                            |
| `edgeFade`          | `0.1`   | Fraction of the box (0..0.5) over which the decal fades out towards its edges.                           |
| `angleFadeStart`    | `60`    | Angle in degrees between the receiver normal and the decal's up axis where fading starts.                |
| `angleFadeEnd`      | `85`    | Angle in degrees where the decal is fully faded out.                                                     |
| `mipBias`           | `0`     | LOD bias in mip levels on the finite-difference UV gradients (negative = sharper).                       |
| `unlit`             | `false` | Flat albedo, no lighting: about half the cost of a lit decal; leaves the normal buffer alone.            |

The angle fade is what keeps a floor decal from smearing up the vertical sides of an object
that pokes through its box.

## Orientation rules

- Local **+Y is the surface normal** ("up" of the decal); the projection axis is **-Y**.
- The texture maps onto box **x/z**: `uv = boxPos.xz + 0.5`. The texture stands upright when
  you look at the surface along -Y with +Z pointing towards you.
- **No negative scale.** Mirroring flips the winding and the unprojection assumes a proper
  rotation; use a positive scale and rotate instead.
- The box height (scale Y) is the projection depth: geometry deeper or higher than the box
  gets no decal.

Rotation recipes:

| Receiver          | Rotation (`setRotation`) |
| ----------------- | ------------------------ |
| Floor (normal +Y) | `(0, 0, 0)`              |
| Wall facing +Z    | `(Math.PI / 2, 0, 0)`    |

```typescript
// Sign on the +Z face of a wall at z = -3 (wall thickness 0.4 -> face at z = -2.8).
const sign = new Decal(new DecalMaterial({ diffuseMap: signTexture }), "WallSign");
sign
  .setPosition(0, 1.8, -2.8)
  .setRotation(Math.PI / 2, 0, 0)
  .setScale(2.4, 0.6, 1.2);
scene.add(sign);
```

Overlapping decals stack deterministically (independent of the camera): higher `decal.priority`
draws later (on top); on equal priority the larger world volume draws first (broad grime below
small details); then creation order decides.

## How it renders

1. The opaque pass runs as usual; its depth is copied so it can be sampled.
2. For every visible decal (sorted as above) the box is drawn after the opaque pass and before
   the transparent pass, back faces only, without depth test or depth write. Back faces mean
   the camera may sit inside the box.
3. Per pixel the fragment shader unprojects the opaque depth into box space and discards
   everything outside the box (and the sky). What remains is lit forward with the scene's
   clustered lights and shadows, then alpha-blended over the opaque image.
4. The receiver normal comes from the normal buffer if present (it includes the receiver's
   normal map), otherwise it is reconstructed from the depth neighbours.

## What a decal does not do

- **No decals on transparents.** The decal only sees the opaque depth.
- **No decals in offscreen targets** (reflections, probes, imposters). Decals count only in
  frames of the main target.
- **WebGL1 ignores decals** (see above).
- No shadow casting, no collision, no picking.

## `quality.normalBuffer`

A thin world-space normal buffer (octahedral, `rg16float`, second render target of the main
pass) lets a decal pick up the receiver's normal map and gives sharper angle fades. Set it on
the engine quality options:

| Value              | Behaviour                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `"auto"` (default) | Off until a decal is visible in the main target, then on. It stays on afterwards (no flicker). Without decals it costs nothing. |
| `true`             | On from the start.                                                                                                              |
| `false`            | Never on; decals reconstruct the normal from depth (HBAO always does, regardless).                                              |

- **WebGPU:** works directly; the first frame with a decal creates the texture and pipelines.
- **WebGL2:** needs **post-processing** enabled (only then there is an FBO). Without it you get
  a warning and the depth-derived fallback. Turning the buffer on rebuilds the HDR target and
  recompiles programs once, which can cause a one-time hitch.

## Cost guidance

Every decal is shaded for every pixel its rasterised box covers, even where the depth test
inside the shader then discards the pixel; the cost therefore scales with **screen area of
the boxes** times the lighting cost, not with the number of decals as such.

Measured with the decal probe on real GPU:

- Stress case, 32 large, overlapping, lit decals at 5600x2968: between **96 and 374 ms** per frame in
  different runs of the same scene (the test machine's GPU clock/load varies by up to 4x), so absolute
  milliseconds are not reliable.
- Within one session the ratio is stable: an **unlit** decal costs about **0.5x** of a lit one
  (52 vs 96 ms, 188 vs 374 ms).
- A typical scene with a few decals: not measurable against frame time.

Budget guideline (qualitative, no millisecond threshold yet): cost is proportional to the summed
screen area of the boxes. Keep boxes tight, avoid stacking large overlapping layers, and make
large overlapping decals (dirt, stains) `unlit`. A real threshold needs measurements on target
devices; on tile-based mobile GPUs the normal buffer is a known risk (see ADR 0028) and needs
its own measurement.

## Mip sharpness (`mipBias`)

Decals sample with explicit gradients from three depth taps per axis. `?mip=1` in the probe puts a
Plane mesh (hardware mips) and a Decal with the same 256x256 line texture side by side at a
grazing angle; `node scripts/measure-decal-mips.mjs` compares a normalised gradient sharpness
(decal / plane) per depth band on WebGL2 and WebGPU. With `mipBias = 0` the ratio is 0.99-1.06
across the mid and far bands (0.89 in the nearest, magnified band), so the decal is not measurably
blurrier. A negative bias over-sharpens (-0.25: up to 1.3x, -0.5: up to 1.6x, mid-distance) and
the frame-to-frame shimmer proxy grows to 1.5-1.9x the plane's. Default stays 0; use a small
negative value only for deliberately crisp, nearby decals.

## Decal probe and tests

`apps/showcases/decal-probe` shows decals on a floor, a wall and a pedestal, plus UV and
normal probes. Query parameters:

- `?nb=1` / `?nb=0` forces the normal buffer on / off (default: auto)
- `?pp=1` enables post-processing (needed for the normal buffer on WebGL2)
- `?spot=1` swaps the sun for a shadow-casting spot light across a decal edge
- `?rendererType=WEB_GPU` or `WEB_GL2` picks the backend
- `?mip=1` (+ `?mipbias=<n>`) swaps in the mip-sharpness comparison scene

`npm run test:decals` (`scripts/check-decals.mjs`) drives that page in a headless browser and
asserts on GPU readbacks (normal buffer contents, decal pixels). WebGL2 results are blocking;
WebGPU results are informational unless `DECAL_REQUIRE_WEBGPU=1` is set. `DECAL_ORIGIN`
overrides the dev-server origin (default `https://localhost:5173`).

## Notes (verified)

- **ORM map:** channel order matches the rest of the engine / glTF: R = AO, G = roughness, B = metallic (`Standard.frag.wgsl:8-10`, `Standard.frag.glsl:90,96,102`). `DecalMaterial.ormMap` binds to the shared `u_aoMap` slot because the WebGPU material bind group has a fixed binding table (`GPUPipelineCache.getOptionalMaterialTextureBindings`) and WGSL flag constants are hardcoded in `GPUPipelineCache`; WGSL gates the tap with `matParam6.x`, GLSL with `USE_DECAL_ORM`. Both sample with `g_uvGradX/Y`. Emissive reuses the lit chunk's `u_specColor` x `u_emissiveMap` path (gradient sampling already wired); unlit decals skip it. `?orm=1` on the decal probe and `npm run test:decals` check on both backends that AO 0 darkens the decal (luma 92 vs 189), a neutral ORM changes nothing, an emissive map adds red only and an unlit decal ignores it. Metallic is checked through B (material metallic 1: a neutral ORM turns the decal dark, B = 0 switches it off again to the control value) and roughness through G (G = 0.4 shifts the pixel by about 9 luma against the control on both backends; the direction is not asserted, the check proves only that the channel is read).
- **Vertex alpha:** vertex colour is RGBA (`Mesh.ts:4,256`, `GPUPipelineCache.ts:426-437`) behind `USE_VERTEX_COLOR`, not combinable with instancing. Only `StylizedLava` consumes it; Standard/Decal shaders and the glTF loader (`COLOR_0`) do not. A baker must add the consumer side itself.

> Normal-mapped receivers: `?bump=1` on the decal probe tilts the floor normal map; `npm run test:decals` checks the normal buffer carries it, decals blend onto it, and HBAO (flat depth normal) ignores it.
