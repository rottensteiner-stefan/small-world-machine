import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { RenderTargetCube } from "../../src/core/textures/RenderTargetCube.js";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

function makeMockGl(): WebGLRenderingContext {
  return {
    createFramebuffer: vi.fn(() => ({})),
    bindFramebuffer: vi.fn(),
    deleteFramebuffer: vi.fn(),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    deleteTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    createRenderbuffer: vi.fn(() => ({})),
    bindRenderbuffer: vi.fn(),
    deleteRenderbuffer: vi.fn(),
    renderbufferStorage: vi.fn(),
    framebufferRenderbuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    viewport: vi.fn(),
    FRAMEBUFFER: 1,
    TEXTURE_2D: 2,
    TEXTURE_CUBE_MAP: 3,
    TEXTURE_CUBE_MAP_POSITIVE_X: 100,
    RGBA: 4,
    UNSIGNED_BYTE: 5,
    TEXTURE_MIN_FILTER: 6,
    TEXTURE_MAG_FILTER: 7,
    LINEAR: 8,
    TEXTURE_WRAP_S: 9,
    TEXTURE_WRAP_T: 10,
    CLAMP_TO_EDGE: 11,
    RENDERBUFFER: 12,
    DEPTH_COMPONENT16: 13,
    DEPTH_ATTACHMENT: 14,
    COLOR_ATTACHMENT0: 15,
  } as unknown as WebGLRenderingContext;
}

// `DynamicReflectionProbe` (and anything else that renders into a `RenderTargetCube`) drives every
// mirror-sphere-style material's `u_envMap`. WebGL1Renderer used to have no concept of a cube
// render target at all -- `setRenderTarget`/`bindMainRenderTarget` only knew flat 2D
// `RenderTarget`s, so a `RenderTargetCube` fell into that same branch and got allocated as a plain
// `TEXTURE_2D`, and `getWebGLCubeTexture` never recognized it as anything other than a broken,
// image-less `CubeTexture` and silently handed back the black default. These tests pin down the
// real cube-map FBO path (which now routes its cube bookkeeping through the shared
// `WebGLTextureManager` the renderer mounts on initialize) -- this fixed Showcase 15's spheres
// going fully black under WebGL1.
describe("WebGL1Renderer RenderTargetCube support", () => {
  function mountRenderer(gl: WebGLRenderingContext): WebGL1Renderer {
    const renderer = new WebGL1Renderer();
    (renderer as RendererInternals).gl = gl;
    // `initialize()` (and its context mock) is not worth fabricating here -- mount the shared
    // texture manager exactly as initialize() does, so bindMainRenderTarget's cube path works.
    (renderer as RendererInternals)._textures = new WebGLTextureManager(
      gl,
      (renderer as RendererInternals)._texCache,
      {} as never,
      {} as never,
      { dialect: "glsl100" },
    );
    return renderer;
  }

  it("allocates a real TEXTURE_CUBE_MAP (not TEXTURE_2D) and attaches the requested face", () => {
    const gl = makeMockGl();
    const renderer = mountRenderer(gl);

    const cube = RenderTargetCube.create({ width: 64, height: 64 });
    renderer.setRenderTarget(cube, 3 /* TEXTURE_CUBE_MAP_NEGATIVE_X */);
    renderer.bindMainRenderTarget();

    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_CUBE_MAP, expect.anything());
    expect(gl.bindTexture).not.toHaveBeenCalledWith(gl.TEXTURE_2D, expect.anything());
    expect(gl.texImage2D).toHaveBeenCalledTimes(6); // one upload per cube face

    expect(gl.framebufferTexture2D).toHaveBeenCalledWith(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 3,
      expect.anything(),
      0,
    );
  });

  it("makes the render target's GL texture available through getWebGLCubeTexture", () => {
    const gl = makeMockGl();
    const renderer = mountRenderer(gl);

    const cube = RenderTargetCube.create({ width: 64, height: 64 });
    renderer.setRenderTarget(cube, 0);
    renderer.bindMainRenderTarget();

    // This is exactly the lookup every sampler-bound material (e.g. a mirror sphere's u_envMap)
    // goes through -- it must resolve to the real cube texture, not the black fallback.
    const resolved = (renderer as RendererInternals)._textures.getWebGLCubeTexture(cube, undefined);
    expect(resolved).not.toBe((renderer as RendererInternals).defaultCubeTexture);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
  });

  it("reuses the same FBO/texture across faces instead of recreating them", () => {
    const gl = makeMockGl();
    const renderer = mountRenderer(gl);

    const cube = RenderTargetCube.create({ width: 64, height: 64 });

    renderer.setRenderTarget(cube, 0);
    renderer.bindMainRenderTarget();
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);

    renderer.setRenderTarget(cube, 1);
    renderer.bindMainRenderTarget();
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.framebufferTexture2D).toHaveBeenLastCalledWith(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 1,
      expect.anything(),
      0,
    );
  });
});
