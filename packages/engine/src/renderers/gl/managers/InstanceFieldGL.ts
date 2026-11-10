/**
 * ADR 0059 step 1 (P1-3) — WebGL2/WebGL1 CPU-cell fallback lane of the `InstanceField`
 * contract. Consumes the FROZEN core contract (`packages/engine/src/core/InstanceField.ts`)
 * and produces the GL renderer draw surface (`CpuIndirectDrawSource`) that the single-point
 * GL draw hook (`AbstractWebGLRenderer.drawInstanceFieldView`) consumes as direct instanced
 * draws. WebGPU cull lane: Bob's `renderers/WebGPU/managers/InstanceFieldSystem.ts`.
 *
 * Honest low-tier fallback per ADR 0047 tier doctrine: same decision math as the GPU lane
 * (frozen shared core math), honestly adapted to cell granularity and CPU, fixed capacity, no
 * readback anywhere, never fake parity, never degrades the WebGPU lane. Precedent:
 * `WebGLClusterCullPass` re-implements WGSL cluster cull on the CPU the same way.
 *
 * Option (i) per Batch-1 plan (`.agents/scratches/veg-p1/frank-gl-fallback-plan.md`):
 * ONE static cell-sorted 16-byte-record instance VBO per FIELD (the contract's single
 * instance-record buffer), uploaded once with STATIC_DRAW. The draw loop rebinds the
 * instanced attribute pointers per command via `vertexAttribPointer` BYTE OFFSETS —
 * zero per-frame instance uploads. No baseVertex / no baseInstance (absent from GL core,
 * semantically pointless here — every command draws one contiguous VBO range).
 *
 * Record attribute mapping (binding, frozen in `INSTANCE_RECORD_LAYOUT`):
 *   - WebGL2: bytes 0..11 as one `vec3` float attribute; bytes 12..15 as one UNSIGNED-
 *     INTEGER attribute (`vertexAttribIPointer`, u32 bits are NOT an IEEE float).
 *   - WebGL1: no integer attributes — a companion f32 fill (yaw, scale) is derived at build
 *     from the frozen `unpackInstancePose` (the engine cell sorter's own decode) and
 *     uploaded once; the 16-byte record storage stays byte-identical on every tier.
 *
 * Invariant IDs honoured (ADR 0047): `IF-CULL-NO-FALSE-NEGATIVE` (cell AABB grown by the
 * cell's max instance radius before `aabbVisibleConservative` — instance spheres are then
 * provably contained), `IF-PROJECTED-SIZE` (bucket + sub-pixel cull via the frozen
 * `projectedDiameterPixels`, main-camera metric only, shadow views reuse the main bucket
 * with `shadowLodBias`), `IF-BUDGET` (over-budget cells/instances/draws drop the farthest,
 * never a broken frame), `IF-CAMERA-CUT-HZB-SKIP` (`notifyCameraTeleport()` documented
 * no-op — the CPU-cell lane never consumes the HZB).
 *
 * Cell LOD is a documented tier variance: all instances of one (cell x prototype) share the
 * cell's bucket; pop happens on cell/bucket crossing, stateless in V1 (P2 crossfade, row
 * `instance_field_lod_crossfade`). GL has no GPU indirect: this lane emits CPU command lists
 * (option (i)), never a CPU indirect buffer.
 */
import {
  INSTANCE_RECORD_BYTES,
  MAX_INDIRECT_VIEWS,
  MAX_LOD_BUCKETS,
  IndirectDrawProducer,
  aabbVisibleConservative,
  fillCellWorldBounds,
  projectedDiameterPixels,
  unpackInstancePose,
  type Aabb,
  type CellGrid,
  type CellPopulation,
  type CpuDrawCommand,
  type CpuIndirectDrawSource,
  type CullParams,
  type CpuLaneBudget,
  type FieldVisibleSets,
  type IndirectCullProbe,
  type IndirectSegmentCounts,
  type InstanceFieldOptions,
  type InstanceFieldRuntimeApi,
  type InstancePose,
  type PrototypeDescriptor,
} from "../../../core/InstanceField.js";
import { Frustum, Matrix4 } from "../../../math/index.js";
import type { Mesh } from "../../Mesh.js";
import type { AbstractMaterial } from "../../../core/materials/index.js";

/** WebGL1 companion-fill attribute stride (yaw + scale, one f32 each). */
const GL1_COMPANION_FLOATS = 2 as const;

/** One mutable `CpuDrawCommand` pooled and reused across frames (zero per-frame allocation). */
class InstanceFieldCommand implements CpuDrawCommand {
  public producer: IndirectDrawProducer = IndirectDrawProducer.INSTANCE_FIELD;
  public viewIndex: number = 0;
  public bucketIndex: number = 0;
  public geometrySlot: number = 0;
  public materialSlot: number = 0;
  public indexCount: number = 0;
  public firstIndex: number = 0;
  public baseVertex: number = 0;
  public instanceBase: number = 0;
  public instanceCount: number = 0;
  public instanceAttrByteOffset: number = 0;
}

/** Setup surface of the GL CPU-cell fallback manager (see class doc for field semantics). */
export interface InstanceFieldGLSetup {
  /**
   * @domain Backend GL context the manager uploads VBOs on (WebGL2 or WebGL1).
   */
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  /**
   * @domain World-aligned population grid (authoring, frozen `CellGrid`).
   */
  grid: CellGrid;
  /**
   * @derived Engine-owned cell ownership map over the cell-sorted record buffer.
   */
  population: CellPopulation;
  /**
   * @derived Engine-owned cell-sorted 16-byte instance records (byte-identical on every tier,
   *         `INSTANCE_RECORD_BYTES` per record). Uploaded once (STATIC_DRAW), never mutated.
   */
  instanceRecords: Float32Array;
  /**
   * @derived Per-record prototype index, produced by the engine's cell sorter (range-implicit
   *         prototype resolution is storage-internal). Optional ONLY for a single-prototype
   *         field; required (validated) for multi-prototype fields.
   */
  recordPrototypeMap?: Uint8Array;
  /**
   * @derived Authoring LOD chains of the field (frozen descriptors).
   */
  prototypes: readonly PrototypeDescriptor[];
  /**
   * @derived Backend-owned per-(prototype x bucket) geometry table (`Mesh` per LOD bucket).
   */
  geometryTable: ReadonlyArray<ReadonlyArray<Mesh | undefined>>;
  /**
   * @derived Backend-owned per-prototype material table (slot index = prototype index).
   */
  materials: ReadonlyArray<{ readonly material: AbstractMaterial; readonly alphaTest: number }>;
  /**
   * @domain Authoring options of the field node (subset the GL lane consumes at runtime).
   */
  options: Pick<InstanceFieldOptions, "cullPixelSize" | "shadowLodBias" | "maxViews" | "cpuBudget">;
  /**
   * @domain Live `SwmWind` block producer (16 floats, `vegetation-extras` `WindField.uniforms`),
   *         rewritten by the owner like the WebGPU lane's `InstanceFieldSystem.setWind`. The GL
   *         lane uploads the CURRENT bytes per field draw; borrowed reference, never copied.
   *         `windHeight > 0` with this missing is a setup error (fail fast, ADR 0043).
   */
  windUniforms?: Float32Array;
  /**
   * @domain Crown-top height of the population prototype in metres at scale 1 (vertical wind
   *         profile + bend normalizer, GL2 `u_windHeight` master switch). 0 disables wind
   *         entirely (fail-closed static). Live-swappable via {@link InstanceFieldGL.setWind}.
   */
  windHeight?: number;
}

