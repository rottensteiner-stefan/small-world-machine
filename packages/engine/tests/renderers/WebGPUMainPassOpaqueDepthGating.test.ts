import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { MainRenderPass } from "../../src/renderers/passes/MainRenderPass.js";
import skyboxVertWGSL from "../../src/renderers/shaders/source/web_gpu/skybox.vert.wgsl?raw";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function run(opts: {
  offscreen: boolean;
  postEnabled: boolean;
  requiresDepth: boolean;
  normalView?: object;
}): { renderer: Internals; ce: Internals; descriptors: Internals[] } {
  const descriptors: Internals[] = [];
  const renderer: Internals = {
    activeNormalView: opts.normalView,
    activeDepthView: {},
    activeRenderTarget: opts.offscreen ? {} : null,
    clearColor: { r: 0, g: 0, b: 0, a: 1 },
    canDrawDecals: !opts.offscreen,
    postProcessing: { enabled: opts.postEnabled, requiresOpaqueDepth: opts.requiresDepth },
    captureOpaqueDepth: vi.fn(),
    captureOpaqueNormal: vi.fn(),
    captureOpaqueTexture: vi.fn(),
    _renderBatch: vi.fn(),
  };
  const scene: Internals = {
    getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches: [], decals: [], transparent: [] })),
  };
  const ce: Internals = {
    beginRenderPass: vi.fn((d: Internals) => {
      // Snapshot: the descriptor objects are reused, so record what the pass saw right now.
      descriptors.push(JSON.parse(JSON.stringify(d)));
      return { end: vi.fn() };
    }),
  };
  new MainRenderPass().execute(renderer, scene, ce, {} as GPUTextureView, new Float32Array(16), {
    x: 0,
    y: 0,
    z: 0,
  } as never);
  return { renderer, ce, descriptors };
}

describe("MainRenderPass: opaque depth copy gating (A3)", () => {
  it("copies depth for the main camera target when a post effect needs it", () => {
    const { renderer } = run({ offscreen: false, postEnabled: true, requiresDepth: true });
    expect(renderer.captureOpaqueDepth).toHaveBeenCalledTimes(1);
  });

  it("skips the copy for offscreen renders: the post chain never runs there", () => {
    const { renderer } = run({ offscreen: true, postEnabled: true, requiresDepth: true });
    expect(renderer.captureOpaqueDepth).not.toHaveBeenCalled();
  });

  it("skips the copy while post-processing is disabled", () => {
    const { renderer } = run({ offscreen: false, postEnabled: false, requiresDepth: true });
    expect(renderer.captureOpaqueDepth).not.toHaveBeenCalled();
  });
});

describe("MainRenderPass: reused pass descriptors (K1)", () => {
  it("builds the same attachment layout as before, with and without the normal buffer", () => {
    const withNormal = run({
      offscreen: false,
      postEnabled: false,
      requiresDepth: false,
      normalView: {},
    });
    expect(withNormal.descriptors[0].colorAttachments).toHaveLength(2);
    expect(withNormal.descriptors[0].colorAttachments[0].loadOp).toBe("clear");

    const without = run({ offscreen: false, postEnabled: false, requiresDepth: false });
    expect(without.descriptors[0].colorAttachments).toHaveLength(1);
    expect(without.descriptors[0].depthStencilAttachment.depthLoadOp).toBe("load");
  });

  it("allocates no new descriptor objects between frames", () => {
    const pass = new MainRenderPass();
    const seen: unknown[] = [];
    const renderer: Internals = {
      activeNormalView: undefined,
      activeDepthView: {},
      activeRenderTarget: null,
      clearColor: { r: 0, g: 0, b: 0, a: 1 },
      canDrawDecals: true,
      postProcessing: { enabled: false, requiresOpaqueDepth: false },
      _renderBatch: vi.fn(),
    };
    const scene: Internals = {
      getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches: [], decals: [], transparent: [] })),
    };
    const ce: Internals = {
      beginRenderPass: vi.fn((d: unknown) => {
        seen.push(d);
        return { end: vi.fn() };
      }),
    };
    for (let i = 0; i < 3; i++) {
      pass.execute(renderer, scene, ce, {} as GPUTextureView, new Float32Array(16), {
        x: 0,
        y: 0,
        z: 0,
      } as never);
    }
    expect(new Set(seen).size).toBe(1);
  });
});

describe("skybox.vert.wgsl (A15)", () => {
  it("applies only the model's linear part so a translated skybox object is not shifted", () => {
    expect(skyboxVertWGSL).toMatch(/obj\.model\s*\*\s*vec4f\(pos,\s*0\.0\)/);
    expect(skyboxVertWGSL).not.toMatch(/obj\.model\s*\*\s*vec4f\(pos,\s*1\.0\)/);
  });
});
