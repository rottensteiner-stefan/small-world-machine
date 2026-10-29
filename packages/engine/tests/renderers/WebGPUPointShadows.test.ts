import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { SpotShadowPassGPU } from "../../src/renderers/passes/SpotShadowPassGPU.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";
import { WebGPUGGlobalUniformLayout } from "../../src/renderers/GlobalUniformLayout.js";
import {
  VIEW_SLOT_COUNT,
  VIEW_SLOT_POINT_SHADOW_BASE,
} from "../../src/renderers/WebGPU/WebGPURenderer.js";
import {
  SHADOW_ARRAY_LAYERS,
  cubeFaceForDirection,
} from "../../src/core/lights/PointLightShadow.js";
import PBR_MATH_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl?raw";
import LIGHTING_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl?raw";
import LIGHTING_PBR_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl?raw";
import GLASS_LOOPS_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/glass_pbr_loops.wgsl?raw";

(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

interface MockTexture {
  width: number;
  depthOrArrayLayers: number;
  format: string;
  views: { baseArrayLayer?: number }[];
  createView: (d?: { baseArrayLayer?: number }) => { baseArrayLayer?: number };
}

const glob = WebGPUGGlobalUniformLayout.fields;

function makeRenderer(lights: () => Internals, quality: Internals = {}): Internals {
  const textures: MockTexture[] = [];
  const dummySpot = {};
  return {
    __textures: textures,
    extractLights: vi.fn(lights),
    gpuDevice: {
      createTexture: vi.fn((d: { size: number[]; format: string }) => {
        const t: MockTexture = {
          width: d.size[0]!,
          depthOrArrayLayers: d.size[2] ?? 1,
          format: d.format,
          views: [],
          createView: (desc?: { baseArrayLayer?: number }) => {
            const v = { ...desc };
            t.views.push(v);
            return v;
          },
        };
        textures.push(t);
        return t;
      }),
      queue: { writeBuffer: vi.fn() },
    },
    quality,
    currentColorTargetFormat: "rgba8unorm",
    deferDestroyTexture: vi.fn(),
    context: { shaderRegistry: new ShaderRegistry() },
    defaultDirShadowTextureView: {},
    dummyDirShadowTextureView: {},
    defaultSpotShadowTextureView: dummySpot,
    dummySpotShadowTextureView: dummySpot,
    _createGlobalBindGroup: vi.fn(() => ({})),
    _setViewMatrix: vi.fn(() => 0),
    _renderSubgroup: vi.fn(),
    scratchGlobalBufferData: new Float32Array(WebGPUGGlobalUniformLayout.totalFloats),
    globalUniformBuffer: {},
    globalBindGroup: undefined,
    globalResourcesVersion: 0,
  };
}

function makeScene(casters: Internals[] = []): Internals {
  return {
    root: { isVisible: true, castShadow: false, children: casters },
    getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches: [] })),
  };
}

function makeCaster(): Internals {
  return {
    isVisible: true,
    castShadow: true,
    geometry: {},
    material: { uuid: "caster-mat", getRenderManifest: () => ({ shaderId: "test" }) },
    bounds: undefined,
    children: [],
  };
}

function makePoint(x: number, y: number, z: number, distance: number): PointLight {
  const light = new PointLight({ distance, castShadow: true });
  light.position.set(x, y, z);
  light.updateMatrixWorld(true);
  return light;
}

/** Camera at the origin looking down -Z with a 90° field of view. */
function cameraVp(): Float32Array {
  const proj = new Matrix4();
  Matrix4.perspective(Math.PI / 2, 1, 0.1, 100, proj);
  return proj.data;
}

const origin = new Vector3D(0, 0, 0);

function encoder(): Internals {
  return { beginRenderPass: vi.fn(() => ({ setBindGroup: vi.fn(), end: vi.fn() })) };
}

function depthAtlas(renderer: Internals): MockTexture {
  return (renderer.__textures as MockTexture[]).filter((t) => t.format === "depth32float").at(-1)!;
}

function attachedLayers(ce: Internals): number[] {
  return ce.beginRenderPass.mock.calls.map(
    (c: Internals[]) => c[0].depthStencilAttachment.view.baseArrayLayer as number,
  );
}

