import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Source guards (no shader compiler in vitest).
// 1. The WGSL fog chunk mixes `displayToTarget(global.fogColor)` into `color` itself, so a shader must
//    convert to the target lane BEFORE `[WGSL_FOG_CALC]`; converting afterwards double-converts fog.
// 2. WebGL2/WebGPU point shadows pick the cube face from the biased sample position and bias along
//    the geometric normal.

const ROOT = join(__dirname, "../../..");
const GPU = join(ROOT, "engine/src/renderers/shaders/source/web_gpu/chunks");
const GL2 = join(ROOT, "engine/src/renderers/shaders/source/web_gl2/chunks");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function code(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}

function collect(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, ext, out);
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}

describe("WGSL fragment shaders: displayToTarget before [WGSL_FOG_CALC]", () => {
  const files = readdirSync(ROOT)
    .map((pkg) => join(ROOT, pkg, "src"))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap((dir) => collect(dir, ".frag.wgsl"))
    .filter((f) => code(f).includes("[WGSL_FOG_CALC]"));

  it("scan finds the fog-using shaders", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${relative(ROOT, file)} converts before fog, not after`, () => {
      const src = code(file);
      const fogAt = src.indexOf("[WGSL_FOG_CALC]");
      expect(src.indexOf("[WGSL_FOG_CALC]", fogAt + 1)).toBe(-1);
      expect(src.slice(fogAt)).not.toContain("displayToTarget(");
    });
  }
});

function packageSources(): string[] {
  return readdirSync(ROOT)
    .map((pkg) => join(ROOT, pkg, "src"))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

describe("GLSL fragment shaders: [FOG_CALC] placement and WGSL parity", () => {
  const glsl = packageSources()
    .flatMap((dir) => [...collect(dir, ".frag.glsl"), ...collect(dir, ".frag.glsl100")])
    .filter((f) => code(f).includes("[FOG_CALC]"));
  const wgslWithFog = packageSources()
    .flatMap((dir) => collect(dir, ".frag.wgsl"))
    .filter((f) => code(f).includes("[WGSL_FOG_CALC]"));

  it("scan finds the fog-using GLSL shaders", () => {
    expect(glsl.length).toBeGreaterThan(5);
    expect(wgslWithFog.length).toBeGreaterThan(10);
  });

  for (const file of glsl) {
    it(`${relative(ROOT, file)}: [FOG_DEFS] precedes a single [FOG_CALC], no lane conversion after it`, () => {
      const src = code(file);
      const fogAt = src.indexOf("[FOG_CALC]");
      expect(src.indexOf("[FOG_CALC]", fogAt + 1)).toBe(-1);
      expect(src.indexOf("[FOG_DEFS]")).toBeGreaterThan(-1);
      expect(src.indexOf("[FOG_DEFS]")).toBeLessThan(fogAt);
      // FOG_CALC mixes displayToTarget(u_fogColor) itself (GLSL300): converting afterwards double-converts.
      expect(src.slice(fogAt)).not.toMatch(/\b(?:displayToTarget|linearToSRGB)\s*\(/);
    });
  }

  for (const wgsl of wgslWithFog) {
    const base = wgsl.slice(0, -".wgsl".length);
    for (const ext of [".glsl", ".glsl100"]) {
      const sibling = base + ext;
      let exists = true;
      try {
        statSync(sibling);
      } catch {
        exists = false;
      }
      if (!exists) continue;
      it(`${relative(ROOT, sibling)} applies fog like its WGSL twin`, () => {
        expect(code(sibling)).toContain("[FOG_CALC]");
      });
    }
  }
});

describe("point shadow face selection and normal parity", () => {
  const glsl = code(join(GL2, "base_fragment_header.frag.glsl"));
  const fn = glsl.slice(glsl.indexOf("float pointShadowFactor("));
  const pbrMath = code(join(GPU, "pbr_math.wgsl"));
  const wgslFn = pbrMath.slice(pbrMath.indexOf("fn getPointShadow("));

  it("WebGL2 pointShadowFactor picks the face from samplePos - lightPos, after samplePos", () => {
    const samplePosAt = fn.indexOf("vec3 samplePos =");
    const faceAt = fn.indexOf("pointShadowFace(");
    expect(samplePosAt).toBeGreaterThan(-1);
    expect(faceAt).toBeGreaterThan(samplePosAt);
    expect(fn).toContain("pointShadowFace(samplePos - lightPos)");
    expect(fn).not.toContain("pointShadowFace(worldPos - lightPos)");
  });

  it("WGSL getPointShadow uses the same face source (parity)", () => {
    expect(wgslFn).toContain("pointShadowFace(samplePos - lightPos)");
  });

  it("WGSL point-light loops pass the geometric normal (i.n), like GLSL v_normal", () => {
    for (const file of ["lighting_pbr.wgsl", "glass_pbr_loops.wgsl"]) {
      const src = code(join(GPU, file));
      expect(src).toContain("let geomN = normalize(i.n);");
      expect(src).toMatch(
        /getPointShadow\([^;]*,\s*i\.wp,\s*geomN,\s*max\(dot\(geomN, L\), 0\.0\)\)/,
      );
    }
  });
});
