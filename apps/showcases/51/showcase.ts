import type {
  EngineOptions,
  GeometryDataInterface,
  GpuTimer,
  HbaoElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cone,
  Cylinder,
  DirectionalLight,
  CameraStrategyType,
  FlyController,
  Fog,
  FogMode,
  GltfLoader,
  GltfMaterialParser,
  Ground,
  InstancedMesh,
  Matrix4,
  Object3D,
  PostProcessingEffectType,
  RendererType,
  StandardMaterial,
  Texture,
  TextureArray,
  Vector3D,
  WebGPURenderer,
} from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import { BoundingBox } from "@small-world-machine/engine/physix/BoundingBox.js";
import type { BoundingVolume } from "@small-world-machine/engine/interfaces/BoundingVolume.js";
import {
  LOD_TRANSITION_MODES,
  packInstancePose,
  projectedDiameterPixels,
  sphereVisibleConservative,
  unpackInstancePose,
} from "@small-world-machine/engine/core/InstanceField.js";
import type {
  FieldVisibleSets,
  InstanceFieldOptions,
  InstancePose,
  LodBucketDescriptor,
  LodTransitionMode,
  PrototypeDescriptor,
} from "@small-world-machine/engine/core/InstanceField.js";
import {
  InstanceFieldSystem,
  type FieldCanopy,
} from "@small-world-machine/engine/renderers/WebGPU/managers/InstanceFieldSystem.js";
import {
  applyFoliageLook,
  buildCanopyCoverage,
  FOLIAGE_LOOKS,
  GroundCover,
  WindField,
  type FoliageLook,
} from "@small-world-machine/vegetation-extras";
import { getCameraPath, type CameraPath, type PathName } from "./CameraPaths.js";
import { Hud, hudFreeMode, type HudGpuTimings, type VegHudStats } from "./Hud.js";
import { GoldenSession, lookupOwn, parseGoldenSpec } from "../shared/GoldenCapture.js";

/**
 * Showcase 51 — Forest Measurement Baseline ("forest", ADR 0059 step 0 / veg-p0 P0-3).
 *
 * Reproducible MEASUREMENT baseline built with TODAY'S tools only (no new engine features):
 * the same deterministic tree population is scatterable two ways (URL `?mode=`), so the two
 * current-generation instancing lanes can be compared before `InstanceField` (ADR 0059 step 1)
 * exists:
 *
 *   - `autoinst`  (default): plain `Object3D` scene-graph nodes relying on engine automatic
 *     instancing (ADR 0046). Per part, every tree shares ONE geometry and ONE material
 *     reference; part-major insertion keeps same-geometry nodes consecutive, and the renderers'
 *     A2 geometry grouping (WebGPU + WebGL2) additionally reorders per material subgroup — both
 *     WebGPU and WebGL2 batch these runs into one instanced draw each, exactly the engine
 *     behavior of today.
 *   - `instanced`: the identical population (same positions/yaw/scale) as one `InstancedMesh`
 *     per part via `instanceMatrices` — one draw per part, no per-object scene-graph cost.
 *   - `field` (S2, ADR 0059 step 1): the identical population packed as `InstanceField` records
 *     (16 B each, `packInstancePose`, byte-identical to the frozen contract) driven by the
 *     WebGPU `InstanceFieldSystem` — GPU frustum+size cull, optional previous-frame-HZB
 *     occlusion, bucket-routed atomic compaction and pulled `drawIndexedIndirect` from one
 *     combined single-mesh tree prototype (V1 system constraint: one geometry per bucket, one
 *     material). WebGPU only in V1. Pulled shading is the `lambert-csm` lane (vertex-colour
 *     albedo + foliage mask, CSM shadows, irradiance/ambient, ADR 0060 leaf backlight, Standard
 *     output stage; no specular/textures — real materials land with P2). Since 2026-11-09 the
 *     field lane also carries the shared wind field (step 1b) and is a LIVE, time-dependent
 *     lane; the autoinst/instanced lanes stay static.
 *
 * S2 URL knobs (field lane):
 *   `?mode=field`                  field lane (needs WebGPU; other tiers fall back to autoinst)
 *   `?occlusion=a|b|c`             occlusion A/B/C comparison (field lane only):
 *                                  `a` = force-DISABLE main-view HZB occlusion (frustum+size only)
 *                                  `b` = default (HZB pyramid on)
 *                                  `c` = `b` plus scheduled hard camera teleports that arm the
 *                                       one-frame HZB skip (IF-CAMERA-CUT-HZB-SKIP live exercise;
 *                                       only with `?path=` active, every `?cutEvery=N` samples)
 *   `?popcount=1`                  dual-lane population audit: read back the GPU survivor counts
 *                                  per (view x bucket) via the opt-in cull probe and attach them
 *                                  to `MEASURE` (yes: `populationAudit.gpuPerBucket`)
 *   `?cullref=1`                   add a pure-CPU reference cull of the same records (frozen core
 *                                  math, conservative) and report the per-bucket counts +
 *                                  `gpuSupersetOfCpu` / `cpuFalseNegative` verdict in `MEASURE`
 *   `?cutEvery=N`                  teleport period in sampled frames (default 60; `?occlusion=c`)
 *   `?wind=0`                      disable the field-lane wind (cost isolation / static A/B);
 *                                  default on for the field lane
 *   `?cover=0`                     disable the ground-cover ring (step 1b, source B; default on)
 *   `?coverDensity=N`              ring clump density in clumps/m² (clamped to 8; default 5;
 *                                  14 blades per near clump)
 *   `?coverRadius=N`               ring outer radius in metres (clamped to [20, 400]; default 160)
 *   `?look=auto|meadow|forest|off` foliage look; `auto` blends meadow -> forest by the canopy
 *                                  above the camera (interactive default `auto`, automated `off`)
 *   `?hbao=0|1`                    screen-space AO (interactive default on, automated off)
 *   `?canopy=0`                    disable the canopy ambient occlusion (ADR 0059 step 6a A/B)
 *   `?tree=<stem>|none`            textured species (`<stem>.species.json`, `<stem>_LOD0..3.glb`,
 *                                  albedo layers); real 4-bucket LOD chain, fail-closed to defaults.
 *                                  Interactive default `jacaranda`; `none` = Kenney set
 *
 * The population is deterministic: a fixed default seed drives the scatter jitter (engine
 * `mulberry32`), and nothing in the static lanes is time-dependent, so identical URLs on the
 * autoinst/instanced lanes yield identical output (golden/QA compatible). The `field` lane is
 * a live WebGPU lane with wind (and per-instance tint variation), not goldened — the `veg51`
 * golden baseline captures the GL2 autoinst lane.
 *
 * Tree source — parallel-worker lane: worker Frank (P0-2) creates CC0 glTF trees in
 * `apps/showcases/51/assets/`. This file tries the expected names below via `GltfLoader` and
 * uses the FIRST that loads as the population's prototype; if none loads (assets absent
 * mid-development) it falls back, with a console.info, to a procedural placeholder tree
 * (trunk + two foliage cones). Both the "assets present" and "assets absent" states are
 * handled; the final baseline simply consumes what Frank delivers.
 *
 * URL knobs:
 *   `?mode=autoinst|instanced|field`   scatter lane (interactive default `field`; automated runs
 *                                `autoinst`; `field` = ADR 0059 P1 lane, falls back off WebGPU)
 *   `?n=N`                       tree budget (interactive default 2000, automated 20000; clamps to
 *                                [0, 2000000]; `?n=0` empties the population)
 *   `?seed=S`                    scatter seed (default 51; deterministic per (n, seed))
 *   `?shadows=off`               disable the sun's shadow casting (pass isolation for benches)
 *   `?frames=N`                  automated run: N sampled frames after a 30-frame warm-up,
 *                                then the `MEASURE` line is emitted once (default 240)
 *   `?qa=1`                      stable headless-capture mode: fixed camera, no overlay/chrome
 *   `?path=walk|flight|aerial`   seeded camera path (P0-4, `CameraPaths.ts`); freezes the default
 *                                fly camera and drives `setExternalCameraPose` every frame.
 *                                `flight` is the fast, pop-sensitive path of the ADR 0059 step-2 gate.
 *   `?pausedAt=<t>`              freeze the camera at `sample(t)` of the active path (loop stops;
 *                                used by veg-bench keyframe shots + truth captures; capture mode
 *                                = HUD-free, so the clipped shots/FLIP compare stay clean)
 *   `?lodMode=off|hysteresis|dither|dither-hysteresis`
 *                                LOD-transition strategy (`LOD_TRANSITION_MODES`, ADR 0059 step 2);
 *                                default = engine default `hysteresis`; HUD `L` cycles live
 *   `?taa=1`                     arm the engine `TaaElement` (default off) — the intended display
 *                                condition for the P2 dither transition modes ("TAA resolves the
 *                                dither", ADR 0059 step 2); MEASURE carries `taa` 0/1.
 *   `?truth=1`                   ground-truth mode: identical scene, frozen pose (`?pausedAt=` or
 *                                the initial camera), signals `window.__vegTruthReady` after the
 *                                first frame (P0 has no LOD/culling optimizations to disable, so
 *                                truth == the full baseline render; P1+ differs)
 *   `?gputimings=1`              enable the opt-in WebGPU per-pass GPU timing ring (P0-1, Bob) for
 *                                automated runs; the interactive HUD mode enables it automatically
 *                                on WebGPU when the device supports `timestamp-query` (K5)
 *   `?__golden=forest-baseline`  golden-capture mode (shared `GoldenSession`, fixed camera,
 *                                deterministic `step()` frames, `window.__goldenReady`)
 *
 * MEASURE contract (consumed by `.agents/scripts/veg-bench.mjs`, P0-4):
 * the `#__measure` overlay and the console both receive
 * `MEASURE { "rendererType":..., "mode":..., "n":..., "seed":..., "path":...,
 * "frameTimesMs":[..], ... }` exactly once on completion. Structure mirrors showcase 44
 * (`?frames=` + warm-up); `path` is the active camera path and `frameTimesMs` the per-sampled-frame
 * CPU-observed frame time in ms (basis for the bench's P50/P95 cells).
 *
 * Camera hook contract (Charly, S1): `setExternalCameraPose(position, target)` — once called,
 * the showcase applies exactly that pose every frame before rendering and stops honoring the
 * fly controller, so a camera-path sampler can drive reproducible runs without touching this
 * file. Interactive mode defaults to the engine's 6-DOF spectator camera (FlyController:
 * WASD + mouse look + Space/C, Shift boost, Alt precision; `R` resets to the forest-edge
 * start pose).
 */

const DEFAULT_INSTANCE_COUNT = 20000;
/** Interactive default scene (no automation flag): textured species + its tree count. */
const INTERACTIVE_TREE_STEM = "jacaranda";
const INTERACTIVE_TREE_COUNT = 2000;
const DEFAULT_FRAMES = 240;
const WARMUP_FRAMES = 30;
/** S2 `?occlusion=c` teleport period in sampled frames (IF-CAMERA-CUT-HZB-SKIP live exercise). */
const DEFAULT_CUT_EVERY = 60;
/** S2 `?occlusion=c`: each hard cut advances the path by this loop fraction (deterministic). */
const CUT_T_JUMP = 0.18;
/** S2 field lane: sub-pixel cull gate in px (frozen `cullPixelSize` must sit below the band floor). */
const FIELD_CULL_PIXEL_SIZE = 2;
/** Authored ascending bucket maxima in px (near=detail: bucket 0 = farthest = coarsest). */
const FIELD_LOD_MAXIMA_PX: readonly number[] = [24, 96, 1e6];
/** Real-LOD band maxima in px (`?tree=` species chain; geometric progression 16→32→72→1e6). The band
 *  floor must stay above `FIELD_CULL_PIXEL_SIZE` and the top max MUST stay 1e6 (hard near tile). */