describe("SpotShadowPassGPU point-light cube faces (ADR 0052)", () => {
  it("adds no pass, no view slot and no upload without a shadowed point light", () => {
    const spot = new SpotLight({ castShadow: true });
    const point = new PointLight({ distance: 5 }); // castShadow stays false by default
    point.updateMatrixWorld(true);
    const renderer = makeRenderer(() => ({ sLights: [spot], pLights: [point] }));
    const ce = encoder();
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, makeScene(), ce, {}, cameraVp(), origin);

    expect(ce.beginRenderPass).toHaveBeenCalledTimes(1);
    expect(depthAtlas(renderer).depthOrArrayLayers).toBe(4);
    for (const call of renderer._setViewMatrix.mock.calls) {
      expect(call[0]).toBeLessThan(VIEW_SLOT_POINT_SHADOW_BASE);
    }
    for (const call of renderer.gpuDevice.queue.writeBuffer.mock.calls) {
      expect(call[1]).toBeLessThan(glob.pointShadowMatrices.index * 4);
    }
    expect(point.castShadow).toBe(false);
    expect(point.shadowResolution).toBe(256);
  });

  it("does nothing at all with neither spot nor point casters", () => {
    const renderer = makeRenderer(() => ({ sLights: [], pLights: [makePoint(0, 0, 0, 5)] }), {
      maxShadowedPointLights: 0,
    });
    const ce = encoder();
    new SpotShadowPassGPU().execute(
      renderer,
      makeScene(),
      ce,
      {} as GPUTextureView,
      cameraVp(),
      origin,
    );
    expect(ce.beginRenderPass).not.toHaveBeenCalled();
    expect(renderer.gpuDevice.createTexture).not.toHaveBeenCalled();
  });

  it("renders all six faces of a light at the camera into layers 4..9 and slots 9..14", () => {
    const light = makePoint(0, 0, -1, 5);
    light.shadowBias = 0.003;
    light.shadowNormalBias = 0.02;
    const pLights = [makePoint(80, 0, 0, 1), light];
    const renderer = makeRenderer(() => ({ sLights: [], pLights }));
    const ce = encoder();
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, makeScene(), ce, {}, cameraVp(), origin);

    expect(depthAtlas(renderer).depthOrArrayLayers).toBe(SHADOW_ARRAY_LAYERS);
    expect(depthAtlas(renderer).width).toBe(256);
    // Nearest light first: pLights index 1 takes slot 0, the far one slot 1.
    expect(attachedLayers(ce).slice(0, 6)).toEqual([4, 5, 6, 7, 8, 9]);
    const slots = renderer._setViewMatrix.mock.calls.map((c: Internals[]) => c[0] as number);
    expect(slots.slice(0, 6)).toEqual([9, 10, 11, 12, 13, 14]);
    expect(Math.max(...slots)).toBeLessThan(VIEW_SLOT_COUNT);

    const g = renderer.scratchGlobalBufferData as Float32Array;
    const info = Array.from(g.subarray(glob.pointShadowInfo.index, glob.pointShadowInfo.index + 4));
    expect(info[0]).toBeCloseTo(0.003);
    expect(info[1]).toBeCloseTo(0.02);
    expect(info.slice(2)).toEqual([1, 1]);
    const m0 = g.subarray(glob.pointShadowMatrices.index, glob.pointShadowMatrices.index + 16);
    expect(m0.some((v) => v !== 0)).toBe(true);
  });

  it("respects maxShadowedPointLights and keeps the nearest light", () => {
    const near = makePoint(0, 0, -2, 5);
    const far = makePoint(0, 0, -20, 5);
    const renderer = makeRenderer(() => ({ sLights: [], pLights: [far, near] }), {
      maxShadowedPointLights: 1,
    });
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, makeScene(), encoder(), {}, cameraVp(), origin);
    const g = renderer.scratchGlobalBufferData as Float32Array;
    expect(g[glob.pointShadowInfo.index + 2]).toBe(1);
    expect(g[glob.pointShadowInfo.index + 3]).toBe(1);
    // Slot 1 untouched: the writer's defaults (castShadow 0) stay.
    expect(g[glob.pointShadowInfo.index + 7]).toBe(0);
    expect(pass.pointFacesRendered + pass.pointFacesSkipped).toBe(6);
  });

  it("skips faces whose range-limited pyramid misses the camera frustum", () => {
    // Light right of a 90° view: the +X and +Z faces cannot hold a visible receiver.
    const renderer = makeRenderer(() => ({ sLights: [], pLights: [makePoint(12, 0, -10, 4)] }));
    const ce = encoder();
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, makeScene(), ce, {}, cameraVp(), origin);
    expect(pass.pointFacesSkipped).toBe(2);
    expect(pass.pointFacesRendered).toBe(4);
    expect(attachedLayers(ce)).toEqual([5, 6, 7, 9]);
  });

  it("skips every face of a light whose whole range is outside the view", () => {
    const renderer = makeRenderer(() => ({ sLights: [], pLights: [makePoint(0, 0, 30, 4)] }));
    const ce = encoder();
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, makeScene(), ce, {}, cameraVp(), origin);
    expect(pass.pointFacesSkipped).toBe(6);
    expect(ce.beginRenderPass).not.toHaveBeenCalled();
  });

  it("draws scene casters within range even when the camera list is empty", () => {
    const caster = makeCaster();
    const renderer = makeRenderer(() => ({ sLights: [], pLights: [makePoint(0, 0, -3, 5)] }));
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, makeScene([caster]), encoder(), {}, cameraVp(), origin);
    const drawn = renderer._renderSubgroup.mock.calls.map((c: Internals[]) => c[1]);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((objs: Internals[]) => objs[0] === caster)).toBe(true);
  });

  it("drops the face layers after the idle grace period but keeps the spot atlas", () => {
    const spot = new SpotLight({ castShadow: true });
    let pLights: PointLight[] = [makePoint(0, 0, 0, 5)];
    const renderer = makeRenderer(() => ({ sLights: [spot], pLights }));
    const pass = new SpotShadowPassGPU() as Internals;
    const run = (): void => pass.execute(renderer, makeScene(), encoder(), {}, cameraVp(), origin);
    run();
    const grown = depthAtlas(renderer);
    expect(grown.depthOrArrayLayers).toBe(16);

    pLights = [];
    for (let i = 0; i < 119; i++) run();
    expect(depthAtlas(renderer)).toBe(grown);
    run();
    expect(depthAtlas(renderer).depthOrArrayLayers).toBe(4);
    expect(renderer.deferDestroyTexture).toHaveBeenCalledWith(grown);
  });
});

