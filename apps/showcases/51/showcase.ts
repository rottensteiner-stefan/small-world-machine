import type {
  EngineOptions,
  GeometryDataInterface,
  GpuTimer,
  HbaoElement,
  TextureArray,
  BoundingVolume,
  LodTransitionMode,
  FieldCanopy,
  ShowcaseParamsResult,
  InstanceFieldSystem,
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
  Ground,
  Object3D,
  PostProcessingEffectType,
  RendererType,
  StandardMaterial,
  Vector3D,
  WebGPURenderer,
  defineShowcaseParams,
  readShowcaseParams,
  mulberry32,
  BoundingBox,
  LOD_TRANSITION_MODES,
  packInstancePose,
} from "@small-world-machine/engine";
import {
  applyFoliageLook,
  canopyCoverageAt,
  canopyHeightFade,
  createCanopyGroundAoTexture,
  FOLIAGE_LOOKS,
  ForestLookBlender,
  buildPopulationCanopy,
  collectVegetationParts,
  createTreeField,
  forestBreeze,
  geometryBoundingRadius,
  geometryHeight,
  GroundCoverSystem,
  loadVegetationSpecies,
  MEADOW_GRASS_VARIETIES,
  mergeVegetationParts,
  WindField,
  type SpeciesManifest,
  type VegetationPart,
} from "@small-world-machine/vegetation-extras";
import { getCameraPath, type CameraPath, type PathName } from "./CameraPaths.js";
import { Hud, hudFreeMode, type HudGpuTimings, type VegHudStats } from "./Hud.js";
import { GoldenSession, lookupOwn, parseGoldenSpec } from "../shared/GoldenCapture.js";

/**
 * Showcase 51 — Forest Measurement Baseline (ADR 0059): GPU-driven vegetation lab. Interactive =
 * jacaranda forest + meadow (fly with WASD/mouse); automated = reproducible bench lanes emitting a
 * `MEASURE` JSON line (consumed by `.agents/scripts/veg-bench.mjs`). Parameters: `PARAMS` / `?help`.
 */

/** URL parameters (`?help` prints this table). Interactive sessions (no `frames`/`qa`/`__golden`/
 *  `truth`) get the showcase scene, automated runs the reproducible measurement defaults. */
const PARAMS = defineShowcaseParams({
  tree: {
    type: "string",
    default: "none",
    interactive: "jacaranda",
    pattern: /^[a-z0-9_]+$/,
    doc: "species stem (none = Kenney set)",
  },
  n: { type: "int", default: 20000, interactive: 2000, min: 0, max: 2_000_000, doc: "tree count" },
  seed: { type: "int", default: 51, doc: "scatter seed" },
  path: {
    type: "enum",
    values: ["none", "walk", "flight", "aerial"],
    default: "none",
    doc: "seeded camera path",
  },
  pausedAt: { type: "number?", min: 0, max: 1, doc: "freeze the path at t" },
  frames: { type: "int", default: 240, min: 1, doc: "automated run: sampled frames, then MEASURE" },
  qa: { type: "bool", default: false, doc: "fixed camera, no overlay" },
  truth: { type: "bool", default: false, doc: "ground-truth capture (signals __vegTruthReady)" },
  gputimings: { type: "bool", default: false, doc: "per-pass GPU timing ring in automated runs" },
  shadows: { type: "bool", default: true, doc: "sun shadows" },
  wind: { type: "bool", default: true, doc: "field-lane wind" },
  cover: { type: "bool", default: true, doc: "ground-cover rings" },
  coverDensity: {
    type: "number",
    default: 5,
    min: 0.01,
    max: 8,
    doc: "ground-cover clumps per m²",
  },
  coverRadius: {
    type: "number",
    default: 160,
    min: 20,
    max: 400,
    doc: "ground-cover ring radius (m)",
  },
  canopy: { type: "bool", default: true, doc: "canopy ambient occlusion" },
  look: {
    type: "enum",
    values: ["auto", "meadow", "forest", "off"],
    default: "off",
    interactive: "auto",
    doc: "foliage look preset",
  },
  hbao: { type: "bool", default: false, interactive: true, doc: "screen-space AO" },
  taa: { type: "bool", default: false, doc: "temporal AA" },
  lodMode: {
    type: "enum",
    values: ["off", "hysteresis", "dither", "dither-hysteresis"],
    default: "hysteresis",
    doc: "LOD transition (L cycles)",
  },
  occlusion: {
    type: "enum",
    values: ["a", "b", "c"],
    default: "b",
    doc: "a = no HZB, b = HZB, c = HZB + teleports",
  },
  cutEvery: {
    type: "int",
    default: 60,
    min: 10,
    doc: "teleport period in sampled frames (occlusion=c)",
  },
});

