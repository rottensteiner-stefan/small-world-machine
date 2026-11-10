/**
 * InstanceFieldLodInvariant.test.ts — P2-4 main-camera LOD invariant (`veg-p2` / ADR 0059 step 2).
 *
 * Invariant under test (IF-PROJECTED-SIZE, main-camera anchoring): the per-instance LOD BUCKET
 * SELECTION derives from the MAIN camera's projected-size evaluation on EVERY view — shadow /
 * deep / opaque — never from a shadow view's own projection. The frozen band semantics are:
 * `d_px = worldRadius * viewportHeightPx / (tan(fovY/2) * viewDistance)` through the PRIMARY
 * view's metric inputs, `CullParams.viewportHeightPx` / `fovRadiansY` (written from the main view
 * by the coordinator, forwarded unchanged to every view), and a `viewDistance` measured against
 * the MAIN camera position (`global.viewPos` on the WebGPU lane). A shadow view may only reuse
 * the main-determined bucket, optionally coarser by the frozen `shadowLodBias` rule
 * (`max(main - bias, 0)` — bucket 0 is the COARSEST band, InstanceField.ts), never re-pick by
 * its own projection and never shift toward finer buckets.
 *
 * Headless coverage (this file, no browser):
 *   [1] REAL WebGL CPU-cell lane (`InstanceFieldGL`) — the CPU-side MIRROR of the bucket
 *       selection: prepared main-vs-shadow metric forwarding, per-record main-driven bucket
 *       routing in shadow commands (bias 0 and >0), the main-frustum-excluded fallback path
 *       (`_mainProjectedSize` on demand — LOD never from a shadow camera), and shadow-camera
 *       movement never changing a bucket.
 *   [2] WebGPU recording device (`InstanceFieldSystem`): param blocks of every prepared view
 *       carry the main view's metric words (`CULL_OFFSET_VIEWPORT_HEIGHT_PX` /
 *       `CULL_OFFSET_FOV_RADIANS_Y`), and the `cullParams` mirror confirms it.
 *   [3] WGSL source audit (`instance_cull.wgsl`): `viewDist` is measured from `global.viewPos`
 *       (main camera), the metric reads the forwarded `cullParams.viewportHeightPx/fovRadiansY`,
 *       routing uses `cullParams.segmentBase + bucket`, and the `CullParams` struct carries NO
 *       per-view projection inputs — a regression to per-view projection breaks these pins.
 *   [4] CPU rule-set corpus: randomized (main + shadow) view sets over synthetic instances —
 *       bucket(view) == bucket(main) (or `max(main - bias, 0)` on shadow views), the only
 *       view-dependent gate is the per-view sub-pixel drop.
 *
 * The browser-only half (live per-frame bucket counts during fast flight, pop metric) is the
 * headless proxy's counterpart in `InstanceFieldFastFlightPop.test.ts` + the research note
 * `docs/research/veg-p2-lod-transitions.md` — `live browser verification pending at integration`.
 *
 * Band-selector mirror: the frozen band semantics are pinned canonically in
 * `InstanceFieldCull.test.ts` (`selectBucketByProjectedSize`); the local `selectBucket` below is
 * semantically identical and documented as such (numeric thresholds live in the test files, ADR
 * 0047 dead-knob rule).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Frustum, Matrix4, Vector3D } from "../../src/math/index.js";
import {
  MAX_INDIRECT_VIEWS,
  MAX_LOD_BUCKETS,
  aabbVisibleConservative,
  fillCellWorldBounds,
  packInstancePose,
  projectedDiameterPixels,
  type Aabb,
  type CpuDrawCommand,
  type CullParams,
  type InstanceFieldOptions,
  type LodBucketDescriptor,
  type Plane4,
  type PrototypeDescriptor,
} from "../../src/core/InstanceField.js";
import type { InstanceFieldRenderHost } from "../../src/renderers/WebGPU/managers/InstanceFieldSystem.js";
import { InstanceFieldSystem } from "../../src/renderers/WebGPU/managers/InstanceFieldSystem.js";
import { InstanceFieldGL } from "../../src/renderers/gl/managers/InstanceFieldGL.js";
import type { Mesh } from "../../src/renderers/Mesh.js";
import type { AbstractMaterial } from "../../src/core/materials/index.js";
import instanceCullWGSL from "../../src/renderers/shaders/source/web_gpu/compute/instance_cull.wgsl?raw";
import instanceFieldStructsWGSL from "../../src/renderers/shaders/source/web_gpu/chunks/instance_field_structs.wgsl?raw";

// ---------------------------------------------------------------------------
// §0 Fixture constants + the frozen band-selector mirror. Thresholds live here (ADR 0047).
// ---------------------------------------------------------------------------

/** Frozen projected-size metric inputs used across this file (main camera anchors them). */
const MAIN_VIEWPORT_HEIGHT_PX = 720;
const MAIN_FOV_RADIANS_Y = Math.PI / 3;
const CULL_PIXEL_SIZE = 4;
const PROTOTYPE_RADIUS = 2;
const CELL_SIZE = 10;

