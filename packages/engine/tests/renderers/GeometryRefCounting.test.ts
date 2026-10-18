import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGLBufferManager } from "../../src/renderers/gl/managers/WebGLBufferManager.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Scene } from "../../src/core/Scene.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

function makeMockGl(): WebGL2RenderingContext {
  let bufferId = 0;
  return {
    createBuffer: vi.fn(() => ({ id: bufferId++ })),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    ARRAY_BUFFER: 1,
    ELEMENT_ARRAY_BUFFER: 2,
    STATIC_DRAW: 3,
    UNSIGNED_SHORT: 4,
    UNSIGNED_INT: 5,
  } as unknown as WebGL2RenderingContext;
}

function makeGeometry(): GeometryDataInterface {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    getBoundingVolume: (): never => {
      throw new Error("not used in this test");
    },
  };
}

describe("WebGLBufferManager reference counting", () => {
  it("creates a GPU mesh on first use and reuses it for a second object sharing the geometry", () => {
    const gl = makeMockGl();
    const buffers = new WebGLBufferManager(gl);

    const geo = makeGeometry();
    const objA = new Object3D("A");
    const objB = new Object3D("B");

    const meshA = buffers.getOrCreateMesh(objA, geo);
    expect(gl.createBuffer).toHaveBeenCalledTimes(1);
    expect(meshA.refCount).toBe(1);

    const meshB = buffers.getOrCreateMesh(objB, geo);
    expect(meshB).toBe(meshA);
    // No second GPU buffer was created for the shared geometry.
    expect(gl.createBuffer).toHaveBeenCalledTimes(1);
    expect(meshA.refCount).toBe(2);
  });

  it("does not delete the shared buffer while another object still references it", () => {
    const gl = makeMockGl();
    const buffers = new WebGLBufferManager(gl);

    const geo = makeGeometry();
    const objA = new Object3D("A");
    const objB = new Object3D("B");

    buffers.getOrCreateMesh(objA, geo);
    buffers.getOrCreateMesh(objB, geo);

    buffers.releaseGeometryFor(objA);
    expect(gl.deleteBuffer).not.toHaveBeenCalled();

    buffers.releaseGeometryFor(objB);
    expect(gl.deleteBuffer).toHaveBeenCalled();
  });

  it("releases the old geometry and acquires the new one when an object's geometry is reassigned at runtime", () => {
    const gl = makeMockGl();
    const buffers = new WebGLBufferManager(gl);

    const geoA = makeGeometry();
    const geoB = makeGeometry();
    const obj = new Object3D("Swappable");

    const meshA = buffers.getOrCreateMesh(obj, geoA);
    expect(meshA.refCount).toBe(1);

    // Simulate `obj.material = newMaterial`-style live reassignment: same object,
    // new geometry, still attached to the scene -- no explicit release call.
    const meshB = buffers.getOrCreateMesh(obj, geoB);
    expect(meshB.refCount).toBe(1);
    expect(meshA.refCount).toBe(0);
    expect(gl.deleteBuffer).toHaveBeenCalled(); // geoA's buffers were freed
  });

  it("releases geometry via the Scene removal queue when an object is fully removed", () => {
    const gl = makeMockGl();
    const buffers = new WebGLBufferManager(gl);

    const scene = new Scene();
    const geo = makeGeometry();
    const obj = new Object3D("Removable");
    obj.geometry = geo;
    scene.add(obj);

    const mesh = buffers.getOrCreateMesh(obj, geo);
    expect(mesh.refCount).toBe(1);

    scene.remove(obj);
    for (const removed of scene.consumeRemovedObjects()) {
      buffers.releaseGeometryFor(removed);
    }

    expect(mesh.refCount).toBe(0);
    expect(gl.deleteBuffer).toHaveBeenCalled();
  });

  it("releases geometry for an object routed in from an unrelated, scene-detached parent (Maker's trash-bin discard pattern)", () => {
    // Mirrors MakerApp._disposeTrashedObject(): an object soft-deleted into an off-scene holding
    // pen (never added to `scene`, so `remove()` on it alone would never fire the GPU-disposal
    // notification) that must now be permanently freed -- briefly reparenting it into the real
    // scene via `add()` (which detaches it from its unrelated old parent) then immediately
    // `remove()`-ing it is the only way to route it through the real disposal queue.
    const gl = makeMockGl();
    const buffers = new WebGLBufferManager(gl);

    const scene = new Scene();
    const trashBin = new Object3D("Trash"); // deliberately never added to `scene`
    const geo = makeGeometry();
    const obj = new Object3D("SoftDeleted");
    obj.geometry = geo;
    trashBin.add(obj);

    const mesh = buffers.getOrCreateMesh(obj, geo);
    expect(mesh.refCount).toBe(1);

    scene.add(obj);
    scene.remove(obj);
    for (const removed of scene.consumeRemovedObjects()) {
      buffers.releaseGeometryFor(removed);
    }

    expect(mesh.refCount).toBe(0);
    expect(gl.deleteBuffer).toHaveBeenCalled();
    expect(obj.parent).toBeUndefined();
  });

  it("also releases descendants when a parent with children is removed from the scene", () => {
    const gl = makeMockGl();
    const buffers = new WebGLBufferManager(gl);

    const scene = new Scene();
    const parentGeo = makeGeometry();
    const childGeo = makeGeometry();

    const parent = new Object3D("Parent");
    parent.geometry = parentGeo;
    const child = new Object3D("Child");
    child.geometry = childGeo;
    parent.add(child);
    scene.add(parent);

    const parentMesh = buffers.getOrCreateMesh(parent, parentGeo);
    const childMesh = buffers.getOrCreateMesh(child, childGeo);

    scene.remove(parent);
    for (const removed of scene.consumeRemovedObjects()) {
      buffers.releaseGeometryFor(removed);
    }

    expect(parentMesh.refCount).toBe(0);
    expect(childMesh.refCount).toBe(0);
  });
});
