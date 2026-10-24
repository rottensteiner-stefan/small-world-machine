import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import type { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
import { Topology } from "../../src/enums/index.js";
import { GPUObjectRingBuffer } from "../../src/renderers/WebGPU/managers/GPUObjectRingBuffer.js";
import { GPUInstanceRingBuffer } from "../../src/renderers/WebGPU/managers/GPUInstanceRingBuffer.js";

(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

const manifest: RenderManifest = { shaderId: "test", properties: {}, textures: {} };

function makeDrawRenderer(): {
  renderer: RendererInternals;
  writeBuffer: ReturnType<typeof vi.fn>;
  rp: Record<string, ReturnType<typeof vi.fn>>;
} {
  const renderer = new WebGPURenderer() as RendererInternals;
  const writeBuffer = vi.fn();
  renderer._device = {
    createBuffer: vi.fn(() => ({ size: 1 << 20, destroy: vi.fn() })),
    queue: { writeBuffer },
  };
  renderer._pipelineCache = {
    getPipeline: vi.fn(() => ({ pipeline: {}, bgLayouts: [{}, {}], key: "k" })),
    pipelineCacheKey: vi.fn(() => {
      throw new Error("the subgroup must reuse the entry's key, not recompute it");
    }),
    acquirePipeline: vi.fn(),
  };
  renderer._textures = { acquireTextures: vi.fn() };
  const geoCache = { vertexCount: 8, vb: {}, format: "uint16" };
  renderer._geometryCache = { getGeoCache: vi.fn(() => geoCache) };
  renderer._fallback = {
    ensureDummyBufferSize: vi.fn(),
    dummyNormalBuffer: {},
    dummyUvBuffer: {},
    dummyTangentBuffer: {},
    dummyJointsBuffer: {},
    dummyWeightsBuffer: {},
    dummyColorBuffer: {},
    deferDestroyBuffer: vi.fn(),
  };
  renderer._objectRing = { bindGroup: {} };
  renderer._viewBindGroup = {};
  renderer._getObjectSlotOffset = vi.fn(() => 0);
  renderer._getMaterialBindGroup = vi.fn(() => ({}));
  const rp = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    setIndexBuffer: vi.fn(),
    drawIndexed: vi.fn(),
    draw: vi.fn(),
  };
  return { renderer, writeBuffer, rp };
}

describe("WebGPURenderer._renderSubgroup: instance upload (K7)", () => {
  function draw(renderer: RendererInternals, rp: unknown, mesh: InstancedMesh): void {
    renderer._renderSubgroup(
      rp as GPURenderPassEncoder,
      [mesh],
      true,
      "mat",
      manifest,
      0,
      undefined,
      Topology.TRIANGLE_LIST,
    );
  }

  it("uploads instanceCount * 16 floats, not the whole capacity, and only when needed", () => {
    const { renderer, writeBuffer, rp } = makeDrawRenderer();
    const mesh = new InstancedMesh("m", new Cube().getGeometryData(), new BasicMaterial(), 10);
    mesh.instanceCount = 3;

    draw(renderer, rp, mesh);
    expect(writeBuffer).toHaveBeenCalledTimes(1);
    expect(writeBuffer).toHaveBeenLastCalledWith(
      expect.anything(),
      0,
      mesh.instanceMatrices,
      0,
      3 * 16,
    );

    draw(renderer, rp, mesh); // nothing changed
    expect(writeBuffer).toHaveBeenCalledTimes(1);

    // instanceCount is a plain field: growing it inside the capacity must expose the new tail.
    mesh.instanceCount = 6;
    draw(renderer, rp, mesh);
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer).toHaveBeenLastCalledWith(
      expect.anything(),
      0,
      mesh.instanceMatrices,
      0,
      6 * 16,
    );
  });
});

describe("WebGPURenderer._renderSubgroup: per-draw state (A5/K6)", () => {
  it("binds shared geometry once for consecutive objects and reuses the cached pipeline key", () => {
    const { renderer, rp } = makeDrawRenderer();
    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const objs = ["a", "b", "c"].map((name) => {
      const o = new Object3D(name);
      o.geometry = geo;
      o.material = mat;
      return o;
    });

    renderer._renderSubgroup(
      rp as unknown as GPURenderPassEncoder,
      objs,
      false,
      mat.uuid,
      manifest,
      0,
      undefined,
      Topology.TRIANGLE_LIST,
    );

    expect(rp["setVertexBuffer"]).toHaveBeenCalledTimes(6); // slots 0-5 once, not once per object
    expect(rp["draw"]).toHaveBeenCalledTimes(3);
    expect(renderer._pipelineCache.acquirePipeline).toHaveBeenCalledWith(objs[0], "k");
  });
});

