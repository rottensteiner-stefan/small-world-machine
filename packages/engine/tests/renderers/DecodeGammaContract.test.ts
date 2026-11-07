import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ADR 0049: assets decode with a fixed 2.2 (`sRGBToLinear`), engine render targets the forward pass
// wrote through the gamma lane decode with that lane (`targetToLinear`), and display-referred
// shaders convert with `displayToTarget`. Source guards -- vitest has no shader compiler.

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

/** Source with comments removed: a mention in a comment must neither satisfy nor break a guard. */
function code(relative: string): string {
  return stripComments(read(relative));
}

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Text of the first function `fn` (word-bounded name) including nested blocks: brace matching, not the first `}`. */
export function body(source: string, fn: string): string {
  const stripped = stripComments(source);
  const start = stripped.search(new RegExp(`\\b(?:fn|vec3f?)\\s+${fn}\\s*\\(`));
  expect(start).toBeGreaterThan(-1);
  const open = stripped.indexOf("{", start);
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}" && --depth === 0) return stripped.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${fn}`);
}

/** Whole statements (from the previous `;`/brace to the next `;`) that sample a render-target input. */
export function targetSampleStatements(source: string): string[] {
  const stripped = stripComments(source);
  const sample =
    /\b(?:textureSampleLevel|textureSample|textureLod|texture2D|texture)\s*\(\s*(?:u_opaqueMap|u_reflectionMap)\b/g;
  const out: string[] = [];
  for (const m of stripped.matchAll(sample)) {
    const at = m.index;
    const begin = Math.max(
      stripped.lastIndexOf(";", at),
      stripped.lastIndexOf("{", at),
      stripped.lastIndexOf("}", at),
    );
    const end = stripped.indexOf(";", at);
    out.push(stripped.slice(begin + 1, end === -1 ? undefined : end));
  }
  return out;
}

/** Statements mentioning the named irradiance sampler (the decode may wrap a multi-line call). */
export function statementsMentioning(source: string, needle: RegExp): string[] {
  const stripped = stripComments(source);
  const out: string[] = [];
  for (const m of stripped.matchAll(new RegExp(needle, "g"))) {
    const at = m.index;
    const begin = Math.max(
      stripped.lastIndexOf(";", at),
      stripped.lastIndexOf("{", at),
      stripped.lastIndexOf("}", at),
    );
    const end = stripped.indexOf(";", at);
    out.push(stripped.slice(begin + 1, end === -1 ? undefined : end));
  }
  return out;
}

export function callsDisplayToTarget(source: string): boolean {
  return /\bdisplayToTarget\s*\(/.test(stripComments(source));
}

const wordRe = (lane: string): RegExp => new RegExp(`\\b${lane.replace(".", "\\.")}\\b`);

// displayToTarget sits where every shader of the tier can reach the lane: WGSL_STRUCTS (all WGSL
// shaders) and LIGHT_DEFS (every GLSL300 fog/display user).
const COLOR_CHUNKS = [
  {
    tier: "WebGPU",
    file: "packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl",
    displayFile: "packages/engine/src/renderers/shaders/source/web_gpu/chunks/structs.wgsl",
    lane: "global.gamma",
  },
  {
    tier: "WebGL2",
    file: "packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl",
    displayFile: "packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl",
    lane: "u_gamma",
  },
];

const TARGET_READERS = [
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
  "packages/engine/src/core/materials/surface/shaders/Standard.frag.wgsl",
  "packages/engine/src/core/materials/glass/shaders/Glass.frag.glsl",
  "packages/engine/src/core/materials/glass/shaders/Glass.frag.wgsl",
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.glsl",
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.wgsl",
  "packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.glsl",
  "packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.wgsl",
  "packages/engine/src/core/materials/liquid/shaders/StylizedWater.frag.glsl",
  "packages/engine/src/core/materials/liquid/shaders/StylizedWater.frag.wgsl",
  "packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.glsl",
  "packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.wgsl",
  "packages/liquid-extras/src/materials/RainPuddle/RainPuddle.frag.glsl",
  "packages/liquid-extras/src/materials/RainPuddle/RainPuddle.frag.wgsl",
];

// Standard.frag.glsl is NOT in TARGET_READERS by design (A02): its planar-reflection sample moved
// into the shared WebGL2 LIGHT_CALC_PBR chunk (the first TARGET_READERS entry, covered above).
// Guard the move's invariant instead -- the material source carries the sampler uniforms (the chunk
// reads them when the program links) but no inline render-target sample of its own.
const STANDARD_GLSL = "packages/engine/src/core/materials/surface/shaders/Standard.frag.glsl";

const DISPLAY_SHADERS = ["Skybox", "Sprite", "Wireframe", "RetroScreen"].map(
  (name) => `packages/engine/src/core/materials/shaders/${name}.frag`,
);
DISPLAY_SHADERS.push("packages/engine/src/core/materials/surface/shaders/Basic.frag");

describe("decode vs output gamma (ADR 0049)", () => {
  for (const { tier, file, displayFile, lane } of COLOR_CHUNKS) {
    const source = read(file);

    it(`${tier}: sRGBToLinear decodes assets with a fixed 2.2, never the output lane`, () => {
      const decode = body(source, "sRGBToLinear");
      expect(decode).toContain("2.2");
      expect(decode).not.toMatch(wordRe(lane));
    });

    it(`${tier}: targetToLinear and displayToTarget follow the output lane`, () => {
      expect(body(source, "targetToLinear")).toMatch(wordRe(lane));
      expect(body(read(displayFile), "displayToTarget")).toMatch(wordRe(lane));
    });
  }

  for (const file of TARGET_READERS) {
    it(`${path.basename(file)}: every render-target sample decodes with targetToLinear`, () => {
      const statements = targetSampleStatements(read(file));
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) expect(statement).not.toMatch(/\bsRGBToLinear\s*\(/);
      expect(code(file)).toMatch(/\btargetToLinear\s*\(/);
    });
  }

  it("Standard.frag.glsl has no inline render-target samples (they live in the shared chunk, A02)", () => {
    // A02 moved the planar-reflection sample out of this file into the WebGL2 LIGHT_CALC_PBR chunk
    // (covered by the TARGET_READERS loop above). The sampler uniforms stay (the chunk's blend reads
    // them), but a render-target sample must never return to the material source -- the generic loop
    // would not catch a zero-sample regression, so this guard pins the empty statement list.
    expect(targetSampleStatements(read(STANDARD_GLSL))).toHaveLength(0);
    expect(code(STANDARD_GLSL)).toContain("uniform sampler2D u_reflectionMap;");
  });

  for (const base of DISPLAY_SHADERS) {
    for (const ext of ["glsl", "wgsl"]) {
      it(`${path.basename(base)}.${ext}: display-referred output goes through displayToTarget`, () => {
        expect(callsDisplayToTarget(read(`${base}.${ext}`))).toBe(true);
      });
    }
  }

  it("both fog chunks convert the display-referred fog colour", () => {
    expect(code("packages/engine/src/core/materials/shaders/chunks/fog_calc.glsl")).toMatch(
      /\bdisplayToTarget\s*\(\s*u_fogColor\s*\)/,
    );
    expect(
      code("packages/engine/src/renderers/shaders/source/web_gpu/chunks/fog_calc.wgsl"),
    ).toMatch(/\bdisplayToTarget\s*\(\s*global\.fogColor\.rgb\s*\)/);
  });

  for (const name of ["ImpastoStroke", "MetalRelief", "MetalReliefScreen"]) {
    for (const ext of ["glsl", "wgsl"]) {
      it(`artistic-extras ${name}.frag.${ext}: display-referred output goes through displayToTarget`, () => {
        expect(
          callsDisplayToTarget(
            read(`packages/artistic-extras/src/materials/shaders/${name}.frag.${ext}`),
          ),
        ).toBe(true);
      });
    }
  }

  it("the volume attenuation colour is decoded like every engine Color on both tiers", () => {
    expect(
      read("packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl"),
    ).toContain("VolumeAbsorption(sRGBToLinear(u_matParam11.rgb)");
    expect(
      read("packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl"),
    ).toContain("VolumeAbsorption(sRGBToLinear(obj.matParam11.xyz)");
  });

  it("the fog ambient decodes the sRGB irradiance cube on both tiers", () => {
    for (const file of [
      "packages/engine/src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl",
      "packages/engine/src/renderers/post/shaders/VolumetricFog.frag.glsl",
    ]) {
      const statements = statementsMentioning(read(file), /\bu_irradianceMap\s*,/);
      expect(statements.length).toBeGreaterThanOrEqual(1);
      for (const statement of statements)
        expect(statement).toMatch(/\bpow\s*\(|\bsRGBToLinear\s*\(/);
    }
  });
});

// Mutation self-test: each fixture is a deliberately broken shader the PREVIOUS guards waved through. The legacy
// implementations are kept here only to prove the new ones are strictly stronger (old green, new red).
describe("guard self-test: mutated shader text", () => {
  const legacyBody = (source: string, fn: string): string => {
    const start = source.search(new RegExp(`(fn|vec3) ${fn}\\(`));
    return source.slice(start, source.indexOf("}", start));
  };
  const legacyTargetSampleLines = (source: string): string[] =>
    source
      .split("\n")
      .filter(
        (l) =>
          /(texture|textureSample)\((u_opaqueMap|u_reflectionMap)\b/.test(l) &&
          !l.trim().startsWith("//"),
      );

  it("a nested block before the lane use no longer truncates the body (decode reading the lane is caught)", () => {
    const mutated = `vec3 sRGBToLinear(vec3 c) {
      if (c.r > 2.0) { c = c * 1.0; }
      return pow(c, vec3(u_gamma));
    }`;
    expect(legacyBody(mutated, "sRGBToLinear")).not.toContain("u_gamma"); // old guard: falsely green
    expect(body(mutated, "sRGBToLinear")).toMatch(wordRe("u_gamma")); // new guard: sees the lane
  });

  it("a multi-line sRGBToLinear( wrapping a render-target sample is caught", () => {
    const mutated = `vec3 c = sRGBToLinear(
      texture(u_opaqueMap, uv).rgb);`;
    for (const line of legacyTargetSampleLines(mutated))
      expect(line).not.toContain("sRGBToLinear("); // old: green
    const statements = targetSampleStatements(mutated);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/\bsRGBToLinear\s*\(/); // new: red-worthy
  });

  it("displayToTarget( in a comment no longer satisfies the display guard", () => {
    const mutated = `// fragColor = vec4(displayToTarget(c), 1.0);
    /* displayToTarget( */
    fragColor = vec4(c, 1.0);`;
    expect(mutated.includes("displayToTarget(")).toBe(true); // old guard: falsely green
    expect(callsDisplayToTarget(mutated)).toBe(false);
  });

  it("a commented-out sRGBToLinear on a sample line does not hide a live one, and comments are ignored", () => {
    const mutated = `// vec3 ok = targetToLinear(texture(u_opaqueMap, uv).rgb);
    vec3 bad = sRGBToLinear(texture(u_reflectionMap, uv).rgb);`;
    const statements = targetSampleStatements(mutated);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/\bsRGBToLinear\s*\(/);
  });

  it("the irradiance decode guard accepts a multi-line pow( and does not depend on an exact sample count", () => {
    const okay = `vec3 a = pow(
      texture(u_irradianceMap, n).rgb, vec3(2.2));`;
    const broken = `vec3 a = texture(u_irradianceMap, n).rgb;`;
    expect(statementsMentioning(okay, /\bu_irradianceMap\s*,/)[0]).toMatch(/\bpow\s*\(/);
    expect(statementsMentioning(broken, /\bu_irradianceMap\s*,/)[0]).not.toMatch(
      /\bpow\s*\(|\bsRGBToLinear\s*\(/,
    );
  });
});
