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
  Ground,
  InstancedMesh,
  Matrix4,
  Object3D,
  RendererType,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
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
 *
 * The population is deterministic: a fixed default seed drives the scatter jitter (engine
 * `mulberry32`), nothing in the scene is time-dependent, so identical URLs yield identical
 * output (golden/QA compatible).
 *
 * Tree source — parallel-worker lane: worker Frank (P0-2) creates CC0 glTF trees in
 * `apps/showcases/51/assets/`. This file tries the expected names below via `GltfLoader` and
 * uses the FIRST that loads as the population's prototype; if none loads (assets absent
 * mid-development) it falls back, with a console.info, to a procedural placeholder tree
 * (trunk + two foliage cones). Both the "assets present" and "assets absent" states are
 * handled; the final baseline simply consumes what Frank delivers.
 *
 * URL knobs:
 *   `?mode=autoinst|instanced`   scatter lane (default `autoinst`)
 *   `?n=N`                       tree budget (default 20000; clamps to [0, 2000000]; `?n=0` empties the population)
 *   `?seed=S`                    scatter seed (default 51; deterministic per (n, seed))
 *   `?shadows=off`               disable the sun's shadow casting (pass isolation for benches)
 *   `?frames=N`                  automated run: N sampled frames after a 30-frame warm-up,
 *                                then the `MEASURE` line is emitted once (default 240)
 *   `?measure`                   same as `?frames=240` (automated-mode synonym)
 *   `?qa=1`                      stable headless-capture mode: fixed camera, no overlay/chrome
 *   `?path=walk|flight|aerial`   seeded camera path (P0-4, `CameraPaths.ts`); freezes the default
 *                                camera orbit and drives `setExternalCameraPose` every frame.
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
 * orbit controller, so a camera-path sampler can drive reproducible runs without touching this
 * file. Interactive mode defaults to an orbit camera around the central clearing.
 */

const DEFAULT_INSTANCE_COUNT = 20000;
const DEFAULT_FRAMES = 240;
const WARMUP_FRAMES = 30;
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
  private readonly _mode: "autoinst" | "instanced";
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

  constructor(options: EngineOptions = {}) {
    super(options);
    const params = new URLSearchParams(window.location.search);

    const mode = params.get("mode");
    this._mode = mode === "instanced" ? "instanced" : "autoinst";

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

    // Automated/QA/path/golden runs need a fixed vantage; interactive runs orbit the clearing.
    this.defaultCameraController =
      this._isAutomated || this._isQa || this._path !== undefined || params.has("__golden")
        ? "none"
        : "orbit";
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

    // Default vantage: elevated 3/4 view from inside the clearing, looking over the ring.
    const camPos = new Vector3D(60, 32, 60);
    const camTarget = new Vector3D(0, 4, 0);
    this.setInitialCamera(camPos, camTarget);

    // Tree lane: asset prototype when Frank's files exist, else the procedural placeholder.
    this._prototype = await this._loadPrototype();
    const instances = scatterTrees(this._targetCount, this._seed);
    this._treeCount = instances.length;
    if (this._mode === "autoinst") {
      this._buildAutoInstances(instances, this._prototype);
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
      if (interactiveHud) {
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
    super.destroy();
  }

  protected override update(deltaTime: number): void {
    // Camera-path rig: advance the loop by real seconds unless frozen via `?pausedAt=`, then
    // override the pose (the path is the only motion source once active; zero heap allocations).
    if (this._pathCam !== undefined && this._externalCameraActive) {
      if (this._pausedAt === undefined) {
        const duration = Math.max(0.001, this._pathCam.durationSeconds);
        this._pathT += deltaTime / duration;
      }
      this._applyPathPose();
    }

    // External camera sampler overrides the pose every frame (zero allocation, copied vectors).
    if (this._externalCameraActive) {
      this.camera.position.copyFrom(this._externalCameraPos);
      this.camera.target.copyFrom(this._externalCameraTarget);
      this.camera.updateViewMatrix();
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
      visible: -1,
      triangles: -1,
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
