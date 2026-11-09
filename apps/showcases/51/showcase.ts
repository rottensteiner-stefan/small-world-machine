import type { EngineOptions, GeometryDataInterface, GpuTimer } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cone,
  Cylinder,
  DirectionalLight,
  Fog,
  FogMode,
  GltfLoader,
  GltfMaterialParser,
  Ground,
  InstancedMesh,
  Matrix4,
  Object3D,
  RendererType,
  StandardMaterial,
  Vector3D,
  WebGPURenderer,
} from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import { BoundingBox } from "@small-world-machine/engine/physix/BoundingBox.js";
import type { BoundingVolume } from "@small-world-machine/engine/interfaces/BoundingVolume.js";
import {
  MAX_LOD_BUCKETS,
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
  PrototypeDescriptor,
} from "@small-world-machine/engine/core/InstanceField.js";
import { InstanceFieldSystem } from "@small-world-machine/engine/renderers/WebGPU/managers/InstanceFieldSystem.js";
import { GroundCover, WindField } from "@small-world-machine/vegetation-extras";
import { getCameraPath, type CameraPath, type PathName } from "./CameraPaths.js";
import { Hud, hudFreeMode, type HudGpuTimings, type VegHudStats } from "./Hud.js";
import { GoldenSession, lookupOwn, parseGoldenSpec } from "../shared/GoldenCapture.js";

// P2 engine-surface note (ADR 0059 step 2): the app compiles against the PACKAGE export, which
// resolves the node_modules link (the merged engine's P1 surface in this worktree) — the
// worktree engine's additive P2 surface is NOT visible here. The local intersections below
// declare that NEW surface so the showcase type-checks against the P1 base; post-merge they
// coincide with the real API. The optional-typed members keep calls inert when a host engine
// predates P2 (no-op, fail-closed).
/** P2 additive `InstanceFieldOptions` (worktree engine only; absent on the P1 package export).
 * Extends the PARTIAL options shape because the showcase setup passes a subset (the engine
 * fills `prototypes`/`cpuBudget`/`populationMode` defaults internally). */