/** One record per cell in a 8x1x8 grid; every record is prototype 0 at uniform scale 1. */
const GRID_COUNTS: readonly [number, number, number] = [8, 1, 8];
const GRID_ORIGIN: readonly [number, number, number] = [0, -5, 0];
const FIELD_CELL_COUNT = GRID_COUNTS[0] * GRID_COUNTS[1] * GRID_COUNTS[2];

/** LOD chain: 3 ascending buckets (bands [8,96], [96,384], [384,1536] px). */
function makeLodPrototype(id: string, maxInstances = FIELD_CELL_COUNT): PrototypeDescriptor {
  return {
    id,
    boundingRadius: PROTOTYPE_RADIUS,
    lodBuckets: [
      { name: `${id}:b0`, lodIndex: 0, minProjectedSize: 8, maxProjectedSize: 96, geometrySlot: 0 },
      {
        name: `${id}:b1`,
        lodIndex: 1,
        minProjectedSize: 96,
        maxProjectedSize: 384,
        geometrySlot: 1,
      },
      {
        name: `${id}:b2`,
        lodIndex: 2,
        minProjectedSize: 384,
        maxProjectedSize: 1536,
        geometrySlot: 2,
      },
    ],
    materialSlot: 0,
    maxInstances,
  };
}

/**
 * Frozen band semantics (semantic twin of the canonical pin in `InstanceFieldCull.test.ts`):
 * entry `minProjectedSize` EXCLUSIVE, exit `maxProjectedSize` INCLUSIVE, `cullPixelSize` is a
 * strict floor (below it the instance is dropped), beyond the coarsest band the diameter clamps
 * to the coarsest bucket. Returns -1 only for sub-pixel / non-finite input.
 */
function selectBucket(
  buckets: readonly LodBucketDescriptor[],
  dPx: number,
  cullPixelSize: number,
): number {
  if (buckets.length === 0 || !Number.isFinite(dPx)) return -1;
  if (dPx < cullPixelSize) return -1;
  for (let b = 0; b < buckets.length; b++) {
    if (dPx <= buckets[b]!.maxProjectedSize) return b;
  }
  return buckets.length - 1;
}

/**
 * CPU mirror of the GL lane's exact per-run LOD math (main camera): the lane measures distance
 * to the CELL CENTER minus the half cell diagonal and consumes the frozen metric with the main
 * metric inputs. `camPos` is the camera whose distance applies — for the MAIN-driven bucket that
 * is ALWAYS the main camera position; the shadow camera position never enters.
 * NOTE: the lane's bucket picker has NO sub-pixel floor (that is a separate keep/drop gate);
 * this mirror reproduces the band lookup exactly (`_pickBucket` semantics), so bucket equality
 * is asserted on kept records without caring about the drop gate.
 */
function expectedMainBucket(
  buckets: readonly LodBucketDescriptor[],
  cellCenter: readonly [number, number, number],
  camPos: { readonly x: number; readonly y: number; readonly z: number },
  viewportHeightPx: number,
  fovRadiansY: number,
): number {
  const px = mainProjectedPx(cellCenter, camPos, viewportHeightPx, fovRadiansY);
  for (let b = 0; b < buckets.length; b++) {
    if (px <= buckets[b]!.maxProjectedSize) return b;
  }
  return buckets.length - 1;
}

/** Frozen projected diameter of a run as the lane computes it (cell-center distance, half
 *  diagonal subtracted — the metric is per-cell on the CPU lane, NOT per record). */
function mainProjectedPx(
  cellCenter: readonly [number, number, number],
  camPos: { readonly x: number; readonly y: number; readonly z: number },
  viewportHeightPx: number,
  fovRadiansY: number,
): number {
  const halfDiag = (Math.sqrt(3) * CELL_SIZE) / 2;
  const dx = cellCenter[0] - camPos.x;
  const dy = cellCenter[1] - camPos.y;
  const dz = cellCenter[2] - camPos.z;
  const dist = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - halfDiag);
  return projectedDiameterPixels(PROTOTYPE_RADIUS, dist, viewportHeightPx, fovRadiansY);
}

/**
 * Exact mirror of the lane's SHADOW-view bucket branch: the coarse bias is applied to EVERY
 * shadow-view run — the frozen contract applies `max(selectedBucket - shadowLodBias, 0)`
 * (InstanceField.ts), with bucket 0 the COARSEST band. Runs the main view never reached
 * (main budget/frustum drop) are recomputed from the MAIN projection on demand and then biased
 * exactly like main-kept runs.
 */
function expectedShadowBucket(
  buckets: readonly LodBucketDescriptor[],
  cellId: number,
  bias: number,
): number {
  const pxMain = mainProjectedPx(
    cellCenterOf(cellId),
    MAIN_EYE,
    MAIN_VIEWPORT_HEIGHT_PX,
    MAIN_FOV_RADIANS_Y,
  );
  let b = 0;
  for (; b < buckets.length; b++) {
    if (pxMain <= buckets[b]!.maxProjectedSize) break;
  }
  if (b >= buckets.length) b = buckets.length - 1;
  return Math.max(0, b - bias);
}

/** True when the lane's main-view pass would KEEP the run of `cellId` (main frustum test on
 *  the radius-grown cell AABB — the exact pre-filter the lane runs before bucket marking). */
