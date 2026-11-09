/**
 * InstanceField contract — ADR 0059 step 1 (P1), FROZEN at sync point S1.
 *
 * Scope: TYPES ONLY. No runtime methods beyond pure helpers. This file is the single frozen
 * API surface for the instance-field render path and the shared indirect-draw contract:
 *   [1] WebGPU cull-compute lane (Bob, `renderers/WebGPU/managers/InstanceFieldSystem.ts`),
 *   [2] WebGL2/WebGL1 CPU-cell fallback lane (Frank, `renderers/gl/managers/InstanceFieldGL.ts`),
 *   [3] GPU particle system (3rd consumer, `GpuParticleSystemHost`) — interface-alignment only,
 *       no `gpu_particles.wgsl` semantic change (ADR 0059 step 1).
 * Implementers code against EXACTLY these names. No field may be renamed by a lane.
 *
 * Right-handed world space (+X right, +Y up, +Z backward). All instance data is world space.
 * Frustum plane convention: planes face INWARD, inside iff `n·p + d >= 0` — identical to the
 * engine's `Frustum.setFromMatrix` (Gribb–Hartmann) and to `FRUSTUM-DUAL-SPACE`
 * (`p_ndc in [-1,1]^3`). The P1-4 CPU reference (`InstanceFieldCullRef`) MUST mirror this
 * orientation; the WGSL must mirror the CPU reference (single orientation, binding).
 *
 * V1 population model (binding): population is STATIC — records are written exactly once and
 * the engine owns the cell sort. Full rebuild is the only mutation path
 * (`InstanceFieldRuntimeApi.rebuild()`). P1b streamed ground-cover tiles are a SEPARATE CPU
 * draw-source instance consuming the same contract, never mutations of an `InstanceField`.
 *
 * GL-lane precedent: `WebGLClusterCullPass` re-implements WGSL cull math on the CPU with fixed
 * capacity and no atomics; the CPU lane of this contract follows the same pattern.
 *
 * Invariant registry (ADR 0047, registered 2026-11-08): `IF-CULL-NO-FALSE-NEGATIVE`,
 * `IF-CULL-FP-BOUND`, `IF-CULL-ROUTING`, `IF-CULL-DETERMINISM`, `IF-CAMERA-CUT-HZB-SKIP`,
 * `IF-BUDGET`, `IF-PROJECTED-SIZE`. No collision with existing `HZB-*` IDs. Test anchors:
 * P1-4 `packages/engine/tests/renderers/InstanceField*.test.ts` (single claim = single ID;
 * Bob's `IF-CULL-CONSERVATIVE` is merged into `IF-CULL-NO-FALSE-NEGATIVE`).
 *
 * All public parameters are classified per ADR 0047 — exactly one class per parameter.
 */

// ---------------------------------------------------------------------------
// 1. Instance record layout — 16 bytes, binding (ADR 0059 shape, @fixed)
// ---------------------------------------------------------------------------

/**
 * Per-instance record, exactly 16 bytes, little-endian, NO padding. Every byte is used.
 *
 * | offset | size | type | field                                    |
 * |-------:|-----:|------|------------------------------------------|
 * |   0..3 |    4 | f32  | position.x                               |
 * |   4..7 |    4 | f32  | position.y                               |
 * |  8..11 |    4 | f32  | position.z                               |
 * | 12..15 |    4 | u32  | packedPose (yawWord | uniformScaleWord<<16) |
 *
 * `packedPose` bit packing (little-endian u32):
 *   bits 0..15  `yawWord`      heading around world +Y, fixed-point over [0, 2π):
 *                              `round((yaw mod 2π) / 2π * 0xFFFF)`; decode `yawWord / 0xFFFF * 2π`.
 *                              Resolution 2π/65536 ≈ 0.0055°. Right-handed: rotation from +X
 *                              toward +Z.
 *   bits 16..31 `uniformScaleWord`  prototype-RELATIVE uniform scale multiplier, fixed-point
 *                              with precision 1/256: `round(clamp(scale, 0, 0xFFFF/256) * 256)`;
 *                              decode `scaleWord / 256`. Max 255.996, min representable 1/256.
 *                              `0` is a degenerate (zero-radius) record; backends MAY skip it
 *                              before upload. Tint/variation is derived from the position hash
 *                              in the shader, never stored (ADR 0059).
 *
 * The record carries NO prototype id: prototype identity is RANGE-IMPLICIT — the field's
 * instance storage is partitioned into contiguous per-prototype ranges and each range maps to
 * one prototype via the field-info table (see {@link FieldCullParams}). The per-instance cull
 * radius is `prototypeBounds[prototypeOf(instance)] * recordScale`, never stored.
 *
 * GL tier mapping (exactly one vertex-attrib divisor unit): bytes 0..11 bind as one `vec3`
 * float attribute; bytes 12..15 bind as one UNSIGNED-INTEGER attribute (`vertexAttribIPointer`)
 * on WebGL2. WebGL1 has no integer attributes and reads the pose from an unpacked f32 companion
 * fill produced by the engine's cell sorter (yaw/scale as two f32 attributes); the 16-byte
 * record in storage is byte-identical on every tier. `firstInstance` is always 0 on GL tiers.
 *
 * @fixed Instance record layout is a frozen binding (ADR 0059 step 1 considered options rejected
 *        64-B matrices; tint derived from position hash, not stored). The decode formula in the
 *        pull vertex shader, the cull unpack and {@link packInstancePose} share exactly this
 *        single spec (Bob D-1; drift guard for the P1-4 CPU reference).
 */
export const INSTANCE_RECORD_BYTES = 16 as const;

/** Fixed-point divisor of the scale word (1/256 per LSB, 16 bit). */
export const INSTANCE_SCALE_PRECISION = 256 as const;

/**
 * Largest prototype-relative uniform scale representable in 16 bit at 1/256 precision.
 * @derived From the 16-bit fixed-point scale encoding (0xFFFF / 256).
 */
export const MAX_INSTANCE_UNIFORM_SCALE = 0xffff / INSTANCE_SCALE_PRECISION;

