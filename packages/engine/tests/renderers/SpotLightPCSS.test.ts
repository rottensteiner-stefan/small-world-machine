import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Regression guard for docs/adr/0006-pcss-directional-light-only.md: WebGPU spot-light shadows
// use PCSS (getShadowPCSS is fully generic -- same signature as getShadowPCF, no directional-
// specific uniform access -- so this is a pure function-name swap, no new bindings). The
// directional cascade-blend sample deliberately stays on fixed PCF (avoids doubling the
// blocker-search cost in the blend zone). With EVSM (ADR 0007) the directional path is routed
// through mode dispatchers: getShadowDirMain (pcss branch = PCSS) and getShadowDirBlend (pcss
// branch = fixed PCF). Each pcss branch MUST re-invoke the exact function its call site used
// before, or the default (non-EVSM) blend band would silently change and break the byte-identical
// gates -- that is what the blend assertion below guards.

function readWgsl(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

describe("WebGPU spot-light shadows use PCSS", () => {
  const files = [
    "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl",
    "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl",
  ];

  for (const file of files) {
    it(`${file}: spot-light shadow call uses getShadowPCSS, not getShadowPCF`, () => {
      const source = readWgsl(file);
      expect(source).toContain(
        "getShadowPCSS(u_spotShadowMap, shadowSampler, shadowPos, j, global.spotShadowInfo[j].x)",
      );
      expect(source).not.toContain("getShadowPCF(u_spotShadowMap");
    });

    it(`${file}: directional cascade-blend sample routes through the blend dispatcher`, () => {
      const source = readWgsl(file);
      expect(source).toContain(
        "getShadowDirBlend(u_dirShadowMap, shadowSampler, shadowPosB, nextCascade, global.dirShadowInfo.x)",
      );
    });

    it(`${file}: spot-light shadow array access is guarded against out-of-bounds index (BLK-R2)`, () => {
      const source = readWgsl(file);
      expect(source).toContain("if (j < 4u && global.spotShadowInfo[j].z > 0.5)");
    });
  }

  const glslFiles = [
    "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl",
    "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
  ];

  for (const file of glslFiles) {
    it(`${file}: spot-light shadow array access is guarded against out-of-bounds index (BLK-R2)`, () => {
      const source = readWgsl(file);
      expect(source).toContain("if (i < 4 && u_spotShadowInfo[i].z > 0.5)");
    });
  }
});

describe("EVSM directional dispatchers preserve the default PCSS behavior per call site", () => {
  const pbrMath = readWgsl(
    "packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl",
  );

  it("the blend dispatcher keeps the fixed-PCF fallback (no PCSS cost in the blend band)", () => {
    expect(pbrMath).toContain("return getShadowPCF(map, samp, shadowPos, layer, bias);");
  });

  it("the main dispatcher keeps the PCSS fallback for the primary cascade sample", () => {
    expect(pbrMath).toContain("return getShadowPCSS(map, samp, shadowPos, layer, bias);");
  });

  it("both dispatchers switch to the EVSM moment path when the mode flag is set", () => {
    expect(pbrMath).toContain("if (global.evsmParams.x > 0.5) {");
    expect(pbrMath).toContain("getEVSM(u_dirEvsmMap, evsmSampler, shadowPos, layer)");
  });
});