const WARMUP_FRAMES = 30;
/** `?occlusion=c`: each hard cut advances the path by this loop fraction (deterministic). */
const CUT_T_JUMP = 0.18;
/** field lane: sub-pixel cull gate in px (frozen `cullPixelSize` must sit below the band floor). */
const FIELD_CULL_PIXEL_SIZE = 2;
/** Authored ascending bucket maxima in px (near=detail: bucket 0 = farthest = coarsest). */
const FIELD_LOD_MAXIMA_PX: readonly number[] = [24, 96, 1e6];
/** Real-LOD band maxima in px (`?tree=` species chain; geometric progression 16→32→72→1e6). */
const FIELD_LOD_MAXIMA_REAL_PX: readonly number[] = [16, 32, 72, 1e6];
/** Load-time triangle-stride decimation per proxy bucket (bucket 0 = stride 3, bucket 1 = 2). */
const FIELD_LOD_PROXY_STRIDE: readonly number[] = [3, 2];
/** Leaf transmission tint of the field lane (sRGB, same value as showcase 52's leaves). */
const FIELD_LEAF_BACKLIGHT: readonly [number, number, number] = [0.55, 0.72, 0.2];
/** Ground-cover tile edge (m); the ring's per-tile hash cells. */
const COVER_TILE_CELL = 5;
/** Forest-floor plane edge (m); the canopy AO map covers it at 1 texel per metre. */
const GROUND_SIZE = 240;
/** `?look=auto` easing rate toward the coverage at the camera (1/s). */
const LOOK_BLEND_RATE = 1.5;
/** Screen-space AO for grass/foliage contact (world radius m, strength). */
const HBAO_RADIUS = 0.8;
const HBAO_INTENSITY = 0.9;
/** ADR 0059 step 6a canopy ambient: ambient kept under full cover at the ground, coverage grid cell (m), and the share of the widest branch extent that reads as closed crown. */
const CANOPY_AMBIENT_FLOOR = 0.3;
/** `?tree=` species: uniform scale on top of the scatter scale (scan trees are full-size, ~19 m). */
const SPECIES_TREE_SCALE = 0.55;
/** Trees stay inside this ±X/±Z world box (200×200 m around the origin). */
const SCATTER_HALF = 100;
/** Central 60×60 m clearing: no trees, the default camera vantage and Charly's paths live here. */
const CLEARING_HALF = 30;
/** Defines the fake "sky": soft hazy blue that matches the linear fog color at the horizon. */
const HORIZON_COLOR = new Color(0.55, 0.68, 0.8);
const FOG_NEAR = 260;
const FOG_FAR = 420;

/** Expected CC0 tree asset names in `apps/showcases/51/assets/` (contract with Frank, ; see `docs/log.md` + `assets/README.md`). */
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

/** One mesh part of a tree prototype (`vegetation-extras` `VegetationPart`). */
type TreePart = VegetationPart;

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
  /** Field lane: GPU-managed instance count. */
  fieldInstances?: number;
  /** field lane: active occlusion mode (`a`|`b`|`c`). */
  fieldOcclusionMode?: string;
  /** field lane: geometry-chain source (`proxy` = stride-decimation default, `reallod` = real `<stem>_LOD<n>.glb` chain of a `?tree=` species). */
  lodSource?: "proxy" | "reallod";
  /** field lane, real-LOD only: per-geometry triangle counts of the active chain in bucket order (L3/L2/L1/L0) — downstream bench triangle-budget parsing basis. */
  lodTris?: number[];
  /** Field lane shading model: `lambert-csm` = vertex-colour albedo, Lambert sun + cascaded shadows, irradiance/ambient, leaf backlight, Standard output stage (no specular yet). */
  fieldShading?: string;
  /** field lane: hard camera teleports fired (`?occlusion=c`). */
  fieldTeleports?: number;
  /** field lane: 1 = shared wind field active, 0 = static (measuring isolation `?wind=0`). */
  wind?: number;
  /** ground-cover ring (source B): live instance count of the cover field. */
  coverInstances?: number;
  /** ground-cover ring: active ring radius (m) and blade density (blades per m²). */
  coverRadius?: number;
  coverDensity?: number;
}

