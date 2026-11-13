import { describe, expect, it } from "vitest";
import { resolveAnisotropicLevel } from "../../src/renderers/anisotropy.js";
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
