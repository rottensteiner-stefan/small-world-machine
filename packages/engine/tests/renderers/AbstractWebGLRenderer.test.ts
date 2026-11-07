import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { AbstractWebGLRenderer } from "../../src/renderers/AbstractWebGLRenderer.js";
import { type WebGLRenderPass } from "../../src/renderers/WebGLRenderPass.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { FluidSurfaceMaterial } from "../../src/core/materials/liquid/FluidSurfaceMaterial.js";
import { PhongMaterial } from "../../src/core/materials/surface/PhongMaterial.js";
import { MaterialType, RendererType } from "../../src/enums/index.js";

// Dummy implementation of the abstract base class
class TestWebGLRenderer extends AbstractWebGLRenderer {
  public override readonly type: RendererType = RendererType.WEB_GL2;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    super();
    this.gl = gl;
  }

  public restoredCount = 0;

  public override async initialize(): Promise<void> {}
  public install(canvas: HTMLCanvasElement): void {
    this.installContextLossHandling(canvas);
  }
  public uninstall(): void {
    this.uninstallContextLossHandling();
  }
  protected override onContextRestored(): void {
    this.restoredCount++;
  }
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

describe("AbstractWebGLRenderer context loss", () => {
  function setup(): {
    renderer: TestWebGLRenderer;
    canvas: HTMLCanvasElement;
    pass: WebGLRenderPass;
  } {
    const renderer = new TestWebGLRenderer({ canvas: {} } as unknown as WebGL2RenderingContext);
    const canvas = new EventTarget() as unknown as HTMLCanvasElement;
    renderer.install(canvas);
    const pass: WebGLRenderPass = { name: "P", execute: vi.fn() };
    renderer.addPass(pass);
    return { renderer, canvas, pass };
  }

  it("accepts the loss (preventDefault), pauses rendering and reports it", () => {
    const { renderer, canvas, pass } = setup();
    const onLost = vi.fn();
    renderer.onContextLost = onLost;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const event = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true); // tells the browser we want the context back
    expect(renderer.isContextLost).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    renderer.render(new Scene(), new Float32Array(16));
    expect(pass.execute).not.toHaveBeenCalled(); // no exception storm, no draw calls
    warn.mockRestore();
  });

  it("rebuilds the GPU resources on restore and resumes rendering", () => {
    const { renderer, canvas, pass } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

    canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(renderer.restoredCount).toBe(1);
    expect(renderer.isContextLost).toBe(false);
    renderer.render(new Scene(), new Float32Array(16));
    expect(pass.execute).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("stops listening once uninstalled", () => {
    const { renderer, canvas } = setup();
    renderer.uninstall();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(renderer.isContextLost).toBe(false);
  });
});

describe("AbstractRenderer.extractLights frame memo", () => {
  const memoize = (renderer: object, scene: Scene | undefined): void =>
    (renderer as unknown as { memoizeLightsFor: (s: Scene | undefined) => void }).memoizeLightsFor(
      scene,
    );

  it("serves repeated requests for the memoized scene without walking it again, then goes fresh", () => {
    const renderer = new TestWebGLRenderer({ canvas: {} } as unknown as WebGL2RenderingContext);
    const scene = new Scene();
    const dLight = new DirectionalLight();
    scene.add(dLight);

    expect(renderer.extractLights(scene).dLight).toBe(dLight);
    memoize(renderer, scene);

    // A shadow pass asking again within the frame gets the snapshot, not a second traversal.
    dLight.isVisible = false;
    expect(renderer.extractLights(scene).dLight).toBe(dLight);

    // Frame over: the next extraction sees the change.
    memoize(renderer, undefined);
    expect(renderer.extractLights(scene).dLight).toBeUndefined();
  });

  it("never serves the memo for a different scene (offscreen / reflection passes)", () => {
    const renderer = new TestWebGLRenderer({ canvas: {} } as unknown as WebGL2RenderingContext);
    const main = new Scene();
    main.add(new DirectionalLight());
    const other = new Scene();

    renderer.extractLights(main);
    memoize(renderer, main);

    expect(renderer.extractLights(other).dLight).toBeUndefined();
  });
});

describe("AbstractWebGLRenderer.requiresOpaqueDepth", () => {
  it("is true only for shaders whose layout declares u_opaqueDepthMap", () => {
    const renderer = new TestWebGLRenderer({} as WebGL2RenderingContext);
    const registry = renderer.context.shaderRegistry;
    registry.ensureProvider(MaterialType.FLUID_SURFACE, new FluidSurfaceMaterial());
    registry.ensureProvider(MaterialType.PHONG, new PhongMaterial());
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

describe("AbstractWebGLRenderer render-list provider hand-over (ADR 0032)", () => {
  it("registers the material of every batch, transparent and decal object on the renderer's registry", () => {
    const renderer = new TestWebGLRenderer({} as WebGL2RenderingContext);
    const opaque = new Object3D("opaque");
    opaque.material = new PhongMaterial();
    const glassy = new Object3D("glassy");
    glassy.material = new FluidSurfaceMaterial();

    (
      renderer as unknown as { _registerRenderListProviders(list: unknown): void }
    )._registerRenderListProviders({
      opaqueBatches: [{ shaderId: MaterialType.PHONG, objects: [opaque] }],
      transparent: [glassy],
      decals: [],
    });

    const registry = renderer.context.shaderRegistry;
    expect(registry.get(MaterialType.PHONG)).toBeDefined();
    expect(registry.get(MaterialType.FLUID_SURFACE)).toBeDefined();
  });
});
