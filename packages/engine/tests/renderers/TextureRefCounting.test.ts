import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { RenderTarget } from "../../src/core/textures/RenderTarget.js";
import { Object3D } from "../../src/core/Object3D.js";

function makeMockGl(): WebGL2RenderingContext {
  return { deleteTexture: vi.fn() } as unknown as WebGL2RenderingContext;
}

function makeCache(): {
  cache: WebGLTextureManager;
  gl: WebGL2RenderingContext;
  texCache: Map<Texture, WebGLTexture>;
} {
  const gl = makeMockGl();
  const texCache = new Map<Texture, WebGLTexture>();
  const cache = new WebGLTextureManager(gl, texCache, {} as never, {} as never);
  return { cache, gl, texCache };
}

describe("WebGLTextureManager reference counting", () => {
  it("shares a texture across two objects and only deletes it once both release it", () => {
    const { cache, gl, texCache } = makeCache();

    const tex = Texture.empty();
    const glTex = {};
    texCache.set(tex, glTex);

    const objA = new Object3D("A");
    const objB = new Object3D("B");

    cache.acquireTextures(objA, { u_diffuseMap: tex });
    cache.acquireTextures(objB, { u_diffuseMap: tex });

    cache.releaseObjectTextures(objA);
    expect(gl.deleteTexture).not.toHaveBeenCalled();

    cache.releaseObjectTextures(objB);
    expect(gl.deleteTexture).toHaveBeenCalledWith(glTex);
  });

  it("releases the old texture and acquires the new one when a material's texture slot changes", () => {
    const { cache, gl, texCache } = makeCache();

    const texA = Texture.empty();
    const texB = Texture.empty();
    texCache.set(texA, {});

    const obj = new Object3D("Swappable");
    cache.acquireTextures(obj, { u_diffuseMap: texA });
    cache.acquireTextures(obj, { u_diffuseMap: texB });

    expect(gl.deleteTexture).toHaveBeenCalled();
  });

  it("never destroys a RenderTarget's texture through the material refcount, even at zero references", () => {
    const { cache, gl, texCache } = makeCache();

    const rt = RenderTarget.create({ width: 4, height: 4 });
    texCache.set(rt, {});

    const obj = new Object3D("MirrorSurface");
    cache.acquireTextures(obj, { u_diffuseMap: rt });
    cache.releaseObjectTextures(obj);

    // The render target is reused across frames independently of this one material
    // reference -- releasing the last object using it must NOT tear down its GPU texture.
    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(texCache.has(rt)).toBe(true);
  });

  it("deletes all 2D textures and clears cache on dispose (BLK-C1)", () => {
    const { cache, gl, texCache } = makeCache();

    const tex1 = Texture.empty();
    const tex2 = Texture.empty();
    const glTex1 = {};
    const glTex2 = {};
    texCache.set(tex1, glTex1);
    texCache.set(tex2, glTex2);

    cache.dispose();

    expect(gl.deleteTexture).toHaveBeenCalledWith(glTex1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(glTex2);
    expect(texCache.size).toBe(0);
  });
});