function mainFrustumKeepsCell(cellId: number): boolean {
  const aabb: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
  fillCellWorldBounds(
    cellId,
    {
      origin: GRID_ORIGIN,
      cellSize: CELL_SIZE,
      cellCounts: GRID_COUNTS,
      bounds: { min: [...GRID_ORIGIN], max: [...GRID_ORIGIN] },
    },
    aabb,
  );
  aabb.min[0] -= PROTOTYPE_RADIUS;
  aabb.min[1] -= PROTOTYPE_RADIUS;
  aabb.min[2] -= PROTOTYPE_RADIUS;
  aabb.max[0] += PROTOTYPE_RADIUS;
  aabb.max[1] += PROTOTYPE_RADIUS;
  aabb.max[2] += PROTOTYPE_RADIUS;
  const frustum = new Frustum();
  frustum.setFromMatrix(viewProjection(MAIN_CAM));
  const planes: Plane4[] = [];
  for (let i = 0; i < 6; i++) {
    planes.push([
      frustum.planes[i * 4]!,
      frustum.planes[i * 4 + 1]!,
      frustum.planes[i * 4 + 2]!,
      frustum.planes[i * 4 + 3]!,
    ]);
  }
  return aabbVisibleConservative(planes, aabb);
}

/** Cell center of `cellId` in the authored grid (matches the GL lane's `_cellsCenter` fill). */
function cellCenterOf(cellId: number): [number, number, number] {
  const w = GRID_COUNTS[0];
  const h = GRID_COUNTS[1];
  const x = cellId % w;
  const y = ((cellId / w) | 0) % h;
  const z = (cellId / (w * h)) | 0;
  return [
    GRID_ORIGIN[0] + x * CELL_SIZE + CELL_SIZE / 2,
    GRID_ORIGIN[1] + y * CELL_SIZE + CELL_SIZE / 2,
    GRID_ORIGIN[2] + z * CELL_SIZE + CELL_SIZE / 2,
  ];
}

/** Mock GL context sufficient for the field's STATIC_DRAW upload path (no drawing here). */
function makeGl(): WebGLRenderingContext {
  const gl = {
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    createBuffer: (): object => ({}),
    bindBuffer: (): void => {},
    bufferData: (): void => {},
    deleteBuffer: (): void => {},
  };
  return gl as unknown as WebGLRenderingContext;
}

/** Indexed mock geometry for the per-bucket mesh table (triangle budget per LOD slot). */
function makeBucketMesh(indexCount: number): Mesh {
  return { count: indexCount } as unknown as Mesh;
}

interface GlField {
  field: InstanceFieldGL;
  prototype: PrototypeDescriptor;
  idsByCell: number[];
}

/**
 * Builds the real `InstanceFieldGL` over a one-record-per-cell population (all prototype 0 at
 * scale 1) with `bias` as `shadowLodBias`. The cell-sorted record buffer is authored so record
 * index == cell id (VBO/cell order), which makes commands' `instanceBase` ranges resolvable to
 * cells for the CPU expectation.
 */
function makeGlField(bias: number): GlField {
  const prototype = makeLodPrototype("pine");
  const total = FIELD_CELL_COUNT;
  // Cell-sorted records: one record per cell, its own position inside the cell (the metric uses
  // the CELL center; the record position is only stored).
  const records = new Float32Array(total * 4);
  const pose = new Uint32Array(1);
  pose[0] = packInstancePose(0, 1);
  const poseF = new Float32Array(pose.buffer)[0]!;
  const idsByCell: number[] = [];
  for (let c = 0; c < total; c++) {
    const center = cellCenterOf(c);
    records[c * 4] = center[0];
    records[c * 4 + 1] = center[1];
    records[c * 4 + 2] = center[2];
    records[c * 4 + 3] = poseF;
    idsByCell.push(c);
  }
  const ownership = idsByCell.map((cellId, i) => ({ cellId, instanceOffset: i, instanceCount: 1 }));
  const population = {
    records: ownership,
    totalInstances: total,
    isPopulated: (cellId: number): boolean => ownership.some((r) => r.cellId === cellId),
    instanceRange: (
      cellId: number,
    ): { cellId: number; instanceOffset: number; instanceCount: number } | undefined =>
      ownership.find((r) => r.cellId === cellId) ?? undefined,
  };

  const options: Pick<
    InstanceFieldOptions,
    "cullPixelSize" | "shadowLodBias" | "maxViews" | "cpuBudget"
  > = {
    cullPixelSize: CULL_PIXEL_SIZE,
    shadowLodBias: bias,
    maxViews: 4,
    cpuBudget: {
      maxCullRadius: 1_000_000,
      maxCellsPerFrame: 1_000_000,
      maxDrawsPerFrame: 1_000_000,
      maxInstancesPerFrame: 1_000_000,
    },
  };

  const field = new InstanceFieldGL({
    gl: makeGl(),
    grid: {
      origin: GRID_ORIGIN,
      cellSize: CELL_SIZE,
      cellCounts: GRID_COUNTS,
      bounds: { min: [...GRID_ORIGIN], max: [...GRID_ORIGIN] },
    },
    population,
    instanceRecords: records,
    prototypes: [prototype],
    geometryTable: [
      [makeBucketMesh(3000), makeBucketMesh(1500), makeBucketMesh(300)] as (Mesh | undefined)[],
    ],
    materials: [{ material: {} as unknown as AbstractMaterial, alphaTest: 0 }],
    options,
  });
  return { field, prototype, idsByCell };
}