describe("WebGPURenderer._renderSubgroup: automatic instancing (ADR 0046)", () => {
  function setup(count: number): {
    renderer: RendererInternals;
    rp: Record<string, ReturnType<typeof vi.fn>>;
    objs: Object3D[];
    mat: BasicMaterial;
  } {
    const { renderer, rp } = makeDrawRenderer();
    renderer._instanceRing = new GPUInstanceRingBuffer(renderer._device as GPUDevice);
    renderer._objectRing = {
      bindGroup: {},
      acquireObjectSlot: vi.fn(() => 512),
      lastAcquireCached: false,
      write: vi.fn(),
    };
    renderer._packObjectUniforms = vi.fn(() => true);
    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const objs = Array.from({ length: count }, (_, i) => {
      const o = new Object3D(`o${i}`);
      o.geometry = geo;
      o.material = mat;
      o.setPosition(i, 0, 0);
      o.updateMatrixWorld(true);
      return o;
    });
    return { renderer, rp, objs, mat };
  }

  function drawAll(
    renderer: RendererInternals,
    rp: unknown,
    objs: Object3D[],
    mat: BasicMaterial,
  ): void {
    renderer._renderSubgroup(
      rp as GPURenderPassEncoder,
      objs,
      false,
      mat.uuid,
      manifest,
      0,
      undefined,
      Topology.TRIANGLE_LIST,
    );
  }

  it("draws a same-geometry run as one instanced draw with the world matrices as instances", () => {
    const { renderer, rp, objs, mat } = setup(6);

    drawAll(renderer, rp, objs, mat);

    expect(rp["draw"]).toHaveBeenCalledTimes(1);
    expect(rp["draw"]).toHaveBeenCalledWith(8, 6);
    expect(
      renderer._pipelineCache.getPipeline.mock.calls.some((c: unknown[]) => c[2] === true),
    ).toBe(true);
    expect(rp["setVertexBuffer"]).toHaveBeenCalledWith(6, renderer._instanceRing.buffer, 0, 6 * 64);
    // One shared object slot with an identity model matrix, never a per-object slot.
    expect(renderer._packObjectUniforms).toHaveBeenCalledWith(objs[0], manifest, undefined, true);
    expect(renderer._getObjectSlotOffset).not.toHaveBeenCalled();
    // Lifecycle bookkeeping still runs per object.
    expect(renderer._pipelineCache.acquirePipeline).toHaveBeenCalledTimes(6);
    expect(renderer._geometryCache.getGeoCache).toHaveBeenCalledTimes(6);
    const upload = renderer._device.queue.writeBuffer.mock.calls.at(-1)!;
    expect(Array.from((upload[2] as Float32Array).subarray(16 + 12, 16 + 15))).toEqual([1, 0, 0]);
  });

  it("keeps per-object draws when quality.autoInstancing is false", () => {
    const { renderer, rp, objs, mat } = setup(6);
    renderer._quality = { ...renderer._quality, autoInstancing: false };

    drawAll(renderer, rp, objs, mat);

    expect(rp["draw"]).toHaveBeenCalledTimes(6);
  });
});

