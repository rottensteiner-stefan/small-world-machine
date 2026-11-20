import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Matrix4,
  Vector3D,
  lightClusterCoverage,
  sliceCenterViewDepth,
  zSliceFromViewDepth,
} from "../../src/math/index.js";
import injectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";
import integrateWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_integrate.wgsl?raw";
import clusterCullWGSL from "../../src/renderers/shaders/source/web_gpu/compute/cluster_cull.wgsl?raw";
import clusterLookupWGSL from "../../src/renderers/shaders/source/web_gpu/chunks/cluster_index_lookup.wgsl?raw";
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
  it("integrate selects cascades by planar view depth (zMid / zSub)", () => {
    expect(integrateWGSL).toMatch(/sampleCascadeShadow\(worldPos, zMid\)/);
    expect(integrateWGSL).toMatch(/sampleCascadeShadow\(worldPosSub, zSub\)/);
    expect(integrateWGSL).not.toMatch(
      /sampleCascadeShadow\(worldPos, length\(worldPos - uni\.camPos\.xyz\)\)/,
    );
    expect(integrateWGSL).toMatch(/viewDist < splits\[c\]/);
  });

  it("integrate applies cumulative optical-depth powder only to sunScatter, not localInScatter", () => {
    expect(integrateWGSL).toMatch(
      /let powder = mix\(1\.0, 1\.0 - exp\(-2\.0 \* \(accumTau \+ stepTau\)\), 0\.35\);/,
    );
    expect(integrateWGSL).toMatch(/let totalScatter = localInScatter \+ sunScatter \* powder;/);
    expect(integrateWGSL).not.toMatch(/\(localInScatter \+ sunScatter\) \* powder/);
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

  it("inject fades extinction smoothly towards maxDistance by planar viewZ instead of cutting it", () => {
    expect(injectWGSL).toMatch(/smoothstep\(froxel\.params\.w \* 0\.66, froxel\.params\.w, viewZ\)/);
    expect(injectWGSL).not.toMatch(/if \(viewZ > froxel\.params\.w\)/);
  });

  it("inject honours the surface shader's point and spot light decay modes and linear cone ramp", () => {
    expect(injectWGSL).toMatch(
      /if \(light\.col\.w <= 0\.0\) \{\s*atten = clamp\(1\.0 - ratio, 0\.0, 1\.0\);/,
    );
    expect(injectWGSL).toMatch(
      /if \(light\.params\.w <= 0\.0\) \{\s*atten = clamp\(1\.0 - ratio, 0\.0, 1\.0\);/,
    );
    expect(injectWGSL).toMatch(/\(window \* window\) \/ max\(lightDist \* lightDist, 0\.01\)/);
    expect(injectWGSL).toMatch(/let cone = clamp\(\(theta - light\.params\.x\)/);
    expect(injectWGSL).not.toMatch(/smoothstep\(light\.params\.x/);
  });

  it("inject sizes the froxel grid from the volume and maps cells onto cluster cells", () => {
    expect(injectWGSL).toMatch(/textureDimensions\(volume\)/);
    expect(injectWGSL).toMatch(/let cellIndex = clusterCellIndex\(gid, dims\);/);
  });

  it("corner light at 75° FOV maps to the exact same planar cz slice across ClusterGrid, cluster_cull, cluster_index_lookup, and froxel_inject (B1)", () => {
    const fov = (75 * Math.PI) / 180;
    const aspect = 16 / 9;
    const near = 0.1;
    const far = 1000;
    const dims = { x: 120, y: 68, z: 24 };
    const tileSize: [number, number] = [16, 16];
    const screenWidth = 1920;
    const screenHeight = 1080;

    const proj = new Matrix4();
    Matrix4.perspective(fov, aspect, near, far, proj);
    const view = new Matrix4();
    Matrix4.lookAt(new Vector3D(0, 0, 0), new Vector3D(0, 0, -1), new Vector3D(0, 1, 0), view);
    const vpRaw = new Matrix4();
    Matrix4.multiply(proj, view, vpRaw);
    const vp = new Matrix4();
    Matrix4.multiply(Matrix4.ZO_CORRECTION, vpRaw, vp);

    const targetSlice = 12;
    const viewZ = sliceCenterViewDepth(targetSlice, near, far, dims.z);
    const projScaleX = proj.data[0]!;
    const projScaleY = proj.data[5]!;
    const ndcX = 0.95;
    const ndcY = 0.95;
    const worldX = (ndcX / projScaleX) * viewZ;
    const worldY = (ndcY / projScaleY) * viewZ;
    const worldZ = -viewZ;

    // 1. ClusterGrid (CPU): light with tiny radius at corner
    const cpuCov = lightClusterCoverage(
      viewZ,
      0.01,
      ndcX,
      ndcY,
      viewZ,
      projScaleX,
      projScaleY,
      screenWidth,
      screenHeight,
      tileSize,
      dims,
      near,
      far,
    );
    expect(cpuCov.sliceMin).toBe(targetSlice);
    expect(cpuCov.sliceMax).toBe(targetSlice);

    // 2. cluster_cull.wgsl: computeViewZ extracts planar clip.w / dot(wp - viewPos, camFwd)
    const m = vp.data;
    const clipW = m[3]! * worldX + m[7]! * worldY + m[11]! * worldZ + m[15]!;
    expect(clipW).toBeCloseTo(viewZ, 4);
    expect(clusterCullWGSL).toContain("let viewZ = computeViewZ(worldPos, clip.w);");
    expect(clusterCullWGSL).toContain("let rangeZ = zSliceRange(viewZ, radius);");
    const cullSlice = zSliceFromViewDepth(clipW, near, far, dims.z);
    expect(cullSlice).toBe(targetSlice);

    // 3. cluster_index_lookup.wgsl: extracts clusterCamFwd from global.vp row 3
    const vpR3x = m[3]!;
    const vpR3y = m[7]!;
    const vpR3z = m[11]!;
    const lookupViewDist = worldX * vpR3x + worldY * vpR3y + worldZ * vpR3z;
    expect(lookupViewDist).toBeCloseTo(viewZ, 4);
    expect(clusterLookupWGSL).toContain(
      "let clusterViewDist = clamp(dot(i.wp - global.viewPos.xyz, clusterCamFwd), global.cameraNearFar.x, global.cameraNearFar.y);",
    );
    const lookupSlice = zSliceFromViewDepth(lookupViewDist, near, far, dims.z);
    expect(lookupSlice).toBe(targetSlice);

    // 4. froxel_inject.wgsl: clusterCellIndex uses sliceCenterDepth(gid.z)
    const froxelZc = sliceCenterViewDepth(targetSlice, near, far, dims.z);
    const froxelSlice = zSliceFromViewDepth(froxelZc, near, far, dims.z);
    expect(froxelSlice).toBe(targetSlice);
  });

  it("off-screen light at ndcX = -5.0 produces 0 cluster entries in column x = 0 (B2)", () => {
    const dims = { x: 20, y: 12, z: 24 };
    const tileSize: [number, number] = [16, 16];
    const screenWidth = dims.x * tileSize[0];
    const screenHeight = dims.y * tileSize[1];
    const coverage = lightClusterCoverage(
      20, // viewZ
      2, // radius
      -5.0, // ndcX completely off-screen left
      0.0, // ndcY
      20, // clipW
      1.0,
      1.0,
      screenWidth,
      screenHeight,
      tileSize,
      dims,
      0.1,
      1000,
    );
    expect(coverage.cellMinX).toBeGreaterThan(coverage.cellMaxX);

    let countCol0 = 0;
    for (let z = coverage.sliceMin; z <= coverage.sliceMax; z++) {
      for (let y = coverage.cellMinY; y <= coverage.cellMaxY; y++) {
        for (let x = coverage.cellMinX; x <= coverage.cellMaxX; x++) {
          if (x === 0) countCol0++;
        }
      }
    }
    expect(countCol0).toBe(0);
    expect(clusterCullWGSL).toContain(
      "if (rawMaxX < 0.0 || rawMinX >= f32(dims.x) || rawMaxY < 0.0 || rawMinY >= f32(dims.y))",
    );
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
