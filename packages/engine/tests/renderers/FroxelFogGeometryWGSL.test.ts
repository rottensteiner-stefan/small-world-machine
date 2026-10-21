import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import injectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";
import integrateWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_integrate.wgsl?raw";
import hzbTestWGSL from "../../src/renderers/shaders/source/web_gpu/compute/hzb_visibility_test.wgsl?raw";
import hzbDownsampleWGSL from "../../src/renderers/shaders/source/web_gpu/compute/hzb_downsample_max.wgsl?raw";
const fogPassSource = readFileSync(
  new URL("../../src/renderers/post/passes/VolumetricFogPassGPU.ts", import.meta.url),
  "utf8",
);

/**
 * Guards the fog geometry conventions that are easy to break silently (no GPU in CI): both compute
 * passes slice by view-space depth, the sun phase uses the "towards the light" convention of the
 * local lights, and the CSM matrices match the zero-to-one corrected shadow map.
 */
describe("froxel fog geometry conventions", () => {
  it("inject places cell centres on the view-depth slice (unnormalised z = -1 ray)", () => {
    expect(injectWGSL).not.toMatch(/normalize\(viewDir\)[\s\S]{0,80}viewZ/);
    expect(injectWGSL).toMatch(/-1\.0,\s*\)\s*\*\s*viewZ/);
  });

  it("integrate converts the slab thickness into ray length (1 / cos theta)", () => {
    expect(integrateWGSL).toMatch(/slabThickness \* max\(length\(worldPos - uni\.camPos\.xyz\)/);
    expect(integrateWGSL).not.toMatch(/let stepLen = max\(bounds\.y - bounds\.x/);
  });

  it("integrate evaluates the sun phase with dot(viewDir, sunDir) (sunDir points to the sun)", () => {
    expect(integrateWGSL).toMatch(/let cosTheta = dot\(viewDir, sunDir\);/);
    expect(integrateWGSL).not.toMatch(/dot\(-viewDir, sunDir\)/);
  });

  it("the fog pass uploads ZO-corrected cascade matrices, like CascadedShadowPassGPU", () => {
    expect(fogPassSource).toMatch(
      /Matrix4\.multiply\(Matrix4\.ZO_CORRECTION, this\._scratchCascadeVp/,
    );
    expect(fogPassSource).not.toMatch(/intg\.set\(cam\.viewProjectionMatrix/);
  });
});

describe("HZB conservativeness conventions", () => {
  it("the visibility test loads all four corner texels of the sphere's screen rect", () => {
    expect(hzbTestWGSL.match(/textureLoad\(hzbTex/g)).toHaveLength(4);
  });

  it("a sphere reaching the near plane is treated as visible", () => {
    expect(hzbTestWGSL).toMatch(/clip\.w <= radius/);
  });

  it("the downsample keeps the extra row/column of odd-sized mips", () => {
    expect(hzbDownsampleWGSL).toMatch(/id\.x == dstDims\.x - 1u/);
    expect(hzbDownsampleWGSL).toMatch(/id\.y == dstDims\.y - 1u/);
  });
});
