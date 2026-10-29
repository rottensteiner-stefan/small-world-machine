# Fire VFX (`@small-world-machine/vfx-extras`)

Practical guide to building believable fire in Small World Machine: the layer stack, the runtime
contracts, and how each piece maps to industry practice (Unreal Niagara, Unity VFX Graph, Godot
GPUParticles3D). All fire code lives in `packages/vfx-extras/src/fire/` — the engine core stays
untouched (ADR 0022 ecosystem-package boundary).

## Layer stack

Fire is never one effect. Each layer is a separate, composable piece with its own lifecycle,
rendering contract and cost profile, so it can be built, tested, toggled and budgeted
independently:

| Layer | Unit | Status | Rendering |
|---|---|---|---|
| Flame body | `FireMaterial` + `createFlameCardGeometry` | P1 | additive custom shader (3 dialects), 2 crossed cards |
| Glow halo | `FlameGlowMaterial` | P1 | billboard, WebGL1 stand-in for bloom |
| Fire light | `FireLightBehavior` + `FireFlickerProfile` + `FireLightBudget` | P2 | point light, seated breathing, budgeted |
| Embers / sparks | `FireEmberEmitter` | P3 | additive instanced billboards (`ParticleMeshRenderer`) |
| Smoke plume | `FireSmokeEmitter` | L3 | alpha-blended instanced billboards (`SmokeSpriteMaterial`) |
| Ember bed | `EmberBed` | L5 | opaque emissive `StandardMaterial` cylinder, slow noise breathing |
| Soot / ash | `createSootDecalTexture` + `Decal` | L5 | box-projected decal (native WEB_GPU/WEB_GL2, baked WEB_GL1) |

The ember, smoke and bed layers are tested in `packages/vfx-extras/tests/{FireSmoke,EmberBed,SizeGrowthAffector}.test.ts`
and exercised end-to-end in `apps/showcases/45` (the Fire VFX Lab).

## Runtime contracts

### Determinism & capture (golden-safe)

Every animated layer must be reproducible frame-for-frame, because the golden-render-gate and
freeze-frame captures depend on it (ADR 0044, ADR 0047):

- **Seeded PRNG only.** `FireEmberEmitter` and `FireSmokeEmitter` duplicate the two-line mulberry32
  core (`Math.imul`-only, integer arithmetic, identical across JS engines). Keep both and
  `FireFlickerProfile`'s integer hash noise in sync — the engine's `Noise` is `Math.random`-seeded
  and therefore not reproducible.
- **`update(dt, ...)` is driven externally** from the app frame loop (never engine-internal), so
  pause and slow-motion reach it — exactly like `FireLightBehavior`.
- **`dt === 0` freezes the layer completely** (no spawn, no motion, no churn, no breathing). The
  emitters return early on `deltaTime <= 0`; `EmberBed.update(0)` is a no-op; `SmokeSpriteMaterial.time`
  only advances inside `FireSmokeEmitter.update`.
- **Static baked content** (the soot decal) has no runtime state at all.

### World anchoring

Particles are simulated in **world space**: emitters take a world anchor on every update
(`rig.embers.update(dt, anchor, camera, wind)`), instance matrices are written directly into
world-space GPU buffers and the mesh is added to the scene root. A moving fire therefore leaves its
embers and smoke behind — the same "world-anchored" behaviour Niagara/GPUParticles3D call
*simulation space = World*.

### Zero-GC hot path

All emitters read straight out of the `ParticleSystem`'s SoA `TypedArray`s, reuse scratch
`Vector3D`/`Matrix4`/`Quaternion` objects and never allocate per frame. Material parameters are
written into the existing manifest lanes.

## Layer details

### Smoke plume — `FireSmokeEmitter` + `SmokeSpriteMaterial` (L3)

- World-anchored plume built on the `ParticleSystem` chain: `GravityAffector` as buoyancy, `DragAffector`,
  `SizeGrowthAffector` (multiplicative growth, base variety preserved) and `ColorOverLifeAffector`
  (warm-lit birth tint → cold dark, alpha → 0).
- `SmokeSpriteMaterial` is a custom alpha-blended material (GLSL300/GLSL100/WGSL) with **no texture**:
  a soft radial blob roughened by scrolling value-noise that dissolves into ragged wisps as the puff
  fades — never a hard-edged quad. It reads the per-instance buffer directly: **rgb = tint, a = opacity**.
- Because alpha is opacity and **not** a size fold, the paired renderer must run with the new opt-in
  `ParticleMeshRenderer({ foldAlphaIntoScale: false })`. The default stays `true`, so existing ember
  callers are byte-identical.
