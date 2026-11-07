import { describe, expect, it } from "vitest";
import {
  cookTorranceSpecular,
  dot3,
  lambertDiffuse,
  makeLcg,
  normalize3,
} from "./_refBrdf.js";

// Radiometric axiom: Helmholtz reciprocity -- the BRDF is unchanged by swapping incident light
// and viewing direction (f(L, V) = f(V, L)). The engine's Cook-Torrance terms are symmetric by
// construction (D uses dotNH, G is a symmetric product of per-axis terms, F uses dotVH), so this
// contract pins that property numerically and asserts positivity over a dense deterministic sweep,
// including grazing angles and both dielectric and metallic energy behaviour.

const EPS = 1e-12;

/** Random unit direction within the upper hemisphere around +Z (deterministic). */
function randomHemisphereDir(rng: () => number): [number, number, number] {
  const z = rng(); // cos(theta) in [0,1] -> uniform solid angle tilt
  const phi = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0.0, 1.0 - z * z));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

const N: [number, number, number] = [0, 0, 1];
const F0_DIELECTRIC = 0.04;
const F0_METAL = 1.0;
const ALBEDO = 1.0;

function brdfFull(
  light: readonly [number, number, number],
  view: readonly [number, number, number],
  roughness: number,
  f0: number,
  metallic: number,
): number {
  const dotNL = dot3(N, light);
  const dotNV = dot3(N, view);
  const h = normalize3([light[0] + view[0], light[1] + view[1], light[2] + view[2]]);
  const dotNH = Math.max(dot3(N, h), 0.0);
  const dotVH = Math.max(dot3(view, h), 0.0);
  const spec = cookTorranceSpecular(dotNL, dotNV, dotNH, dotVH, roughness, f0);
  const diff = lambertDiffuse(dotVH, ALBEDO, f0, metallic);
  return spec + diff;
}

describe("HelmholtzReciprocity contract", () => {
  for (const roughness of [0.1, 0.35, 0.7]) {
    for (const [f0, metallic] of [
      [F0_DIELECTRIC, 0] as const,
      [F0_METAL, 1] as const,
    ]) {
      it(`f(L,V) == f(V,L) within 1e-12 (roughness ${roughness}, f0 ${f0})`, () => {
        const rng = makeLcg((roughness * 1000 + f0 * 1000) | 0);
        for (let i = 0; i < 2000; i++) {
          const l = randomHemisphereDir(rng);
          const v = randomHemisphereDir(rng);
          const fwd = brdfFull(l, v, roughness, f0, metallic);
          const rev = brdfFull(v, l, roughness, f0, metallic);
          expect(Math.abs(fwd - rev)).toBeLessThanOrEqual(EPS);
        }
      });
    }
  }

  it("stays reciprocal at grazing view angles where the guard clauses engage", () => {
    const rng = makeLcg(424242);
    // Grazing directions computed from exact sin/cos so they are unit-length (reciprocity on the
    // engine formulas requires |L| = |V| = 1; a 1e-4 length error breaks the 1e-12 equality).
    const grazing: [number, number, number][] = [
      [0, 0, 1],
      [Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)],
      [Math.sin(Math.PI / 3), 0.0, Math.cos(Math.PI / 3)],
      [Math.sin(1.4) * Math.cos(0.4), Math.sin(1.4) * Math.sin(0.4), Math.cos(1.4)],
      [Math.sin(1.48) * Math.cos(0.1), Math.sin(1.48) * Math.sin(0.1), Math.cos(1.48)],
      [Math.sin(Math.PI / 2) * Math.cos(0.2), Math.sin(Math.PI / 2) * Math.sin(0.2), 0],
    ];
    for (let i = 0; i < 500; i++) {
      const l = randomHemisphereDir(rng);
      for (const v of grazing) {
        const fwd = brdfFull(l, v, 0.25, F0_DIELECTRIC, 0);
        const rev = brdfFull(v, l, 0.25, F0_DIELECTRIC, 0);
        expect(Math.abs(fwd - rev)).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it("is never negative over the swept directions (positivity axiom)", () => {
    const rng = makeLcg(7);
    for (let i = 0; i < 2000; i++) {
      const l = randomHemisphereDir(rng);
      const v = randomHemisphereDir(rng);
      expect(brdfFull(l, v, 0.5, F0_DIELECTRIC, 0)).toBeGreaterThanOrEqual(0);
      expect(brdfFull(l, v, 0.5, F0_METAL, 1)).toBeGreaterThanOrEqual(0);
    }
  });
});
