import { describe, expect, it, vi } from "vitest";
import { applyAnisotropy, resolveAnisotropicLevel } from "../../src/renderers/anisotropy.js";
import { Texture } from "../../src/core/textures/Texture.js";
import type { QualityConfig } from "../../src/interfaces/EngineOptions.js";

const makeTex = (anisotropy: number): Texture =>
  Texture.fromImage({} as ImageBitmap, { anisotropy });

const quality = { maxAnisotropy: 4 } as QualityConfig;

describe("resolveAnisotropicLevel", () => {
  it("inherits the engine-wide level for the default anisotropy of 1", () => {
    const tex = Texture.fromImage({} as ImageBitmap);
    expect(resolveAnisotropicLevel(tex, quality, 16)).toBe(4);
  });

  it("caps an explicit per-texture level at the engine maximum", () => {
    expect(resolveAnisotropicLevel(makeTex(16), quality, 16)).toBe(4);
  });

  it("disables filtering for anisotropy 0 regardless of quality or hardware", () => {
    expect(resolveAnisotropicLevel(makeTex(0), { maxAnisotropy: 16 } as QualityConfig, 16)).toBe(1);
  });

  it("uses the requested level when no engine cap is configured", () => {
    expect(resolveAnisotropicLevel(makeTex(8), undefined, 16)).toBe(8);
  });

  it("never exceeds the device maximum", () => {
    expect(resolveAnisotropicLevel(makeTex(16), { maxAnisotropy: 16 } as QualityConfig, 8)).toBe(8);
  });

  it("turns off when the engine cap or device maximum is 1", () => {
    expect(resolveAnisotropicLevel(makeTex(16), { maxAnisotropy: 1 } as QualityConfig, 16)).toBe(1);
    expect(resolveAnisotropicLevel(makeTex(1), quality, 1)).toBe(1);
  });

  it("lets a per-texture level below the engine cap pass through", () => {
    expect(resolveAnisotropicLevel(makeTex(2), { maxAnisotropy: 8 } as QualityConfig, 16)).toBe(2);
  });
});

describe("applyAnisotropy", () => {
  const ext = {
    TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
  } as EXT_texture_filter_anisotropic;

  interface MockGl {
    getExtension: (name: string) => EXT_texture_filter_anisotropic | null;
    getParameter: (pname: number) => number;
    texParameterf: (target: number, pname: number, param: number) => void;
  }

  const mockGl = (extension: EXT_texture_filter_anisotropic | null, deviceMax: number): MockGl => ({
    getExtension: vi.fn(() => extension),
    getParameter: vi.fn(() => deviceMax),
    texParameterf: vi.fn(),
  });

  it("applies the resolved level to a mipmapped texture", () => {
    const gl = mockGl(ext, 16);
    applyAnisotropy(gl as unknown as WebGL2RenderingContext, 0x0de1, makeTex(4), quality, true);
    expect(gl.texParameterf).toHaveBeenCalledTimes(1);
    expect(gl.texParameterf).toHaveBeenCalledWith(0x0de1, ext.TEXTURE_MAX_ANISOTROPY_EXT, 4);
  });

  it("is a no-op without the extension", () => {
    const gl = mockGl(null, 16);
    applyAnisotropy(gl as unknown as WebGL2RenderingContext, 0x0de1, makeTex(4), quality, true);
    expect(gl.texParameterf).not.toHaveBeenCalled();
    expect(gl.getParameter).not.toHaveBeenCalled();
  });

  it("is a no-op on non-mipmapped textures", () => {
    const gl = mockGl(ext, 16);
    applyAnisotropy(gl as unknown as WebGL2RenderingContext, 0x0de1, makeTex(4), quality, false);
    expect(gl.texParameterf).not.toHaveBeenCalled();
  });

  it("honors the engine cap at application time", () => {
    const gl = mockGl(ext, 16);
    applyAnisotropy(
      gl as unknown as WebGL2RenderingContext,
      0x0de1,
      makeTex(16),
      { maxAnisotropy: 2 } as QualityConfig,
      true,
    );
    expect(gl.texParameterf).toHaveBeenCalledWith(0x0de1, ext.TEXTURE_MAX_ANISOTROPY_EXT, 2);
  });
});