/**
 * WebGL2/WebGL1 CPU-cell fallback manager for one `InstanceField` (ADR 0059 P1-3).
 *
 * Static population model (frozen): records are written exactly once, the engine owns the
 * cell sort, and `rebuild()` is the only mutation path (full rebuild, never incremental).
 * Every frame the renderer feeds the per-view cull params (`prepareMainView` /
 * `prepareShadowView` + `cullMainView` / `cullShadowView`) and draws through the single-
 * point GL hook `AbstractWebGLRenderer.drawInstanceFieldView`, which consumes
 * `getSource(viewIndex)` (the frozen `CpuIndirectDrawSource` surface). Zero CPU readback.
 */
export class InstanceFieldGL implements InstanceFieldRuntimeApi {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _grid: CellGrid;
  private readonly _halfCellDiagonal: number;
  private readonly _cellSize: number;
  private readonly _cullPixelSize: number;
  private readonly _shadowLodBias: number;
  private readonly _cpuBudget: CpuLaneBudget;
  private readonly _viewCount: number;

  // --- Authoring-derived tables (build-time, immutable) ---
  private readonly _protoBounds: Float32Array;
  /** Ascending LOD bucket maxima per prototype (decay: `lodBucketMaxima[p][]`). */
  private readonly _protoBucketMaxima: ReadonlyArray<Float32Array>;
  /** Backend geometry-slot space: `slot = p * MAX_LOD_BUCKETS + bucket`. */
  private readonly _geometryTable: ReadonlyArray<Mesh | undefined>;
  private readonly _materials: ReadonlyArray<{
    readonly material: AbstractMaterial;
    readonly alphaTest: number;
  }>;

  // --- Population-derived run map (build/rebuild-time, static) ---
  private _runProto: Uint8Array = new Uint8Array(0);
  private _runStart: Uint32Array = new Uint32Array(0);
  private _runCount: Uint32Array = new Uint32Array(0);
  private _runMaxRadius: Float32Array = new Float32Array(0);
  private _runCellIdx: Uint32Array = new Uint32Array(0);
  private _totalRuns: number = 0;
  private _cellsCellId: Uint32Array = new Uint32Array(0);
  private _cellsFirstRun: Uint32Array = new Uint32Array(0);
  private _cellsRunCount: Uint16Array = new Uint16Array(0);
  private _cellsMaxRadius: Float32Array = new Float32Array(0);
  private _cellsCenter: Float32Array = new Float32Array(0); // 3 floats per cell
  private _totalCells: number = 0;
  private _totalInstances: number = 0;
  /** Little-endian u32 view over the SAME record bytes (frozen packed-pose word read). */
  private _recordWords: Uint32Array = new Uint32Array(0);

  // --- GPU buffers (build/rebuild-time) ---
  private _instanceVbo: WebGLBuffer | undefined = undefined;
  private _gl1CompanionVbo: WebGLBuffer | undefined = undefined;

  // --- Wind (ADR 0059 step 1b, GL2 draw-time upload; WebGPU lane: `InstanceFieldSystem.setWind`) ---
  private _windUniforms: Float32Array | undefined = undefined;
  private _windHeight: number = 0;

  /** CPU mirrors of the frozen record data (kept for `rebuild()` and the GL1 companion). */
  private _instanceRecords: Float32Array;
  private _population: CellPopulation;
  private _recordPrototypeMap: Uint8Array | undefined;

  // --- Per-frame cull state (pooled, zero-GC) ---
  private _frameIndex: number = 0;
  private readonly _vpScratch: Matrix4 = new Matrix4();
  private readonly _frustumScratch: Frustum = new Frustum();
  private readonly _cellAabbScratch: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
  private readonly _poseScratch: InstancePose = { yawRadians: 0, uniformScale: 0 };
  /** Frozen per-view cull-params mirror (also the `cullParams` read surface). */
  private readonly _cullParams: CullParams[];
  private readonly _viewPlanes: [number, number, number, number][][];
  private readonly _mainCamPos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private _mainViewportHeightPx: number = 0;
  private _mainFovRadiansY: number = 0;
  /** Main-view LOD bucket per run, persisted for shadow views (bias applied at emission). */
  private _mainBucket: Int16Array = new Int16Array(0);
  /** Transient per-view keep/bucket marks (overwritten per view cull). */
  private _viewKeep: Uint8Array = new Uint8Array(0);
  private _viewBucket: Int16Array = new Int16Array(0);
  /** Frame-shared CPU budget counters (reset at main cull, consumed by every view). */
  private _cellsTested: number = 0;
  private _instancesSpent: number = 0;
  private _drawsSpent: number = 0;
  private _frameAborted: boolean = false;

  // --- Reachable-cell scratch (per-view, pooled, distance-sorted) ---
  private _reachCells: Uint32Array = new Uint32Array(256);
  private _reachDist: Float32Array = new Float32Array(256);
  private _reachCount: number = 0;
  private _keptCells: Uint32Array = new Uint32Array(256);
  private _keptCount: number = 0;
  private readonly _sortStack: Uint32Array = new Uint32Array(512);

  // --- Command output (pooled, per view) ---
  private readonly _sources: CpuIndirectDrawSource[];
  private readonly _viewCommands: InstanceFieldCommand[][];
  private readonly _bucketCommands: InstanceFieldCommand[][][];
  private readonly _bucketCounts: Uint32Array;
  private readonly _viewRevision: Uint32Array;

  // --- Opt-in cull probe (dual-lane test harness) ---
  private _probe: IndirectCullProbe | undefined = undefined;
  private readonly _frameSegments: IndirectSegmentCounts[] = [];
  /** Cursor over `_frameSegments`: segments are POOLED and reused across frames (zero-GC). */
  private _frameSegmentCount: number = 0;
  private _probeIndices: Uint32Array = new Uint32Array(1024);
  private _probeIndexCount: number = 0;

