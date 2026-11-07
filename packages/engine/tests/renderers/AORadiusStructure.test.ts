import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(__dirname, "../../src/renderers/post/shaders");

describe("HBAO world-space radius", () => {
  for (const file of ["AO.frag.wgsl", "AO.frag.glsl"]) {
    it(`${file} marches by projected world radius, not a fixed pixel step`, () => {
      const src = readFileSync(resolve(dir, file), "utf8");
      expect(src).not.toMatch(/\*\s*4\.0\s*[;)]/);
      expect(src).toContain("pixelRadius");
      expect(src).toContain("stepPixels");
      expect(src).toMatch(/clamp\([^;]*4\.0,\s*128\.0\)/);
    });
  }
});

describe("HBAO normal source", () => {
  for (const file of ["AO.frag.wgsl", "AO.frag.glsl"]) {
    it(`${file} reconstructs the flat normal with neighbour selection and never reads the normal buffer`, () => {
      const src = readFileSync(resolve(dir, file), "utf8");
      expect(src).toContain("neighbourViewPos");
      expect(src).toMatch(/abs\(right\.w - linearZ\)/);
      expect(src).not.toMatch(/normalMap|u_normalMap|octDecode|viewRot|useNormalBuffer/);
    });
  }
});

describe("HBAO anti-ghosting (Bayer dither + distance falloff + 4x4 box filter)", () => {
  for (const file of ["AO.frag.wgsl", "AO.frag.glsl"]) {
    it(`${file} uses 4x4 Bayer angular/radial jitter and quadratic distance falloff`, () => {
      const src = readFileSync(resolve(dir, file), "utf8");
      expect(src).toContain("bayerTable");
      expect(src).toContain("radialJitter");
      expect(src).toContain("falloff * falloff");
    });
  }

  for (const file of ["PostProcess.frag.wgsl", "PostProcess.frag.glsl"]) {
    it(`${file} filters the 4x4 Bayer HBAO tile via 4 bilinear taps`, () => {
      const src = readFileSync(resolve(dir, file), "utf8");
      expect(src).toContain("aoTexel");
      expect(src).toContain("(ao0 + ao1 + ao2 + ao3) * 0.25");
    });
  }
});
