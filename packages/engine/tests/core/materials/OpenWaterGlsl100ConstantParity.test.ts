import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../../src");
const GLSL100 = join(SRC_DIR, "core/materials/liquid/shaders/OpenWater.frag.glsl100");
const GLSL300 = join(SRC_DIR, "core/materials/liquid/shaders/OpenWater.frag.glsl");

// H4 source lint (liquid-roadmap close-out 2026-10-18): the WebGL1 (GLSL 100) path must use the SAME
// named shader constants as GLSL300/WGSL for the values that exist in both, so a value edit can never
// silently detach WebGL1 from the other backends again. Only constants with a 1:1 literal counterpart
// are declared in GLSL100; the depth/pow-model constants that have no counterpart in this simplified
// path (CAUSTICS_MAX_DEPTH, CAUSTICS_FADE_EXPONENT, SPECULAR_EXPONENT, SPECULAR_INTENSITY) are
// documented in a comment instead of being dead-declared.
describe("OpenWater GLSL100 constant parity", () => {
  const glsl100 = readFileSync(GLSL100, "utf8");
  const glsl300 = readFileSync(GLSL300, "utf8");

  const decls = (source: string): Map<string, string> => {
    const map = new Map<string, string>();
    const re = /const\s+(?:float|vec3)\s+([A-Z0-9_]+)\s*=\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      map.set(m[1]!, m[2]!.trim());
    }
    return map;
  };

  const sharedConstants = [
    "CREST_FOAM_THRESHOLD_LOW",
    "CREST_FOAM_THRESHOLD_HIGH",
    "CREST_FOAM_INTENSITY",
    "CAUSTICS_SCALE",
    "CAUSTICS_GAIN",
    "CAUSTICS_LIGHT_TINT",
  ];

  it("declares the shared constants in GLSL100 with values equal to GLSL300", () => {
    const hundred = decls(glsl100);
    const three = decls(glsl300);
    for (const name of sharedConstants) {
      const v100 = hundred.get(name)!;
      const v300 = three.get(name)!;
      expect(v100, `${name} declared in GLSL100`).toBeDefined();
      expect(v300, `${name} declared in GLSL300`).toBeDefined();
      expect(v100, `${name} value equal across backends`).toBe(v300);
    }
  });

  it("references the named constants at the use sites (no literal fallbacks)", () => {
    expect(glsl100).toContain(
      "smoothstep(CREST_FOAM_THRESHOLD_LOW, CREST_FOAM_THRESHOLD_HIGH, v_crest)",
    );
    expect(glsl100).toContain("* CREST_FOAM_INTENSITY");
    expect(glsl100).toContain("* CAUSTICS_SCALE +");
    expect(glsl100).toContain("CAUSTICS_LIGHT_TINT * causticsValue * causticsFade * CAUSTICS_GAIN");
  });

  it("documents why the depth/pow-model constants are absent in GLSL100", () => {
    // If someone copies the full GLSL300 constant set over, this comment documents the algorithm
    // divergence instead of silently keeping dead constants.
    expect(glsl100).toContain("CAUSTICS_MAX_DEPTH");
    expect(glsl100).toContain("SPECULAR_EXPONENT");
    expect(glsl100).toContain("are intentionally NOT declared here");
  });
});