/** Machine-readable description of the 16-byte layout (offsets in bytes, little-endian). */
export const INSTANCE_RECORD_LAYOUT = {
  byteLength: INSTANCE_RECORD_BYTES,
  position: { kind: "vec3f", byteOffset: 0, components: ["x", "y", "z"] },
  packedPose: { kind: "u32", byteOffset: 12 },
} as const;

/** Bit-field description of the packed pose word (bit offsets within the u32). */
export const INSTANCE_POSE_BITS = {
  yaw: { bitOffset: 0, bitWidth: 16, encode: "circle", reference: "world +Y heading" },
  uniformScale: {
    bitOffset: 16,
    bitWidth: 16,
    encode: "fixed1_256",
    reference: "prototype-relative",
  },
} as const;

/** Decoded pose scalars (the only mutable-member contract type in this file). */
export interface InstancePose {
  yawRadians: number;
  uniformScale: number;
}

/**
 * Packs a pose into the u32 record word (bits 0..15 yaw, bits 16..31 uniform scale).
 * Pure CPU reference for the WGSL/GLSL bit packing; tests and the cell sorter MUST use it.
 * @returns The u32 bit pattern as a JS number in [0, 0xFFFFFFFF] (`>>> 0` keeps the 32-bit
 *   pattern unsigned — the raw `<<`/`|` would yield a negative JS number when the scale
 *   word's high bit is set, i.e. uniformScale >= 128; the bits are identical either way).
 */
export function packInstancePose(yawRadians: number, uniformScale: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((yawRadians % twoPi) + twoPi) % twoPi;
  const yawWord = Math.round((wrapped / twoPi) * 0xffff) & 0xffff;
  const clamped = Math.min(Math.max(uniformScale, 0), MAX_INSTANCE_UNIFORM_SCALE);
  const scaleWord = Math.round(clamped * INSTANCE_SCALE_PRECISION) & 0xffff;
  return ((scaleWord << 16) | yawWord) >>> 0;
}

/**
 * Inverse of {@link packInstancePose}, writing into `out` (zero allocation).
 * @param packed The u32 bit pattern produced by {@link packInstancePose}.
 * @param out Receives the decoded scalars.
 */
export function unpackInstancePose(packed: number, out: InstancePose): void {
  out.yawRadians = ((packed & 0xffff) / 0xffff) * (Math.PI * 2);
  out.uniformScale = ((packed >>> 16) & 0xffff) / INSTANCE_SCALE_PRECISION;
}

// ---------------------------------------------------------------------------
// 2. Prototype descriptor and LOD buckets
// ---------------------------------------------------------------------------

/**
 * One LOD bucket of a prototype: a projected-size band mapped to one geometry slot.
 * Bands within one prototype are contiguous and ascend; bucket 0 is the finest.
 *
 * @invariant IF-PROJECTED-SIZE: bucket selection and `cullPixelSize` are evaluated in projected
 * sphere diameter in pixels (see {@link projectedDiameterPixels}) through the primary view's
 * projection — never in world distance — so the same world object selects the same bucket at the
 * same pixel footprint on every view and device.
 */
export interface LodBucketDescriptor {
  /**
   * @fixed Stable bucket identifier (authored references, diagnostics, P2 crossfade pairing).
   */
  name: string;
  /**
   * @domain LOD level in the prototype's mesh chain (0 = finest).
   */
  lodIndex: number;
  /**
   * @domain px — lower band bound, exclusive: entry threshold for this bucket.
   */
  minProjectedSize: number;
  /**
   * @domain px — upper band bound, inclusive: exit threshold for this bucket. The ascending
   *         sequence of `maxProjectedSize` over a prototype is `lodPixelThresholds` (ADR 0047
   *         expected name; realized as bands, no separate array to avoid a dead knob).
   */
  maxProjectedSize: number;
  /**
   * @derived Index into the backend-owned per-prototype geometry table, resolved once at setup.
   */
  geometrySlot: number;
}

/**
 * One population prototype = LOD chain + shared material slot + base bounding sphere.
 * A prototype is the smallest authored unit; instances reference a prototype by range (see
 * {@link FieldCullParams}).
 */
export interface PrototypeDescriptor {
  /**
   * @fixed Stable, never-reused identity of this prototype (authoring, savegames, bake keys).
   */
  id: string;
  /**
   * @domain meters — base bounding-sphere radius at uniform scale 1; the per-instance cull
   *         radius is `boundingRadius * uniformScale(record)` and the projected-size metric
   *         scales it the same way (radius source is named: prototype bounds, never the record).
   */
  boundingRadius: number;
  /**
   * @domain Authored LOD chain, ascending by projected size (bucket 0 = finest).
   */
  lodBuckets: readonly LodBucketDescriptor[];
  /**
   * @derived Index into the backend-owned material table, resolved once at setup. Shared by all
   *         LOD buckets so dithered crossfade (P2) never changes shader mid-band.
   */
  materialSlot: number;
  /**
   * @domain Count — per-prototype population cap; the field's instance budget is split across
   *         prototypes and never exceeds this cap per prototype.
   */
  maxInstances: number;
}

// ---------------------------------------------------------------------------
// 3. Field options and runtime API
// ---------------------------------------------------------------------------

/**
 * Authoring time budget of the CPU fallback lane (ADR 0035 tier resolver scales these values per
 * performance tier; authored meaning stays identical — a tier scales its budgets, never the
 * parameter's meaning, ADR 0047).
 */
export interface CpuLaneBudget {
  /**
   * @domain meters — radius around the camera within which the CPU lane tests cells; cells
   *         entirely outside are not drawn. Honest fallback: exceeding the budget drops farthest
   *         cells, never a broken frame (ADR 0043).
   */
  maxCullRadius: number;
  /**
   * @domain Count — cap on cells tested per frame on the CPU lane.
   */
  maxCellsPerFrame: number;
  /**
   * @domain Count — cap on direct draws (`drawElementsInstanced` calls) per frame on the CPU lane.
   */
  maxDrawsPerFrame: number;
  /**
   * @domain Count — cap on instances drawn per frame on the CPU lane.
   */
  maxInstancesPerFrame: number;
}

