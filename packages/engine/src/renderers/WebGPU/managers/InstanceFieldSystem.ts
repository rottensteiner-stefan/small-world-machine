/**
 * ADR 0059 step 1 (P1-2) / step 2 (P2-1) -- WebGPU lane of the `InstanceField` contract: ONE
 * per-field node manager that owns the GPU cull-compute + indirect-draw path
 * (`instance_cull.wgsl` + `field_pull.wgsl`). Implements the frozen `InstanceFieldRuntimeApi`
 * (core/InstanceField.ts is the single contract surface). GL CPU-cell fallback: Frank's
 * `renderers/gl/managers/InstanceFieldGL.ts`; 3rd consumer of the indirect-draw contract:
 * `GpuParticleSystemHost` (interface alignment only).
 *
 * SCOPE (P1): static population, mode-A main-view occlusion (previous-frame pyramid) over
 * frustum+size, mode-C shadow views (frustum+size only, no HZB), bucket-routed compaction from
 * day 1 (IF-CULL-ROUTING), clamp-at-capacity (IF-BUDGET), one-frame camera-cut HZB skip
 * (IF-CAMERA-CUT-HZB-SKIP). Two-phase mode 2B is spec'd in `instance_cull.wgsl`, not built.
 * SCOPE (P2-1): per-view LOD-transition knobs in the cull-param pad words (band width /
 * hysteresis / tier bias + the shadow-only bucket offset), written per frame into every view
 * block; the CULL computes the LOD buckets + crossfade-band dual writes (candidate A/C). The
 * fragment-side dither gate (`lodDitherMode`) and the draw-side blend channel belong to
 * veg-p2-erin's P2-2 surface (`field_pull.wgsl`, untouched here).
 *
 * RENDERER RELATION: the renderer owns a registration LIST (`_instanceFields`, mirroring the
 * particle list) and drives the per-frame coordinator + single-point pass hooks; this system is
 * field-scoped and never queries the scene graph. The `InstanceFieldRenderHost` (implemented by
 * `WebGPURenderer`, nullable for the pure-TS S2 scaffold) hands in every external dependency at
 * attach time -- device, shared bind-group layouts/groups, the fully composed WGSL module
 * sources, the previous-frame pyramid handle and the geometry-cache pinning bridge.
 *
 * WGSL SINGLE SOURCE: `chunks/instance_field_structs.wgsl` is the SOLE declaration of
 * `FieldInfo`/`CullParams` and the 12 `@group(2)` bindings shared by the cull compute module
 * and the pulled-draw module -- the host composes both module sources from it, so the blob
 * layout and the bind-group slot numbering can never drift between the two consumers.
 * Binding 11 (P2 `fieldLodBlend`) is declared PER CONSUMER (cull writes `read_write`, pull
 * vertex reads) exactly like bindings 2/3 -- the layout entries exist on both sides.
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
  LOD_TRANSITION_MODES,
  MAX_INDIRECT_VIEWS,
  MAX_LOD_BUCKETS,
  type CullParams,
  type FieldVisibleSets,
  type IndirectCullProbe,
  type IndirectSegmentCounts,
  type InstanceFieldOptions,
  type InstanceFieldRuntimeApi,
  type LodTransitionMode,
  type PrototypeDescriptor,
} from "../../../core/InstanceField.js";
import type { Texture, TextureArray } from "../../../core/textures/index.js";
import type { GeometryDataInterface } from "../../../interfaces/index.js";
import { Frustum, Matrix4 } from "../../../math/index.js";
import { NORMAL_TARGET_FORMAT } from "./NormalOutputWrapper.js";
import type { HzbFieldPyramidAccess } from "./HzbOcclusionSystem.js";
import type { WebGPUGeoCacheEntry } from "./GPUGeometryCache.js";

/** Frozen segment-table dimension: `MAX_INDIRECT_VIEWS * MAX_LOD_BUCKETS` (16 x 8 = 128). */
const FIELD_SEGMENTS = MAX_INDIRECT_VIEWS * MAX_LOD_BUCKETS;

/** Per-(view x bucket) cull/param block size in bytes (see the class doc / WGSL struct). */
const CULL_PARAM_BLOCK_BYTES = 256;

/** `FieldInfo` uniform size (one vec4-aligned 128 B struct, see instance_field_structs.wgsl). */
const FIELD_INFO_BYTES = 128;

/** Word offsets inside a cull-param block (bytes, little-endian, see the WGSL `CullParams`). */
const CULL_OFFSET_VIEWPORT_HEIGHT_PX = 96;
const CULL_OFFSET_FOV_RADIANS_Y = 100;
const CULL_OFFSET_HZB_ENABLED = 104;
const CULL_OFFSET_HZB_SKIP = 108;
const CULL_OFFSET_SEGMENT_BASE = 112;
const CULL_OFFSET_CULL_MODE = 116;
/** P2 pad words (bytes 120/124/128/132, see the WGSL `CullParams`): per-view LOD transition
 * knobs. `lodBiasBuckets` differs per view (shadow coarsening offset, main writes 0); the rest
 * are field-scoped and identical across views. All 4 are refreshed at every view prepare. */
const CULL_OFFSET_LOD_BIAS_BUCKETS = 120;
const CULL_OFFSET_LOD_CROSSFADE_BAND = 124;
const CULL_OFFSET_LOD_HYSTERESIS = 128;
const CULL_OFFSET_LOD_BIAS_PX = 132;
/** Word 136 (u32) -- 1 = main-camera view (size gate + HZB apply), 0 = shadow view. */
const CULL_OFFSET_IS_MAIN_VIEW = 136;
/** Word 144 (16 f32) -- Frame N-1 ZO-corrected main VP (the matrix the sampled pyramid's depth
 *     pre-pass used); consumed ONLY by `fieldHzbVisible` while `hzbEnabled`. Mirrors the WGSL
 *     `CullParams.prevVp` (mat4x4f, byte 144..208) in instance_field_structs.wgsl. */