// ---------------------------------------------------------------------------
// §1 Camera pose helpers (engine-faithful VP, INWARD-frustum extraction via the engine)
// ---------------------------------------------------------------------------

interface Pose {
  readonly eye: readonly [number, number, number];
  readonly f: readonly [number, number, number];
  readonly vfovY: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
}

function poseAt(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  vfovY: number,
): Pose {
  const f: [number, number, number] = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const len = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
  return {
    eye,
    f: [f[0] / len, f[1] / len, f[2] / len],
    vfovY,
    aspect: 1,
    near: 0.1,
    far: 10000,
  };
}

function viewProjection(cam: Pose): Matrix4 {
  const proj = new Matrix4();
  Matrix4.perspective(cam.vfovY, cam.aspect, cam.near, cam.far, proj);
  const view = new Matrix4();
  Matrix4.lookAt(
    new Vector3D(cam.eye[0], cam.eye[1], cam.eye[2]),
    new Vector3D(cam.eye[0] + cam.f[0], cam.eye[1] + cam.f[1], cam.eye[2] + cam.f[2]),
    new Vector3D(0, 1, 0),
    view,
  );
  const vp = new Matrix4();
  Matrix4.multiply(proj, view, vp);
  return vp;
}

function viewProjectionData(cam: Pose): Float32Array {
  return viewProjection(cam).data.slice();
}

/** Main camera overlooking the field from +Z; near cells resolve to coarse, far to fine. */
const MAIN_CAM: Pose = poseAt([40, 6, 14], [40, 0, 55], Math.PI / 3);
/** `MAIN_CAM.eye` in the object form the lane and the CPU mirror consume. */
const MAIN_EYE = { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] } as const;
/** Shadow camera looking across the field from the +X side (different origin + direction). */
const SHADOW_CAM_A: Pose = poseAt([170, 40, 40], [-50, 0, 40], Math.PI / 2);
const SHADOW_CAM_B: Pose = poseAt([70, 60, -60], [40, 0, 40], Math.PI / 2);
/** `SHADOW_CAM_A.eye` in object form (the shadow mirror check only needs the position). */
const SHADOW_A_EYE = {
  x: SHADOW_CAM_A.eye[0],
  y: SHADOW_CAM_A.eye[1],
  z: SHADOW_CAM_A.eye[2],
} as const;

/** Reads every command of a GL field view (typed against the frozen `CpuDrawCommand`). */
function collectCommands(field: InstanceFieldGL, viewIndex: number): readonly CpuDrawCommand[] {
  const source = field.getSource(viewIndex);
  expect(source, `view ${viewIndex} source`).toBeDefined();
  return source!.commands;
}

// ---------------------------------------------------------------------------
// §2 REAL GL CPU lane — main-camera LOD anchor on the mirror contract
// ---------------------------------------------------------------------------

