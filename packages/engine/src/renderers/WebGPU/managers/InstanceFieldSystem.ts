/**
 * ADR 0059 step 1 (P1-2) -- WebGPU lane of the `InstanceField` contract: ONE per-field node
 * manager that owns the GPU cull-compute + indirect-draw path (`instance_cull.wgsl` +
 * `field_pull.wgsl`). Implements the frozen `InstanceFieldRuntimeApi` (core/InstanceField.ts
 * is the single contract surface). GL CPU-cell fallback: Frank's
 * `renderers/gl/managers/InstanceFieldGL.ts`; 3rd consumer of the indirect-draw contract:
 * `GpuParticleSystemHost` (interface alignment only).
 *
 * SCOPE (P1): static population, mode-A main-view occlusion (previous-frame pyramid) over
 * frustum+size, mode-C shadow views (frustum+size only, no HZB), bucket-routed compaction from
 * day 1 (IF-CULL-ROUTING), clamp-at-capacity (IF-BUDGET), one-frame camera-cut HZB skip
 * (IF-CAMERA-CUT-HZB-SKIP). Two-phase mode 2B is spec'd in `instance_cull.wgsl`, not built.
 *
 * RENDERER RELATION: the renderer owns a registration LIST (`_instanceFields`, mirroring the
 * particle list) and drives the per-frame coordinator + single-point pass hooks; this system is
 * field-scoped and never queries the scene graph. The `InstanceFieldRenderHost` (implemented by
 * `WebGPURenderer`, nullable for the pure-TS S2 scaffold) hands in every external dependency at
 * attach time -- device, shared bind-group layouts/groups, the fully composed WGSL module
 * sources, the previous-frame pyramid handle and the geometry-cache pinning bridge.
 *
 * WGSL SINGLE SOURCE: `chunks/instance_field_structs.wgsl` is the SOLE declaration of
 * `FieldInfo`/`CullParams` and the 11 `@group(2)` bindings shared by the cull compute module
 * and the pulled-draw module -- the host composes both module sources from it, so the blob
 * layout and the bind-group slot numbering can never drift between the two consumers.
 * (S2 fold, lead-authorized: the field-data group moved from 4 to 2 so the lane fits the
 * `maxBindGroups` spec minimum of 4 = slots {0,2,3}; the shared-view slot stays at group 3.)
 *
 * V1 geometry constraint (documented refinement of the plan text, not of the frozen contract):
 * `Mesh` is GL-only and holds no geometry on the WebGPU tier, so the WebGPU geometry table is
 * `GeometryDataInterface` per (prototype x bucket). ALL prototypes of a field must share the
 * IDENTICAL geometry object per bucket index (validated at setup, fail-fast): the per-segment
 * (view x bucket) indirect args then carry one valid geometry word set and the draw hook binds
 * one geometry per bucket regardless of which prototype a survivor belongs to. Indexed geometry
 * is required (throw otherwise) -- `drawIndexedIndirect` reads an index count. Geometry is
 * pinned in the renderer's geometry cache ONCE per bucket at attach (a scratch-object refcount);
 * the draw path only READS the stored cache entries (no per-frame pinning).
 *
 * PARAM-BLOCK LAYOUT (per field, 256 B per (view x bucket) block): the block index `k` IS the
 * segment base `bv` -- block `k`'s `segmentBase` field equals `k`, written once at attach. The
 * cull coordinator refreshes the per-frame cull data (planes / metric / hzb flags / cullMode)
 * in block `viewIndex * MAX_LOD_BUCKETS` and binds that block; the draw binds block
 * `viewIndex * MAX_LOD_BUCKETS + bucket` (only `segmentBase` + the static `fieldInfo.pageCapacity`
 * are read there). Both consumers therefore resolve the exact same page base for the same
 * segment -- no `indirect-first-instance`, no per-draw uniforms.
 *
 * PROBE (opt-in, dual-lane harness): one staging pair per field + a pending flag; the renderer
 * records the copies at the end of `render()` (before `ce.finish()`), kicks `mapAsync` after
 * submit and polls at the next frame head. Drop-while-pending -- latency self-corrects, the
 * render path never depends on it (ADR 0059 "no CPU readback").
 */
import {
  INDIRECT_SEGMENT_HEADER_BYTES,
  INSTANCE_RECORD_BYTES,
  MAX_INDIRECT_VIEWS,
  MAX_LOD_BUCKETS,
  type CullParams,
  type FieldVisibleSets,
  type IndirectCullProbe,
  type IndirectSegmentCounts,
  type InstanceFieldOptions,
  type InstanceFieldRuntimeApi,
  type PrototypeDescriptor,
} from "../../../core/InstanceField.js";
import type { Texture } from "../../../core/textures/index.js";
import type { GeometryDataInterface } from "../../../interfaces/index.js";
import { Frustum, Matrix4 } from "../../../math/index.js";
import { NORMAL_TARGET_FORMAT } from "./NormalOutputWrapper.js";
import type { HzbFieldPyramidAccess } from "./HzbOcclusionSystem.js";
import type { WebGPUGeoCacheEntry } from "./GPUGeometryCache.js";

/** Frozen segment-table dimension: `MAX_INDIRECT_VIEWS * MAX_LOD_BUCKETS` (16 x 8 = 128). */
const FIELD_SEGMENTS = MAX_INDIRECT_VIEWS * MAX_LOD_BUCKETS;

/** Per-(view x bucket) cull/param block size in bytes (see the class doc / WGSL struct). */
const CULL_PARAM_BLOCK_BYTES = 256;

/** `FieldInfo` uniform size (one vec4-aligned 32 B struct, see instance_field_structs.wgsl). */
const FIELD_INFO_BYTES = 48;

/** Word offsets inside a cull-param block (bytes, little-endian, see the WGSL `CullParams`). */
const CULL_OFFSET_VIEWPORT_HEIGHT_PX = 96;
const CULL_OFFSET_FOV_RADIANS_Y = 100;
const CULL_OFFSET_HZB_ENABLED = 104;
const CULL_OFFSET_HZB_SKIP = 108;
const CULL_OFFSET_SEGMENT_BASE = 112;
const CULL_OFFSET_CULL_MODE = 116;

/** Word offsets inside the `FieldInfo` uniform (bytes). */
const INFO_OFFSET_PAGE_CAPACITY = 0;
const INFO_OFFSET_PROTOTYPE_COUNT = 4;
const INFO_OFFSET_INSTANCE_COUNT = 8;
const INFO_OFFSET_HZB_MIP_COUNT = 12;
const INFO_OFFSET_CULL_PIXEL_SIZE = 16;
const INFO_OFFSET_ALPHA_TEST = 20;
const INFO_OFFSET_BACKLIGHT = 32;

/** Compute workgroup width of the cull / reset entries (`@workgroup_size(64)`). */
const CULL_WORKGROUP_SIZE = 64;

/** @domain Which pulled-draw module is recorded (fragment entry + attachment layout). */
export type FieldDrawVariant = "depth" | "evsm" | "color" | "colorNormal";

/**
 * Renderer-side contract an `InstanceFieldSystem` consumes (implemented by `WebGPURenderer`).
 * Mirrors `GpuParticlePassHost`: every external dependency is handed in at attach time, the
 * dependency stays one-directional (engine renderer -> lane node), and a system never reaches
 * into the renderer beyond this surface.
 */