  /**
   * @throws On any frozen-contract invariant violation (fail fast, never a silently wrong field).
   */
  constructor(setup: InstanceFieldGLSetup) {
    const grid = setup.grid;
    if (
      !(grid.cellSize > 0) ||
      grid.cellCounts[0] < 1 ||
      grid.cellCounts[1] < 1 ||
      grid.cellCounts[2] < 1
    ) {
      throw new Error(
        "[InstanceFieldGL] Invalid CellGrid (cellSize > 0, counts >= 1 on every axis).",
      );
    }
    if (!(grid.origin.length >= 3)) {
      throw new Error("[InstanceFieldGL] CellGrid.origin must be a 3-component vector.");
    }
    if (setup.prototypes.length === 0) {
      throw new Error("[InstanceFieldGL] At least one prototype is required.");
    }
    if (setup.prototypes.length > 1 && setup.recordPrototypeMap === undefined) {
      throw new Error(
        "[InstanceFieldGL] Multi-prototype field requires the engine's per-record prototype map.",
      );
    }
    if (setup.geometryTable.length < setup.prototypes.length) {
      throw new Error("[InstanceFieldGL] geometryTable must cover every prototype.");
    }
    if (setup.materials.length < setup.prototypes.length) {
      throw new Error("[InstanceFieldGL] materials must cover every prototype.");
    }
    const viewCount = Math.min(Math.max(1, Math.floor(setup.options.maxViews)), MAX_INDIRECT_VIEWS);
    if (!(setup.options.cullPixelSize >= 0)) {
      throw new Error("[InstanceFieldGL] cullPixelSize must be >= 0.");
    }
    const budget = setup.options.cpuBudget;
    if (
      !(budget.maxCullRadius > 0) ||
      !(budget.maxCellsPerFrame > 0) ||
      !(budget.maxDrawsPerFrame > 0) ||
      !(budget.maxInstancesPerFrame > 0)
    ) {
      throw new Error("[InstanceFieldGL] cpuBudget counts/radius must be positive.");
    }
    const setupWindHeight = setup.windHeight ?? 0;
    const setupWindUniforms = setup.windUniforms;
    if (
      setupWindHeight > 0 &&
      (setupWindUniforms === undefined || setupWindUniforms.length !== 16)
    ) {
      throw new Error(
        "[InstanceFieldGL] windHeight > 0 requires a 16-float windUniforms `SwmWind` block.",
      );
    }

    this._gl = setup.gl;
    this._grid = grid;
    this._cellSize = grid.cellSize;
    this._halfCellDiagonal = Math.sqrt(3) * grid.cellSize * 0.5;
    this._cullPixelSize = setup.options.cullPixelSize;
    this._shadowLodBias = setup.options.shadowLodBias;
    this._cpuBudget = budget;
    this._viewCount = viewCount;
    this._instanceRecords = setup.instanceRecords;
    this._population = setup.population;
    this._recordPrototypeMap = setup.recordPrototypeMap;
    this._windUniforms = setupWindUniforms;
    this._windHeight = setupWindHeight;

    const protoCount = setup.prototypes.length;
    const bounds = new Float32Array(protoCount);
    const maxima: Float32Array[] = [];
    for (let p = 0; p < protoCount; p++) {
      const proto = setup.prototypes[p]!;
      bounds[p] = proto.boundingRadius;
      if (!(proto.boundingRadius > 0) || proto.lodBuckets.length <= 0) {
        throw new Error(
          `[InstanceFieldGL] Prototype '${proto.id}' needs radius > 0 and >= 1 LOD bucket.`,
        );
      }
      if (proto.lodBuckets.length > MAX_LOD_BUCKETS) {
        throw new Error(
          `[InstanceFieldGL] Prototype '${proto.id}' exceeds MAX_LOD_BUCKETS (${MAX_LOD_BUCKETS}).`,
        );
      }
      const asc = new Float32Array(proto.lodBuckets.length);
      for (let b = 0; b < proto.lodBuckets.length; b++) {
        const band = proto.lodBuckets[b]!;
        if (b === 0 && !(band.minProjectedSize > this._cullPixelSize)) {
          throw new Error(
            `[InstanceFieldGL] Prototype '${proto.id}': finest bucket minProjectedSize must be > cullPixelSize.`,
          );
        }
        if (b > 0 && !(band.maxProjectedSize > asc[b - 1]!)) {
          throw new Error(
            `[InstanceFieldGL] Prototype '${proto.id}': LOD bucket maxima must ascend.`,
          );
        }
        asc[b] = band.maxProjectedSize;
      }
      maxima.push(asc);
    }
    this._protoBounds = bounds;
    this._protoBucketMaxima = maxima;

    // Flatten the per-(prototype x bucket) mesh table into the backend geometry-slot space:
    // `slot = p * MAX_LOD_BUCKETS + bucket` (the `CpuDrawCommand.geometrySlot` unit).
    const flat: (Mesh | undefined)[] = new Array(protoCount * MAX_LOD_BUCKETS);
    for (let p = 0; p < protoCount; p++) {
      const chain = setup.geometryTable[p] ?? [];
      for (let b = 0; b < MAX_LOD_BUCKETS; b++) {
        flat[p * MAX_LOD_BUCKETS + b] = b < chain.length ? chain[b] : undefined;
      }
    }
    this._geometryTable = flat;
    this._materials = setup.materials;

    // Pool per-view cull-params + plane storage (bounded by the authored view cap).
    this._cullParams = [];
    this._viewPlanes = [];
    for (let v = 0; v < viewCount; v++) {
      const planes: [number, number, number, number][] = [];
      for (let i = 0; i < 6; i++) planes.push([0, 0, 0, 0]);
      this._viewPlanes.push(planes);
      this._cullParams.push({
        viewIndex: v,
        frustumPlanes: planes,
        viewportHeightPx: 0,
        fovRadiansY: 0,
        hzbEnabled: false,
        hzbSkip: false,
        segmentBase: 0,
      });
    }

    // Pool per-view command output.
    this._sources = [];
    this._viewCommands = [];
    this._bucketCommands = [];
    this._bucketCounts = new Uint32Array(MAX_LOD_BUCKETS);
    this._viewRevision = new Uint32Array(viewCount);
    for (let v = 0; v < viewCount; v++) {
      this._sources.push({
        producer: IndirectDrawProducer.INSTANCE_FIELD,
        commands: [],
        revision: 0,
      });
      this._viewCommands.push([]);
      const byBucket: InstanceFieldCommand[][] = [];
      for (let b = 0; b < MAX_LOD_BUCKETS; b++) byBucket.push([]);
      this._bucketCommands.push(byBucket);
    }

    this.rebuild();
  }

  // ---------------------------------------------------------------------------
  // Static population lifecycle (the only mutation path, frozen contract)
  // ---------------------------------------------------------------------------

  /**
   * Replaces the CPU-side population inputs BEFORE {@link rebuild}. The engine's cell sorter
   * owns the sort; the manager re-derives every derived structure and re-uploads the VBOs.
   * Calling `rebuild()` on an unchanged static population is a legal full rebuild.
   */
  public setPopulationData(
    instanceRecords: Float32Array,
    population: CellPopulation,
    recordPrototypeMap?: Uint8Array,
  ): void {
    this._instanceRecords = instanceRecords;
    this._population = population;
    this._recordPrototypeMap = recordPrototypeMap;
  }

