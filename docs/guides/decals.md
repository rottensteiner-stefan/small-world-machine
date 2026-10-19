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

## Decals on props: `parent` and `socket`

In a level descriptor a decal with `parent: "<prop id>"` becomes a child of that prop and moves with
it; `position` and `rotation` are then local to the prop. To pin a decal to a named spot on the
prop (a sign on a door leaf) add `socket: "<socket name>"`: the decal is attached to the prop's
`Socket_<name>` anchor, and `position`/`rotation` are offsets local to the socket. A `socket`
needs a `parent`.

Sockets are the `sockets` list of the prop's `meta.json` (`name`, `position`, and now an optional
`rotation` in radians; the lights of `recommendedLight` use the same anchors). For a decal the
anchor's local +Y axis is the surface normal, so give a socket on a vertical face a `rotation`
that turns +Y outward, for example `[1.5708, 0, 0]` for a face looking down +Z. A decal then
needs no rotation of its own. Asking for a socket the prop does not have throws on load and
fails the level validation test (`LevelValidation.test.ts` reads the prop's `meta.json`);
`level.schema.json` rejects a `socket` without a `parent`. `SWM_decal` (Maker) does not store
sockets: a stamped decal keeps its node hierarchy, which already carries the anchor.

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

## Persisting decals in glTF (`SWM_decal`)

`WorldWriter` writes every `Decal` that has `kitDecal` set as a node with the extension
`SWM_decal`; `GltfLoader` reads it back (ADR 0029). The payload is a `LevelDecalPlacement`
without `id`, `position`, `rotation` and `parent`: id is the node name, the transform and
hierarchy come from the node. `size` (`[width, height, depth]`) in the payload is authoritative;
the node scale is written as `(width, depth, height)` for other viewers and rewritten from `size`
on read. The loaded decal has no textures (`readNode` is synchronous): hydrate it afterwards.

```typescript
const root = await new GltfLoader().load("/maker/scene.gltf");
await kitRegistry.resolveLevelDecals(root); // or kitRegistry.hydrateDecal(decal)
```

Unknown kit decals and failed map loads warn and leave the decal invisible; an invalid payload
(size, opacity, tags) throws while reading.

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

## Stamping decals in Maker

Maker has a modal stamp tool (<kbd>D</kbd>, see the [Maker guide](/guides/maker)): double-click a
kit decal in the Content Drawer to arm it, move over a surface (a ghost decal with half opacity
shows the result), click to stamp. The decal's +Y is aligned to the surface normal (from
`Raycaster`'s `Intersection.normal`), <kbd>R</kbd> spins it about the normal, arrows nudge it in
the surface plane, <kbd>Shift</kbd> + arrows scale it. Each stamp is one undo step and is
autosaved as `SWM_decal`; on load Maker calls `kitRegistry.resolveLevelDecals(root)`. Stamped
decals are not raycast-pickable, so select them in the hierarchy panel; the inspector offers
priority, opacity, edge fade and angle fade.

**Plane fit.** The stamp does not trust the single hit under the pointer: it casts four rays at
the corners of the decal's footprint and fits one plane to the surface under it (`fitDecalPlane` in
`DecalPlaneFit.ts`, the normal is the cross product of the footprint diagonals), so a decal lies
flush on a bumpy or gently curved receiver instead of floating on one triangle's normal. The box
grows deeper when the corners differ in height, so the whole patch stays inside it. If fewer than
three corners hit, or any hit's own normal is more than 35 degrees off the fitted plane (the
footprint straddles a corner, an edge or a step), the tool falls back to the single-hit normal and
says so in the status line. Hold <kbd>Alt</kbd> while moving or clicking to skip the fit.

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

## Runtime decals: `DecalPool`

For marks that appear while the game runs (bullet holes, blood, scorch marks) use a `DecalPool`
instead of creating decals per hit:

```ts
const pool = new DecalPool(scene.root, {
  capacity: 32,
  size: [0.3, 0.3, 0.3],
  lifetime: 20, // seconds; omit to keep a decal until it is recycled
  createMaterial: () => new DecalMaterial({ diffuseMap: holeTexture, ormMap: holeOrm }),
});
// per hit (the caller finds point and normal, e.g. with a Raycaster):
pool.spawn(hit.point, hit.normal, { spin: Math.random() * Math.PI * 2 });
// once per frame:
pool.update(deltaSeconds);
```

