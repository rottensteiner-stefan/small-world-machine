import "../../src/index.js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { GPUObjectRingBuffer } from "../../src/renderers/WebGPU/managers/GPUObjectRingBuffer.js";
import { GPUGeometryCache } from "../../src/renderers/WebGPU/managers/GPUGeometryCache.js";
import { Object3D } from "../../src/core/Object3D.js";
import { SkinnedMesh, Skeleton, Bone } from "../../src/core/animation/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
import { StandardWebGPULayout } from "../../src/renderers/shaders/StandardWebGPULayout.js";
import { ModelGeometry } from "../../src/geometry/ModelGeometry.js";

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
  let bufferId = 0;
  return {
    createBuffer: vi.fn(() => ({
      id: bufferId++,
      destroy: vi.fn(),
      getMappedRange: vi.fn(() => new ArrayBuffer(1024)),
      unmap: vi.fn(),
    })),
    createBindGroup: vi.fn((desc: unknown) => ({ desc })),
    queue: { writeBuffer: vi.fn() },
    limits: { minUniformBufferOffsetAlignment: 256 },
  } as unknown as GPUDevice;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

const SHADER_ID = "test/skinning-shader";

function registerTestShader(): void {
  ShaderRegistry.instance.register({
    id: SHADER_ID,
    sources: {},
    layout: StandardWebGPULayout,
  });
}

function makeManifest(overrides?: Partial<RenderManifest>): RenderManifest {
  return {
    shaderId: SHADER_ID,
    properties: {},
    textures: {},
    ...overrides,
  };
}

function makeRenderer(): { renderer: RendererInternals; device: GPUDevice } {
  const device = makeMockDevice();
  const renderer = new WebGPURenderer() as RendererInternals;
  renderer._device = device;
  renderer._boneMatricesBuffer = device.createBuffer({ size: 1024 * 64, usage: 0x0080 | 0x0008 });
  renderer._objectBGL = { mock: "objectBGL" };
  renderer._objectRing = new GPUObjectRingBuffer(device, renderer._objectBGL);
  renderer._geometryCache = new GPUGeometryCache(device);
  return { renderer, device };
}

describe("WebGPU GPU Skinning", () => {
  beforeEach(() => registerTestShader());

  it("sets isSkinned = 0 and boneOffset = 0 for standard non-skinned Object3D", () => {
    const { renderer } = makeRenderer();
    const obj = new Object3D("StaticMesh");

    renderer._packObjectUniforms(obj, makeManifest());

    expect(renderer._scratchUniformValues["u_isSkinned"]).toBe(0.0);
    expect(renderer._scratchUniformValues["u_boneOffset"]).toBe(0.0);
  });

  it("sets isSkinned = 1 and uploads bone matrices for SkinnedMesh with Skeleton", () => {
    const { renderer, device } = makeRenderer();
    const skinnedMesh = new SkinnedMesh("Character");
    const bones = [new Bone("Root"), new Bone("Spine"), new Bone("Arm")];
    const skeleton = new Skeleton(bones);
    skinnedMesh.bind(skeleton);

    renderer._packObjectUniforms(skinnedMesh, makeManifest());

    expect(renderer._scratchUniformValues["u_isSkinned"]).toBe(1.0);
    expect(renderer._scratchUniformValues["u_boneOffset"]).toBe(0);
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(
      renderer._boneMatricesBuffer,
      0,
      skeleton.boneMatrices.buffer,
      skeleton.boneMatrices.byteOffset,
      bones.length * 16 * 4,
    );
  });

  it("allocates successive bone offsets for distinct SkinnedMeshes and dedupes within a frame", () => {
    const { renderer } = makeRenderer();
    const mesh1 = new SkinnedMesh("Char1");
    mesh1.bind(new Skeleton([new Bone("B1"), new Bone("B2")]));

    const mesh2 = new SkinnedMesh("Char2");
    mesh2.bind(new Skeleton([new Bone("B1"), new Bone("B2"), new Bone("B3")]));

    const offset1A = renderer._getBoneMatrixOffset(mesh1);
    const offset1B = renderer._getBoneMatrixOffset(mesh1);
    const offset2 = renderer._getBoneMatrixOffset(mesh2);

    expect(offset1A).toBe(0);
    expect(offset1B).toBe(0);
    expect(offset2).toBe(2);
  });

  it("throws when bone matrices exceed capacity limit of 2048", () => {
    const { renderer } = makeRenderer();
    renderer._gpuBoneMatricesOffset = 2040;
    const mesh = new SkinnedMesh("OverflowChar");
    const bones = Array.from({ length: 10 }, (_, i) => new Bone(`B${i}`));
    mesh.bind(new Skeleton(bones));

    expect(() => renderer._getBoneMatrixOffset(mesh)).toThrow(
      /Bone matrices buffer capacity exceeded/,
    );
  });

  it("creates jb and wb GPU buffers in GPUGeometryCache.getGeoCache when geometry has skinning joints and weights", () => {
    const { renderer, device } = makeRenderer();
    const geo = new ModelGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Float32Array([0, 0, 1, 0, 0, 1]),
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Uint16Array([0, 1, 2]),
      {
        joints: new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]),
        weights: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0]),
      },
    );

    const cache = renderer._geometryCache.getGeoCache(new Object3D(), geo.getGeometryData());

    expect(cache.jb).toBeDefined();
    expect(cache.wb).toBeDefined();
    expect(device.createBuffer).toHaveBeenCalled();
  });
});