  /** @inheritdoc (full rebuild: re-derive run map, re-upload VBOs, static population). */
  public rebuild(): void {
    this._buildRunMap();
    this._uploadVbos(this._gl);
  }

  /**
   * @inheritdoc — GL documented no-op: the CPU-cell lane never consumes the HZB and a camera
   * cut therefore needs no one-frame skip (see `IF-CAMERA-CUT-HZB-SKIP`).
   */
  public notifyCameraTeleport(): void {
    // No-op: CPU-cell cull is independent of the previous-frame occlusion pyramid.
  }

  /**
   * Live-swaps the wind state (HUD toggles, not just setup-time options) — mirror of the WebGPU
   * lane `InstanceFieldSystem.setWind` contract. `windHeight > 0` requires a 16-float `SwmWind`
   * block (same fail-fast rule as the constructor); height 0 = hard wind-off (the renderer only
   * uploads the block while this is > 0, and always writes the 0 gate otherwise).
   */
  public setWind(wind: Float32Array | undefined, windHeight: number): void {
    if (windHeight > 0 && (wind === undefined || wind.length !== 16)) {
      throw new Error(
        "[InstanceFieldGL] windHeight > 0 requires a 16-float windUniforms `SwmWind` block.",
      );
    }
    this._windUniforms = wind;
    this._windHeight = windHeight;
  }

  // ---------------------------------------------------------------------------
  // Per-frame cull entry points (called by the single-point GL draw hook)
  // ---------------------------------------------------------------------------

  /**
   * Prepares the main-view cull params (frozen `CullParams` mirror) from a VP matrix.
   * `fovRadiansY` is derived by the caller from the projection matrix
   * (`fov = 2 * atan(1 / proj[5])`); the frozen metric consumes it directly. The main
   * camera anchors the whole frame's LOD selection (ADR invariant): shadow views reuse
   * these metric inputs.
   */
  public prepareMainView(
    vp: Float32Array,
    camPos: { readonly x: number; readonly y: number; readonly z: number },
    viewportHeightPx: number,
    fovRadiansY: number,
  ): void {
    this._fillViewParams(0, vp, viewportHeightPx, fovRadiansY);
    this._mainCamPos.x = camPos.x;
    this._mainCamPos.y = camPos.y;
    this._mainCamPos.z = camPos.z;
    this._mainViewportHeightPx = viewportHeightPx;
    this._mainFovRadiansY = fovRadiansY;
    for (let v = 1; v < this._viewCount; v++) {
      const params = this._cullParams[v]!;
      params.viewportHeightPx = viewportHeightPx;
      params.fovRadiansY = fovRadiansY;
    }
  }

  /** Culls the MAIN view (view 0) and emits its command list. Resets the frame-shared CPU
   * budget counters and increments the frame index. */
  public cullMainView(): void {
    this._frameIndex++;
    this._cellsTested = 0;
    this._instancesSpent = 0;
    this._drawsSpent = 0;
    this._frameAborted = false;
    this._frameSegmentCount = 0;
    this._probeIndexCount = 0;
    // Main bucket is frame-global (shadow views consume it, biased): reset to "unknown".
    this._mainBucket.fill(-1, 0, this._totalRuns);
    this._cullView(0, true);
    this._emitViewCommands(0);
    this._viewRevision[0] = this._viewRevision[0]! + 1;
  }

  /** Prepares a SHADOW view (viewIndex >= 1) cull params from its VP matrix. The shadow
   * camera position is NOT stored: every distance metric (reachable prefilter, projected
   * size, LOD) is main-camera-anchored per IF-PROJECTED-SIZE, and the frustum comes from the
   * VP planes — the same param shape as the WebGPU lane's `prepareShadowView(viewIndex, vp)`. */
  public prepareShadowView(viewIndex: number, vp: Float32Array): void {
    if (viewIndex < 1 || viewIndex >= this._viewCount) return;
    this._fillViewParams(viewIndex, vp, this._mainViewportHeightPx, this._mainFovRadiansY);
  }

  /** Culls one shadow view and emits its command list: own reachable prefilter + conservative
   * frustum cull + own sub-pixel cull; LOD bucket always from the main camera (biased by
   * `shadowLodBias`). */
  public cullShadowView(viewIndex: number): void {
    if (viewIndex < 1 || viewIndex >= this._viewCount) return;
    this._cullView(viewIndex, false);
    this._emitViewCommands(viewIndex);
    this._viewRevision[viewIndex] = this._viewRevision[viewIndex]! + 1;
  }

  // ---------------------------------------------------------------------------
  // Cull implementation (per view)
  // ---------------------------------------------------------------------------

  private _fillViewParams(
    viewIndex: number,
    vp: Float32Array,
    viewportHeightPx: number,
    fovRadiansY: number,
  ): void {
    this._vpScratch.data.set(vp);
    this._frustumScratch.setFromMatrix(this._vpScratch);
    const planes = this._viewPlanes[viewIndex]!;
    // Frozen order: right, left, bottom, top, near, far (identical to `Frustum.planes`).
    for (let i = 0; i < 6; i++) {
      const p = planes[i]!;
      const b = i * 4;
      p[0] = this._frustumScratch.planes[b]!;
      p[1] = this._frustumScratch.planes[b + 1]!;
      p[2] = this._frustumScratch.planes[b + 2]!;
      p[3] = this._frustumScratch.planes[b + 3]!;
    }
    const params = this._cullParams[viewIndex]!;
    params.viewportHeightPx = viewportHeightPx;
    params.fovRadiansY = fovRadiansY;
    params.hzbEnabled = false;
    params.hzbSkip = false;
    params.segmentBase = 0;
  }

