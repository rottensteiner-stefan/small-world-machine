import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { OpaqueCapture } from "../../src/renderers/WebGPU/managers/OpaqueCapture.js";
import { GPURenderTargetCache } from "../../src/renderers/WebGPU/managers/GPURenderTargetCache.js";
import { RenderTarget } from "../../src/core/textures/index.js";

(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

interface MockTexture {
  width: number;
  height: number;
  format: string;
  destroy: ReturnType<typeof vi.fn>;
  createView: ReturnType<typeof vi.fn>;
}

function makeDevice(): { device: GPUDevice; created: MockTexture[] } {
  const created: MockTexture[] = [];
  const device = {
    createTexture: vi.fn((desc: { size: number[]; format: string }) => {
      const tex: MockTexture = {
        width: desc.size[0]!,
        height: desc.size[1]!,
        format: desc.format,
        destroy: vi.fn(),
        createView: vi.fn(() => ({})),
      };
      created.push(tex);
      return tex;
    }),
  } as unknown as GPUDevice;
  return { device, created };
}

function makeSource(width: number, height: number, format = "depth32float"): GPUTexture {
  return { width, height, format } as unknown as GPUTexture;
}

const ce = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;

describe("OpaqueCapture: depth/normal snapshots are cached per target", () => {
  function setup(): {
    capture: OpaqueCapture;
    created: MockTexture[];
    deferred: GPUTexture[];
    offscreen: RenderTarget;
  } {
    const { device, created } = makeDevice();
    const deferred: GPUTexture[] = [];
    const fallback = { deferDestroyTexture: (t: GPUTexture): number => deferred.push(t) };
    const capture = new OpaqueCapture(device, fallback as never);
    const offscreen = RenderTarget.create({ width: 512, height: 512 });
    return { capture, created, deferred, offscreen };
  }

  it("keeps the screen depth view stable while an offscreen render captures in between", () => {
    const { capture, created, deferred, offscreen } = setup();
    const screenDepth = makeSource(1920, 1080);
    const reflectionDepth = makeSource(512, 512);

    const views: unknown[] = [];
    for (let frame = 0; frame < 3; frame++) {
      capture.captureOpaqueDepth(ce, reflectionDepth, offscreen);
      capture.captureOpaqueDepth(ce, screenDepth, null);
      views.push(capture.opaqueDepthView);
    }

    // Old behaviour: one shared slot, so every frame reallocated (offscreen size, then screen
    // size) and handed out a fresh view -- which invalidated the post passes' cached bind groups.
    expect(created).toHaveLength(2);
    expect(deferred).toHaveLength(0);
    expect(views[1]).toBe(views[0]);
    expect(views[2]).toBe(views[0]);
  });

  it("gives the offscreen target its own depth snapshot, distinct from the screen one", () => {
    const { capture, offscreen } = setup();
    capture.captureOpaqueDepth(ce, makeSource(1920, 1080), null);
    const screenView = capture.opaqueDepthView;
    capture.captureOpaqueDepth(ce, makeSource(512, 512), offscreen);
    expect(capture.opaqueDepthView).not.toBe(screenView);
  });

  it("reallocates a snapshot only when its own source size changes", () => {
    const { capture, created, deferred } = setup();
    capture.captureOpaqueDepth(ce, makeSource(800, 600), null);
    capture.captureOpaqueDepth(ce, makeSource(800, 600), null);
    expect(created).toHaveLength(1);
    capture.captureOpaqueDepth(ce, makeSource(1024, 768), null);
    expect(created).toHaveLength(2);
    expect(deferred).toEqual([created[0]]);
  });

  it("releaseTarget defers destruction of that target's snapshots only", () => {
    const { capture, created, deferred, offscreen } = setup();
    capture.captureOpaqueDepth(ce, makeSource(1920, 1080), null);
    capture.captureOpaqueDepth(ce, makeSource(512, 512), offscreen);
    capture.captureOpaqueTexture(ce, makeSource(512, 512, "rgba8unorm"), offscreen);

    capture.releaseTarget(offscreen);

    expect(new Set(deferred)).toEqual(new Set([created[1], created[2]]));
    expect(deferred).not.toContain(created[0]);
  });

  it("dispose destroys the screen depth and normal snapshots too", () => {
    const { capture, created } = setup();
    capture.captureOpaqueDepth(ce, makeSource(64, 64), null);
    capture.captureOpaqueNormal(ce, makeSource(64, 64, "rgba16float"));
    capture.dispose();
    expect(created[0]!.destroy).toHaveBeenCalled();
    expect(created[1]!.destroy).toHaveBeenCalled();
    expect(capture.opaqueDepthView).toBeUndefined();
  });
});

describe("GPURenderTargetCache.release", () => {
  it("destroys color + depth, forgets the target and unregisters it from the texture cache", () => {
    const { device, created } = makeDevice();
    const textures = {
      registerRenderTargetTexture: vi.fn(),
      unregisterRenderTarget: vi.fn(),
    };
    const cache = new GPURenderTargetCache(device, textures as never);
    const target = RenderTarget.create({ width: 64, height: 64, depth: true });

    cache.getActiveTargetView(target, "rgba8unorm", 0);
    expect(created).toHaveLength(2);
    expect(cache.colorTexture(target)).toBeDefined();

    cache.release(target);

    expect(created[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(created[1]!.destroy).toHaveBeenCalledTimes(1);
    expect(cache.colorTexture(target)).toBeUndefined();
    expect(textures.unregisterRenderTarget).toHaveBeenCalledWith(target);
    expect(target.isLoaded).toBe(false);
  });

  it("routes destruction through the supplied deferral and ignores unknown targets", () => {
    const { device, created } = makeDevice();
    const cache = new GPURenderTargetCache(device, {
      registerRenderTargetTexture: vi.fn(),
      unregisterRenderTarget: vi.fn(),
    } as never);
    const target = RenderTarget.create({ width: 8, height: 8, depth: false });
    cache.getActiveTargetView(target, "rgba8unorm", 0);
    const deferred: GPUTexture[] = [];

    cache.release(target, (t) => deferred.push(t));
    expect(deferred).toEqual([created[0]]);
    expect(created[0]!.destroy).not.toHaveBeenCalled();

    expect(() => cache.release(RenderTarget.create({ width: 1, height: 1 }))).not.toThrow();
  });
});
