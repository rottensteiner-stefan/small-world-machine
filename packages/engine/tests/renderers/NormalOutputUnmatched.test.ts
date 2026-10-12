import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canWrapFragmentWithNormalOutput,
  wrapFragmentWithNormalOutput,
} from "../../src/renderers/WebGPU/managers/NormalOutputWrapper.js";
import {
  canWrapFragmentWithNormalOutputGL,
  wrapFragmentWithNormalOutputGL,
} from "../../src/renderers/WebGL2/managers/NormalOutputWrapperGL.js";
import { GPUPipelineCache } from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { NormalTargetMode } from "../../src/enums/index.js";
import type { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";

// Odd formatting / foreign entry points the wrappers cannot rewrite.
const UNMATCHED_WGSL = [
  "@fragment fn fs(i: Out) -> @location(0) vec4h { return vec4h(1.0); }",
  "@fragment fn main_fs(i: Out) -> @location(0) vec4f { return vec4f(1.0); }",
  "@fragment fn fs(i: Out, @builtin(front_facing) ff: bool) -> @location(0) vec4f { return vec4f(1.0); }",
  "@fragment fn fs(i: Out) -> FragOut { return FragOut(vec4f(1.0)); }",
];
const UNMATCHED_GLSL = [
  "#version 300 es\nout vec4 outColor;\nvoid main() { outColor = vec4(1.0); }",
  "#version 300 es\nout vec4 fragColor;\nvoid mainImage() { fragColor = vec4(1.0); }",
  "#version 300 es\nlayout(location = 0) out vec4 fragColor, o2;\nvoid main() {}",
];

describe("normal output wrappers: unmatched shaders", () => {
  it("WGSL: unmatched shaders are reported and returned verbatim", () => {
    for (const src of UNMATCHED_WGSL) {
      expect(canWrapFragmentWithNormalOutput(src), src).toBe(false);
      expect(wrapFragmentWithNormalOutput(src), src).toBe(src);
    }
    expect(
      canWrapFragmentWithNormalOutput(
        "@fragment fn fs(i: Out) -> @location(0) vec4f { return v; }",
      ),
    ).toBe(true);
  });

  it("GLSL: unmatched shaders are reported and returned verbatim", () => {
    for (const src of UNMATCHED_GLSL) {
      expect(canWrapFragmentWithNormalOutputGL(src), src).toBe(false);
      expect(wrapFragmentWithNormalOutputGL(src), src).toBe(src);
    }
    expect(
      canWrapFragmentWithNormalOutputGL(
        "out vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }",
      ),
    ).toBe(true);
  });
});

describe("GPUPipelineCache.getPipeline with an unmatched fragment shader", () => {
  const manifest = {
    shaderId: "Custom",
    properties: [],
    textures: [],
  } as unknown as RenderManifest;

  afterEach(() => vi.unstubAllGlobals());

  function makeCache(wgsl: string): {
    cache: GPUPipelineCache;
    targetsOf: () => GPUColorTargetState[][];
  } {
    vi.stubGlobal("GPUColorWrite", { ALL: 15 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const created: GPUColorTargetState[][] = [];
    const device = {
      createPipelineLayout: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({
        getCompilationInfo: (): Promise<object> => Promise.resolve({ messages: [] }),
      })),
      createRenderPipeline: vi.fn((d: GPURenderPipelineDescriptor): object => {
        created.push([...d.fragment!.targets] as GPUColorTargetState[]);
        return {};
      }),
    };
    const cache = Object.create(GPUPipelineCache.prototype) as GPUPipelineCache;
    Object.assign(cache as object, {
      _device: device,
      _pipelines: new Map(),
      _shaderModules: new Map(),
      _unwrappedNormalModules: new WeakSet(),
      _globalBGL: {},
      _objectBGL: {},
      _viewBGL: {},
      _shaderRegistry: {
        get: () => ({ sources: { wgsl } }),
        assemble: (s: string) => s,
      },
      getMaterialBGL: () => ({}),
    });
    return { cache, targetsOf: () => created };
  }

  const get = (cache: GPUPipelineCache, mode: NormalTargetMode): void => {
    cache.getPipeline(manifest, "triangle-list", false, "rgba16float", mode);
  };

  it("keeps the second target but masks it, so no @location(1) output is required", () => {
    const { cache, targetsOf } = makeCache(UNMATCHED_WGSL[0]!);
    get(cache, NormalTargetMode.WRITE);
    get(cache, NormalTargetMode.BLEND);

    for (const targets of targetsOf()) {
      expect(targets).toHaveLength(2);
      expect(targets[1]!.writeMask).toBe(0);
      expect(targets[1]!.blend).toBeUndefined();
    }
  });

  it("leaves NONE single-target", () => {
    const { cache, targetsOf } = makeCache(UNMATCHED_WGSL[0]!);
    get(cache, NormalTargetMode.NONE);
    expect(targetsOf()[0]).toHaveLength(1);
  });

  it("still writes normally for a matched shader", () => {
    const { cache, targetsOf } = makeCache(
      "@fragment fn fs(i: Out) -> @location(0) vec4f { return vec4f(1.0); }",
    );
    get(cache, NormalTargetMode.WRITE);
    expect(targetsOf()[0]![1]!.writeMask).toBe(15);
  });
});
