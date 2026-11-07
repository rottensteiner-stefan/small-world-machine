import { describe, expect, it } from "vitest";
import { readSource } from "./_shaderScalar.js";
import { makeLcg } from "./_refBrdf.js";

// G01 (GL1): `EnvBRDFApprox` stands in for the GL2/WGPU `u_brdfLUT` split-sum lookup. The constants
// are read from the real shader, the formula is ported 1:1 and compared with a Monte-Carlo
// integration of the split-sum (Karis 2013, GGX importance sampling, IBL geometry k = alpha / 2).
// The Karis/Lazarov mobile fit is a coarse analytic stand-in: measured worst case ~0.15 abs
// (scale at mid roughness / high N·V, ~15% darker specular), mean abs error well below 0.07.
// A refit of the same functional form (LM, 17x17 MC grid) did not beat that meaningfully
// (.agents/scratches/fit_envbrdf.py), so the published constants stay.

const SRC = readSource(
  "packages/engine/src/renderers/shaders/source/web_gl1/chunks/pbr_math.frag.glsl",
);

function readVec4(name: string): [number, number, number, number] {
  const m = new RegExp(`const vec4 ${name} = vec4\\(([^)]+)\\);`).exec(SRC);
  if (!m) throw new Error(`${name} missing in GL1 EnvBRDFApprox`);
  const v = (m[1] as string).split(",").map(Number);
  return [v[0] as number, v[1] as number, v[2] as number, v[3] as number];
}

/** 1:1 port of the shader's `EnvBRDFApprox` (GLSL `exp2`, `min`, component-wise vec4 math). */
function envBrdfApprox(roughness: number, dotNV: number): [number, number] {
  const c0 = readVec4("c0");
  const c1 = readVec4("c1");
  const r = c0.map((c, i) => roughness * c + (c1[i] as number)) as [number, number, number, number];
  const a004 = Math.min(r[0] * r[0], 2 ** (-9.28 * dotNV)) * r[0] + r[1];
  return [Math.max(-1.04 * a004 + r[2], 0), Math.max(1.04 * a004 + r[3], 0)];
}

/** Reference split-sum (scale, bias) by GGX importance sampling. */
function integrateSplitSum(roughness: number, dotNV: number, samples: number): [number, number] {
  const rnd = makeLcg(1234567);
  const alpha = roughness * roughness;
  const k = alpha / 2;
  const V: [number, number, number] = [Math.sqrt(1 - dotNV * dotNV), 0, dotNV];
  let a = 0;
  let b = 0;
  for (let i = 0; i < samples; i++) {
    const u1 = rnd();
    const u2 = rnd();
    const phi = 2 * Math.PI * u1;
    const cosT = Math.sqrt((1 - u2) / (1 + (alpha * alpha - 1) * u2));
    const sinT = Math.sqrt(1 - cosT * cosT);
    const H: [number, number, number] = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT];
    const vh = V[0] * H[0] + V[1] * H[1] + V[2] * H[2];
    const L: [number, number, number] = [
      2 * vh * H[0] - V[0],
      2 * vh * H[1] - V[1],
      2 * vh * H[2] - V[2],
    ];
    const nl = L[2];
    if (nl <= 0) continue;
    const nh = H[2];
    const vhc = Math.max(vh, 0);
    const gV = dotNV / (dotNV * (1 - k) + k);
    const gL = nl / (nl * (1 - k) + k);
    const gVis = (gV * gL * vhc) / (nh * dotNV);
    const fc = (1 - vhc) ** 5;
    a += (1 - fc) * gVis;
    b += fc * gVis;
  }
  return [a / samples, b / samples];
}

describe("GL1 EnvBRDFApprox vs Monte-Carlo split-sum (G01)", () => {
  const roughnesses = [0.1, 0.3, 0.5, 0.8, 1.0];
  const cosines = [0.1, 0.3, 0.6, 0.9];

  it("stays within the documented fit envelope of the integral (max 0.16, mean 0.07)", () => {
    let sum = 0;
    let n = 0;
    for (const r of roughnesses) {
      for (const nv of cosines) {
        const [as, bs] = envBrdfApprox(r, nv);
        const [ar, br] = integrateSplitSum(r, nv, 20000);
        expect(Math.abs(as - ar), `scale r=${r} nv=${nv}`).toBeLessThan(0.16);
        expect(Math.abs(bs - br), `bias r=${r} nv=${nv}`).toBeLessThan(0.16);
        sum += Math.abs(as - ar) + Math.abs(bs - br);
        n += 2;
      }
    }
    expect(sum / n).toBeLessThan(0.07);
  });

  it("never yields a negative lobe and stays energy-bounded (scale + bias <= 1.05)", () => {
    for (const r of roughnesses) {
      for (const nv of cosines) {
        const [s, b] = envBrdfApprox(r, nv);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(s + b).toBeLessThanOrEqual(1.05);
      }
    }
  });
});