const CULL_OFFSET_PREV_VP = 144;

/** Word offsets inside the `FieldInfo` uniform (bytes). */
const INFO_OFFSET_PAGE_CAPACITY = 0;
const INFO_OFFSET_PROTOTYPE_COUNT = 4;
const INFO_OFFSET_INSTANCE_COUNT = 8;
const INFO_OFFSET_HZB_MIP_COUNT = 12;
const INFO_OFFSET_CULL_PIXEL_SIZE = 16;
const INFO_OFFSET_ALPHA_TEST = 20;
/** `FieldInfo.albedoLayerCount` (u32, former pad word after `alphaTest`; 0 = no albedo array). */
const INFO_OFFSET_ALBEDO_LAYER_COUNT = 24;
const INFO_OFFSET_BACKLIGHT = 32;
const INFO_OFFSET_WIND_HEIGHT = 48;
/** Word 52 -- previously a struct pad; now the P2 `lodDitherMode` (0 = dither, != 0 = hard C). */
const INFO_OFFSET_LOD_DITHER_MODE = 52;
const INFO_OFFSET_WIND = 64;

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
  /** Optional texture-retention hook (the WebGPU renderer's texture cache): keeps `tex` alive for
   * the life of a field-node binding that no object's material refcount covers (the alpha map).
   * Absent on inert/test scaffolds -- callers MUST guard with `?.` and a defined-texture check. */
  retainTexture?(tex: Texture): void;
  /** Releases a reference taken with {@link retainTexture}; the cache destroys the texture at
   * count zero. Same optionality contract as {@link retainTexture}. */
  releaseRetainedTexture?(tex: Texture): void;
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
   * @domain Per-material albedo layers of the field (sRGB rgb + alpha, all layers same size),
   *         sampled with repeat addressing at the vertex uv and the vertex `materialLayers` index;
   *         multiplies the colour-stream albedo. When present its alpha drives the cutout test
   *         (`alphaTest` threshold, all draw variants incl. depth/shadow) instead of `alphaMap`.
   *         WebGPU field lane only (GL tiers: `tier-parity.json` row `field-albedo-array`).
   */
  albedoArray?: TextureArray;
  /**
   * @domain Leaf backlight tint (linear rgb; absent or black = off), ADR 0060 semantics. Scaled
   *         per vertex by the colour-stream alpha, the foliage mask (trunks 0, leaves 1).
   */
  backlight?: readonly [number, number, number];
  /** @domain Transmission-shadow offset toward the sun in metres (ADR 0060 default 0.5). */
  backlightThickness?: number;
  /**
   * @domain Live `SwmWind` block producer (16 floats, `vegetation-extras` `WindField.uniforms`)
   *         rewritten by the owner every frame. The system uploads the CURRENT bytes once per
   *         frame at the main-view prepare (frame head) -- borrowed reference, never copied.
   *         `windHeight > 0` with this missing is a setup error (fail fast).
   */
  windUniforms?: Float32Array;
  /**
   * @domain Crown-top height of the population prototype in metres at scale 1 (vertical wind
   *         profile + bend normalizer). 0 disables wind entirely (fail-closed). The per-frame
   *         `FieldInfo.wind` words stay zero while this is 0.
   */
  windHeight?: number;
  /**
   * @domain P2 DECISIVE MODE SWITCH (ADR 0059 step 2, moderator decision 2026-11-10): ONE
   *         declarative transition strategy via {@link LOD_TRANSITION_MODES} (`off` = explicit
   *         P1-identical hard routing; engine default = `hysteresis` — decided 2026-11-10;
   *         `dither` / `dither-hysteresis` = TAA-pipeline opt-in presets with bounded cost).
   *         When present it DERIVES the raw knobs and takes precedence
   *         over any `lodCrossfadeBand`/`lodHysteresis`/`lodDitherMode` in this setup. Runtime-
   *         toggleable via {@link InstanceFieldSystem.setLodTransitionMode}.
   */
  lodTransitionMode?: LodTransitionMode;
  /**
   * @domain P2 LOD-transition mode (ADR 0059 step 2): `"crossfade"` (default) = dither crossfade
   *         between bucket geometries in the pulled fragments; `"hard"` = candidate C (hard switch
   *         + hysteresis lives in the CULL; the fragment skips the dither — `FieldInfo.lodDitherMode`
   *         word). Runtime-toggleable via {@link InstanceFieldSystem.setLodDitherMode}.
   */
  lodDitherMode?: "crossfade" | "hard";
}

/** Vertex streams bound per bucket: slot 1 normal, 2 uv, 3 colour (slot 0 = the cached position).
 * Streams the geometry lacks are completed once at setup (`owned`, destroyed on dispose). */
interface FieldBucketStreams {
  normal: GPUBuffer;
  uv: GPUBuffer;
  color: GPUBuffer;
  /** Slot 4: per-vertex material layer (float32, `materialLayers`, zero-filled when absent). */
  layer: GPUBuffer;
  owned: GPUBuffer[];
}

/**
 * @domain Zero-config engine default of the DECISIVE MODE SWITCH (ADR 0059 step 2, decision
 *   landed 2026-11-10): `hysteresis` — band 0, per-instance rate-limit jitter 0.02, HARD dither
 *   gate (no fragment pattern). Chosen from the §6 live sighting on the real M4 Pro: the dither
 *   presets read as a coarse moiré/flicker WITHOUT TAA (the engine-wide default display path)
 *   and only degrade to a residual fine grain WITH TAA — neither is acceptable as a zero-config
 *   default. Hysteresis decorrelates hard switches across the population without any visual
 *   pattern (cull-side ALU only); `off` remains the explicit P1-identical baseline opt-in.
 */
