import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

interface Internals {
  gl: { deleteBuffer: ReturnType<typeof vi.fn> };
  _instanceBuffers: WeakMap<InstancedMesh, WebGLBuffer>;
  _instanceBufferSizes: WeakMap<InstancedMesh, number>;
  _instanceDataBuffers: WeakMap<InstancedMesh, WebGLBuffer>;
  _instanceDataBufferSizes: WeakMap<InstancedMesh, number>;
  _instanceMatricesUploaded: WeakMap<InstancedMesh, number>;
  _instanceDataUploaded: WeakMap<InstancedMesh, number>;
  _geometry: { releaseGeometryFor: () => void };
  _programCache: { releaseObjectProgram: () => void };
  _textures: { releaseObjectTextures: () => void };
  releaseObjectResources(obj: InstancedMesh): void;
}

describe("WebGL2Renderer instance buffer release", () => {
  it("deletes the instance matrix and data GL buffers when an InstancedMesh is released", () => {
    const r = Object.create(WebGL2Renderer.prototype) as Internals;
    r.gl = { deleteBuffer: vi.fn() };
    r._instanceBuffers = new WeakMap();
    r._instanceBufferSizes = new WeakMap();
    r._instanceDataBuffers = new WeakMap();
    r._instanceDataBufferSizes = new WeakMap();
    r._instanceMatricesUploaded = new WeakMap();
    r._instanceDataUploaded = new WeakMap();
    r._geometry = { releaseGeometryFor: vi.fn() };
    r._programCache = { releaseObjectProgram: vi.fn() };
    r._textures = { releaseObjectTextures: vi.fn() };

    const mesh = new InstancedMesh(
      "inst",
      { vertices: new Float32Array(9) } as GeometryDataInterface,
      new BasicMaterial(),
      2,
    );
    const matrixBuf = { id: "m" } as unknown as WebGLBuffer;
    const dataBuf = { id: "d" } as unknown as WebGLBuffer;
    r._instanceBuffers.set(mesh, matrixBuf);
    r._instanceBufferSizes.set(mesh, 128);
    r._instanceDataBuffers.set(mesh, dataBuf);
    r._instanceDataBufferSizes.set(mesh, 32);

    r.releaseObjectResources(mesh);

    expect(r.gl.deleteBuffer).toHaveBeenCalledWith(matrixBuf);
    expect(r.gl.deleteBuffer).toHaveBeenCalledWith(dataBuf);
    expect(r._instanceBuffers.has(mesh)).toBe(false);
    expect(r._instanceBufferSizes.has(mesh)).toBe(false);
    expect(r._instanceDataBuffers.has(mesh)).toBe(false);
    expect(r._instanceDataBufferSizes.has(mesh)).toBe(false);
  });
});