export interface InstanceFieldRenderHost {
  /** Live device, or `undefined` while the renderer is destroyed/device-lost. */
  readonly gpuDevice: GPUDevice | undefined;
  /** Shared `GlobalUniforms` bind-group layout (group 0 of the cull and draw pipelines). */
  readonly globalBGL: GPUBindGroupLayout;
  /** Shared `GlobalUniforms` buffer: the cull binds only this (its own 1-entry group 0), since the
   * full `globalBGL` plus the field group exceeds the 10 storage buffers a compute stage may see. */
  readonly globalUniformBuffer: GPUBuffer;
  /** Frame-live shared `GlobalUniforms` bind group (group 0 of the color draw path). */
  readonly globalBindGroup: GPUBindGroup;
  /** Per-draw view-projection dynamic-offset layout (group 3 of the draw pipelines). */
  readonly viewBGL: GPUBindGroupLayout;
  /** Per-draw view-projection bind group (`view.vp`, bound with the pass-provided offset). */
  readonly viewBindGroup: GPUBindGroup;
  /** Color-target format the currently bound pass targets (pipeline keying input). */
  readonly currentColorTargetFormat: GPUTextureFormat;
  /** Fully composed cull module source (compute-structs chunk + footprint + field chunk +
   * `instance_cull.wgsl`). */
  readonly fieldCullModuleSource: string;
  /** Fully composed pull module source (compute-structs chunk + field chunk + `field_pull.wgsl`). */
  readonly fieldPullModuleSource: string;
  /** Addressable white 1x1 texture (alpha-map / HZB fallback before the first pyramid build). */
  readonly whiteTextureView: GPUTextureView;
  /** Previous-frame pyramid handle the main-view cull consumes (ping-pong, see HZB system). */
  getPreviousFrameHzb(): HzbFieldPyramidAccess;
  /** Texture view of an uploaded `Texture`, or the white fallback (unloaded / disableTextures). */
  getTextureView(tex: Texture | undefined): GPUTextureView;
  /** Pins `geometry` in the renderer's geometry cache (one scratch-object refcount) and returns
   * its GPU cache entry (vertex/index buffers). */
  acquireFieldGeometry(geometry: GeometryDataInterface): WebGPUGeoCacheEntry;
  /** Releases the pin acquired by {@link acquireFieldGeometry}; frees the cache entry when the
   * refcount drops to zero. */
  releaseFieldGeometry(geometry: GeometryDataInterface): void;
  /** Destroys `buffer` after this frame's submit (commands recorded earlier may still use it). */
  deferDestroyBuffer(buffer: GPUBuffer): void;
}

/** Setup surface of the WebGPU field node (host nullable for the pure-TS S2 scaffold). */
export interface InstanceFieldSystemSetup {
  /**
   * @domain Renderer host; `null` keeps the node inert (no GPU resources, every method a no-op)
   *         until the renderer attaches a real host through `attachHost()`.
   */
  host: InstanceFieldRenderHost | null;
  /**
   * @derived Engine-owned 16-byte instance records (`INSTANCE_RECORD_BYTES` per record,
   *         little-endian, byte-identical on every tier). Uploaded once (static population).
   */
  instanceRecords?: Float32Array;
  /**
   * @derived Per-record prototype index. Required (validated) for multi-prototype fields and
   *         MUST be sorted ascending (contiguous per-prototype ranges -- the GPU lane resolves
   *         the prototype range-implicitly by binary search, IF-CULL-NO-FALSE-NEGATIVE).
   */
  recordPrototypeMap?: Uint8Array;
  /**
   * @domain Authoring LOD chains of the field (frozen descriptors; a field with an empty
   *         roster is a legal no-op field).
   */
  prototypes?: readonly PrototypeDescriptor[];
  /**
   * @derived Backend-owned per-(prototype x bucket) geometry table (`GeometryDataInterface`
   *         per LOD bucket). All prototypes must resolve the IDENTICAL geometry object per
   *         bucket index (validated); indexed geometry is required (throw otherwise).
   */
  geometryTable?: ReadonlyArray<ReadonlyArray<GeometryDataInterface | undefined>>;
  /**
   * @domain Authoring options of the field node (frozen `InstanceFieldOptions`; merged over
   *         defaults so `{}` yields a valid inert scaffold).
   */
  options?: Partial<InstanceFieldOptions>;
  /**
   * @domain P1 single-alpha simplification: cutout threshold in [0,1] applied to `alphaMap` in
   *         the pulled fragments; 0 disables the alpha test (no discard, `fieldInfo.alphaTest`).
   */
  alphaTest?: number;
  /**
   * @domain Authoring alpha-cutout texture of the field (white fallback when absent/unloaded).
   */
  alphaMap?: Texture;
  /**
   * @domain Leaf backlight tint (linear rgb; absent or black = off), ADR 0060 semantics. Scaled
   *         per vertex by the colour-stream alpha, the foliage mask (trunks 0, leaves 1).
   */
  backlight?: readonly [number, number, number];
  /** @domain Transmission-shadow offset toward the sun in metres (ADR 0060 default 0.5). */
  backlightThickness?: number;
}

/** Vertex streams bound per bucket: slot 1 normal, 2 uv, 3 colour (slot 0 = the cached position).
 * Streams the geometry lacks are completed once at setup (`owned`, destroyed on dispose). */
interface FieldBucketStreams {
  normal: GPUBuffer;
  uv: GPUBuffer;
  color: GPUBuffer;
  owned: GPUBuffer[];
}

/** Options defaults so `{}` (S2 scaffold) builds a valid inert node (host null). */
const DEFAULT_OPTIONS: InstanceFieldOptions = {
  prototypes: [],
  cellSize: 1,
  maxInstances: 0,
  cullPixelSize: 2,
  shadowLodBias: 0,
  maxViews: 4,
  cpuBudget: {
    maxCullRadius: 100,
    maxCellsPerFrame: 512,
    maxDrawsPerFrame: 256,
    maxInstancesPerFrame: 16384,
  },
  populationMode: "static",
};

/** One reusable per-view cull-params mirror entry (zero per-frame allocation). */
interface FieldCullParamsSlot {
  params: CullParams;
  /** 6 mutable inward planes backing `params.frustumPlanes` (order: right,left,bottom,top,near,far). */
  planes: [number, number, number, number][];
}

/** GPU buffers + pipelines of ONE field (all owned by this node; destroyed on `dispose()`). */
interface FieldGpuState {
  records: GPUBuffer;
  prototypeInfo: GPUBuffer;
  prototypeRange: GPUBuffer;
  lodMaxima: GPUBuffer;
  indirectArgs: GPUBuffer;
  visibleIndices: GPUBuffer;
  cullParams: GPUBuffer;
  fieldInfo: GPUBuffer;
  cullFieldBGL: GPUBindGroupLayout;
  drawFieldBGL: GPUBindGroupLayout;
  /** Cull group 0: `GlobalUniforms` only (see `InstanceFieldRenderHost.globalUniformBuffer`). */
  cullGlobalBGL: GPUBindGroupLayout;
  cullGlobalBg: GPUBindGroup;
  cullGlobalBuffer: GPUBuffer;
  cullPipeline: GPUComputePipeline;
  resetPipeline: GPUComputePipeline;
  pullModule: GPUShaderModule;
  cullBg: GPUBindGroup;
  drawBg: GPUBindGroup;
  alphaSampler: GPUSampler;
}

/** Pipeline slot of each draw variant (`_getDrawPipeline`). */
const DRAW_VARIANT_INDEX: Readonly<Record<FieldDrawVariant, number>> = {
  depth: 0,
  evsm: 1,
  color: 2,
  colorNormal: 3,
};

/**
 * Completes the per-vertex streams a bucket geometry lacks, once at attach: normals default to
 * world up, uvs to zero, colours to white with foliage mask 1. The colour stream is always the
 * field's own float32x4 copy (geometry colours may be rgb or rgba; treated as linear albedo).
 */
function createBucketStreams(
  device: GPUDevice,
  geo: GeometryDataInterface,
  entry: WebGPUGeoCacheEntry,
): FieldBucketStreams {
  const vertexCount = entry.vertexCount;
  const owned: GPUBuffer[] = [];
  const upload = (data: Float32Array): GPUBuffer => {
    const buffer = device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    owned.push(buffer);
    return buffer;
  };

  let normal = entry.nb;
  if (!normal) {
    const up = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) up[v * 3 + 1] = 1;
    normal = upload(up);
  }
  const uv = entry.uvb ?? upload(new Float32Array(vertexCount * 2));

  const rgba = new Float32Array(vertexCount * 4).fill(1);
  const src = geo.colors;
  const components = src ? src.length / vertexCount : 0;
  if (src && (components === 3 || components === 4)) {
    for (let v = 0; v < vertexCount; v++) {
      rgba[v * 4] = src[v * components]!;
      rgba[v * 4 + 1] = src[v * components + 1]!;
      rgba[v * 4 + 2] = src[v * components + 2]!;
      if (components === 4) rgba[v * 4 + 3] = src[v * components + 3]!;
    }
  }
  return { normal, uv, color: upload(rgba), owned };
}

