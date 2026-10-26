import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGLMainPass } from "../../src/renderers/passes/WebGLMainPass.js";
import { Vector3D } from "../../src/math/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

// Regression: transparent and post-process draws leave gl.depthMask(false) behind. The next
// frame's gl.clear(COLOR | DEPTH) then silently skips the depth buffer (a masked depth clear is a
// no-op), keeping the previous frame's depth. It only stayed hidden while a shadow pass happened to
// call depthMask(true) first -- with castShadow = false on the sun the image went black.
describe("WebGLMainPass depth clear", () => {
  it("enables depth writes (and resyncs the state cache) before it clears the depth buffer", () => {
    const calls: string[] = [];
    const gl = {
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x100,
      BLEND: 0xbe2,
      SRC_ALPHA: 0x302,
      ONE_MINUS_SRC_ALPHA: 0x303,
      clear: vi.fn((mask: number) => calls.push(`clear:${mask & 0x100 ? "depth" : "nodepth"}`)),
      clearColor: vi.fn(),
      depthMask: vi.fn((on: boolean) => calls.push(`depthMask:${on}`)),
      enable: vi.fn(),
      blendFunc: vi.fn(),
    };
    const renderer: Internals = {
      webglContext: gl,
      bindMainRenderTarget: vi.fn(),
      resetStateCache: vi.fn(() => calls.push("resetStateCache")),
      targetClearColor: { r: 0, g: 0, b: 0, a: 1 },
      renderBatch: vi.fn(),
      copyToOpaqueDepthTexture: vi.fn(),
      copyToOpaqueTexture: vi.fn(),
      postProcessing: { get: vi.fn(() => undefined) },
    };
    const renderList: Internals = { opaqueBatches: [], transparent: [], decals: [] };

    new WebGLMainPass().execute(
      renderer,
      {} as Internals,
      new Float32Array(16),
      new Vector3D(0, 0, 0),
      undefined,
      renderList,
      {} as Internals,
    );

    const clearIdx = calls.indexOf("clear:depth");
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    const maskBeforeClear = calls.slice(0, clearIdx).lastIndexOf("depthMask:true");
    expect(maskBeforeClear).toBeGreaterThanOrEqual(0);
    // No depthMask(false) may sit between the enabling call and the clear.
    expect(calls.slice(maskBeforeClear, clearIdx)).not.toContain("depthMask:false");
    // The renderer's cached depth-mask state must be dropped, or its next draw could skip a
    // needed gl.depthMask call because it still believes the old value is active.
    expect(calls.slice(0, clearIdx)).toContain("resetStateCache");
  });
});