  /** One view cull. Phase A: reachable prefilter -> distance sort -> budget + conservative
   * frustum cull + main-driven LOD bucket marks. Phase B (`_emitViewCommands`) merges runs in
   * VBO order and emits commands.
   * Distance metrics (reachable prefilter + projected size) are ALWAYS anchored to the MAIN
   * camera (`_mainCamPos`): a directional cascade camera sits 200 m behind its box (`center -
   * direction * 200`), so measuring `maxCullRadius` or the projected size against it would
   * drop every cell and every run (IF-PROJECTED-SIZE is a main-camera metric by contract).
   * The shadow frustum still gates through the per-view planes below.
   */
  private _cullView(viewIndex: number, isMain: boolean): void {
    const planes = this._viewPlanes[viewIndex]!;
    const viewPortH = this._cullParams[viewIndex]!.viewportHeightPx;
    const viewFov = this._cullParams[viewIndex]!.fovRadiansY;
    const mainCamX = this._mainCamPos.x;
    const mainCamY = this._mainCamPos.y;
    const mainCamZ = this._mainCamPos.z;

    // Phase A-1: reachable-cell gather (conservative outer bound, never authoritative).
    this._reachCount = 0;
    let reachCells = this._reachCells;
    let reachDist = this._reachDist;
    for (let c = 0; c < this._totalCells; c++) {
      const dx = this._cellsCenter[c * 3]! - mainCamX;
      const dy = this._cellsCenter[c * 3 + 1]! - mainCamY;
      const dz = this._cellsCenter[c * 3 + 2]! - mainCamZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Any part of the cell within the radius is testable: subtract the half diagonal.
      if (dist - this._halfCellDiagonal > this._cpuBudget.maxCullRadius) continue;
      const idx = this._reachCount++;
      if (idx >= reachCells.length) {
        // `_growReach` REPLACES both backing arrays — refresh the local aliases, otherwise the
        // stale length keeps re-triggering growth on every cell past 256 (256→512→…→2^30 OOM).
        this._growReach(idx + 1);
        reachCells = this._reachCells;
        reachDist = this._reachDist;
      }
      reachCells[idx] = c;
      reachDist[idx] = dist;
    }
    // Phase A-2: process cells in distance order so over-budget drops hit the FARTHEST first.
    this._sortByKey(reachCells, reachDist, this._reachCount);
    this._keptCount = 0;
    const keep = this._viewKeep;
    const bucket = this._viewBucket;
    keep.fill(0, 0, this._totalRuns);
    bucket.fill(-1, 0, this._totalRuns);
    const cellAabb = this._cellAabbScratch;
    for (let r = 0; r < this._reachCount; r++) {
      if (this._frameAborted) break;
      // Budget: frame-shared cap on cells TESTED.
      if (this._cellsTested >= this._cpuBudget.maxCellsPerFrame) {
        this._frameAborted = true;
        break;
      }
      this._cellsTested++;
      const cellIdx = reachCells[r]!;
      const cellMax = this._cellsMaxRadius[cellIdx]!;
      fillCellWorldBounds(this._cellsCellId[cellIdx]!, this._grid, cellAabb);
      // Grow the cell AABB by the cell's max instance radius: every instance sphere is then
      // provably contained, so the frozen conservative test has no false negatives
      // (IF-CULL-NO-FALSE-NEGATIVE).
      cellAabb.min[0] -= cellMax;
      cellAabb.min[1] -= cellMax;
      cellAabb.min[2] -= cellMax;
      cellAabb.max[0] += cellMax;
      cellAabb.max[1] += cellMax;
      cellAabb.max[2] += cellMax;
      if (!aabbVisibleConservative(planes, cellAabb)) continue;

      const cellCenterX = this._cellsCenter[cellIdx * 3]!;
      const cellCenterY = this._cellsCenter[cellIdx * 3 + 1]!;
      const cellCenterZ = this._cellsCenter[cellIdx * 3 + 2]!;
      const firstRun = this._cellsFirstRun[cellIdx]!;
      const runCount = this._cellsRunCount[cellIdx]!;
      let cellKept = false;
      for (let i = 0; i < runCount; i++) {
        const run = firstRun + i;
        // Budget: frame-shared cap on instances drawn.
        if (this._instancesSpent >= this._cpuBudget.maxInstancesPerFrame) break;
        const proto = this._runProto[run]!;
        const runRadius = this._runMaxRadius[run]!;
        const dx = cellCenterX - mainCamX;
        const dy = cellCenterY - mainCamY;
        const dz = cellCenterZ - mainCamZ;
        const runDist = Math.max(
          0,
          Math.sqrt(dx * dx + dy * dy + dz * dz) - this._halfCellDiagonal,
        );
        // Projected size is a MAIN-camera metric (IF-PROJECTED-SIZE): `viewPortH`/`viewFov`
        // are the primary-view inputs forwarded to every shadow view, so `px` is the main
        // projection this view reuses — never the shadow camera's distance.
        const px = projectedDiameterPixels(runRadius, runDist, viewPortH, viewFov);
        // Sub-pixel: dropped in EVERY view (main-camera metric) — the frozen `cullPixelSize`.
        if (px < this._cullPixelSize) {
          if (isMain) this._mainBucket[run] = this._pickBucket(proto, px);
          continue;
        }
        let b = this._mainBucket[run]!;
        if (isMain) {
          b = this._pickBucket(proto, px);
          this._mainBucket[run] = b;
        } else if (b < 0) {
          // Main never reached/kept this run (main budget/frustum drop): the bucket stays a
          // pure function of the MAIN projection — `px` above already IS that projection.
          b = this._pickBucket(proto, px);
          this._mainBucket[run] = b;
        }
        // Coarse shadow bias, applied to main-kept AND on-demand recomputed runs (frozen
        // contract: `max(selectedBucket - shadowLodBias, 0)`). Bucket 0 is COARSEST and
        // bucketCount-1 finest (InstanceField.ts), so a positive bias shifts toward coarser
        // geometry — never `b + bias` (that would make shadows finer).
        if (!isMain && this._shadowLodBias > 0) {
          b = Math.max(0, b - this._shadowLodBias);
        }
        keep[run] = 1;
        bucket[run] = b;
        this._instancesSpent += this._runCount[run]!;
        cellKept = true;
      }
      if (cellKept) {
        const k = this._keptCount++;
        if (k >= this._keptCells.length) this._growKept(k + 1);
        this._keptCells[k] = cellIdx;
      }
    }
  }

  /** Frozen band lookup: the ascending `maxProjectedSize` sequence picks the coarsest bucket
   * whose band still covers `px`; out-of-range values clamp to the coarsest bucket. */
  private _pickBucket(proto: number, px: number): number {
    const asc = this._protoBucketMaxima[proto]!;
    if (!(px > asc[0]!)) return 0;
    for (let b = 1; b < asc.length; b++) {
      if (px <= asc[b]!) return b;
    }
    return asc.length - 1;
  }