/** `mapAsync` rejection handler of the probe staging (aborted by unmap/destroy). */
function ignoreMapAbort(): void {}

/** Probe staging set (created lazily, reused; single set + pending flag). */
interface FieldProbeState {
  argsStage: GPUBuffer;
  indicesStage: GPUBuffer;
  pending: boolean;
  frameIndex: number;
}

/**
 * Per-field WebGPU node implementing the frozen `InstanceFieldRuntimeApi`. See the class doc
 * for scope, the param-block layout and the probe contract. All per-frame CPU work is
 * allocation-free (reused mirrors, one scratch block, `queue.writeBuffer` uploads).
 */
export class InstanceFieldSystem implements InstanceFieldRuntimeApi {
  private _host: InstanceFieldRenderHost | null;

  // --- Authoring-derived immutable tables (validated at setup) ---
  private readonly _viewCount: number;
  private readonly _cullPixelSize: number;
  private readonly _maxInstances: number;
  private readonly _pageCapacity: number;
  private readonly _protoCount: number;
  private readonly _maxBucketCount: number;
  private readonly _protoBounds: Float32Array;
  private readonly _protoRange: Uint32Array;
  private readonly _lodMaxima: Float32Array;
  private readonly _bucketGeo: (GeometryDataInterface | undefined)[];
  /** Pinned geometry-cache entries per bucket (acquired once at attach; draw reads only). */
  private readonly _bucketGeoEntry: (WebGPUGeoCacheEntry | undefined)[] = new Array(
    MAX_LOD_BUCKETS,
  );
  private readonly _alphaTest: number;
  private readonly _alphaMap: Texture | undefined;
  /** `FieldInfo.backlight`: linear tint rgb + transmission-shadow offset (w = 0 -> off). */
  private readonly _backlight: Float32Array = new Float32Array(4);
  /** Completed vertex streams per bucket (built at attach, see `FieldBucketStreams`). */
  private readonly _bucketStreams: (FieldBucketStreams | undefined)[] = new Array(MAX_LOD_BUCKETS);

  // --- Population (static; rebuild() is the only mutation path) ---
  private _instanceRecords: Float32Array;
  private _recordPrototypeMap: Uint8Array | undefined;
  private _instanceCount: number = 0;

  // --- Per-frame cull state (pooled, zero-GC) ---
  private readonly _frustumScratch: Frustum = new Frustum();
  private readonly _vpScratch: Matrix4 = new Matrix4();
  private readonly _paramBlock: Float32Array = new Float32Array(CULL_PARAM_BLOCK_BYTES / 4);
  // MUST alias `_paramBlock` (only that one is uploaded): a separate array silently dropped every
  // u32 word -- segmentBase/cullMode/hzb flags -- so shadow culls counted into segment 0.
  private readonly _paramBlockU32: Uint32Array = new Uint32Array(this._paramBlock.buffer);
  private readonly _mirror: FieldCullParamsSlot[];
  private readonly _cullParams: CullParams[];
  private _mainViewportHeightPx: number = 0;
  private _mainFovRadiansY: number = 0;
  private _resetRecordedThisFrame: boolean = false;
  private _hzMipCount: number = 1;
  private _pendingTeleportSkip: boolean = false;
  /** S2 A/B/C comparison knob (lead-authorized 2026-11-09): `undefined` = auto (pyramid
   * availability), `false` = force-disable main-view HZB culling, `true` = force-on. */
  private _occlusionOverride: boolean | undefined = undefined;

  /**
   * @domain S2 occlusion A/B/C knob: overrides the auto `hzbEnabled` decision (pyramid
   * availability) for the MAIN view. `false` forces the sub-pixel + frustum path only; the
   * WGSL `hzbEnabled` gate keeps the HZB texture unsampled. Idempotent, never touches the
   * shadow views (mode C is HZB-free by contract).
   */
  public setOcclusionEnabled(enabled: boolean): void {
    this._occlusionOverride = enabled;
  }

  // --- GPU state (created on attach; rebuilt on rebuild()) ---
  private _gpu: FieldGpuState | undefined = undefined;
  /** Pull pipelines keyed `${variant}:${format}:${uv}` (created lazily per target format). */
  /** Draw pipelines per target format, slot `variantIndex * 2 + uv` (no per-draw string key). */
  private readonly _drawPipelines: Map<GPUTextureFormat, (GPURenderPipeline | undefined)[]> =
    new Map();
  /** Cull bind group per bound pyramid view: the HZB ping-pongs between two views, so after the
   * first two frames the per-frame rebind is a lookup, never a `createBindGroup`. Cleared
   * whenever the field buffers are rebuilt (bind groups hold them). */
  private readonly _cullBgByView: Map<GPUTextureView, GPUBindGroup> = new Map();

  // --- Opt-in probe (dual-lane harness) ---
  private _probe: IndirectCullProbe | undefined = undefined;
  private _probeState: FieldProbeState | undefined = undefined;
  /** Fresh snapshot of the mirror captured at staging time (opt-in; allocation acceptable). */
  private _probeParamsSnapshot: CullParams[] = [];