/**
 * V1 population mutability — single value in V1, declared structurally so the rebuild-only
 * contract is visible to reviewers and to the P1b streaming lane (separate draw sources).
 */
export type InstanceFieldPopulationMode = "static";

/**
 * The ONLY population mutation path in V1 (Bob D-9); implemented by the `InstanceField` node.
 */
export interface InstanceFieldMutationApi {
  /**
   * Re-sorts instance records by cell and re-uploads all derived buffers (VBO, GPU storage,
   * ownership maps). The only mutation entry point in V1; invoking it on a static population is
   * a full rebuild, never an incremental patch (V1: static upload once, resize = rebuild).
   */
  rebuild(): void;
}

/**
 * Runtime surface of the `InstanceField` node (the node class ships with the renderer managers;
 * this file freezes its names). Bindings: node `InstanceField` and `InstanceFieldGL` implement
 * this interface; `InstanceFieldGL.notifyCameraTeleport()` is a documented no-op (CPU-cell cull
 * never consumes the HZB).
 *
 * @invariant IF-CAMERA-CUT-HZB-SKIP: camera cut / teleport produces EXACTLY one frame of HZB
 * skip — the next cull dispatch after the call has `hzbSkip == 1`, the one after has
 * `hzbSkip == 0`; N consecutive calls still skip exactly one frame (idempotent, no leak); the
 * cut frame's visible set is a superset of the frustum+size reference set (no wrong cull); the
 * GL lane no-ops and its cell cull is unaffected. The flag is FIELD-scoped, never global.
 */
export interface InstanceFieldRuntimeApi extends InstanceFieldMutationApi {
  /**
   * One-frame HZB skip after a camera cut; idempotent, field-scoped (see the IF-CAMERA-CUT-HZB-SKIP
   * relation above). Mirrors the global `notifyCameraTeleport` fan-out pattern (TELEPORT-RESET-SYNC)
   * per field; the renderer wires the fan-out in P1-2, the transition test targets this method.
   */
  notifyCameraTeleport(): void;
  /**
   * @derived Inspectable per-frame cull params mirror (the dispatch-level `hzbSkip` flag is read
   *         from here by the P1-4 transition test; written by the cull coordinator each frame).
   */
  readonly cullParams: readonly CullParams[];
  /**
   * Installs a read-only verification probe for the dual-lane test harness (pure-TS vitest + real
   * GPU); the probe replaces the opt-in GPU readback in the pure-TS lane and observes the same
   * {@link FieldVisibleSets} on the real lane.
   */
  installCullProbe(probe: IndirectCullProbe): void;
}

/**
 * Authoring options of an `InstanceField` node (the node class itself lands with the renderer
 * managers; this file freezes its options shape).
 */
export interface InstanceFieldOptions {
  /**
   * @domain Authored population definition: the prototype roster this field may instantiate.
   */
  prototypes: readonly PrototypeDescriptor[];
  /**
   * @domain meters — population grid cell edge (uniform cube). Cells are the unit for CPU
   *         cell culling, streaming and far-field aggregation; GPU culling goes per instance.
   */
  cellSize: number;
  /**
   * @domain Count — total instance budget of the field (records = `maxInstances * 16` bytes).
   */
  maxInstances: number;
  /**
   * @domain px — minimum projected sphere diameter; instances below are dropped in every view
   *         (sub-pixel cull, ADR 0059 step 1). Must be < the finest bucket's `minProjectedSize`.
   */
  cullPixelSize: number;
  /**
   * @domain LOD bucket offset applied ONLY in shadow/cascade views (0 = reuse the main camera's
   *         bucket choice). LOD selection is always driven by the main camera (ADR 0059 step 2).
   */
  shadowLodBias: number;
  /**
   * @domain Count — cap on concurrent per-frame culling views for this field (tier-scalable
   *         budget, ≤ {@link MAX_INDIRECT_VIEWS}); overflow views are not field-culled.
   */
  maxViews: number;
  /**
   * @domain CPU-lane budgets (see {@link CpuLaneBudget}); authored values are the HIGH-tier
   *         baseline, scaled by the ADR 0035 resolver on weaker tiers.
   */
  cpuBudget: CpuLaneBudget;
  /**
   * @fixed Frozen to "static" in V1: streams (P1b) use separate draw sources, never mutation.
   */
  populationMode: InstanceFieldPopulationMode;
}

// ---------------------------------------------------------------------------
// 4. Cell grid, cell ownership, and the cell-sorted instance buffer
// ---------------------------------------------------------------------------

/** Minimal axis-aligned bounding box (data-only; the runtime lanes map to `BoundingBox`). */
export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Frustum plane in the form `n · p + d`. Convention is BINDING: planes face INWARD, a point is
 * inside iff `n · p + d >= 0` (identical to `Frustum.setFromMatrix`, Gribb–Hartmann).
 */
export type Plane4 = readonly [number, number, number, number];

/**
 * @fixed Freeze of the frustum cull convention shared by the WGSL, the GL lane and the P1-4 CPU
 *        reference: inside iff `n · p + d >= 0` with inward-facing normals. The reference module
 *        and the WGSL MUST mirror this orientation, not the other way around.
 */
export const FRUSTUM_CULL_CONVENTION = "inside iff n·p + d >= 0 (inward normals)" as const;

/**
 * World-aligned population grid. Cell linearization is row-major, X fastest:
 * `cellId = x + y * W + z * W * H` (W = `cellCounts[0]`, H = `cellCounts[1]`). Backends MUST use
 * this exact mapping and {@link cellLinearId} / {@link fillCellWorldBounds}.
 */
export interface CellGrid {
  /**
   * @domain meters — world-space minimum corner of the grid (cell (0,0,0) spans
   *         `[origin, origin + cellSize)` on each axis).
   */
  origin: readonly [number, number, number];
  /**
   * @domain meters — uniform cube edge of one cell.
   */
  cellSize: number;
  /**
   * @domain Count — number of cells per axis (must be >= 1 on every axis).
   */
  cellCounts: readonly [number, number, number];
  /**
   * @derived World-space AABB of the whole grid, derived from origin / cellSize / cellCounts.
   */
  bounds: Aabb;
}

