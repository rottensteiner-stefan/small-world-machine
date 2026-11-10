/**
 * InstanceFieldGL.test.ts — WP-B1 regression + invariant suite for the GL CPU-cell fallback lane
 * (Wave 1, `audit-remediation` WP-D1). Post-fix contract of
 * `packages/engine/src/renderers/gl/managers/InstanceFieldGL.ts` + the single-point GL draw hook
 * `AbstractWebGLRenderer._drawFieldShadowView`.
 *
 * Invariants under test (each pins ONE WP-B1 defect class; the old behavior fails the pin):
 *   IF-SHADOW-VIEW-INDEX (WP-B1.1): the renderer allocates shadow-view indices starting at 1 —
 *     slot 0 is the MAIN camera's culled source and is never overwritten by a shadow draw. The
 *     first `_drawFieldShadowView` draw culls view 1, not view 0 (old code initialized the index
 *     to 0, so the first shadow draw replayed the MAIN command list into shadow map 0).
 *   IF-CASCADE-FRUSTUM (WP-D1 item 2): a shadow view culls against ITS OWN frustum (per-view
 *     planes), never against the main camera's frustum and never by reusing View 0's command
 *     list. Emitted cells of a shadow view == the cells its own conservative frustum test keeps.
 *   IF-MAIN-ANCHORED-REACH (WP-B1.2): reachability prefilter + projected-size distance are
 *     MAIN-camera-anchored. A directional cascade whose camera sits 200 m behind its box
 *     (`center - direction * 200`) with `maxCullRadius = 100` must NOT distance-cull the cells
 *     the main camera reaches — the old code measured the distance to the shadow pullback point
 *     and dropped 100% of every cascade.
 *   IF-LOD-BIAS-COARSE (WP-B1.3): `shadowLodBias > 0` shifts the main-determined bucket to
 *     `Math.max(0, b - bias)` (coarser; bucket 0 is coarsest), never `b + 1` (finer). The exact
 *     `max(0, b - bias)` mirror incl. main-culled fallback runs is pinned in
 *     `InstanceFieldLodInvariant.test.ts` — this file adds the never-finer direction lock on a
 *     fresh cascade fixture.
 *
 * Renderer level: `drawFieldShadowView` views are exercised through a minimal
 * `TestIFGLRenderer extends AbstractWebGLRenderer` (structural mock, mirrors
 * `AbstractWebGLRenderer.test.ts`). EVSM moment redraws (`reuseView`) replay an already-culled
 * slot WITHOUT re-culling and WITHOUT consuming `maxViews` budget (WP-B1.4 contract).
 *
 * Headless, deterministic: all cull math runs on the CPU lane; no browser, no GPU.
 *
 * Fixture (calibrated, see `_scratch_IFGL.test.ts` lineage): one 16-byte record per cell of an
 * 8x1x8 grid, prototype radius 3, `cullPixelSize 2`; main camera at (40,6,100); directional
 * cascade eye = main.eye - lightDir*200 = (40,6,300) targeting (40,0,70). The
 * `DISCRIMINATOR_BOX` ortho volume keeps a strict subset (24 < 64 cells) — the frustum gate
 * demonstrably rejects cells.
 */

import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { Frustum, Matrix4, Vector3D } from "../../src/math/index.js";
import {
  aabbVisibleConservative,
  fillCellWorldBounds,
  packInstancePose,
  projectedDiameterPixels,
  type Aabb,
  type CpuDrawCommand,
  type CpuIndirectDrawSource,
  type InstanceFieldOptions,
  type Plane4,
  type PrototypeDescriptor,
} from "../../src/core/InstanceField.js";
import { InstanceFieldGL } from "../../src/renderers/gl/managers/InstanceFieldGL.js";
import {
  AbstractWebGLRenderer,
  type InstanceFieldDrawContext,
  type InstanceFieldDrawPass,
} from "../../src/renderers/AbstractWebGLRenderer.js";
import { RendererType } from "../../src/enums/index.js";
import type { Mesh } from "../../src/renderers/Mesh.js";
import type { AbstractMaterial } from "../../src/core/materials/index.js";

// ---------------------------------------------------------------------------
// §0 Fixture constants (calibrated — see header). Thresholds live here (ADR 0047).
// ---------------------------------------------------------------------------