  /**
   * @throws On any frozen-contract invariant violation (fail fast, never a silently wrong field).
   *   `host === null` keeps the node inert (S2 pure-TS scaffold); `attachHost()` later creates
   *   the GPU resources.
   */
  constructor(host: InstanceFieldRenderHost | null, setup: Partial<InstanceFieldSystemSetup> = {}) {
    this._host = host;
    const options: InstanceFieldOptions = { ...DEFAULT_OPTIONS, ...setup.options };
    if (options.populationMode !== "static") {
      throw new Error(
        `[InstanceFieldSystem] populationMode must be "static" in V1, got "${options.populationMode}".`,
      );
    }
    this._cullPixelSize = options.cullPixelSize;
    if (!(this._cullPixelSize >= 0)) {
      throw new Error("[InstanceFieldSystem] cullPixelSize must be >= 0.");
    }
    this._maxInstances = Math.max(0, Math.floor(options.maxInstances));
    this._viewCount = Math.min(Math.max(1, Math.floor(options.maxViews)), MAX_INDIRECT_VIEWS);
    this._alphaTest = Math.max(0, setup.alphaTest ?? 0);
    this._alphaMap = setup.alphaMap;
    const tint = setup.backlight;
    if (tint && (tint[0] > 0 || tint[1] > 0 || tint[2] > 0)) {
      this._backlight[0] = tint[0];
      this._backlight[1] = tint[1];
      this._backlight[2] = tint[2];
      this._backlight[3] = Math.max(1e-4, setup.backlightThickness ?? 0.5);
    }

    const prototypes = setup.prototypes ?? options.prototypes ?? [];
    const protoCount = prototypes.length;
    const bounds = new Float32Array(protoCount);
    const range = new Uint32Array(protoCount * 3); // x=start, y=count, z=bucketCount
    const lodMaxima = new Float32Array(protoCount * 8); // 2 vec4f rows per prototype
    let maxBucketCount = 0;
    for (let p = 0; p < protoCount; p++) {
      const proto = prototypes[p]!;
      if (!(proto.boundingRadius > 0) || proto.lodBuckets.length <= 0) {
        throw new Error(
          `[InstanceFieldSystem] Prototype '${proto.id}' needs radius > 0 and >= 1 LOD bucket.`,
        );
      }
      if (proto.lodBuckets.length > MAX_LOD_BUCKETS) {
        throw new Error(
          `[InstanceFieldSystem] Prototype '${proto.id}' exceeds MAX_LOD_BUCKETS (${MAX_LOD_BUCKETS}).`,
        );
      }
      if (!(proto.maxInstances > 0)) {
        throw new Error(`[InstanceFieldSystem] Prototype '${proto.id}' needs maxInstances > 0.`);
      }
      bounds[p] = proto.boundingRadius;
      range[p * 3 + 2] = proto.lodBuckets.length;
      maxBucketCount = Math.max(maxBucketCount, proto.lodBuckets.length);
      for (let b = 0; b < proto.lodBuckets.length; b++) {
        const band = proto.lodBuckets[b]!;
        if (b === 0 && !(band.minProjectedSize > this._cullPixelSize)) {
          throw new Error(
            `[InstanceFieldSystem] Prototype '${proto.id}': finest bucket minProjectedSize must be > cullPixelSize.`,
          );
        }
        if (b > 0) {
          const prev = proto.lodBuckets[b - 1]!;
          if (!(band.maxProjectedSize > prev.maxProjectedSize)) {
            throw new Error(
              `[InstanceFieldSystem] Prototype '${proto.id}': LOD bucket maxima must ascend.`,
            );
          }
        }
        lodMaxima[p * 8 + b] = band.maxProjectedSize;
      }
    }
    this._protoCount = protoCount;
    this._protoBounds = bounds;
    this._protoRange = range;
    this._lodMaxima = lodMaxima;
    this._maxBucketCount = maxBucketCount;
    // One (view x bucket) page must hold every instance: a single view can see the whole field
    // (aerial camera, one shadow cascade covering it). The former `max(1024, maxInstances / 16)`
    // overflowed at 5.5k visible trees: survivors past the page were dropped at random (atomic
    // order) while the draw still used the full count -> flicker + instances read from foreign
    // pages. Memory stays bounded because only the USED segments get pages (see setup).
    this._pageCapacity = Math.max(1, this._maxInstances);

    // Per-bucket geometry: V1 constraint = every prototype that has bucket b resolves the
    // IDENTICAL geometry object (validated). bucketGeo[b] = that object, or undefined when no
    // prototype has bucket b (then no survivor can route there -- safe).
    const bucketGeo: (GeometryDataInterface | undefined)[] = new Array(MAX_LOD_BUCKETS);
    const table = setup.geometryTable ?? [];
    for (let b = 0; b < maxBucketCount; b++) {
      let shared: GeometryDataInterface | undefined;
      for (let p = 0; p < protoCount; p++) {
        const cell = table[p]?.[b];
        if (!cell) continue;
        if (shared !== undefined && shared !== cell) {
          throw new Error(
            `[InstanceFieldSystem] bucket ${b}: prototypes must share the identical geometry object (V1 constraint).`,
          );
        }
        shared = cell;
      }
      if (!shared) {
        throw new Error(
          `[InstanceFieldSystem] bucket ${b}: no prototype resolves a geometry for this bucket index.`,
        );
      }
      if (!shared.indices || shared.indices.length === 0) {
        throw new Error(
          `[InstanceFieldSystem] bucket ${b}: indexed geometry is required for indirect draws.`,
        );
      }
      bucketGeo[b] = shared;
    }
    this._bucketGeo = bucketGeo;

    this._instanceRecords = setup.instanceRecords ?? new Float32Array(0);
    this._recordPrototypeMap = setup.recordPrototypeMap;

    // Pool the per-view cull-params mirror (bounded by the authored view cap).
    this._mirror = [];
    this._cullParams = [];
    for (let v = 0; v < this._viewCount; v++) {
      const planes: [number, number, number, number][] = [];
      for (let i = 0; i < 6; i++) planes.push([0, 0, 0, 0]);
      const params: CullParams = {
        viewIndex: v,
        frustumPlanes: planes,
        viewportHeightPx: 0,
        fovRadiansY: 0,
        hzbEnabled: false,
        hzbSkip: false,
        segmentBase: 0,
      };
      this._mirror.push({ planes, params });
      this._cullParams.push(params);
    }

    this.rebuild();

    if (host) this.attachHost(host);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle (host attach, static population, rebuild)
  // ---------------------------------------------------------------------------

  /** Attaches the renderer host (idempotent): creates every GPU resource on first call. The
   * node stays inert (all methods no-op) while `host` is `null`. */
  public attachHost(host: InstanceFieldRenderHost): void {
    if (this._host === host && this._gpu) return;
    this._host = host;
    this._buildGpuState();
  }

  /** Replaces the CPU-side population inputs BEFORE {@link rebuild} (engine owns the sort). */
  public setPopulationData(instanceRecords: Float32Array, recordPrototypeMap?: Uint8Array): void {
    this._instanceRecords = instanceRecords;
    this._recordPrototypeMap = recordPrototypeMap;
  }

  /** @inheritdoc -- full rebuild: re-derive the prototype ranges, re-upload every derived buffer. */
  public rebuild(): void {
    this._deriveRanges();
    if (this._gpu) this._rebuildGpuBuffers();
  }

  /** @inheritdoc -- field-scoped one-frame HZB skip; idempotent (IF-CAMERA-CUT-HZB-SKIP). The
   * flag is consumed by the next main-view prepare; N consecutive calls still skip one frame. */
  public notifyCameraTeleport(): void {
    this._pendingTeleportSkip = true;
  }

  /** @inheritdoc. */
  public installCullProbe(probe: IndirectCullProbe): void {
    this._probe = probe;
    if (probe && this._gpu) this._ensureProbeState();
  }

  /** @inheritdoc -- the read-only per-view cull-params mirror (pooled, dispatch-level
   * `hzbSkip` read by the P1-4 transition test). */
  public get cullParams(): readonly CullParams[] {
    return this._cullParams;
  }

  /** Authored view cap (clamped into `[1, MAX_INDIRECT_VIEWS]`). */
  public get maxViews(): number {
    return this._viewCount;
  }

  /** Live instance count backing the record buffer (0 until population is set). */
  public get instanceCount(): number {
    return this._instanceCount;
  }

  // ---------------------------------------------------------------------------
  // Per-frame cull entry points (called by the renderer coordinator / pass hooks)
  // ---------------------------------------------------------------------------

  /**
   * Prepares the MAIN view (view 0): refreshes the previous-frame HZB handle + cull bind group,
   * writes the view-0 param block (mode A, `hzbEnabled` = pyramid available, `hzbSkip` = the
   * one-frame camera-cut flag) and arms the once-per-frame counter reset. `vp` is the RAW
   * (non-ZO-corrected) main-camera view-projection; `viewportHeightPx`/`fovRadiansY` are the
   * frozen projected-size (primary-view) metric inputs (IF-PROJECTED-SIZE).
   */
  public prepareMainView(
    vp: Float32Array,
    _camPos: { readonly x: number; readonly y: number; readonly z: number },
    viewportHeightPx: number,
    fovRadiansY: number,
  ): void {
    const host = this._host;
    const gpu = this._gpu;
    if (!host || !gpu) return;
    // Frame head: re-arm the once-per-frame reset and resolve the previous-frame pyramid.
    this._resetRecordedThisFrame = false;
    const hzb = host.getPreviousFrameHzb();
    if (hzb.readHandle.mipLevelCount !== this._hzMipCount) {
      this._hzMipCount = Math.max(1, hzb.readHandle.mipLevelCount);
      this._writeFieldInfoWord(INFO_OFFSET_HZB_MIP_COUNT, this._hzMipCount);
    }
    this._rebuildCullBg(hzb);
    this._mainViewportHeightPx = viewportHeightPx;
    this._mainFovRadiansY = fovRadiansY;

    const hzEnabled = this._occlusionOverride ?? hzb.available;
    const skip = this._pendingTeleportSkip;
    this._pendingTeleportSkip = false;
    this._writeViewParams(0, vp, viewportHeightPx, fovRadiansY, hzEnabled, skip, 1);
  }

  /** Culls the MAIN view (view 0): records the once-per-frame counter reset, then the mode-A
   * cull dispatch (dynamic param block 0). No-op on an inert / empty field. */
  public cullMainView(ce: GPUCommandEncoder): void {
    this._recordCull(ce, 0);
  }

  /** Prepares a SHADOW view (viewIndex >= 1): frustum from the RAW VP, mode C (no HZB),
   * metric inputs anchored to the main camera. Overflow views (>= `maxViews`) are ignored per
   * the frozen contract wording ("overflow views are not field-culled"). */
  public prepareShadowView(viewIndex: number, vp: Float32Array): void {
    this._writeViewParams(
      viewIndex,
      vp,
      this._mainViewportHeightPx,
      this._mainFovRadiansY,
      false,
      false,
      0,
    );
  }

  /** Culls one shadow view (mode C, no HZB dependency). */
  public cullShadowView(ce: GPUCommandEncoder, viewIndex: number): void {
    this._recordCull(ce, viewIndex);
  }

  // ---------------------------------------------------------------------------
  // Draw recording (single-point, called by the renderer's pass hooks)
  // ---------------------------------------------------------------------------

  /**
   * Records the pulled indirect draws of every drawable (view x bucket) segment into the
   * already-open render pass `rp` (color + depth bound by the hosting pass). `viewOffset` is
   * the hosting pass's group-3 dynamic offset for its own view-projection slot; `viewIndex` is
   * the field view index the pass prepared/culled; `bindGlobal` is true ONLY for the main color
   * pass (it binds the real `globalBindGroup` at group 0 -- the shadow/depth passes already
   * bound their pass-appropriate group-0 snapshot and this recorder never re-binds it).
   * `variant` selects the pulled fragment entry + attachment layout.
   */
  public recordDraw(
    rp: GPURenderPassEncoder,
    viewOffset: number,
    viewIndex: number,
    bindGlobal: boolean,
    variant: FieldDrawVariant,
  ): void {
    const host = this._host;
    const gpu = this._gpu;
    if (!host || !gpu) return;
    if (viewIndex < 0 || viewIndex >= this._viewCount) return;
    if (this._maxBucketCount === 0 || this._instanceCount === 0) return;

    if (bindGlobal) rp.setBindGroup(0, host.globalBindGroup);
    rp.setBindGroup(3, host.viewBindGroup, [viewOffset]);

    const targetFormat = host.currentColorTargetFormat;
    const viewBase = viewIndex * MAX_LOD_BUCKETS;
    for (let b = 0; b < this._maxBucketCount; b++) {
      const entry = this._bucketGeoEntry[b];
      const streams = this._bucketStreams[b];
      if (!entry || !streams || entry.indexCount === 0) continue;
      rp.setPipeline(this._getDrawPipeline(variant, targetFormat));
      this._bindGeometry(rp, entry, streams);
      const segment = viewBase + b;
      rp.setBindGroup(2, gpu.drawBg, [segment * CULL_PARAM_BLOCK_BYTES]);
      rp.drawIndexedIndirect(gpu.indirectArgs, segment * INDIRECT_SEGMENT_HEADER_BYTES);
    }
  }

  // ---------------------------------------------------------------------------
  // Opt-in probe (dual-lane harness; never in the render path)
  // ---------------------------------------------------------------------------

  /** Records the staging copies of this frame's args + visible pages (once per staged frame;
   * drops while a prior readback is still pending -- latency self-corrects). */
  public recordProbeStaging(ce: GPUCommandEncoder, frameIndex: number): void {
    const gpu = this._gpu;
    const st = this._probeState;
    if (!this._probe || !gpu || !st) return;
    if (st.pending) return;
    ce.copyBufferToBuffer(
      gpu.indirectArgs,
      0,
      st.argsStage,
      0,
      FIELD_SEGMENTS * INDIRECT_SEGMENT_HEADER_BYTES,
    );
    ce.copyBufferToBuffer(gpu.visibleIndices, 0, st.indicesStage, 0, gpu.visibleIndices.size);
    st.pending = true;
    st.frameIndex = frameIndex;
    // Snapshot the mirror now: by readback time the slots have moved on.
    this._snapshotProbeParams();
  }

  /** Kicks the staging buffers' `mapAsync()` right after `queue.submit()`. */
  public kickoffProbeReadback(): void {
    const st = this._probeState;
    if (!st || !st.pending) return;
    const device = this._host?.gpuDevice;
    if (!device) return;
    // Called after every submit, but `pending` stays set until the poll: map only once per staging.
    if (st.argsStage.mapState !== "unmapped") return;
    // Probe-only path: a destroyed buffer (dispose mid-flight) rejects the map -- not an error.
    st.argsStage.mapAsync(GPUMapMode.READ, 0, st.argsStage.size).catch(ignoreMapAbort);
    st.indicesStage.mapAsync(GPUMapMode.READ, 0, st.indicesStage.size).catch(ignoreMapAbort);
  }

  /** Polls the staging maps at the NEXT frame head: when both are ready, builds this frame's
   * `FieldVisibleSets` and notifies the installed probe (once), then unmaps and re-arms. */
  public pollProbeReadback(): void {
    const st = this._probeState;
    const probe = this._probe;
    if (!st || !probe || !st.pending) return;
    if (st.argsStage.mapState !== "mapped" || st.indicesStage.mapState !== "mapped") return;
    try {
      const argsWords = new Uint32Array(st.argsStage.getMappedRange());
      const indicesWords = new Uint32Array(st.indicesStage.getMappedRange());
      const counts: IndirectSegmentCounts[] = [];
      for (let v = 0; v < this._viewCount; v++) {
        for (let b = 0; b < this._maxBucketCount; b++) {
          const count = argsWords[(v * MAX_LOD_BUCKETS + b) * 8 + 1] ?? 0;
          if (count === 0) continue;
          counts.push({ viewIndex: v, bucketIndex: b, count });
        }
      }
      const sets: FieldVisibleSets = {
        frameIndex: st.frameIndex,
        params: this._probeParamsSnapshot,
        segmentCounts: counts,
        visibleIndices: new Uint32Array(indicesWords),
      };
      probe.onCullFrame(sets);
    } finally {
      st.argsStage.unmap();
      st.indicesStage.unmap();
      st.pending = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  /** Destroys every GPU resource this node owns (buffers, bind groups, pipelines) and releases
   * the geometry pins. Safe to call twice. */
  public dispose(): void {
    const gpu = this._gpu;
    this._gpu = undefined;
    this._drawPipelines.clear();
    this._cullBgByView.clear();
    if (gpu) {
      gpu.records.destroy();
      gpu.prototypeInfo.destroy();
      gpu.prototypeRange.destroy();
      gpu.lodMaxima.destroy();
      gpu.indirectArgs.destroy();
      gpu.visibleIndices.destroy();
      gpu.cullParams.destroy();
      gpu.fieldInfo.destroy();
    }
    const st = this._probeState;
    this._probeState = undefined;
    if (st) {
      st.argsStage.destroy();
      st.indicesStage.destroy();
    }
    for (let b = 0; b < MAX_LOD_BUCKETS; b++) {
      const streams = this._bucketStreams[b];
      if (!streams) continue;
      for (const buffer of streams.owned) buffer.destroy();
      this._bucketStreams[b] = undefined;
    }
    if (this._host) {
      for (let b = 0; b < this._maxBucketCount; b++) {
        const geo = this._bucketGeo[b];
        if (geo) this._host.releaseFieldGeometry(geo);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals -- population / ranges
  // ---------------------------------------------------------------------------

  /**
   * Derives the contiguous per-prototype ranges from the record-prototype map. The frozen
   * contract names ranges as the only prototype-resolution mechanism on the GPU lane, so the
   * map MUST be sorted ascending; a single-prototype field may omit it (full range).
   * @throws On an unsorted map (fail fast).
   */
  private _deriveRanges(): void {
    const records = this._instanceRecords;
    const total = records.length / 4;
    this._instanceCount = total;
    this._protoRange.fill(0);
    if (total === 0) return;
    if (this._protoCount === 0) {
      throw new Error(
        "[InstanceFieldSystem] Population without a prototype roster (prototypes required).",
      );
    }
    const map = this._recordPrototypeMap;
    if (this._protoCount > 1 && (!map || map.length < total)) {
      throw new Error(
        "[InstanceFieldSystem] Multi-prototype field requires a per-record prototype map.",
      );
    }
    let prev = -1;
    for (let i = 0; i < total; i++) {
      const p = map ? map[i]! : 0;
      if (p >= this._protoCount) {
        throw new Error(`[InstanceFieldSystem] recordPrototypeMap out of range (${p}).`);
      }
      if (p < prev) {
        throw new Error(
          "[InstanceFieldSystem] recordPrototypeMap must be sorted (contiguous per-prototype ranges).",
        );
      }
      if (i === 0 || p !== prev) {
        this._protoRange[p * 3] = i; // start
        this._protoRange[p * 3 + 1] = 1; // count
      } else {
        const ridx = p * 3 + 1;
        this._protoRange[ridx] = (this._protoRange[ridx] ?? 0) + 1;
      }
      prev = p;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals -- GPU resource build / rebuild
  // ---------------------------------------------------------------------------

  /** Creates all per-field GPU resources against the attached host. Idempotent per host. */
  private _buildGpuState(): void {
    const host = this._host;
    const device = host?.gpuDevice;
    if (!host || !device) return;
    if (this._gpu) return;

    // Pin the per-bucket geometry once in the renderer's cache (scratch-object refcount); the
    // draw path only reads these entries. Releases on dispose.
    for (let b = 0; b < this._maxBucketCount; b++) {
      const geo = this._bucketGeo[b];
      if (!geo) continue;
      const entry = host.acquireFieldGeometry(geo);
      this._bucketGeoEntry[b] = entry;
      this._bucketStreams[b] = createBucketStreams(device, geo, entry);
    }

    const recordsBytes = Math.max(1, this._instanceCount) * INSTANCE_RECORD_BYTES;
    // Pages for the segments this field can address only: views [0, viewCount) x buckets
    // [0, maxBucketCount) -> highest bv = (viewCount - 1) * MAX_LOD_BUCKETS + maxBucketCount - 1.
    const usedSegments =
      (this._viewCount - 1) * MAX_LOD_BUCKETS + Math.max(1, this._maxBucketCount);
    const visibleBytes = usedSegments * this._pageCapacity * 4;
    const cullParamsBytes = FIELD_SEGMENTS * CULL_PARAM_BLOCK_BYTES;
    const tableBytes = Math.max(1, this._protoCount) * 16;

    const records = device.createBuffer({
      size: recordsBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const prototypeInfo = device.createBuffer({
      size: tableBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const prototypeRange = device.createBuffer({
      size: tableBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const lodMaxima = device.createBuffer({
      size: Math.max(1, this._protoCount) * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const indirectArgs = device.createBuffer({
      size: FIELD_SEGMENTS * INDIRECT_SEGMENT_HEADER_BYTES,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const visibleIndices = device.createBuffer({
      size: visibleBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const cullParams = device.createBuffer({
      size: cullParamsBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const fieldInfo = device.createBuffer({
      size: FIELD_INFO_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cullFieldBGL = device.createBindGroupLayout({
      label: "InstanceFieldCullBGL",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        // HZB is r32float: not filterable without `float32-filterable`; the cull only textureLoad()s.
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          texture: { viewDimension: "2d", sampleType: "unfilterable-float" },
        },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const drawFieldBGL = this._createDrawFieldBGL(device);
    const alphaSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    const cullModule = device.createShaderModule({ code: host.fieldCullModuleSource });
    const resetPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        // S2 fold: reset only touches `fieldIndirectArgs`, so slot 0 stays null and the pipeline
        // needs no global bind group (spec §14.1: null layout entries need no bind group).
        bindGroupLayouts: [null, null, cullFieldBGL],
      }),
      compute: { module: cullModule, entryPoint: "resetFieldCounters" },
    });
    // Group 0 of the cull carries ONLY the `GlobalUniforms` uniform: the shared `globalBGL` exposes
    // its cluster/light storage buffers to compute, and together with the field group that is 13
    // storage buffers -- above the 10 per-stage limit of real devices (measured, Apple Metal).
    const cullGlobalBGL = device.createBindGroupLayout({
      label: "InstanceFieldCullGlobalBGL",
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }],
    });
    const cullGlobalBuffer = host.globalUniformBuffer;
    const cullGlobalBg = this._createCullGlobalBindGroup(device, cullGlobalBGL, cullGlobalBuffer);
    const cullPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        // Field-data group folded to `INSTANCE_FIELD_BIND_GROUP` (2); global stays at 0.
        bindGroupLayouts: [cullGlobalBGL, null, cullFieldBGL],
      }),
      compute: { module: cullModule, entryPoint: "cullInstances" },
    });
    const pullModule = device.createShaderModule({ code: host.fieldPullModuleSource });

    const locals: FieldLocals = {
      records,
      prototypeInfo,
      prototypeRange,
      lodMaxima,
      indirectArgs,
      visibleIndices,
      cullParams,
      fieldInfo,
    };
    const cullBg = this._createCullBindGroup(device, cullFieldBGL, locals, host.whiteTextureView);
    const drawBg = this._createDrawBindGroup(
      device,
      drawFieldBGL,
      locals,
      host.getTextureView(this._alphaMap),
      alphaSampler,
    );

    this._gpu = {
      records,
      prototypeInfo,
      prototypeRange,
      lodMaxima,
      indirectArgs,
      visibleIndices,
      cullParams,
      fieldInfo,
      cullFieldBGL,
      drawFieldBGL,
      cullGlobalBGL,
      cullGlobalBg,
      cullGlobalBuffer,
      cullPipeline,
      resetPipeline,
      pullModule,
      cullBg,
      drawBg,
      alphaSampler,
    };

    // Static table writes (geometry words, prototype tables, per-segment bases) + population.
    this._writeStaticTables();
    this._uploadRecords();
    this._writeFieldInfo();
    if (this._probe) this._ensureProbeState();
  }

  /** Regrows population-dependent buffers after `rebuild()` (records + fieldInfo + tables). */
  private _rebuildGpuBuffers(): void {
    this._cullBgByView.clear();
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !device) return;
    const recordsBytes = Math.max(1, this._instanceCount) * INSTANCE_RECORD_BYTES;
    if (recordsBytes > gpu.records.size) {
      const next = device.createBuffer({
        size: recordsBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      host.deferDestroyBuffer(gpu.records);
      gpu.records = next;
      this._rebuildBindGroups();
    }
    this._uploadRecords();
    this._writeFieldInfo();
    this._writeStaticTables();
  }

  /** Rewrites both field bind groups after a buffer regrow (they reference whole buffers). */
  private _rebuildBindGroups(): void {
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !device) return;
    const locals: FieldLocals = {
      records: gpu.records,
      prototypeInfo: gpu.prototypeInfo,
      prototypeRange: gpu.prototypeRange,
      lodMaxima: gpu.lodMaxima,
      indirectArgs: gpu.indirectArgs,
      visibleIndices: gpu.visibleIndices,
      cullParams: gpu.cullParams,
      fieldInfo: gpu.fieldInfo,
    };
    gpu.drawBg = this._createDrawBindGroup(
      device,
      gpu.drawFieldBGL,
      locals,
      host.getTextureView(this._alphaMap),
      gpu.alphaSampler,
    );
  }

  /** Writes the per-segment geometry words + per-segment `segmentBase` values (immutable after
   * attach; the per-frame reset only touches the producer-owned words 1,5,6,7). */
  private _writeStaticTables(): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device) return;

    // Prototype tables: bounds (vec4f.x = radius), ranges (start/count/bucketCount), maxima.
    const boundsData = new Float32Array(this._protoCount * 4);
    const rangeData = new Uint32Array(this._protoCount * 4);
    const maximaData = new Float32Array(this._protoCount * 8);
    for (let p = 0; p < this._protoCount; p++) {
      boundsData[p * 4] = this._protoBounds[p]!;
      rangeData[p * 4] = this._protoRange[p * 3]!;
      rangeData[p * 4 + 1] = this._protoRange[p * 3 + 1]!;
      rangeData[p * 4 + 2] = this._protoRange[p * 3 + 2]!;
    }
    for (let i = 0; i < this._protoCount * 8; i++) maximaData[i] = this._lodMaxima[i]!;
    device.queue.writeBuffer(gpu.prototypeInfo, 0, boundsData);
    device.queue.writeBuffer(gpu.prototypeRange, 0, rangeData);
    device.queue.writeBuffer(gpu.lodMaxima, 0, maximaData);

    // Per-segment geometry words (indexCount from the pinned bucket entry; firstIndex /
    // baseVertex / firstInstance stay 0 in V1).
    const args = new Uint32Array(FIELD_SEGMENTS * 8);
    for (let v = 0; v < MAX_INDIRECT_VIEWS; v++) {
      for (let b = 0; b < this._maxBucketCount; b++) {
        const entry = this._bucketGeoEntry[b];
        if (!entry) continue;
        args[(v * MAX_LOD_BUCKETS + b) * 8] = entry.indexCount;
      }
    }
    device.queue.writeBuffer(gpu.indirectArgs, 0, args);

    // Per-segment param blocks: block k's `segmentBase` field == k (class doc); the cull
    // per-frame writes only refresh the planes/metric/flags at view-base blocks.
    const paramBytes = new Uint8Array(FIELD_SEGMENTS * CULL_PARAM_BLOCK_BYTES);
    const paramWords = new Uint32Array(paramBytes.buffer);
    for (let k = 0; k < FIELD_SEGMENTS; k++) {
      paramWords[k * (CULL_PARAM_BLOCK_BYTES / 4) + CULL_OFFSET_SEGMENT_BASE / 4] = k;
    }
    device.queue.writeBuffer(gpu.cullParams, 0, paramBytes);
  }

  /** Uploads the (static) instance records; V1 population, one-shot per rebuild. */
  private _uploadRecords(): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device || this._instanceCount === 0) return;
    const records = this._instanceRecords;
    device.queue.writeBuffer(
      gpu.records,
      0,
      records.buffer as ArrayBuffer,
      records.byteOffset,
      records.byteLength,
    );
  }

  /** (Re)writes the immutable `FieldInfo` uniform (page capacity, counts, metric gate, alpha). */
  private _writeFieldInfo(): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device) return;
    const info = new Uint8Array(FIELD_INFO_BYTES);
    const words = new Uint32Array(info.buffer);
    const floats = new Float32Array(info.buffer);
    words[INFO_OFFSET_PAGE_CAPACITY / 4] = this._pageCapacity;
    words[INFO_OFFSET_PROTOTYPE_COUNT / 4] = this._protoCount;
    words[INFO_OFFSET_INSTANCE_COUNT / 4] = this._instanceCount;
    words[INFO_OFFSET_HZB_MIP_COUNT / 4] = this._hzMipCount;
    floats[INFO_OFFSET_CULL_PIXEL_SIZE / 4] = this._cullPixelSize;
    floats[INFO_OFFSET_ALPHA_TEST / 4] = this._alphaTest;
    floats.set(this._backlight, INFO_OFFSET_BACKLIGHT / 4);
    device.queue.writeBuffer(gpu.fieldInfo, 0, info);
  }

  /** Patches ONE u32 word of the `FieldInfo` uniform (e.g. the HZB mip count after a resize). */
  private _writeFieldInfoWord(offset: number, value: number): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device) return;
    const word = new Uint32Array(1);
    word[0] = value;
    device.queue.writeBuffer(gpu.fieldInfo, offset, word);
  }

  /**
   * Rebuilds the per-frame cull bind group against the CURRENT previous-frame pyramid handle.
   * One bind group per field per frame (the pyramid slot alternates every build); before the
   * first pyramid build the (possibly undefined) whole-mip view falls back to the white
   * texture -- the `hzbEnabled` gate guarantees it is never sampled then.
   */
  private _rebuildCullBg(hzb: HzbFieldPyramidAccess): void {
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !host || !device) return;
    const view = hzb.readHandle.view ?? host.whiteTextureView;
    const cached = this._cullBgByView.get(view);
    if (cached) {
      gpu.cullBg = cached;
      return;
    }
    // Resizes replace the pyramid views: drop stale entries instead of growing without bound.
    if (this._cullBgByView.size >= 4) this._cullBgByView.clear();
    gpu.cullBg = this._createCullBindGroup(
      device,
      gpu.cullFieldBGL,
      {
        records: gpu.records,
        prototypeInfo: gpu.prototypeInfo,
        prototypeRange: gpu.prototypeRange,
        lodMaxima: gpu.lodMaxima,
        indirectArgs: gpu.indirectArgs,
        visibleIndices: gpu.visibleIndices,
        cullParams: gpu.cullParams,
        fieldInfo: gpu.fieldInfo,
      },
      view,
    );
    this._cullBgByView.set(view, gpu.cullBg);
  }

  /**
   * Writes one (view x bucket)-base param block header (planes + metric + flags), uploads it
   * and refreshes the cull mirror. Only view-base blocks (index `viewIndex * MAX_LOD_BUCKETS`)
   * are per-frame refreshed; the draw blocks keep their attach-time `segmentBase`.
   */
  private _writeViewParams(
    viewIndex: number,
    vp: Float32Array,
    viewportHeightPx: number,
    fovRadiansY: number,
    hzbEnabled: boolean,
    hzbSkip: boolean,
    cullMode: number,
  ): void {
    if (viewIndex < 0 || viewIndex >= this._viewCount) return;
    const host = this._host;
    const gpu = this._gpu;
    const device = host?.gpuDevice;
    if (!host || !gpu || !device) return;

    const planes = this._mirror[viewIndex]!.planes;
    const block = this._paramBlock;
    this._vpScratch.data.set(vp);
    this._frustumScratch.setFromMatrix(this._vpScratch);
    const fp = this._frustumScratch.planes;
    for (let i = 0; i < 6; i++) {
      const b = i * 4;
      block[b] = fp[b]!;
      block[b + 1] = fp[b + 1]!;
      block[b + 2] = fp[b + 2]!;
      block[b + 3] = fp[b + 3]!;
      const mp = planes[i]!;
      mp[0] = fp[b]!;
      mp[1] = fp[b + 1]!;
      mp[2] = fp[b + 2]!;
      mp[3] = fp[b + 3]!;
    }
    block[CULL_OFFSET_VIEWPORT_HEIGHT_PX / 4] = viewportHeightPx;
    block[CULL_OFFSET_FOV_RADIANS_Y / 4] = fovRadiansY;
    const words = this._paramBlockU32;
    words[CULL_OFFSET_HZB_ENABLED / 4] = hzbEnabled ? 1 : 0;
    words[CULL_OFFSET_HZB_SKIP / 4] = hzbSkip ? 1 : 0;
    words[CULL_OFFSET_SEGMENT_BASE / 4] = viewIndex * MAX_LOD_BUCKETS;
    words[CULL_OFFSET_CULL_MODE / 4] = cullMode;

    device.queue.writeBuffer(
      gpu.cullParams,
      viewIndex * MAX_LOD_BUCKETS * CULL_PARAM_BLOCK_BYTES,
      block,
    );

    const params = this._mirror[viewIndex]!.params;
    params.viewportHeightPx = viewportHeightPx;
    params.fovRadiansY = fovRadiansY;
    params.hzbEnabled = hzbEnabled;
    params.hzbSkip = hzbSkip;
    params.segmentBase = viewIndex * MAX_LOD_BUCKETS;
  }

  /** Records the once-per-frame counter reset + the cull dispatch for `viewIndex` (mode comes
   * from the prepared param block). No-op while the field is empty. */
  private _recordCull(ce: GPUCommandEncoder, viewIndex: number): void {
    if (viewIndex < 0 || viewIndex >= this._viewCount) return;
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !host || !device) return;
    if (this._instanceCount === 0) return;

    if (!this._resetRecordedThisFrame) {
      const reset = ce.beginComputePass({ label: "InstanceFieldReset" });
      reset.setPipeline(gpu.resetPipeline);
      reset.setBindGroup(2, gpu.cullBg, [0]);
      reset.dispatchWorkgroups(Math.ceil(FIELD_SEGMENTS / CULL_WORKGROUP_SIZE));
      reset.end();
      this._resetRecordedThisFrame = true;
    }

    const cull = ce.beginComputePass({ label: "InstanceFieldCull" });
    cull.setPipeline(gpu.cullPipeline);
    if (gpu.cullGlobalBuffer !== host.globalUniformBuffer) {
      gpu.cullGlobalBuffer = host.globalUniformBuffer;
      gpu.cullGlobalBg = this._createCullGlobalBindGroup(
        device,
        gpu.cullGlobalBGL,
        gpu.cullGlobalBuffer,
      );
    }
    cull.setBindGroup(0, gpu.cullGlobalBg);
    cull.setBindGroup(2, gpu.cullBg, [viewIndex * MAX_LOD_BUCKETS * CULL_PARAM_BLOCK_BYTES]);
    cull.dispatchWorkgroups(Math.ceil(this._instanceCount / CULL_WORKGROUP_SIZE));
    cull.end();
  }

  // ---------------------------------------------------------------------------
  // Internals -- draw pipelines / geometry binding
  // ---------------------------------------------------------------------------

  /**
   * Lazily builds the pulled render pipeline for `(variant, format, uv)`. `format` keys the
   * color attachment(s) so the field never hard-codes the current target; `uv` selects the UV-
   * reading vertex entry + the slot-2 vertex buffer (mesh attributes stay on the standard
   * vertex buffer slots 0/2 exactly like `GPUPipelineCache`).
   */
  private _getDrawPipeline(variant: FieldDrawVariant, format: GPUTextureFormat): GPURenderPipeline {
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !host || !device) {
      throw new Error("[InstanceFieldSystem] recordDraw before attachHost().");
    }
    let byFormat = this._drawPipelines.get(format);
    if (!byFormat) {
      byFormat = [];
      this._drawPipelines.set(format, byFormat);
    }
    const slot = DRAW_VARIANT_INDEX[variant];
    let pipeline = byFormat[slot];
    if (pipeline) return pipeline;
    const key = `${variant}:${format}`;

    // Fixed four streams (slot = array index): position, normal, uv, colour -- every bucket binds
    // all of them (`FieldBucketStreams` completes missing ones), so no per-geometry variants.
    const vertexBufferSlots: GPUVertexBufferLayout[] = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
      { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }] },
    ];

    const targets: GPUColorTargetState[] = [];
    let fragmentEntry = "fsFieldDepth";
    const vertexEntry = "vsFieldPull";
    let depthWriteEnabled = false;
    if (variant === "depth") {
      // Depth pre-pass / shadow depth: writes depth, throws the color away (writeMask 0).
      depthWriteEnabled = true;
      targets.push({ format, writeMask: 0 });
    } else if (variant === "evsm") {
      // EVSM moment pass: writes the exponential moment warp (fsFieldEvsm) to the rgba32float
      // target, no depth write (LEQUAL reads the stored depth). See `field_evsm_pull` in
      // field_pull.wgsl -- this MUST NOT be fsFieldDepth (constant output would fake "fully lit").
      fragmentEntry = "fsFieldEvsm";
      targets.push({ format: "rgba32float" });
    } else if (variant === "colorNormal") {
      fragmentEntry = "fsFieldColorNormal";
      targets.push({ format }, { format: NORMAL_TARGET_FORMAT });
    } else {
      fragmentEntry = "fsFieldColor";
      targets.push({ format });
    }

    pipeline = device.createRenderPipeline({
      label: `field_pull_${key}`,
      layout: device.createPipelineLayout({
        // S2 fold (group 2 = field data, group 3 = shared view; slot 1 null = no material
        // bindings). Highest slot is 3, so `maxBindGroups >= 4` (the spec minimum) suffices;
        // 4-cap adapters run the lane natively.
        bindGroupLayouts: [host.globalBGL, null, gpu.drawFieldBGL, host.viewBGL],
      }),
      vertex: { module: gpu.pullModule, entryPoint: vertexEntry, buffers: vertexBufferSlots },
      fragment: { module: gpu.pullModule, entryPoint: fragmentEntry, targets },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled,
        depthCompare: "less-equal",
      },
    });
    byFormat[slot] = pipeline;
    return pipeline;
  }

