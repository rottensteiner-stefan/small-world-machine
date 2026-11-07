import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import type { LightDataInterface, Renderer } from "../../src/interfaces/index.js";
import { RenderTarget } from "../../src/core/textures/index.js";
import { PlanarReflectionNode } from "../../src/core/reflection/PlanarReflectionNode.js";

/** Private state the lifetime tests have to plant/inspect (the renderers need a real context to
 * initialize, which is not worth faking). */
interface Gl2Internals {
  gl: WebGL2RenderingContext;
  _clusterGridTex?: WebGLTexture;
  _clusterIndexTex?: WebGLTexture;
  _opaqueTexture?: WebGLTexture;
  _opaqueDepthTexture?: WebGLTexture;
  _opaqueDepthFbo?: WebGLFramebuffer;
  _blackCubeTexture?: WebGLTexture;
  _defaultBrdfTexture?: WebGLTexture;
  _shadowMaps: Map<object, { destroy: () => void }>;
  _renderTargetFbos: Map<object, { destroy: () => void }>;
  _textures: {
    unregisterTexture: (t: object) => void;
    unregisterCubeTexture: (t: object) => void;
  };
  _texCache: Map<object, object>;
  _allocateClusterTextures: (dims: { x: number; y: number; z: number }, max: number) => void;
}

function mockGl2(): WebGL2RenderingContext {
  return {
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteRenderbuffer: vi.fn(),
    deleteSampler: vi.fn(),
    getExtension: vi.fn(() => null),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    pixelStorei: vi.fn(),
    getParameter: vi.fn(() => 16384),
    TEXTURE_2D: 1,
    TEXTURE_MIN_FILTER: 2,
    TEXTURE_MAG_FILTER: 3,
    NEAREST: 4,
    TEXTURE_WRAP_S: 5,
    TEXTURE_WRAP_T: 6,
    CLAMP_TO_EDGE: 7,
  } as unknown as WebGL2RenderingContext;
}

const NO_LIGHTS: LightDataInterface = {
  aLights: [],
  pLights: [],
  sLights: [],
} as unknown as LightDataInterface;

describe("WebGL2Renderer resource lifetime", () => {
  it("destroy() frees the cluster, opaque-capture and default textures it owns", () => {
    const gl = mockGl2();
    const renderer = new WebGL2Renderer();
    const internals = renderer as unknown as Gl2Internals;
    internals.gl = gl;
    const owned = {
      grid: {} as WebGLTexture,
      index: {} as WebGLTexture,
      opaque: {} as WebGLTexture,
      depth: {} as WebGLTexture,
      cube: {} as WebGLTexture,
      brdf: {} as WebGLTexture,
    };
    internals._clusterGridTex = owned.grid;
    internals._clusterIndexTex = owned.index;
    internals._opaqueTexture = owned.opaque;
    internals._opaqueDepthTexture = owned.depth;
    const depthFbo = {} as WebGLFramebuffer;
    internals._opaqueDepthFbo = depthFbo;
    internals._blackCubeTexture = owned.cube;
    internals._defaultBrdfTexture = owned.brdf;

    renderer.destroy();

    for (const tex of Object.values(owned)) {
      expect(gl.deleteTexture).toHaveBeenCalledWith(tex);
    }
    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(depthFbo);
  });

  it("deletes the previous cluster textures when the grid is re-allocated", () => {
    const gl = mockGl2();
    const renderer = new WebGL2Renderer();
    const internals = renderer as unknown as Gl2Internals;
    internals.gl = gl;

    internals._allocateClusterTextures({ x: 2, y: 2, z: 2 }, 4);
    const firstGrid = internals._clusterGridTex;
    const firstIndex = internals._clusterIndexTex;
    expect(gl.deleteTexture).not.toHaveBeenCalled();

    internals._allocateClusterTextures({ x: 4, y: 4, z: 4 }, 4);

    expect(gl.deleteTexture).toHaveBeenCalledWith(firstGrid);
    expect(gl.deleteTexture).toHaveBeenCalledWith(firstIndex);
  });

  it("frees the shadow map of a light that no longer casts a shadow", () => {
    const renderer = new WebGL2Renderer();
    const internals = renderer as unknown as Gl2Internals;
    const staleLight = {};
    const destroy = vi.fn();
    internals._shadowMaps.set(staleLight, { destroy });

    renderer.renderShadowMaps(NO_LIGHTS, []);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(internals._shadowMaps.has(staleLight)).toBe(false);
  });
});

