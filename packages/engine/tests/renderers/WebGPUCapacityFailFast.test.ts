import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
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

function makeMockGl(): WebGLRenderingContext {
  const fns = new Map<string, unknown>();
  return new Proxy({} as unknown as WebGLRenderingContext, {
    get: (_target, prop): unknown => {
      if (typeof prop !== "string") return undefined;
      let fn = fns.get(prop);
      if (!fn) {
        fn = vi.fn();
        fns.set(prop, fn);
      }
      return fn;
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

describe("WebGPU capacity fail-fast validation", () => {
  it("throws when point lights exceed limit in _updateGlobalBuffers", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    renderer._device = makeMockDevice();
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

    expect(() => renderer._updateGlobalBuffers(vp, camPos, lights, scene)).toThrow(
      /Point light count exceeds limit of 64: 65/,
    );
  });

  it("throws when spot lights exceed limit in _updateGlobalBuffers", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    renderer._device = makeMockDevice();
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

    expect(() => renderer._updateGlobalBuffers(vp, camPos, lights, scene)).toThrow(
      /Spot light count exceeds limit of 64: 65/,
    );
  });

  it("throws when area lights exceed limit of 42 in _updateGlobalBuffers", () => {
    const renderer = new WebGPURenderer() as RendererInternals;
    renderer._device = makeMockDevice();
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

    expect(() => renderer._updateGlobalBuffers(vp, camPos, lights, scene)).toThrow(
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

describe("WebGL2 capacity fail-fast validation", () => {
  it("throws when point lights exceed limit in updateGlobalUBO", () => {
    const renderer = new WebGL2Renderer() as RendererInternals;
    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const pLights = Array.from({ length: 65 }, () => new PointLight());
    const lights = { pLights, sLights: [], aLights: [], dLights: [] };

    expect(() => renderer.updateGlobalUBO(vp, camPos, lights)).toThrow(
      /Point light count exceeds limit of 64: 65/,
    );
  });

  it("throws when spot lights exceed limit in updateGlobalUBO", () => {
    const renderer = new WebGL2Renderer() as RendererInternals;
    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const sLights = Array.from({ length: 65 }, () => new SpotLight());
    const lights = { pLights: [], sLights, aLights: [], dLights: [] };

    expect(() => renderer.updateGlobalUBO(vp, camPos, lights)).toThrow(
      /Spot light count exceeds limit of 64: 65/,
    );
  });

  it("throws when area lights exceed limit of 42 in updateGlobalUBO", () => {
    const renderer = new WebGL2Renderer() as RendererInternals;
    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const aLights = Array.from({ length: 43 }, () => ({}));
    const lights = { pLights: [], sLights: [], aLights, dLights: [] };

    expect(() => renderer.updateGlobalUBO(vp, camPos, lights)).toThrow(
      /Area light count exceeds limit of 42: 43/,
    );
  });

  function setupWebGL2Subgroup(renderer: RendererInternals): void {
    renderer.gl = makeMockGl();
    const mockProg = {
      program: {},
      uniforms: new Map(),
      samplerUnits: new Map(),
      samplerTypes: new Map(),
      attributes: new Map([
        ["a_position", 0],
        ["a_normal", 1],
        ["a_uv", 2],
        ["a_tangent", 3],
        ["a_instanceMatrix", 6],
        ["a_instanceData", 10],
      ]),
    };
    renderer._programCache = {
      getProgram: vi.fn(() => mockProg),
      getCompiledProgram: vi.fn(() => mockProg),
      acquireProgram: vi.fn(),
      programCacheKey: vi.fn(() => "testKey"),
    };
    renderer._textures = { acquireTextures: vi.fn() };
    renderer._instanceBuffers = new WeakMap();
    renderer._instanceDataBuffers = new WeakMap();
    renderer._geometry = {
      getOrCreateMesh: vi.fn(() => ({
        bind: vi.fn(),
        count: 36,
      })),
    };
  }

  it("throws when InstancedMesh has negative instanceCount in _renderSubgroup", () => {
    const renderer = new WebGL2Renderer() as RendererInternals;
    setupWebGL2Subgroup(renderer);
    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 10);
    instMesh.instanceCount = -1;

    expect(() =>
      renderer._renderSubgroup(
        {},
        [instMesh],
        true,
        mat.uuid,
        { shaderId: "test", properties: {}, textures: {} },
        0,
        undefined,
        Topology.TRIANGLE_LIST,
      ),
    ).toThrow(/Invalid instanceCount: -1/);
  });

  it("throws when InstancedMesh matrix buffer is too small in _renderSubgroup", () => {
    const renderer = new WebGL2Renderer() as RendererInternals;
    setupWebGL2Subgroup(renderer);
    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 5);
    instMesh.instanceCount = 10;

    expect(() =>
      renderer._renderSubgroup(
        {},
        [instMesh],
        true,
        mat.uuid,
        { shaderId: "test", properties: {}, textures: {} },
        0,
        undefined,
        Topology.TRIANGLE_LIST,
      ),
    ).toThrow(/InstancedMesh matrix buffer too small: required at least 640 bytes/);
  });

  it("throws when InstancedMesh instanceData buffer is too small in _renderSubgroup", () => {
    const renderer = new WebGL2Renderer() as RendererInternals;
    setupWebGL2Subgroup(renderer);
    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 10);
    instMesh.instanceData = new Float32Array(8);

    expect(() =>
      renderer._renderSubgroup(
        {},
        [instMesh],
        true,
        mat.uuid,
        { shaderId: "test", properties: {}, textures: {} },
        0,
        undefined,
        Topology.TRIANGLE_LIST,
      ),
    ).toThrow(/InstancedMesh instanceData buffer too small: required at least 160 bytes/);
  });
});

describe("WebGL1 capacity fail-fast validation", () => {
  function setupWebGL1(renderer: RendererInternals): void {
    renderer.gl = makeMockGl();
    renderer._getProgram = vi.fn(() => ({
      program: {},
      pointLightLocs: [],
      uniforms: new Map(),
      samplerUnits: new Map(),
      attributes: new Map([
        ["a_position", 0],
        ["a_normal", 1],
        ["a_uv", 2],
        ["a_tangent", 3],
        ["a_color", 4],
        ["a_instanceMatrix", 6],
      ]),
    }));
    renderer._getOrCreateMesh = vi.fn(() => ({
      bind: vi.fn(),
      count: 3,
      isIndexed: false,
    }));
    renderer._instancedArraysExt = {
      vertexAttribDivisorANGLE: vi.fn(),
      drawArraysInstancedANGLE: vi.fn(),
    };
    renderer._instanceMatrixBuffers = new WeakMap();
  }

  it("throws when point lights exceed limit of 16 in _renderSubgroup", () => {
    const renderer = new WebGL1Renderer() as RendererInternals;
    setupWebGL1(renderer);

    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const pLights = Array.from({ length: 17 }, () => new PointLight());
    const lights = {
      pLights,
      sLights: [],
      aLights: [],
      dLights: [],
      aCol: { r: 0, g: 0, b: 0 },
      aIntensity: 0,
      dCol: { r: 0, g: 0, b: 0 },
      dIntensity: 0,
      dDir: new Vector3D(0, -1, 0),
    };
    const batch = { shaderId: "test", topology: "triangles" };
    const scene = { fog: null };
    const dummyObj = new InstancedMesh(
      "TestMesh",
      new Cube().getGeometryData(),
      new BasicMaterial(),
      1,
    );

    expect(() =>
      renderer._renderSubgroup(batch, [dummyObj], false, undefined, vp, camPos, lights, scene),
    ).toThrow(/Point light count exceeds limit of 16: 17/);
  });

  it("throws when InstancedMesh has negative instanceCount in _renderSubgroup", () => {
    const renderer = new WebGL1Renderer() as RendererInternals;
    setupWebGL1(renderer);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 10);
    instMesh.instanceCount = -1;

    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const lights = {
      pLights: [],
      sLights: [],
      aLights: [],
      dLights: [],
      aCol: { r: 0, g: 0, b: 0 },
      aIntensity: 0,
      dCol: { r: 0, g: 0, b: 0 },
      dIntensity: 0,
      dDir: new Vector3D(0, -1, 0),
    };
    const batch = { shaderId: "test", topology: "triangles" };
    const scene = { fog: null };

    expect(() =>
      renderer._renderSubgroup(batch, [instMesh], true, undefined, vp, camPos, lights, scene),
    ).toThrow(/Invalid instanceCount: -1/);
  });

  it("throws when InstancedMesh matrix buffer is too small in _renderSubgroup", () => {
    const renderer = new WebGL1Renderer() as RendererInternals;
    setupWebGL1(renderer);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 5);
    instMesh.instanceCount = 10;

    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const lights = {
      pLights: [],
      sLights: [],
      aLights: [],
      dLights: [],
      aCol: { r: 0, g: 0, b: 0 },
      aIntensity: 0,
      dCol: { r: 0, g: 0, b: 0 },
      dIntensity: 0,
      dDir: new Vector3D(0, -1, 0),
    };
    const batch = { shaderId: "test", topology: "triangles" };
    const scene = { fog: null };

    expect(() =>
      renderer._renderSubgroup(batch, [instMesh], true, undefined, vp, camPos, lights, scene),
    ).toThrow(/InstancedMesh matrix buffer too small: required at least 640 bytes/);
  });

  it("throws when InstancedMesh instanceData buffer is too small in _renderSubgroup", () => {
    const renderer = new WebGL1Renderer() as RendererInternals;
    setupWebGL1(renderer);

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 10);
    instMesh.instanceData = new Float32Array(8);

    const vp = new Float32Array(16);
    const camPos = new Vector3D(0, 0, 0);
    const lights = {
      pLights: [],
      sLights: [],
      aLights: [],
      dLights: [],
      aCol: { r: 0, g: 0, b: 0 },
      aIntensity: 0,
      dCol: { r: 0, g: 0, b: 0 },
      dIntensity: 0,
      dDir: new Vector3D(0, -1, 0),
    };
    const batch = { shaderId: "test", topology: "triangles" };
    const scene = { fog: null };

    expect(() =>
      renderer._renderSubgroup(batch, [instMesh], true, undefined, vp, camPos, lights, scene),
    ).toThrow(/InstancedMesh instanceData buffer too small: required at least 160 bytes/);
  });
});