const FIELD_LOD_MAXIMA_REAL_PX: readonly number[] = [16, 32, 72, 1e6];
/** Load-time triangle-stride decimation per proxy bucket (bucket 0 = stride 3, bucket 1 = 2). */
const FIELD_LOD_PROXY_STRIDE: readonly number[] = [3, 2];
/** S2 field lane: population grid cell edge in meters (cells drive the CPU/GL cell fallback). */
const FIELD_CELL_SIZE = 12;
/** Leaf transmission tint of the field lane (sRGB, same value as showcase 52's leaves). */
const FIELD_LEAF_BACKLIGHT: readonly [number, number, number] = [0.55, 0.72, 0.2];
// ADR 0059 step 1b, source B: camera-centred ground-cover rings. One cover instance is a CLUMP of
// REAL curved blades (no alpha texture, merged-geometry field path). Draw segments are
// (view x bucket), so one field draws ONE geometry per bucket: every species gets its own ring +
// field (own seed, density share, height, wind height); records stay one per clump.
type Rgb = readonly [number, number, number];
interface CoverSpecies {
  readonly id: string;
  /** Share of `?coverDensity=` (clumps per m²) this species takes. */
  readonly share: number;
  /** Blades per clump in the near / far bucket (far = prefix of the same layout). */
  readonly blades: number;
  readonly bladesFar: number;
  /** Clump footprint radius, blade height (m, scale 1), blade half-width (m). */
  readonly radius: number;
  readonly height: number;
  readonly width: number;
  /** Outward lean as a fraction of the blade height. */
  readonly lean: readonly [number, number];
  /** sRGB blade colour at the base / tip. */
  readonly base: Rgb;
  readonly tip: Rgb;
  /** Optional flower heads on the first `blades` stems (petal fan + centre). */
  readonly flower?: {
    readonly petals: number;
    readonly size: number;
    readonly petal: Rgb;
    readonly centre: Rgb;
  };
}
const COVER_SPECIES: readonly CoverSpecies[] = [
  {
    id: "fine",
    share: 0.32,
    blades: 16,
    bladesFar: 6,
    radius: 0.2,
    height: 0.42,
    width: 0.01,
    lean: [0.15, 0.45],
    base: [0.3, 0.47, 0.22],
    tip: [0.42, 0.56, 0.26],
  },
  {
    id: "meadow",
    share: 0.26,
    blades: 12,
    bladesFar: 5,
    radius: 0.25,
    height: 0.78,
    width: 0.012,
    lean: [0.2, 0.5],
    base: [0.28, 0.45, 0.2],
    tip: [0.46, 0.6, 0.28],
  },
  {
    id: "broad",
    share: 0.14,
    blades: 7,
    bladesFar: 4,
    radius: 0.2,
    height: 0.45,
    width: 0.03,
    lean: [0.3, 0.65],
    base: [0.24, 0.42, 0.18],
    tip: [0.36, 0.55, 0.24],
  },
  {
    id: "straw",
    share: 0.14,
    blades: 10,
    bladesFar: 4,
    radius: 0.22,
    height: 0.62,
    width: 0.011,
    lean: [0.2, 0.55],
    base: [0.42, 0.44, 0.24],
    tip: [0.72, 0.66, 0.4],
  },
  {
    id: "tuft",
    share: 0.14,
    blades: 22,
    bladesFar: 7,
    radius: 0.11,
    height: 0.26,
    width: 0.009,
    lean: [0.1, 0.35],
    base: [0.2, 0.36, 0.15],
    tip: [0.32, 0.48, 0.2],
  },
  {
    id: "buttercup",
    share: 0.05,
    blades: 3,
    bladesFar: 3,
    radius: 0.14,
    height: 0.62,
    width: 0.005,
    lean: [0.05, 0.25],
    base: [0.25, 0.42, 0.18],
    tip: [0.32, 0.5, 0.22],
    flower: { petals: 5, size: 0.05, petal: [0.96, 0.82, 0.12], centre: [0.85, 0.65, 0.1] },
  },
  {
    id: "daisy",
    share: 0.04,
    blades: 3,
    bladesFar: 3,
    radius: 0.14,
    height: 0.5,
    width: 0.005,
    lean: [0.05, 0.25],
    base: [0.25, 0.42, 0.18],
    tip: [0.32, 0.5, 0.22],
    flower: { petals: 10, size: 0.045, petal: [0.95, 0.95, 0.92], centre: [0.95, 0.8, 0.15] },
  },
];
/** Projected-size threshold (px) between the far (sparse) and near (full) clump bucket. */
const COVER_CLUMP_LOD_PX = 14;
/** Camera travel (m) that triggers a ground-cover ring rebuild + record upload. */
const COVER_UPDATE_STEP = 0.5;
/** Ground-cover ring default outer radius (m) and clump density (clumps per m²). */
const COVER_DEFAULT_RADIUS = 160;
const COVER_DEFAULT_DENSITY = 5;
/** Foliage-mask alpha of blade base / tip (leaf-backlight transmission weighting). */
const COVER_ALPHA_BASE = 1;
const COVER_ALPHA_TIP = 0.85;
/** Ground-cover tile edge (m); the ring's per-tile hash cells. */
const COVER_TILE_CELL = 5;
/** Forest-floor plane edge (m); the canopy AO map covers it at 1 texel per metre. */
const GROUND_SIZE = 240;
/** `?look=auto` easing rate toward the coverage at the camera (1/s). */
const LOOK_BLEND_RATE = 1.5;
/** Screen-space AO for grass/foliage contact (world radius m, strength). */
const HBAO_RADIUS = 0.8;
const HBAO_INTENSITY = 0.9;
/** ADR 0059 step 6a canopy ambient: ambient kept under full cover at the ground, coverage grid
 *  cell (m), and the share of the widest branch extent that reads as closed crown. */
const CANOPY_AMBIENT_FLOOR = 0.3;
const CANOPY_CELL_SIZE = 1;
const CANOPY_CROWN_FILL = 0.8;
/** `?tree=` species: uniform scale on top of the scatter scale (scan trees are full-size, ~19 m). */
const SPECIES_TREE_SCALE = 0.55;
/** `?tree=` species: cutout threshold of alpha-carrying albedo layers (leaf cards). */
const SPECIES_ALPHA_TEST = 0.5;
/** Fixed baseline seed; `?seed=` overrides. Chosen to match the showcase number. */
const DEFAULT_SEED = 51;
/** Hard cap so `?n=999999999` cannot OOM the instance-matrix pool. */
const MAX_INSTANCE_COUNT = 2_000_000;
/** Trees stay inside this ±X/±Z world box (200×200 m around the origin). */
const SCATTER_HALF = 100;
/** Central 60×60 m clearing: no trees, the default camera vantage and Charly's paths live here. */
const CLEARING_HALF = 30;
/** Defines the fake "sky": soft hazy blue that matches the linear fog color at the horizon. */
const HORIZON_COLOR = new Color(0.55, 0.68, 0.8);
const FOG_NEAR = 260;
const FOG_FAR = 420;

/**
 * Expected CC0 tree asset names in `apps/showcases/51/assets/` (contract with Frank, P0-2; see
 * `docs/log.md` + `assets/README.md`). The first name that loads becomes the population prototype.
 * Convention (verigned in `assets/README.md` §2): LOD0 only, upright, root node pivot = ground
 * contact (y≈0), opaque PBR-lit materials (Kenney marker is file-level only, metallic normalized
 * to 0) so the auto-instancing runs stay in the opaque lane (ADR 0046).
 */
const EXPECTED_TREE_ASSETS: readonly string[] = [
  "tree_pineTallA.glb",
  "tree_oak.glb",
  "tree_detailed.glb",
];

/** One deterministic tree in the population; positions are always inside the scatter box. */
interface ScatterInstance {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
}

/** One mesh part of a tree prototype (trunk, foliage, ...). All trees share these references. */
interface TreePart {
  readonly name: string;
  readonly geometry: GeometryDataInterface;
  readonly material: StandardMaterial;
  /** Local Y offset inside the tree (prototype origin = ground contact point). */
  readonly offsetY: number;
}

/** Species sidecar `<stem>.species.json` (written by the local tree bake): one entry per glTF
 *  primitive in primitive order = part order of the engine import (material names are dropped). */
interface SpeciesManifest {
  readonly stem: string;
  readonly layers: readonly {
    readonly albedo: string;
    readonly foliage: number;
    /** true = the albedo carries a cutout alpha (leaf cards). */
    readonly cutout?: boolean;
  }[];
}

interface TreePrototype {
  readonly name: string;
  readonly source: "asset" | "procedural";
  readonly parts: readonly TreePart[];
}

interface MeasureResult {
  rendererType: string | undefined;
  mode: string;
  n: number;
  seed: number;
  source: string;
  prototype: string;
  partsPerTree: number;
  sceneObjects: number;
  frames: number;
  wallMs: number;
  frameMs: number;
  avgFps: number;
  /** 1 = engine `TaaElement` armed via `?taa=1` (dither-mode sighting display condition). */
  taa?: number;
  /** Active camera path (`undefined` = fixed vantage). Consumed by veg-bench cell attribution. */
  path?: string;
  /** CPU-observed frame time per sampled frame (ms); P50/P95 basis for the ADR 0059 step-0 gate. */
  frameTimesMs?: number[];
  /** Total GPU ms of the last resolved timing frame (only with `?gputimings=1` on WebGPU). */
  gpuMs?: number;
  /** Per-pass GPU ms (only with `?gputimings=1` on WebGPU, `GpuTimingSlot` names). */
  gpuPassesMs?: Record<string, number>;
  /** S2 field lane diagnostics (`?mode=field`): GPU-managed instance count. */
  fieldInstances?: number;
  /** S2 field lane: active occlusion mode (`a`|`b`|`c`). */
  fieldOcclusionMode?: string;
  /** S2 field lane: geometry-chain source (`proxy` = stride-decimation default, `reallod` =
   *  real `<stem>_LOD<n>.glb` chain of a `?tree=` species). Field lane only, both values reported. */
  lodSource?: "proxy" | "reallod";
  /** S2 field lane, real-LOD only: per-geometry triangle counts of the active chain in bucket
   *  order (L3/L2/L1/L0) — downstream bench triangle-budget parsing basis. */
  lodTris?: number[];
  /** Field lane shading model: `lambert-csm` = vertex-colour albedo, Lambert sun + cascaded
   *  shadows, irradiance/ambient, leaf backlight, Standard output stage (no specular yet). */
  fieldShading?: string;
  /** S2 field lane: hard camera teleports fired (`?occlusion=c`). */
  fieldTeleports?: number;
  /** S2/1b field lane: 1 = shared wind field active, 0 = static (measuring isolation `?wind=0`). */
  wind?: number;
  /** S2/1b ground-cover ring (source B): live instance count of the cover field. */
  coverInstances?: number;
  /** S2/1b ground-cover ring: active ring radius (m) and blade density (blades per m²). */
  coverRadius?: number;
  coverDensity?: number;
  /** S2 dual-lane audit (`?popcount=1`): last resolved GPU survivor counts + optional CPU
   *  reference verdict (`?cullref=1`). Readbacks lag the live frame by design (no CPU stall). */
  populationAudit?: {
    gpuPerBucket: { viewIndex: number; bucketIndex: number; count: number }[];
    cpuTotal?: number;
    cullrefVerdict?: string;
    teleports: number;
  };
}

/**
 * Live adapter of the engine's opt-in WebGPU timing ring (`renderer.gpuTimings`, P0-1 / Bob) to the
 * HUD's guarded view ({@link HudGpuTimings}, P0-4 / Charly). Every read proxies to the ring at call
 * time (the HUD refreshes at ~4 Hz); an unarmed/unsupported/unresolved ring degrades honestly:
 * `available=false` / `lastFrameMs<0` / empty `passesMs` -- never throws (see `hudReadGpuMs`).
 */
class GpuTimingsAdaptor implements HudGpuTimings {
  private readonly _timer: GpuTimer;

  constructor(timer: GpuTimer) {
    this._timer = timer;
  }

  public get available(): boolean {
    return this._timer.enabled;
  }

  public get lastFrameMs(): number {
    const snap = this._timer.snapshot;
    if (snap.frameIndex < 0) return -1;
    let sum = 0;
    for (const segment of snap.segments) sum += segment.ms;
    return sum;
  }

  public get passesMs(): Readonly<Record<string, number>> {
    const snap = this._timer.snapshot;
    if (snap.frameIndex < 0) return {};
    const out: Record<string, number> = {};
    for (const segment of snap.segments) out[segment.name] = segment.ms;
    return out;
  }
}

/** Placeholder tree: low-poly trunk + two stacked foliage cones (cheap, upright). */
function buildProceduralPrototype(): TreePrototype {
  const trunkMaterial = new StandardMaterial({
    color: new Color(0.31, 0.21, 0.12),
    roughness: 0.9,
    metallic: 0,
  });
  const foliageLowMaterial = new StandardMaterial({
    color: new Color(0.16, 0.34, 0.14),
    roughness: 0.85,
    metallic: 0,
  });
  const foliageHighMaterial = new StandardMaterial({
    color: new Color(0.21, 0.43, 0.17),
    roughness: 0.85,
    metallic: 0,
  });
  return {
    name: "procedural-pine",
    source: "procedural",
    parts: [
      {
        name: "Trunk",
        geometry: new Cylinder({
          radiusTop: 0.3,
          radiusBottom: 0.45,
          height: 4.5,
          radialSegments: 7,
        }).getGeometryData(),
        material: trunkMaterial,
        offsetY: 2.25,
      },
      {
        name: "FoliageLow",
        geometry: new Cone({ radius: 2.2, height: 4.2, radialSegments: 8 }).getGeometryData(),
        material: foliageLowMaterial,
        offsetY: 5.6,
      },
      {
        name: "FoliageHigh",
        geometry: new Cone({ radius: 1.6, height: 4.8, radialSegments: 8 }).getGeometryData(),
        material: foliageHighMaterial,
        offsetY: 7.9,
      },
    ],
  };
}

/**
 * Deterministic scatter on a jittered lattice inside the SCATTER box. The RNG stream advances
 * exactly per candidate cell (skipped clearing cells still consume jitter), so for fixed
 * `(n, seed)` the result is byte-stable across runs. Cells inside the central clearing are
 * rejected; the placed count can therefore end below `n` (reported honestly in `MEASURE`).
 */
function scatterTrees(count: number, seed: number): ScatterInstance[] {
  const rng = mulberry32(seed);
  const side = Math.max(1, Math.ceil(Math.sqrt(Math.max(0, count))));
  const spacing = (SCATTER_HALF * 2) / side;
  const out: ScatterInstance[] = [];
  for (let gx = 0; gx < side && out.length < count; gx++) {
    for (let gz = 0; gz < side && out.length < count; gz++) {
      const x = (gx + 0.5) * spacing - SCATTER_HALF + (rng() - 0.5) * spacing * 0.65;
      const z = (gz + 0.5) * spacing - SCATTER_HALF + (rng() - 0.5) * spacing * 0.65;
      if (Math.abs(x) < CLEARING_HALF && Math.abs(z) < CLEARING_HALF) continue;
      out.push({ x, z, yaw: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5 });
    }
  }
  return out;
}