/** Live adapter of the engine's opt-in WebGPU timing ring (`renderer.gpuTimings`, / Bob) to the HUD's guarded view ({@link HudGpuTimings}, / Charly). */
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

/** Deterministic scatter on a jittered lattice inside the SCATTER box. */
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
  /** `field` (WebGPU instance field) or the `autoinst` fallback on GL tiers. */
  private _mode: "autoinst" | "field" = "field";
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

  /** External camera override (contract with Charly's path sampler, ). */
  private _externalCameraActive = false;
  private readonly _externalCameraPos = new Vector3D();
  private readonly _externalCameraTarget = new Vector3D();

  // camera-path rig: URL-driven (`?path=`) or switched via the HUD keys/buttons (1/2/3).
  private _path: PathName | undefined = undefined;
  private _pathCam: CameraPath | undefined = undefined;
  private _pathT = 0;
  /** `?pausedAt=<t>`: freeze the active path loop at `sample(t)` for stable keyframe/truth shots. */
  private _pausedAt: number | undefined = undefined;
  /** `?truth=1`: ground-truth mode signals `window.__vegTruthReady` after the first frame. */
  private readonly _isTruth: boolean;
  private _truthSignalled = false;

  // GPU timing ring (WebGPU only, opt-in).
  private _gpuTimer: GpuTimer | undefined = undefined;
  private _hud: Hud | undefined = undefined;
  private _hudAccum = 0;
  private _golden: GoldenSession | undefined = undefined;

  // field lane (ADR 0059 step 1, WebGPU only). See `_buildFieldLane`.
  private _fieldSystem: InstanceFieldSystem | undefined = undefined;
  private readonly _occlusionMode: "a" | "b" | "c";
  private readonly _cutEvery: number;
  private _teleportCount = 0;
  private _cutAccum = 0;
  /** Field-lane geometry-chain source of the LAST built field (`proxy` = stride-decimation default, `reallod` = real GLB chain of a `?tree=` species). */
  private _lodSource: "proxy" | "reallod" = "proxy";
  /** Per-geometry triangle counts of the real-LOD chain (bucket order L3/L2/L1/L0), when active. */
  private _realLodTris: number[] = [];
  /** ADR 0059 step 1b: shared wind field driving the field lane (`?wind=0` isolates it). */
  private _windField: WindField | undefined = undefined;
  /** Live wind state (initial = `?wind=` URL knob). */
  private _windLive: boolean;
  /** Crown-top height at scale 1 cached at field build — the re-arm height for live `setWind`. */
  private _fieldWindHeight = 0;
  // ADR 0059 step 1b: camera-centred procedural ground-cover ring (CPU-generated records fed into a SECOND `InstanceFieldSystem` via `uploadRecords()`).
  private _groundCover: GroundCoverSystem | undefined = undefined;
  /** `?cover=0` disables the ground-cover ring; default on (field lane only). */
  private readonly _coverEnabled: boolean;
  /** `?canopy=0` disables the canopy ambient occlusion (P6a A/B); default on (field lane). */
  private readonly _canopyEnabled: boolean;
  /** Canopy coverage of the tree population, shared by the tree field and every cover field. */
  private _canopy: FieldCanopy | undefined = undefined;
  /** Forest-floor material (gets the canopy as `aoMap`, ambient-only darkening). */
  private _groundMaterial: StandardMaterial | undefined = undefined;
  /** `?look=auto`: canopy-driven meadow -> forest look blend (created by `_applyLookKnobs`). */
  private _lookBlender: ForestLookBlender | undefined = undefined;
  /** `?coverDensity=` clumps per m² (clamped). */
  private readonly _coverDensity: number;
  /** `?coverRadius=` ring outer radius in metres (clamped). */
  private readonly _coverRadius: number;
  /** `?tree=<stem>`: textured species (`<stem>.species.json` + `<stem>_LOD0..3.glb` + albedo layers). */
  private readonly _treeStem: string | undefined;
  /** Loaded species sidecar (set by `_loadPrototype` when `?tree=` resolves). */
  private _species: SpeciesManifest | undefined = undefined;
  /** Albedo layers of the species (one per primitive), bound as the field's `albedoArray`. */
  private _speciesAlbedo: TextureArray | undefined = undefined;
  /** Merged species field geometry per LOD, finest first (`loadVegetationSpecies`). */
  private _speciesLods: readonly GeometryDataInterface[] = [];
  private _speciesAlphaTest = 0;
  /** LOD-transition strategy of the tree field (`?lodMode=`, HUD `L`); default = the engine's zero-config `hysteresis`. */
  private _lodMode: LodTransitionMode = "hysteresis";
  /** Live TAA state (`?taa=1` arms the engine `TaaElement`; default off). */
  private readonly _taaLive: boolean;
  /** Parsed URL parameters (`PARAMS`). */
  private readonly _params: ShowcaseParamsResult<typeof PARAMS>;
  /** `?look=auto|meadow|forest|off`: foliage look (tone curve + exposure + grading, ADR 0059 step 6a look-dev). */
  private readonly _look: "auto" | "meadow" | "forest" | "off";
  /** `?hbao=0|1`: screen-space AO for contact darkening. Interactive default on, automated off. */
  private readonly _hbao: boolean;

  constructor(options: EngineOptions = {}) {
    super(options);
    // Perpetual dev/QA surface (showcase-52 `__qaSwm52` convention): the live app on `window`, so headless readbacks + user devtools can reach engine internals (renderer device, canvas context) for pixel probes without adding imports or touching the module scope.
    (window as unknown as { __swm51?: Showcase }).__swm51 = this;
    const p = readShowcaseParams(PARAMS);
    const v = p.values;
    this._params = p;
    this._occlusionMode = v.occlusion;
    this._cutEvery = v.cutEvery;
    this._targetCount = v.n;
    this._seed = v.seed;
    this._targetFrames = v.frames;
    this._isAutomated = p.has("frames");
    this._isQa = v.qa;
    this._isTruth = v.truth;
    this._shadowsOn = v.shadows;
    this._windLive = v.wind;
    this._coverEnabled = v.cover;
    this._canopyEnabled = v.canopy;
    this._coverDensity = v.coverDensity;
    this._coverRadius = v.coverRadius;
    this._taaLive = v.taa;
    this._treeStem = v.tree === "none" ? undefined : v.tree;
    this._look = v.look;
    this._hbao = v.hbao;
    this._lodMode = v.lodMode;
    this._path = v.path === "none" ? undefined : v.path;
    this._pathCam = this._path !== undefined ? getCameraPath(this._path) : undefined;
    this._pausedAt = this._pathCam !== undefined ? v.pausedAt : undefined;
    this._pathT = this._pausedAt ?? 0;
    this.defaultCameraController = p.interactive && this._path === undefined ? "fly" : "none";
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

    // Key sun + ambient (ADR 0059 step 0: "one key directional sun + ambient").
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

    // Interactive start pose: low and close at the forest edge (eye level, trees readable and the wind motion clearly visible), NOT the old far elevated 3/4 overview.
    const camPos = new Vector3D(42, 5, 42);
    const camTarget = new Vector3D(0, 4, 0);
    this.setInitialCamera(camPos, camTarget);

    // Tree lane: asset prototype when Frank's files exist, else the procedural placeholder.
    // GL tiers have no field lane: decide before loading, so they get the light Kenney set.
    if (!(this.renderer instanceof WebGPURenderer)) this._mode = "autoinst";
    this._prototype = await this._loadPrototype();
    // `?tree=` species (field lane only): preload the REAL `<stem>_LOD<n>.glb` siblings ASYNC right after the prototype (`_buildFieldLane` stays sync — the load happens before it).
    const realLods =
      this._species !== undefined && this._mode === "field" && this._speciesLods.length === 4
        ? [this._speciesLods[3]!, this._speciesLods[2]!, this._speciesLods[1]!]
        : null;
    const instances = scatterTrees(this._targetCount, this._seed);
    this._treeCount = instances.length;
    // Field lane on WebGPU; GL tiers (no compute) fall back to scene-graph auto-instancing.
    if (this._buildFieldLane(instances, this._prototype, realLods)) {
      this._buildGroundCover();
    } else {
      this._mode = "autoinst";
      this._buildAutoInstances(instances, this._prototype);
    }

    if (this._isAutomated) {
      this._state = "warmup";
      this._writeStatus(
        `ready mode=${this._mode} n=${this._treeCount} seed=${this._seed} ` +
          `renderer=${this.renderer.type}`,
      );
    }

    // : camera-path rig ().
    if (this._pathCam !== undefined) {
      this._externalCameraActive = true;
      this._applyPathPose();
    }

    // : opt-in GPU timing ring ().
    const gpuTimer = this._resolveGpuTimer();
    // `?pausedAt=` is a capture knob (veg-bench keyframe shots + truth compare): the DOM HUD would pollute the clipped screenshots and the FLIP comparison, so it counts as hud-free.
    const interactiveHud =
      !hudFreeMode(window.location.search) && !this._isQa && !this._params.has("pausedAt");
    if (gpuTimer !== undefined) {
      const explicit = this._params.values.gputimings;
      if (explicit || (interactiveHud && this.renderer.type === RendererType.WEB_GPU)) {
        gpuTimer.enable();
      }
      // Keep a reference whenever the ring can be active: interactive HUD (auto-enabled) OR an explicit `?gputimings=1` diagnostic run (`?frames=`/`?measure=`, where the HUD is absent but `_finalize()` must still attach `gpuMs`/`gpuPassesMs` to the MEASURE contract).
      if (interactiveHud || explicit) {
        this._gpuTimer = gpuTimer;
      }
    }

    // : interactive measurement HUD ().
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

  /** Leaves the active camera path (HUD `0`): the camera keeps its current pose and is handed to the engine fly controller (created on demand when the session started on a path, where the default controller is `none`). */
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

  /** Returns the opt-in GPU timing ring when the active renderer exposes it (WebGPU tier). */
  private _resolveGpuTimer(): GpuTimer | undefined {
    if (this.renderer.type !== RendererType.WEB_GPU) return undefined;
    const maybe = (this.renderer as unknown as { gpuTimings?: GpuTimer }).gpuTimings;
    return maybe ?? undefined;
  }

  /** Golden-capture mode (shared `GoldenSession` contract, see `apps/showcases/shared/GoldenCapture.ts`): `?__golden=forest-baseline&__goldenView=base&__goldenFrames=N` stops the realtime loop, pins the deterministic surface, soaks, then advances N fixed `step(1/60)` frames of the un-optimized baseline (camera freezes — no path, no orbit — so identical URLs yield identical bytes). */
  public override async start(): Promise<void> {
    const golden = parseGoldenSpec<string>((rawView) => rawView ?? "base");
    await super.start();
    // ADR 0059 step 2 sighting: `?taa=1` arms the ENGINE `TaaElement` (default off).
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

  /** Applies the constructor-parsed `?taa=` knob to the engine post-processing `TaaElement`. */
  /** Applies `?look=` / `?hbao=` (ADR 0059 step 6a look-dev): enables the post group only when one of them is on, so automated runs keep the post-free measurement path. */
  private _applyLookKnobs(): void {
    const pp = this.renderer.postProcessing;
    if (this._look === "off" && !this._hbao) return;
    pp.enabled = true;
    if (this._look === "auto") {
      this._lookBlender = new ForestLookBlender(
        FOLIAGE_LOOKS.SUNNY_MEADOW,
        FOLIAGE_LOOKS.FOREST_SHADE,
        LOOK_BLEND_RATE,
      );
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

  /** `?look=auto`: coverage above the camera (faded above the crowns) drives the look blend. */
  private _updateAutoLook(deltaTime: number): void {
    const c = this._canopy;
    const cam = this.camera.position;
    const target =
      c !== undefined
        ? canopyCoverageAt(c, cam.x, cam.z) * canopyHeightFade(cam.y, c.canopyHeight)
        : 0;
    this._lookBlender?.update(this.renderer.postProcessing, target, deltaTime);
  }

  /** Forest floor: the canopy coverage as the ground's `aoMap` (ambient-only darkening). */
  private _applyGroundCanopy(canopy: FieldCanopy): void {
    if (this._groundMaterial === undefined) return;
    this._groundMaterial.aoMap = createCanopyGroundAoTexture(
      canopy,
      canopy.ambientFloor,
      GROUND_SIZE,
    );
  }

  private _applyTaaKnob(): void {
    const taaNode = this.renderer.postProcessing.get(PostProcessingEffectType.TAA);
    if (taaNode !== undefined) {
      taaNode.enabled = this._taaLive;
    }
  }

  /** Tries the expected asset names in order and returns the first prototype that loads. */
  private async _loadPrototype(): Promise<TreePrototype> {
    const loader = new GltfLoader({ basePath: "./assets/" });
    if (this._treeStem !== undefined && this._mode === "field") {
      const species = await this._tryLoadSpecies(this._treeStem);
      if (species) return species;
    }
    for (const asset of EXPECTED_TREE_ASSETS) {
      try {
        const root = await loader.load(asset);
        const parts = collectVegetationParts(root);
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

  /** `?tree=<stem>`: loads the species sidecar, `<stem>_LOD0.glb` and the albedo layers. */
  private async _tryLoadSpecies(stem: string): Promise<TreePrototype | null> {
    try {
      const species = await loadVegetationSpecies(stem, { basePath: "./assets/" });
      this._species = species.manifest;
      this._speciesAlbedo = species.albedo;
      this._speciesLods = species.lods;
      this._speciesAlphaTest = species.alphaTest;
      console.info(
        `[Showcase51] species "${stem}": ${species.lod0Parts.length} parts, ${species.lods.length} LODs`,
      );
      return { name: `${stem}_LOD0.glb`, source: "asset", parts: species.lod0Parts };
    } catch (error) {
      console.info(
        `[Showcase51] species "${stem}" unavailable (${error instanceof Error ? error.message : String(error)}) — default assets`,
      );
      return null;
    }
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

  // ------------------------------------------------------------------------- field lane (ADR 0059 step 1, WebGPU only) -------------------------------------------------------------------------

  /** Registers the deterministic population as an `InstanceFieldSystem` on the WebGPU renderer: one combined single-mesh tree prototype (V1 constraint: one geometry per bucket, one material), records packed with the frozen `packInstancePose` (16 B each), GPU cull / occlusion / pulled indirect draw driven entirely by the renderer's own coordinator. */
  private _buildFieldLane(
    instances: readonly ScatterInstance[],
    proto: TreePrototype,
    realLods: readonly GeometryDataInterface[] | null | undefined = undefined,
  ): boolean {
    if (!(this.renderer instanceof WebGPURenderer)) {
      console.info("[Showcase51] field lane needs WebGPU — falling back to auto-instancing");
      return false;
    }
    if (instances.length === 0) {
      return false;
    }
    const merged = this._mergeTreeGeometry(proto);
    const radius = geometryBoundingRadius(merged);
    // Real species chain (coarsest first) or load-time stride-decimated proxies of the merged tree.
    const useReal = realLods !== undefined && realLods !== null && realLods.length === 3;
    const lods = useReal
      ? [...realLods, merged]
      : [
          this._buildLodProxyGeometry(merged, FIELD_LOD_PROXY_STRIDE[0]!),
          this._buildLodProxyGeometry(merged, FIELD_LOD_PROXY_STRIDE[1]!),
          merged,
        ];
    const records = this._buildFieldRecords(instances);
    const windHeight = geometryHeight(merged);
    this._canopy = this._canopyEnabled
      ? buildPopulationCanopy(records, merged, { ambientFloor: CANOPY_AMBIENT_FLOOR })
      : undefined;
    if (this._canopy) this._applyGroundCanopy(this._canopy);
    const windField = windHeight > 0 ? new WindField(forestBreeze(windHeight)) : undefined;
    const system = createTreeField({
      id: `s51-${proto.name}`,
      records,
      lods,
      lodMaxPx: useReal ? FIELD_LOD_MAXIMA_REAL_PX : FIELD_LOD_MAXIMA_PX,
      boundingRadius: radius,
      cullPixelSize: FIELD_CULL_PIXEL_SIZE,
      lodTransitionMode: this._lodMode,
      backlightSrgb: FIELD_LEAF_BACKLIGHT,
      ...(this._speciesAlbedo ? { albedo: this._speciesAlbedo } : {}),
      ...(this._speciesAlphaTest > 0 ? { alphaTest: this._speciesAlphaTest } : {}),
      ...(this._canopy ? { canopy: this._canopy } : {}),
    });
    if (this._occlusionMode === "a") {
      system.setOcclusionEnabled(false);
    }
    // Fail-closed registration (ADR 0043): on a 4-cap `maxBindGroups` device (e.g.
    try {
      this.renderer.registerInstanceField(system);
    } catch (error) {
      system.dispose();
      this._fieldSystem = undefined;
      console.info(
        `[Showcase51] field lane unavailable on this device ` +
          `(${error instanceof Error ? error.message : String(error)}) — falling back to autoinst`,
      );
      return false;
    }
    this._fieldSystem = system;
    this._windField = windField;
    this._fieldWindHeight = windHeight;
    // Apply the initial wind state (URL knob) once the field is registered — the single source of truth for the runtime swap, never the constructor.
    this._applyWindState();

    // Geometry-chain source bookkeeping (MEASURE `lodSource` / `lodTris`) + the source-specific diagnostics line.
    if (useReal) {
      this._lodSource = "reallod";
      this._realLodTris = lods.map((g) => Math.floor((g.indices?.length ?? 0) / 3));
      console.info(
        `[Showcase51] field lane source=reallod buckets=4 tidy=${this._realLodTris.join("/")}`,
      );
    } else {
      this._lodSource = "proxy";
      this._realLodTris = [];
    }

    console.info(
      `[Showcase51] field lane: ${instances.length} records, cullRadius=${radius.toFixed(2)} m, ` +
        `occlusion=${this._occlusionMode}` +
        `, wind=${this._windField !== undefined && this._windLive ? "on" : "off"}` +
        `, LOD mode=${this._lodMode}` +
        `, source=${this._lodSource}`,
    );
    return true;
  }

  /** Second, camera-centred instance field for the procedural ground-cover ring. */
  private _buildGroundCover(): boolean {
    if (this._mode !== "field" || this._fieldSystem === undefined) return false;
    if (!(this.renderer instanceof WebGPURenderer)) return false;
    if (!this._coverEnabled) return false;
    const cover = new GroundCoverSystem({
      varieties: MEADOW_GRASS_VARIETIES,
      density: this._coverDensity,
      radius: this._coverRadius,
      seed: this._seed + 1000,
      cellSize: COVER_TILE_CELL,
      cullPixelSize: FIELD_CULL_PIXEL_SIZE,
      ...(this._canopy ? { canopy: this._canopy } : {}),
    });
    const registered = cover.register(this.renderer);
    if (registered === 0) {
      cover.dispose();
      console.info("[Showcase51] ground cover unavailable on this device — disabled");
      return false;
    }
    this._groundCover = cover;
    this._applyWindState();
    console.info(
      `[Showcase51] ground cover: ${registered}/${MEADOW_GRASS_VARIETIES.length} varieties, ` +
        `radius=${this._coverRadius} m, density=${this._coverDensity} clumps/m², ` +
        `wind=${this._windLive ? "on" : "off"} (shared block)`,
    );
    return true;
  }

  /** Live clump records over all ground-cover species. */
  private _coverInstanceCount(): number {
    return this._groundCover?.instanceCount ?? 0;
  }

  /** Applies the CURRENT live wind state to the registered field system (`setWind` patch, hard off = height 0 -> pulled shader gate static). */
  private _applyWindState(): void {
    const system = this._fieldSystem;
    const field = this._windField;
    if (system === undefined || field === undefined) return;
    system.setWind(
      this._windLive ? field.uniforms : undefined,
      this._windLive ? this._fieldWindHeight : 0,
    );
    // Ground-cover ring shares the SAME wind block (gust waves must move trees and grass coherently) with its own per-field blade-height profile; the live `F` toggle gates both.
    this._groundCover?.setWind(this._windLive ? field.uniforms : undefined);
  }

  /** P2 load-time stepped LOD proxy of the merged tree geometry (ADR 0059 step 2): deterministic triangle-stride decimation at load, pure CPU, zero runtime cost. */
  private _buildLodProxyGeometry(
    merged: GeometryDataInterface,
    stride: number,
  ): GeometryDataInterface {
    if (stride <= 1) return merged;
    const src = merged.indices;
    if (src === undefined) {
      // Indexed geometry is contract-required for field buckets (`_mergeTreeGeometry` enforces it); a defensive identity passthrough keeps this builder total.
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

  /** HUD `F` toggle: flips the live wind state and re-arms the system immediately (no re-create, no pop on re-enable — the wind field keeps advancing while off). */
  private _toggleWindLive(): void {
    if (this._windField === undefined) return;
    this._windLive = !this._windLive;
    this._applyWindState();
  }

  /** HUD `L` toggle (P2, ADR 0059 step 2): cycles the field lane through the DECISIVE MODE SWITCH (moderator 2026-11-10) — `off` (explicit P1-identical opt-in) → `hysteresis` (the decided engine zero-config default) → `dither` → `dither-hysteresis`. */
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

  /** Merges the tree's parts into ONE indexed geometry with the per-part `offsetY` baked into the vertex positions (tree base stays at y=0), so the pull shader's pose yaw/scale reproduces the autoinst transforms exactly. */
  private _mergeTreeGeometry(proto: TreePrototype): GeometryDataInterface {
    return mergeVegetationParts(proto.parts, this._species);
  }

  /** Crown-top height of the merged geometry (max vertex y, base at y=0) — wind profile normalizer at scale 1. */

  /** Packs the population into 16-B frozen records (4×f32): xyz position + the packed u32 pose stored as the f32 whose bit pattern equals it — `field_pull.wgsl` reads `bitcast<u32>(record.w)`. */
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

  /** Releases the registered field system (renderer list + GPU state) on destroy. */
  private _unregisterFieldLane(): void {
    if (this._fieldSystem === undefined) return;
    if (this.renderer instanceof WebGPURenderer) {
      this.renderer.unregisterInstanceField(this._fieldSystem);
    }
    this._fieldSystem.dispose();
    this._fieldSystem = undefined;
    // Ground-cover ring (second field system) releases with the same fan-out.
    this._groundCover?.dispose();
    this._groundCover = undefined;
  }

  /** Camera-override hook (contract with Charly's camera-path sampler). */
  public setExternalCameraPose(position: Vector3D, target: Vector3D): void {
    this._externalCameraActive = true;
    this._externalCameraPos.copyFrom(position);
    this._externalCameraTarget.copyFrom(target);
  }

  /** Hands the HUD its keys (1/2/3 path switch, I/H panel toggle) before the showcase defaults; everything unconsumed falls through to the stock shortcuts (renderer switch, R reset). */
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
    // ADR 0059 step 1b: advance the field-lane wind field every frame (zero-GC typed-array rewrite); the system forwards the block at the next main-view prepare.
    if (this._mode === "field") {
      this._windField?.update(deltaTime);
    }
    // Camera-path rig: advance the loop by real seconds unless frozen via `?pausedAt=`, then override the pose (the path is the only motion source once active; zero heap allocations).
    if (this._pathCam !== undefined && this._externalCameraActive) {
      if (this._pausedAt === undefined) {
        const duration = Math.max(0.001, this._pathCam.durationSeconds);
        this._pathT += deltaTime / duration;
      }
      this._applyPathPose();
      // `?occlusion=c` (IF-CAMERA-CUT-HZB-SKIP live exercise): deterministic hard camera cuts every `?cutEvery=` sampled frames arm the one-frame HZB skip through the renderer's teleport fan-out.
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

    // ADR 0059 step 1b: ground-cover rings follow the camera BEFORE the renderer records the frame's field culls; `GroundCoverSystem` rebuilds only after `updateStep` m of travel.
    this._groundCover?.update(this.camera.position.x, this.camera.position.z);

    // `?truth=1` ground-truth mode: signal readiness once after the first full frame.
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

    // Automated measurement sequence (`?frames=`).
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
      visible: -1,
      triangles: -1,
      // Live wind state (field lane; false on every other lane / windless geometry).
      wind: this._windField !== undefined && this._windLive,
      // Ground-cover ring instances (0 when inactive).
      cover: this._coverInstanceCount(),
      // Live TAA state (`?taa=1`) — the dither-mode sighting display condition.
      taa: this._taaLive,
      // P2 LOD-transition live state (field lane only): the applied band/hysteresis/bias knobs and — when a DECISIVE MODE SWITCH preset is armed — the mode name.
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
    // Field-lane diagnostics: instance count, occlusion mode, teleports.
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
      // Ground-cover ring: live record count + ring knobs.
      if (this._groundCover !== undefined) {
        result.coverInstances = this._coverInstanceCount();
        result.coverRadius = this._coverRadius;
        result.coverDensity = this._coverDensity;
      }
      if (this._teleportCount > 0) {
        result.fieldTeleports = this._teleportCount;
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
