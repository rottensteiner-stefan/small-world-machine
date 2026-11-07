import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ToneMappingMode } from "../../src/enums/ToneMappingMode.js";

// Tone operators (shared/tone_operators.{glsl,wgsl}): the GLSL and WGSL sources must carry the
// same constants, and a CPU reference built from those constants must show each curve's defining
// property. vitest has no shader compiler, so the reference is bound to the shader text through
// its constants (every reference literal must occur in both sources).

const ROOT = path.resolve(__dirname, "../../../..");
const SHARED = "packages/engine/src/renderers/shaders/source/shared";
const GLSL = fs.readFileSync(path.join(ROOT, SHARED, "tone_operators.glsl"), "utf-8");
const WGSL = fs.readFileSync(path.join(ROOT, SHARED, "tone_operators.wgsl"), "utf-8");

type V3 = [number, number, number];

function literals(src: string): string[] {
  const code = src.replace(/\/\/[^\n]*/g, "");
  return (code.match(/(?<![\w.])\d+\.\d+(?:e[-+]?\d+)?|(?<![\w.])\d+e[-+]?\d+/g) ?? [])
    .map((n) => String(Number(n)))
    .sort();
}

const lum = (c: V3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const map = (c: V3, f: (x: number) => number): V3 => [f(c[0]), f(c[1]), f(c[2])];
const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
/** Row-vector times row-major matrix, i.e. GLSL `v * mat3(rows...)`. */
const rowMul = (v: V3, m: readonly number[]): V3 => [
  v[0] * m[0]! + v[1] * m[1]! + v[2] * m[2]!,
  v[0] * m[3]! + v[1] * m[4]! + v[2] * m[5]!,
  v[0] * m[6]! + v[1] * m[7]! + v[2] * m[8]!,
];
/** Column-major matrix times vector, i.e. GLSL `mat3(cols...) * v`. */
const colMul = (m: readonly number[], v: V3): V3 => [
  m[0]! * v[0] + m[3]! * v[1] + m[6]! * v[2],
  m[1]! * v[0] + m[4]! * v[1] + m[7]! * v[2],
  m[2]! * v[0] + m[5]! * v[1] + m[8]! * v[2],
];

const HILL_IN = [0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const HILL_OUT = [
  1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602,
];
const AGX_IN = [
  0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772,
  0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104,
];
const AGX_OUT = [
  1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417,
  -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116,
];

const REF: Record<number, (c: V3, white: number) => V3> = {
  [ToneMappingMode.NONE]: (c) => c,
  [ToneMappingMode.REINHARD]: (c) => map(c, (x) => x / (x + 1)),
  [ToneMappingMode.CINEON]: (c) =>
    map(c, (x) => {
      const m = Math.max(0, x - 0.004);
      return ((m * (6.2 * m + 0.5)) / (m * (6.2 * m + 1.7) + 0.06)) ** 2.2;
    }),
  [ToneMappingMode.ACES_FILMIC]: (c) =>
    map(c, (x) => clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))),
  [ToneMappingMode.REINHARD_EXTENDED]: (c, white) => {
    const l = lum(c);
    const lm = (l * (1 + l / Math.max(white * white, 1e-4))) / (1 + l);
    return map(c, (x) => clamp01(x * (lm / Math.max(l, 1e-6))));
  },
  [ToneMappingMode.ACES_HILL]: (c) => hill(c),
  [ToneMappingMode.ACES_HILL_EXPOSURE_BOOST]: (c) => hill(map(c, (x) => x / 0.6)),
  [ToneMappingMode.AGX]: (c) => {
    const minEv = -12.47393;
    const maxEv = 4.026069;
    const v = map(
      colMul(AGX_IN, c),
      (x) =>
        (Math.min(Math.max(Math.log2(Math.max(x, 1e-10)), minEv), maxEv) - minEv) / (maxEv - minEv),
    );
    const poly = map(v, (x) => {
      const x2 = x * x;
      const x4 = x2 * x2;
      return (
        15.5 * x4 * x2 -
        40.14 * x4 * x +
        31.96 * x4 -
        6.868 * x2 * x +
        0.4298 * x2 +
        0.1191 * x -
        0.00232
      );
    });
    return map(colMul(AGX_OUT, poly), (x) => Math.max(x, 0) ** 2.2);
  },
  [ToneMappingMode.PBR_NEUTRAL]: (cIn) => {
    const start = 0.8 - 0.04;
    const x = Math.min(...cIn);
    const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    const c = map(cIn, (v) => v - offset);
    const peak = Math.max(...c);
    if (peak < start) return c;
    const d = 1 - start;
    const newPeak = 1 - (d * d) / (peak + d - start);
    const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
    return map(c, (v) => v * (newPeak / peak) * (1 - g) + newPeak * g);
  },
};