/** Golden captures are declarative here: one pool (the deterministic baseline, fixed camera). */
const GOLDEN_POOLS: Readonly<Record<string, string>> = {
  "forest-baseline": "base",
};
/** Golden render surface; matches the showcase's `.agents/scripts/goldens/config.json` scene. */
const GOLDEN_WIDTH = 1280;
const GOLDEN_HEIGHT = 720;

export class Showcase extends AbstractShowcase {
  private readonly _mode: "autoinst" | "instanced" | "field";
  private readonly _targetCount: number;
  private readonly _seed: number;
  private readonly _targetFrames: number;
  private readonly _isAutomated: boolean;
  private readonly _isQa: boolean;
  private readonly _shadowsOn: boolean;

  private _treeCount = 0;
  private _prototype: TreePrototype | undefined = undefined;
  private readonly _forestNodes: Object3D[] = [];

  // Measurement state machine (showcase-44 pattern).
  private _state: "idle" | "warmup" | "sampling" | "done" = "idle";
  private _warmupFrames = 0;
  private _sampledFrames = 0;
  private _startMs = 0;
  private readonly _frameTimesMs: number[] = [];
  private _lastSampleMs = 0;

  /** External camera override (contract with Charly's path sampler, S1). */
  private _externalCameraActive = false;
  private readonly _externalCameraPos = new Vector3D();
  private readonly _externalCameraTarget = new Vector3D();

  // P0-4 camera-path rig: URL-driven (`?path=`) or switched via the HUD keys/buttons (1/2/3).
  private _path: PathName | undefined = undefined;
  private _pathCam: CameraPath | undefined = undefined;
  private _pathT = 0;
  /** `?pausedAt=<t>`: freeze the active path loop at `sample(t)` for stable keyframe/truth shots. */
  private _pausedAt: number | undefined = undefined;
  /** `?truth=1`: ground-truth mode signals `window.__vegTruthReady` after the first frame. */
  private readonly _isTruth: boolean;
  private _truthSignalled = false;

  // P0-1 GPU timing ring (WebGPU only, opt-in). `_gpuTimer` is set in setupScene when the renderer
  // exposes the ring; every HUD read is guarded and degrades to `--` on other tiers.
  private _gpuTimer: GpuTimer | undefined = undefined;
  private _hud: Hud | undefined = undefined;
  private _hudAccum = 0;
  private _golden: GoldenSession | undefined = undefined;

  // S2 field lane (ADR 0059 step 1, WebGPU only). See `_buildFieldLane`.
  private _fieldSystem: InstanceFieldSystem | undefined = undefined;
  private readonly _occlusionMode: "a" | "b" | "c";
  private readonly _popcount: boolean;
  private readonly _cullref: boolean;
  private readonly _cutEvery: number;
  private _teleportCount = 0;
  private _cutAccum = 0;
  private _fieldRecords: Float32Array | undefined = undefined;
  private _fieldBoundingRadius = 0;
  private _fieldCullPixelSize = 0;
  /** Field-lane geometry-chain source of the LAST built field (`proxy` = stride-decimation
   *  default, `reallod` = real GLB chain of a `?tree=` species). Reported in MEASURE as `lodSource`. */
  private _lodSource: "proxy" | "reallod" = "proxy";
  /** Per-geometry triangle counts of the real-LOD chain (bucket order L3/L2/L1/L0), when active.
   *  Empty on the proxy path — `lodTris` is only emitted for `reallod`. */
  private _realLodTris: number[] = [];
  /** ADR 0059 step 1b: shared wind field driving the field lane (`?wind=0` isolates it). */
  private _windField: WindField | undefined = undefined;
  /** `?wind=0` disables the field-lane wind (measurement isolation); default on. */
  private readonly _windEnabled: boolean;
  /** Live wind state (initial = `?wind=` URL knob). The HUD `F` toggle swaps it at runtime via
   *  `InstanceFieldSystem.setWind` (hard off = `windHeight` 0, shader gate static; no pop back on). */
  private _windLive: boolean;
  /** Crown-top height at scale 1 cached at field build — the re-arm height for live `setWind`. */
  private _fieldWindHeight = 0;
  // ADR 0059 step 1b, source B: camera-centred procedural ground-cover ring (CPU-generated records
  // fed into a SECOND `InstanceFieldSystem` via `uploadRecords()`). `?cover=0` disables it;
  // `?coverDensity=` / `?coverRadius=` retune the generator. WebGPU field lane only.
  private _coverLayers: { cover: GroundCover; system: InstanceFieldSystem; windHeight: number }[] =
    [];
  /** Ring centre of the last cover rebuild; +Infinity forces the first rebuild. */
  private _coverLastX = Number.POSITIVE_INFINITY;
  private _coverLastZ = Number.POSITIVE_INFINITY;
  /** `?cover=0` disables the ground-cover ring; default on (field lane only). */
  private readonly _coverEnabled: boolean;
  /** `?canopy=0` disables the canopy ambient occlusion (P6a A/B); default on (field lane). */
  private readonly _canopyEnabled: boolean;
  /** Canopy coverage of the tree population, shared by the tree field and every cover field. */
  private _canopy: FieldCanopy | undefined = undefined;
  /** Forest-floor material (gets the canopy as `aoMap`, ambient-only darkening). */
  private _groundMaterial: StandardMaterial | undefined = undefined;
  /** `?look=auto`: smoothed canopy coverage at the camera (0 = meadow look, 1 = forest look). */
  private _lookBlend = 0;
  private _lookBlendApplied = -1;
  /** Reused blended look (zero allocation per frame). */
  private readonly _blendLook: {
    name: string;
    toneMapping: FoliageLook["toneMapping"];
    exposure: number;
    contrast: number;
    saturation: number;
    temperature: number;
    tint: number;
    lift: [number, number, number];
    gamma: [number, number, number];
    gain: [number, number, number];
  } = {
    name: "auto",
    toneMapping: FOLIAGE_LOOKS.SUNNY_MEADOW.toneMapping,
    exposure: 1,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
  };
  /** `?coverDensity=` clumps per m² (clamped); default `COVER_DEFAULT_DENSITY`. */
  private readonly _coverDensity: number;
  /** `?coverRadius=` ring outer radius in metres (clamped); default `COVER_DEFAULT_RADIUS`. */
  private readonly _coverRadius: number;
  /** `?tree=<stem>`: textured species (`<stem>.species.json` + `<stem>_LOD0..3.glb` + albedo
   *  layers). Field lane only; implies the real LOD chain. Absent = the default asset set. */
  private readonly _treeStem: string | undefined;
  /** Loaded species sidecar (set by `_loadPrototype` when `?tree=` resolves). */
  private _species: SpeciesManifest | undefined = undefined;
  /** Albedo layers of the species (one per primitive), bound as the field's `albedoArray`. */
  private _speciesAlbedo: TextureArray | undefined = undefined;
  /** LOD-transition strategy of the tree field (`?lodMode=`, HUD `L`); default = the engine's
   *  zero-config `hysteresis`. Passed at setup level, mirrored in MEASURE + HUD. */
  private _lodMode: LodTransitionMode = "hysteresis";
  /** Live TAA state (`?taa=1` arms the engine `TaaElement`; default off). Sighting knob for the
   *  ADR 0059 step-2 dither modes — documented as TAA-dependent ("TAA resolves the dither"). */
  private readonly _taaLive: boolean;
  /** `?look=auto|meadow|forest|off`: foliage look (tone curve + exposure + grading, ADR 0059
   *  step 6a look-dev). `auto` blends meadow -> forest by the canopy coverage at the camera.
   *  Interactive default `auto`; automated runs default `off`. */
  private readonly _look: "auto" | "meadow" | "forest" | "off";
  /** `?hbao=0|1`: screen-space AO for contact darkening. Interactive default on, automated off. */
  private readonly _hbao: boolean;
  /** Latest optically-probed cull frame (kept 1: the dual-lane audit samples the LAST frame). */
  private _lastProbeSet: FieldVisibleSets | undefined = undefined;
  private _lastCpuTotal = 0;
  /** CPU-side conservative cull verdict of the last probed frame (`?cullref=1`). */
  private _lastCullVerdict = "";
  /** Reused pose-decode scratch (no per-record allocation in the reference cull). */
  private readonly _poseOut: InstancePose = { yawRadians: 0, uniformScale: 0 };
  private readonly _poseBits = new Float32Array(1);
  private readonly _poseWord = new Uint32Array(this._poseBits.buffer);