/** Source of the point-light loop of a lighting chunk (up to the spot-light loop). */
function pointLoop(source: string): string {
  const start = source.indexOf("pointClusterGrid[clusterCellIndex]");
  const end = source.indexOf("spotClusterGrid[clusterCellIndex]");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("WGSL point-light shadow lookup", () => {
  it.each([
    ["lighting.wgsl", LIGHTING_WGSL],
    ["lighting_pbr.wgsl", LIGHTING_PBR_WGSL],
    ["glass_pbr_loops.wgsl", GLASS_LOOPS_WGSL],
  ])("%s multiplies the point shadow into every point light", (_name, source) => {
    const loop = pointLoop(source);
    expect(loop).toMatch(/let pShadow = getPointShadow\(u_spotShadowMap, shadowSampler, j,/);
    expect(loop).toMatch(/\* pShadow/);
  });

  it("samples layer 4 + slot * 6 + face with the slot's face matrix", () => {
    expect(PBR_MATH_WGSL).toMatch(/global\.pointShadowMatrices\[m\]/);
    expect(PBR_MATH_WGSL).toMatch(/4u \+ m/);
    expect(PBR_MATH_WGSL).toMatch(/slot \* 6u \+ pointShadowFace\(/);
  });

  it("pointShadowFace matches cubeFaceForDirection, ties included", () => {
    const match = /fn pointShadowFace\(d: vec3f\) -> u32 \{([\s\S]*?)\n\}/.exec(PBR_MATH_WGSL);
    expect(match).not.toBeNull();
    // Tiny WGSL -> JS transliteration of this one function; any rewrite of it must stay readable
    // by these rules or this test needs the same update.
    const js = match![1]!
      .replace(
        "let a = abs(d);",
        "const a = { x: Math.abs(d.x), y: Math.abs(d.y), z: Math.abs(d.z) };",
      )
      .replace(/select\(([^,]+), ([^,]+), ([^)]+)\)/g, "(($3) ? $2 : $1)")
      .replace(/(\d)u\b/g, "$1");
    const face = new Function("d", js) as (d: { x: number; y: number; z: number }) => number;

    const values = [-1, -0.5, 0, 0.5, 1];
    for (const x of values) {
      for (const y of values) {
        for (const z of values) {
          expect(face({ x, y, z }), `(${x}, ${y}, ${z})`).toBe(cubeFaceForDirection(x, y, z));
        }
      }
    }
    for (let i = 0; i < 200; i++) {
      const d = { x: Math.sin(i * 1.7), y: Math.cos(i * 2.3), z: Math.sin(i * 0.9 + 1) };
      expect(face(d)).toBe(cubeFaceForDirection(d.x, d.y, d.z));
    }
  });
});