const CELL_SIZE = 10;
const GRID_COUNTS: readonly [number, number, number] = [8, 1, 8];
const GRID_ORIGIN: readonly [number, number, number] = [0, -5, 0];
const FIELD_CELL_COUNT = GRID_COUNTS[0] * GRID_COUNTS[1] * GRID_COUNTS[2];
const PROTOTYPE_RADIUS = 3;
const CULL_PIXEL_SIZE = 2;
const MAIN_VIEWPORT_HEIGHT_PX = 720;
const MAIN_FOV_RADIANS_Y = Math.PI / 3;

/** Main camera near the field, looking -Z. */
const MAIN_CAM: Pose = poseAt([40, 6, 100], [40, 0, 0], MAIN_FOV_RADIANS_Y);
/** Main camera looking AWAY from the field (+Z): reachable but frustum-excluded. */
const MAIN_CAM_AWAY: Pose = poseAt([40, 6, 100], [40, 0, 300], MAIN_FOV_RADIANS_Y);

/** Directional cascade (WP-B1.2): light travels +Z -> -Z, eye pulled back 200 m. */
const LIGHT_DIR: readonly [number, number, number] = [0, 0, -1];
const CASCADE_EYE: readonly [number, number, number] = [
  MAIN_CAM.eye[0] - LIGHT_DIR[0] * 200,
  MAIN_CAM.eye[1] - LIGHT_DIR[1] * 200,
  MAIN_CAM.eye[2] - LIGHT_DIR[2] * 200,
];
const CASCADE_TARGET: readonly [number, number, number] = [40, 0, 70];
/** Ortho volume containing the WHOLE field (64 cells). */
const FULL_BOX = { l: -120, r: 120, b: -60, t: 80, n: 1, f: 500 } as const;
/** Calibrated ortho volume keeping a STRICT subset (24 < 64 cells) — the frustum gate bites. */
const DISCRIMINATOR_BOX = { l: -24, r: 24, b: -20, t: 30, n: 1, f: 250 } as const;

// ---------------------------------------------------------------------------
// §1 Lane fixture (one record per cell; record index == cell id)
// ---------------------------------------------------------------------------

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
    ],
    materialSlot: 0,
    maxInstances,
  };
}

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

function makeBucketMesh(indexCount: number): Mesh {
  return { count: indexCount } as unknown as Mesh;
}

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

function makeGlField(maxViews: number, maxCullRadius: number, shadowLodBias = 0): InstanceFieldGL {
  const prototype = makeLodPrototype("pine");
  const total = FIELD_CELL_COUNT;
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
    shadowLodBias,
    maxViews,
    cpuBudget: {
      maxCullRadius,
      maxCellsPerFrame: 1_000_000,
      maxDrawsPerFrame: 1_000_000,
      maxInstancesPerFrame: 1_000_000,
    },
  };
  return new InstanceFieldGL({
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
    geometryTable: [[makeBucketMesh(3000), makeBucketMesh(1500)] as (Mesh | undefined)[]],
    materials: [{ material: {} as unknown as AbstractMaterial, alphaTest: 0 }],
    options,
  });
}

// ---------------------------------------------------------------------------
// §2 Pose / VP helpers (engine-faithful; same math as the sibling invariant tests)
// ---------------------------------------------------------------------------

interface Pose {
  readonly eye: readonly [number, number, number];
  readonly f: readonly [number, number, number];
  readonly vfovY: number;
}

function poseAt(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  vfovY: number,
): Pose {
  const f: [number, number, number] = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const len = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
  return { eye, f: [f[0] / len, f[1] / len, f[2] / len], vfovY };
}

function perspectiveVP(cam: Pose, aspect: number, near: number, far: number): Float32Array {
  const proj = new Matrix4();
  Matrix4.perspective(cam.vfovY, aspect, near, far, proj);
  const view = new Matrix4();
  Matrix4.lookAt(
    new Vector3D(cam.eye[0], cam.eye[1], cam.eye[2]),
    new Vector3D(cam.eye[0] + cam.f[0], cam.eye[1] + cam.f[1], cam.eye[2] + cam.f[2]),
    new Vector3D(0, 1, 0),
    view,
  );
  const vp = new Matrix4();
  Matrix4.multiply(proj, view, vp);
  return vp.data.slice();
}