  constructor(options: EngineOptions = {}) {
    super(options);
    // Perpetual dev/QA surface (showcase-52 `__qaSwm52` convention): the live app on `window`, so
    // headless readbacks + user devtools can reach engine internals (renderer device, canvas
    // context) for pixel probes without adding imports or touching the module scope.
    (window as unknown as { __swm51?: Showcase }).__swm51 = this;
    const params = new URLSearchParams(window.location.search);

    // Interactive sessions (no automation/QA/golden/truth flag) default to the showcase scene:
    // field lane + textured jacaranda + `INTERACTIVE_TREE_COUNT` trees. Automated runs keep the
    // measurement defaults (autoinst, Kenney set, `DEFAULT_INSTANCE_COUNT`) so benches, QA and the
    // `veg51` golden stay reproducible. Explicit params always win; `?tree=none` = Kenney set.
    const interactive =
      !params.has("frames") &&
      params.get("qa") !== "1" &&
      !params.has("__golden") &&
      params.get("truth") !== "1";
    const mode = params.get("mode") ?? (interactive ? "field" : null);
    this._mode = mode === "instanced" ? "instanced" : mode === "field" ? "field" : "autoinst";

    // S2 field-lane knobs (ADR 0059 step 1). `?occlusion=a|b|c`, `?popcount=1`, `?cullref=1` and
    // `?cutEvery=N` only take effect on the WebGPU field lane; elsewhere they are inert.
    const occ = params.get("occlusion");
    this._occlusionMode = occ === "a" || occ === "b" || occ === "c" ? occ : "b";
    this._popcount = params.get("popcount") === "1";
    this._cullref = params.get("cullref") === "1";
    const rawCut = Number(params.get("cutEvery"));
    this._cutEvery =
      Number.isFinite(rawCut) && rawCut >= 10 ? Math.floor(rawCut) : DEFAULT_CUT_EVERY;

    // NOTE (`Number(null) === 0`): absent params MUST stay on their defaults -- the naive
    // `Number(params.get(...))` turns a missing knob into `0` (empty population / seed 0 /
    // frozen path), which silently breaks the default and the gate. Guard every read with
    // `params.has(...)` before coercing.
    const rawN = params.get("n");
    let targetCount = interactive ? INTERACTIVE_TREE_COUNT : DEFAULT_INSTANCE_COUNT;
    if (rawN !== null) {
      const n = Number(rawN);
      if (Number.isFinite(n) && n >= 0) {
        targetCount = Math.min(MAX_INSTANCE_COUNT, Math.floor(n));
      }
    }
    this._targetCount = targetCount;

    const rawSeed = params.get("seed");
    this._seed =
      rawSeed !== null && Number.isFinite(Number(rawSeed))
        ? Math.floor(Number(rawSeed))
        : DEFAULT_SEED;

    const rawFrames = Number(params.get("frames"));
    this._targetFrames =
      Number.isFinite(rawFrames) && rawFrames > 0 ? Math.floor(rawFrames) : DEFAULT_FRAMES;

    this._isAutomated = params.has("frames");
    this._isQa = params.get("qa") === "1";
    this._shadowsOn = params.get("shadows") !== "off";
    // ADR 0059 step 1b: field-lane wind on by default; `?wind=0` disables it for cost isolation.
    // `_windLive` mirrors the knob at startup; the HUD toggle can flip it at runtime.
    this._windEnabled = params.get("wind") !== "0";
    this._windLive = this._windEnabled;
    // ADR 0059 step 1b: ground-cover ring knobs (field lane only; absent params stay on defaults,
    // same guard discipline as `?n=` above — `?coverDensity=` without a value is a no-op).
    this._coverEnabled = params.get("cover") !== "0";
    this._canopyEnabled = params.get("canopy") !== "0";
    const rawDensity = Number(params.get("coverDensity"));
    this._coverDensity =
      params.has("coverDensity") && Number.isFinite(rawDensity) && rawDensity > 0
        ? Math.min(8, rawDensity)
        : COVER_DEFAULT_DENSITY;
    const rawCoverRadius = Number(params.get("coverRadius"));
    this._coverRadius =
      params.has("coverRadius") && Number.isFinite(rawCoverRadius)
        ? Math.min(400, Math.max(20, rawCoverRadius))
        : COVER_DEFAULT_RADIUS;

    // ADR 0059 step 2 sighting: `?taa=1` arms the engine `TaaElement` (engine default off). The
    // dither transition modes are documented as TAA-dependent — the knob restores the intended
    // display condition for the live human A/B. Applied after `super.start()` (the renderer is
    // only assigned by `start()`); MEASURE + HUD report the live state.
    this._taaLive = params.get("taa") === "1";

    const rawTree = params.get("tree") ?? (interactive ? INTERACTIVE_TREE_STEM : null);
    this._treeStem =
      rawTree !== null && rawTree !== "none" && /^[a-z0-9_]+$/.test(rawTree) ? rawTree : undefined;

    const rawLook = params.get("look") ?? (interactive ? "auto" : "off");
    this._look =
      rawLook === "auto" || rawLook === "meadow" || rawLook === "forest" ? rawLook : "off";
    this._hbao = (params.get("hbao") ?? (interactive ? "1" : "0")) === "1";

    const rawLodMode = params.get("lodMode");
    if (rawLodMode !== null && rawLodMode in LOD_TRANSITION_MODES) {
      this._lodMode = rawLodMode as LodTransitionMode;
    }

    const pathValue = params.get("path");
    this._path =
      pathValue === "walk" || pathValue === "flight" || pathValue === "aerial"
        ? pathValue
        : undefined;
    this._pathCam = this._path !== undefined ? getCameraPath(this._path) : undefined;

    const rawPausedAt = Number(params.get("pausedAt"));
    this._pausedAt =
      this._pathCam !== undefined && params.has("pausedAt") && Number.isFinite(rawPausedAt)
        ? rawPausedAt
        : undefined;
    this._pathT = this._pausedAt ?? 0;

    this._isTruth = params.get("truth") === "1";

    // Automated/QA/path/golden runs need a fixed vantage; interactive runs give the full 6-DOF
    // spectator camera (abstract-showcase default, WASD + mouse look + Space/C, `?path=` still
    // freezes it when explicitly requested). Orbit can be re-added on request, not preemptively.
    this.defaultCameraController =
      this._isAutomated || this._isQa || this._path !== undefined || params.has("__golden")
        ? "none"
        : "fly";
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    this.renderer.setClearColor(HORIZON_COLOR);

    // Linear distance fog to the far horizon; trees stay readable inside the box.
    this.scene.fog = new Fog({
      mode: FogMode.LINEAR,
      color: HORIZON_COLOR,
      near: FOG_NEAR,
      far: FOG_FAR,
    });

    // Key sun + ambient (ADR 0059 step 0: "one key directional sun + ambient"). Shadows on by
    // default, disable via `?shadows=off` to isolate passes in benches.
    const ambient = new AmbientLight({
      color: new Color(0.58, 0.62, 0.55),
      intensity: 0.5,
    });
    this.scene.add(ambient);

    const sun = new DirectionalLight({
      direction: new Vector3D(-0.45, -1, -0.4).normalize(),
      color: new Color(1, 0.98, 0.92),
      intensity: 2.2,
      numCascades: 2,
      cascadeSplitLambda: 0.5,
    });
    sun.castShadow = this._shadowsOn;
    sun.shadowBias = 0.002;
    sun.shadowResolution = 2048;
    this.scene.add(sun);

    // Flat neutral forest floor; reproducibility over art.
    const ground = new Object3D("ForestFloor");
    ground.geometry = new Ground({ width: GROUND_SIZE, depth: GROUND_SIZE }).getGeometryData();
    ground.material = this._groundMaterial = new StandardMaterial({
      color: new Color(0.16, 0.21, 0.14),
      roughness: 0.95,
      metallic: 0,
    });
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Interactive start pose: low and close at the forest edge (eye level, trees readable and
    // the wind motion clearly visible), NOT the old far elevated 3/4 overview. Fly free with
    // WASD + mouse; `R` returns exactly here. Path/golden/automated runs never use this pose.
    const camPos = new Vector3D(42, 5, 42);
    const camTarget = new Vector3D(0, 4, 0);
    this.setInitialCamera(camPos, camTarget);

    // Tree lane: asset prototype when Frank's files exist, else the procedural placeholder.
    this._prototype = await this._loadPrototype();
    // `?tree=` species (field lane only): preload the REAL `<stem>_LOD<n>.glb` siblings ASYNC
    // right after the prototype (`_buildFieldLane` stays sync — the load happens before it). The
    // default path (no knob) skips this entirely — no loader is spun up, `realLods` stays null.
    const realLods =
      this._species !== undefined && this._mode === "field"
        ? await this._tryLoadRealLodLevels(this._prototype)
        : null;
    const instances = scatterTrees(this._targetCount, this._seed);
    this._treeCount = instances.length;
    if (this._mode === "autoinst") {
      this._buildAutoInstances(instances, this._prototype);
    } else if (this._mode === "field") {
      // WebGPU-only lane; a non-WebGPU `?mode=field` falls back to `autoinst` (documented).
      if (this._buildFieldLane(instances, this._prototype, realLods)) {
        this._treeCount = instances.length;
        // ADR 0059 step 1b, source B: second camera-centred field for the ground-cover ring
        // (optional, `?cover=0` to disable; non-fatal when the device cannot host a second field).
        this._buildGroundCover();
      } else {
        this._buildAutoInstances(instances, this._prototype);
      }
    } else {
      this._buildInstanced(instances, this._prototype);
    }

    if (this._isAutomated) {
      this._state = "warmup";
      this._writeStatus(
        `ready mode=${this._mode} n=${this._treeCount} seed=${this._seed} ` +
          `renderer=${this.renderer.type}`,
      );
    }

    // S1: camera-path rig (P0-4). A `?path=` run drives the pose from the very first frame; the
    // orbit controller is already disabled in the constructor, so `setExternalCameraPose` is the
    // only motion source for the rest of the session.
    if (this._pathCam !== undefined) {
      this._externalCameraActive = true;
      this._applyPathPose();
    }

    // S1: opt-in GPU timing ring (P0-1). Enabled on request (`?gputimings=1`) for automated
    // diagnostics, or automatically in interactive HUD mode on WebGPU (K5: zero cost while
    // disabled, so default automated runs stay byte-identical). Capture modes (`?qa=1`,
    // `?pausedAt=`) have no HUD consumer, so they never auto-enable either.
    const params = new URLSearchParams(window.location.search);
    const gpuTimer = this._resolveGpuTimer();
    // `?pausedAt=` is a capture knob (veg-bench keyframe shots + truth compare): the DOM HUD
    // would pollute the clipped screenshots and the FLIP comparison, so it counts as hud-free.
    const interactiveHud =
      !hudFreeMode(window.location.search) && !this._isQa && !params.has("pausedAt");
    if (gpuTimer !== undefined) {
      const explicit = params.get("gputimings") === "1";
      if (explicit || (interactiveHud && this.renderer.type === RendererType.WEB_GPU)) {
        gpuTimer.enable();
      }
      // Keep a reference whenever the ring can be active: interactive HUD (auto-enabled) OR an
      // explicit `?gputimings=1` diagnostic run (`?frames=`/`?measure=`, where the HUD is absent
      // but `_finalize()` must still attach `gpuMs`/`gpuPassesMs` to the MEASURE contract).
      if (interactiveHud || explicit) {
        this._gpuTimer = gpuTimer;
      }
    }

    // S1: interactive measurement HUD (P0-4). Never constructed in golden/measure/frames/truth
    // modes (byte-identical captures, see `hudFreeMode`), nor in `?qa=1`/`?pausedAt=` capture
    // modes. Handles path switching + live readout.
    if (interactiveHud) {
      this._hud = new Hud({
        gpuTimings: this._gpuTimer !== undefined ? new GpuTimingsAdaptor(this._gpuTimer) : null,
        getCpuTime: (): number => this.lastCpuTimeMs,
        onSelectPath: (path: PathName): void => this._selectPath(path),
        onFreeFly: (): void => this._enterFreeFly(),
        ...(this._path !== undefined ? { initialPath: this._path } : {}),
        onToggleWind: (): void => this._toggleWindLive(),
        onCycleLodMode: (): void => this._toggleLodMode(),
      });
    }
  }

  /** Applies the active path's frozen or advanced pose to the external camera (used every frame). */
  private _applyPathPose(): void {
    const cam = this._pathCam;
    if (cam === undefined) return;
    const sample = cam.sample(this._pathT);
    this._externalCameraPos.set(sample.position[0], sample.position[1], sample.position[2]);
    this._externalCameraTarget.set(sample.target[0], sample.target[1], sample.target[2]);
  }

  /** Switches the active camera path (HUD 1/2/3, buttons); restarts the loop at `t=0`. */
  private _selectPath(path: PathName): void {
    if (this._path === path && this._pathCam !== undefined) return;
    this._path = path;
    this._pathCam = getCameraPath(path);
    this._pathT = this._pausedAt ?? 0;
    this._externalCameraActive = true;
    this._applyPathPose();
  }

  /**
   * Leaves the active camera path (HUD `0`): the camera keeps its current pose and is handed to the
   * engine fly controller (created on demand when the session started on a path, where the default
   * controller is `none`). Yaw/pitch are derived from the current view so the switch has no snap.
   */
  private _enterFreeFly(): void {
    this._path = undefined;
    this._pathCam = undefined;
    this._externalCameraActive = false;
    const cam = this.camera;
    const dir = cam.target.clone().sub(cam.position);
    const len = dir.length();
    if (len > 1e-5) {
      dir.scale(1 / len);
      cam.phi = Math.asin(Math.max(-0.9999, Math.min(0.9999, dir.y)));
      cam.theta = Math.atan2(dir.x, -dir.z);
    }
    if (!cam.behaviors.some((b) => b instanceof FlyController)) {
      cam.setStrategy(CameraStrategyType.FPS);
      cam.addBehavior(new FlyController({ input: this.input, moveSpeed: this.defaultMoveSpeed }));
    }
  }

  /**
   * Returns the opt-in GPU timing ring when the active renderer exposes it (WebGPU tier). The base
   * `Renderer` type does not declare `gpuTimings`; the structural guard keeps other tiers honest.
   */
  private _resolveGpuTimer(): GpuTimer | undefined {
    if (this.renderer.type !== RendererType.WEB_GPU) return undefined;
    const maybe = (this.renderer as unknown as { gpuTimings?: GpuTimer }).gpuTimings;
    return maybe ?? undefined;
  }

  /**
   * Golden-capture mode (shared `GoldenSession` contract, see `apps/showcases/shared/GoldenCapture.ts`):
   * `?__golden=forest-baseline&__goldenView=base&__goldenFrames=N` stops the realtime loop, pins the
   * deterministic surface, soaks, then advances N fixed `step(1/60)` frames of the un-optimized
   * baseline (camera freezes — no path, no orbit — so identical URLs yield identical bytes).
   * Runs only after `super.start()` has built the scene and dispatched `scene-ready`.
   */
  public override async start(): Promise<void> {
    const golden = parseGoldenSpec<string>((rawView) => rawView ?? "base");
    await super.start();
    // ADR 0059 step 2 sighting: `?taa=1` arms the ENGINE `TaaElement` (default off). Applied
    // here — every renderer's post group always carries the element and `enabled` gates the
    // history-blend pass — not in the constructor, where `renderer` is still unassigned.
    this._applyTaaKnob();
    this._applyLookKnobs();
    if (golden === undefined) return;
    this._golden?.dispose();
    this._golden = new GoldenSession(this, {
      width: GOLDEN_WIDTH,
      height: GOLDEN_HEIGHT,
      zeroFrameClock: false,
      extraHiddenSelectors: [],
    });
    await this._golden.run(golden, lookupOwn(GOLDEN_POOLS, golden.poolKeyRaw) !== undefined, {});
  }

  /**
   * Applies the constructor-parsed `?taa=` knob to the engine post-processing `TaaElement`.
   * Guarded (`get` may be `undefined`): toggling is inert on hostile configs, never throws.
   */
  /** Applies `?look=` / `?hbao=` (ADR 0059 step 6a look-dev): enables the post group only when
   *  one of them is on, so automated runs keep the post-free measurement path. */
  private _applyLookKnobs(): void {
    const pp = this.renderer.postProcessing;
    if (this._look === "off" && !this._hbao) return;
    pp.enabled = true;
    if (this._look === "auto") {
      this._updateAutoLook(0);
    } else if (this._look !== "off") {
      applyFoliageLook(
        pp,
        this._look === "meadow" ? FOLIAGE_LOOKS.SUNNY_MEADOW : FOLIAGE_LOOKS.FOREST_SHADE,
      );
    }
    const hbao = pp.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao !== undefined && this._hbao) {
      hbao.enabled = true;
      hbao.radius = HBAO_RADIUS;
      hbao.intensity = HBAO_INTENSITY;
    }
  }

  /** Canopy coverage [0, 1] at a world XZ (nearest cell; 0 outside the map / without canopy). */
  private _canopyCoverageAt(x: number, z: number): number {
    const c = this._canopy;
    if (c === undefined) return 0;
    const cx = Math.floor((x - c.originX) / c.cellSize);
    const cz = Math.floor((z - c.originZ) / c.cellSize);
    if (cx < 0 || cz < 0 || cx >= c.width || cz >= c.height) return 0;
    return c.data[cz * c.width + cx]! / 255;
  }

  /** `?look=auto`: eases the coverage above the camera (faded out above the crowns, like the
   *  field shader) and blends the continuous look parameters meadow -> forest. The tone curve
   *  stays the meadow one (switching curves would jump; AgX greys the open sky). Re-applies only
   *  when the blend moved noticeably. */
  private _updateAutoLook(deltaTime: number): void {
    const c = this._canopy;
    const cam = this.camera.position;
    let target = this._canopyCoverageAt(cam.x, cam.z);
    if (c !== undefined) {
      const t = Math.min(1, Math.max(0, (cam.y - 0.35 * c.canopyHeight) / (0.65 * c.canopyHeight)));
      target *= 1 - t * t * (3 - 2 * t);
    }
    const k = deltaTime > 0 ? Math.min(1, deltaTime * LOOK_BLEND_RATE) : 1;
    this._lookBlend += (target - this._lookBlend) * k;
    if (Math.abs(this._lookBlend - this._lookBlendApplied) < 0.01) return;
    this._lookBlendApplied = this._lookBlend;
    const a = FOLIAGE_LOOKS.SUNNY_MEADOW;
    const b = FOLIAGE_LOOKS.FOREST_SHADE;
    const w = this._lookBlend;
    const L = this._blendLook;
    const mix = (p: number, q: number): number => p + (q - p) * w;
    L.exposure = mix(a.exposure, b.exposure);
    L.contrast = mix(a.contrast, b.contrast);
    L.saturation = mix(a.saturation, b.saturation);
    L.temperature = mix(a.temperature, b.temperature);
    L.tint = mix(a.tint, b.tint);
    for (let i = 0; i < 3; i++) {
      L.lift[i] = mix(a.lift[i]!, b.lift[i]!);
      L.gamma[i] = mix(a.gamma[i]!, b.gamma[i]!);
      L.gain[i] = mix(a.gain[i]!, b.gain[i]!);
    }
    applyFoliageLook(this.renderer.postProcessing, L);
  }

