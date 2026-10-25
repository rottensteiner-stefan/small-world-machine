import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * BYTE-CONTRACT / STRING-GUARD (ADR 0044 Realignment, P5): Diese Datei enthält KEINE eigene
 * Mathematik-Spiegelung, sondern verriegelt die exakte Verkabelung im SHIPPED Shader-Quellcode
 * (Byte-Kontrakt). Ein Reorder/Umbenennen der Dispatch-Funktionen oder der PCF/PCSS-Pfade bricht
 * hier CI, bevor er die Byte-identischen Golden-Gates erreicht.
 *
 * Regression guard for docs/adr/0006-pcss-directional-light-only.md: WebGPU spot-light shadows
 * use PCSS (getShadowPCSS is fully generic -- same signature as getShadowPCF, no directional-
 * specific uniform access -- so this is a pure function-name swap, no new bindings). The
 * directional cascade-blend sample deliberately stays on fixed PCF (avoids doubling the
 * blocker-search cost in the blend zone). With EVSM (ADR 0043) the directional path is routed
 * through mode dispatchers: getShadowDirMain (pcss branch = PCSS) and getShadowDirBlend (pcss
 * branch = fixed PCF). Each pcss branch MUST re-invoke the exact function its call site used
 * before, or the default (non-EVSM) blend band would silently change and break the byte-identical
 * gates -- that is what the blend assertion below guards.
 */

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

  it("both main and blend dispatchers keep the PCSS fallback so cascade splits stay C0-continuous", () => {
    expect(pbrMath).toContain("return getShadowPCSS(map, samp, shadowPos, layer, bias);");
    expect(pbrMath).toContain("let filterRadius = max(1.0, pcfRadius * cascadeScale);");
  });

  it("both dispatchers switch to the EVSM moment path when the mode flag is set", () => {
    expect(pbrMath).toContain("if (global.evsmParams.x > 0.5) {");
    expect(pbrMath).toContain("getEVSM(u_dirEvsmMap, shadowPos, layer)");
  });

  // Regression guards for the two WebGPU pipeline errors that used to break EVERY lit shader:
  // (1) binding a rgba32float texture to a filterable ("float") binding is invalid, and
  // (2) textureSample is illegal in the cascade's non-uniform control flow (only depth-compare
  // sampling is exempt). getEVSM must therefore fetch moments with textureLoad and take no sampler.
  it("the moment evaluator fetches taps with textureLoad (no sampled/filterable sampler needed)", () => {
    expect(pbrMath).toContain(
      "fn getEVSM(map: texture_2d_array<f32>, shadowPos: vec4f, layer: u32) -> f32 {",
    );
    expect(pbrMath).toContain("let rawTap = textureLoad(map, vec2u(tapCoord), layer, 0u);");
    expect(pbrMath).not.toContain("textureSample(map, samp, tapUV, layer)");
  });

  describe("PCSS anti-ghosting and contact-hardening", () => {
    it("uses compact PCF early-exit for contact shadows (pcfRadius <= 1.2)", () => {
      expect(pbrMath).toContain("if (pcfRadius <= 1.2) {");
    });

    it("uses 16-tap rotated disk for penumbra to eliminate 3x3 grid ghosting", () => {
      expect(pbrMath).toContain("return shadow / 16.0;");
      expect(pbrMath).toContain("let angle = noise * 6.2831853;");
    });
  });
});