/** Cell linear id of a cell coordinate (row-major, X fastest) — see {@link CellGrid}. */
export function cellLinearId(
  cell: readonly [number, number, number],
  cellCounts: readonly [number, number, number],
): number {
  return cell[0] + cell[1] * cellCounts[0] + cell[2] * cellCounts[0] * cellCounts[1];
}

/**
 * Fills `out` with the world-space AABB of the `cellId`-th cell (zero allocation).
 * @invariant IF-CULL-NO-FALSE-NEGATIVE: any instance record whose center lies inside the cell is
 * contained in the cell AABB, so a conservative cell test is conservative for every instance in
 * the cell (no false negatives at any plane orientation).
 */
export function fillCellWorldBounds(cellId: number, grid: CellGrid, out: Aabb): void {
  const w = grid.cellCounts[0];
  const h = grid.cellCounts[1];
  const x = cellId % w;
  const y = ((cellId / w) | 0) % h;
  const z = (cellId / (w * h)) | 0;
  const minX = grid.origin[0] + x * grid.cellSize;
  const minY = grid.origin[1] + y * grid.cellSize;
  const minZ = grid.origin[2] + z * grid.cellSize;
  out.min[0] = minX;
  out.min[1] = minY;
  out.min[2] = minZ;
  out.max[0] = minX + grid.cellSize;
  out.max[1] = minY + grid.cellSize;
  out.max[2] = minZ + grid.cellSize;
}

/**
 * CPU-side cell ownership, built by the engine's cell sort and consumed by the GL CPU-cell
 * fallback lane. Contract invariant (no registry ID): the instance record buffer is engine-owned
 * and sorted ASCENDING by `cellId`; records of one cell are contiguous; the GL lane binds this
 * buffer with `vertexAttribPointer` offsets per visible cell range and never re-sorts. The GPU
 * lane is order-independent (per-instance culling) and ignores ordering.
 */
export interface CellOwnershipRecord {
  /**
   * @fixed Frozen storage semantics — linear cell id of the owned cell (row-major mapping).
   */
  cellId: number;
  /**
   * @derived First record index of this cell in the cell-ordered instance buffer.
   */
  instanceOffset: number;
  /**
   * @derived Number of records in this cell. A cell with `instanceCount === 0` is NOT populated
   *         (no separate flag needed; a "populated" boolean would be a dead knob).
   */
  instanceCount: number;
}

/**
 * Read-only population map over the cell-ordered instance buffer.
 */
export interface CellPopulation {
  /**
   * @derived Non-empty cells only, sorted ascending by `cellId` (binary-searchable).
   */
  records: readonly CellOwnershipRecord[];
  /**
   * @derived Sum of all `instanceCount` values; equals the field's live instance count.
   */
  totalInstances: number;
  /**
   * @derived True iff any record matches `cellId`; false for empty and unknown cells.
   */
  isPopulated(cellId: number): boolean;
  /**
   * @derived Ownership record of `cellId`, or undefined when the cell holds no instances.
   */
  instanceRange(cellId: number): CellOwnershipRecord | undefined;
}

// ---------------------------------------------------------------------------
// 5. Shared cull math — single source of truth (CPU-callable, tested in P1-4)
// ---------------------------------------------------------------------------

/**
 * Projected diameter of a sphere in pixels through a pinhole projection:
 * `d_px = (2 * worldRadius * viewportHeightPx) / (2 * tan(fovRadiansY / 2) * viewDistance)`.
 * The LOD selection metric of ADR 0059 step 2; bucket bands and `cullPixelSize` are expressed in
 * exactly this metric.
 * @invariant IF-PROJECTED-SIZE: bucket selection and the sub-pixel cull use this exact pinhole
 * formula through the primary view's projection — never world distance or any approximation — so
 * selection is resolution- and FOV-normalized and reproducible across views and devices.
 */
export function projectedDiameterPixels(
  worldRadius: number,
  viewDistance: number,
  viewportHeightPx: number,
  fovRadiansY: number,
): number {
  const halfTan = Math.tan(fovRadiansY / 2);
  if (viewDistance <= 0 || halfTan <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (worldRadius * viewportHeightPx) / (halfTan * viewDistance);
}

/**
 * Conservative frustum test for a cell AABB: returns true unless a frustum plane provably
 * separates the WHOLE box (positive-vertex test, inward convention). May return true for outside
 * boxes (overdraw), but never false for an intersecting box.
 * @invariant IF-CULL-NO-FALSE-NEGATIVE: the test has no false negatives — every sphere fully
 * contained in an axis-aligned box that intersects the frustum returns true, and per-view
 * culling never drops an instance that is visible in that view.
 */
export function aabbVisibleConservative(planes: readonly Plane4[], aabb: Aabb): boolean {
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i] as Plane4;
    const nx = plane[0];
    const ny = plane[1];
    const nz = plane[2];
    const px = nx > 0 ? aabb.max[0] : aabb.min[0];
    const py = ny > 0 ? aabb.max[1] : aabb.min[1];
    const pz = nz > 0 ? aabb.max[2] : aabb.min[2];
    if (nx * px + ny * py + nz * pz + plane[3] < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Conservative frustum test for a bounding sphere: returns true unless a frustum plane provably
 * separates the whole sphere. CPU oracle for the per-instance cull test the WebGPU lane runs in
 * `instance_cull.wgsl`; the GPU lane MUST NOT be less conservative than this function.
 * @invariant IF-CULL-NO-FALSE-NEGATIVE: no false negatives — a sphere that intersects the
 * frustum is never culled, in any view.
 * @invariant IF-CULL-FP-BOUND: over a fixed reference corpus, the conservative tests' false
 * positives (over-draw) never exceed the documented FP_BOUND rate / FP_ABSOLUTE count recorded in
 * the P1-4 research note; the no-false-negative guarantee is never traded against this bound. The
 * numeric thresholds live with the P1-4 test file, not in the engine (no dead knobs).
 */
export function sphereVisibleConservative(
  planes: readonly Plane4[],
  center: readonly [number, number, number],
  radius: number,
): boolean {
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i] as Plane4;
    const dist = plane[0] * center[0] + plane[1] * center[1] + plane[2] * center[2] + plane[3];
    if (dist < -radius) {
      return false;
    }
  }
  return true;
}