  /** Forest floor: the canopy coverage as the ground's `aoMap` (R channel scales its ambient
   *  term only), one texel per metre over the `GROUND_SIZE` plane (uv v = 1 at -Z). */
  private _applyGroundCanopy(canopy: FieldCanopy): void {
    const material = this._groundMaterial;
    if (material === undefined) return;
    const size = GROUND_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let row = 0; row < size; row++) {
      const z = half - (row + 0.5);
      for (let col = 0; col < size; col++) {
        const x = -half + (col + 0.5);
        const ao = 1 - (1 - canopy.ambientFloor) * this._canopyCoverageAt(x, z);
        const o = (row * size + col) * 4;
        const g = Math.round(ao * 255);
        img.data[o] = g;
        img.data[o + 1] = g;
        img.data[o + 2] = g;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    material.aoMap = Texture.fromCanvas(canvas);
  }

  private _applyTaaKnob(): void {
    const taaNode = this.renderer.postProcessing.get(PostProcessingEffectType.TAA);
    if (taaNode !== undefined) {
      taaNode.enabled = this._taaLive;
    }
  }

  /**
   * Tries the expected asset names in order and returns the first prototype that loads. If none
   * loads (assets absent mid-development), logs the fallback and returns the procedural
   * placeholder — both lanes keep the baseline runnable and reproducible.
   */
  private async _loadPrototype(): Promise<TreePrototype> {
    const loader = new GltfLoader({ basePath: "./assets/" });
    if (this._treeStem !== undefined && this._mode === "field") {
      const species = await this._tryLoadSpecies(loader, this._treeStem);
      if (species) return species;
    }
    for (const asset of EXPECTED_TREE_ASSETS) {
      try {
        const root = await loader.load(asset);
        const parts = this._collectAssetParts(root);
        if (parts.length === 0) continue;
        console.info(`[Showcase51] tree prototype from asset "${asset}" (${parts.length} parts)`);
        return { name: asset, source: "asset", parts };
      } catch (error) {
        console.info(
          `[Showcase51] asset "${asset}" unavailable (${error instanceof Error ? error.message : String(error)}); trying next`,
        );
      }
    }
    console.info(
      "[Showcase51] no CC0 tree assets present — using procedural placeholder prototype",
    );
    return buildProceduralPrototype();
  }

  /**
   * `?tree=<stem>`: loads the species sidecar, `<stem>_LOD0.glb` and the albedo layers. Fail-
   * closed: any missing piece or a part/layer count mismatch logs once and returns null (the
   * default asset set is used). Sets `_species` / `_speciesAlbedo` only on full success.
   */
  private async _tryLoadSpecies(loader: GltfLoader, stem: string): Promise<TreePrototype | null> {
    try {
      const response = await fetch(`./assets/${stem}.species.json`);
      if (!response.ok) throw new Error(`species.json HTTP ${response.status}`);
      const manifest = (await response.json()) as SpeciesManifest;
      const name = `${stem}_LOD0.glb`;
      const parts = this._collectAssetParts(await loader.load(name));
      if (parts.length !== manifest.layers.length) {
        throw new Error(`${parts.length} parts vs ${manifest.layers.length} species layers`);
      }
      // glTF uv convention: no flip on decode (same rule as the engine's glTF texture path).
      this._speciesAlbedo = await TextureArray.fromUrls(
        manifest.layers.map((l) => `./assets/${l.albedo}`),
        { flipY: false },
      );
      this._species = manifest;
      console.info(`[Showcase51] species "${stem}": ${parts.length} parts, albedo layers`);
      return { name, source: "asset", parts };
    } catch (error) {
      console.info(
        `[Showcase51] species "${stem}" unavailable (${error instanceof Error ? error.message : String(error)}) — default assets`,
      );
      return null;
    }
  }

  /**
   * Flattens a loaded tree into its mesh-bearing leaves (deterministic DFS order). Each leaf
   * becomes one {@link TreePart} reusing the imported geometry/material references, so every
   * clone in the population shares them (ADR 0046 runs require reference-identical geometry).
   * Only the world-Y offset relative to the root is kept: the asset contract requires upright,
   * vertical-axis-centered trees (base at y=0), so X/Z part offsets and part rotation are zero
   * by construction.
   */
  private _collectAssetParts(root: Object3D): TreePart[] {
    root.updateMatrixWorld(true);
    const rootY = root.getWorldPosition().y;
    const parts: TreePart[] = [];
    const scratch = new Vector3D();

    const visit = (node: Object3D): void => {
      if (node.geometry && node.material) {
        node.getWorldPosition(scratch);
        parts.push({
          name: node.name || "Part",
          geometry: node.geometry,
          material: node.material as StandardMaterial,
          offsetY: scratch.y - rootY,
        });
      }
      for (const child of node.children) {
        visit(child);
      }
    };
    visit(root);
    return parts;
  }

  /**
   * `?tree=` species loader: consumes the REAL generated LOD siblings of the
   * active prototype — `<stem>_LOD3.glb`, `<stem>_LOD2.glb`, `<stem>_LOD1.glb` (`_LOD0` = the
   * already-loaded prototype, never reloaded) — and merges each into
   * field geometry via the shared `_collectAssetParts` / `_mergeTreeGeometry` helpers. ATOMIC and
   * fail-closed: only when ALL THREE levels yield ≥1 collectable indexed part is `[lod3, lod2,
   * lod1]` (coarsest first) returned; ANY missing file / exception / zero-part level logs ONE
   * informative line and returns null (the caller falls back to the stride-decimation proxies).
   * Deterministic; never throws.
   */
  private async _tryLoadRealLodLevels(
    proto: TreePrototype,
  ): Promise<GeometryDataInterface[] | null> {
    if (proto.source !== "asset") return null;
    const stem = proto.name.replace(/(_LOD0)?\.glb$/i, "");
    const loader = new GltfLoader({ basePath: "./assets/" });
    const lods: GeometryDataInterface[] = [];
    // Coarsest first (LOD3 = furthest bucket 0). Every level must collect ≥1 mesh part.
    for (const suffix of ["_LOD3.glb", "_LOD2.glb", "_LOD1.glb"]) {
      const assetName = stem + suffix;
      try {
        const root = await loader.load(assetName);
        const parts = this._collectAssetParts(root);
        if (parts.length === 0) {
          console.info(
            `[Showcase51] real LOD "${assetName}" has no mesh parts — reallod off, proxy fallback`,
          );
          return null;
        }
        lods.push(this._mergeTreeGeometry({ name: assetName, source: "asset", parts }));
      } catch (error) {
        console.info(
          `[Showcase51] real LOD "${assetName}" unavailable ` +
            `(${error instanceof Error ? error.message : String(error)}) — reallod off, proxy fallback`,
        );
        return null;
      }
    }
    return lods;
  }

  /** `autoinst` lane: plain scene-graph nodes, part-major so identical parts stay consecutive. */
  private _buildAutoInstances(instances: readonly ScatterInstance[], proto: TreePrototype): void {
    for (const part of proto.parts) {
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i]!;
        const node = new Object3D(`Tree${i}_${part.name}`);
        node.geometry = part.geometry;
        node.material = part.material;
        node.position.set(inst.x, part.offsetY * inst.scale, inst.z);
        node.rotation.set(0, inst.yaw, 0);
        node.scale.set(inst.scale, inst.scale, inst.scale);
        node.castShadow = true;
        node.receiveShadow = true;
        this.scene.add(node);
        this._forestNodes.push(node);
      }
    }
  }

  /** `instanced` lane: one `InstancedMesh` per part, one draw each for the whole population. */
  private _buildInstanced(instances: readonly ScatterInstance[], proto: TreePrototype): void {
    const matrix = new Matrix4();
    const position = new Vector3D();
    const rotation = new Vector3D();
    const scale = new Vector3D();
    for (const part of proto.parts) {
      const mesh = new InstancedMesh(
        `TreeInstances_${part.name}`,
        part.geometry,
        part.material,
        instances.length,
      );
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i]!;
        position.set(inst.x, part.offsetY * inst.scale, inst.z);
        rotation.set(0, inst.yaw, 0);
        scale.set(inst.scale, inst.scale, inst.scale);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this._forestNodes.push(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // S2 field lane (ADR 0059 step 1, WebGPU only)
  // -------------------------------------------------------------------------

  /**
   * Registers the deterministic population as an `InstanceFieldSystem` on the WebGPU renderer:
   * one combined single-mesh tree prototype (V1 constraint: one geometry per bucket, one
   * material), records packed with the frozen `packInstancePose` (16 B each), GPU cull /
   * occlusion / pulled indirect draw driven entirely by the renderer's own coordinator. Returns
   * false when the active renderer is not WebGPU (caller falls back to the autoinst lane) or the
   * population is empty — both documented non-goals for the field lane.
   */
  private _buildFieldLane(
    instances: readonly ScatterInstance[],
    proto: TreePrototype,
    realLods: readonly GeometryDataInterface[] | null | undefined = undefined,
  ): boolean {
    if (!(this.renderer instanceof WebGPURenderer)) {
      console.info("[Showcase51] ?mode=field needs WebGPU — falling back to the autoinst lane");
      return false;
    }
    if (instances.length === 0) {
      return false;
    }
    const merged = this._mergeTreeGeometry(proto);
    const radius = this._treeBoundingRadius(merged);
    // P2 (ADR 0059 step 2): geometry chain + band wiring of the tree field. Bucket index ASCENDS
    // with projected diameter (near=detail; geometry is bound by bucket index), so the COARSEST
    // variant sits at bucket 0 (farthest tier) and the FULL merged tree at the highest index,
    // with DISTINCT geometry per bucket (the cull's crossfade band dual-writes adjacent
    // {coarse, fine} pairs). TWO sources, identical downstream wiring: the proven load-time
    // stride-decimation proxies (default, 3 buckets) and the `?tree=` species real
    // `<stem>_LOD<n>.glb` siblings (4 buckets, atomically preloaded in `_tryLoadRealLodLevels`,
    // `_LOD0` = the merged tree itself — never reloaded).
    const useReal = realLods !== undefined && realLods !== null && realLods.length === 3;
    const geometryTableRow: readonly GeometryDataInterface[] = useReal
      ? [...realLods, merged]
      : [
          this._buildLodProxyGeometry(merged, FIELD_LOD_PROXY_STRIDE[0]!),
          this._buildLodProxyGeometry(merged, FIELD_LOD_PROXY_STRIDE[1]!),
          merged,
        ];
    // Band maxima: `FIELD_LOD_MAXIMA_PX` (proxy) resp. `FIELD_LOD_MAXIMA_REAL_PX` (real LODs);
    // band i min = prev max + 1, bucket 0 min = `FIELD_CULL_PIXEL_SIZE + 1` (the cull gate must
    // stay below the band floor), top max MUST stay 1e6 (hard near tile).
    const bands: LodBucketDescriptor[] = useReal
      ? [
          {
            name: "L3-far",
            lodIndex: 3,
            minProjectedSize: FIELD_CULL_PIXEL_SIZE + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[0]!,
            geometrySlot: 0,
          },
          {
            name: "L2",
            lodIndex: 2,
            minProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[0]! + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[1]!,
            geometrySlot: 1,
          },
          {
            name: "L1",
            lodIndex: 1,
            minProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[1]! + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[2]!,
            geometrySlot: 2,
          },
          {
            name: "L0-near",
            lodIndex: 0,
            minProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[2]! + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_REAL_PX[3]!,
            geometrySlot: 3,
          },
        ]
      : [
          {
            name: "L2-far",
            lodIndex: 2,
            minProjectedSize: FIELD_CULL_PIXEL_SIZE + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_PX[0]!,
            geometrySlot: 0,
          },
          {
            name: "L1-mid",
            lodIndex: 1,
            minProjectedSize: FIELD_LOD_MAXIMA_PX[0]! + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_PX[1]!,
            geometrySlot: 1,
          },
          {
            name: "L0-near",
            lodIndex: 0,
            minProjectedSize: FIELD_LOD_MAXIMA_PX[1]! + 1,
            maxProjectedSize: FIELD_LOD_MAXIMA_PX[2]!,
            geometrySlot: 2,
          },
        ];
    const prototype: PrototypeDescriptor = {
      id: `s51-${proto.name}`,
      boundingRadius: radius,
      lodBuckets: bands,
      materialSlot: 0,
      maxInstances: instances.length,
    };
    const records = this._buildFieldRecords(instances);
    this._fieldRecords = records;
    this._fieldBoundingRadius = radius;
    this._fieldCullPixelSize = FIELD_CULL_PIXEL_SIZE;

    // ADR 0059 step 1b: shared wind field for the field lane. A gentle forest breeze with
    // travelling gust fronts + calm phases (the reference-demo critique #1). `windHeight`
    // (crown top) is the vertical-profile / bend normalizer; scale-1 trees reach full wind.
    // The wind field is ALWAYS constructed here (kept advancing every frame), but its state is
    // applied to the system via `_applyWindState()` after registration — that makes the HUD
    // `F` toggle a pure live swap with no field re-creation and no wind-pop on re-enable.
    const windHeight = this._treeMaxHeight(merged);
    // ADR 0059 step 6a (candidate A): canopy ambient occlusion from the population's crowns.
    this._canopy = this._canopyEnabled ? this._buildCanopy(records, merged, windHeight) : undefined;
    if (this._canopy) this._applyGroundCanopy(this._canopy);
    let windField: WindField | undefined = undefined;
    if (windHeight > 0) {
      windField = new WindField({
        directionX: 1,
        directionZ: 0,
        speed: 6,
        gustLength: 55,
        crossStretch: 2.5,
        calm: 0.5,
        strength: 0.05,
        gustStrength: 0.22,
        flutterStrength: 0.04,
        flutterFrequency: 1.1,
        boundaryHeight: windHeight,
        groundFactor: 0.45,
        maxLean: 0.6,
      });
    }
    const lodOptions: Partial<InstanceFieldOptions> = {
      cellSize: FIELD_CELL_SIZE,
      maxInstances: instances.length,
      cullPixelSize: FIELD_CULL_PIXEL_SIZE,
      maxViews: 4,
    };
    const system = new InstanceFieldSystem(null, {
      instanceRecords: records,
      prototypes: [prototype],
      geometryTable: [geometryTableRow],
      options: lodOptions,
      ...(this._canopy ? { canopy: this._canopy } : {}),
      // Setup-level (the engine reads the mode here, not from `options`).
      lodTransitionMode: this._lodMode,
      // `?tree=` species: per-material albedo layers (layer = part ordinal via `materialLayers`).
      ...(this._speciesAlbedo ? { albedoArray: this._speciesAlbedo } : {}),
      ...(this._species?.layers.some((l) => l.cutout === true)
        ? { alphaTest: SPECIES_ALPHA_TEST }
        : {}),
      // Leaf transmission (ADR 0060), linear; the colour-stream alpha masks it to the foliage.
      backlight: [
        GltfMaterialParser.engineSRGBToLinear(FIELD_LEAF_BACKLIGHT[0]),
        GltfMaterialParser.engineSRGBToLinear(FIELD_LEAF_BACKLIGHT[1]),
        GltfMaterialParser.engineSRGBToLinear(FIELD_LEAF_BACKLIGHT[2]),
      ],
      // NOTE: no `windUniforms`/`windHeight` here — the wind state is applied right after
      // registration via `setWind` (`_applyWindState`), so the runtime state is authoritative.
    });
    if (this._occlusionMode === "a") {
      system.setOcclusionEnabled(false);
    }
    // Fail-closed registration (ADR 0043): on a 4-cap `maxBindGroups` device (e.g. headless
    // Dawn/SwiftShader) the field lane cannot bind group 4 — the renderer throws by design
    // (the group-1 fold is documented, not built). Dispose and fall back to `autoinst` instead
    // of failing the whole start.
    try {
      this.renderer.registerInstanceField(system);
    } catch (error) {
      system.dispose();
      this._fieldSystem = undefined;
      this._fieldRecords = undefined;
      this._fieldBoundingRadius = 0;
      console.info(
        `[Showcase51] ?mode=field unavailable on this device ` +
          `(${error instanceof Error ? error.message : String(error)}) — falling back to autoinst`,
      );
      return false;
    }
    this._fieldSystem = system;
    this._windField = windField;
    this._fieldWindHeight = windHeight;
    // Apply the initial wind state (URL knob) once the field is registered — the single
    // source of truth for the runtime swap, never the constructor.
    this._applyWindState();

    // Geometry-chain source bookkeeping (MEASURE `lodSource` / `lodTris`) + the source-specific
    // diagnostics line. The `source=` suffix on the standard info line is additive, never parsed.
    if (useReal) {
      this._lodSource = "reallod";
      this._realLodTris = geometryTableRow.map((g) => Math.floor((g.indices?.length ?? 0) / 3));
      console.info(
        `[Showcase51] field lane source=reallod buckets=4 tidy=${this._realLodTris.join("/")}`,
      );
    } else {
      this._lodSource = "proxy";
      this._realLodTris = [];
    }

    if (this._popcount || this._cullref) {
      system.installCullProbe({
        onCullFrame: (sets: FieldVisibleSets): void => this._onFieldCullFrame(sets),
      });
    }
    console.info(
      `[Showcase51] field lane: ${instances.length} records, cullRadius=${radius.toFixed(2)} m, ` +
        `occlusion=${this._occlusionMode}` +
        `, wind=${this._windField !== undefined && this._windLive ? "on" : "off"}` +
        `${this._popcount ? ", popcount" : ""}${this._cullref ? ", cullref" : ""}` +
        `, LOD mode=${this._lodMode}` +
        `, source=${this._lodSource}`,
    );
    return true;
  }

  /**
   * Second, camera-centred instance field for the procedural ground-cover ring (ADR 0059 step 1b,
   * source B). Records are CPU-generated every frame by `GroundCover` (stable per-tile hashes, no
   * swimming) and fed via the engine's `uploadRecords()` zero-GC live path into a SECOND
   * `InstanceFieldSystem` with its own grass-card geometry + material. `maxViews: 1` is the only
   * "no shadow casting" lever on the field lane (cascade/spot/point shadow draws are skipped,
   * while main depth + color still run and the pulled shading RECEIVES shadows). Shares the tree
   * `WindField`'s `SwmWind` block at the grass height profile so gust waves move both layers
   * coherently. Non-fatal: any setup/registration error disables the cover and logs.
   */
  private _buildGroundCover(): boolean {
    if (this._mode !== "field" || this._fieldSystem === undefined) return false;
    if (!(this.renderer instanceof WebGPURenderer)) return false;
    if (!this._coverEnabled) return false;
    const renderer = this.renderer;
    const cell = COVER_TILE_CELL;
    COVER_SPECIES.forEach((spec, index) => {
      const cover = new GroundCover({
        radius: this._coverRadius,
        cellSize: cell,
        bladesPerTile: Math.max(1, Math.round(this._coverDensity * spec.share * cell * cell)),
        seed: this._seed + 1000 + index * 97,
        fullDensityRadius: Math.min(140, this._coverRadius * 0.4),
        minDensity: 0.3,
        cameraClearRadius: 2,
        scaleRange: [0.7, 1.6],
      });
      const far = this._buildCoverGeometry(spec, index, spec.bladesFar);
      const near = this._buildCoverGeometry(spec, index, spec.blades);
      const prototype: PrototypeDescriptor = {
        id: `s51-cover-${spec.id}`,
        // Clump extent: blade height (incl. lean) and footprint radius, both at scale 1.
        boundingRadius: Math.hypot(spec.height, spec.radius + spec.height * spec.lean[1]),
        lodBuckets: [
          {
            name: "L1-far",
            lodIndex: 1,
            minProjectedSize: FIELD_CULL_PIXEL_SIZE + 1,
            maxProjectedSize: COVER_CLUMP_LOD_PX,
            geometrySlot: 0,
          },
          {
            name: "L0-near",
            lodIndex: 0,
            minProjectedSize: COVER_CLUMP_LOD_PX + 1,
            maxProjectedSize: 1e6,
            geometrySlot: 1,
          },
        ],
        materialSlot: 0,
        maxInstances: cover.capacity,
      };
      const system = new InstanceFieldSystem(null, {
        instanceRecords: cover.records,
        prototypes: [prototype],
        geometryTable: [[far, near]],
        options: {
          cellSize: cell,
          maxInstances: cover.capacity,
          cullPixelSize: FIELD_CULL_PIXEL_SIZE,
          // Main view only: ground cover never lands in the shadow-map passes.
          maxViews: 1,
        },
        ...(this._canopy ? { canopy: this._canopy } : {}),
      });
      try {
        renderer.registerInstanceField(system);
      } catch (error) {
        system.dispose();
        console.info(
          `[Showcase51] ground cover "${spec.id}" unavailable ` +
            `(${error instanceof Error ? error.message : String(error)}) — skipped`,
        );
        return;
      }
      this._coverLayers.push({ cover, system, windHeight: spec.height });
    });
    this._applyWindState();
    console.info(
      `[Showcase51] ground cover: ${this._coverLayers.length} species, radius=${this._coverRadius} m, ` +
        `density=${this._coverDensity} clumps/m², wind=${this._windLive ? "on" : "off"} (shared block)`,
    );
    return this._coverLayers.length > 0;
  }

  /** Builds one clump of `spec`: `bladeCount` curved, tapered blades inside `spec.radius` (5 verts /
   *  3 tris each: base pair, bent mid pair, tip), plus a petal fan + centre on each stem tip for
   *  flower species. The layout comes from a per-species FIXED-seed hash, so the far bucket is an
   *  exact prefix of the near bucket (surviving blades never move at the switch). Normals are
   *  world-up (ground-hugging shading); the colour stream carries linear albedo + foliage mask. */
  private _buildCoverGeometry(
    spec: CoverSpecies,
    speciesIndex: number,
    bladeCount: number,
  ): GeometryDataInterface {
    const toLinear = (c: Rgb): number[] => [
      GltfMaterialParser.engineSRGBToLinear(c[0]),
      GltfMaterialParser.engineSRGBToLinear(c[1]),
      GltfMaterialParser.engineSRGBToLinear(c[2]),
    ];
    const base = toLinear(spec.base);
    const tip = toLinear(spec.tip);
    const flower = spec.flower;
    const petal = flower ? toLinear(flower.petal) : tip;
    const centre = flower ? toLinear(flower.centre) : tip;
    let state = (0x51c0ffee + speciesIndex * 0x9e3779b9) | 0;
    const rand = (): number => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const headVerts = flower ? flower.petals * 2 + 1 : 0;
    const vertsPerBlade = 5 + headVerts;
    const trisPerBlade = 3 + (flower ? flower.petals : 0);
    const vertexCount = bladeCount * vertsPerBlade;
    const vertices = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(bladeCount * trisPerBlade * 3);
    let io = 0;
    const put = (
      v: number,
      x: number,
      y: number,
      z: number,
      rgb: readonly number[],
      mask: number,
    ): void => {
      vertices.set([x, y, z], v * 3);
      normals[v * 3 + 1] = 1;
      colors.set([rgb[0]!, rgb[1]!, rgb[2]!, mask], v * 4);
    };
    for (let b = 0; b < bladeCount; b++) {
      const r = spec.radius * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const facing = rand() * Math.PI;
      const fx = Math.cos(facing);
      const fz = Math.sin(facing);
      const h = spec.height * (0.6 + 0.4 * rand());
      const lean = spec.lean[0] + (spec.lean[1] - spec.lean[0]) * rand();
      const lx = (r > 1e-4 ? cx / r : 1) * lean * h;
      const lz = (r > 1e-4 ? cz / r : 0) * lean * h;
      const w = spec.width * (0.8 + 0.4 * rand());
      const hue = 0.85 + 0.3 * rand();
      const first = b * vertsPerBlade;
      const rings: readonly (readonly number[])[] = [
        [cx, 0, cz, w, 0],
        [cx + lx * 0.3, h * 0.55, cz + lz * 0.3, w * 0.75, 0.55],
        [cx + lx, h, cz + lz, 0, 1],
      ];
      let v = first;
      for (let ring = 0; ring < 3; ring++) {
        const [x, y, z, hw, t] = rings[ring]!;
        const count = ring === 2 ? 1 : 2;
        for (let side = 0; side < count; side++) {
          const sgn = count === 1 ? 0 : side === 0 ? -1 : 1;
          const rgb = [0, 1, 2].map((c) => (base[c]! + (tip[c]! - base[c]!) * t!) * hue);
          put(
            v,
            x! + fx * hw! * sgn,
            y!,
            z! + fz * hw! * sgn,
            rgb,
            COVER_ALPHA_BASE + (COVER_ALPHA_TIP - COVER_ALPHA_BASE) * t!,
          );
          uvs.set([0.5 + 0.5 * sgn, t!], v * 2);
          v++;
        }
      }
      indices.set(
        [
          first,
          first + 1,
          first + 2,
          first + 1,
          first + 3,
          first + 2,
          first + 2,
          first + 3,
          first + 4,
        ],
        io,
      );
      io += 9;
      if (flower) {
        // Petal fan around the stem tip, the disc tilted 35-65 deg up toward a random azimuth
        // (a level disc is edge-on from eye height and vanishes). Field draws are double-sided.
        const hx = cx + lx;
        const hy = h;
        const hz = cz + lz;
        const az = rand() * Math.PI * 2;
        const tilt = 0.6 + 0.5 * rand();
        // Disc basis: e1 = azimuth direction tilted up, e2 = horizontal perpendicular.
        const e1x = Math.cos(az) * Math.cos(tilt);
        const e1y = Math.sin(tilt);
        const e1z = Math.sin(az) * Math.cos(tilt);
        const e2x = -Math.sin(az);
        const e2z = Math.cos(az);
        const discPut = (vi: number, u: number, w2: number): void =>
          put(
            vi,
            hx + (u * e1x + w2 * e2x) * flower.size,
            hy + u * e1y * flower.size,
            hz + (u * e1z + w2 * e2z) * flower.size,
            petal,
            0.5,
          );
        const c0 = first + 5;
        put(c0, hx, hy, hz, centre, 0.5);
        const spin = rand() * Math.PI * 2;
        for (let k = 0; k < flower.petals; k++) {
          const a0 = spin + (k / flower.petals) * Math.PI * 2;
          const a1 = a0 + ((Math.PI * 2) / flower.petals) * 0.75;
          const p0 = c0 + 1 + k * 2;
          discPut(p0, Math.cos(a0), Math.sin(a0));
          discPut(p0 + 1, Math.cos(a1), Math.sin(a1));
          indices.set([c0, p0, p0 + 1], io);
          io += 3;
        }
      }
    }
    return {
      vertices,
      indices,
      normals,
      uvs,
      colors,
      getBoundingVolume: (): BoundingVolume => BoundingBox.fromVertices(vertices),
    };
  }

  /** Live clump records over all ground-cover species. */
  private _coverInstanceCount(): number {
    let n = 0;
    for (const layer of this._coverLayers) n += layer.system.instanceCount;
    return n;
  }

  /** Applies the CURRENT live wind state to the registered field system (`setWind` patch, hard
   *  off = height 0 -> pulled shader gate static). No-op without a field or a wind field. */
  private _applyWindState(): void {
    const system = this._fieldSystem;
    const field = this._windField;
    if (system === undefined || field === undefined) return;
    system.setWind(
      this._windLive ? field.uniforms : undefined,
      this._windLive ? this._fieldWindHeight : 0,
    );
    // Ground-cover ring shares the SAME wind block (gust waves must move trees and grass
    // coherently) with its own per-field blade-height profile; the live `F` toggle gates both.
    for (const layer of this._coverLayers) {
      layer.system.setWind(
        this._windLive ? field.uniforms : undefined,
        this._windLive ? layer.windHeight : 0,
      );
    }
  }

  /**
   * P2 load-time stepped LOD proxy of the merged tree geometry (ADR 0059 step 2): deterministic
   * triangle-stride decimation at load, pure CPU, zero runtime cost. Every `stride`-th triangle
   * is kept from the source index list; the vertex/normal/uv/colour streams are REUSED as-is
   * (a subset of triangles simply stops referencing the pruned vertices). `stride <= 1` returns
   * the source unchanged. The result is genuinely DISTINCT geometry per bucket — the cull's
   * crossfade band cross-dissolves these stepped variants, not the same mesh twice.
   */
  private _buildLodProxyGeometry(
    merged: GeometryDataInterface,
    stride: number,
  ): GeometryDataInterface {
    if (stride <= 1) return merged;
    const src = merged.indices;
    if (src === undefined) {
      // Indexed geometry is contract-required for field buckets (`_mergeTreeGeometry` enforces
      // it); a defensive identity passthrough keeps this builder total.
      return merged;
    }
    const triCount = Math.floor(src.length / 3);
    const out = new Uint32Array(Math.ceil(triCount / stride) * 3);
    let o = 0;
    for (let t = 0; t < triCount; t += stride) {
      out[o++] = src[t * 3]!;
      out[o++] = src[t * 3 + 1]!;
      out[o++] = src[t * 3 + 2]!;
    }
    return {
      vertices: merged.vertices,
      indices: o === out.length ? out : out.slice(0, o),
      normals: merged.normals,
      uvs: merged.uvs,
      colors: merged.colors,
      getBoundingVolume: (): BoundingVolume => BoundingBox.fromVertices(merged.vertices),
    };
  }

  /** HUD `F` toggle: flips the live wind state and re-arms the system immediately (no re-create,
   *  no pop on re-enable — the wind field keeps advancing while off). */
  private _toggleWindLive(): void {
    if (this._windField === undefined) return;
    this._windLive = !this._windLive;
    this._applyWindState();
  }

  /**
   * HUD `L` toggle (P2, ADR 0059 step 2): cycles the field lane through the DECISIVE MODE SWITCH
   * (moderator 2026-11-10) — `off` (explicit P1-identical opt-in) → `hysteresis` (the decided
   * engine zero-config default) → `dither` → `dither-hysteresis`. Each mode is ONE declarative
   * strategy applied live via
   * {@link InstanceFieldSystem.setLodTransitionMode} (band/hysteresis take effect on the next cull
   * frame; the dither gate patches this frame). `?lodMode=` preselects the mode at startup.
   */
  private _toggleLodMode(): void {
    const order: readonly LodTransitionMode[] = [
      "off",
      "hysteresis",
      "dither",
      "dither-hysteresis",
    ];
    const next = order[(order.indexOf(this._lodMode) + 1) % order.length]!;
    this._applyLodMode(next);
  }

  /** Applies ONE {@link LodTransitionMode} live and mirrors its derived knobs for MEASURE/HUD. */
  private _applyLodMode(mode: LodTransitionMode): void {
    this._lodMode = mode;
    this._fieldSystem?.setLodTransitionMode(mode);
  }

  /**
   * Merges the tree's parts into ONE indexed geometry with the per-part `offsetY` baked into the
   * vertex positions (tree base stays at y=0), so the pull shader's pose yaw/scale reproduces the
   * autoinst/instanced lane transforms exactly. Deterministic part-major order; normals fall back
   * to world-up when a part lacks them, uvs to (0,0) — the P1 pulled shading reads position only.
   */
  private _mergeTreeGeometry(proto: TreePrototype): GeometryDataInterface {
    let vertexCount = 0;
    let indexCount = 0;
    for (const part of proto.parts) {
      const geo = part.geometry;
      vertexCount += geo.vertices.length / 3;
      indexCount += geo.indices?.length ?? 0;
    }
    if (vertexCount === 0 || indexCount === 0) {
      throw new Error("[Showcase51] field lane needs non-empty indexed tree geometry");
    }
    const vertices = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    // Field colour stream: linear albedo of each part's material + foliage mask in alpha (the
    // V1 field draws one merged mesh per bucket, so per-part materials travel per vertex).
    const colors = new Float32Array(vertexCount * 4);
    // Species mode: white albedo (the albedo array carries the colour), layer = part ordinal.
    const species = this._species;
    const materialLayers = species ? new Float32Array(vertexCount) : undefined;
    let vo = 0;
    let io = 0;
    let partIndex = 0;
    for (const part of proto.parts) {
      const geo = part.geometry;
      const partVertexCount = geo.vertices.length / 3;
      for (let v = 0; v < partVertexCount; v++) {
        const dest = (vo + v) * 3;
        vertices[dest] = geo.vertices[v * 3]!;
        vertices[dest + 1] = geo.vertices[v * 3 + 1]! + part.offsetY;
        vertices[dest + 2] = geo.vertices[v * 3 + 2]!;
        if (geo.normals) {
          normals[dest] = geo.normals[v * 3]!;
          normals[dest + 1] = geo.normals[v * 3 + 1]!;
          normals[dest + 2] = geo.normals[v * 3 + 2]!;
        } else {
          normals[dest + 1] = 1;
        }
      }
      if (geo.uvs) {
        uvs.set(geo.uvs, vo * 2);
      }
      const c = part.material.color;
      const r = GltfMaterialParser.engineSRGBToLinear(c.r);
      const g = GltfMaterialParser.engineSRGBToLinear(c.g);
      const b = GltfMaterialParser.engineSRGBToLinear(c.b);
      // Foliage = the green-dominant part (the asset contract carries no material names);
      // species mode takes the mask from the sidecar.
      const layer = species?.layers[partIndex];
      const foliage = layer ? layer.foliage : g > r ? 1 : 0;
      for (let v = 0; v < partVertexCount; v++) {
        const dest = (vo + v) * 4;
        colors[dest] = layer ? 1 : r;
        colors[dest + 1] = layer ? 1 : g;
        colors[dest + 2] = layer ? 1 : b;
        colors[dest + 3] = foliage;
      }
      if (materialLayers) materialLayers.fill(partIndex, vo, vo + partVertexCount);
      partIndex++;
      const partIndices = geo.indices!;
      for (let i = 0; i < partIndices.length; i++) {
        indices[io + i] = partIndices[i]! + vo;
      }
      vo += partVertexCount;
      io += partIndices.length;
    }
    return {
      vertices,
      indices,
      normals,
      uvs,
      colors,
      ...(materialLayers ? { materialLayers } : {}),
      getBoundingVolume: (): BoundingVolume => BoundingBox.fromVertices(vertices),
    };
  }

  /** Conservative per-instance cull radius at scale 1 = farthest vertex distance from the tree
   *  base × 1.1 margin, 2 m floor. Overdraw (FP) is allowed, false negatives are forbidden
   *  (IF-CULL-NO-FALSE-NEGATIVE) — the radius scales with the pose scale in every lane. */
  private _treeBoundingRadius(geo: GeometryDataInterface): number {
    let maxR2 = 0;
    const v = geo.vertices;
    for (let i = 0; i < v.length; i += 3) {
      const r2 = v[i]! * v[i]! + v[i + 1]! * v[i + 1]! + v[i + 2]! * v[i + 2]!;
      if (r2 > maxR2) maxR2 = r2;
    }
    return Math.max(Math.sqrt(maxR2) * 1.1, 2);
  }

  /** Crown-top height of the merged geometry (max vertex y, base at y=0) — wind profile
   *  normalizer at scale 1. 0 only for a degenerate flat geometry (wind stays off then). */
  /** Canopy coverage map of the tree records: crown radius = the merged tree's widest XZ extent
   *  (scale 1), crown top = tree height x mean instance scale. */
  private _buildCanopy(
    records: Float32Array,
    merged: GeometryDataInterface,
    treeHeight: number,
  ): FieldCanopy {
    const v = merged.vertices;
    let crown = 0;
    for (let i = 0; i < v.length; i += 3) crown = Math.max(crown, Math.hypot(v[i]!, v[i + 2]!));
    const count = records.length / 4;
    const bits = new Uint32Array(records.buffer, records.byteOffset, records.length);
    const pose = { yawRadians: 0, uniformScale: 0 };
    let scaleSum = 0;
    for (let i = 0; i < count; i++) {
      unpackInstancePose(bits[i * 4 + 3]!, pose);
      scaleSum += pose.uniformScale;
    }
    const map = buildCanopyCoverage(records, count, {
      crownRadius: Math.max(0.5, crown * CANOPY_CROWN_FILL),
      cellSize: CANOPY_CELL_SIZE,
    });
    return {
      ...map,
      ambientFloor: CANOPY_AMBIENT_FLOOR,
      canopyHeight: treeHeight * (count > 0 ? scaleSum / count : 1),
    };
  }

  private _treeMaxHeight(geo: GeometryDataInterface): number {
    let maxY = 0;
    const v = geo.vertices;
    for (let i = 1; i < v.length; i += 3) {
      if (v[i]! > maxY) maxY = v[i]!;
    }
    return maxY;
  }

  /** Packs the population into 16-B frozen records (4×f32): xyz position + the packed u32 pose
   *  stored as the f32 whose bit pattern equals it — `field_pull.wgsl` reads `bitcast<u32>(record.w)`. */
  private _buildFieldRecords(instances: readonly ScatterInstance[]): Float32Array {
    const records = new Float32Array(instances.length * 4);
    const speciesScale = this._species !== undefined ? SPECIES_TREE_SCALE : 1;
    const poseF = new Float32Array(1);
    const poseU32 = new Uint32Array(poseF.buffer);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      records[i * 4] = inst.x;
      records[i * 4 + 1] = 0;
      records[i * 4 + 2] = inst.z;
      poseU32[0] = packInstancePose(inst.yaw, inst.scale * speciesScale);
      records[i * 4 + 3] = poseF[0]!;
    }
    return records;
  }

  /** Probe callback: keeps the latest optical cull frame and, on `?cullref=1`, runs the pure-CPU
   *  conservative reference against the EXACT mirror planes of the same frame. */
  private _onFieldCullFrame(sets: FieldVisibleSets): void {
    this._lastProbeSet = sets;
    if (this._cullref) {
      this._runCullReference(sets);
    }
  }

  /**
   * CPU-side dual-lane reference (frozen core math only, `?cullref=1`): tests every record's
   * conservative sphere against the GPU frame's EXACT mirror frustum planes and mirrors the
   * sub-pixel size gate with `projectedDiameterPixels` (camera eye = the showcase camera, so the
   * distance is exact for this frame). `expectedKeep` is what the GPU MUST draw when occlusion
   * is off — any unexplained drop is a false negative (IF-CULL-NO-FALSE-NEGATIVE live check).
   * With HZB on, the residual is reported as occlusion drops (the legitimate mode-B path).
   */
  private _runCullReference(sets: FieldVisibleSets): void {
    const params0 = sets.params[0];
    const records = this._fieldRecords;
    if (params0 === undefined || records === undefined) return;
    const planes = params0.frustumPlanes;
    const cam = this.camera.position;
    const viewport = params0.viewportHeightPx;
    const fov = params0.fovRadiansY;
    let frustumKeep = 0;
    let sizeDropped = 0;
    let expectedKeep = 0;
    for (let i = 0; i < records.length; i += 4) {
      const cx = records[i]!;
      const cy = records[i + 1]!;
      const cz = records[i + 2]!;
      this._poseBits[0] = records[i + 3]!;
      unpackInstancePose(this._poseWord[0]!, this._poseOut);
      const radius = this._fieldBoundingRadius * this._poseOut.uniformScale;
      if (!sphereVisibleConservative(planes, [cx, cy, cz], radius)) continue;
      frustumKeep++;
      const dx = cx - cam.x;
      const dy = cy - cam.y;
      const dz = cz - cam.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (projectedDiameterPixels(radius, dist, viewport, fov) < this._fieldCullPixelSize) {
        sizeDropped++;
        continue;
      }
      expectedKeep++;
    }
    const gpu = this._segmentCount(sets, 0, 0);
    const unexplained = Math.max(0, expectedKeep - gpu);
    this._lastCpuTotal = expectedKeep;
    this._lastCullVerdict =
      unexplained === 0
        ? `ok(frustum=${frustumKeep},size=${sizeDropped},cpu=${expectedKeep},gpu=${gpu})`
        : `unexplained=${unexplained}(frustum=${frustumKeep},size=${sizeDropped},cpu=${expectedKeep},gpu=${gpu},occlusion=${this._occlusionMode !== "a" ? "on" : "off"})`;
  }

  /** Reads ONE segment's survivor count from a probed frame (`-1` when the segment is absent). */
  private _segmentCount(sets: FieldVisibleSets, viewIndex: number, bucketIndex: number): number {
    for (const seg of sets.segmentCounts) {
      if (seg.viewIndex === viewIndex && seg.bucketIndex === bucketIndex) return seg.count;
    }
    return -1;
  }

  /** Releases the registered field system (renderer list + GPU state) on destroy. */
  private _unregisterFieldLane(): void {
    if (this._fieldSystem === undefined) return;
    if (this.renderer instanceof WebGPURenderer) {
      this.renderer.unregisterInstanceField(this._fieldSystem);
    }
    this._fieldSystem.dispose();
    this._fieldSystem = undefined;
    // Ground-cover ring (second field system) releases with the same fan-out.
    for (const layer of this._coverLayers) {
      if (this.renderer instanceof WebGPURenderer) {
        this.renderer.unregisterInstanceField(layer.system);
      }
      layer.system.dispose();
    }
    this._coverLayers = [];
  }

  /**
   * Camera-override hook (S1 contract with Charly's camera-path sampler). Once called, the
   * showcase applies exactly this pose every frame before rendering and ignores the orbit
   * controller for the rest of the session. Call on every frame from an external path sampler.
   */
  public setExternalCameraPose(position: Vector3D, target: Vector3D): void {
    this._externalCameraActive = true;
    this._externalCameraPos.copyFrom(position);
    this._externalCameraTarget.copyFrom(target);
  }

  /**
   * Hands the HUD its keys (1/2/3 path switch, I/H panel toggle) before the showcase defaults;
   * everything unconsumed falls through to the stock shortcuts (renderer switch, R reset).
   */
  protected override onKeyDown(event: KeyboardEvent): void {
    if (this._hud !== undefined && this._hud.handleKey(event)) return;
    super.onKeyDown(event);
  }

  public override destroy(): void {
    this._hud?.dispose();
    this._hud = undefined;
    this._golden?.dispose();
    this._golden = undefined;
    this._unregisterFieldLane();
    super.destroy();
  }

  protected override update(deltaTime: number): void {
    // ADR 0059 step 6a: `?look=auto` follows the canopy above the camera (eased, cheap).
    if (this._look === "auto" && this.renderer.postProcessing.enabled) {
      this._updateAutoLook(deltaTime);
    }
    // ADR 0059 step 1b: advance the field-lane wind field every frame (zero-GC typed-array
    // rewrite); the system forwards the block at the next main-view prepare. Other lanes stay
    // static in V1 (autoinst/instanced wind is a cross-tier material-shader change, documented).
    if (this._mode === "field") {
      this._windField?.update(deltaTime);
    }
    // Camera-path rig: advance the loop by real seconds unless frozen via `?pausedAt=`, then
    // override the pose (the path is the only motion source once active; zero heap allocations).
    if (this._pathCam !== undefined && this._externalCameraActive) {
      if (this._pausedAt === undefined) {
        const duration = Math.max(0.001, this._pathCam.durationSeconds);
        this._pathT += deltaTime / duration;
      }
      this._applyPathPose();
      // S2 `?occlusion=c` (IF-CAMERA-CUT-HZB-SKIP live exercise): deterministic hard camera cuts
      // every `?cutEvery=` sampled frames arm the one-frame HZB skip through the renderer's
      // teleport fan-out. The jump lands before the frame renders, so the cull coordinator sees
      // the new (distant) pose with the skip armed.
      if (
        this._mode === "field" &&
        this._occlusionMode === "c" &&
        this._isAutomated &&
        this._state === "sampling"
      ) {
        this._cutAccum++;
        if (this._cutAccum >= this._cutEvery) {
          this._cutAccum = 0;
          this._pathT = (this._pathT + CUT_T_JUMP) % 1;
          this._applyPathPose();
          this._teleportCount++;
          (this.renderer as WebGPURenderer).notifyCameraTeleport(this.scene);
        }
      }
    }

    // External camera sampler overrides the pose every frame (zero allocation, copied vectors).
    if (this._externalCameraActive) {
      this.camera.position.copyFrom(this._externalCameraPos);
      this.camera.target.copyFrom(this._externalCameraTarget);
      this.camera.updateViewMatrix();
    }

    // ADR 0059 step 1b, source B: regenerate the camera-centred ground-cover ring from the CURRENT
    // camera position and feed the new records into the second field system via the engine's
    // zero-GC `uploadRecords()` live path. This must run BEFORE the renderer's field pass records
    // the frame's cull/draws (showcase `update()` precedes the render), so the GPU lane always
    // consumes the current ring bytes. Stable per-tile hashes keep blades glued to the world —
    // the ring follows the camera, blades never swim under it. Only the WRITTEN prefix is fed
    // (`subarray` is a zero-copy view sized to the live count; a full-capacity upload would draw
    // the zero tail as a 67k-blob at the origin).
    // Re-generated only after the camera moved `COVER_UPDATE_STEP` m: blade positions are
    // world-glued, only the distance thinning drifts, so a still/slow camera skips the CPU ring
    // rebuild + record upload (the dominant CPU cost at high clump density).
    if (this._coverLayers.length > 0) {
      const cx = this.camera.position.x;
      const cz = this.camera.position.z;
      const mx = cx - this._coverLastX;
      const mz = cz - this._coverLastZ;
      if (mx * mx + mz * mz >= COVER_UPDATE_STEP * COVER_UPDATE_STEP) {
        this._coverLastX = cx;
        this._coverLastZ = cz;
        for (const layer of this._coverLayers) {
          layer.cover.update(cx, cz);
          layer.system.setPopulationData(layer.cover.records.subarray(0, layer.cover.count * 4));
          layer.system.uploadRecords();
        }
      }
    }

    // `?truth=1` ground-truth mode: signal readiness once after the first full frame. Today the
    // scene IS the truth (no LOD/culling optimizations exist); P1+ must gate this flag on the
    // un-optimized path.
    if (this._isTruth && !this._truthSignalled) {
      this._truthSignalled = true;
      (window as unknown as { __vegTruthReady?: boolean }).__vegTruthReady = true;
    }

    // Interactive HUD refresh (~4 Hz); the HUD exists only outside hud-free/qa modes.
    if (this._hud !== undefined) {
      this._hudAccum += deltaTime;
      if (this._hudAccum >= 0.25) {
        this._hudAccum = 0;
        this._pushHudStats(deltaTime);
      }
    }

    // Automated measurement sequence (`?frames=` / `?measure`), showcase-44 pattern.
    if (this._state === "idle" || this._state === "done") return;

    if (this._state === "warmup") {
      this._warmupFrames++;
      if (this._warmupFrames < WARMUP_FRAMES) return;
      this._state = "sampling";
      this._startMs = performance.now();
      this._lastSampleMs = this._startMs;
      this._writeStatus(`sampling 0/${this._targetFrames}`);
      return;
    }

    const now = performance.now();
    this._frameTimesMs.push(now - this._lastSampleMs);
    this._lastSampleMs = now;
    this._sampledFrames++;
    if (this._sampledFrames % 20 === 0) {
      this._writeStatus(`sampling ${this._sampledFrames}/${this._targetFrames}`);
    }
    if (this._sampledFrames >= this._targetFrames) {
      this._finalize();
    }
  }

  /** Pushes the live telemetry into the HUD (called at ~4 Hz, never on the 1/60-s hot path). */
  private _pushHudStats(deltaTime: number): void {
    const stats: VegHudStats = {
      instances: this._treeCount,
      mode: this._mode,
      fps: deltaTime > 0 ? 1 / deltaTime : -1,
      cpuMs: this.lastCpuTimeMs,
      gpuMs: -1,
      // Field lane + `?cullref=1`: expose the CPU-reference visible total (probe-driven); all
      // other lanes keep the honest -1 (no per-frame visibility source in baseline mode).
      visible: this._mode === "field" && this._cullref ? this._lastCpuTotal : -1,
      triangles: -1,
      // Live wind state (field lane; false on every other lane / windless geometry).
      wind: this._windField !== undefined && this._windLive,
      // Ground-cover ring instances (field lane source B; 0 when inactive).
      cover: this._coverInstanceCount(),
      // Live TAA state (`?taa=1`) — the dither-mode sighting display condition.
      taa: this._taaLive,
      // P2 LOD-transition live state (field lane only): the applied band/hysteresis/bias knobs
      // and — when a DECISIVE MODE SWITCH preset is armed — the mode name. Key omitted when the
      // field lane is inactive (`exactOptionalPropertyTypes` contract).
      ...(this._fieldSystem !== undefined
        ? {
            lod: {
              mode: this._lodMode,
              band: LOD_TRANSITION_MODES[this._lodMode].crossfadeBand,
              hyst: LOD_TRANSITION_MODES[this._lodMode].hysteresis,
              biasPx: 0,
            },
          }
        : {}),
    };
    this._hud?.sync(stats);
  }

  private _finalize(): void {
    this._state = "done";
    const wallMs = Math.max(0.001, performance.now() - this._startMs);
    const frames = this._sampledFrames;
    const result: MeasureResult = {
      rendererType: this.renderer.type,
      mode: this._mode,
      n: this._treeCount,
      seed: this._seed,
      source: this._prototype?.source ?? "unknown",
      prototype: this._prototype?.name ?? "unknown",
      partsPerTree: this._prototype?.parts.length ?? 0,
      sceneObjects: this._forestNodes.length,
      frames,
      wallMs: Math.round(wallMs),
      frameMs: wallMs / frames,
      avgFps: frames / (wallMs / 1000),
    };
    // Live TAA state (`?taa=1`) — renderer-wide, reported on every lane for gate tables.
    result.taa = this._taaLive ? 1 : 0;
    if (this._path !== undefined) {
      result.path = this._path;
    }
    if (this._frameTimesMs.length > 0) {
      result.frameTimesMs = this._frameTimesMs;
    }
    // S2 field-lane diagnostics (`?mode=field`): instance count, occlusion mode, teleports and —
    // when the opt-in dual-lane audit is on — the last RESOLVED probe frame's survivor counts
    // plus the CPU-reference verdict. The probe fires once per culled frame via the renderer's
    // own readback; `_lastProbeSet` therefore refers to a recent frame, never the very last one
    // (no CPU readback stall on the render path, ADR 0059).
    if (this._mode === "field" && this._fieldSystem !== undefined) {
      result.fieldInstances = this._fieldSystem.instanceCount;
      result.fieldOcclusionMode = this._occlusionMode;
      result.fieldShading = "lambert-csm";
      // Field-lane geometry-chain source (both values reported); `lodTris` only for real LODs.
      result.lodSource = this._lodSource;
      if (this._lodSource === "reallod" && this._realLodTris.length === 4) {
        result.lodTris = [...this._realLodTris];
      }
      // Live wind state (URL knob or HUD toggle) — the honest isolation flag for cost tables.
      result.wind = this._windField !== undefined && this._windLive ? 1 : 0;
      // Ground-cover ring (ADR 0059 step 1b, source B): live record count + ring knobs.
      if (this._coverLayers.length > 0) {
        result.coverInstances = this._coverInstanceCount();
        result.coverRadius = this._coverRadius;
        result.coverDensity = this._coverDensity;
      }
      if (this._teleportCount > 0) {
        result.fieldTeleports = this._teleportCount;
      }
      if ((this._popcount || this._cullref) && this._lastProbeSet !== undefined) {
        const gpuPerBucket: { viewIndex: number; bucketIndex: number; count: number }[] = [];
        for (const seg of this._lastProbeSet.segmentCounts) {
          gpuPerBucket.push({
            viewIndex: seg.viewIndex,
            bucketIndex: seg.bucketIndex,
            count: seg.count,
          });
        }
        const audit: {
          gpuPerBucket: { viewIndex: number; bucketIndex: number; count: number }[];
          cpuTotal?: number;
          cullrefVerdict?: string;
          teleports: number;
        } = { gpuPerBucket, teleports: this._teleportCount };
        if (this._cullref) {
          audit.cpuTotal = this._lastCpuTotal;
          audit.cullrefVerdict = this._lastCullVerdict;
        }
        result.populationAudit = audit;
      }
    }
    // `?gputimings=1` diagnostic: attach the last resolved timing frame of the ring (if any).
    if (this._gpuTimer !== undefined && this._gpuTimer.enabled) {
      const snap = this._gpuTimer.snapshot;
      if (snap.frameIndex >= 0 && snap.segments.length > 0) {
        let total = 0;
        const passes: Record<string, number> = {};
        for (const segment of snap.segments) {
          passes[segment.name] = segment.ms;
          total += segment.ms;
        }
        result.gpuMs = total;
        result.gpuPassesMs = passes;
      }
    }
    const message = `MEASURE ${JSON.stringify(result)}`;
    this._writeStatus(message);
    console.info(`[Showcase MEASURE] ${JSON.stringify(result)}`);
  }

  /** Minimal measurement overlay (showcase-44 shape); skipped in `?qa=1` headless mode. */
  private _writeStatus(message: string): void {
    if (this._isQa) return;
    let overlay = document.getElementById("__measure");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "__measure";
      overlay.style.cssText =
        "position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,.78);" +
        "color:#0f0;font:12px/1.4 ui-monospace,Menlo,monospace;padding:6px 10px;border-radius:4px;" +
        "white-space:pre-wrap;max-width:72vw;pointer-events:none;";
      document.body.appendChild(overlay);
    }
    overlay.textContent = message;
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase51] Failed to start:", err));