describe("WebGPURenderer: depth view, setSize and material bind groups", () => {
  function makeSizedRenderer(): {
    renderer: RendererInternals;
    createTexture: ReturnType<typeof vi.fn>;
  } {
    (globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio = 1;
    const renderer = new WebGPURenderer() as RendererInternals;
    const createTexture = vi.fn((d: { size: number[] }) => ({
      width: d.size[0],
      height: d.size[1],
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    }));
    renderer._device = {
      createTexture,
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      limits: {},
    };
    renderer._context = { canvas: { width: 0, height: 0, style: {} } };
    renderer._fallback = {
      drainPendingDestroy: vi.fn(),
      deferDestroyTexture: vi.fn(),
      deferDestroyBuffer: vi.fn(),
    };
    return { renderer, createTexture };
  }

  it("returns one stable depth view instead of a fresh createView() per access", () => {
    const { renderer } = makeSizedRenderer();
    renderer.setSize(640, 360);
    expect(renderer.activeDepthView).toBe(renderer.activeDepthView);
  });

  it("does not reallocate the size-dependent textures when the size is unchanged", () => {
    const { renderer, createTexture } = makeSizedRenderer();
    renderer.setSize(640, 360);
    const callsAfterFirst = createTexture.mock.calls.length;
    const view = renderer.activeDepthView;

    renderer.setSize(640, 360);
    expect(createTexture.mock.calls.length).toBe(callsAfterFirst);
    expect(renderer.activeDepthView).toBe(view);

    renderer.setSize(800, 450);
    expect(createTexture.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(renderer.activeDepthView).not.toBe(view);
  });

  it("hands the HZB system the screen depth view even while an offscreen target is active", () => {
    const { renderer } = makeSizedRenderer();
    const resize = vi.fn();
    renderer._hzbSystem = { resize };
    const offscreenDepthView = {};
    renderer._targetCache = { depthView: vi.fn(() => offscreenDepthView) };
    renderer._activeRenderTarget = {};

    renderer.setSize(640, 360);

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize.mock.calls[0]![2]).not.toBe(offscreenDepthView);
    expect(resize.mock.calls[0]![2]).toBe(renderer._depthTextureView);
  });

  it("material bind group: a hit allocates no new group, idle entries are swept", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    const createBindGroup = vi.fn(() => ({}));
    renderer._device = { createBindGroup };
    const stable = {};
    renderer._textures = {
      getSampler: vi.fn(() => stable),
      getNormalTextureView: vi.fn(() => stable),
      getCubeTextureView: vi.fn(() => stable),
      getTextureView: vi.fn(() => stable),
    };
    renderer._frameCount = 10;

    const first = renderer._getMaterialBindGroup("mat", manifest, {});
    const second = renderer._getMaterialBindGroup("mat", manifest, {});
    expect(second).toBe(first);
    expect(createBindGroup).toHaveBeenCalledTimes(1);

    renderer._materialBindGroups.set("dead", { bg: {}, resources: [], lastUsedFrame: 0 });
    renderer._frameCount = 2000;
    renderer._getMaterialBindGroup("mat", manifest, {}); // refreshes lastUsedFrame of "mat"
    renderer._sweepMaterialBindGroups();
    expect(renderer._materialBindGroups.has("dead")).toBe(false);
    expect(renderer._materialBindGroups.has("mat")).toBe(true);
  });
});

describe("GPUObjectRingBuffer.acquireObjectSlot", () => {
  function makeRing(): GPUObjectRingBuffer {
    const device = {
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() },
      limits: { minUniformBufferOffsetAlignment: 256 },
    } as unknown as GPUDevice;
    return new GPUObjectRingBuffer(device, {} as GPUBindGroupLayout, 2);
  }

  it("dedupes per (object, material) within a frame without building key strings", () => {
    const ring = makeRing();
    const objA = {};
    const objB = {};
    ring.beginFrame();
    const a1 = ring.acquireObjectSlot(objA, "depth");
    expect(ring.lastAcquireCached).toBe(false);
    expect(ring.acquireObjectSlot(objA, "depth")).toBe(a1);
    expect(ring.lastAcquireCached).toBe(true);
    const aMain = ring.acquireObjectSlot(objA, "main");
    expect(aMain).not.toBe(a1);
    expect(ring.lastAcquireCached).toBe(false);
    expect(ring.acquireObjectSlot(objB, "depth")).not.toBe(a1);
  });

  it("forgets everything on the next frame and never dedupes an undefined object (sprites)", () => {
    const ring = makeRing();
    const obj = {};
    ring.beginFrame();
    ring.acquireObjectSlot(obj, "m");
    ring.acquireObjectSlot(undefined, "m");
    expect(ring.lastAcquireCached).toBe(false);
    ring.acquireObjectSlot(undefined, "m");
    expect(ring.lastAcquireCached).toBe(false);

    ring.endFrame();
    ring.beginFrame();
    ring.acquireObjectSlot(obj, "m");
    expect(ring.lastAcquireCached).toBe(false);
  });

  it("does not hand out offsets of the replaced buffer after a mid-frame growth", () => {
    const ring = makeRing();
    const obj = {};
    ring.beginFrame();
    // capacity is at least the default; force a spike beyond it
    const cap = ring.capacity;
    const first = ring.acquireObjectSlot(obj, "m");
    for (let i = 0; i < cap; i++) ring.acquireObjectSlot({}, "x");
    expect(ring.capacity).toBeGreaterThan(cap);
    const again = ring.acquireObjectSlot(obj, "m");
    expect(ring.lastAcquireCached).toBe(false);
    expect(again).not.toBe(first);
  });
});