  /** Binds the geometry's vertex/index buffers for a pulled draw (positions slot 0, UVs slot
   * 2, index buffer slot 0 of the standard layout). */
  private _bindGeometry(
    rp: GPURenderPassEncoder,
    entry: WebGPUGeoCacheEntry,
    streams: FieldBucketStreams,
  ): void {
    rp.setVertexBuffer(0, entry.vb);
    rp.setVertexBuffer(1, streams.normal);
    rp.setVertexBuffer(2, streams.uv);
    rp.setVertexBuffer(3, streams.color);
    if (entry.ib) rp.setIndexBuffer(entry.ib, entry.format ?? "uint32");
  }

  // ---------------------------------------------------------------------------
  // Internals -- bind-group layouts / bind groups / probe
  // ---------------------------------------------------------------------------

  /** Draw-side `@group(2)` layout: the VERTEX/FRAGMENT bindings the pulled modules read (alpha
   * map/sampler FRAGMENT-only; records/indices/cullParams VERTEX-only; fieldInfo VERTEX|FRAGMENT). */
  private _createDrawFieldBGL(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
      label: "InstanceFieldDrawBGL",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        // Vertex stage: storage must be read-only (WebGPU forbids read_write storage there).
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        {
          binding: 5,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
  }

  /** Cull group 0: the shared `GlobalUniforms` buffer alone. */
  private _createCullGlobalBindGroup(
    device: GPUDevice,
    bgl: GPUBindGroupLayout,
    buffer: GPUBuffer,
  ): GPUBindGroup {
    return device.createBindGroup({
      label: "InstanceFieldCullGlobal",
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer } }],
    });
  }

  /** Cull-side `@group(2)` bind group (compute visibility; the HZB texture spins per frame). */
  private _createCullBindGroup(
    device: GPUDevice,
    bgl: GPUBindGroupLayout,
    l: FieldLocals,
    hzbView: GPUTextureView,
  ): GPUBindGroup {
    return device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: l.records } },
        { binding: 1, resource: { buffer: l.prototypeInfo } },
        { binding: 2, resource: { buffer: l.indirectArgs } },
        { binding: 3, resource: { buffer: l.visibleIndices } },
        { binding: 4, resource: hzbView },
        { binding: 5, resource: { buffer: l.fieldInfo } },
        {
          binding: 6,
          resource: { buffer: l.cullParams, offset: 0, size: CULL_PARAM_BLOCK_BYTES },
        },
        { binding: 9, resource: { buffer: l.lodMaxima } },
        { binding: 10, resource: { buffer: l.prototypeRange } },
      ],
    });
  }

  /** Draw-side `@group(2)` bind group (static buffers; the dynamic offset selects the segment). */
  private _createDrawBindGroup(
    device: GPUDevice,
    bgl: GPUBindGroupLayout,
    l: FieldLocals,
    alphaView: GPUTextureView,
    alphaSampler: GPUSampler,
  ): GPUBindGroup {
    return device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: l.records } },
        { binding: 3, resource: { buffer: l.visibleIndices } },
        { binding: 5, resource: { buffer: l.fieldInfo } },
        {
          binding: 6,
          resource: { buffer: l.cullParams, offset: 0, size: CULL_PARAM_BLOCK_BYTES },
        },
        { binding: 7, resource: alphaView },
        { binding: 8, resource: alphaSampler },
      ],
    });
  }

  /** Lazily creates the probe staging pair (args 4096 B + full visible pages). */
  private _ensureProbeState(): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device || this._probeState) return;
    this._probeState = {
      argsStage: device.createBuffer({
        size: FIELD_SEGMENTS * INDIRECT_SEGMENT_HEADER_BYTES,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      indicesStage: device.createBuffer({
        size: gpu.visibleIndices.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      pending: false,
      frameIndex: 0,
    };
    this._probeParamsSnapshot = [];
  }

  /** Fresh snapshot of the cull-params mirror (captured at staging time; opt-in telemetry). */
  private _snapshotProbeParams(): void {
    const snapshot: CullParams[] = [];
    for (let v = 0; v < this._viewCount; v++) {
      const slot = this._mirror[v]!;
      const planes: [number, number, number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const src = slot.planes[i]!;
        planes.push([src[0], src[1], src[2], src[3]]);
      }
      snapshot.push({
        viewIndex: slot.params.viewIndex,
        frustumPlanes: planes,
        viewportHeightPx: slot.params.viewportHeightPx,
        fovRadiansY: slot.params.fovRadiansY,
        hzbEnabled: slot.params.hzbEnabled,
        hzbSkip: slot.params.hzbSkip,
        segmentBase: slot.params.segmentBase,
      });
    }
    this._probeParamsSnapshot = snapshot;
  }
}

/** Read-only buffer bundle shared by the bind-group creators (not exposed to callers). */
interface FieldLocals {
  records: GPUBuffer;
  prototypeInfo: GPUBuffer;
  prototypeRange: GPUBuffer;
  lodMaxima: GPUBuffer;
  indirectArgs: GPUBuffer;
  visibleIndices: GPUBuffer;
  cullParams: GPUBuffer;
  fieldInfo: GPUBuffer;
}
