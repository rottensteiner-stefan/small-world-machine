import "../../src/index.js";
import { createDefaultRendererContext } from "../../src/interfaces/index.js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  WebGPURenderer,
  VIEW_SLOT_MAIN_CAMERA,
  VIEW_SLOT_CASCADE_BASE,
  VIEW_SLOT_SPOT_SHADOW_BASE,
} from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { GlobalUniformWriter } from "../../src/renderers/WebGPU/managers/GlobalUniformWriter.js";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUPipelineCache } from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { GPUObjectRingBuffer } from "../../src/renderers/WebGPU/managers/GPUObjectRingBuffer.js";
import { GPUGeometryCache } from "../../src/renderers/WebGPU/managers/GPUGeometryCache.js";
import { Object3D } from "../../src/core/Object3D.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import type { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";
import { Matrix4 } from "../../src/math/index.js";

const testShaderRegistry = new ShaderRegistry();

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types,
// not a runtime value. Stub the bit-flag constants this renderer actually reads.
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
(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

function makeMockDevice(): GPUDevice {
  return {
    createBuffer: vi.fn(() => ({
      destroy: vi.fn(),
      getMappedRange: () => new ArrayBuffer(256),
      unmap: vi.fn(),
    })),
    createBindGroup: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: () => Promise.resolve({ messages: [] }),
    })),
    createPipelineLayout: vi.fn((desc: { bindGroupLayouts: unknown[] }) => ({
      bindGroupLayouts: desc.bindGroupLayouts,
    })),
    createRenderPipeline: vi.fn((desc: { layout: { bindGroupLayouts: unknown[] } }) => ({
      layout: desc.layout,
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn(), copyExternalImageToTexture: vi.fn() },
    limits: { minUniformBufferOffsetAlignment: 256 },
  } as unknown as GPUDevice;
}

function makeRenderer(): { renderer: RendererInternals; device: GPUDevice } {
  const device = makeMockDevice();
  const renderer = new WebGPURenderer({
    ...createDefaultRendererContext(),
    shaderRegistry: testShaderRegistry,
  }) as RendererInternals;
  renderer._device = device;
  renderer._fallback = new GPUFallbackResources(device);
  renderer._textures = new GPUTextureResourceCache(device, renderer._fallback);
  renderer._globalBGL = { mock: "globalBGL" };
  renderer._objectBGL = { mock: "objectBGL" };
  renderer._viewBGL = { mock: "viewBGL" };
  renderer._pipelineCache = new GPUPipelineCache(
    device,
    renderer.context.deviceCaps,
    renderer._globalBGL,
    renderer._objectBGL,
    renderer._viewBGL,
    renderer.context.shaderRegistry,
  );
  renderer._objectRing = new GPUObjectRingBuffer(device, renderer._objectBGL);
  renderer._geometryCache = new GPUGeometryCache(device);
  renderer._viewUniformBuffer = { mock: "viewUniformBuffer" };
  renderer._viewBindGroup = { mock: "viewBindGroup" };
  renderer._viewUniformStride = 256;
  // Setup above (GPUFallbackResources construction) makes its own queue.writeBuffer/writeTexture
  // calls -- clear the mock history so call-count assertions below only see calls made by the
  // actual code under test.
  vi.mocked(device.queue.writeBuffer).mockClear();
  vi.mocked(device.queue.writeTexture).mockClear();
  return { renderer, device };
}

const SHADER_ID = "test/view-uniforms-shader";

function registerTestShader(): void {
  testShaderRegistry.register({
    id: SHADER_ID,
    sources: { wgsl: "@vertex fn vs() -> Out { var o: Out; return o; }" },
    layout: { uniforms: {}, uniformLayout: [], textures: {} },
  });
}

function makeManifest(): RenderManifest {
  return { shaderId: SHADER_ID, properties: {}, textures: {} };
}

function makeGeometry(): GeometryDataInterface {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    getBoundingVolume: (): never => {
      throw new Error("not used in this test");
    },
  };
}

