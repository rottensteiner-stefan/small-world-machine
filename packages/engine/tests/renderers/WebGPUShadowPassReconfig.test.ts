import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { CascadedShadowPassGPU } from "../../src/renderers/passes/CascadedShadowPassGPU.js";
import { SpotShadowPassGPU } from "../../src/renderers/passes/SpotShadowPassGPU.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { Vector3D } from "../../src/math/index.js";
import { WebGPUGGlobalUniformLayout } from "../../src/renderers/GlobalUniformLayout.js";

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
  createView: ReturnType<typeof vi.fn>;
}

function makeRenderer(lights: () => Internals): Internals {
  const textures: MockTexture[] = [];
  const dummyDir = {};
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
          createView: vi.fn(() => ({})),
        };
        textures.push(t);
        return t;
      }),
      queue: { writeBuffer: vi.fn() },
    },
    postProcessing: { enabled: false },
    currentColorTargetFormat: "rgba8unorm",
    deferDestroyTexture: vi.fn(),
    context: { shaderRegistry: new ShaderRegistry() },
    shadowMaps: new Map(),
    defaultDirShadowTextureView: dummyDir,
    dummyDirShadowTextureView: dummyDir,
    defaultSpotShadowTextureView: dummySpot,
    dummySpotShadowTextureView: dummySpot,
    defaultEVSMTextureView: {},
    dummyEVSMTextureView: {},
    evsmSampler: {},
    quality: {},
    _createGlobalBindGroup: vi.fn(() => ({})),
    _setViewMatrix: vi.fn(() => 0),
    _renderSubgroup: vi.fn(),
    scratchGlobalBufferData: new Float32Array(WebGPUGGlobalUniformLayout.totalFloats),
    globalUniformBuffer: {},
    globalBindGroup: undefined,
    globalResourcesVersion: 0,
  };
}

const scene = { getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches: [] })) } as Internals;
const ce = {
  beginRenderPass: vi.fn(() => ({ setBindGroup: vi.fn(), end: vi.fn() })),
} as Internals;
const vp = new Float32Array(16);
const cam = new Vector3D(0, 0, 0);

function makeSun(cascades: number, resolution: number): DirectionalLight {
  const sun = new DirectionalLight({ numCascades: cascades });
  sun.castShadow = true;
  sun.shadowResolution = resolution;
  return sun;
}

