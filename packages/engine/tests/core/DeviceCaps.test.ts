import { describe, it, expect, vi } from "vitest";
import { DeviceCaps } from "../../src/core/DeviceCaps.js";

/** Minimal stand-in for a WebGL(2)RenderingContext -- just enough for `DeviceCaps.init()`'s
 * limit/extension probing, plus a spy-able `WEBGL_lose_context` extension so the leak fix can be
 * verified directly. */
function makeMockGlContext(): {
  getParameter: ReturnType<typeof vi.fn>;
  getExtension: ReturnType<typeof vi.fn>;
  loseContext: ReturnType<typeof vi.fn>;
} {
  const loseContext = vi.fn();
  const getExtension = vi.fn((name: string) => {
    if (name === "WEBGL_lose_context") return { loseContext };
    return null;
  });
  const getParameter = vi.fn(() => 1);
  return { getParameter, getExtension, loseContext };
}

describe("DeviceCaps.init() -- throwaway WebGL probe context cleanup", () => {
  it("releases the WebGL1 probe context via WEBGL_lose_context after reading its limits", () => {
    const mockGl = makeMockGlContext();
    const getContext = vi.fn((type: string) => (type === "webgl" ? mockGl : null));
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ getContext })),
    });

    const caps = new DeviceCaps();
    caps.init();

    expect(mockGl.getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(mockGl.loseContext).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("releases the WebGL2 probe context via WEBGL_lose_context after reading its limits", () => {
    const mockGl2 = makeMockGlContext();
    const getContext = vi.fn((type: string) => (type === "webgl2" ? mockGl2 : null));
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ getContext })),
    });

    const caps = new DeviceCaps();
    caps.init();

    expect(mockGl2.getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(mockGl2.loseContext).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("does not throw and still reports no WebGL support when no context is available at all", () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ getContext: vi.fn(() => null) })),
    });

    const caps = new DeviceCaps();
    expect(() => caps.init()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("only initializes once even if init() is called multiple times on the same instance", () => {
    const mockGl = makeMockGlContext();
    const getContext = vi.fn((type: string) => (type === "webgl" ? mockGl : null));
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ getContext })),
    });

    const caps = new DeviceCaps();
    caps.init();
    caps.init();

    expect(mockGl.loseContext).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