describe("IF-PROJECTED-SIZE main-camera anchor — real InstanceFieldGL (CPU mirror)", () => {
  function driveFrame(field: InstanceFieldGL, shadowCam: Pose, shadowViewIndex = 1): void {
    field.prepareMainView(
      viewProjectionData(MAIN_CAM),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    field.prepareShadowView(shadowViewIndex, viewProjectionData(shadowCam));
    field.cullShadowView(shadowViewIndex);
  }

  it("prepareMainView forwards the main metric inputs to the cull-params mirror of EVERY view", () => {
    const { field } = makeGlField(0);
    field.prepareMainView(
      viewProjectionData(MAIN_CAM),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    for (let v = 0; v < field.maxViews; v++) {
      expect(field.cullParams[v]!.viewportHeightPx).toBe(MAIN_VIEWPORT_HEIGHT_PX);
      expect(field.cullParams[v]!.fovRadiansY).toBe(MAIN_FOV_RADIANS_Y);
    }
    // prepareShadowView must NOT overwrite the primary-view metric with shadow-specific values.
    field.prepareShadowView(1, viewProjectionData(SHADOW_CAM_A));
    expect(field.cullParams[1]!.viewportHeightPx).toBe(MAIN_VIEWPORT_HEIGHT_PX);
    expect(field.cullParams[1]!.fovRadiansY).toBe(MAIN_FOV_RADIANS_Y);
  });

  it("main-view commands route every record to the exact main-metric bucket", () => {
    const { field, prototype } = makeGlField(0);
    driveFrame(field, SHADOW_CAM_A);
    const cmds = collectCommands(field, 0);
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const cellId = cmd.instanceBase + k;
        const expected = expectedMainBucket(
          prototype.lodBuckets,
          cellCenterOf(cellId),
          MAIN_EYE,
          MAIN_VIEWPORT_HEIGHT_PX,
          MAIN_FOV_RADIANS_Y,
        );
        expect(cmd.bucketIndex, `cell ${cellId} main bucket`).toBe(expected);
      }
    }
  });

  it("shadow-view commands reuse the MAIN-determined bucket despite a different shadow camera (bias 0)", () => {
    const { field, prototype } = makeGlField(0);
    driveFrame(field, SHADOW_CAM_A);
    const shadow = collectCommands(field, 1);
    expect(shadow.length).toBeGreaterThan(0);
    let sensitiveCells = 0;
    for (const cmd of shadow) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const cellId = cmd.instanceBase + k;
        const expectedMain = expectedMainBucket(
          prototype.lodBuckets,
          cellCenterOf(cellId),
          MAIN_EYE,
          MAIN_VIEWPORT_HEIGHT_PX,
          MAIN_FOV_RADIANS_Y,
        );
        // The shadow camera's own distance/positions must NOT leak into the bucket.
        expect(cmd.bucketIndex, `cell ${cellId} shadow bucket`).toBe(expectedMain);
        // Fixture sensitivity: at least one CELL exists where the shadow camera's own metric
        // would select a DIFFERENT band — otherwise a projection leak could pass unobserved.
        const shadowBand = expectedMainBucket(
          prototype.lodBuckets,
          cellCenterOf(cellId),
          SHADOW_A_EYE,
          MAIN_VIEWPORT_HEIGHT_PX,
          MAIN_FOV_RADIANS_Y,
        );
        if (shadowBand !== expectedMain) sensitiveCells++;
      }
    }
    expect(sensitiveCells, "fixture must contain shadow-sensitive cells").toBeGreaterThan(0);
  });

  it("shadowLodBias>0 applies the frozen coarse bias `max(0, b - bias)` to EVERY shadow run (main-kept and main-culled fallback)", () => {
    const bias = 1;
    const { field, prototype } = makeGlField(bias);
    driveFrame(field, SHADOW_CAM_A);
    const shadow = collectCommands(field, 1);
    expect(shadow.length).toBeGreaterThan(0);
    for (const cmd of shadow) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const cellId = cmd.instanceBase + k;
        // Frozen contract: every shadow run is biased coarser (`max(0, b - bias)`), for
        // main-kept AND main-culled fallback runs alike (fallback is recomputed from the
        // main projection and then biased the same way).
        const expected = expectedShadowBucket(prototype.lodBuckets, cellId, bias);
        expect(cmd.bucketIndex, `cell ${cellId} biased shadow bucket`).toBe(expected);
      }
    }
    // The fixture must exercise BOTH branch types (main-kept and main-culled fallback).
    const biasedSeen = new Set<number>();
    const fallbackSeen = new Set<number>();
    for (const cmd of shadow) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const cellId = cmd.instanceBase + k;
        if (mainFrustumKeepsCell(cellId)) biasedSeen.add(cellId);
        else fallbackSeen.add(cellId);
      }
    }
    expect(biasedSeen.size, "main-kept branch must be exercised").toBeGreaterThan(0);
    expect(fallbackSeen.size, "main-culled fallback branch must be exercised").toBeGreaterThan(0);
  });

  it("fallback path: when the main frustum excludes the field, the shadow bucket still comes from the MAIN metric", () => {
    const { field, prototype } = makeGlField(0);
    // Main camera faces +Z (away from the field at [0..80,0..80]), so no cell is main-visible;
    // the shadow camera on the X side sees every cell.
    const mainAway: Pose = poseAt([40, 30, 170], [40, 30, 400], Math.PI / 3);
    const mainAwayEye = { x: mainAway.eye[0], y: mainAway.eye[1], z: mainAway.eye[2] };
    field.prepareMainView(
      viewProjectionData(mainAway),
      { x: mainAway.eye[0], y: mainAway.eye[1], z: mainAway.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    expect(collectCommands(field, 0)).toHaveLength(0);
    field.prepareShadowView(1, viewProjectionData(SHADOW_CAM_A));
    field.cullShadowView(1);
    const shadow = collectCommands(field, 1);
    expect(shadow.length).toBeGreaterThan(0);
    for (const cmd of shadow) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const cellId = cmd.instanceBase + k;
        const expected = expectedMainBucket(
          prototype.lodBuckets,
          cellCenterOf(cellId),
          mainAwayEye,
          MAIN_VIEWPORT_HEIGHT_PX,
          MAIN_FOV_RADIANS_Y,
        );
        expect(cmd.bucketIndex, `cell ${cellId} main-fallback shadow bucket`).toBe(expected);
      }
    }
  });

  it("moving the shadow camera never changes a single shadow bucket (bucket(s) == main-derived)", () => {
    const { field, prototype } = makeGlField(0);
    driveFrame(field, SHADOW_CAM_A);
    const a = collectCommands(field, 1);
    driveFrame(field, SHADOW_CAM_B);
    const b = collectCommands(field, 1);
    expect(a.length).toBeGreaterThan(0);
    // Same population, same main camera: any difference in the shadow command buckets would
    // prove a shadow-projection leak into the LOD selection.
    const indexedA = new Map(a.map((c) => [c.instanceBase, c.bucketIndex]));
    for (const cmd of b) {
      const aBucket = indexedA.get(cmd.instanceBase);
      if (aBucket === undefined) continue;
      expect(cmd.bucketIndex, `cell ${cmd.instanceBase} across shadow poses`).toBe(aBucket);
      // And the stable value is the main-metric bucket.
      const expected = expectedMainBucket(
        prototype.lodBuckets,
        cellCenterOf(cmd.instanceBase),
        MAIN_EYE,
        MAIN_VIEWPORT_HEIGHT_PX,
        MAIN_FOV_RADIANS_Y,
      );
      expect(cmd.bucketIndex).toBe(expected);
    }
  });

  it("records are routed to at most one bucket per view (no cross-bucket duplicate in shadow commands)", () => {
    const { field } = makeGlField(0);
    driveFrame(field, SHADOW_CAM_A);
    const seen = new Set<number>();
    for (const cmd of collectCommands(field, 1)) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const id = cmd.instanceBase + k;
        expect(seen.has(id), `record ${id} appears twice in shadow commands`).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §3 WebGPU recording device — metric words forwarded to every view's param block
// ---------------------------------------------------------------------------

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g["GPUBufferUsage"] ??= {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
  g["GPUShaderStage"] ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  g["GPUTextureUsage"] ??= {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  };
  g["GPUMapMode"] ??= { READ: 1, WRITE: 2 };
});

const PARAM_BLOCK_BYTES = 256;
const CULL_OFFSET_VIEWPORT_HEIGHT_PX = 96;
const CULL_OFFSET_FOV_RADIANS_Y = 100;
const VP = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -1, 0]);