/**
 * Conservative occlusion decision against a previous-frame occlusion hierarchy (HZB): true means
 * "skip, provably occluded". The sphere is skipped only when a nearest-depth sample along its
 * view ray is STRICTLY nearer than the sphere's nearest point. `viewDistanceToSphereCenter` and
 * `nearestOccluderViewDepth` MUST be in the same view-space depth convention (monotone along the
 * view ray). The WebGPU lane samples the previous-frame pyramid (max-downsample, mirroring
 * `hzb_downsample_max.wgsl`) at a mip whose texels cover the projected rect.
 * @invariant IF-CAMERA-CUT-HZB-SKIP: the skip is conservative — an instance whose sphere
 * intersects the view frustum in front of all sampled occluders is never skipped; the HZB path
 * never uses data newer than the previous frame's pyramid; after a camera cut the lane skips the
 * HZB path for exactly one frame (see {@link InstanceFieldRuntimeApi}) and returns false here.
 */
export function sphereOcclusionSkipConservative(
  viewDistanceToSphereCenter: number,
  sphereRadius: number,
  nearestOccluderViewDepth: number,
): boolean {
  if (viewDistanceToSphereCenter <= sphereRadius) {
    return false;
  }
  return nearestOccluderViewDepth < viewDistanceToSphereCenter - sphereRadius;
}

// ---------------------------------------------------------------------------
// 6. Cull params and the composed field info (GPU-visible data roles)
// ---------------------------------------------------------------------------

/**
 * Per-frame, per-view cull parameter block (written by the cull coordinator every frame,
 * dynamic-offset per view; 256-B aligned uniform, matching the engine `_viewUniformBuffer`
 * pattern). `hzbSkip` is the inspectable dispatch-level flag the P1-4 transition test asserts.
 */
export interface CullParams {
  /**
   * @derived Index of this view within the frame's capped view set (< {@link MAX_INDIRECT_VIEWS}).
   */
  viewIndex: number;
  /**
   * @derived Exactly 6 frustum planes, inward convention ({@link FRUSTUM_CULL_CONVENTION}), in the
   *         same order as `Frustum.planes` (right, left, bottom, top, near, far).
   */
  frustumPlanes: readonly Plane4[];
  /**
   * @derived Primary-view projection inputs of the projected-size metric, in pixels / radians.
   */
  viewportHeightPx: number;
  /**
   * @derived Primary-view vertical field of view in radians (projected-size metric input).
   */
  fovRadiansY: number;
  /**
   * @derived True when a previous-frame pyramid exists and may be consumed for this view.
   */
  hzbEnabled: boolean;
  /**
   * @derived One-frame HZB skip flag, set by {@link InstanceFieldRuntimeApi.notifyCameraTeleport}
   *         for exactly one frame; read by tests at dispatch level and by the cull coordinator.
   */
  hzbSkip: boolean;
  /**
   * @derived View base of the (view × bucket) segment table: `view * MAX_LOD_BUCKETS`. The bucket
   *         selector is a compile-time page base, never a dynamic offset.
   */
  segmentBase: number;
}

/**
 * Composed, GPU-consumed field data (bound once per field, derived at setup from the authored
 * options; the authored fields in {@link InstanceFieldOptions} remain the single source of
 * truth — nothing drifts, Bob D-1/D-2).
 */
export interface FieldCullParams {
  /**
   * @derived px — mirror of `InstanceFieldOptions.cullPixelSize`, composed at setup.
   */
  cullPixelSizePx: number;
  /**
   * @derived meters — mirror of `InstanceFieldOptions.cellSize`, composed at setup.
   */
  cellSize: number;
  /**
   * @derived Per-prototype base radii, indexed by prototype range order (source: authored
   *         `PrototypeDescriptor.boundingRadius`). The cull resolves an instance's prototype by
   *         range and computes `radius = prototypeBounds[p] * uniformScale(record)`.
   */
  prototypeBounds: readonly number[];
  /**
   * @derived px — ascending per-prototype bucket maxima (`lodPixelThresholds` values), packed per
   *         prototype range: `lodBucketMaxima[p][b]`.
   */
  lodBucketMaxima: readonly (readonly number[])[];
  /**
   * @derived Count — per-(view × bucket) page capacity in instances; see the capacity policy
   *         {@link IndirectDrawSource} (clamp-at-capacity, drop, never OOB).
   */
  pageCapacity: number;
}

// ---------------------------------------------------------------------------
// 7. IndirectDrawSource — shared internal contract (consumers: [1] WebGPU cull compute,
// [2] GL CPU-cell fallback, [3] GPU particles)
// ---------------------------------------------------------------------------

/** Which producer lane owns a segment. Segment tables are pre-partitioned per producer. */
export enum IndirectDrawProducer {
  /** WebGPU `InstanceField` cull-compute lane and its GL CPU-cell counterpart. */
  INSTANCE_FIELD = 0,
  /** GPU particle system (`GpuParticleSystemHost`), 3rd consumer of the contract. */
  GPU_PARTICLES = 1,
  /** Future P3 impostor / cluster buckets; reserved, not produced in V1. */
  IMPOSTOR = 2,
}

/** Per-frame lifecycle of one segment header word. */
export enum IndirectSegmentPhase {
  /** Header reset, awaiting this frame's producer writes. */
  READY = 0,
  /** Producer is compacting survivors into the segment. */
  CULLING = 1,
  /** Segment is stable and drawable this frame. */
  DRAWABLE = 2,
}

