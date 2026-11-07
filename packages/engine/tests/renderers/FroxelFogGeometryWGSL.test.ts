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

describe("froxel fog cascade / range / grid conventions", () => {
  it("integrate selects cascades by camera distance (like lighting_pbr.wgsl), not view depth", () => {
    expect(integrateWGSL).toMatch(
      /sampleCascadeShadow\(worldPos, length\(worldPos - uni\.camPos\.xyz\)\)/,
    );
    expect(integrateWGSL).not.toMatch(/sampleCascadeShadow\(worldPos, zMid\)/);
    expect(integrateWGSL).toMatch(/viewDist < splits\[c\]/);
  });

  it("integrate blends into the next cascade over the last 10% like the surface shader", () => {
    expect(integrateWGSL).toMatch(/max\(splitFar \* 0\.1, 0\.0001\)/);
    expect(integrateWGSL).toMatch(
      /mix\(shadow, sampleCascade\(worldPos, cascadeIndex \+ 1u\), blendToNext\)/,
    );
  });

  it("integrate treats samples beyond the light's far plane as lit", () => {
    expect(integrateWGSL).toMatch(/shadowCoord\.z > 1\.0/);
  });

  it("inject fades extinction smoothly towards maxDistance instead of cutting it", () => {
    expect(injectWGSL).toMatch(/smoothstep\(froxel\.params\.w \* 0\.66, froxel\.params\.w, dist\)/);
    expect(injectWGSL).not.toMatch(/if \(dist > froxel\.params\.w\)/);
  });

  it("inject honours the surface shader's point-light decay modes and linear cone ramp", () => {
    expect(injectWGSL).toMatch(
      /if \(light\.col\.w <= 0\.0\) \{\s*atten = clamp\(1\.0 - ratio, 0\.0, 1\.0\);/,
    );
    expect(injectWGSL).toMatch(/let cone = clamp\(\(theta - light\.params\.x\)/);
    expect(injectWGSL).not.toMatch(/smoothstep\(light\.params\.x/);
  });

  it("inject sizes the froxel grid from the volume and maps cells onto cluster cells", () => {
    expect(injectWGSL).toMatch(/textureDimensions\(volume\)/);
    expect(injectWGSL).toMatch(/let cellIndex = clusterCellIndex\(gid, dims\);/);
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