  /** Phase B: iterate KEPT cells in VBO/cell order (gap = dropped cells break runs), merge
   * contiguous same-(geometry, material, bucket) runs into one command per maximal run, and
   * emit per (view x bucket) so `getSource` exposes commands sorted by (view, bucket). */
  private _emitViewCommands(viewIndex: number): void {
    // Re-sort kept cells by first run (VBO/cell order) for the merge pass; budget drops were
    // already decided in distance order, so this ordering never re-introduces farthest cells.
    this._sortKeptByFirstRun(this._keptCells, this._keptCount);
    const keep = this._viewKeep;
    const bucket = this._viewBucket;
    const bucketCommands = this._bucketCommands[viewIndex]!;
    const bucketCounts = this._bucketCounts;
    for (let b = 0; b < MAX_LOD_BUCKETS; b++) bucketCounts[b] = 0;

    let openSlot = -1;
    let openBucket = -1;
    let openProto = -1;
    let openStart = 0;
    let openCount = 0;
    let openEnd = 0;
    const flush = (): void => {
      if (openSlot < 0) return;
      this._flushCommand(
        viewIndex,
        bucketCommands[openBucket]!,
        openBucket,
        openProto,
        openStart,
        openCount,
      );
    };
    for (let c = 0; c < this._keptCount; c++) {
      const cellIdx = this._keptCells[c]!;
      const firstRun = this._cellsFirstRun[cellIdx]!;
      const runCount = this._cellsRunCount[cellIdx]!;
      for (let i = 0; i < runCount; i++) {
        const run = firstRun + i;
        if (keep[run] !== 1) continue;
        const b = bucket[run]!;
        const proto = this._runProto[run]!;
        const start = this._runStart[run]!;
        const count = this._runCount[run]!;
        // Merge rule: same (geometry, material, bucket) AND VBO-contiguous.
        if (openSlot >= 0 && openBucket === b && openProto === proto && openEnd === start) {
          openCount += count;
          openEnd += count;
          continue;
        }
        flush();
        openSlot = run;
        openBucket = b;
        openProto = proto;
        openStart = start;
        openCount = count;
        openEnd = start + count;
      }
    }
    flush();

    // Materialize the flat (view, bucket)-ordered command list for the draw hook + probe.
    const flat = this._viewCommands[viewIndex]!;
    flat.length = 0;
    for (let b = 0; b < MAX_LOD_BUCKETS; b++) {
      const list = bucketCommands[b]!;
      const n = bucketCounts[b]!;
      for (let i = 0; i < n; i++) flat.push(list[i]!);
    }
    // Opt-in probe accumulation (dual-lane harness): per-segment counts + expanded indices.
    if (this._probe) {
      for (let b = 0; b < MAX_LOD_BUCKETS; b++) {
        const n = bucketCounts[b]!;
        if (n === 0) continue;
        let segInstances = 0;
        const list = bucketCommands[b]!;
        for (let i = 0; i < n; i++) {
          const cmd = list[i]!;
          for (let k = 0; k < cmd.instanceCount; k++) {
            this._appendProbeIndex(cmd.instanceBase + k);
          }
          segInstances += cmd.instanceCount;
        }
        const seg = this._nextSegment();
        seg.viewIndex = viewIndex;
        seg.bucketIndex = b;
        seg.count = segInstances;
      }
    }
  }

  private _flushCommand(
    viewIndex: number,
    list: InstanceFieldCommand[],
    bucket: number,
    proto: number,
    start: number,
    count: number,
  ): void {
    // Budget: frame-shared cap on direct draws (`drawElementsInstanced` calls).
    if (this._drawsSpent >= this._cpuBudget.maxDrawsPerFrame) return;
    const geometrySlot = proto * MAX_LOD_BUCKETS + bucket;
    const mesh = this._geometryTable[geometrySlot];
    if (!mesh) return;
    this._drawsSpent++;
    const index = this._bucketCounts[bucket]!;
    let cmd = list[index];
    if (!cmd) {
      cmd = new InstanceFieldCommand();
      list[index] = cmd;
    }
    this._bucketCounts[bucket] = index + 1;
    cmd.viewIndex = viewIndex;
    cmd.bucketIndex = bucket;
    cmd.geometrySlot = geometrySlot;
    cmd.materialSlot = proto;
    cmd.indexCount = mesh.count;
    cmd.firstIndex = 0;
    cmd.baseVertex = 0;
    cmd.instanceBase = start;
    cmd.instanceCount = count;
    cmd.instanceAttrByteOffset = start * INSTANCE_RECORD_BYTES;
  }