/**
 * Upper bound of LOD buckets per field — the bucket dimension of the fixed (view × bucket)
 * segment table. Exists NOW because the args buffer and page math depend on it (Bob D-2); P1
 * draws bucket 0 only; P2 widens usage without a layout change.
 * @fixed Freeze of the segment-table bucket dimension (pre-allocation bound, ADR 0035 budgets).
 */
export const MAX_LOD_BUCKETS = 8 as const;

/**
 * Upper bound of per-frame culling views (main camera + active CSM cascades + spot/point shadow
 * faces); pre-allocates the fixed segment table.
 * @fixed Freeze of the segment-table view dimension (pre-allocation bound, ADR 0035 budgets).
 */
export const MAX_INDIRECT_VIEWS = 16 as const;

/**
 * The five `drawIndexedIndirect` argument words in byte-exact spec order, 5 × u32 = 20 bytes, NO
 * padding (offsets 0..19 of the segment header). Byte-identical with the GPU particle args block
 * (`gpu_particles.wgsl:62-74`); `drawBaseInstance` stays 0 → no `indirect-first-instance`
 * dependency (ADR 0059 step 1). WGSL identity: `{drawIndexCount, drawInstanceCount,
 * drawFirstIndex, drawBaseVertex, drawBaseInstance}` maps 1:1 to `[indexCount, instanceCount,
 * firstIndex, baseVertex, firstInstance]`.
 */
export interface IndirectArgsBlock {
  /**
   * @fixed Frozen storage-semantics word — index count of the bound geometry.
   */
  indexCount: number;
  /**
   * @fixed Frozen storage-semantics word — instance count; the compaction `atomicAdd` target on
   *         the GPU lane, accumulated per frame inside the draw path.
   */
  instanceCount: number;
  /**
   * @fixed Frozen storage-semantics word — first index of the bound geometry.
   */
  firstIndex: number;
  /**
   * @fixed Frozen storage-semantics word — base vertex of the bound geometry.
   */
  baseVertex: number;
  /**
   * @fixed Frozen storage-semantics word — base instance; 0 on all tiers in V1.
   */
  firstInstance: number;
}

/**
 * One per-(view x bucket) indirect segment header. BYTE LAYOUT (binding): offsets 0..19 = the
 * `IndirectArgsBlock` byte-exact (bytes 12..15 = drawBaseInstance = 0); the 12-byte extension
 * [liveCount, state, reserved] is REQUIRED for the INSTANCE_FIELD producer and OPTIONAL for
 * producers whose buffers predate the readback contract (GPU particles keep their 20-byte block —
 * no `gpu_particles.wgsl` semantic change, Bob D-7).
 *
 * | word | offset | name         | written by                                 |
 * |-----:|-------:|--------------|--------------------------------------------|
 * |   0  |   0    | indexCount   | backend at setup (geometry args)           |
 * |   1  |   4    | instanceCount| producer per frame (atomicAdd compaction)  |
 * |   2  |   8    | firstIndex   | backend at setup (geometry args)           |
 * |   3  |  12    | baseVertex   | backend at setup (geometry args)           |
 * |   4  |  16    | firstInstance| backend at setup (always 0 in V1)          |
 * |   5  |  20    | liveCount    | backend after frame (opt-in debug readback)|
 * |   6  |  24    | state        | producer (READY -> CULLING -> DRAWABLE)    |
 * |   7  |  28    | reserved     | must stay 0                                |
 *
 * Contract invariant (no registry ID): segments are partition-disjoint per (producer, view,
 * bucket) — each segment header and visible-index page is owned by exactly one producer, so
 * concurrent producers never contend on the same address and no producer may write outside its
 * page (capacity policy, see {@link IndirectDrawSource}).
 */
export interface IndirectSegmentHeader extends IndirectArgsBlock {
  /**
   * @fixed Frozen mirror semantics — opt-in debug/readback mirror of `instanceCount`, written
   *         only by the owning backend after the frame; never consumed inside the draw path.
   */
  liveCount: number;
  /**
   * @fixed Frozen state-word semantics — per-frame lifecycle value written only by the owning
   *         producer, `IndirectSegmentPhase`.
   */
  state: IndirectSegmentPhase;
  /**
   * @fixed Must stay 0 in V1 (header alignment padding word).
   */
  reserved: number;
}

/** Logical storage role inside the indirect-draw buffer set. */
export enum IndirectBufferKind {
  INDIRECT_ARGS = 0,
  VISIBLE_INDICES = 1,
  INSTANCE_RECORDS = 2,
}

/**
 * Backend-neutral description of one logical buffer of the indirect-draw set; the backend maps
 * it to a `GPUBuffer` / WebGL VBO / typed array of the same byte semantics.
 */
export interface IndirectBufferRole {
  /**
   * @fixed Logical role; disambiguates the buffers of the set.
   */
  role: IndirectBufferKind;
  /**
   * @derived Capacity in bytes, derived from the authored budgets and the frozen strides.
   */
  byteLength: number;
  /**
   * @fixed Frozen element stride in bytes (4 for args/visible-index words, 16 for records).
   */
  byteStride: number;
}

/** Per-(view x bucket) segment of the fixed segment table. */
export interface IndirectSegment {
  /**
   * @fixed Owning producer; segments are pre-partitioned per producer (no contention).
   */
  producer: IndirectDrawProducer;
  /**
   * @fixed View index within the frame's bounded view set (see {@link MAX_INDIRECT_VIEWS}).
   */
  viewIndex: number;
  /**
   * @fixed Bucket index within the reserved bucket range of this producer (< {@link MAX_LOD_BUCKETS}).
   */
  bucketIndex: number;
  /**
   * @derived Byte offset of this segment's header in the args buffer (field producer: 32-B stride
   *         {@link INDIRECT_SEGMENT_HEADER_BYTES}; particle producer: 20-B block).
   */
  headerOffset: number;
  /**
   * @derived Byte offset of this segment's visible-index page in the visible-index buffer. Page
   *         base of segment `bv = view * MAX_LOD_BUCKETS + bucket` is fixed at build; the pull
   *         vertex shader reads `visibleIndices[pageBase(bv) + instance_index]`.
   */
  visibleIndexOffset: number;
  /**
   * @derived Maximum instance indices this segment may hold ({@link FieldCullParams.pageCapacity});
   *         never exceeded by any producer (clamp-at-capacity policy).
   */
  capacity: number;
}