function orthoVP(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  box: { l: number; r: number; b: number; t: number; n: number; f: number },
): Float32Array {
  const proj = new Matrix4();
  Matrix4.orthographic(box.l, box.r, box.b, box.t, box.n, box.f, proj);
  const view = new Matrix4();
  Matrix4.lookAt(
    new Vector3D(eye[0], eye[1], eye[2]),
    new Vector3D(target[0], target[1], target[2]),
    new Vector3D(0, 1, 0),
    view,
  );
  const vp = new Matrix4();
  Matrix4.multiply(proj, view, vp);
  return vp.data.slice();
}

function mainCam(): InstanceFieldGL {
  const field = makeGlField(4, 1_000_000);
  field.prepareMainView(
    perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
    { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
    MAIN_VIEWPORT_HEIGHT_PX,
    MAIN_FOV_RADIANS_Y,
  );
  field.cullMainView();
  return field;
}

function collectCommands(field: InstanceFieldGL, viewIndex: number): readonly CpuDrawCommand[] {
  return field.getSource(viewIndex)?.commands ?? [];
}

function commandCells(cmds: readonly CpuDrawCommand[]): number[] {
  const ids: number[] = [];
  for (const cmd of cmds) {
    for (let k = 0; k < cmd.instanceCount; k++) ids.push(cmd.instanceBase + k);
  }
  return ids;
}

/** Replicates the lane's per-view frustum keep predicate (grow AABB by max instance radius,
 *  conservative test against the VIEW's planes) — the mirror the emissions must equal. */
function cascadeKeepsCell(vp: Float32Array, cellId: number): boolean {
  const m = new Matrix4();
  m.data.set(vp);
  const frustum = new Frustum();
  frustum.setFromMatrix(m);
  const planes: Plane4[] = [];
  for (let i = 0; i < 6; i++) {
    planes.push([
      frustum.planes[i * 4]!,
      frustum.planes[i * 4 + 1]!,
      frustum.planes[i * 4 + 2]!,
      frustum.planes[i * 4 + 3]!,
    ]);
  }
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
  return aabbVisibleConservative(planes, aabb);
}

/** The frozen LOD chain of the fixture (see `makeLodPrototype`), for the mirror below. */
const LOD_BUCKETS = makeLodPrototype("meta").lodBuckets;

/** Main-metric LOD bucket of `cellId` (mirror of the lane's `_pickBucket` with the frozen main
 *  inputs: cell-center distance minus half diagonal, main viewport/fov). Used only for the
 *  never-finer bias direction lock. */
function mainMetricBucket(cellId: number): number {
  const cc = cellCenterOf(cellId);
  const halfDiag = (Math.sqrt(3) * CELL_SIZE) / 2;
  const dx = cc[0] - MAIN_CAM.eye[0];
  const dy = cc[1] - MAIN_CAM.eye[1];
  const dz = cc[2] - MAIN_CAM.eye[2];
  const dist = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - halfDiag);
  const px = projectedDiameterPixels(
    PROTOTYPE_RADIUS,
    dist,
    MAIN_VIEWPORT_HEIGHT_PX,
    MAIN_FOV_RADIANS_Y,
  );
  if (!(px > LOD_BUCKETS[0]!.maxProjectedSize)) return 0;
  for (let b = 1; b < LOD_BUCKETS.length; b++) {
    if (px <= LOD_BUCKETS[b]!.maxProjectedSize) return b;
  }
  return LOD_BUCKETS.length - 1;
}

// ---------------------------------------------------------------------------
// §3 Lane-level invariant tests (WP-B1.1/2/3, WP-D1 item 2)
// ---------------------------------------------------------------------------

