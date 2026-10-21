import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { GlobalUniformWriter } from "../../src/renderers/WebGPU/managers/GlobalUniformWriter.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import type { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
import { Topology } from "../../src/enums/index.js";

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
      size: 65536,
      destroy: vi.fn(),
      getMappedRange: vi.fn(() => new ArrayBuffer(1024)),
      unmap: vi.fn(),
    })),
    createBindGroup: vi.fn((desc: unknown) => ({ desc })),
    createBindGroupLayout: vi.fn((desc: unknown) => ({ desc })),
    createRenderPipeline: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
    limits: { minUniformBufferOffsetAlignment: 256 },
  } as unknown as GPUDevice;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

describe("WebGPU capacity fail-fast validation", () => {
  it("throws when point lights exceed limit in _updateGlobalBuffers", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    renderer._device = makeMockDevice();
    renderer._globalUniformWriter = new GlobalUniformWriter(renderer);
    const scene = new Scene();
    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);

    const pLights = Array.from({ length: 65 }, () => new PointLight());
    const lights = {
      pLights,
      sLights: [],
      aLights: [],
      dLights: [],
    };

    expect(() => renderer._globalUniformWriter.update(vp, camPos, lights, scene)).toThrow(
      /Point light count exceeds limit of 64: 65/,
    );
  });

  it("throws when spot lights exceed limit in _updateGlobalBuffers", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    renderer._device = makeMockDevice();
    renderer._globalUniformWriter = new GlobalUniformWriter(renderer);
    const scene = new Scene();
    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);

    const sLights = Array.from({ length: 65 }, () => new SpotLight());
    const lights = {
      pLights: [],
      sLights,
      aLights: [],
      dLights: [],
    };

    expect(() => renderer._globalUniformWriter.update(vp, camPos, lights, scene)).toThrow(
      /Spot light count exceeds limit of 64: 65/,
    );
  });

  it("throws when area lights exceed limit of 42 in _updateGlobalBuffers", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    renderer._device = makeMockDevice();
    renderer._globalUniformWriter = new GlobalUniformWriter(renderer);
    const scene = new Scene();
    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);

    // Area lights mock
    const aLights = Array.from({ length: 43 }, () => ({
      worldMatrix: { data: new Float32Array(16) },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
      distance: 10,
      decay: 2,
      width: 1,
      height: 1,
    }));
    const lights = {
      pLights: [],
      sLights: [],
      aLights,
      dLights: [],
    };

    expect(() => renderer._globalUniformWriter.update(vp, camPos, lights, scene)).toThrow(
      /Area light count exceeds limit of 42: 43/,
    );
  });

  function setupSubgroupMocks(renderer: RendererInternals, ensureDummySpy = vi.fn()): void {
    renderer._device = makeMockDevice();
    renderer._pipelineCache = {
      getPipeline: vi.fn(() => ({
        pipeline: {},
        bgLayouts: [{}, {}],
      })),
      pipelineCacheKey: vi.fn(() => "test-key"),
      acquirePipeline: vi.fn(),
    };
    renderer._textures = { acquireTextures: vi.fn() };
    renderer._geometryCache = {
      getGeoCache: vi.fn(() => ({
        vertexCount: 8,
        vb: {},
        format: "uint16",
      })),
    };
    renderer._fallback = {
      ensureDummyBufferSize: ensureDummySpy,
      dummyNormalBuffer: {},
      dummyUvBuffer: {},
      dummyTangentBuffer: {},
      dummyJointsBuffer: {},
      dummyWeightsBuffer: {},
      dummyColorBuffer: {},
      deferDestroyBuffer: vi.fn(),
    };
    renderer._objectRing = { bindGroup: {} };
    renderer._getObjectSlotOffset = vi.fn(() => 0);
    renderer._getMaterialBindGroup = vi.fn(() => ({}));
    renderer._viewBindGroup = {};
    renderer._gpuInstanceBuffers = new WeakMap();
    renderer._gpuInstanceDataBuffers = new WeakMap();
  }

  it("throws when InstancedMesh has negative instanceCount in _renderSubgroup", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    setupSubgroupMocks(renderer);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("InstMesh", geo, mat, 10);
    instMesh.instanceCount = -1;

    const mockRp = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    const manifest: RenderManifest = {
      shaderId: "test",
      properties: {},
      textures: {},
    };

    expect(() =>
      renderer._renderSubgroup(
        mockRp,
        [instMesh],
        true,
        mat.uuid,
        manifest,
        0,
        undefined,
        Topology.TRIANGLE_LIST,
      ),
    ).toThrow(/Invalid instanceCount: -1/);
  });

  it("throws when InstancedMesh matrix buffer is too small for instanceCount in _renderSubgroup", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    setupSubgroupMocks(renderer);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("InstMesh", geo, mat, 5);
    // Buffer only big enough for 5 instances (5 * 64 = 320 bytes), but instanceCount set to 10
    instMesh.instanceCount = 10;

    const mockRp = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    const manifest: RenderManifest = {
      shaderId: "test",
      properties: {},
      textures: {},
    };

    expect(() =>
      renderer._renderSubgroup(
        mockRp,
        [instMesh],
        true,
        mat.uuid,
        manifest,
        0,
        undefined,
        Topology.TRIANGLE_LIST,
      ),
    ).toThrow(/InstancedMesh matrix buffer too small: required at least 640 bytes/);
  });

  it("throws when InstancedMesh instanceData buffer is too small for instanceCount in _renderSubgroup", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    setupSubgroupMocks(renderer);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("InstMesh", geo, mat, 10);
    // instanceData allocated for only 2 instances (2 * 16 = 32 bytes)
    instMesh.instanceData = new Float32Array(8);

    const mockRp = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    const manifest: RenderManifest = {
      shaderId: "test",
      properties: {},
      textures: {},
    };

    expect(() =>
      renderer._renderSubgroup(
        mockRp,
        [instMesh],
        true,
        mat.uuid,
        manifest,
        0,
        undefined,
        Topology.TRIANGLE_LIST,
      ),
    ).toThrow(/InstancedMesh instanceData buffer too small: required at least 160 bytes/);
  });

  it("grows dummy buffer using instanceCount when instanceData is absent in _renderSubgroup", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    const ensureDummySpy = vi.fn();
    setupSubgroupMocks(renderer, ensureDummySpy);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("InstMesh", geo, mat, 1000);
    instMesh.instanceCount = 1000;

    const mockRp = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    const manifest: RenderManifest = {
      shaderId: "test",
      properties: {},
      textures: {},
    };

    renderer._renderSubgroup(
      mockRp,
      [instMesh],
      true,
      mat.uuid,
      manifest,
      0,
      undefined,
      Topology.TRIANGLE_LIST,
    );

    expect(ensureDummySpy).toHaveBeenCalledWith(1000);
  });
});