/** Named header words addressable by the reset contract. */
export type IndirectSegmentHeaderWord = "instanceCount" | "liveCount" | "state" | "reserved";

/** Frozen per-frame reset contract of the segment table. */
export interface IndirectResetContract {
  /**
   * @fixed Header words zeroed per frame by the owning backend, in one write (template
   *         `writeBuffer` or one tiny compute dispatch), before any producer writes. The field
   *         producer resets [instanceCount, liveCount, state, reserved]; the particle producer
   *         resets instanceCount only.
   */
  perFrameZeroWords: readonly IndirectSegmentHeaderWord[];
  /**
   * @fixed Geometry words re-written per frame from the bound mesh (indexCount, firstIndex,
   *         baseVertex) — identical to the setup-time values for an unchanged field.
   */
  templateArgs: readonly IndirectArgsBlock[];
}

/**
 * GPU storage surface of the shared indirect-draw contract.
 *
 * CAPACITY & BREACH POLICY (binding, Bob D-2 "exact vs clamp" — resolved): the compaction is
 * CLAMP-AT-CAPACITY. The producer claims a slot with `slot = atomicAdd(&args.instanceCount, 1)`;
 * the slot is written into the visible page ONLY when `slot < capacity`, so the counter pins at
 * capacity and over-budget survivors are DROPPED (a budget miss observable via readback; the
 * ADR 0035 governor may scale capacity). The counter never exceeds capacity, a segment never
 * overruns into its neighbour, and the draw arg equals the read-back count exactly.
 *
 * Contract invariants (no registry ID): the render path performs NO CPU readback (statistics only
 * via opt-in async debug readback, ADR 0059); survivors are `atomicAdd`-compacted into the
 * visible-index pages with the pull vertex shader reading
 * `instances[visible[pageBase(bv) + i]]`, so `indirect-first-instance` is never required; the
 * visible-index and args buffers are fully reset to this contract each frame before any producer
 * dispatch; there is no frame N→N+1 dependency on counters (always reset + rebuilt inside the
 * frame) — the previous frame is consumed ONLY for the HZB texture, never for counters.
 *
 * @invariant IF-BUDGET: per-(view x bucket) segment counts never exceed capacity; the total of
 * written unique indices equals the segment counts; the indirect args reflect the compacted
 * counts exactly (args == counts per segment); capacity exhaustion fails closed (flag set, no
 * out-of-bounds write, no corrupted draw) instead of overrunning.
 *
 * @invariant IF-CULL-ROUTING: every survivor is routed to exactly the segment of its
 * `(view * MAX_LOD_BUCKETS + bucket)` — bucket = LOD bucket selected by the main camera (shadow
 * views reuse it, optionally coarser via `shadowLodBias`) — and every written index is in range
 * `[0, field instance count)`; page-internal ORDER of indices within a segment is NOT part of the
 * contract (atomicAdd race).
 */
export interface IndirectDrawSource {
  /**
   * @fixed Producer lane claiming this source instance.
   */
  producer: IndirectDrawProducer;
  /**
   * @derived Frame view count, bounded by {@link MAX_INDIRECT_VIEWS}.
   */
  views: number;
  /**
   * @derived Bucket range of this producer within {@link MAX_LOD_BUCKETS}.
   */
  buckets: number;
  /**
   * @derived Fixed segment table; size `views * buckets`, partition-disjoint per producer.
   */
  segments: readonly IndirectSegment[];
  /**
   * @fixed Freeze of the 32-byte header layout for the field producer (see
   *         {@link INDIRECT_SEGMENT_HEADER_BYTES}); particle producer may use 20.
   */
  segmentHeaderBytes: number;
  /**
   * @derived Backend-neutral description of the args buffer.
   */
  indirectArgsBuffer: IndirectBufferRole;
  /**
   * @derived Backend-neutral description of the visible-index buffer.
   */
  visibleIndexBuffer: IndirectBufferRole;
  /**
   * @derived Backend-neutral description of the instance-record buffer (16-byte records,
   *         per-prototype ranges, cell-ordered).
   */
  instanceBuffer: IndirectBufferRole;
  /**
   * @fixed Per-frame reset contract; implementers MUST apply it before producer culling.
   */
  reset: IndirectResetContract;
}

/** Per-(view x bucket) segment counters exposed by the opt-in readback. */
export interface IndirectSegmentCounts {
  /**
   * @derived View index of the segment.
   */
  viewIndex: number;
  /**
   * @derived Bucket index of the segment.
   */
  bucketIndex: number;
  /**
   * @derived Number of survivors written into the segment this frame (== args.instanceCount).
   */
  count: number;
}

/**
 * OPT-IN async readback of a cull frame, injectable headlessly (dual-lane: pure-TS vitest + real
 * GPU). The pure-TS lane fills this from the CPU reference and the `CullProbe`; the GPU lane
 * fills it from mapped staging buffers; the render path never depends on it.
 */
export interface FieldVisibleSets {
  /**
   * @fixed Frame index the readback belongs to (anti-stale check for consumers).
   */
  frameIndex: number;
  /**
   * @derived Per-view CullParams snapshot (incl. the `hzbSkip` flag) for frame-level asserts.
   */
  params: readonly CullParams[];
  /**
   * @derived Per-segment survivor counts, one entry per (view x bucket) of this producer.
   */
  segmentCounts: readonly IndirectSegmentCounts[];
  /**
   * @derived Compacted visible indices, pages at each segment's `visibleIndexOffset / 4`.
   */
  visibleIndices: Uint32Array;
}

/** Read-only verification probe for the dual-lane harness.
 * @invariant IF-CULL-DETERMINISM: identical (seed, pose, frame, previous-frame pyramid) inputs
 * produce a byte-identical survivor SET per (view x bucket) on any run, including across the CPU
 * reference and the GPU lane; page-internal ORDER within a segment is explicitly not part of the
 * determinism contract (atomicAdd compaction order is racy by design) — tests compare sets, not
 * sequences. Asserts ride on {@link FieldVisibleSets}. */
