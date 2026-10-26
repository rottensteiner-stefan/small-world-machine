import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Source-level guards for Stage B2 (ADR 0043, WebGL2 atlas EVSM). Vitest has no GLSL compiler, so a
// syntax slip would only surface in the browser -- these guards keep the intent honest instead:
//  (1) every WebGL2 directional-shadow sampling site has an EVSM branch that evaluates the moment
//      atlas via the shared helpers (cell-clamped), and
//  (2) the default (non-EVSM) path at every call site is the shared PCSS port evalPCSSDir (ADR 0006),
//      for the main AND the cascade-blend sample, so the blend band never mixes two filters.
// The moment writer EvsmMoment.frag.glsl and the WebGPU pbr_math.wgsl equivalences are asserted in
// their own tests / lint pass.

function readChunk(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

const LIT_CHUNKS = [
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl",
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
];

describe("EVSM WebGL2 shader branches sit next to the default PCSS path", () => {
  const header = readChunk(
    "packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_fragment_header.frag.glsl",
  );
  const dirShadow = readChunk("packages/engine/src/core/materials/shaders/chunks/dir_shadow.glsl");

  it("the shared header declares the EVSM helpers with the Filament warp semantics", () => {
    expect(header).toContain("uniform sampler2D u_dirEVSMMap;");
    expect(header).toContain("uniform vec4 u_evsmParams;");
    expect(header).toContain("chebyshevUpperBoundEVSM");
    expect(header).toContain("evalEVSMDir");
    // Same c = 40, dynamic chain-rule floor and LBR remap as the WebGPU dispatch path; the receiver
    // warp additionally applies the tiny w-lane depth bias (three.js VSM bias, peter-panning guard).
    expect(header).toContain("exp(40.0 * ((currentDepth + u_evsmParams.w) * 2.0 - 1.0))");
    expect(header).toContain("max(m2 - m1 * m1, u_evsmParams.y * m1 * m1)");
  });

  it("the DIR_PCSS chunk ports the WebGPU getShadowPCSS penumbra estimate and softness knobs", () => {
    const pcss = readChunk(
      "packages/engine/src/renderers/shaders/source/web_gl2/chunks/dir_pcss.frag.glsl",
    );
    expect(pcss).toContain("float evalPCSSDir(");
    // Same principled radius as pbr_math.wgsl (cell texel count stands in for the layer size).
    expect(pcss).toContain("float radial = dz / max(depthRef, 0.00001);");
    expect(pcss).toContain(
      "clamp(1.0 + radial * cellTexels * 0.12 * u_shadowSoftness.x, 1.0, max(u_shadowSoftness.y, 1.0))",
    );
    // Both headers declare its inputs and include it (they never mix).
    for (const source of [header, dirShadow]) {
      expect(source).toContain("uniform vec4 u_shadowSoftness;");
      expect(source).toContain("uniform sampler2D u_dirShadowMapRaw;");
      expect(source).toContain("[DIR_PCSS]");
    }
  });

  it("the dir_shadow chunk (water/liquid own-header shaders) carries its own identical helpers", () => {
    expect(dirShadow).toContain("uniform sampler2D u_dirEVSMMap;");
    expect(dirShadow).toContain("chebyshevUpperBoundEVSM");
    expect(dirShadow).toContain("evalEVSMDir(atlasUV, cellMin, cellMax, proj.z)");
    expect(dirShadow).toContain(
      "evalPCSSDir(atlasUV, cellMin, cellMax, proj.z, u_dirShadowInfo.x, cascadeIndex)",
    );
  });

  it("both headers declare the moment-atlas sampler only in the USE_EVSM variant", () => {
    for (const source of [header, dirShadow]) {
      const gate = source.indexOf("#ifdef USE_EVSM");
      const sampler = source.indexOf("uniform sampler2D u_dirEVSMMap;");
      const stub = source.indexOf("#else", sampler);
      expect(gate).toBeGreaterThan(-1);
      expect(sampler).toBeGreaterThan(gate);
      // The default variant keeps evalEVSMDir callable (all lit, dead behind u_evsmParams.x).
      expect(source.slice(stub, source.indexOf("#endif", stub))).toContain("return 1.0;");
      expect(source.match(/uniform sampler2D u_dirEVSMMap;/g)).toHaveLength(1);
    }
  });

  for (const file of LIT_CHUNKS) {
    const source = readChunk(file);

    it(`${file}: the main-cascade sample has an EVSM branch and the PCSS default`, () => {
      expect(source).toContain("shadowA = evalEVSMDir(atlasUV, cellMin, cellMax, currentDepth);");
      expect(source).toContain(
        "shadowA = evalPCSSDir(atlasUV, cellMin, cellMax, currentDepth, bias, cascadeIndex);",
      );
    });

    it(`${file}: the cascade-blend sample uses the same cell-clamped filters`, () => {
      expect(source).toContain(
        "shadowB = evalEVSMDir(atlasUVB, cellMinB, cellMaxB, currentDepthB);",
      );
      expect(source).toContain("vec2 cellMinB = vec2(colB, rowB) / cols;");
      expect(source).toContain(
        "shadowB = evalPCSSDir(atlasUVB, cellMinB, cellMaxB, currentDepthB, bias, nextCascade);",
      );
    });
  }
});