describe("IF-CASCADE-FRUSTUM — shadow view 1 culls against Cascade 0's OWN frustum", () => {
  it("main frustum excludes the field (0 commands) while Cascade 0 keeps a strict subset (24<64)", () => {
    // Main looks +Z (away from the field at z in [0,80]): reachable but frustum-excluded.
    const field = makeGlField(4, 1_000_000);
    field.prepareMainView(
      perspectiveVP(MAIN_CAM_AWAY, 1, 0.1, 10000),
      { x: MAIN_CAM_AWAY.eye[0], y: MAIN_CAM_AWAY.eye[1], z: MAIN_CAM_AWAY.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    expect(commandCells(collectCommands(field, 0)), "main must see nothing").toHaveLength(0);

    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, DISCRIMINATOR_BOX);
    field.prepareShadowView(1, vp);
    field.cullShadowView(1);
    const view1 = commandCells(collectCommands(field, 1));
    // Fixture sanity: the discriminator volume must keep a strict subset (0 < n < 64), otherwise
    // the frustum-gate proof is vacuous (all-or-nothing).
    const kept = new Array<number>(FIELD_CELL_COUNT);
    for (let c = 0; c < FIELD_CELL_COUNT; c++) kept[c] = c;
    const keptFiltered = kept.filter((c) => cascadeKeepsCell(vp, c));
    expect(keptFiltered.length).toBeGreaterThan(0);
    expect(keptFiltered.length).toBeLessThan(FIELD_CELL_COUNT);
    // The emissions of view 1 MUST equal the cells its own frustum keeps — a regression to
    // reusing View 0's main-command list (0 cells) or to the main frustum (wrong set) fails.
    expect(new Set(view1)).toEqual(new Set(keptFiltered));
    expect(view1.length).toBe(keptFiltered.length);
  });

  it("full-box cascade: every main-kept cell AND every cascade-kept cell are emitted, no extras", () => {
    const field = mainCam();
    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);
    field.prepareShadowView(1, vp);
    field.cullShadowView(1);
    const view1 = new Set(commandCells(collectCommands(field, 1)));
    expect(view1.size).toBe(FIELD_CELL_COUNT);
    const mainVisible = new Set(commandCells(collectCommands(field, 0)));
    expect(mainVisible.size).toBeGreaterThan(0);
    // The cascade view is a superset of the main-visible cells (main-anchored reach), never a
    // partial main-command replay.
    for (const cell of mainVisible)
      expect(view1.has(cell), `main cell ${cell} in cascade`).toBe(true);
  });
});

describe("IF-MAIN-ANCHORED-REACH — 200 m cascade pullback with maxCullRadius=100 never distance-culls", () => {
  it("view 1 is identical under maxCullRadius 100 vs 1e6 (the cascade camera 200 m away changes nothing)", () => {
    // WP-B1.2 root cause: the OLD lane measured the reachable prefilter against the SHADOW
    // camera position (200 m behind its box), dropping 100% of every cascade under a
    // maxCullRadius=100 budget. The fix anchors reachability to the main camera.
    const build = (radius: number): number[] => {
      const field = makeGlField(4, radius);
      field.prepareMainView(
        perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
        { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
        MAIN_VIEWPORT_HEIGHT_PX,
        MAIN_FOV_RADIANS_Y,
      );
      field.cullMainView();
      const mainCells = commandCells(collectCommands(field, 0));
      const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);
      field.prepareShadowView(1, vp);
      field.cullShadowView(1);
      return { mainCells, view1: commandCells(collectCommands(field, 1)) }.view1;
    };
    const tight = build(100);
    const huge = build(1_000_000);
    expect(tight.length, "not distance-culled to zero under a 100 m radius").toBeGreaterThan(0);
    expect(tight, "maxCullRadius must not change the cascade view (main-anchored reach)").toEqual(
      huge,
    );
  });

  it("every near-main main-visible cell survives into Cascade 0 (no false negative from the pullback)", () => {
    const field = makeGlField(4, 100);
    field.prepareMainView(
      perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    const mainCells = commandCells(collectCommands(field, 0));
    expect(mainCells.length).toBeGreaterThan(0);
    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);
    field.prepareShadowView(1, vp);
    field.cullShadowView(1);
    const view1 = new Set(commandCells(collectCommands(field, 1)));
    for (const cell of mainCells) {
      const cc = cellCenterOf(cell);
      const dist = Math.hypot(
        cc[0] - MAIN_CAM.eye[0],
        cc[1] - MAIN_CAM.eye[1],
        cc[2] - MAIN_CAM.eye[2],
      );
      if (dist < 60) {
        expect(
          view1.has(cell),
          `near-main cell ${cell} (${dist.toFixed(1)} m) survives the pullback`,
        ).toBe(true);
      }
    }
  });
});

describe("IF-SHADOW-VIEW-BUDGET — maxViews:1 produces no shadow view at all", () => {
  it("prepareShadowView(1)/cullShadowView(1) are no-ops and getSource(1) stays undefined", () => {
    const field = makeGlField(1, 1_000_000);
    field.prepareMainView(
      perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    expect(commandCells(collectCommands(field, 0)).length).toBeGreaterThan(0);
    expect(field.getSource(1), "no shadow view with maxViews:1").toBeUndefined();
    field.prepareShadowView(1, orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX));
    field.cullShadowView(1);
    expect(field.getSource(1)).toBeUndefined();
    // The main view is untouched by the shadow no-ops.
    expect(commandCells(collectCommands(field, 0)).length).toBeGreaterThan(0);
  });
});

