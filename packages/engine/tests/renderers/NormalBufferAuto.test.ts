import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { AbstractWebGLRenderer } from "../../src/renderers/AbstractWebGLRenderer.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { Scene, type RenderList } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RendererType } from "../../src/enums/index.js";
import type { QualityConfig } from "../../src/interfaces/index.js";

class TestRenderer extends AbstractWebGLRenderer {
  public override readonly type: RendererType = RendererType.WEB_GL2;
  public offscreen: boolean = false;

  constructor(normalBuffer?: boolean | "auto") {
    super();
    this.gl = { canvas: {} } as unknown as WebGL2RenderingContext;
    if (normalBuffer !== undefined) this._quality = { ...this._quality, normalBuffer };
    this._resolveNormalBufferOption();
  }

  public override async initialize(): Promise<void> {}
  public override setRenderTarget(): void {}
  public override renderBatch(): void {}
  protected override releaseObjectResources(): void {}
  public override resetStateCache(): void {}
  public override get isOffscreenRenderTarget(): boolean {
    return this.offscreen;
  }
  public override bindMainRenderTarget(): boolean {
    return true;
  }
  public override bindPostProcessRenderTarget(): void {}
  public override copyToOpaqueTexture(): void {}
  public override copyToOpaqueDepthTexture(): void {}
  public override flushPostProcess(): void {}
}

function sceneWithDecals(count: number): Scene {
  const scene = new Scene();
  const list = {
    opaqueBatches: [],
    transparent: [],
    decals: Array.from({ length: count }, () => new Object3D()),
  } as unknown as RenderList;
  vi.spyOn(scene, "getVisibleObjectsSorted").mockReturnValue(list);
  return scene;
}

describe("quality.normalBuffer auto (ADR 0028)", () => {
  it("stays off while no decal is visible", () => {
    const r = new TestRenderer();
    r.render(sceneWithDecals(0), new Float32Array(16));
    expect(r.quality.normalBuffer).toBe(false);
  });

  it("switches on when a decal is visible and stays on afterwards", () => {
    const r = new TestRenderer();
    r.render(sceneWithDecals(1), new Float32Array(16));
    expect(r.quality.normalBuffer).toBe(true);
    r.render(sceneWithDecals(0), new Float32Array(16));
    expect(r.quality.normalBuffer).toBe(true);
  });

  it("ignores decals seen by offscreen passes", () => {
    const r = new TestRenderer();
    r.offscreen = true;
    r.render(sceneWithDecals(1), new Float32Array(16));
    expect(r.quality.normalBuffer).toBe(false);
  });

  it("never changes an explicit boolean", () => {
    const off = new TestRenderer(false);
    off.render(sceneWithDecals(1), new Float32Array(16));
    expect(off.quality.normalBuffer).toBe(false);
    const on = new TestRenderer(true);
    expect(on.quality.normalBuffer).toBe(true);
    expect(on.requestNormalBuffer()).toBe(false);
  });

  it("WebGL2 drops an HDR FBO without normal attachment so it is rebuilt with one", () => {
    const r = new WebGL2Renderer();
    const q = r as unknown as { _quality: QualityConfig; _hdrFbo: unknown };
    q._quality = { ...q._quality };
    (r as unknown as { _resolveNormalBufferOption(): void })._resolveNormalBufferOption();
    const destroy = vi.fn();
    q._hdrFbo = { secondaryTexture: undefined, destroy };

    expect(r.requestNormalBuffer()).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(q._hdrFbo).toBeUndefined();
    expect(r.requestNormalBuffer()).toBe(false);
  });
});
