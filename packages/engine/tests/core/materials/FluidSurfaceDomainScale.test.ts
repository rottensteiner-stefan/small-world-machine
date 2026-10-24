import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FluidSurfaceMaterial } from "../../../src/core/materials/liquid/FluidSurfaceMaterial.js";
import { LavaMaterial } from "../../../src/core/materials/liquid/LavaMaterial.js";

const SRC_DIR = join(__dirname, "../../../src");
const FRAG_DIR = join(SRC_DIR, "core/materials/liquid/shaders");

// ── P3/S1 R4 + E4-B: FluidSurface packed hardcoded *meter/frequency* and raw look literals into
// its shader (worldUV `* 0.5`, depth-fade `/ 1.0` softness, rim exponent `3.0`, alpha floor
// `0.25`). R4 moves them into an owned `u_matParam5` lane (value-preserving defaults). E4-B adds
// the `domainScale` option (default 1.0) which pre-scales the world-anchored lane values inside
// getRenderManifest -- the Tier-2 transfer point. Convention (binding, tested here): length
// semantics DIVIDE by domainScale, per-meter frequency semantics MULTIPLY by domainScale; at
// domainScale 1.0 every lane is byte-identical to the pre-R4 defaults (x*1.0 / x/1.0 identities).
// The dimensionless raw look scalars (alpha floor 0.25, rim exponent 3.0) stay fixed. The noise
// mask thresholds (smoothstep 0.0/0.6/0.7, hot 0.5) are noise-field band edges, scale-invariant
// by definition, and were deliberately NOT in the ratified R4 literal list -- left as literals.

const BASE_P5 = [0.5, 1.0, 0.25, 3.0] as const;

describe("E4-B: FluidSurfaceMaterial domainScale pre-scaling in getRenderManifest", () => {
  const baseWaveFreq = 3.0 / (1.0 + 5.0 * 0.1); // viscosity 5 (default) → 2.0
  const baseWaveAmp = 0.03 + 5.0 * 0.006; // 0.06

  it("is a numeric identity at the default domainScale = 1.0 (value-preserving)", () => {
    const mat = new FluidSurfaceMaterial();
    const props = mat.getRenderManifest().properties as Record<string, number[]>;
    expect(props["u_matParam5"] as number[]).toEqual([0.5, 1.0, 0.25, 3.0]);
    // Wave lanes keep the exact pre-E4-B bytes at the default.
    expect(props["u_matParam4"] as number[]).toEqual([baseWaveFreq, baseWaveAmp, 0, 0]);
  });

  describe("scale-invariance across the domain range", () => {
    for (const ds of [0.5, 2.0, 10.0]) {
      it(`domainScale = ${ds} scales world-anchored lanes (÷ length, × frequency)`, () => {
        const mat = new FluidSurfaceMaterial();
        mat.domainScale = ds;
        const props = mat.getRenderManifest().properties as Record<string, number[]>;
        const p5 = props["u_matParam5"] as number[];
        // world-XZ noise frequency: × domainScale
        expect(p5[0]).toBeCloseTo(BASE_P5[0] * ds, 8);
        // depth-fade edge softness (meters): ÷ domainScale
        expect(p5[1]).toBeCloseTo(BASE_P5[1] / ds, 8);
        // raw dimensionless look scalars stay fixed
        expect(p5[2]).toBe(BASE_P5[2]);
        expect(p5[3]).toBe(BASE_P5[3]);
        // vertex wave lanes: world frequency ×, world-meter amplitude ÷
        const p4 = props["u_matParam4"] as number[];
        expect(p4[0]).toBeCloseTo(baseWaveFreq * ds, 8);
        expect(p4[1]).toBeCloseTo(baseWaveAmp / ds, 8);
      });
    }
  });

  it("forwards domainScale through the Lava preset (rest-passing)", () => {
    const lava = new LavaMaterial({ domainScale: 4.0 });
    expect(lava.domainScale).toBe(4.0);
    const p5 = lava.getRenderManifest().properties["u_matParam5"] as number[];
    expect(p5[0]).toBeCloseTo(0.5 * 4.0, 8);
    expect(p5[1]).toBeCloseTo(1.0 / 4.0, 8);
  });
});

describe("R4: FluidSurface shader tiers read the literals from the owned u_matParam5 lane", () => {
  it("fragment tiers keep a default-parity read (no resurrected hardcoded literals)", () => {
    const cases = [
      {
        file: join(FRAG_DIR, "FluidSurface.frag.wgsl"),
        reads: [/obj\.matParam5\.x/, /obj\.matParam5\.y/, /obj\.matParam5\.z/, /obj\.matParam5\.w/],
        forbidden: [
          /wp\.xz \* 0\.5/,
          /depthDiff \/ 1\.0/,
          /pow\(1\.0 - ndv, 3\.0\)/,
          /clamp\(thickness \+ rim, 0\.25/,
        ],
      },
      {
        file: join(FRAG_DIR, "FluidSurface.frag.glsl"),
        reads: [/u_matParam5\.x/, /u_matParam5\.y/, /u_matParam5\.z/, /u_matParam5\.w/],
        forbidden: [
          /v_worldPos\.xz \* 0\.5/,
          /depthDiff \/ 1\.0/,
          /pow\(1\.0 - ndv, 3\.0\)/,
          /clamp\(thickness \+ rim, 0\.25/,
        ],
      },
      {
        // WebGL1 has no depth capture: only the worldUV frequency (x) and rim exponent (w) exist here.
        file: join(FRAG_DIR, "FluidSurface.frag.glsl100"),
        reads: [/u_matParam5\.x/, /u_matParam5\.w/],
        forbidden: [/v_worldPos\.xz \* 0\.5/, /pow\(1\.0 - ndv, 3\.0\)/],
      },
    ];
    for (const c of cases) {
      const source = readFileSync(c.file, "utf8");
      for (const re of c.reads) expect(source, c.file).toMatch(re);
      for (const re of c.forbidden) expect(source, c.file).not.toMatch(re);
    }
  });

  it("documents the domainScale convention in the material source", () => {
    const src = readFileSync(
      join(SRC_DIR, "core/materials/liquid/FluidSurfaceMaterial.ts"),
      "utf8",
    );
    expect(src).toMatch(/domainScale/);
    expect(src).toMatch(/DIVIDE|divide|MULTIPLY|multiply|frequency|metr/i);
  });
});
