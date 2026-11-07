import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";

const SRC_DIR = join(__dirname, "../../../src");
const read = (relative: string): string => readFileSync(join(SRC_DIR, relative), "utf8");

type Vec3 = [number, number, number];
const PI = 3.14159265359;
const map3 = (a: Vec3, f: (x: number) => number): Vec3 => [f(a[0]), f(a[1]), f(a[2])];
const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/** XYZ -> linear Rec.709, column-major in the shaders: columns are the three vec3f/mat3 columns. */
const XYZ_TO_REC709 = [
  [3.2404542, -0.969266, 0.0556434],
  [-1.5371385, 1.8760108, -0.2040259],
  [-0.4985314, 0.041556, 1.0572252],
];

/** Mirror of `iridescenceSensitivity` in the WGSL / GLSL 300 `pbr_math` chunks. */
function sensitivity(opd: number, shift: Vec3): Vec3 {
  const phase = 2 * PI * opd * 1e-9;
  const amplitude: Vec3 = [5.4856e-13, 4.4201e-13, 5.2481e-13];
  const position: Vec3 = [1.681e6, 1.7953e6, 2.2084e6];
  const variance: Vec3 = [4.3278e9, 9.3046e9, 6.6121e9];
  const xyz = [0, 1, 2].map(
    (k) =>
      amplitude[k]! *
      Math.sqrt(2 * PI * variance[k]!) *
      Math.cos(position[k]! * phase + shift[k]!) *
      Math.exp(-(phase * phase) * variance[k]!),
  ) as Vec3;
  xyz[0] +=
    9.747e-14 *
    Math.sqrt(2 * PI * 4.5282e9) *
    Math.cos(2.2399e6 * phase + shift[0]) *
    Math.exp(-4.5282e9 * phase * phase);
  const scaled = map3(xyz, (v) => v / 1.0685e-7);
  return [0, 1, 2].map(
    (row) =>
      XYZ_TO_REC709[0]![row]! * scaled[0] +
      XYZ_TO_REC709[1]![row]! * scaled[1] +
      XYZ_TO_REC709[2]![row]! * scaled[2],
  ) as Vec3;
}

/** Mirror of `evalIridescence` in the WGSL / GLSL 300 `pbr_math` chunks. */
function evalIridescence(
  outsideIor: number,
  filmIor: number,
  cosTheta1: number,
  thicknessNm: number,
  baseF0: Vec3,
): Vec3 {
  const iridescenceIor = outsideIor + (filmIor - outsideIor) * smoothstep(0, 0.03, thicknessNm);
  const ratio = outsideIor / iridescenceIor;
  const cosTheta2Sq = 1 - ratio * ratio * (1 - cosTheta1 * cosTheta1);
  if (cosTheta2Sq < 0) return [1, 1, 1];
  const cosTheta2 = Math.sqrt(cosTheta2Sq);

  const x1 = Math.pow(clamp(1 - cosTheta1, 0, 1), 5);
  const r0 = Math.pow((iridescenceIor - outsideIor) / (iridescenceIor + outsideIor), 2);
  const r12 = r0 + (1 - r0) * x1;
  const t121 = 1 - r12;
  const phi12 = iridescenceIor < outsideIor ? PI : 0;
  const phi21 = PI - phi12;

  const sqrtF0 = map3(baseF0, (v) => Math.sqrt(clamp(v, 0, 0.9999)));
  const baseIor = map3(sqrtF0, (s) => (1 + s) / (1 - s));
  const r1 = map3(baseIor, (b) => Math.pow((b - iridescenceIor) / (b + iridescenceIor), 2));
  const x2 = Math.pow(clamp(1 - cosTheta2, 0, 1), 5);
  const r23 = map3(r1, (r) => r + (1 - r) * x2);
  const phi23 = map3(baseIor, (b) => (b < iridescenceIor ? PI : 0));

  const opd = 2 * iridescenceIor * thicknessNm * cosTheta2;
  const phi = map3(phi23, (p) => phi21 + p);

  const r123Sq = map3(r23, (r) => clamp(r12 * r, 1e-5, 0.9999));
  const r123 = map3(r123Sq, Math.sqrt);
  const rs = [0, 1, 2].map((k) => (t121 * t121 * r23[k]!) / (1 - r123Sq[k]!)) as Vec3;

  const cm1 = [0, 1, 2].map((k) => (rs[k]! - t121) * r123[k]!) as Vec3;
  const cm2 = [0, 1, 2].map((k) => cm1[k]! * r123[k]!) as Vec3;
  const s1 = sensitivity(opd, phi);
  const s2 = sensitivity(
    2 * opd,
    map3(phi, (p) => 2 * p),
  );
  const result = [0, 1, 2].map(
    (k) => r12 + rs[k]! + cm1[k]! * 2 * s1[k]! + cm2[k]! * 2 * s2[k]!,
  ) as Vec3;
  return map3(result, (v) => Math.max(v, 0));
}