describe("releaseRenderTarget", () => {
  /** A renderer with the texture manager stubbed to the cache bookkeeping `release` relies on. */
  function rendererWithTextureCache(): WebGL2Renderer {
    const renderer = new WebGL2Renderer();
    const internals = renderer as unknown as Gl2Internals;
    internals._textures = {
      unregisterTexture: (t): void => {
        internals._texCache.delete(t);
      },
      unregisterCubeTexture: (): void => {},
    };
    return renderer;
  }

  it("WebGL2: destroys the target's FBO, forgets its texture and lets a later render re-allocate it", () => {
    const renderer = rendererWithTextureCache();
    const internals = renderer as unknown as Gl2Internals;
    const target = RenderTarget.create({ width: 8, height: 8 });
    target.isLoaded = true;
    const destroy = vi.fn();
    internals._renderTargetFbos.set(target, { destroy });
    internals._texCache.set(target, {});

    renderer.releaseRenderTarget(target);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(internals._renderTargetFbos.has(target)).toBe(false);
    expect(internals._texCache.has(target)).toBe(false);
    expect(target.isLoaded).toBe(false);
  });

  it("is safe for a target that was never rendered", () => {
    const renderer = rendererWithTextureCache();
    expect(() =>
      renderer.releaseRenderTarget(RenderTarget.create({ width: 4, height: 4 })),
    ).not.toThrow();
  });

  it("PlanarReflectionNode.dispose hands its render target to the renderer", () => {
    const node = new PlanarReflectionNode("mirror", 16, 16);
    const releaseRenderTarget = vi.fn();
    node.dispose({ releaseRenderTarget } as unknown as Renderer);
    expect(releaseRenderTarget).toHaveBeenCalledWith(node.renderTarget);
  });

  it("PlanarReflectionNode.dispose tolerates renderers without the capability", () => {
    const node = new PlanarReflectionNode("mirror", 16, 16);
    expect(() => node.dispose({} as unknown as Renderer)).not.toThrow();
  });
});

describe("WebGL1Renderer resource lifetime", () => {
  it("destroy() frees cube render-target FBOs/depth buffers and the opaque copy texture", () => {
    const gl = {
      deleteFramebuffer: vi.fn(),
      deleteRenderbuffer: vi.fn(),
      deleteTexture: vi.fn(),
      getExtension: vi.fn(() => null),
    } as unknown as WebGLRenderingContext;
    const renderer = new WebGL1Renderer();
    const internals = renderer as unknown as {
      gl: WebGLRenderingContext;
      _renderTargetCubeFbos: Map<object, WebGLFramebuffer>;
      _renderTargetCubeDepthBuffers: Map<object, WebGLRenderbuffer>;
      _opaqueTexture?: WebGLTexture;
    };
    internals.gl = gl;
    const fbo = {} as WebGLFramebuffer;
    const rb = {} as WebGLRenderbuffer;
    const opaque = {} as WebGLTexture;
    internals._renderTargetCubeFbos.set({}, fbo);
    internals._renderTargetCubeDepthBuffers.set({}, rb);
    internals._opaqueTexture = opaque;

    renderer.destroy();

    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(fbo);
    expect(gl.deleteRenderbuffer).toHaveBeenCalledWith(rb);
    expect(gl.deleteTexture).toHaveBeenCalledWith(opaque);
  });
});
