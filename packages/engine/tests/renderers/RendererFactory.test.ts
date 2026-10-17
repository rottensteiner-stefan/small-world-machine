import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { RendererFactory } from "../../src/renderers/RendererFactory.js";
import { RendererType } from "../../src/enums/index.js";
import { DeviceFeature, DeviceCaps } from "../../src/core/DeviceCaps.js";
import type { RendererContext } from "../../src/interfaces/index.js";
import { WebGPURenderer } from "../../src/renderers/WebGPU/index.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/index.js";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/index.js";

function makeMockContext(features: {
  webgpu?: boolean;
  webgl2?: boolean;
  webgl1?: boolean;
}): RendererContext {
  const caps = new DeviceCaps();
  vi.spyOn(caps, "init").mockImplementation(() => {});
  vi.spyOn(caps, "hasFeature").mockImplementation((feature: DeviceFeature) => {
    if (feature === DeviceFeature.WEBGPU) return !!features.webgpu;
    if (feature === DeviceFeature.WEBGL2) return !!features.webgl2;
    if (feature === DeviceFeature.WEBGL1) return !!features.webgl1;
    return false;
  });

  return {
    deviceCaps: caps,
    shaderRegistry: {} as unknown as RendererContext["shaderRegistry"],
    assetManager: {} as unknown as RendererContext["assetManager"],
  };
}

describe("RendererFactory Fallback Cascade (BLK-R5)", () => {
  const dummyCanvas = {} as HTMLCanvasElement;

  it("cascades WebGPU -> WebGL2 -> WebGL1 when WebGPU is unsupported and WebGL2 init throws", async () => {
    const context = makeMockContext({ webgpu: false, webgl2: true, webgl1: true });

    // Mock WebGL2Renderer.initialize to fail
    vi.spyOn(WebGL2Renderer.prototype, "initialize").mockRejectedValue(
      new Error("WebGL2 driver blocklisted"),
    );
    // Mock WebGL1Renderer.initialize to succeed
    vi.spyOn(WebGL1Renderer.prototype, "initialize").mockResolvedValue(undefined);

    const renderer = await RendererFactory.create(
      RendererType.WEB_GPU,
      dummyCanvas,
      undefined,
      context,
    );

    expect(renderer).toBeInstanceOf(WebGL1Renderer);
  });

  it("cascades WebGPU -> WebGL2 -> WebGL1 when WebGPU init throws and WebGL2 init throws", async () => {
    const context = makeMockContext({ webgpu: true, webgl2: true, webgl1: true });

    vi.spyOn(WebGPURenderer.prototype, "initialize").mockRejectedValue(
      new Error("WebGPU device lost / adapter unavailable"),
    );
    vi.spyOn(WebGL2Renderer.prototype, "initialize").mockRejectedValue(
      new Error("WebGL2 context lost"),
    );
    vi.spyOn(WebGL1Renderer.prototype, "initialize").mockResolvedValue(undefined);

    const renderer = await RendererFactory.create(
      RendererType.WEB_GPU,
      dummyCanvas,
      undefined,
      context,
    );

    expect(renderer).toBeInstanceOf(WebGL1Renderer);
  });

  it("cascades WebGL2 -> WebGL1 when WebGL2 is unsupported by device caps", async () => {
    const context = makeMockContext({ webgpu: false, webgl2: false, webgl1: true });

    vi.spyOn(WebGL1Renderer.prototype, "initialize").mockResolvedValue(undefined);

    const renderer = await RendererFactory.create(
      RendererType.WEB_GL2,
      dummyCanvas,
      undefined,
      context,
    );

    expect(renderer).toBeInstanceOf(WebGL1Renderer);
  });

  it("cascades WebGL2 -> WebGL1 when WebGL2 init throws", async () => {
    const context = makeMockContext({ webgpu: false, webgl2: true, webgl1: true });

    vi.spyOn(WebGL2Renderer.prototype, "initialize").mockRejectedValue(
      new Error("WebGL2 unsupported context"),
    );
    vi.spyOn(WebGL1Renderer.prototype, "initialize").mockResolvedValue(undefined);

    const renderer = await RendererFactory.create(
      RendererType.WEB_GL2,
      dummyCanvas,
      undefined,
      context,
    );

    expect(renderer).toBeInstanceOf(WebGL1Renderer);
  });

  it("returns WebGPURenderer directly when WebGPU is supported and succeeds", async () => {
    const context = makeMockContext({ webgpu: true, webgl2: true, webgl1: true });

    vi.spyOn(WebGPURenderer.prototype, "initialize").mockResolvedValue(undefined);

    const renderer = await RendererFactory.create(
      RendererType.WEB_GPU,
      dummyCanvas,
      undefined,
      context,
    );

    expect(renderer).toBeInstanceOf(WebGPURenderer);
  });

  it("throws when all candidates in the cascade fail", async () => {
    const context = makeMockContext({ webgpu: false, webgl2: false, webgl1: false });

    await expect(
      RendererFactory.create(RendererType.WEB_GPU, dummyCanvas, undefined, context),
    ).rejects.toThrow(/Failed to initialize renderer/);
  });
});