All decals exist from the start and are only toggled visible, so a spawn allocates nothing and the
GPU resources stay put (removing a node from the scene would release them). `createMaterial` runs
once per slot because every decal fades with its own `color.a`; share the textures, not the
material. A full pool recycles the oldest decal and `Decal.restack()`s it, so the newest mark
always lands on top of overlapping older ones (the stacking order breaks ties by creation
order). The last `fadeSeconds` (default 1) of a lifetime ramp the opacity to 0, then the slot is
free. `attachTo: receiver` re-parents the decal under a moving object and keeps its world pose;
the decal is returned to the pool root when its slot is released. The pool is owned by whoever
creates it, there is no global instance.

Limits: spawned decals are drawn by the decal pass, so on WebGL1 (no decal pass) they draw
nothing, because the baker only handles static decals. Cost follows the covered screen area times
overlap like any decal, so keep `capacity` and `size` small and prefer `unlit` for large soft marks.
`?pool=1` in the decal probe and `poolChecks` / `poolRaycastChecks` / `poolClickChecks` in `npm run test:decals` check
recycling order, restacking and fading from pixels on WebGL2 and WebGPU. The raycaster variant
shoots down onto a floor, a slab tilted 30 degrees and a box with the engine's real `Raycaster`
and verifies the hit normal, the decal's up axis, the pixels at and around the hit, and that
`attachTo` makes the decal follow the box when it moves and turns. The click variant (`&shoot=1`)
drives the pool with real `page.mouse.click` events: the page casts a camera ray through the clicked
pixel and the decal must appear under the cursor, on the floor, on the tilted slab and on the box.

## Wet surfaces

A decal cannot overwrite the roughness of the surface below it (forward renderer, no G-buffer), so
"wet" is a dark, glossy overlay: the kit decal `flakturm/wet_puddle` is a soft dark patch (albedo
about 0.14, alpha 0.7 in the middle) with an ORM map of roughness 0.05. The darkening is the main
effect; the gloss adds a sharper specular highlight on top. Measured in the probe (`?wet=1`, sun
intensity 0.4, camera 12 m above): bare floor luma 120, dark-only twin 57 (WebGL2) / 63 (WebGPU),
wet preset 62 / 69, i.e. the highlight is a few luma steps at this weak light. It scales with the
light: at sun intensity 3 (`?wet=1&sun=3`) the bare floor is 146, the dark-only twin 75 / 82 and the
wet preset 94 / 105, a gloss gain of about 19 / 23 luma. (IBL was not measured.) There is no engine "wetness" parameter: author more variants as kit
decals (other shapes or tints) with the same recipe, a dark albedo plus ORM G near 0.05.

## What a decal does not do

- **No decals on transparents.** The decal only sees the opaque depth.
- **No decals in offscreen targets** (reflections, probes, imposters). Decals count only in
  frames of the main target.
- **WebGL1 ignores decal boxes**; bake them to meshes instead (see "WebGL1: baked mesh decals").
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

## WebGL1: baked mesh decals

WebGL1 has no depth sampling and no MRT, so it ignores `Decal` boxes. For it, decals are baked once
at load time into ordinary transparent meshes (ADR 0029, phase 5):

```ts
import { bakeSceneDecals, bakeDecalMesh } from "@small-world-machine/engine";

// after the scene is built, only when the renderer is WebGL1 (otherwise the box would draw twice)
if (renderer.type === RendererType.WEB_GL1) bakeSceneDecals(scene.root);

// or per decal against chosen receivers:
const mesh: Object3D | undefined = bakeDecalMesh(decal, [floor, wall], { normalOffset: 0.002 });
```

- `bakeDecalMesh(decal, receivers: readonly Object3D[], options?: { normalOffset?: number }): Object3D | undefined`
  clips every receiver triangle against the unit box (Sutherland-Hodgman), maps UV = `(box.x + 0.5, box.z + 0.5)`
  (the same orientation as the box decal), lifts the result `normalOffset` (default 0.002 m) along the flat
  receiver triangle normal and returns one mesh, or `undefined` when nothing is covered. World matrices must be
  current. The mesh's origin sits at the decal's world position; add it to a parent with identity transform
  (the scene root).
- `bakeSceneDecals(root, { normalOffset?, hideBakedDecals? = true }): Object3D[]` collects all visible `Decal`s
  and all visible non-transparent triangle meshes under `root`, bakes in stacking order (`compareDecals`), adds
  the meshes to `root` and hides the baked boxes. It is not called by the engine automatically: it has to run
  after the scene exists and only on WebGL1. The decal probe does it with `?bake=1`.
- The pure clipping core `clipTrianglesToDecalBox` works on plain arrays and a `Matrix4` and is unit-tested.
- Material: `DecalMaterial` maps to a `StandardMaterial` (diffuse, normal, ORM bound to AO/roughness/metallic maps,
  emissive, roughness, metallic, `color.a` as opacity), or to `BasicMaterial` for `unlit` decals. It is
  `transparent`, `depthWrite = false`, `cullMode = NONE`.