describe("IF-LOD-BIAS-COARSE — shadowLodBias shifts bucket to max(0, b - bias), never finer", () => {
  it("bias 1: every shadow command bucket is the main-metric bucket or coarser, never b+1", () => {
    const field = makeGlField(4, 1_000_000, 1);
    field.prepareMainView(
      perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);
    field.prepareShadowView(1, vp);
    field.cullShadowView(1);
    const shadow = collectCommands(field, 1);
    expect(shadow.length).toBeGreaterThan(0);
    let coarsened = 0;
    for (const cmd of shadow) {
      for (let k = 0; k < cmd.instanceCount; k++) {
        const cell = cmd.instanceBase + k;
        const mainBucket = mainMetricBucket(cell);
        expect(cmd.bucketIndex, `cell ${cell}`).toBeLessThanOrEqual(mainBucket);
        if (cmd.bucketIndex < mainBucket) coarsened++;
        // The fixed rule is exactly max(0, b - 1); finer (`b + 1`) would fail <=.
      }
    }
    // The fixture must actually exercise a legit coarsening (main bucket >= 1 somewhere).
    const fineCells = commandCells(shadow).filter((c) => mainMetricBucket(c) >= 1);
    expect(
      fineCells.length,
      "fixture must contain main-fine cells for the bias to bite",
    ).toBeGreaterThan(0);
    expect(coarsened, "a real b -> max(0, b-1) coarsening must be observed").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §4 Renderer-level view-index allocation (`AbstractWebGLRenderer._drawFieldShadowView`)
// ---------------------------------------------------------------------------

/** Minimal structural `AbstractWebGLRenderer` subclass; records every CPU-source draw. */
class TestIFGLRenderer extends AbstractWebGLRenderer {
  public override readonly type: RendererType = RendererType.WEB_GL2;
  public readonly drew: {
    field: InstanceFieldGL;
    source: CpuIndirectDrawSource;
    pass: InstanceFieldDrawPass;
    shaderId: string | undefined;
  }[] = [];

  public override async initialize(): Promise<void> {}
  public override setSize(): void {}
  public install(canvas: HTMLCanvasElement): void {
    this.installContextLossHandling(canvas);
  }
  public uninstall(): void {
    this.uninstallContextLossHandling();
  }
  protected override onContextRestored(): void {}
  public override setRenderTarget(): void {}
  public override renderBatch(): void {}
  protected override releaseObjectResources(): void {}
  public override resetStateCache(): void {}
  public override get isOffscreenRenderTarget(): boolean {
    return false;
  }
  public override bindMainRenderTarget(): boolean {
    return true;
  }
  public override bindPostProcessRenderTarget(): void {}
  public override copyToOpaqueTexture(): void {}
  public override copyToOpaqueDepthTexture(): void {}
  public override flushPostProcess(): void {}
  protected override _drawCpuIndirectSource(
    field: InstanceFieldGL,
    source: CpuIndirectDrawSource,
    pass: InstanceFieldDrawPass,
    ctx: InstanceFieldDrawContext = {},
  ): void {
    this.drew.push({ field, source, pass, shaderId: ctx.shaderId });
  }

  /** Public wrapper around the protected per-shadow-view entry point under test. */
  public shadowDraw(
    shaderId: string,
    vp: Float32Array,
    pass: InstanceFieldDrawPass,
    reuseView?: number,
  ): void {
    this._drawFieldShadowView(shaderId, vp, pass, reuseView);
  }

  /** Records how often a specific field/source pair was drawn by the shadow hook. */
  public drawCount(pred: (d: (typeof this.drew)[number]) => boolean): number {
    return this.drew.filter(pred).length;
  }
}

describe("IF-SHADOW-VIEW-INDEX — renderer shadow-view allocation starts at 1, main slot 0 untouched", () => {
  it("the first shadow draw culls and draws view 1 (never view 0 / the main command list)", () => {
    const field = mainCam();
    // Main slot 0 holds a valid, revision-pinned command list before any shadow draw.
    const mainRevision = field.getSource(0)!.revision;
    const mainCount = commandCells(collectCommands(field, 0)).length;
    expect(mainCount).toBeGreaterThan(0);

    const renderer = new TestIFGLRenderer();
    renderer.registerInstanceField(field);
    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);
    renderer.shadowDraw("depth-prog", vp, "shadow");

    // The shadow draw consumed slot 1 (cascade-culled), NOT slot 0 (the main source).
    expect(renderer.drawCount(() => true)).toBe(1);
    expect(renderer.drew[0]!.source).toBe(field.getSource(1));
    expect(renderer.drew[0]!.source).not.toBe(field.getSource(0));
    expect(renderer.drew[0]!.pass).toBe("shadow");
    // Slot 0 is untouched: same revision, same main command list.
    expect(field.getSource(0)!.revision).toBe(mainRevision);
    expect(commandCells(collectCommands(field, 0))).toHaveLength(mainCount);
    // The shadow source carries real cascade-culled commands.
    expect(commandCells(collectCommands(field, 1)).length).toBeGreaterThan(0);
  });

  it("each further shadow draw advances to the next slot (1, 2, ...) without reusing slots", () => {
    const field = mainCam();
    const renderer = new TestIFGLRenderer();
    renderer.registerInstanceField(field);
    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);
    renderer.shadowDraw("cascade0", vp, "shadow");
    expect(renderer.drew[0]!.source).toBe(field.getSource(1));
    renderer.shadowDraw("cascade1", vp, "shadow");
    expect(renderer.drew[1]!.source).toBe(field.getSource(2));
    renderer.shadowDraw("cascade2", vp, "shadow");
    expect(renderer.drew[2]!.source).toBe(field.getSource(3));
    expect(commandCells(collectCommands(field, 2)).length).toBeGreaterThan(0);
    expect(commandCells(collectCommands(field, 3)).length).toBeGreaterThan(0);
  });

  it("a field with maxViews:1 is skipped entirely by the shadow hook (0 shadow draws)", () => {
    const field = makeGlField(1, 1_000_000);
    field.prepareMainView(
      perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    const renderer = new TestIFGLRenderer();
    renderer.registerInstanceField(field);
    renderer.shadowDraw("depth-prog", orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX), "shadow");
    expect(renderer.drawCount(() => true)).toBe(0);
    expect(field.getSource(1)).toBeUndefined();
  });
});

describe("IF-SHADOW-REUSE — EVSM moment redraws replay an already-culled slot without consuming budget", () => {
  it("reuseView=1 redraws slot 1 (unchanged revision) and does not advance the allocation", () => {
    const field = makeGlField(3, 1_000_000); // tight budget: exactly 2 shadow views
    field.prepareMainView(
      perspectiveVP(MAIN_CAM, 1, 0.1, 10000),
      { x: MAIN_CAM.eye[0], y: MAIN_CAM.eye[1], z: MAIN_CAM.eye[2] },
      MAIN_VIEWPORT_HEIGHT_PX,
      MAIN_FOV_RADIANS_Y,
    );
    field.cullMainView();
    const renderer = new TestIFGLRenderer();
    renderer.registerInstanceField(field);
    const vp = orthoVP(CASCADE_EYE, CASCADE_TARGET, FULL_BOX);

    // Depth passes: cascade 0 -> slot 1, cascade 1 -> slot 2 (budget now exhausted).
    renderer.shadowDraw("cascade0", vp, "shadow");
    renderer.shadowDraw("cascade1", vp, "shadow");
    expect(renderer.drawCount(() => true)).toBe(2);
    const rev1 = field.getSource(1)!.revision;

    // EVSM redraw of cascade 0 WITHOUT re-culling and WITHOUT consuming a slot.
    renderer.shadowDraw("evsm0", vp, "evsm", 1);
    expect(
      renderer.drawCount(() => true),
      "reuse must still draw",
    ).toBe(3);
    expect(renderer.drew[2]!.source).toBe(field.getSource(1));
    expect(renderer.drew[2]!.pass).toBe("evsm");
    expect(field.getSource(1)!.revision, "reuse must NOT re-cull slot 1").toBe(rev1);

    // Budget was NOT consumed by the reuse: a third depth cascade WOULD be skipped (maxViews 3 /
    // slots 1..2 already used), proving slots were not leaked by EVSM redraws.
    renderer.shadowDraw("cascade2", vp, "shadow");
    expect(
      renderer.drawCount(() => true),
      "no slot left -> cascade 2 skipped",
    ).toBe(3);
  });
});
