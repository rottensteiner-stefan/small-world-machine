import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { Topology } from "../../src/enums/index.js";
import { Vector3D } from "../../src/math/index.js";
import { partitionInstanceRuns } from "../../src/renderers/AutoInstancing.js";
import type { RenderBatch, Scene } from "../../src/core/Scene.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";

type Fn = ReturnType<typeof vi.fn>;

/**
 * Main opaque pass mock: everything below the partition/run decision is a counted stub, so the
 * A2 + `partitionInstanceRuns` logic runs real while the GL-leaf calls are swaps for counters.
 * `_renderInstanceRun` and `_renderStandardObject` are 1:1 draw-equivalents (each instanced run ->
 * one `drawElementsInstanced`-style call, each per-object rest -> one draw), mirroring the WebGPU
 * encoder counter in `WebGPURendererHotPath.test.ts.`
 */
interface Internals {
  gl: { useProgram: Fn; uniform1i: Fn; uniform4fv: Fn };
  _programCache: { getProgram: Fn; programCacheKey: Fn; acquireProgram: Fn };
  _textures: { acquireTextures: Fn };
  _bindDummyShadowMaps: Fn;
  _bindSpotShadowMaps: Fn;
  _bindDirectionalShadowMaps: Fn;
  _bindFogUniforms: Fn;
  _bindGlobalIblUniforms: Fn;
  _bindMaterialState: Fn;
  _bindGenericMaterialProperties: Fn;
  _bindSubgroupTextures: Fn;
  _renderInstanceRun: Fn;
  _renderStandardObject: Fn;
  _renderInstancedObject: Fn;
  _quality: { autoInstancing?: boolean };
  renderBatch: (
    batch: RenderBatch,
    vMat: Float32Array | undefined,
    _vp: Float32Array,
    _camPos: Vector3D,
    lights: LightDataInterface,
    scene: Scene,
  ) => void;
}

function setup(): { r: Internals; instancedRun: Fn; standardObject: Fn } {
  const r = new WebGL2Renderer() as unknown as Internals;
  r.gl = { useProgram: vi.fn(), uniform1i: vi.fn(), uniform4fv: vi.fn() };
  r._programCache = {
    getProgram: vi.fn(() => ({ prog: {}, uniforms: new Map(), writesNormalOutput: false })),
    programCacheKey: vi.fn(() => "k"),
    acquireProgram: vi.fn(),
  };
  r._textures = { acquireTextures: vi.fn() };
  r._bindDummyShadowMaps = vi.fn();
  r._bindSpotShadowMaps = vi.fn();
  r._bindDirectionalShadowMaps = vi.fn();
  r._bindFogUniforms = vi.fn();
  r._bindGlobalIblUniforms = vi.fn();
  r._bindMaterialState = vi.fn();
  r._bindGenericMaterialProperties = vi.fn();
  r._bindSubgroupTextures = vi.fn();
  const instancedRun = vi.fn();
  const standardObject = vi.fn();
  r._renderInstanceRun = instancedRun;
  r._renderStandardObject = standardObject;
  r._renderInstancedObject = vi.fn();
  return { r, instancedRun, standardObject };
}

function batch(objects: Object3D[]): RenderBatch {
  return { shaderId: "test", topology: Topology.TRIANGLE_LIST, matUuid: "m", objects };
}

/**
 * Two distinct geometries, same material, interleaved so no stretch of >= 4 identical geometries
 * exists -- the ADR 0046 "consecutive only" gap that A2 closes (parity with the WebGPU meter).
 */
function scattered12(): { objs: Object3D[] } {
  const a = new Cube().getGeometryData();
  const b = new Cube({ size: 2 }).getGeometryData();
  const mat = new BasicMaterial();
  const objs = Array.from({ length: 12 }, (_, i) => {
    const o = new Object3D(`o${i}`);
    o.geometry = i % 6 < 3 ? a : b;
    o.material = mat;
    return o;
  });
  return { objs };
}

describe("WebGL2Renderer.renderBatch: scattered geometry (ADR 0046 A2, WebGL2 parity)", () => {
  it("measures the A2 delta: 0 naive runs, but 2 instanced draws and 0 per-object draws with A2", () => {
    const { r, instancedRun, standardObject } = setup();
    const { objs } = scattered12();

    // Without gathering (ADR 0046 as shipped): no run of >=4 in the insertion order -> every
    // object would need its own draw (12), exactly the gap the report measured on WebGPU.
    const naive = { runObjects: [] as Object3D[], runs: [] as number[], rest: [] as Object3D[] };
    partitionInstanceRuns(objs, naive.runObjects, naive.runs, naive.rest, false);
    expect(naive.runs).toEqual([]);

    r.renderBatch(
      batch(objs),
      undefined,
      new Float32Array(16),
      new Vector3D(),
      {} as LightDataInterface,
      undefined as unknown as Scene,
    );

    // A2 groups by geometry: the 6 a's and the 6 b's become two runs -> one instanced draw each,
    // and no per-object draws at all (the rest is empty).
    expect(instancedRun).toHaveBeenCalledTimes(2);
    expect(instancedRun.mock.calls[0]![1]).toBe(0);
    expect(instancedRun.mock.calls[0]![2]).toBe(6);
    expect(instancedRun.mock.calls[1]![1]).toBe(6);
    expect(instancedRun.mock.calls[1]![2]).toBe(12);
    expect(standardObject).toHaveBeenCalledTimes(0);
  });

  it("falls back to 12 per-object draws when quality.autoInstancing is false", () => {
    const { r, instancedRun, standardObject } = setup();
    const { objs } = scattered12();
    r._quality = { ...r._quality, autoInstancing: false };

    r.renderBatch(
      batch(objs),
      undefined,
      new Float32Array(16),
      new Vector3D(),
      {} as LightDataInterface,
      undefined as unknown as Scene,
    );

    expect(instancedRun).toHaveBeenCalledTimes(0);
    expect(standardObject).toHaveBeenCalledTimes(12);
  });
});