Limits (decided simplification):

- **Static receivers only**, baked once; skinned, instanced, non-triangle and geometry-less receivers are skipped
  with a `console.warn`. Moving a receiver or the decal afterwards does not update the mesh.
- **No edge fade and no angle fade.** Triangles facing away from the decal's up axis, or beyond `angleFadeEnd`,
  are cut hard; the texture alpha defines the edge. Steep walls inside the box therefore end on a triangle edge.
- **Flat normals** (the receiver triangle normal), so a decal on a curved receiver is faceted, and the receiver's
  own normal map is not blended into the decal (the decal's `normalMap` is used with tangents computed from the
  UVs; that tangent convention is not verified against a normal-mapped probe).
- **Lighting differs from the box decal** (regular material path, receiver shadows via `receiveShadow`, no
  normal-buffer blending); `unlit` is honoured through `BasicMaterial`.
- **Stacking:** baked meshes sort among the transparents by distance of the decal centre, not by `priority`.
  Overlapping decals on one surface can therefore blend in either order.
- **Cost:** CPU at load time proportional to receiver triangles whose bounds touch a box (whole receivers outside
  are rejected by bounds), plus a transparent mesh per decal at run time. Large, finely tessellated receivers
  under many big boxes are the expensive case.

Checked on the probe (`npm run test:decals`, headless WebGL1 via SwiftShader): with `?bake=1` the stripe pixel
differs from the floor by 82 (max channel), and from the WebGL2 box decal by 9 at the same pixel; edge fade is
the visible difference.

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

`apps/showcases/40` (the decal probe, Showcase 40) shows decals on a floor, a wall and a pedestal, plus UV and
normal probes. Query parameters:

- `?nb=1` / `?nb=0` forces the normal buffer on / off (default: auto)
- `?pp=1` enables post-processing (needed for the normal buffer on WebGL2)
- `?spot=1` swaps the sun for a shadow-casting spot light across a decal edge
- `?rendererType=WEB_GPU` or `WEB_GL2` picks the backend
- `?bake=1` bakes all decals to meshes before the first frame (use with `?rendererType=WEB_GL1`)
- `?mip=1` (+ `?mipbias=<n>`) swaps in the mip-sharpness comparison scene
- `?pool=1` drives a `DecalPool` from the check script (recycling, restacking, fade); `&shoot=1` lets real pointer clicks cast a camera ray and spawn a decal at the hit
- `?wet=1` (+ `&sun=<intensity>`) shows the kit's wet-puddle preset against a dark-only twin on a rough floor

`npm run test:decals` (`scripts/check-decals.mjs`) drives that page in a headless browser and
asserts on GPU readbacks (normal buffer contents, decal pixels). WebGL2 results are blocking;
WebGPU results are informational unless `DECAL_REQUIRE_WEBGPU=1` is set. `DECAL_ORIGIN`
overrides the dev-server origin (default `https://localhost:5173`).

## Notes (verified)

- **ORM map:** channel order matches the rest of the engine / glTF: R = AO, G = roughness, B = metallic (`Standard.frag.wgsl:8-10`, `Standard.frag.glsl:90,96,102`). `DecalMaterial.ormMap` binds to the shared `u_aoMap` slot because the WebGPU material bind group has a fixed binding table (`GPUPipelineCache.getOptionalMaterialTextureBindings`) and WGSL flag constants are hardcoded in `GPUPipelineCache`; WGSL gates the tap with `matParam6.x`, GLSL with `USE_DECAL_ORM`. Both sample with `g_uvGradX/Y`. Emissive reuses the lit chunk's `u_specColor` x `u_emissiveMap` path (gradient sampling already wired); unlit decals skip it. `?orm=1` on the decal probe and `npm run test:decals` check on both backends that AO 0 darkens the decal (luma 92 vs 189), a neutral ORM changes nothing, an emissive map adds red only and an unlit decal ignores it. Metallic is checked through B (material metallic 1: a neutral ORM turns the decal dark, B = 0 switches it off again to the control value) and roughness through G (G = 0.4 shifts the pixel by about 9 luma against the control on both backends; the direction is not asserted, the check proves only that the channel is read).
- **Vertex alpha:** vertex colour is RGBA (`Mesh.ts:4,256`, `GPUPipelineCache.ts:426-437`) behind `USE_VERTEX_COLOR`, not combinable with instancing. Only `StylizedLava` consumes it; Standard/Decal shaders and the glTF loader (`COLOR_0`) do not. A baker must add the consumer side itself.

> Normal-mapped receivers: `?bump=1` on the decal probe tilts the floor normal map; `npm run test:decals` checks the normal buffer carries it, decals blend onto it, and HBAO (flat depth normal) ignores it.