describe("WebGPU per-draw view uniform buffer (group 3)", () => {
  beforeEach(() => registerTestShader());

  it("computes a ZO-corrected matrix and writes it at slot * stride", () => {
    const { renderer, device } = makeRenderer();
    const rawVp = new Float32Array(16);
    for (let i = 0; i < 16; i++) rawVp[i] = i + 1;

    const offset = renderer._setViewMatrix(VIEW_SLOT_CASCADE_BASE, rawVp);

    expect(offset).toBe(VIEW_SLOT_CASCADE_BASE * 256);
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(1);

    const raw = new Matrix4();
    raw.data.set(rawVp);
    const expected = new Matrix4();
    Matrix4.multiply(Matrix4.ZO_CORRECTION, raw, expected);

    const [buffer, writtenOffset, writtenData] = (
      device.queue.writeBuffer as ReturnType<typeof vi.fn>
    ).mock.calls[0]!;
    expect(buffer).toBe(renderer._viewUniformBuffer);
    expect(writtenOffset).toBe(VIEW_SLOT_CASCADE_BASE * 256);
    expect(Array.from(writtenData as Float32Array)).toEqual(Array.from(expected.data));
  });

  it("assigns non-overlapping slots for cascades and spot lights", () => {
    const { renderer } = makeRenderer();
    const vp = new Float32Array(16);

    const cascadeOffsets = [0, 1, 2, 3].map((i) =>
      renderer._setViewMatrix(VIEW_SLOT_CASCADE_BASE + i, vp),
    );
    const spotOffsets = [0, 1, 2, 3].map((j) =>
      renderer._setViewMatrix(VIEW_SLOT_SPOT_SHADOW_BASE + j, vp),
    );

    expect(new Set([...cascadeOffsets, ...spotOffsets]).size).toBe(8);
    expect(Math.min(...spotOffsets)).toBeGreaterThan(Math.max(...cascadeOffsets));
  });

  it("_renderSubgroup binds group 3 with the exact viewOffset passed in", () => {
    const { renderer } = makeRenderer();
    const obj = new Object3D("A");
    obj.geometry = makeGeometry();

    const rp = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      drawIndexed: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    const viewOffset = VIEW_SLOT_SPOT_SHADOW_BASE * 256;
    renderer._renderSubgroup(rp, [obj], false, "matA", makeManifest(), viewOffset);

    expect(rp.setBindGroup).toHaveBeenCalledWith(3, renderer._viewBindGroup, [viewOffset]);
  });

  it("_updateGlobalBuffers writes VIEW_SLOT_MAIN_CAMERA (offset 0) every call", () => {
    const { renderer, device } = makeRenderer();
    renderer._globalUniformWriter = new GlobalUniformWriter(renderer);
    const writer = renderer._globalUniformWriter;
    writer._globalUniformBuffer = { mock: "gub" };
    writer._pointLightBuffer = { mock: "plb" };
    writer._spotLightBuffer = { mock: "slb" };
    writer._areaLightBuffer = { mock: "alb" };
    renderer._context = { canvas: { width: 800, height: 600 } };
    renderer._clusterDims = { x: 1, y: 1, z: 1 };

    const vp = new Float32Array(16).fill(1);
    const lights = {
      pLights: [],
      sLights: [],
      aLights: [],
      aCol: { r: 0, g: 0, b: 0 },
      aIntensity: 0,
      dCol: { r: 0, g: 0, b: 0 },
      dDir: { x: 0, y: 0, z: -1 },
      dIntensity: 0,
    };
    const scene = { fog: undefined, environmentIntensity: 1 };

    writer.update(vp, { x: 0, y: 0, z: 0 }, lights, scene);

    const viewSlotWrite = (device.queue.writeBuffer as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === renderer._viewUniformBuffer,
    );
    expect(viewSlotWrite).toBeDefined();
    expect(viewSlotWrite![1]).toBe(VIEW_SLOT_MAIN_CAMERA * 256);
  });

  it("GPUPipelineCache.getPipeline's pipeline layout includes all 4 bind group layouts", () => {
    const { renderer, device } = makeRenderer();

    const cache = renderer._pipelineCache.getPipeline(
      makeManifest(),
      "triangle-list",
      false,
      "rgba8unorm",
    );

    expect(cache.bgLayouts).toEqual([
      renderer._globalBGL,
      expect.anything(),
      renderer._objectBGL,
      renderer._viewBGL,
    ]);
    expect(device.createPipelineLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        bindGroupLayouts: [
          renderer._globalBGL,
          expect.anything(),
          renderer._objectBGL,
          renderer._viewBGL,
        ],
      }),
    );
  });
});
