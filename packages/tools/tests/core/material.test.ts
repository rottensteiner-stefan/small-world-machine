import { describe, it, expect } from "vitest";
import {
  derivePbrMaps,
  MATERIAL_STUDIO_PRESETS,
  type MaterialStudioMapParams,
} from "../../src/core/material.js";
import type { RgbaImage } from "../../src/core/RasterIO.js";

function gradientFixture(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 40) % 256;
      data[i + 1] = (y * 60) % 256;
      data[i + 2] = ((x + y) * 30) % 256;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const DEFAULT_PARAMS: MaterialStudioMapParams = MATERIAL_STUDIO_PRESETS["default"];

describe("core/material MaterialMapPipeline", () => {
  it("derives all seven maps at the input resolution", () => {
    const src = gradientFixture(16, 12);
    const maps = derivePbrMaps(src, DEFAULT_PARAMS);

    expect(maps.diffuse.width).toBe(16);
    expect(maps.diffuse.height).toBe(12);
    for (const key of ["height", "normal", "specular", "roughness", "ao", "edge"] as const) {
      const map = maps[key];
      expect(map.width).toBe(16);
      expect(map.height).toBe(12);
      expect(map.data.length).toBe(16 * 12 * 4);
      // generators always emit opaque pixels
      for (let i = 3; i < map.data.length; i += 4) {
        expect(map.data[i]).toBe(255);
      }
    }
  });

  it("keeps the diffuse map as an exact copy of the input buffer", () => {
    const src = gradientFixture(8, 8);
    const maps = derivePbrMaps(src, DEFAULT_PARAMS);
    expect(Array.from(maps.diffuse.data)).toEqual(Array.from(src.data));
    expect(maps.diffuse.data).not.toBe(src.data);
  });

  it("copyDiffuse:false hands back the input image instead of copying it", () => {
    const src = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(90) };
    const maps = derivePbrMaps(src, DEFAULT_PARAMS, { copyDiffuse: false });
    expect(maps.diffuse).toBe(src);
  });

  it("is byte-deterministic across invocations", () => {
    const src = gradientFixture(12, 10);
    const a = derivePbrMaps(src, DEFAULT_PARAMS);
    const b = derivePbrMaps(src, DEFAULT_PARAMS);
    for (const key of [
      "diffuse",
      "height",
      "normal",
      "specular",
      "roughness",
      "ao",
      "edge",
    ] as const) {
      expect(Array.from(a[key].data)).toEqual(Array.from(b[key].data));
    }
  });

  it("produces derived maps that differ from the diffuse input", () => {
    const src = gradientFixture(10, 10);
    const maps = derivePbrMaps(src, DEFAULT_PARAMS);
    expect(Array.from(maps.height.data)).not.toEqual(Array.from(src.data));
  });

  it("exposes all four studio presets with the expected knob set", () => {
    for (const id of ["default", "stone", "metal", "wood"] as const) {
      const preset = MATERIAL_STUDIO_PRESETS[id];
      expect(typeof preset.heightContrast).toBe("number");
      expect(typeof preset.normalStrength).toBe("number");
      expect(typeof preset.specContrast).toBe("number");
      expect(typeof preset.roughGamma).toBe("number");
      expect(typeof preset.aoSoft).toBe("number");
      expect(typeof preset.edgeThresh).toBe("number");
      expect(typeof preset.heightInvert).toBe("boolean");
    }
  });
});
