/**
 * Shipped WGSL shader-source contracts for `GPUParticleSystem` (S34-POOL-PARTITION, ADR 0049).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const DIR = "../../../engine/src/renderers/shaders/source/web_gpu/particles/";
const COMPUTE = readFileSync(new URL(`${DIR}gpu_particles.wgsl`, import.meta.url), "utf8");
const DRAW = readFileSync(new URL(`${DIR}gpu_particles_draw.wgsl`, import.meta.url), "utf8");
const code = (src: string): string => src.replace(/\/\/.*$/gm, "");

describe("csSimulate returns life <= 0 slots to the dead list (S34-POOL-PARTITION)", () => {
  const src = code(COMPUTE);
  const sim = src.slice(src.indexOf("fn csSimulate"), src.indexOf("fn csPrepareIndirect"));

  it("has no early return on `life <= 0.0` (slot would leave both lists)", () => {
    expect(sim).not.toMatch(/if \(life <= 0\.0\) \{\s*return;/);
  });

  it("routes a non-positive life through the single dead push", () => {
    expect(sim).toContain("var newLife = life;");
    expect(sim).toMatch(/if \(life > 0\.0\) \{[\s\S]*newLife = life - params\.u1\.x;/);
    expect(sim).toMatch(/if \(newLife > 0\.0\) \{[\s\S]*\} else \{[\s\S]*counters\.numDead/);
  });

  it("CPU oracle of the branch: every slot ends in exactly one of alive/dead", () => {
    const step = (life: number, dt: number): "alive" | "dead" => {
      let nl = life;
      if (life > 0) nl = life - dt;
      return nl > 0 ? "alive" : "dead";
    };
    expect(step(-0.5, 0.016)).toBe("dead");
    expect(step(0, 0.016)).toBe("dead");
    expect(step(1, 0.016)).toBe("alive");
    expect(step(1, 0)).toBe("alive");
  });
});

describe("fsParticle colour space (ADR 0049)", () => {
  it("converts the sRGB authoring tint with displayToTarget before premultiplying", () => {
    expect(code(DRAW)).toContain("displayToTarget(in.color.rgb) * in.color.a");
  });
});