function hill(c: V3): V3 {
  const v = rowMul(c, HILL_IN);
  const fit = map(
    v,
    (x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081),
  );
  return map(rowMul(fit, HILL_OUT), clamp01);
}

const CURVES = Object.entries(ToneMappingMode).filter(([name]) => name !== "DEFAULT");

describe("tone operators: one source, two languages", () => {
  it("GLSL and WGSL carry the identical set of constants", () => {
    expect(literals(WGSL)).toEqual(literals(GLSL));
  });

  it("every curve of the enum has a dispatch case in both languages and a CPU reference", () => {
    for (const [name, mode] of CURVES) {
      if (mode === ToneMappingMode.NONE) continue;
      expect(GLSL, name).toMatch(new RegExp(`if \\(mode == ${mode}\\) return tm\\w+\\(`));
      expect(WGSL, name).toMatch(new RegExp(`case ${mode}: \\{ return tm\\w+\\(`));
      expect(REF[mode], name).toBeDefined();
    }
  });

  it("the CPU reference constants occur in the shader sources", () => {
    const shader = new Set(literals(GLSL));
    for (const n of [
      ...HILL_IN,
      ...HILL_OUT,
      ...AGX_IN,
      ...AGX_OUT,
      0.0245786,
      0.000090537,
      0.983729,
      0.432951,
      0.238081,
      -12.47393,
      4.026069,
      6.25,
      0.15,
      2.51,
      2.43,
      0.59,
      0.14,
    ]) {
      expect(shader.has(String(Math.abs(n))), String(n)).toBe(true);
    }
  });

  it("PBR Neutral is the default curve", () => {
    expect(ToneMappingMode.DEFAULT).toBe(ToneMappingMode.PBR_NEUTRAL);
  });
});

describe("tone operators: defining properties (CPU reference)", () => {
  const ramp = Array.from({ length: 200 }, (_, i) => 10 ** (-3 + (i / 199) * 6)); // 0.001 .. 1000

  for (const [name, mode] of CURVES) {
    if (mode === ToneMappingMode.NONE) continue;
    it(`${name}: monotone on a gray ramp and bounded to [0, 1]`, () => {
      let prev = -Infinity;
      for (const x of ramp) {
        const y = REF[mode]!([x, x, x], 4)[1];
        expect(y, `${name} at ${x}`).toBeGreaterThanOrEqual(prev - 1e-6);
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(1 + 1e-6);
        prev = y;
      }
    });
  }

  it("PBR Neutral reproduces base colors exactly below the compression start", () => {
    const tm = REF[ToneMappingMode.PBR_NEUTRAL]!;
    // A lit base color arrives with the 0.04 dielectric Fresnel added; the curve removes it.
    for (const base of [
      [0.7, 0.44, 0.22],
      [0.1, 0.5, 0.7],
      [0.3, 0.3, 0.3],
    ] as V3[]) {
      const out = tm(
        map(base, (v) => v + 0.04),
        4,
      );
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(base[i]!, 6);
    }
    // The dino orange (0.88 peak) keeps its hue order and stays saturated, unlike Reinhard.
    const orange: V3 = [0.75, 0.16, 0.04];
    const neutral = tm(orange, 4);
    const reinhard = REF[ToneMappingMode.REINHARD]!(orange, 4);
    const sat = (c: V3): number => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
    expect(sat(neutral)).toBeGreaterThan(sat(reinhard));
  });

  it("extended Reinhard maps the white point to 1.0 and keeps the hue", () => {
    const tm = REF[ToneMappingMode.REINHARD_EXTENDED]!;
    expect(lum(tm([4, 4, 4], 4))).toBeCloseTo(1, 6);
    const c = tm([0.6, 0.3, 0.1], 4);
    expect(c[0] / c[1]).toBeCloseTo(2, 6);
    expect(c[1] / c[2]).toBeCloseTo(3, 6);
  });

  it("ACES Hill exposure boost equals Hill at 1/0.6 input", () => {
    const boost = REF[ToneMappingMode.ACES_HILL_EXPOSURE_BOOST]!([0.3, 0.3, 0.3], 4);
    const plain = REF[ToneMappingMode.ACES_HILL]!([0.5, 0.5, 0.5], 4);
    expect(boost[1]).toBeCloseTo(plain[1], 6);
  });

  it("AgX desaturates very bright saturated light toward white (path to white)", () => {
    const out = REF[ToneMappingMode.AGX]!([200, 20, 2], 4);
    expect(Math.min(...out) / Math.max(...out)).toBeGreaterThan(0.5);
  });
});