describe("IF-PROJECTED-SIZE main-camera anchor — WebGPU param-block forward (recording device)", () => {
  interface MockBuffer {
    size: number;
    label?: string | undefined;
    mapState: "unmapped" | "pending" | "mapped";
    mapAsync: () => Promise<void>;
    destroy: () => void;
  }

  interface Recorded {
    writes: { buffer: MockBuffer; offset: number; data: Uint8Array }[];
  }

  function makeDevice(rec: Recorded): GPUDevice {
    const device = {
      createBuffer: (desc: GPUBufferDescriptor): MockBuffer => {
        const b: MockBuffer = {
          size: desc.size,
          label: desc.label,
          mapState: "unmapped",
          mapAsync: (): Promise<void> => {
            b.mapState = "pending";
            return Promise.resolve();
          },
          destroy: (): void => {},
        };
        return b;
      },
      createBindGroupLayout: (): object => ({}),
      createBindGroup: (): object => ({}),
      createPipelineLayout: (): object => ({}),
      createShaderModule: (): object => ({}),
      createComputePipeline: (): object => ({}),
      createRenderPipeline: (): object => ({}),
      createSampler: (): object => ({}),
      createTexture: (): object => ({ createView: (): object => ({}), destroy: vi.fn() }),
      queue: {
        writeTexture: (): void => {},
        writeBuffer: (
          buffer: MockBuffer,
          offset: number,
          data: ArrayBufferView | ArrayBuffer,
          dataOffset = 0,
          size?: number,
        ): void => {
          let bytes: Uint8Array;
          if (data instanceof ArrayBuffer) {
            const len = size ?? data.byteLength - dataOffset;
            bytes = new Uint8Array(data.slice(dataOffset, dataOffset + len));
          } else {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
          }
          rec.writes.push({ buffer, offset, data: bytes });
        },
      },
    };
    return device as unknown as GPUDevice;
  }

  function makeSystem(): { system: InstanceFieldSystem; rec: Recorded } {
    const rec: Recorded = { writes: [] };
    const host = {
      gpuDevice: makeDevice(rec),
      globalBGL: {},
      globalBindGroup: {},
      globalUniformBuffer: { id: "global" },
      viewBGL: {},
      viewBindGroup: {},
      currentColorTargetFormat: "bgra8unorm",
      fieldCullModuleSource: "",
      fieldPullModuleSource: "",
      whiteTextureView: {},
      getPreviousFrameHzb: () => ({
        available: true,
        frameIndex: 1,
        readHandle: { view: {}, mipLevelCount: 8 },
      }),
      getTextureView: () => ({}),
      acquireFieldGeometry: () => ({
        vb: { id: "vb" },
        uvb: { id: "uvb" },
        ib: { id: "ib" },
        indexCount: 36,
        vertexCount: 3,
        format: "uint32",
      }),
      releaseFieldGeometry: () => {},
    } as unknown as InstanceFieldRenderHost;
    const indexedGeo = { vertices: new Float32Array(9), indices: new Uint32Array(3) };
    const system = new InstanceFieldSystem(null, {
      instanceRecords: new Float32Array(16 * 4),
      prototypes: [makeLodPrototype("rec", 16)],
      // All three buckets of the prototype must resolve a geometry (constructor validation).
      geometryTable: [[indexedGeo, indexedGeo, indexedGeo]],
      options: {
        maxInstances: 16,
        cellSize: CELL_SIZE,
        cullPixelSize: CULL_PIXEL_SIZE,
        maxViews: 4,
      },
    } as never);
    system.attachHost(host);
    return { system, rec };
  }

  function paramBlockWords(rec: Recorded, blockIndex: number): Float32Array {
    const offset = blockIndex * MAX_LOD_BUCKETS * PARAM_BLOCK_BYTES;
    const hit = rec.writes
      .slice()
      .reverse()
      .find((w) => w.offset === offset && w.data.byteLength === PARAM_BLOCK_BYTES);
    expect(hit, `param block upload at ${offset}`).toBeDefined();
    const bytes = hit!.data as Uint8Array;
    return new Float32Array(bytes.buffer, bytes.byteOffset, PARAM_BLOCK_BYTES / 4);
  }

  it("every prepared view's param block carries the MAIN view's metric words (viewportHeightPx, fovRadiansY)", () => {
    const { system, rec } = makeSystem();
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, MAIN_VIEWPORT_HEIGHT_PX, MAIN_FOV_RADIANS_Y);
    for (let v = 1; v < 4; v++) {
      system.prepareShadowView(v, VP);
    }
    const main = paramBlockWords(rec, 0);
    expect(main[CULL_OFFSET_VIEWPORT_HEIGHT_PX / 4]).toBe(MAIN_VIEWPORT_HEIGHT_PX);
    // The fov word round-trips through the f32 param block (f32 rounding of π/3 ≈ 2.9e-8).
    expect(main[CULL_OFFSET_FOV_RADIANS_Y / 4]).toBeCloseTo(MAIN_FOV_RADIANS_Y, 6);
    for (let v = 1; v < 4; v++) {
      const block = paramBlockWords(rec, v);
      expect(block[CULL_OFFSET_VIEWPORT_HEIGHT_PX / 4], `view ${v} viewport word`).toBe(
        MAIN_VIEWPORT_HEIGHT_PX,
      );
      expect(block[CULL_OFFSET_FOV_RADIANS_Y / 4], `view ${v} fov word`).toBeCloseTo(
        MAIN_FOV_RADIANS_Y,
        6,
      );
    }
  });

  it("the cullParams mirror carries the main metric on every view (segmentBase per view)", () => {
    const { system } = makeSystem();
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, MAIN_VIEWPORT_HEIGHT_PX, MAIN_FOV_RADIANS_Y);
    system.prepareShadowView(2, VP);
    const params = system.cullParams as readonly CullParams[];
    expect(params[0]!.viewportHeightPx).toBe(MAIN_VIEWPORT_HEIGHT_PX);
    expect(params[0]!.fovRadiansY).toBe(MAIN_FOV_RADIANS_Y);
    expect(params[2]!.viewportHeightPx).toBe(MAIN_VIEWPORT_HEIGHT_PX);
    expect(params[2]!.fovRadiansY).toBe(MAIN_FOV_RADIANS_Y);
    expect(params[2]!.segmentBase).toBe(2 * MAX_LOD_BUCKETS);
  });
});