describe("CascadedShadowPassGPU follows its light's live configuration", () => {
  it("recreates map and dummy target when shadowResolution changes", () => {
    const sun = makeSun(2, 256);
    const renderer = makeRenderer(() => ({ dLight: sun }));
    const pass = new CascadedShadowPassGPU() as Internals;

    pass.execute(renderer, scene, ce, {}, vp, cam);
    const firstMap = renderer.shadowMaps.get(sun) as MockTexture;
    expect(firstMap.width).toBe(256);

    sun.shadowResolution = 512;
    pass.execute(renderer, scene, ce, {}, vp, cam);

    const secondMap = renderer.shadowMaps.get(sun) as MockTexture;
    expect(secondMap).not.toBe(firstMap);
    expect(secondMap.width).toBe(512);
    // The color dummy has to match the depth attachment size or the render pass is invalid.
    const dummies = (renderer.__textures as MockTexture[]).filter((t) => t.format === "rgba8unorm");
    expect(dummies.at(-1)!.width).toBe(512);
    expect(renderer.deferDestroyTexture).toHaveBeenCalledWith(firstMap);
    // The global bind group must be rebuilt against the new map.
    expect(renderer._createGlobalBindGroup).toHaveBeenCalled();
  });

  it("recreates the map when the cascade count shrinks instead of keeping stale layers", () => {
    const sun = makeSun(4, 256);
    const renderer = makeRenderer(() => ({ dLight: sun }));
    const pass = new CascadedShadowPassGPU() as Internals;
    pass.execute(renderer, scene, ce, {}, vp, cam);
    expect((renderer.shadowMaps.get(sun) as MockTexture).depthOrArrayLayers).toBe(4);

    sun.numCascades = 2;
    pass.execute(renderer, scene, ce, {}, vp, cam);
    expect((renderer.shadowMaps.get(sun) as MockTexture).depthOrArrayLayers).toBe(2);
  });

  it("never indexes cascade cameras that were not built when numCascades is raised", () => {
    const sun = makeSun(2, 256);
    const renderer = makeRenderer(() => ({ dLight: sun }));
    const pass = new CascadedShadowPassGPU() as Internals;
    sun.numCascades = 4; // cascadeCameras still has 2 entries
    expect(() => pass.execute(renderer, scene, ce, {}, vp, cam)).not.toThrow();
    expect((renderer.shadowMaps.get(sun) as MockTexture).depthOrArrayLayers).toBe(2);
  });

  it("releases the shadow map of a removed light and resets the bound default view", () => {
    const sun = makeSun(2, 256);
    let current: DirectionalLight | undefined = sun;
    const renderer = makeRenderer(() => ({ dLight: current }));
    const pass = new CascadedShadowPassGPU() as Internals;
    pass.execute(renderer, scene, ce, {}, vp, cam);
    const map = renderer.shadowMaps.get(sun) as MockTexture;
    expect(renderer.defaultDirShadowTextureView).not.toBe(renderer.dummyDirShadowTextureView);

    current = undefined;
    pass.execute(renderer, scene, ce, {}, vp, cam);

    expect(renderer.shadowMaps.has(sun)).toBe(false);
    expect(renderer.deferDestroyTexture).toHaveBeenCalledWith(map);
    expect(renderer.defaultDirShadowTextureView).toBe(renderer.dummyDirShadowTextureView);
  });
});

describe("SpotShadowPassGPU follows resolution and frees an unused atlas", () => {
  function makeSpot(resolution: number): SpotLight {
    const spot = new SpotLight();
    spot.castShadow = true;
    spot.shadowResolution = resolution;
    return spot;
  }

  it("recreates the atlas when the first caster's shadowResolution changes", () => {
    const spot = makeSpot(256);
    const renderer = makeRenderer(() => ({ sLights: [spot], pLights: [] }));
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, scene, ce, {}, vp, cam);
    const atlas = (renderer.__textures as MockTexture[]).find((t) => t.format === "depth32float")!;
    expect(atlas.width).toBe(256);

    spot.shadowResolution = 512;
    pass.execute(renderer, scene, ce, {}, vp, cam);
    const atlases = (renderer.__textures as MockTexture[]).filter(
      (t) => t.format === "depth32float",
    );
    expect(atlases.at(-1)!.width).toBe(512);
    expect(renderer.deferDestroyTexture).toHaveBeenCalledWith(atlas);
  });

  it("releases the atlas after the idle grace period and rebuilds it on demand", () => {
    const spot = makeSpot(256);
    let lights: Internals = { sLights: [spot], pLights: [] };
    const renderer = makeRenderer(() => lights);
    const pass = new SpotShadowPassGPU() as Internals;
    pass.execute(renderer, scene, ce, {}, vp, cam);
    const atlas = (renderer.__textures as MockTexture[]).find((t) => t.format === "depth32float")!;

    lights = { sLights: [], pLights: [] };
    for (let i = 0; i < 119; i++) pass.execute(renderer, scene, ce, {}, vp, cam);
    expect(renderer.deferDestroyTexture).not.toHaveBeenCalledWith(atlas);
    pass.execute(renderer, scene, ce, {}, vp, cam);
    expect(renderer.deferDestroyTexture).toHaveBeenCalledWith(atlas);
    expect(renderer.defaultSpotShadowTextureView).toBe(renderer.dummySpotShadowTextureView);

    lights = { sLights: [spot], pLights: [] };
    pass.execute(renderer, scene, ce, {}, vp, cam);
    const atlases = (renderer.__textures as MockTexture[]).filter(
      (t) => t.format === "depth32float",
    );
    expect(atlases).toHaveLength(2);
  });
});