const DEFAULT_LOD_TRANSITION_MODE: LodTransitionMode = "hysteresis";

/** Options defaults so `{}` (S2 scaffold) builds a valid inert node (host null). */
const DEFAULT_OPTIONS: InstanceFieldOptions = {
  prototypes: [],
  cellSize: 1,
  maxInstances: 0,
  cullPixelSize: 2,
  shadowLodBias: 0,
  // 21 = the full WebGPU view-slot table (`VIEW_SLOT_COUNT`): main camera + 4 CSM cascades +
  // 4 spot shadows + 2 point lights x 6 faces. A lower default would SILENTLY drop every shadow
  // view at or above it (cascade 3, all spots, all point faces) for any field that did not
  // author a `maxViews` budget -- the P0 the audit surfaced. Memory trade: the segment pages are
  // pre-allocated per USED view (21 x 8 x 2 x maxInstances x 4 B x 2 buffers worst case); authors
  // of large fields should set `maxViews` to their reachable shadow-view count.
  maxViews: 21,
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
  /** P2: per-(segment x slot) signed LOD blend pages, page-indexed like `visibleIndices`
   *  ([bv * pageCapacity + slot]). Zero-filled; the cull compute rewrites live values
   *  (`fieldLodBlend`, declared per-consumer on slot 11 -- bindings 2/3 pattern). */
  fieldLodBlend: GPUBuffer;
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
  /** Repeat/trilinear/anisotropic sampler of the albedo array (binding 13). */
  albedoSampler: GPUSampler;
  /** 1x1x1 white `2d-array` fallback bound at binding 12 when no `albedoArray` is authored. */
  albedoFallback: GPUTexture;
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
  const layers = geo.materialLayers;
  const layer =
    layers && layers.length === vertexCount
      ? upload(layers)
      : upload(new Float32Array(vertexCount));
  return { normal, uv, color: upload(rgba), layer, owned };
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
  /** Effective record capacity. Grows at runtime when a live population exceeds the authored
   * `maxInstances` (see `_ensureCapacity`) -- mutable so the growth path can re-derive it. */
  private _maxInstances: number;
  /** Per-(view x bucket) compaction page size: `max(1, 2 x _maxInstances)` (WP-A1 2; the LOD
   * crossfade band's two-bucket emission is the worst case). Grows with `_maxInstances`. */
  private _pageCapacity: number;
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
  private readonly _albedoArray: TextureArray | undefined;
  /** `FieldInfo.backlight`: linear tint rgb + transmission-shadow offset (w = 0 -> off). */
  private readonly _backlight: Float32Array = new Float32Array(4);
  /** Crown-top height at scale 1 (metres); 0 disables wind (`FieldInfo.windHeight`, fail-closed).
   *  Mutable via {@link setWind} (live HUD toggle); the height word is patched on change. */
  private _windHeight: number;
  /** Live `SwmWind` block (16 floats, borrowed reference) uploaded once per frame at the header.
   *  Live-swappable via {@link setWind} (undefined + height 0 = hard wind-off). */
  private _windUniforms: Float32Array | undefined;
  /** P2 LOD dither mode word (`FieldInfo.lodDitherMode`): 0 = crossfade, 1 = hard (candidate C). */
  private _lodDitherMode: number;
  /** P2 band-width knob (cull pad word @124, candidate A): [0,1] fraction of each EFFECTIVE
   *  threshold; 0 = hard switch (candidate C, single routing). Knob default 0; the engine default
   *  transition mode (hysteresis) keeps 0 and adds only the rate-limit jitter (never a band). */
  private _lodCrossfadeBand: number;
  /** P2 hysteresis knob (cull pad word @128, candidate C): [0,1] per-instance deterministic
   *  jitter fraction of each EFFECTIVE threshold (decorrelates hard switches, stateless). */
  private _lodHysteresis: number;
  /** P2 tier-bias knob (cull pad word @132): additive px bias on EVERY threshold (negative =
   *  coarser selection at the same pixel footprint). Any finite float, default 0. */
  private _lodBiasPx: number;
  /** P2 DECISIVE MODE SWITCH (ADR 0059 step 2, moderator decision 2026-11-10): last applied
   *  {@link LodTransitionMode}. `setLodTransitionMode` is the only writer; the raw knob setters
   *  do NOT touch it (mirrors the applied mode truthfully via the other `_lod*` fields). Engine
   *  default = {@link DEFAULT_LOD_TRANSITION_MODE} (`hysteresis`, decision 2026-11-10); `off` is
   *  the explicit P1-identical baseline opt-in. */
  private _lodTransitionMode: LodTransitionMode = DEFAULT_LOD_TRANSITION_MODE;
  /** Authored `shadowLodBias` (frozen option): coarsening offset in LOD levels written ONLY
   *  into shadow-view blocks (`0` = reuse the main camera's choice, the required default);
   *  clamped into `[0, MAX_LOD_BUCKETS-1]`. The cull applies `max(bucket - bias, 0)`. */
  private readonly _shadowLodBias: number;
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
  /** Frame N-1 ZO-corrected main view-projection (16 floats, uploaded into `CullParams.prevVp` at
   *  every view prepare). Lagged one frame inside `prepareMainView` -- the HZB pyramid the field
   *  lane samples at the frame head was built from THIS matrix, so `fieldHzbVisible` must project
   *  into exactly this space. Zero until the second main-view prepare; only consumed while
   *  `hzbEnabled` (never on the first frame). */
  private readonly _prevMainVp: Float32Array = new Float32Array(16);
  /** Work matrix for `_prevMainVp = ZO_CORRECTION * rawVp` (zero-alloc roll in `prepareMainView`). */
  private readonly _prevMainVpMatrix: Matrix4 = new Matrix4();
  /** Pre-allocated `FieldInfo` upload scratch (one 128-B ArrayBuffer with u32/f32 views): the
   * per-frame `_writeFieldInfo()`/`_writeFieldInfoWord*()` hot path MUST NOT allocate TypedArrays.
   * Wind words (64..127) stay zero here forever (never aliased -- `_writeWind()` uploads the
   * producer block directly), so the full-buffer upload mirrors the historical zero-init exactly. */
  private readonly _fieldInfoScratch = new ArrayBuffer(FIELD_INFO_BYTES);
  private readonly _fieldInfoU32 = new Uint32Array(this._fieldInfoScratch);
  private readonly _fieldInfoF32 = new Float32Array(this._fieldInfoScratch);
  /** Single-word upload scratches for the `FieldInfo` word patches. */
  private readonly _wordScratchU32 = new Uint32Array(1);
  private readonly _wordScratchF32 = new Float32Array(1);
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

  /**
   * @domain P2 decisive-spike knob (ADR 0059 step 2): switches LOD transitions between the dither
   *         crossfade (candidate A) and the hard switch (candidate C). Candidate C's hysteresis /
   *         band-width live in the CULL (Bob's P2-1 surface); this only toggles the fragment-side
   *         dither gate. Patches the `FieldInfo.lodDitherMode` word immediately (this frame).
   */
  public setLodDitherMode(mode: "crossfade" | "hard"): void {
    this._lodDitherMode = mode === "hard" ? 1 : 0;
    this._writeFieldInfoWord(INFO_OFFSET_LOD_DITHER_MODE, this._lodDitherMode);
  }

  /**
   * @domain P2 decisive-spike knob (ADR 0059 step 2): live-overrides the field's LOD transition
   *         tuning (candidate A band width / candidate C jitter + tier bias). Field-scoped and
   *         identical across views; takes effect on the NEXT cull frame, because every view
   *         block is re-written (knobs + shadow bias) at each prepare. `undefined` leaves a knob
   *         untouched; out-of-range band/hysteresis fail fast.
   */
  public setLodTransition(opts: {
    crossfadeBand?: number;
    hysteresis?: number;
    biasPx?: number;
  }): void {
    if (opts.crossfadeBand !== undefined) {
      if (!(opts.crossfadeBand >= 0 && opts.crossfadeBand <= 1)) {
        throw new Error(
          `[InstanceFieldSystem] crossfadeBand must be in [0,1], got "${opts.crossfadeBand}".`,
        );
      }
      this._lodCrossfadeBand = opts.crossfadeBand;
    }
    if (opts.hysteresis !== undefined) {
      if (!(opts.hysteresis >= 0 && opts.hysteresis <= 1)) {
        throw new Error(
          `[InstanceFieldSystem] hysteresis must be in [0,1], got "${opts.hysteresis}".`,
        );
      }
      this._lodHysteresis = opts.hysteresis;
    }
    if (opts.biasPx !== undefined) {
      if (!Number.isFinite(opts.biasPx)) {
        throw new Error(`[InstanceFieldSystem] biasPx must be finite, got "${opts.biasPx}".`);
      }
      this._lodBiasPx = opts.biasPx;
    }
  }

  /**
   * @domain P2 DECISIVE MODE SWITCH (ADR 0059 step 2, moderator decision 2026-11-10): selects ONE
   *         documented LOD-transition strategy from {@link LOD_TRANSITION_MODES} and derives the
   *         raw knobs (`crossfadeBand`, `hysteresis`, fragment dither gate) — the single
   *         declarative surface (multiple solutions behind one switch, each with bounded cost).
   *         Live-safe: the dither gate word patches IMMEDIATELY (this frame);
   *         band/hysteresis take effect on the NEXT cull frame (view blocks refresh per prepare).
   *         Fails fast on unknown modes; `"off"` = explicit P1-identical hard routing (engine
   *         default = `hysteresis`, decided 2026-11-10).
   *         {@link lodTransitionMode} reports the last applied mode; the raw knob setters do not
   *         change it (last call wins for the knobs themselves).
   */
  public setLodTransitionMode(mode: LodTransitionMode): void {
    if (!(mode in LOD_TRANSITION_MODES)) {
      throw new Error(
        `[InstanceFieldSystem] lodTransitionMode must be one of ${Object.keys(LOD_TRANSITION_MODES).join(", ")}, got "${mode}".`,
      );
    }
    const preset = LOD_TRANSITION_MODES[mode];
    this.setLodTransition({ crossfadeBand: preset.crossfadeBand, hysteresis: preset.hysteresis });
    this._lodDitherMode = preset.ditherGate;
    this._writeFieldInfoWord(INFO_OFFSET_LOD_DITHER_MODE, this._lodDitherMode);
    this._lodTransitionMode = mode;
  }

  /**
   * @domain Read-only mirror of the last applied {@link LodTransitionMode}. Engine default
   *         `hysteresis` (decision 2026-11-10) is applied at construction ONLY for zero-config
   *         fields (no authored mode AND no raw transition knob); authors on the legacy raw-knob
   *         path keep their knobs (mirror stays at the engine default label). The raw knob
   *         setters do not touch the mirror; applied knobs are always readable through the other
   *         P2 state.
   */
  public get lodTransitionMode(): LodTransitionMode {
    return this._lodTransitionMode;
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
    this._albedoArray = setup.albedoArray;
    const tint = setup.backlight;
    if (tint && (tint[0] > 0 || tint[1] > 0 || tint[2] > 0)) {
      this._backlight[0] = tint[0];
      this._backlight[1] = tint[1];
      this._backlight[2] = tint[2];
      this._backlight[3] = Math.max(1e-4, setup.backlightThickness ?? 0.5);
    }
    const windHeight = setup.windHeight ?? 0;
    const windUniforms = setup.windUniforms;
    if (windHeight > 0 && (windUniforms === undefined || windUniforms.length !== 16)) {
      throw new Error(
        "[InstanceFieldSystem] windHeight > 0 requires a 16-float windUniforms `SwmWind` block.",
      );
    }
    this._windHeight = windHeight;
    this._windUniforms = windUniforms;

    const lodDitherMode = setup.lodDitherMode ?? "crossfade";
    if (lodDitherMode !== "crossfade" && lodDitherMode !== "hard") {
      throw new Error(
        `[InstanceFieldSystem] lodDitherMode must be "crossfade" or "hard", got "${lodDitherMode}".`,
      );
    }
    this._lodDitherMode = lodDitherMode === "hard" ? 1 : 0;

    // P2 LOD-transition knobs (cull pad words 120-132; authored mirror fields are optional).
    const crossfadeBand = options.lodCrossfadeBand ?? 0;
    if (!(crossfadeBand >= 0 && crossfadeBand <= 1)) {
      throw new Error(
        `[InstanceFieldSystem] lodCrossfadeBand must be in [0,1], got "${crossfadeBand}".`,
      );
    }
    this._lodCrossfadeBand = crossfadeBand;
    const hysteresis = options.lodHysteresis ?? 0;
    if (!(hysteresis >= 0 && hysteresis <= 1)) {
      throw new Error(`[InstanceFieldSystem] lodHysteresis must be in [0,1], got "${hysteresis}".`);
    }
    this._lodHysteresis = hysteresis;
    const biasPx = options.lodBiasPx ?? 0;
    if (!Number.isFinite(biasPx)) {
      throw new Error(`[InstanceFieldSystem] lodBiasPx must be finite, got "${biasPx}".`);
    }
    this._lodBiasPx = biasPx;
    // P2 DECISIVE MODE SWITCH: an authored mode derives the raw knobs and takes precedence over
    // any raw knob values above (single declarative surface; documented contract: "when present
    // it takes precedence" — absent the raw knobs are honored). WITHOUT a mode AND WITHOUT any
    // authored raw transition knob (band/hysteresis/dither-gate), the engine applies its
    // zero-config default (DEFAULT_LOD_TRANSITION_MODE = hysteresis, decision 2026-11-10) so the
    // mode mirror and the applied knobs never diverge at construction. `off` = explicit
    // P1-identical opt-in. Authors who configure raw knobs stay on the legacy raw path.
    const authoredRawTransition =
      options.lodCrossfadeBand !== undefined ||
      options.lodHysteresis !== undefined ||
      setup.lodDitherMode !== undefined;
    if (setup.lodTransitionMode !== undefined) {
      this.setLodTransitionMode(setup.lodTransitionMode);
    } else if (!authoredRawTransition) {
      this.setLodTransitionMode(DEFAULT_LOD_TRANSITION_MODE);
    }
    this._shadowLodBias = Math.min(
      Math.max(0, Math.floor(options.shadowLodBias)),
      MAX_LOD_BUCKETS - 1,
    );

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
    // (aerial camera, one shadow cascade covering it), and the AUDITED compaction worst case is
    // the LOD crossfade band's TWO-bucket emission (the most adverse per-bucket routing writes up
    // to 2 * maxInstances into one page) -- so the page is sized at 2 * maxInstances, and the
    // cull's `fieldEmit` additionally clamps the drawn instanceCount to `fieldInfo.pageCapacity`
    // (P0: `drawIndexedIndirect` can then never execute a vertex with iid >= capacity). The
    // former `max(1024, maxInstances / 16)` overflowed at 5.5k visible trees: survivors past the
    // page were dropped at random (atomic order) while the draw still used the full count ->
    // flicker + instances read from foreign pages. Memory stays bounded because only the USED
    // segments get pages (see setup).
    this._pageCapacity = Math.max(1, this._maxInstances * 2);

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
        lodBiasBuckets: 0,
        lodCrossfadeBand: this._lodCrossfadeBand,
        lodHysteresis: this._lodHysteresis,
        lodBiasPx: this._lodBiasPx,
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

  /**
   * Live-replaces the population RECORD BYTES in place (zero-GC hot path, P1b ground-cover feed):
   * re-derives the ranges and re-uploads the current `_instanceRecords` into the ALREADY-SIZED
   * record buffer, then refreshes the `FieldInfo` mirror. No static-table rewrite, no buffer
   * regrow, no bind-group/pipeline rebuild — capacity MUST be preallocated via `maxInstances`
   * (a larger population still requires `setPopulationData` + {@link rebuild}).
   * Single-prototype fields take an O(1) range fast path (the whole population maps to
   * prototype 0); multi-prototype fields fall back to the full sorted-map walk of
   * {@link _deriveRanges}. The engine never copies:
   * {@link _uploadRecords} memcpy's the caller's array synchronously via `writeBuffer`.
   */
  public uploadRecords(): void {
    if (!this._gpu) return;
    if (this._protoCount === 1) {
      const total = this._instanceRecords.length / 4;
      this._instanceCount = total;
      this._protoRange.fill(0);
      this._protoRange[1] = total;
    } else {
      this._deriveRanges();
    }
    // Population beyond the authored capacity would let the cull's compaction pages overflow
    // (`visibleIndices`/`fieldLodBlend` are sized `2 x _maxInstances`): grow the dependent
    // buffers once (deferred-destroyed, bind groups rebuilt), never per frame. Zero-cost when
    // the population fits (a single integer compare).
    this._ensureCapacity(this._instanceCount);
    this._uploadRecords();
    this._writeFieldInfo();
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

  /**
   * Live-swaps the wind state (HUD toggles, not just URL-time setup). `windHeight` > 0 requires
   * a 16-float `SwmWind` block (same fail-fast contract as the constructor); height 0 = hard
   * wind-off (the pulled shader's `fieldInfo.windHeight > 0` gate makes the lane static) and the
   * per-frame `_writeWind()` becomes a no-op. The height word is patched into `FieldInfo`
   * immediately -- it must take effect THIS frame, exactly like the HZB mip-count patch.
   */
  public setWind(wind: Float32Array | undefined, windHeight: number): void {
    if (windHeight > 0 && (wind === undefined || wind.length !== 16)) {
      throw new Error(
        "[InstanceFieldSystem] windHeight > 0 requires a 16-float windUniforms `SwmWind` block.",
      );
    }
    this._windHeight = windHeight;
    this._windUniforms = wind;
    this._writeFieldInfoWordFloat(INFO_OFFSET_WIND_HEIGHT, windHeight);
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
    // Frame head: forward the producer's CURRENT wind block (no-op while wind is disabled).
    this._writeWind();
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
    // Main view: `lodBiasBuckets` = 0 (shadow views apply `shadowLodBias` on top of THIS choice).
    // `prevVp` = Frame N-1's ZO-corrected main VP (see `_prevMainVp`): the pyramid the lane
    // samples was built from it, so `fieldHzbVisible` must project into its space.
    this._writeViewParams(
      0,
      vp,
      viewportHeightPx,
      fovRadiansY,
      hzEnabled,
      skip,
      1,
      0,
      true,
      this._prevMainVp,
    );
    // Roll the corrected main VP one frame (zero-alloc): the NEXT frame's cull needs the frame
    // whose depth will build the pyramid the same frame. `_vpScratch` still holds the raw `vp`
    // (`_writeViewParams` copied it for the frustum extraction above).
    Matrix4.multiply(Matrix4.ZO_CORRECTION, this._vpScratch, this._prevMainVpMatrix);
    this._prevMainVp.set(this._prevMainVpMatrix.data);
  }

  /** Culls the MAIN view (view 0): records the once-per-frame counter reset, then the mode-A
   * cull dispatch (dynamic param block 0). No-op on an inert / empty field. */
  public cullMainView(ce: GPUCommandEncoder): void {
    this._recordCull(ce, 0);
  }

  /** Prepares a SHADOW view (viewIndex >= 1): frustum from the RAW VP, mode C (no HZB),
   * metric inputs anchored to the main camera. Overflow views (>= `maxViews`, e.g. every shadow
   * view of a `maxViews: 1` field like GroundCover) are skipped -- the frozen contract wording
   * ("overflow views are not field-culled") is exactly what keeps `maxViews <= 1` fields out of
   * the spot/point/cascade shadow draws. The P2 shadow-only LOD coarsening (`shadowLodBias`,
   * 0 = reuse the main choice) rides into `lodBiasBuckets`. */
  public prepareShadowView(viewIndex: number, vp: Float32Array): void {
    this._writeViewParams(
      viewIndex,
      vp,
      this._mainViewportHeightPx,
      this._mainFovRadiansY,
      false,
      false,
      0,
      this._shadowLodBias,
      false,
      this._prevMainVp,
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
    // View-index guard: a field is drawn for view N only if N is inside its allocated `maxViews`
    // budget. This is what keeps `maxViews <= 1` fields (e.g. GroundCover) completely out of the
    // cascade/spot/point shadow draws -- the passes prepare them, the segment table has no page
    // beyond `_viewCount`, and `recordDraw` skips them here.
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
      gpu.fieldLodBlend.destroy();
      gpu.cullParams.destroy();
      gpu.fieldInfo.destroy();
      gpu.albedoFallback.destroy();
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
      // Drop the alpha-map reference taken at attach (`_buildGpuState`): the texture cache can
      // now destroy the map when no other consumer holds it (see `InstanceFieldRenderHost`).
      if (this._alphaMap && this._host.releaseRetainedTexture) {
        this._host.releaseRetainedTexture(this._alphaMap);
      }
      if (this._albedoArray && this._host.releaseRetainedTexture) {
        this._host.releaseRetainedTexture(this._albedoArray);
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
    // P2 LOD-blend pages, same size/page math as `visibleIndices`. Fail-closed ZERO at creation:
    // an unwritten slot reads 0 -> the fragment keeps the instance unconditionally, exactly the
    // P1 behavior until the cull's P2-1 band writes land. `createBuffer` without
    // `mappedAtCreation` is zero-initialized by the WebGPU spec, so no CPU-side zero-fill is
    // needed or done -- the old `new Uint8Array(visibleBytes)` parked up to 64+ MB on the JS
    // heap per rebuild for nothing.
    const fieldLodBlend = device.createBuffer({
      size: visibleBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
        // P2 LOD-blend pages: the CULL writes the signed crossfade blends (compute `read_write`;
        // the pull VERTEX only reads them -- its own declaration + VERTEX-visible read-only-
        // storage entry, bindings 2/3 pattern). Present in this layout because the cull module
        // declares binding 11 at module scope (the reset entry shares this layout).
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const drawFieldBGL = this._createDrawFieldBGL(device);
    const alphaSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    // Bark/leaf textures tile (uv outside [0,1]); trilinear + anisotropy for grazing ground views.
    const albedoSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
      maxAnisotropy: 8,
    });
    const albedoFallback = device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: albedoFallback },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );

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
      fieldLodBlend,
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
      this._albedoView(albedoFallback),
      albedoSampler,
    );
    // The alpha map is bound outside any object's material -- retain it in the renderer's
    // texture cache so a shared/reused map cannot be destroyed underneath the draw bind group
    // when the last regular consumer releases it. Released once in `dispose()`.
    if (this._alphaMap && host.retainTexture) host.retainTexture(this._alphaMap);
    if (this._albedoArray && host.retainTexture) host.retainTexture(this._albedoArray);

    this._gpu = {
      records,
      prototypeInfo,
      prototypeRange,
      lodMaxima,
      indirectArgs,
      visibleIndices,
      fieldLodBlend,
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
      albedoSampler,
      albedoFallback,
    };

    // Static table writes (geometry words, prototype tables, per-segment bases) + population.
    this._writeStaticTables();
    this._uploadRecords();
    this._writeFieldInfo();
    if (this._probe) this._ensureProbeState();
  }

  /** Regrows population-dependent buffers after `rebuild()` (records + fieldInfo + tables). */
  private _rebuildGpuBuffers(): void {
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !device) return;
    // Population beyond the authored capacity (or a record buffer that no longer fits) regrows
    // `records`/`visibleIndices`/`fieldLodBlend` + `_maxInstances`/`_pageCapacity` and refreshes
    // BOTH field bind groups, so `gpu.cullBg` never keeps referencing a deferred-destroyed
    // `records` buffer after the rebuild. No-op while the population fits.
    this._ensureCapacity(this._instanceCount);
    this._uploadRecords();
    this._writeFieldInfo();
    this._writeStaticTables();
  }

  /**
   * Grows the population-dependent GPU buffers so `recordCount` records stay inside their
   * capacity contract: the cull's per-(view x bucket) compaction pages (`visibleIndices`/
   * `fieldLodBlend`) are sized `2 x _maxInstances` (`_pageCapacity`, WP-A1 2) and the record
   * storage is a CPU-side copy of the live array. A population beyond `_maxInstances` would let
   * the cull's `fieldEmit` write survivors past the page end (`atomicAdd` overflow -> OOB
   * store), so growth re-derives `_maxInstances`/`_pageCapacity` from the actual population,
   * re-creates the three dependent buffers, immediately rebuilds both bind groups (they
   * reference whole buffers -- never leave `cullBg` pointing at the old one), re-sizes the probe
   * staging and deferred-destroys the replaced buffers. No-op while everything still fits
   * (zero allocation; the guard is a plain integer compare in the per-frame hot path).
   */
  private _ensureCapacity(recordCount: number): void {
    const gpu = this._gpu;
    const host = this._host;
    const device = host?.gpuDevice;
    if (!gpu || !device) return;
    const recordsBytes = Math.max(1, recordCount) * INSTANCE_RECORD_BYTES;
    const recordsNeedRegrow = recordsBytes > gpu.records.size;
    const pagesNeedRegrow = recordCount > this._maxInstances;
    if (!recordsNeedRegrow && !pagesNeedRegrow) return;

    // The cached cull bind groups reference the buffers being replaced -- drop them all.
    this._cullBgByView.clear();
    if (pagesNeedRegrow) {
      this._maxInstances = recordCount;
      this._pageCapacity = Math.max(1, recordCount * 2);
    }
    if (recordsNeedRegrow) {
      const next = device.createBuffer({
        size: recordsBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      host.deferDestroyBuffer(gpu.records);
      gpu.records = next;
    }
    if (pagesNeedRegrow) {
      const usedSegments =
        (this._viewCount - 1) * MAX_LOD_BUCKETS + Math.max(1, this._maxBucketCount);
      const visibleBytes = usedSegments * this._pageCapacity * 4;
      const nextVisible = device.createBuffer({
        size: visibleBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const nextLodBlend = device.createBuffer({
        size: visibleBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      host.deferDestroyBuffer(gpu.visibleIndices);
      host.deferDestroyBuffer(gpu.fieldLodBlend);
      gpu.visibleIndices = nextVisible;
      gpu.fieldLodBlend = nextLodBlend;
    }
    this._rebuildBindGroups();
    if (pagesNeedRegrow && this._probeState) {
      // The probe's indices staging mirrors the visible-page size; re-create it against the
      // NEW buffers (a pending readback of the old size is dropped -- latency self-corrects).
      this._probeState.argsStage.destroy();
      this._probeState.indicesStage.destroy();
      this._probeState = undefined;
      this._ensureProbeState();
    }
  }

  /** Rewrites both field bind groups after a buffer regrow or capacity growth (they reference
   * whole buffers): the draw group (static) AND the cull group against the CURRENT previous-frame
   * pyramid handle, so `gpu.cullBg` can never keep referencing a deferred-destroyed buffer when
   * it was replaced this call. */
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
      fieldLodBlend: gpu.fieldLodBlend,
      cullParams: gpu.cullParams,
      fieldInfo: gpu.fieldInfo,
    };
    gpu.drawBg = this._createDrawBindGroup(
      device,
      gpu.drawFieldBGL,
      locals,
      host.getTextureView(this._alphaMap),
      gpu.alphaSampler,
      this._albedoView(gpu.albedoFallback),
      gpu.albedoSampler,
    );
    // `_cullBgByView` was cleared by the regrow path; `_rebuildCullBg` re-creates + re-caches the
    // cull group against the current pyramid handle (the `gpu.cullBg` write happens there).
    this._rebuildCullBg(host.getPreviousFrameHzb());
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

  /** (Re)writes the static `FieldInfo` uniform (page capacity, counts, metric gate, alpha,
   *  backlight, wind height). The `wind` words are NOT here -- they change every frame and are
   *  forwarded by `_writeWind()` at each main-view prepare. Zero allocation: reuse the
   *  pre-allocated `_fieldInfoU32`/`_fieldInfoF32` scratch (alias one 128-B ArrayBuffer). */
  private _writeFieldInfo(): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device) return;
    const words = this._fieldInfoU32;
    const floats = this._fieldInfoF32;
    words[INFO_OFFSET_PAGE_CAPACITY / 4] = this._pageCapacity;
    words[INFO_OFFSET_PROTOTYPE_COUNT / 4] = this._protoCount;
    words[INFO_OFFSET_INSTANCE_COUNT / 4] = this._instanceCount;
    words[INFO_OFFSET_HZB_MIP_COUNT / 4] = this._hzMipCount;
    floats[INFO_OFFSET_CULL_PIXEL_SIZE / 4] = this._cullPixelSize;
    floats[INFO_OFFSET_ALPHA_TEST / 4] = this._alphaTest;
    words[INFO_OFFSET_ALBEDO_LAYER_COUNT / 4] = this._albedoArray?.images.length ?? 0;
    floats.set(this._backlight, INFO_OFFSET_BACKLIGHT / 4);
    floats[INFO_OFFSET_WIND_HEIGHT / 4] = this._windHeight;
    words[INFO_OFFSET_LOD_DITHER_MODE / 4] = this._lodDitherMode;
    device.queue.writeBuffer(gpu.fieldInfo, 0, words);
  }

  /** Uploads the CURRENT `SwmWind` bytes into `FieldInfo.wind` (frame head, main-view prepare).
   *  The producer rewrites its 16-float block every frame; the system only forwards it -- no
   *  copy, no allocation. No-op while wind is disabled (`windHeight` 0) or the array is absent. */
  private _writeWind(): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    const wind = this._windUniforms;
    if (!gpu || !device || this._windHeight <= 0 || wind === undefined) return;
    device.queue.writeBuffer(gpu.fieldInfo, INFO_OFFSET_WIND, wind);
  }

  /** Patches ONE u32 word of the `FieldInfo` uniform (e.g. the HZB mip count after a resize).
   *  Zero allocation: reuse the pre-allocated single-word scratch. */
  private _writeFieldInfoWord(offset: number, value: number): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device) return;
    this._wordScratchU32[0] = value;
    device.queue.writeBuffer(gpu.fieldInfo, offset, this._wordScratchU32);
  }

  /** Patches ONE f32 word of the `FieldInfo` uniform (the live-toggled `windHeight`). Zero
   *  allocation: reuse the pre-allocated single-word scratch. */
  private _writeFieldInfoWordFloat(offset: number, value: number): void {
    const gpu = this._gpu;
    const device = this._host?.gpuDevice;
    if (!gpu || !device) return;
    this._wordScratchF32[0] = value;
    device.queue.writeBuffer(gpu.fieldInfo, offset, this._wordScratchF32);
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
        fieldLodBlend: gpu.fieldLodBlend,
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
    lodBiasBuckets: number,
    isMainView: boolean,
    prevVp: Float32Array,
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
    // P2 LOD-transition knobs (pad words, see the WGSL `CullParams`). The bucket offset differs
    // per view (shadow views coarsen via `shadowLodBias`, the main view writes 0 = reuse its
    // choice); band/hysteresis/bias are field-scoped, identical in every view block.
    words[CULL_OFFSET_LOD_BIAS_BUCKETS / 4] = lodBiasBuckets;
    block[CULL_OFFSET_LOD_CROSSFADE_BAND / 4] = this._lodCrossfadeBand;
    block[CULL_OFFSET_LOD_HYSTERESIS / 4] = this._lodHysteresis;
    block[CULL_OFFSET_LOD_BIAS_PX / 4] = this._lodBiasPx;
    // Shadow views: `isMainView` (size-gate + HZB apply) and `prevVp` (frame N-1 main VP). Both
    // are only ever consumed by `fieldHzbVisible` / the main-view size gate, so shadow views
    // carry the harmless main-view value (never read).
    words[CULL_OFFSET_IS_MAIN_VIEW / 4] = isMainView ? 1 : 0;
    block.set(prevVp, CULL_OFFSET_PREV_VP / 4);

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
    params.lodBiasBuckets = lodBiasBuckets;
    params.lodCrossfadeBand = this._lodCrossfadeBand;
    params.lodHysteresis = this._lodHysteresis;
    params.lodBiasPx = this._lodBiasPx;
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

    // Fixed five streams (slot = array index): position, normal, uv, colour, layer -- every bucket binds
    // all of them (`FieldBucketStreams` completes missing ones), so no per-geometry variants.
    const vertexBufferSlots: GPUVertexBufferLayout[] = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
      { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }] },
      { arrayStride: 4, attributes: [{ shaderLocation: 4, offset: 0, format: "float32" }] },
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
    rp.setVertexBuffer(4, streams.layer);
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
        // Albedo array + its repeat sampler (declared in `field_pull.wgsl` only; the cull never
        // reads them, so the shared cull layout stays unchanged).
        {
          binding: 12,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d-array" },
        },
        { binding: 13, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        // P2 LOD-blend pages: the pull VERTEX reads the signed blend beside the visible index
        // (declared in `field_pull.wgsl`, per-consumer binding-2/3 pattern -- the slot also
        // exists in the cull layout for Bob's compute write).
        {
          binding: 11,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
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
        { binding: 11, resource: { buffer: l.fieldLodBlend } },
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
    albedoView: GPUTextureView,
    albedoSampler: GPUSampler,
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
        { binding: 11, resource: { buffer: l.fieldLodBlend } },
        { binding: 12, resource: albedoView },
        { binding: 13, resource: albedoSampler },
      ],
    });
  }

  /** View of the authored albedo array (texture cache, `2d-array`), else the white fallback. An
   * array the cache cannot resolve as an array (unloaded) falls back too, never a 2d view. */
  private _albedoView(fallback: GPUTexture): GPUTextureView {
    const host = this._host;
    if (this._albedoArray && host && this._albedoArray.isLoaded) {
      return host.getTextureView(this._albedoArray);
    }
    return fallback.createView({ dimension: "2d-array" });
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
        lodBiasBuckets: slot.params.lodBiasBuckets ?? 0,
        lodCrossfadeBand: slot.params.lodCrossfadeBand ?? 0,
        lodHysteresis: slot.params.lodHysteresis ?? 0,
        lodBiasPx: slot.params.lodBiasPx ?? 0,
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
  fieldLodBlend: GPUBuffer;
  cullParams: GPUBuffer;
  fieldInfo: GPUBuffer;
}