export interface IndirectCullProbe {
  /**
   * Called once per culled frame with the {@link FieldVisibleSets} snapshot.
   */
  onCullFrame(sets: FieldVisibleSets): void;
}

/**
 * ONE direct draw command emitted by the CPU lane (GL2/GL1), platform-neutral and read-only.
 * The GL lane converts each command into a `drawElementsInstanced` call over the cell-ordered
 * instance VBO; `instanceAttrByteOffset` is the `vertexAttribPointer` byte offset of the first
 * instance record of the command in that VBO. WebGL2 uses `drawElementsInstanced` +
 * `vertexAttribDivisor`; WebGL1 the same via `ANGLE_instanced_arrays` (defensive, fail-closed).
 * The per-cell LOD of the GL lane is a tier variant (ADR 0057 row `instance_field_gpu_cull`).
 */
export interface CpuDrawCommand {
  /**
   * @fixed Producer lane that produced this command.
   */
  producer: IndirectDrawProducer;
  /**
   * @fixed View index within the bounded frame view set.
   */
  viewIndex: number;
  /**
   * @fixed Bucket index; per-cell LOD maps to one bucket (tier variant).
   */
  bucketIndex: number;
  /**
   * @derived Geometry table slot resolved at setup (the mesh this command draws).
   */
  geometrySlot: number;
  /**
   * @derived Material table slot resolved at setup.
   */
  materialSlot: number;
  /**
   * @derived Geometry word — index count of the bound mesh.
   */
  indexCount: number;
  /**
   * @derived Geometry word — first index of the bound mesh.
   */
  firstIndex: number;
  /**
   * @derived Geometry word — base vertex of the bound mesh.
   */
  baseVertex: number;
  /**
   * @derived First instance record index in the cell-ordered instance buffer.
   */
  instanceBase: number;
  /**
   * @derived Number of instances this command draws (contiguous range).
   */
  instanceCount: number;
  /**
   * @derived `vertexAttribPointer` byte offset of `instanceBase` in the instance VBO.
   */
  instanceAttrByteOffset: number;
}

/**
 * CPU consumption surface of the contract (Frank, P1-3): a read-only command list the shared
 * pass hook consumes on GL tiers, where no GPU indirect draw exists. Reference precedent for the
 * CPU cull math: `WebGLClusterCullPass` (fixed capacity, no atomics).
 */
export interface CpuIndirectDrawSource {
  /**
   * @fixed Producer lane that built this command list.
   */
  producer: IndirectDrawProducer;
  /**
   * @derived Commands sorted by (view, bucket), read-only for the draw loop.
   */
  commands: readonly CpuDrawCommand[];
  /**
   * @derived Anti-stale guard: a draw loop MUST re-read `commands` whenever `revision` changes.
   */
  revision: number;
}

/**
 * Platform-neutral binding surface of the shared pass hook: a GPU storage source or a CPU command
 * source. The pass hook binds this union and never branches on backend specifics beyond the
 * discriminator.
 */
export type IndirectDrawSurface =
  | { readonly backend: "gpu"; readonly source: IndirectDrawSource }
  | { readonly backend: "cpu"; readonly source: CpuIndirectDrawSource };

/**
 * @fixed Freeze of the 32-byte indirect segment header stride (8 x u32) for the field producer.
 */
export const INDIRECT_SEGMENT_HEADER_BYTES = 32 as const;

// ---------------------------------------------------------------------------
// 8. Previous-frame HZB access and bind-group reservation
// ---------------------------------------------------------------------------

/**
 * Read handle to the PREVIOUS-FRAME occlusion pyramid the cull lane consumes (Bob D-3).
 * Ownership boundary (binding): `HzbOcclusionSystem` OWNS the pyramid as a ping-pong pair (write
 * slot alternates per frame; the field cull binds the other slot — the pyramid is the only
 * persisted depth history, full-res depth is not retained). The cull lane READS ONLY and obtains
 * the handle through a single accessor `getPreviousFrameHzb()` on the occlusion-system host
 * (Bob adapts `HzbOcclusionSystem` in P1-2). The pyramid is decoupled from
 * `enableOcclusionCulling`: it exists whenever the HZB pass runs; the cull lane decides per view
 * whether to consume it (`CullParams.hzbEnabled`).
 */
export interface HzbPyramidAccess {
  /**
   * @derived True when a previous-frame pyramid is valid for consumption; false after camera cut
   *         and always false on GL tiers (the CPU-cell lane never consumes it).
   */
  available: boolean;
  /**
   * @derived Frame index at which the pyramid was produced (strictly the previous frame).
   */
  frameIndex: number;
  /**
   * @derived Backend read handle the cull binds (texture view / sampler / marshalled data). Opaque
   *         to this contract; the P1-4 marshalling layout is Bob's, bound by the relation below.
   */
  readHandle: unknown;
}

/**
 * WebGPU bind-group reservation for the GPU field lane (Bob D-4, RESOLVED; folded to 2 in S2,
 * lead-authorized 2026-11-09, board finding F7).
 *
 * DECISION (S2 fold): the field-data storage group is `@group(2)`. The field's pipelines use the
 * group indices {0 (shared `GlobalUniforms`), 2 (field data), 3 (shared `ViewUniforms`)} — the
 * highest slot is 3, so a device needs `maxBindGroups >= 4`, which is exactly the WebGPU spec
 * minimum. Devices whose adapter caps `maxBindGroups` at the 4 default (verified on real
 * `apple/metal-3`) therefore host the lane NATIVELY with no limit raise and no group-1 fold.
 * Shares no layout with object pipelines (bind groups are per-pipeline — no collision). The
 * `@group(1)` slot is deliberately absent (the field declares no material bindings).
 * @fixed Freeze of the primary field-data bind group.
 */
export const INSTANCE_FIELD_BIND_GROUP = 2 as const;
