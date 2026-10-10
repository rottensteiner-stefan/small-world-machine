import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("WebGPU clustered lighting bindings", () => {
  const wgslPath = path.resolve(
    __dirname,
    "../../src/renderers/shaders/source/web_gpu/chunks/structs.wgsl",
  );
  const wgslContent = fs.readFileSync(wgslPath, "utf-8");

  it("declares the four clustered light culling storage bindings on group 0", () => {
    expect(wgslContent).toContain(
      "@group(0) @binding(11) var<storage, read_write> pointClusterGrid: array<vec2u>;",
    );
    expect(wgslContent).toContain(
      "@group(0) @binding(12) var<storage, read_write> pointClusterIndices: array<u32>;",
    );
    expect(wgslContent).toContain(
      "@group(0) @binding(13) var<storage, read_write> spotClusterGrid: array<vec2u>;",
    );
    expect(wgslContent).toContain(
      "@group(0) @binding(14) var<storage, read_write> spotClusterIndices: array<u32>;",
    );
  });

  it("declares the clustered light culling fields on GlobalUniforms", () => {
    expect(wgslContent).toContain("resolution: vec2f");
    expect(wgslContent).toContain("projScale: vec2f");
    expect(wgslContent).toContain("tileSizePx: vec2f");
    expect(wgslContent).toContain("clusterDims: vec4f");
  });

  it("declares the cullLights compute entry point", () => {
    const computePath = path.resolve(
      __dirname,
      "../../src/renderers/shaders/source/web_gpu/compute/cluster_cull.wgsl",
    );
    const computeContent = fs.readFileSync(computePath, "utf-8");
    expect(computeContent).toContain("@compute @workgroup_size(4, 4, 4)");
    expect(computeContent).toContain("fn cullLights(");
  });
});
