import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { Topology } from "../../src/enums/index.js";

// Split out of WebGPUCapacityFailFast.test.ts: these cases exercise the WebGL1/WebGL2 renderers.
function makeMockGl(): WebGLRenderingContext {
  const fns = new Map<string, unknown>();
  return new Proxy({} as unknown as WebGLRenderingContext, {
    get: (target, prop): unknown => {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      let fn = fns.get(prop);
      if (!fn) {
        fn = prop === "createBuffer" ? vi.fn(() => ({})) : vi.fn();
        fns.set(prop, fn);
      }
      return fn;
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

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
    const mockProg = {
      prog: {},
      uniforms: new Map(),
      pointLightLocs: [],
      samplerUnits: new Map(),
      samplerTypes: new Map(),
      attributes: new Map([
        ["a_position", 0],
        ["a_normal", 1],
        ["a_uv", 2],
        ["a_tangent", 3],
        ["a_color", 4],
        ["a_instanceMatrix", 6],
      ]),
    };
    renderer._programCache = {
      getProgram: vi.fn(() => mockProg),
      programCacheKey: vi.fn(() => "testKey"),
      acquireProgram: vi.fn(),
    };
    renderer._textures = { acquireTextures: vi.fn() };
    renderer._geometry = {
      getOrCreateMesh: vi.fn(() => ({
        bind: vi.fn(),
        count: 3,
        isIndexed: false,
      })),
    };
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

  it("allocates full capacity once via bufferData and uploads only active prefix via bufferSubData", () => {
    const renderer = new WebGL1Renderer() as RendererInternals;
    setupWebGL1(renderer);
    renderer.gl.createBuffer = vi.fn(() => ({}));

    const geo = new Cube().getGeometryData();
    const mat = new BasicMaterial();
    const instMesh = new InstancedMesh("TestInst", geo, mat, 10);
    instMesh.initInstanceData(4);
    renderer._programCache.getProgram = vi.fn(() => ({
      prog: {},
      uniforms: new Map(),
      pointLightLocs: [],
      samplerUnits: new Map(),
      samplerTypes: new Map(),
      attributes: new Map([
        ["a_position", 0],
        ["a_normal", 1],
        ["a_uv", 2],
        ["a_tangent", 3],
        ["a_color", 4],
        ["a_instanceMatrix", 6],
        ["a_instanceData", 10],
      ]),
    }));
    instMesh.instanceCount = 3;

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

    renderer._renderSubgroup(batch, [instMesh], true, undefined, vp, camPos, lights, scene);
    expect(renderer.gl.bufferData).toHaveBeenCalledTimes(2); // 1 matrix buffer + 1 data buffer allocated
    expect(renderer.gl.bufferSubData).toHaveBeenCalledTimes(2);
    expect((renderer.gl.bufferSubData.mock.calls[0]![2] as Float32Array).length).toBe(3 * 16);
    expect((renderer.gl.bufferSubData.mock.calls[1]![2] as Float32Array).length).toBe(3 * 4);

    // Subsequent update reuses the allocated GPU buffer and only calls bufferSubData
    instMesh.instanceCount = 4;
    instMesh.instanceMatrixNeedsUpdate = true;
    instMesh.instanceDataNeedsUpdate = true;
    renderer._renderSubgroup(batch, [instMesh], true, undefined, vp, camPos, lights, scene);
    expect(renderer.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(renderer.gl.bufferSubData).toHaveBeenCalledTimes(4);
    expect((renderer.gl.bufferSubData.mock.calls[2]![2] as Float32Array).length).toBe(4 * 16);
    expect((renderer.gl.bufferSubData.mock.calls[3]![2] as Float32Array).length).toBe(4 * 4);
  });
});
