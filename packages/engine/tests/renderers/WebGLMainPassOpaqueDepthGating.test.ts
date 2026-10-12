import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGLMainPass } from "../../src/renderers/passes/WebGLMainPass.js";
import { Vector3D } from "../../src/math/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

/**
 * The opaque depth capture (a framebuffer blit) must run only when a transparent material samples
 * u_opaqueDepthMap -- or when post-processing owns an HDR FBO and always did -- and never for a
 * scene without such materials (zero cost).
 */
function run(opts: {
  ppEnabled: boolean;
  transparentTypes: string[];
  needsDepth: (type: string) => boolean;
}): { depth: ReturnType<typeof vi.fn>; color: ReturnType<typeof vi.fn> } {
  const gl = {
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x100,
    BLEND: 0xbe2,
    SRC_ALPHA: 0x302,
    ONE_MINUS_SRC_ALPHA: 0x303,
    clear: vi.fn(),
    depthMask: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
  };
  const depth = vi.fn();
  const color = vi.fn();
  const renderer: Internals = {
    webglContext: gl,
    bindMainRenderTarget: vi.fn(),
    resetStateCache: vi.fn(),
    renderBatch: vi.fn(),
    copyToOpaqueDepthTexture: depth,
    copyToOpaqueTexture: color,
    requiresOpaqueDepth: vi.fn(opts.needsDepth),
    postProcessing: { enabled: opts.ppEnabled, get: vi.fn(() => undefined) },
  };
  const transparent = opts.transparentTypes.map((type) => ({
    material: {
      type,
      uuid: type,
      getRenderManifest: (): { shaderId: string } => ({ shaderId: type }),
    },
    geometry: undefined,
  }));
  new WebGLMainPass().execute(
    renderer,
    {} as Internals,
    new Float32Array(16),
    new Vector3D(0, 0, 0),
    undefined,
    { opaqueBatches: [], transparent, decals: [] } as Internals,
    {} as Internals,
  );
  return { depth, color };
}

describe("WebGLMainPass opaque depth capture gating", () => {
  const needs = (t: string): boolean => t === "needs-depth";

  it("skips the depth blit when no transparent material samples the depth map (no post-processing)", () => {
    const { depth } = run({
      ppEnabled: false,
      transparentTypes: ["glass", "sprite"],
      needsDepth: needs,
    });
    expect(depth).not.toHaveBeenCalled();
  });

  it("captures once when any transparent material needs it, even if it is not the first", () => {
    const { depth } = run({
      ppEnabled: false,
      transparentTypes: ["glass", "needs-depth", "needs-depth"],
      needsDepth: needs,
    });
    expect(depth).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy always-capture behaviour while post-processing is enabled", () => {
    const { depth } = run({ ppEnabled: true, transparentTypes: ["glass"], needsDepth: needs });
    expect(depth).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when there are no transparent objects", () => {
    const { depth, color } = run({ ppEnabled: false, transparentTypes: [], needsDepth: needs });
    expect(depth).not.toHaveBeenCalled();
    expect(color).not.toHaveBeenCalled();
  });
});