interface P2FieldOptions extends Partial<InstanceFieldOptions> {
  lodCrossfadeBand?: number;
  lodHysteresis?: number;
  lodBiasPx?: number;
}
/** P2 additive runtime API of `InstanceFieldSystem` (worktree engine only). */
interface P2FieldLodApi {
  setLodTransition?: (opts: {
    crossfadeBand?: number;
    hysteresis?: number;
    biasPx?: number;
  }) => void;
  setLodDitherMode?: (mode: "crossfade" | "hard") => void;
}

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
 *   `?coverDensity=N`              ring blade density in blades/m² (clamped to 8; default 0.5)
 *   `?coverRadius=N`               ring outer radius in metres (clamped to [20, 400]; default 160)
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
 *   `?mode=autoinst|instanced|field`   scatter lane (default `autoinst`; `field` = ADR 0059 P1 lane)
 *   `?n=N`                       tree budget (default 20000; clamps to [0, 2000000]; `?n=0` empties the population)
 *   `?seed=S`                    scatter seed (default 51; deterministic per (n, seed))
 *   `?shadows=off`               disable the sun's shadow casting (pass isolation for benches)
 *   `?frames=N`                  automated run: N sampled frames after a 30-frame warm-up,
 *                                then the `MEASURE` line is emitted once (default 240)
 *   `?measure`                   same as `?frames=240` (automated-mode synonym)
 *   `?qa=1`                      stable headless-capture mode: fixed camera, no overlay/chrome
 *   `?path=walk|flight|aerial`   seeded camera path (P0-4, `CameraPaths.ts`); freezes the default
 *                                fly camera and drives `setExternalCameraPose` every frame.
 *                                `flight` is the fast, pop-sensitive path of the ADR 0059 step-2 gate.
 *   `?pausedAt=<t>`              freeze the camera at `sample(t)` of the active path (loop stops;
 *                                used by veg-bench keyframe shots + truth captures; capture mode
 *                                = HUD-free, so the clipped shots/FLIP compare stay clean)
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
const DEFAULT_FRAMES = 240;
const WARMUP_FRAMES = 30;
/** S2 `?occlusion=c` teleport period in sampled frames (IF-CAMERA-CUT-HZB-SKIP live exercise). */
const DEFAULT_CUT_EVERY = 60;
/** S2 `?occlusion=c`: each hard cut advances the path by this loop fraction (deterministic). */
const CUT_T_JUMP = 0.18;
/** S2 field lane: sub-pixel cull gate in px (frozen `cullPixelSize` must sit below the band floor). */
const FIELD_CULL_PIXEL_SIZE = 2;
// P2 (ADR 0059 step 2, Bob veg-p2): LOD-transition demo knobs of the field lane. The tree
// prototype now authors THREE ascending projected-size buckets (coarse proxy -> mid proxy ->
// full merged tree) and the cull crossfade band / hysteresis / tier bias / shadow coarsening
// are demo-tuned via URL. Absent knobs stay on the ENGINE fail-closed defaults (band 0 =
// P1-identical single routing) unless the showcase opts in below.
/** Default (demo) band width as a fraction of each threshold (opt-in; `?lodband=` overrides). */
const DEFAULT_LOD_BAND = 0.12;
/** Default per-instance hysteresis jitter fraction (`?lodhyst=` overrides; 0 = none). */
const DEFAULT_LOD_HYSTERESIS = 0;
/** Default shadow-view coarsening offset in LOD levels (0 = reuse the main camera's choice). */
const DEFAULT_SHADOW_LOD_BIAS = 0;
/** Authored ascending bucket maxima in px (near=detail: bucket 0 = farthest = coarsest). */
const FIELD_LOD_MAXIMA_PX: readonly number[] = [24, 96, 1e6];
/** Load-time triangle-stride decimation per proxy bucket (bucket 0 = stride 3, bucket 1 = 2). */
const FIELD_LOD_PROXY_STRIDE: readonly number[] = [3, 2];
/** S2 field lane: population grid cell edge in meters (cells drive the CPU/GL cell fallback). */
const FIELD_CELL_SIZE = 12;
/** Leaf transmission tint of the field lane (sRGB, same value as showcase 52's leaves). */
const FIELD_LEAF_BACKLIGHT: readonly [number, number, number] = [0.55, 0.72, 0.2];
// ADR 0059 step 1b, source B: camera-centred ground-cover ring constants. The grass card is REAL
// tapered geometry (two crossed blade pairs) authored at `COVER_BLADE_HEIGHT` — no alpha-cutout
// texture in V1, so the proven merged-geometry field path applies unchanged.
/** Grass-card blade height in metres at uniform scale 1 (the pulled bend's wind-height base). */
const COVER_BLADE_HEIGHT = 0.5;
/** Ground-cover ring default outer radius (m) and blade density (blades per m²). */
const COVER_DEFAULT_RADIUS = 160;
const COVER_DEFAULT_DENSITY = 0.5;
/** Ground-cover tile edge (m); the ring's per-tile hash cells. */
const COVER_TILE_CELL = 5;
/** sRGB albedo of the grass base / tip vertices (converted to linear at geometry build). */
const COVER_ALBEDO_BASE: readonly [number, number, number] = [0.3, 0.47, 0.22];
const COVER_ALBEDO_TIP: readonly [number, number, number] = [0.42, 0.56, 0.26];
/** Foliage-mask alpha of the base / tip vertices (leaf-backlight transmission weighting). */
const COVER_ALPHA_BASE = 1;
const COVER_ALPHA_TIP = 0.85;
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
  private _cover: GroundCover | undefined = undefined;
  private _coverSystem: InstanceFieldSystem | undefined = undefined;
  /** `?cover=0` disables the ground-cover ring; default on (field lane only). */
  private readonly _coverEnabled: boolean;
  /** `?coverDensity=` blades per m² (clamped); default `COVER_DEFAULT_DENSITY`. */
  private readonly _coverDensity: number;
  /** `?coverRadius=` ring outer radius in metres (clamped); default `COVER_DEFAULT_RADIUS`. */
  private readonly _coverRadius: number;
  // P2 (ADR 0059 step 2): LOD-transition demo knobs of the field lane (URL `?lodband=`,
  // `?lodhyst=`, `?lodbias=`, `?shadowlod=`; absent = engine fail-closed defaults). Passed into
  // the `InstanceFieldSystem` options at build and demo-tunable live via the HUD LOD section.
  private readonly _lodBand: number;
  private readonly _lodHysteresis: number;
  private readonly _lodBiasPx: number;
  private readonly _shadowLodBias: number;
  /** P2 APPLIED LOD knobs of the tree field (mirror of the URL knobs; the HUD LOD section reads
   *  and live-toggles these via {@link InstanceFieldSystem.setLodTransition}). */
  private _fieldLodBand = 0;
  private _fieldLodHysteresis = 0;
  private _fieldLodBiasPx = 0;
  /** P2 candidate-C live state: `true` = the HUD `L` toggle pinned the lane to a hard switch
   *  (band 0 + fragment dither off), `false` = crossfade band (candidate A). */
  private _lodHard = false;
  /** Scale-1 blade height cached at cover build — the re-arm height for live `setWind`. */
  private _coverWindHeight = 0;
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
    const params = new URLSearchParams(window.location.search);

    const mode = params.get("mode");
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
    let targetCount = DEFAULT_INSTANCE_COUNT;
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

    this._isAutomated = params.has("frames") || params.has("measure");
    this._isQa = params.get("qa") === "1";
    this._shadowsOn = params.get("shadows") !== "off";
    // ADR 0059 step 1b: field-lane wind on by default; `?wind=0` disables it for cost isolation.
    // `_windLive` mirrors the knob at startup; the HUD toggle can flip it at runtime.
    this._windEnabled = params.get("wind") !== "0";
    this._windLive = this._windEnabled;
    // ADR 0059 step 1b: ground-cover ring knobs (field lane only; absent params stay on defaults,
    // same guard discipline as `?n=` above — `?coverDensity=` without a value is a no-op).
    this._coverEnabled = params.get("cover") !== "0";
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

    // P2 (ADR 0059 step 2): LOD-transition knobs (field lane only). Fractions clamp into [0,1];
    // `?lodbias=`/`?shadowlod=` are unaudited numbers. Same `params.has(...)` guard discipline
    // as `?n=` above — an absent knob MUST stay on the engine fail-closed default (band 0).
    const rawLodBand = Number(params.get("lodband"));
    this._lodBand =
      params.has("lodband") && Number.isFinite(rawLodBand)
        ? Math.min(1, Math.max(0, rawLodBand))
        : DEFAULT_LOD_BAND;
    const rawLodHyst = Number(params.get("lodhyst"));
    this._lodHysteresis =
      params.has("lodhyst") && Number.isFinite(rawLodHyst)
        ? Math.min(1, Math.max(0, rawLodHyst))
        : DEFAULT_LOD_HYSTERESIS;
    const rawLodBias = Number(params.get("lodbias"));
    this._lodBiasPx = params.has("lodbias") && Number.isFinite(rawLodBias) ? rawLodBias : 0;
    const rawShadowLod = Number(params.get("shadowlod"));
    this._shadowLodBias =
      params.has("shadowlod") && Number.isFinite(rawShadowLod) && rawShadowLod > 0
        ? Math.min(MAX_LOD_BUCKETS - 1, Math.floor(rawShadowLod))
        : DEFAULT_SHADOW_LOD_BIAS;

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
    ground.geometry = new Ground({ width: 240, depth: 240 }).getGeometryData();
    ground.material = new StandardMaterial({
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
    const instances = scatterTrees(this._targetCount, this._seed);
    this._treeCount = instances.length;
    if (this._mode === "autoinst") {
      this._buildAutoInstances(instances, this._prototype);
    } else if (this._mode === "field") {
      // WebGPU-only lane; a non-WebGPU `?mode=field` falls back to `autoinst` (documented).
      if (this._buildFieldLane(instances, this._prototype)) {
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
   * Tries the expected asset names in order and returns the first prototype that loads. If none
   * loads (assets absent mid-development), logs the fallback and returns the procedural
   * placeholder — both lanes keep the baseline runnable and reproducible.
   */
  private async _loadPrototype(): Promise<TreePrototype> {
    const loader = new GltfLoader({ basePath: "./assets/" });
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
  private _buildFieldLane(instances: readonly ScatterInstance[], proto: TreePrototype): boolean {
    if (!(this.renderer instanceof WebGPURenderer)) {
      console.info("[Showcase51] ?mode=field needs WebGPU — falling back to the autoinst lane");
      return false;
    }
    if (instances.length === 0) {
      return false;
    }
    const merged = this._mergeTreeGeometry(proto);
    const radius = this._treeBoundingRadius(merged);
    // P2 (ADR 0059 step 2): load-time stepped LOD proxies of the merged tree. Bucket index
    // ASCENDS with projected diameter (near=detail), and geometry is bound by bucket index —
    // so the COARSEST proxy sits at bucket 0 (farthest tier), the FULL tree at the highest
    // index. The gaps between `FIELD_LOD_MAXIMA_PX` bytes are where the cull's (URL-tuned)
    // crossfade band dual-writes adjacent {coarse, fine} pairs with DISTINCT geometry.
    const coarse = this._buildLodProxyGeometry(merged, FIELD_LOD_PROXY_STRIDE[0]!);
    const mid = this._buildLodProxyGeometry(merged, FIELD_LOD_PROXY_STRIDE[1]!);
    const bands: LodBucketDescriptor[] = [
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
    this._fieldLodBand = this._lodBand;
    this._fieldLodHysteresis = this._lodHysteresis;
    this._fieldLodBiasPx = this._lodBiasPx;

    // ADR 0059 step 1b: shared wind field for the field lane. A gentle forest breeze with
    // travelling gust fronts + calm phases (the reference-demo critique #1). `windHeight`
    // (crown top) is the vertical-profile / bend normalizer; scale-1 trees reach full wind.
    // The wind field is ALWAYS constructed here (kept advancing every frame), but its state is
    // applied to the system via `_applyWindState()` after registration — that makes the HUD
    // `F` toggle a pure live swap with no field re-creation and no wind-pop on re-enable.
    const windHeight = this._treeMaxHeight(merged);
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
    // P2 (ADR 0059 step 2): LOD-transition knobs (URL `?lodband=`/`?lodhyst=`/`?lodbias=`/
    // `?shadowlod=`; absent = engine fail-closed defaults). The cull selects the bucket and
    // the crossfade band through these; the HUD LOD section re-tunes them live. Typed via
    // `P2FieldOptions` (additive P2 surface, see the note above).
    const lodOptions: P2FieldOptions = {
      cellSize: FIELD_CELL_SIZE,
      maxInstances: instances.length,
      cullPixelSize: FIELD_CULL_PIXEL_SIZE,
      maxViews: 4,
      lodCrossfadeBand: this._lodBand,
      lodHysteresis: this._lodHysteresis,
      lodBiasPx: this._lodBiasPx,
      shadowLodBias: this._shadowLodBias,
    };
    const system = new InstanceFieldSystem(null, {
      instanceRecords: records,
      prototypes: [prototype],
      geometryTable: [[coarse, mid, merged]],
      options: lodOptions,
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
        `, LOD band=${this._lodBand.toFixed(2)} hyst=${this._lodHysteresis.toFixed(2)} ` +
        `bias=${this._lodBiasPx.toFixed(1)}px shadow=${this._shadowLodBias}`,
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
    const cell = COVER_TILE_CELL;
    const cover = new GroundCover({
      radius: this._coverRadius,
      cellSize: cell,
      bladesPerTile: Math.max(1, Math.round(this._coverDensity * cell * cell)),
      seed: this._seed + 1000,
      fullDensityRadius: Math.min(140, this._coverRadius * 0.4),
      minDensity: 0.3,
      cameraClearRadius: 2,
      scaleRange: [0.7, 1.8],
    });
    const merged = this._buildCoverGeometry();
    const prototype: PrototypeDescriptor = {
      id: "s51-cover",
      boundingRadius: COVER_BLADE_HEIGHT,
      lodBuckets: [
        {
          name: "L0",
          lodIndex: 0,
          minProjectedSize: FIELD_CULL_PIXEL_SIZE + 1,
          maxProjectedSize: 1e6,
          geometrySlot: 0,
        },
      ],
      materialSlot: 0,
      maxInstances: cover.capacity,
    };
    const system = new InstanceFieldSystem(null, {
      instanceRecords: cover.records,
      prototypes: [prototype],
      geometryTable: [[merged]],
      options: {
        cellSize: cell,
        maxInstances: cover.capacity,
        cullPixelSize: FIELD_CULL_PIXEL_SIZE,
        // Main view only: grass never lands in the shadow-map passes (no shadow casting).
        maxViews: 1,
      },
      // NOTE: no `windUniforms`/`windHeight` — the shared tree wind block is applied below via
      // `_applyWindState()` (same gusts, grass height profile, honours the live `F` toggle).
    });
    try {
      this.renderer.registerInstanceField(system);
    } catch (error) {
      system.dispose();
      console.info(
        `[Showcase51] ground cover unavailable ` +
          `(${error instanceof Error ? error.message : String(error)}) — disabled`,
      );
      return false;
    }
    this._cover = cover;
    this._coverSystem = system;
    this._coverWindHeight = COVER_BLADE_HEIGHT;
    this._applyWindState();
    console.info(
      `[Showcase51] ground cover: capacity=${cover.capacity}, radius=${this._coverRadius} m, ` +
        `density=${this._coverDensity}/m², wind=${this._windLive ? "on" : "off"} (shared block)`,
    );
    return true;
  }

  /** Builds the grass-card geometry: TWO crossed tapered blade pairs (taller + shorter, 45°
   *  apart) so every instance reads as a small X-shaped tuft. REAL geometry — V1 deliberately
   *  skips alpha-cutout textures (no `alphaMap`): the proven merged-geometry field path applies
   *  unchanged, and the sub-pixel cull + distance thinning hide the hard silhouette. Normals are
   *  world-up (grass reads as ground-hugging, never edge-on-black), the colour stream carries
   *  linear green albedo (base darker, tip lighter) + foliage mask for leaf backlight. */
  private _buildCoverGeometry(): GeometryDataInterface {
    const h = COVER_BLADE_HEIGHT;
    // 10 unique vertices: [A0,A1,B0,B1,Tip1, C0,C1,D0,D1,Tip2]. Pair 1 spans world X resp. world
    // Z (crossed), pair 2 spans the two 45° diagonals — each base pair widens along the ground.
    const pos: number[] = [
      -0.09,
      0,
      0,
      0.09,
      0,
      0,
      0,
      0,
      -0.09,
      0,
      0,
      0.09,
      0,
      h,
      0,
      -0.0495,
      0,
      -0.0495,
      0.0495,
      0,
      0.0495,
      -0.0495,
      0,
      0.0495,
      0.0495,
      0,
      -0.0495,
      0,
      h * 0.62,
      0,
    ];
    const indices = new Uint32Array([0, 1, 4, 2, 3, 4, 5, 6, 9, 7, 8, 9]);
    const base = [
      GltfMaterialParser.engineSRGBToLinear(COVER_ALBEDO_BASE[0]!),
      GltfMaterialParser.engineSRGBToLinear(COVER_ALBEDO_BASE[1]!),
      GltfMaterialParser.engineSRGBToLinear(COVER_ALBEDO_BASE[2]!),
    ];
    const tip = [
      GltfMaterialParser.engineSRGBToLinear(COVER_ALBEDO_TIP[0]!),
      GltfMaterialParser.engineSRGBToLinear(COVER_ALBEDO_TIP[1]!),
      GltfMaterialParser.engineSRGBToLinear(COVER_ALBEDO_TIP[2]!),
    ];
    const vertexCount = pos.length / 3;
    const vertices = new Float32Array(pos);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 4);
    for (let v = 0; v < vertexCount; v++) {
      normals[v * 3 + 1] = 1;
      const isTip = v === 4 || v === 9;
      const tint = isTip ? tip : base;
      const alpha = isTip ? COVER_ALPHA_TIP : COVER_ALPHA_BASE;
      colors[v * 4] = tint[0]!;
      colors[v * 4 + 1] = tint[1]!;
      colors[v * 4 + 2] = tint[2]!;
      colors[v * 4 + 3] = alpha;
      uvs[v * 2] = 0.5;
      uvs[v * 2 + 1] = isTip ? 1 : 0;
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
    const coverSystem = this._coverSystem;
    if (coverSystem !== undefined && this._coverWindHeight > 0) {
      coverSystem.setWind(
        this._windLive ? field.uniforms : undefined,
        this._windLive ? this._coverWindHeight : 0,
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
   * HUD `L` toggle (P2, ADR 0059 step 2): cycles the field lane between candidate A (dither
   * crossfade band, URL knob) and candidate C (hard switch: band 0 + fragment dither off).
   * The re-tune is pushed LIVE via the P2 system API (`setLodTransition` / `setLodDitherMode`)
   * and takes effect on the next cull frame. Guarded through the `P2FieldLodApi` optional
   * surface — inert while the app runs against a host engine that predates P2.
   */
  private _toggleLodMode(): void {
    const system = this._fieldSystem;
    if (system === undefined) return;
    this._lodHard = !this._lodHard;
    if (this._lodHard) {
      // Candidate C: zero the band (cull hard-switches; hysteresis jitter still decorrelates).
      this._fieldLodBand = 0;
    } else {
      // Candidate A: re-arm the URL band (default when the URL knob is absent).
      this._fieldLodBand = this._lodBand;
    }
    (system as InstanceFieldSystem & P2FieldLodApi).setLodTransition?.({
      crossfadeBand: this._fieldLodBand,
      hysteresis: this._fieldLodHysteresis,
      biasPx: this._fieldLodBiasPx,
    });
    (system as InstanceFieldSystem & P2FieldLodApi).setLodDitherMode?.(
      this._lodHard ? "hard" : "crossfade",
    );
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
    let vo = 0;
    let io = 0;
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
      // Foliage = the green-dominant part (the asset contract carries no material names).
      const foliage = g > r ? 1 : 0;
      for (let v = 0; v < partVertexCount; v++) {
        const dest = (vo + v) * 4;
        colors[dest] = r;
        colors[dest + 1] = g;
        colors[dest + 2] = b;
        colors[dest + 3] = foliage;
      }
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
    const poseF = new Float32Array(1);
    const poseU32 = new Uint32Array(poseF.buffer);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      records[i * 4] = inst.x;
      records[i * 4 + 1] = 0;
      records[i * 4 + 2] = inst.z;
      poseU32[0] = packInstancePose(inst.yaw, inst.scale);
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
    if (this._coverSystem !== undefined) {
      if (this.renderer instanceof WebGPURenderer) {
        this.renderer.unregisterInstanceField(this._coverSystem);
      }
      this._coverSystem.dispose();
      this._coverSystem = undefined;
    }
    this._cover = undefined;
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
    if (this._cover !== undefined && this._coverSystem !== undefined) {
      this._cover.update(this.camera.position.x, this.camera.position.z);
      this._coverSystem.setPopulationData(this._cover.records.subarray(0, this._cover.count * 4));
      this._coverSystem.uploadRecords();
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
      cover: this._coverSystem?.instanceCount ?? 0,
      // P2 LOD-transition live state (field lane only): the applied band/hysteresis/bias knobs.
      // Key omitted when the field lane is inactive (`exactOptionalPropertyTypes` contract).
      ...(this._fieldSystem !== undefined
        ? {
            lod: {
              band: this._fieldLodBand,
              hyst: this._fieldLodHysteresis,
              biasPx: this._fieldLodBiasPx,
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
      // Live wind state (URL knob or HUD toggle) — the honest isolation flag for cost tables.
      result.wind = this._windField !== undefined && this._windLive ? 1 : 0;
      // Ground-cover ring (ADR 0059 step 1b, source B): live record count + ring knobs.
      if (this._coverSystem !== undefined && this._cover !== undefined) {
        result.coverInstances = this._coverSystem.instanceCount;
        result.coverRadius = this._cover.radius;
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