- Wind: pass a world wind vector to `update(...)`; its horizontal parts tilt the plume through
  `windInfluence`. Feed it the **same wind** the flame leans into (world-shear `FireMaterial.lean`,
  ADR 0052 fire session) — the plume must travel downwind, exactly like the flame leans.

#### Honest divergence: no soft-particle depth fade (HIGH-tier follow-up)

The industry tool (soft particles / depth fade) keeps billboards from clipping hard against scene
geometry. We deliberately defer it: the procedural soft edge + alpha dissolution already replace the
hard quad cut, and the full solution needs a depth texture (normal-buffer style, ADR 0028) in the
vfx-extras shader path. Documented as a HIGH-tier follow-up — not silently omitted, not faked.

### Ember bed — `EmberBed` (L5)

- An **opaque** emissive shallow cylinder under the fire (`StandardMaterial.emissiveIntensity`,
  clamped breath band), matching the "emissive fuel bed" convention — the coal bed under a campfire
  or the charred tip wrap of a torch. Opaque, so it never reads as a glow sticker over the logs.
- Breathing is a **slow** seeded noise envelope from `FireFlickerProfile` (channel 6, ≈0.35 Hz) with
  a `breathStrength` clamp — an ember bed does not heartbeat.
- No custom shader: `StandardMaterial` emissive needs no per-pixel trickery for a fuel bed (a
  procedural coal shader remains a documented HIGH-tier option).

### Soot / ash decal — `createSootDecalTexture` + `Decal` (L5)

- Procedural scorch texture (256², deterministic hash — no `Math.random`): feathered splotches,
  ashy speckle, charred rim. Coverage lives in **alpha** (the decal path alpha-blends, ADR 0029);
  brightness in RGB. Headless environments get `undefined` (no DOM canvas) — the decal simply has no
  texture, same contract as `createEmberSpriteTexture`.
- Rendering follows **ADR 0029 exactly**: the `Decal` renders as a box-projected decal natively on
  WEB_GPU and WEB_GL2; **only WEB_GL1** (no opaque-depth box decals) bakes it into the floor
  geometry via `bakeSceneDecals(this.scene.root)` inside the `WEB_GL1` branch. Do **not** bake on
  all tiers — that diverges from the engine convention and replaces the native projection with a
  flattened clip.
- Unlit (`DecalMaterial({ unlit: true })`): a burn mark only darkens; it is not re-lit per decal.
- **Honest divergence (visibility):** a dark soot ring on a night scene sits inside the fire's
  shadow wedge and reads as shadow — it is clearly visible under daylight/dawn lighting, and that
  is physically honest. If a level needs an always-legible mark, raise the texture's base grey.

## Showcase integration (apps/showcases/45)

- Each fire gets a `FireRig` holding flame/glow/light/embers/smoke/bed; toggles gate both
  `emitter.enabled` **and** `mesh.isVisible` so Vorher/Nachher switches are instant, not "wait out
  the particles".
- `update(dt)` drives `rig.light`, `rig.embers`, `rig.smoke` and `rig.emberBed` with the lab's
  `paused`/`timeScale`-scaled `dt` — pause freezes every animated layer (capture support).
- Wind slider recomputes `_smokeWind` (same direction as the flame lean) and feeds `smoke.update(...)`.
- HUD: `R` = smoke, `B` = ember bed, in the ⚖️ Vorher/Nachher block.

## Quality & budget

- One draw call per layer (instanced billboards / single mesh); no per-frame allocations.
- Emitter rates/capacities scale from the flame's authored size (`rate/capacity/life/speed/size`
  derived from `spec.height`/`spec.width`) — a candle gets one lazy wisp, the campfire a dense plume.
- On weak devices the smoke governor (lower rate/capacity, shorter life) degrades the plume, never
  the flame/shadow quality promise (Tiered Renderer Autonomy).

## Testing doctrine

- Determinism: same seed → identical snapshots; different seeds diverge; `dt=0` and `enabled=false`
  freeze exactly.
- Emission: exact `rate · dt` spawn, pool cap respected, all matrices finite under full pools.
- Physics: multiplicative growth preserves base-size ratios; aging cools/dissolves; wind tilts a
  seeded plume without touching a windless run.
- Rendering contract: alpha-blended straight-alpha, `skipDepthPrePass`, `foldAlphaIntoScale=false`
  keeps authored size; dead slots collapse to zero matrices; material lanes carry time/churn.
- Bed: deterministic breathing within the authored band, freeze on `dt=0`/disabled.

## Known follow-ups (honest)

- Soft-particle depth fade for smoke (HIGH tier; needs depth texture in the particle path).
- Procedural coal shader for the ember bed (HIGH-tier option; `StandardMaterial` emissive is the
  current, honest baseline).
- Trailing/loopable `Fire` composition node that composes the layers from one API (plan P-compose).
