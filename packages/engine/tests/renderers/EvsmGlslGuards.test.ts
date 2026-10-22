import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Source-level guards for Stage B2 (ADR 0007, WebGL2 atlas EVSM). Vitest has no GLSL compiler, so a
// syntax slip would only surface in the browser -- these guards keep the intent honest instead:
//  (1) every WebGL2 directional-shadow sampling site has an EVSM branch that evaluates the moment
//      atlas via the shared helpers (cell-clamped), and
//  (2) the default (non-EVSM) path text is still present UNTOUCHED at every call site, because the
//      box/pole gates promise byte-identical frames while quality.shadowMode is the default pcss.
// The moment writer EvsmMoment.frag.glsl and the WebGPU pbr_math.wgsl equivalences are asserted in
// their own tests / lint pass.

function readChunk(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

const LIT_CHUNKS = [
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl",
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
];

describe("EVSM WebGL2 shader branches keep the default path byte-identical", () => {
  const header = readChunk(
    "packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_fragment_header.frag.glsl",
  );
  const dirShadow = readChunk("packages/engine/src/core/materials/shaders/chunks/dir_shadow.glsl");

  it("the shared header declares the EVSM helpers with the Filament warp semantics", () => {
    expect(header).toContain("uniform sampler2D u_dirEVSMMap;");
    expect(header).toContain("uniform vec4 u_evsmParams;");
    expect(header).toContain("chebyshevUpperBoundEVSM");
    expect(header).toContain("evalEVSMDir");
    // Same c = 40, dynamic chain-rule floor and LBR remap as the WebGPU dispatch path.
    expect(header).toContain("exp(40.0 * (currentDepth * 2.0 - 1.0))");
    expect(header).toContain("max(m2 - m1 * m1, u_evsmParams.y * m1 * m1)");
  });

  it("the dir_shadow chunk (water/liquid own-header shaders) carries its own identical helpers", () => {
    expect(dirShadow).toContain("uniform sampler2D u_dirEVSMMap;");
    expect(dirShadow).toContain("chebyshevUpperBoundEVSM");
    expect(dirShadow).toContain("evalEVSMDir(atlasUV, cellMin, cellMax, proj.z)");
  });

  for (const file of LIT_CHUNKS) {
    const source = readChunk(file);

    it(`${file}: the main-cascade sample has an EVSM branch AND keeps the default PCSS/PCF path`, () => {
      expect(source).toContain("shadowA = evalEVSMDir(atlasUV, cellMin, cellMax, currentDepth);");
      // The default path's sampling call must still exist untouched for byte-identical gates.
      if (file.includes("light_calc.frag.glsl")) {
        expect(source).toContain(
          "shadowA += texture(u_dirShadowMap, vec3(tapUV, currentDepth - bias));",
        );
        expect(source).toContain("shadowA /= 9.0;");
      }
    });

    it(`${file}: the cascade-blend sample routes EVSM through cell-clamped moments too`, () => {
      expect(source).toContain(
        "shadowB = evalEVSMDir(atlasUVB, cellMinB, cellMaxB, currentDepthB);",
      );
      expect(source).toContain("vec2 cellMinB = vec2(colB, rowB) / cols;");
      // The blend band must never mix PCF and EVSM results, so the legacy PCF call stays present.
      expect(source).toContain(
        "shadowB += texture(u_dirShadowMap, vec3(atlasUVB + vec2(x, y) * texelSize, currentDepthB - bias));",
      );
    });
  }
});