const schlick = (f0: number, cosTheta: number): number =>
  f0 + (1 - f0) * Math.pow(clamp(1 - cosTheta, 0, 1), 5);

function schlickToF0(fresnel: Vec3, f90: number, cosTheta: number): Vec3 {
  const x = clamp(1 - cosTheta, 0, 1);
  const x5 = clamp(x * x * x * x * x, 0, 0.9999);
  return map3(fresnel, (f) => (f - f90 * x5) / (1 - x5));
}

describe("KHR_materials_iridescence: StandardMaterial lane u_matParam14", () => {
  it("is off at the defaults and ships the spec defaults for film IOR and thickness", () => {
    const manifest = new StandardMaterial().getRenderManifest();
    const lane = (manifest.properties as Record<string, number[]>)["u_matParam14"]!;

    expect(lane).toEqual([0, 1.3, 100, 400]);
    expect(manifest.flags).not.toContain("USE_IRIDESCENCE");
  });

  it("packs factor, film IOR and thickness range and sets the compile flag", () => {
    const material = new StandardMaterial({
      iridescenceFactor: 0.7,
      iridescenceIor: 1.8,
      iridescenceThicknessMinimum: 200,
      iridescenceThicknessMaximum: 600,
    });
    const manifest = material.getRenderManifest();

    expect((manifest.properties as Record<string, number[]>)["u_matParam14"]).toEqual([
      0.7, 1.8, 200, 600,
    ]);
    expect(manifest.flags).toContain("USE_IRIDESCENCE");
  });

  it("re-disables the flag when the factor returns to 0", () => {
    const material = new StandardMaterial({ iridescenceFactor: 1 });
    material.getRenderManifest();
    material.iridescenceFactor = 0;

    expect(material.getRenderManifest().flags).not.toContain("USE_IRIDESCENCE");
  });
});

describe("KHR_materials_iridescence: thin-film math", () => {
  const goldLikeF0: Vec3 = [1, 0.78, 0.34];

  // Normal incidence only: the Khronos reference evaluates the top interface as Schlick(R0 = 0, cosTheta1),
  // which keeps (1 - cosTheta1)^5 of spurious reflectance at grazing angles even when the film vanishes.
  // The shaders reproduce that formula line by line (checked against iridescence.glsl of the Khronos sample
  // renderer), so the fallback is only asserted where the reference itself is exact.
  it("falls back to plain Schlick of the base layer at normal incidence when the film has no thickness", () => {
    for (const f0 of [0.04, 0.3, 0.9]) {
      const iridescent = evalIridescence(1, 1.3, 1, 0, [f0, f0, f0]);

      for (const channel of iridescent) {
        expect(channel).toBeCloseTo(schlick(f0, 1), 1);
      }
    }
  });

  it("stays finite and non-negative over the whole parameter range", () => {
    for (const cosTheta of [0.01, 0.05, 0.3, 0.7, 1]) {
      for (const thickness of [0, 5, 100, 250, 400, 800, 1500]) {
        for (const baseF0 of [
          [0.04, 0.04, 0.04],
          [0.5, 0.5, 0.5],
          [0.97, 0.97, 0.97],
          goldLikeF0,
        ] as Vec3[]) {
          for (const channel of evalIridescence(1, 1.3, cosTheta, thickness, baseF0)) {
            expect(Number.isFinite(channel)).toBe(true);
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThan(3);
          }
        }
      }
    }
  });

  it("produces a thickness-dependent colour shift (the channels diverge for some thickness)", () => {
    let widest = 0;
    for (let thickness = 100; thickness <= 400; thickness += 10) {
      const [r, g, b] = evalIridescence(1, 1.3, 1, thickness, goldLikeF0);
      widest = Math.max(widest, Math.max(r, g, b) - Math.min(r, g, b));
    }

    expect(widest).toBeGreaterThan(0.15);
  });

  it("returns total reflection (1) beyond the critical angle", () => {
    expect(evalIridescence(1.5, 1.0, 0.05, 300, [0.04, 0.04, 0.04])).toEqual([1, 1, 1]);
  });

  it("schlickToF0 inverts Schlick at the evaluation angle", () => {
    for (const f0 of [0.04, 0.4, 0.85]) {
      for (const cosTheta of [0.15, 0.5, 0.9]) {
        const fresnel = schlick(f0, cosTheta);
        const recovered = schlickToF0([fresnel, fresnel, fresnel], 1, cosTheta);

        expect(recovered[0]).toBeCloseTo(f0, 6);
      }
    }
  });
});

