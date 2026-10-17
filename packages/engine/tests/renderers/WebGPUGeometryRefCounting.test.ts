import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUGeometryCache } from "../../src/renderers/WebGPU/managers/GPUGeometryCache.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Scene } from "../../src/core/Scene.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types,
// not a runtime value. Stub the bit-flag constants this class actually reads.
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

function makeMockDevice(): GPUDevice {
  const destroy = vi.fn();
  return {
    createBuffer: vi.fn(() => ({
      getMappedRange: () => new ArrayBuffer(64),
      unmap: vi.fn(),
      destroy,
    })),
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
}

function makeGeometry(): GeometryDataInterface {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    getBoundingVolume: (): never => {
      throw new Error("not used in this test");
    },
  };
}

describe("GPUGeometryCache reference counting", () => {
  it("creates GPU buffers on first use and reuses them for a second object sharing the geometry", () => {
    const device = makeMockDevice();
    const cache = new GPUGeometryCache(device);

    const geo = makeGeometry();
    const objA = new Object3D("A");
    const objB = new Object3D("B");

    const cacheA = cache.getGeoCache(objA, geo);
    expect(device.createBuffer).toHaveBeenCalledTimes(1);
    expect(cacheA.refCount).toBe(1);

    const cacheB = cache.getGeoCache(objB, geo);
    expect(cacheB).toBe(cacheA);
    expect(device.createBuffer).toHaveBeenCalledTimes(1);
    expect(cacheA.refCount).toBe(2);
  });

  it("does not destroy the shared buffer while another object still references it", () => {
    const device = makeMockDevice();
    const cache = new GPUGeometryCache(device);

    const geo = makeGeometry();
    const objA = new Object3D("A");
    const objB = new Object3D("B");

    const entry = cache.getGeoCache(objA, geo);
    cache.getGeoCache(objB, geo);

    cache.releaseGeometryFor(objA);
    expect(entry.vb.destroy).not.toHaveBeenCalled();

    cache.releaseGeometryFor(objB);
    expect(entry.vb.destroy).toHaveBeenCalled();
  });

  it("releases the old geometry and acquires the new one when an object's geometry is reassigned at runtime", () => {
    const device = makeMockDevice();
    const cache = new GPUGeometryCache(device);

    const geoA = makeGeometry();
    const geoB = makeGeometry();
    const obj = new Object3D("Swappable");

    const entryA = cache.getGeoCache(obj, geoA);
    expect(entryA.refCount).toBe(1);

    const entryB = cache.getGeoCache(obj, geoB);
    expect(entryB.refCount).toBe(1);
    expect(entryA.refCount).toBe(0);
    expect(entryA.vb.destroy).toHaveBeenCalled();
  });

  it("releases geometry via the Scene removal queue when drained", () => {
    const device = makeMockDevice();
    const cache = new GPUGeometryCache(device);

    const scene = new Scene();
    const geo = makeGeometry();
    const obj = new Object3D("Removable");
    obj.geometry = geo;
    scene.add(obj);

    const entry = cache.getGeoCache(obj, geo);
    expect(entry.refCount).toBe(1);

    scene.remove(obj);
    for (const removed of scene.consumeRemovedObjects()) {
      cache.releaseGeometryFor(removed);
    }

    expect(entry.refCount).toBe(0);
    expect(entry.vb.destroy).toHaveBeenCalled();
  });

  it("re-uploads normals and tangents (not just vertices) when needsUpdate is set, without recreating buffers", () => {
    const device = makeMockDevice();
    const cache = new GPUGeometryCache(device);

    const geo: GeometryDataInterface = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      tangents: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
      getBoundingVolume: (): never => {
        throw new Error("not used in this test");
      },
    };
    const obj = new Object3D("Tangented");

    const entry = cache.getGeoCache(obj, geo);
    expect(entry.nb).toBeDefined();
    expect(entry.tb).toBeDefined();
    vi.mocked(device.queue.writeBuffer).mockClear();
    vi.mocked(device.createBuffer).mockClear();

    geo.needsUpdate = true;
    const second = cache.getGeoCache(obj, geo);

    expect(second).toBe(entry);
    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(entry.vb, 0, geo.vertices);
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(entry.nb, 0, geo.normals);
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(entry.tb, 0, geo.tangents);
    expect(geo.needsUpdate).toBe(false);
  });

  it("dispose() destroys every buffer of every cached geometry entry, including joints/weights", () => {
    const device = makeMockDevice();
    const cache = new GPUGeometryCache(device);

    const geo: GeometryDataInterface = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      joints: new Float32Array([0, 0, 0, 0]),
      weights: new Float32Array([1, 0, 0, 0]),
      getBoundingVolume: (): never => {
        throw new Error("not used in this test");
      },
    };
    const entry = cache.getGeoCache(new Object3D("Skinned"), geo);
    expect(entry.jb).toBeDefined();
    expect(entry.wb).toBeDefined();

    cache.dispose();

    expect(entry.vb.destroy).toHaveBeenCalled();
    expect(entry.jb!.destroy).toHaveBeenCalled();
    expect(entry.wb!.destroy).toHaveBeenCalled();
  });
});