// ---------------------------------------------------------------------------
// §4 WGSL source audit — the on-GPU bucket selection is main-anchored on every pass
// ---------------------------------------------------------------------------

describe("IF-PROJECTED-SIZE main-camera anchor — instance_cull.wgsl source audit", () => {
  it("measures viewDistance from global.viewPos (main camera), never a per-view position", () => {
    // The frozen metric needs a MAIN-camera distance on every pass; a regression replacing
    // `global.viewPos` with a per-view uniform breaks the anchor and fails this pin.
    expect(instanceCullWGSL).toContain("let toCam = center - global.viewPos.xyz;");
    expect(instanceCullWGSL).toContain("viewDist = max(length(toCam), 1e-6)");
  });

  it("evaluates the metric through the forwarded cullParams.viewportHeightPx/fovRadiansY on every view", () => {
    expect(instanceCullWGSL).toContain("cullParams.fovRadiansY * 0.5");
    expect(instanceCullWGSL).toContain("cullParams.viewportHeightPx");
    // The metric is evaluated BEFORE any view-mode branch (frustum+size gate in the cell loop
    // head), so shadow/deep/opaque passes cannot swap in their own projection.
    const metricIdx = instanceCullWGSL.indexOf("fn fieldProjectedDiameterPx");
    const bucketIdx = instanceCullWGSL.indexOf("fn fieldSelectBucket");
    expect(metricIdx).toBeGreaterThan(-1);
    expect(bucketIdx).toBeGreaterThan(metricIdx);
  });

  it("routes survivors through cullParams.segmentBase + bucket (view x bucket page base)", () => {
    expect(instanceCullWGSL).toContain("let bv = cullParams.segmentBase + bucket;");
  });

  it("CullParams carries NO per-view projection inputs (metric inputs are primary-view by construction)", () => {
    // The struct must not grow a per-view fov/viewport field: the metric inputs it declares
    // are exactly the forwarded primary-view values.
    expect(instanceFieldStructsWGSL).toMatch(/viewportHeightPx:\s*f32/);
    expect(instanceFieldStructsWGSL).toMatch(/fovRadiansY:\s*f32/);
    expect(instanceFieldStructsWGSL).not.toContain("eyePosition");
    expect(instanceFieldStructsWGSL).not.toContain("shadowViewport");
  });

  it("FIELD_SEGMENTS matches the frozen segment-table dimension (MAX_INDIRECT_VIEWS x MAX_LOD_BUCKETS)", () => {
    const expected = MAX_INDIRECT_VIEWS * MAX_LOD_BUCKETS;
    expect(instanceCullWGSL).toContain(`const FIELD_SEGMENTS: u32 = ${expected}u;`);
    expect(instanceCullWGSL).toContain("min(fieldPrototypeRange[prototype].z, 8u)");
  });
});