describe("KHR_materials_iridescence: shader parity across the three tiers", () => {
  const sensitivityConstants = [
    "5.4856e-13, 4.4201e-13, 5.2481e-13",
    "1.6810e+06, 1.7953e+06, 2.2084e+06",
    "4.3278e+09, 9.3046e+09, 6.6121e+09",
    "9.7470e-14",
    "4.5282e+09",
    "2.2399e+06",
    "1.0685e-7",
    "3.2404542",
    "1.8760108",
    "1.0572252",
  ];

  for (const [tier, file] of [
    ["WGSL", "renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl"],
    ["WebGL2", "renderers/shaders/source/web_gl2/chunks/pbr_math.frag.glsl"],
  ] as const) {
    it(`${tier}: the spectral model carries the Khronos sensitivity constants`, () => {
      const source = read(file);

      for (const constant of sensitivityConstants) expect(source).toContain(constant);
      expect(source).toContain("evalIridescence(");
      expect(source).toContain("schlickToF0(");
    });
  }

  it("WebGL1 uses the cheap two-beam model, never the spectral one", () => {
    const math = read("renderers/shaders/source/web_gl1/chunks/pbr_math.frag.glsl");
    const chunk = read("renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl");

    expect(math).toContain("vec3 iridescenceFresnelCheap(");
    expect(math).not.toContain("iridescenceSensitivity");
    expect(chunk).toContain("iridescenceFresnelCheap(dotNV, u_matParam14.y, u_matParam14.w, F0)");
    expect(chunk).not.toContain("evalIridescence");
  });

  it("every tier evaluates once at the view angle with the maximum thickness and folds the result into F0", () => {
    const wgsl = read("renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl");
    const glsl300 = read("renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl");

    expect(wgsl).toContain("evalIridescence(1.0, obj.matParam14.y, dotNV, obj.matParam14.w, F0)");
    expect(wgsl).toMatch(/#ifdef USE_IRIDESCENCE[\s\S]*evalIridescence\(1\.0, obj\.matParam14\.y/);
    expect(wgsl).toMatch(/F0 = mix\(F0, clamp\(schlickToF0\(iridescenceFresnel, 1\.0, dotNV\)/);
    expect(glsl300).toContain(
      "evalIridescence(1.0, u_matParam14.y, dotNV, iridescenceThickness, F0)",
    );
    expect(glsl300).toContain("iridescenceStrength);");
    expect(glsl300).toMatch(/#ifdef USE_IRIDESCENCE[\s\S]*F0 = mix\(F0, clamp\(schlickToF0\(/);
  });

  it("the Decal program sharing the WebGL2 chunk never references the iridescence lane", () => {
    expect(read("core/materials/surface/shaders/Decal.frag.glsl")).not.toContain("u_matParam14");
  });

  it("Standard declares the lane (gated on WebGL2, plain on WebGL1)", () => {
    expect(read("core/materials/surface/shaders/Standard.frag.glsl")).toMatch(
      /#ifdef USE_IRIDESCENCE[\s\S]*uniform vec4 u_matParam14;/,
    );
    expect(read("core/materials/surface/shaders/Standard.frag.glsl100")).toContain(
      "uniform vec4 u_matParam14;",
    );
  });
});
