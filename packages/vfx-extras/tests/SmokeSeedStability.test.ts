import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { FireSmokeEmitter } from "../src/fire/FireSmokeEmitter.js";
import type { SmokeSpriteMaterial } from "../src/fire/SmokeSpriteMaterial.js";

const ORIGIN = new Vector3D(0, 0, 0);
const CAMERA = new Vector3D(2, 1.6, 5);

const shaderSources: Record<string, string> = {
  glsl: readFileSync(new URL("../src/fire/Smoke.frag.glsl", import.meta.url), "utf8"),
  glsl100: readFileSync(new URL("../src/fire/Smoke.frag.glsl100", import.meta.url), "utf8"),
  wgsl: readFileSync(new URL("../src/fire/Smoke.frag.wgsl", import.meta.url), "utf8"),
};

/** Strips line comments so pins only see executable shader code. */
function code(src: string): string {
  return src.replace(/\/\/.*$/gm, "");
}

describe("smoke per-particle noise seed is lifetime-stable", () => {
  for (const [variant, src] of Object.entries(shaderSources)) {
    it(`${variant}: seed is not derived from the animated tint channels`, () => {
      const c = code(src);
      const offsetLine = c.split("\n").find((l) => /\boffset\s*=/.test(l));
      expect(offsetLine).toBeDefined();
      expect(offsetLine).toMatch(/inst\.r/);
      expect(offsetLine).not.toMatch(/inst\.[gb]/);
      expect(offsetLine).not.toMatch(/floor/);
      // The animated tint lives in the fragment as a rebuild from alpha, never from instance rgb.
      expect(c).not.toMatch(/inst\.rgb/);
    });
  }

  it("emitter keeps a constant per-particle seed in rgb over the whole lifetime and varies it across puffs", () => {
    const emitter = new FireSmokeEmitter({ seed: 3, rate: 20, capacity: 64, lifeRange: [2, 2] });
    const arrays = emitter.system.arrays;
    const seedAtFirstSight = new Map<number, number>();
    const alphaAtFirstSight = new Map<number, number>();
    for (let f = 0; f < 150; f++) {
      emitter.update(1 / 60, ORIGIN, CAMERA);
      for (let i = 0; i < arrays.aliveFlags.length; i++) {
        if (arrays.aliveFlags[i] !== 1) continue;
        const key = i * 100000 + Math.round(arrays.maxLives[i]! * 1e4); // slot reuse => new puff
        const seed = arrays.colors[i * 4]!;
        if (!seedAtFirstSight.has(key) && arrays.lives[i]! < 0.05) {
          seedAtFirstSight.set(key, seed);
          alphaAtFirstSight.set(key, arrays.alphas[i]!);
        } else if (seedAtFirstSight.has(key)) {
          expect(seed).toBe(seedAtFirstSight.get(key));
          // alpha (opacity ramp) still ages: the seed does not ride on it.
          expect(arrays.alphas[i]!).toBeLessThanOrEqual(alphaAtFirstSight.get(key)! + 1e-6);
        }
      }
    }
    expect(seedAtFirstSight.size).toBeGreaterThan(5);
    expect(new Set(seedAtFirstSight.values()).size).toBe(seedAtFirstSight.size);
  });

  it("emitter forwards its tint ramp endpoints to the default material", () => {
    const emitter = new FireSmokeEmitter({});
    const mat = emitter.mesh.material as SmokeSpriteMaterial;
    const props = mat.getRenderManifest().properties;
    expect(props["u_matParam4"]).toEqual([
      expect.closeTo(0.62, 5),
      expect.closeTo(0.58, 5),
      expect.closeTo(0.55, 5),
      expect.closeTo(0.36, 5),
    ]);
    expect((props["u_matParam6"] as number[])[3]).toBe(0);
  });
});