  // ---------------------------------------------------------------------------
  // Probe (opt-in, dual-lane test harness)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  public installCullProbe(probe: IndirectCullProbe): void {
    this._probe = probe;
  }

  /**
   * Not part of the frozen runtime surface: the GL renderer hook calls it once per frame
   * AFTER the opaque draw, when every view of the frame was culled. Builds the current
   * frame's {@link FieldVisibleSets} snapshot and notifies the installed probe (if any).
   */
  public flushCullProbe(): void {
    if (!this._probe) return;
    // Trim the pooled table to this frame's live rows before exposing it (pool reuse keeps
    // stale tail rows otherwise; the consumer reads `.length` as the authoritative count).
    this._frameSegments.length = this._frameSegmentCount;
    const sets: FieldVisibleSets = {
      frameIndex: this._frameIndex,
      params: this._cullParams,
      segmentCounts: this._frameSegments,
      visibleIndices: this._probeIndices.subarray(0, this._probeIndexCount),
    };
    this._probe.onCullFrame(sets);
  }

  // ---------------------------------------------------------------------------
  // Read surfaces consumed by the single-point GL draw hook
  // ---------------------------------------------------------------------------

  /** @inheritdoc — the read-only per-view cull-params mirror (frozen `CullParams`). */
  public get cullParams(): readonly CullParams[] {
    return this._cullParams;
  }

  /** Frozen `CpuIndirectDrawSource` of one view — the draw loop MUST re-read whenever
   * `source.revision` changes (anti-stale guard). */
  public getSource(viewIndex: number): CpuIndirectDrawSource | undefined {
    if (viewIndex < 0 || viewIndex >= this._viewCount) return undefined;
    const source = this._sources[viewIndex]!;
    source.commands = this._viewCommands[viewIndex]!;
    source.revision = this._viewRevision[viewIndex]!;
    return source;
  }

  /** Backend geometry-table lookup (`geometrySlot` = `p * MAX_LOD_BUCKETS + bucket`). */
  public getGeometry(geometrySlot: number): Mesh | undefined {
    if (geometrySlot < 0 || geometrySlot >= this._geometryTable.length) return undefined;
    return this._geometryTable[geometrySlot];
  }

  /** Backend material-table lookup (slot = prototype index). */
  public getMaterial(
    materialSlot: number,
  ): { readonly material: AbstractMaterial; readonly alphaTest: number } | undefined {
    return this._materials[materialSlot];
  }

  /** The single cell-sorted 16-byte-record instance VBO (STATIC_DRAW, engine-owned bytes). */
  public get instanceVbo(): WebGLBuffer | undefined {
    return this._instanceVbo;
  }

  /** WebGL1-only unpacked pose companion VBO (yaw, scale as two f32 per record). */
  public get gl1CompanionVbo(): WebGLBuffer | undefined {
    return this._gl1CompanionVbo;
  }

  /** Field instance count backing the record VBO. */
  public get instanceCount(): number {
    return this._totalInstances;
  }

  /** Authored view cap (clamped into `[1, MAX_INDIRECT_VIEWS]`); the renderer consumes it to
   * allocate shadow-view indices per field, never culling more shadow views than the budget. */
  public get maxViews(): number {
    return this._viewCount;
  }

  /** Currently bound per-field wind vector set (4 x vec4 for the shared curve), or `undefined`. */
  public get windUniforms(): Float32Array | undefined {
    return this._windUniforms;
  }

  /** Currently bound wind bend height (samples), `0` disables wind bending. */
  public get windHeight(): number {
    return this._windHeight;
  }

  // ---------------------------------------------------------------------------
  // Build / rebuild internals
  // ---------------------------------------------------------------------------

  /** Derives the per-(cell x prototype) run map from the engine-owned cell-sorted records. */
  private _buildRunMap(): void {
    const records = this._population.records;
    const protoMap = this._recordPrototypeMap;
    let total = 0;
    let prevCell = -1;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      if (rec.cellId < prevCell) {
        throw new Error(
          "[InstanceFieldGL] CellPopulation.records must be sorted ascending by cellId.",
        );
      }
      if (rec.instanceOffset < 0 || rec.instanceCount < 0) {
        throw new Error("[InstanceFieldGL] Negative cell instance range.");
      }
      prevCell = rec.cellId;
      total += rec.instanceCount;
    }
    if (protoMap && protoMap.length < total) {
      throw new Error("[InstanceFieldGL] recordPrototypeMap shorter than the record count.");
    }
    if (this._instanceRecords.length * 4 < total * INSTANCE_RECORD_BYTES) {
      throw new Error(
        "[InstanceFieldGL] instanceRecords buffer smaller than population.totalInstances.",
      );
    }
    this._totalInstances = total;
    this._recordWords = new Uint32Array(
      this._instanceRecords.buffer,
      this._instanceRecords.byteOffset,
      this._instanceRecords.byteLength / 4,
    );
    if (total === 0) {
      this._totalRuns = 0;
      this._totalCells = 0;
      return;
    }

    // First pass: count runs (cell-first, prototype-contiguous within a cell).
    let runCount = 0;
    let cellCount = 0;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      if (rec.instanceCount === 0) continue;
      cellCount++;
      let prevProto = -1;
      for (let k = 0; k < rec.instanceCount; k++) {
        const p = protoMap ? protoMap[rec.instanceOffset + k]! : 0;
        if (p !== prevProto) {
          runCount++;
          prevProto = p;
        }
      }
    }
    this._ensureRunCapacity(runCount);
    this._ensureCellCapacity(cellCount);

    // Second pass: fill the run map + cell map (VBO order = cellId order, then proto order).
    const runProto = this._runProto;
    const runStart = this._runStart;
    const runCountArr = this._runCount;
    const runMaxRadius = this._runMaxRadius;
    const runCellIdx = this._runCellIdx;
    const cellsCellId = this._cellsCellId;
    const cellsFirstRun = this._cellsFirstRun;
    const cellsRunCount = this._cellsRunCount;
    const cellsMaxRadius = this._cellsMaxRadius;
    const cellsCenter = this._cellsCenter;
    const words = this._recordWords;
    let r = 0;
    let c = 0;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      if (rec.instanceCount === 0) continue;
      cellsCellId[c] = rec.cellId;
      cellsFirstRun[c] = r;
      cellsRunCount[c] = 0;
      let cellMax = 0;
      let k = 0;
      while (k < rec.instanceCount) {
        const p = protoMap ? protoMap[rec.instanceOffset + k]! : 0;
        let j = k + 1;
        while (j < rec.instanceCount && (protoMap ? protoMap[rec.instanceOffset + j]! : 0) === p) {
          j++;
        }
        runProto[r] = p;
        runStart[r] = rec.instanceOffset + k;
        runCountArr[r] = j - k;
        // Per-run max instance radius = prototype bound x max record scale (cull grow bound).
        let runMax = 0;
        for (let q = k; q < j; q++) {
          unpackInstancePose(words[(rec.instanceOffset + q) * 4 + 3]!, this._poseScratch);
          const rad = this._protoBounds[p]! * this._poseScratch.uniformScale;
          if (rad > runMax) runMax = rad;
          if (rad > cellMax) cellMax = rad;
        }
        runMaxRadius[r] = runMax;
        runCellIdx[r] = c;
        cellsRunCount[c] = cellsRunCount[c]! + 1;
        r++;
        k = j;
      }
      cellsMaxRadius[c] = cellMax;
      // Cell center (metric + reachability input).
      const w = this._grid.cellCounts[0];
      const h = this._grid.cellCounts[1];
      const x = (rec.cellId % w) * this._cellSize;
      const y = (((rec.cellId / w) | 0) % h) * this._cellSize;
      const z = ((rec.cellId / (w * h)) | 0) * this._cellSize;
      cellsCenter[c * 3] = this._grid.origin[0] + x + this._cellSize * 0.5;
      cellsCenter[c * 3 + 1] = this._grid.origin[1] + y + this._cellSize * 0.5;
      cellsCenter[c * 3 + 2] = this._grid.origin[2] + z + this._cellSize * 0.5;
      c++;
    }
    this._totalRuns = r;
    this._totalCells = c;
  }

  /** Uploads the cell-sorted record VBO and (WebGL1) the unpacked pose companion VBO. The
   * record buffer is byte-identical on every tier; the companion is a separate upload. Uploads
   * on the passed live context (never a stored reference that could lag a restore). */
  private _uploadVbos(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this._totalInstances === 0) return;
    this._instanceVbo ??= gl.createBuffer() ?? undefined;
    if (!this._instanceVbo) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this._instanceRecords.subarray(0, this._totalInstances * 4),
      gl.STATIC_DRAW,
    );

    // WebGL1 companion: yaw/scale as two f32 per record (frozen `unpackInstancePose`, the
    // engine cell sorter's own unpacking). GL2 never binds it (reads the packed u32 instead).
    const companion = new Float32Array(this._totalInstances * GL1_COMPANION_FLOATS);
    const words = this._recordWords;
    for (let i = 0; i < this._totalInstances; i++) {
      unpackInstancePose(words[i * 4 + 3]!, this._poseScratch);
      companion[i * 2] = this._poseScratch.yawRadians;
      companion[i * 2 + 1] = this._poseScratch.uniformScale;
    }
    this._gl1CompanionVbo ??= gl.createBuffer() ?? undefined;
    if (!this._gl1CompanionVbo) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._gl1CompanionVbo);
    gl.bufferData(gl.ARRAY_BUFFER, companion, gl.STATIC_DRAW);
  }

  /** Deletes the GL buffers this manager owns (teardown path; the renderer destroys every
   * registered field in `AbstractWebGLRenderer.destroy()`). Idempotent. */
  public dispose(): void {
    const gl = this._gl;
    if (this._instanceVbo) gl.deleteBuffer(this._instanceVbo);
    if (this._gl1CompanionVbo) gl.deleteBuffer(this._gl1CompanionVbo);
    this._instanceVbo = undefined;
    this._gl1CompanionVbo = undefined;
  }

  /**
   * Drops the GL buffer handles on `webglcontextlost` (the old context's object store is wiped at
   * restore). No `deleteBuffer` here: calls during the lost window are no-ops at best and the
   * handles are dead anyway. The CPU mirrors (`_instanceRecords`, `_population`) stay intact so
   * {@link onContextRestored} can re-upload onto the restored context.
   */
  public onContextLost(): void {
    this._instanceVbo = undefined;
    this._gl1CompanionVbo = undefined;
  }

  /**
   * Re-arms the field on the RESTORED context: the previous handles are dead and dropped, and the
   * record VBOs are re-uploaded from the untouched CPU mirrors (on the caller's live context `gl`).
   * The stored `_gl` binding is intentionally unchanged — the browser restores the SAME context
   * object, so the readonly constructor binding keeps its validity across the lost/restored cycle.
   * Invoked by the renderer's `onContextRestored`.
   */
  public onContextRestored(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this._instanceVbo = undefined;
    this._gl1CompanionVbo = undefined;
    this._uploadVbos(gl);
  }

  // --- Capacity management (pooled, geometric growth only) ---

  private _ensureRunCapacity(runCount: number): void {
    if (this._runProto.length >= runCount && this._mainBucket.length >= runCount) return;
    const n = Math.max(runCount, this._runProto.length * 2, this._mainBucket.length * 2, 64);
    this._runProto = new Uint8Array(n);
    this._runStart = new Uint32Array(n);
    this._runCount = new Uint32Array(n);
    this._runMaxRadius = new Float32Array(n);
    this._runCellIdx = new Uint32Array(n);
    // Per-run marks ride the same capacity (resized together, never silently truncated).
    this._mainBucket = new Int16Array(n);
    this._viewKeep = new Uint8Array(n);
    this._viewBucket = new Int16Array(n);
  }

  private _ensureCellCapacity(cellCount: number): void {
    if (this._cellsCellId.length >= cellCount) return;
    const n = Math.max(cellCount, this._cellsCellId.length * 2, 64);
    this._cellsCellId = new Uint32Array(n);
    this._cellsFirstRun = new Uint32Array(n);
    this._cellsRunCount = new Uint16Array(n);
    this._cellsMaxRadius = new Float32Array(n);
    this._cellsCenter = new Float32Array(n * 3);
  }

  private _growReach(required: number): void {
    const n = Math.max(required, this._reachCells.length * 2);
    const cells = new Uint32Array(n);
    cells.set(this._reachCells.subarray(0, this._reachCount));
    this._reachCells = cells;
    const dist = new Float32Array(n);
    dist.set(this._reachDist.subarray(0, this._reachCount));
    this._reachDist = dist;
  }

  private _growKept(required: number): void {
    const n = Math.max(required, this._keptCells.length * 2);
    const kept = new Uint32Array(n);
    kept.set(this._keptCells.subarray(0, this._keptCount));
    this._keptCells = kept;
  }

  private _appendProbeIndex(value: number): void {
    if (this._probeIndexCount >= this._probeIndices.length) {
      const n = Math.max(this._probeIndexCount * 2, 256);
      const bigger = new Uint32Array(n);
      bigger.set(this._probeIndices.subarray(0, this._probeIndexCount));
      this._probeIndices = bigger;
    }
    this._probeIndices[this._probeIndexCount] = value;
    this._probeIndexCount++;
  }

  private _nextSegment(): IndirectSegmentCounts {
    let seg = this._frameSegments[this._frameSegmentCount];
    if (!seg) {
      // Grow the pooled segment table on demand (bounded: <= views x MAX_LOD_BUCKETS/frame).
      seg = { viewIndex: 0, bucketIndex: 0, count: 0 };
      this._frameSegments.push(seg);
    }
    this._frameSegmentCount++;
    seg.viewIndex = 0;
    seg.bucketIndex = 0;
    seg.count = 0;
    return seg;
  }

  /** Iterative quicksort (median-of-three, small-range insertion) on `indices` keyed by
   * `keys` ascending — zero per-frame allocation. */
  private _sortByKey(indices: Uint32Array, keys: Float32Array, length: number): void {
    if (length < 2) return;
    const stack = this._sortStack;
    let sp = 0;
    stack[sp++] = 0;
    stack[sp++] = length - 1;
    while (sp > 0) {
      const hi = stack[--sp]!;
      const lo = stack[--sp]!;
      if (hi - lo < 24) {
        for (let i = lo + 1; i <= hi; i++) {
          const cur = indices[i]!;
          const key = keys[cur]!;
          let j = i - 1;
          while (j >= lo && keys[indices[j]!]! > key) {
            indices[j + 1] = indices[j]!;
            j--;
          }
          indices[j + 1] = cur;
        }
        continue;
      }
      const mid = (lo + hi) >>> 1;
      const ka = keys[indices[lo]!]!;
      const kb = keys[indices[mid]!]!;
      const kc = keys[indices[hi]!]!;
      let pivot: number;
      if (ka < kb) pivot = kb < kc ? kb : ka < kc ? kc : ka;
      else pivot = ka < kc ? ka : kb < kc ? kc : kb;
      let i = lo - 1;
      let j = hi + 1;
      for (;;) {
        do i++;
        while (keys[indices[i]!]! < pivot);
        do j--;
        while (keys[indices[j]!]! > pivot);
        if (i >= j) break;
        const t = indices[i]!;
        indices[i] = indices[j]!;
        indices[j] = t;
      }
      // Push the LARGER partition, continue on the smaller -> stack depth stays O(log n).
      if (j - lo < hi - j) {
        stack[sp++] = j + 1;
        stack[sp++] = hi;
      } else {
        stack[sp++] = lo;
        stack[sp++] = j;
      }
    }
  }

  /** Sorts the kept-cell list by first-run index (VBO/cell order) for the merge pass. */
  private _sortKeptByFirstRun(cells: Uint32Array, length: number): void {
    if (length < 2) return;
    const stack = this._sortStack;
    let sp = 0;
    stack[sp++] = 0;
    stack[sp++] = length - 1;
    while (sp > 0) {
      const hi = stack[--sp]!;
      const lo = stack[--sp]!;
      if (hi - lo < 24) {
        for (let i = lo + 1; i <= hi; i++) {
          const cur = cells[i]!;
          const key = this._cellsFirstRun[cur]!;
          let j = i - 1;
          while (j >= lo && this._cellsFirstRun[cells[j]!]! > key) {
            cells[j + 1] = cells[j]!;
            j--;
          }
          cells[j + 1] = cur;
        }
        continue;
      }
      const mid = (lo + hi) >>> 1;
      const ka = this._cellsFirstRun[cells[lo]!]!;
      const kb = this._cellsFirstRun[cells[mid]!]!;
      const kc = this._cellsFirstRun[cells[hi]!]!;
      let pivot: number;
      if (ka < kb) pivot = kb < kc ? kb : ka < kc ? kc : ka;
      else pivot = ka < kc ? ka : kb < kc ? kc : kb;
      let i = lo - 1;
      let j = hi + 1;
      for (;;) {
        do i++;
        while (this._cellsFirstRun[cells[i]!]! < pivot);
        do j--;
        while (this._cellsFirstRun[cells[j]!]! > pivot);
        if (i >= j) break;
        const t = cells[i]!;
        cells[i] = cells[j]!;
        cells[j] = t;
      }
      if (j - lo < hi - j) {
        stack[sp++] = j + 1;
        stack[sp++] = hi;
      } else {
        stack[sp++] = lo;
        stack[sp++] = j;
      }
    }
  }
}
