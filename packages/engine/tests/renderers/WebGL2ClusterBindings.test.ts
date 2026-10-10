import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("WebGL2 clustered lighting bindings", () => {
  const lightsPath = path.resolve(
    __dirname,
    "../../src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl",
  );
  const lightsContent = fs.readFileSync(lightsPath, "utf-8");

  it("declares the packed clustered light culling samplers", () => {
    expect(lightsContent).toContain("uniform usampler2D u_clusterGrid;");
    expect(lightsContent).toContain("uniform usampler2D u_clusterIndices;");
  });

  it("declares u_tileSizePx/u_clusterDims inside GlobalUniforms", () => {
    expect(lightsContent).toContain("vec2 u_tileSizePx;");
    expect(lightsContent).toContain("vec4 u_clusterDims;");
  });

  it("keeps CLUSTER_TEX_WIDTH in sync with src/math/ClusterGrid.ts", () => {
    expect(lightsContent).toContain("const int CLUSTER_TEX_WIDTH = 1024;");

    const clusterGridPath = path.resolve(__dirname, "../../src/math/ClusterGrid.ts");
    const clusterGridContent = fs.readFileSync(clusterGridPath, "utf-8");
    expect(clusterGridContent).toContain("export const CLUSTER_TEX_WIDTH = 1024;");
  });

  for (const file of ["light_calc.frag.glsl", "light_calc_pbr.frag.glsl"]) {
    it(`${file} looks up the cluster grid instead of looping 0..numLights`, () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, `../../src/renderers/shaders/source/web_gl2/chunks/${file}`),
        "utf-8",
      );
      expect(content).toContain("fetchPointClusterGridEntry(clusterCellIndex)");
      expect(content).toContain("fetchSpotClusterGridEntry(clusterCellIndex)");
      expect(content).not.toContain("i >= u_numPointLights");
      expect(content).not.toContain("i >= u_numSpotLights");
    });
  }
});
