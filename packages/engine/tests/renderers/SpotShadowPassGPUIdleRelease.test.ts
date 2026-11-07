import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { SpotShadowPassGPU } from "../../src/renderers/passes/SpotShadowPassGPU.js";

interface Internals {
  _fbo?: GPUTexture;
  _dummyTargets: Map<string, { tex: GPUTexture; view: GPUTextureView; resolution: number }>;
  _releaseIdleAtlas(renderer: unknown, scene: unknown): void;
}

describe("SpotShadowPassGPU idle release", () => {
  it("also releases the dummy colour targets together with the idle atlas", () => {
    const pass = new SpotShadowPassGPU() as unknown as Internals;
    const atlas = { id: "atlas" } as unknown as GPUTexture;
    const dummyTex = { id: "dummy" } as unknown as GPUTexture;
    pass._fbo = atlas;
    pass._dummyTargets.set("rgba16float", {
      tex: dummyTex,
      view: {} as GPUTextureView,
      resolution: 1024,
    });
    const deferDestroyTexture = vi.fn();
    const renderer = {
      deferDestroyTexture,
      dummySpotShadowTextureView: {},
      _createGlobalBindGroup: vi.fn(() => ({})),
    };

    for (let i = 0; i < 120; i++) pass._releaseIdleAtlas(renderer, {});

    expect(deferDestroyTexture).toHaveBeenCalledWith(atlas);
    expect(deferDestroyTexture).toHaveBeenCalledWith(dummyTex);
    expect(pass._dummyTargets.size).toBe(0);
  });
});
