import { describe, expect, it } from "vitest";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";
import type { Texture } from "../../src/core/textures/Texture.js";
import { TextureFilter, TextureWrap } from "../../src/enums/index.js";

const GL = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  MIRRORED_REPEAT: 0x8370,
};

/** `_setSamplerParams100` only reads the sampler fields, so a plain object is enough. */
function samplerOnly(fields: Partial<Texture>): Texture {
  return {
    magFilter: TextureFilter.LINEAR,
    minFilter: TextureFilter.LINEAR,
    addressModeU: TextureWrap.REPEAT,
    addressModeV: TextureWrap.REPEAT,
    ...fields,
  } as Texture;
}

function applyParams(tex: Texture, size: number): Map<number, number> {
  const params = new Map<number, number>();
  const gl = {
    ...GL,
    texParameteri: (_target: number, pname: number, value: number) => params.set(pname, value),
    generateMipmap: () => {},
    getExtension: () => null,
  } as unknown as WebGLRenderingContext;
  const manager = new WebGLTextureManager(gl, new Map(), {} as WebGLTexture, {} as WebGLTexture);
  (
    manager as unknown as {
      _setSamplerParams100: (
        img: { width: number; height: number },
        t: Texture,
        q: undefined,
      ) => void;
    }
  )._setSamplerParams100({ width: size, height: size }, tex, undefined);
  return params;
}

describe("WebGL1 sampler state (glsl100 path)", () => {
  it("applies the texture's wrap mode and NEAREST min filter on power-of-two textures", () => {
    const tex = samplerOnly({
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.MIRRORED_REPEAT,
      minFilter: TextureFilter.NEAREST,
    });

    const params = applyParams(tex, 64);

    expect(params.get(GL.TEXTURE_WRAP_S)).toBe(GL.CLAMP_TO_EDGE);
    expect(params.get(GL.TEXTURE_WRAP_T)).toBe(GL.MIRRORED_REPEAT);
    expect(params.get(GL.TEXTURE_MIN_FILTER)).toBe(GL.NEAREST);
  });

  it("still forces CLAMP_TO_EDGE on non-power-of-two textures, whatever the wrap mode says", () => {
    const tex = samplerOnly({
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
    });

    const params = applyParams(tex, 100);

    expect(params.get(GL.TEXTURE_WRAP_S)).toBe(GL.CLAMP_TO_EDGE);
    expect(params.get(GL.TEXTURE_WRAP_T)).toBe(GL.CLAMP_TO_EDGE);
  });
});