// ---------------------------------------------------------------------------
// §5 CPU rule-set corpus — bucket(view) == bucket(main) or main+bias clamp, any view set
// ---------------------------------------------------------------------------

describe("IF-PROJECTED-SIZE main-camera anchor — CPU rule-set corpus (reference spec)", () => {
  /**
   * Reference routing of one instance under the frozen rules. `keep` (the sub-pixel drop) is
   * view-dependent — every view gates with its OWN projected diameter — while the BUCKET is a
   * pure function of the MAIN metric (view-independent), optionally coarsened by the frozen
   * bias rule on non-main views. Returned bucket is -1 for dropped views.
   */
  function referenceRoute(
    buckets: readonly LodBucketDescriptor[],
    mainCam: readonly [number, number, number],
    instancePos: readonly [number, number, number],
    instanceRadius: number,
    viewPositions: readonly (readonly [number, number, number])[],
    bias: number,
  ): { kept: boolean[]; bucketOf: number[] } {
    const mainDist = Math.sqrt(
      (instancePos[0] - mainCam[0]) ** 2 +
        (instancePos[1] - mainCam[1]) ** 2 +
        (instancePos[2] - mainCam[2]) ** 2,
    );
    const mainPx = projectedDiameterPixels(
      instanceRadius,
      Math.max(mainDist, 1e-6),
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    const mainBucket = selectBucket(buckets, mainPx, CULL_PIXEL_SIZE);
    const kept: boolean[] = [];
    const bucketOf: number[] = [];
    for (let v = 0; v < viewPositions.length; v++) {
      const pos = viewPositions[v]!;
      const d = Math.sqrt(
        (instancePos[0] - pos[0]) ** 2 +
          (instancePos[1] - pos[1]) ** 2 +
          (instancePos[2] - pos[2]) ** 2,
      );
      const px = projectedDiameterPixels(
        instanceRadius,
        Math.max(d, 1e-6),
        MAIN_VIEWPORT_HEIGHT_PX,
        MAIN_FOV_RADIANS_Y,
      );
      const keep = px >= CULL_PIXEL_SIZE;
      kept.push(keep);
      bucketOf.push(keep ? (v === 0 ? mainBucket : Math.max(0, mainBucket - bias)) : -1);
    }
    return { kept, bucketOf };
  }

  it("bucket(any view) == bucket(main), only the clamped coarse bias distinguishes shadow views (bias 0 and > 0)", () => {
    const prototype = makeLodPrototype("corpus");
    const mainCam: readonly [number, number, number] = [0, 5, 0];
    const views: readonly (readonly [number, number, number])[] = [
      [0, 5, 0],
      [50, 5, 0],
      [-50, 5, 0],
      [0, 5, 80],
    ];
    const instances: { pos: [number, number, number]; radius: number }[] = [
      { pos: [0, 0, -20], radius: 2 }, // near -> fine
      { pos: [0, 0, -120], radius: 2 }, // mid
      { pos: [0, 0, -300], radius: 2 }, // far -> coarse
      { pos: [5, 0, 40], radius: 8 }, // side, larger radius -> different band
    ];
    for (const bias of [0, 2] as const) {
      for (const inst of instances) {
        const r = referenceRoute(prototype.lodBuckets, mainCam, inst.pos, inst.radius, views, bias);
        expect(r.bucketOf[0]!, `bias ${bias}, near main`).toBeGreaterThanOrEqual(0);
        for (let v = 0; v < views.length; v++) {
          if (!r.kept[v]!) continue;
          const expected = v === 0 ? r.bucketOf[0]! : Math.max(0, r.bucketOf[0]! - bias);
          expect(r.bucketOf[v]!, `bias ${bias}, view ${v}`).toBe(expected);
        }
      }
    }
  });

  it("the rule corpus exercises multiple distinct bands (not a single-bucket vacuity trap)", () => {
    const prototype = makeLodPrototype("corpus");
    const positions: readonly (readonly [number, number, number])[] = [
      [0, 0, -20],
      [0, 0, -60],
      [0, 0, -300],
    ];
    const bands = new Set<number>();
    for (const pos of positions) {
      const d = Math.sqrt(pos[0] ** 2 + (pos[1] - 5) ** 2 + pos[2] ** 2);
      const px = projectedDiameterPixels(
        2,
        Math.max(d, 1e-6),
        MAIN_VIEWPORT_HEIGHT_PX,
        MAIN_FOV_RADIANS_Y,
      );
      bands.add(selectBucket(prototype.lodBuckets, px, CULL_PIXEL_SIZE));
    }
    expect(bands.size, "corpus spans >1 LOD band").toBeGreaterThan(1);
  });
});
