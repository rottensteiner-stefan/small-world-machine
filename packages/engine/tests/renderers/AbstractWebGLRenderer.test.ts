import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { AbstractWebGLRenderer } from "../../src/renderers/AbstractWebGLRenderer.js";
import { type WebGLRenderPass } from "../../src/renderers/WebGLRenderPass.js";
import { Scene } from "../../src/core/Scene.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { FluidSurfaceMaterial } from "../../src/core/materials/liquid/FluidSurfaceMaterial.js";
import { MaterialType, RendererType } from "../../src/enums/index.js";

// Dummy implementation of the abstract base class
class TestWebGLRenderer extends AbstractWebGLRenderer {
  public override readonly type: RendererType = RendererType.WEB_GL2;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    super();
    this.gl = gl;
  }

  public override async initialize(): Promise<void> {}
  public override setRenderTarget(): void {}
  public override renderBatch(): void {}
  protected override releaseObjectResources(): void {}
  public override resetStateCache(): void {}
  public override get isOffscreenRenderTarget(): boolean {
    return false;
  }
  public override bindMainRenderTarget(): boolean {
    return true;
  }
  public override bindPostProcessRenderTarget(): void {}
  public override copyToOpaqueTexture(): void {}
  public override copyToOpaqueDepthTexture(): void {}
  public override flushPostProcess(): void {}
}

describe("AbstractWebGLRenderer Pass System", () => {
  it("should iterate and execute all registered passes in order", () => {
    const mockGL = {
      canvas: {},
      viewport: vi.fn(),
      clear: vi.fn(),
      enable: vi.fn(),
      blendFunc: vi.fn(),
      COLOR_BUFFER_BIT: 1,
      DEPTH_BUFFER_BIT: 2,
      BLEND: 3,
      SRC_ALPHA: 4,
      ONE_MINUS_SRC_ALPHA: 5,
    } as unknown as WebGL2RenderingContext;

    const renderer = new TestWebGLRenderer(mockGL);

    // Create mock passes
    const pass1: WebGLRenderPass = {
      name: "Pass1",
      execute: vi.fn(),
    };
    const pass2: WebGLRenderPass = {
      name: "Pass2",
      execute: vi.fn(),
    };

    renderer.addPass(pass1);
    renderer.addPass(pass2);

    const scene = new Scene();
    const vp = new Float32Array(16);

    // Call the generic render method
    renderer.render(scene, vp);

    // Verify both passes were executed exactly once
    expect(pass1.execute).toHaveBeenCalledTimes(1);
    expect(pass2.execute).toHaveBeenCalledTimes(1);

    // Verify execution order (pass1 before pass2)
    const order1 = (pass1.execute as import("vitest").Mock).mock.invocationCallOrder[0]!;
    const order2 = (pass2.execute as import("vitest").Mock).mock.invocationCallOrder[0]!;
    expect(order1).toBeLessThan(order2);
  });

  it("clears stale dLight reference when directional light is removed or hidden (BLK-R4)", () => {
    const mockGL = {
      canvas: {},
    } as unknown as WebGL2RenderingContext;
    const renderer = new TestWebGLRenderer(mockGL);
    const scene = new Scene();

    const dLight = new DirectionalLight();
    scene.add(dLight);

    // Frame 1: dLight is active
    let extracted = renderer.extractLights(scene);
    expect(extracted.dLight).toBe(dLight);

    // Frame 2: dLight is hidden
    dLight.isVisible = false;
    extracted = renderer.extractLights(scene);
    expect(extracted.dLight).toBeUndefined();

    // Frame 3: dLight is made visible again
    dLight.isVisible = true;
    extracted = renderer.extractLights(scene);
    expect(extracted.dLight).toBe(dLight);

    // Frame 4: dLight is removed from scene
    scene.remove(dLight);
    extracted = renderer.extractLights(scene);
    expect(extracted.dLight).toBeUndefined();
  });
});

describe("AbstractWebGLRenderer.requiresOpaqueDepth", () => {
  it("is true only for shaders whose layout declares u_opaqueDepthMap", () => {
    const renderer = new TestWebGLRenderer({} as WebGL2RenderingContext);
    new FluidSurfaceMaterial(); // registers its shader provider
    expect(renderer.requiresOpaqueDepth(MaterialType.FLUID_SURFACE)).toBe(true);
    expect(renderer.requiresOpaqueDepth(MaterialType.PHONG)).toBe(false);
    expect(renderer.requiresOpaqueDepth("does-not-exist")).toBe(false);
  });

  it("does not cache an unregistered shader id, so a lazily registered one is asked again", () => {
    const renderer = new TestWebGLRenderer({} as WebGL2RenderingContext);
    expect(renderer.requiresOpaqueDepth("late-shader")).toBe(false);
    const cache = (renderer as unknown as { _opaqueDepthRequirement: Map<string, boolean> })
      ._opaqueDepthRequirement;
    expect(cache.has("late-shader")).toBe(false);
  });
});
