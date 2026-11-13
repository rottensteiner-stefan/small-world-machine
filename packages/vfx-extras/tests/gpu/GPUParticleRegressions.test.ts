/**
 * Regression pins for the S34 GPU particle review (P0). No WebGPU runtime in vitest, so the
 * shader rows pin the exact source semantics and the host rows exercise the real CPU twins.
 *
 *   @invariant S34-POOL-PARTITION: slots handed to alive/dead lists are `atomicAdd` OLD values --
 *     never `old - 1u` (that dropped the first entry at 0xFFFFFFFF and left the top one stale).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  s34FrameSeed,
  s34GpuSpawnOracle,
  type GpuSpawnOracleParams,
} from "../../src/gpu/GPUParticleSystem.js";

const DIR = "../../../engine/src/renderers/shaders/source/web_gpu/particles/";
const COMPUTE = readFileSync(new URL(`${DIR}gpu_particles.wgsl`, import.meta.url), "utf8");
const DRAW = readFileSync(new URL(`${DIR}gpu_particles_draw.wgsl`, import.meta.url), "utf8");

/** Strips `//` comments so prose can never satisfy or break a source pin. */
function code(src: string): string {
  return src.replace(/\/\/.*$/gm, "");
}

const SPAWN: GpuSpawnOracleParams = {
  seed: 1,
  spawnMinX: -2,
  spawnMinY: -1,
  spawnMinZ: 0,
  spawnMaxX: 2,
  spawnMaxY: 1,
  spawnMaxZ: 4,
  minSize: 0.05,
  maxSize: 0.2,
  minLife: 1,
  maxLife: 4,
  speedFactor: 1,
  alphaMul: 1,
  baseColorR: 1,
  baseColorG: 1,
  baseColorB: 1,
  baseColorA: 1,
};

describe("gpu_particles.wgsl pool counters (S34-POOL-PARTITION)", () => {
  const src = code(COMPUTE);

  it("uses the atomicAdd result directly as the slot (append x2, dead push x1)", () => {
    const adds = src.match(/atomicAdd\([^;]*;/g) ?? [];
    expect(adds).toHaveLength(3);
    for (const stmt of adds) {
      expect(stmt, stmt).toMatch(/^atomicAdd\(&counters\.(appendCursor|numDead), 1u\);$/);
      expect(stmt).not.toMatch(/-\s*1u/);
    }
    expect(src.match(/let slot = atomicAdd\(&counters\.appendCursor, 1u\);/g)).toHaveLength(2);
    expect(src.match(/let slot = atomicAdd\(&counters\.numDead, 1u\);/g)).toHaveLength(1);
  });

  it("keeps `cur - 1u` ONLY in the pop (count -> top index), where it is correct", () => {
    expect(src.match(/cur - 1u/g)).toHaveLength(2); // CAS new value + slot of the pop
  });
});

describe("gpu_particles_draw.wgsl perspective", () => {
  const src = code(DRAW);

  it("offsets in clip space WITHOUT multiplying by clip.w (NDC offset = r*P / w)", () => {
    expect(src).toContain("clipOffset = corner * data.w * global.projScale");
    expect(src).toContain("vec4f(clip.xy + clipOffset, clip.z, clip.w)");
    expect(src).not.toMatch(/\*\s*clip\.w/);
  });

  it("host replica of the vertex math shrinks the quad with depth", () => {
    const projScale = 1.5;
    const r = 0.5;
    const ndcHalfWidth = (w: number): number => {
      const clipX = 0; // particle on the view axis
      const clipOffset = r * projScale; // shader: corner(=1) * radius * projScale
      return (clipX + clipOffset) / w;
    };
    expect(ndcHalfWidth(10)).toBeCloseTo(ndcHalfWidth(5) / 2, 12);
    expect(ndcHalfWidth(20)).toBeLessThan(ndcHalfWidth(10));
  });
});

describe("emit seed is time-dependent", () => {
  it("csEmit mixes the f32 bits of params.u1.y into the seed", () => {
    expect(code(COMPUTE)).toContain(
      "hash11((params.u0.w ^ bitcast<u32>(params.u1.y)) ^ (lane * 0x9E3779B9u))",
    );
  });

  it("s34FrameSeed: same time -> same seed, different time -> different spawn", () => {
    expect(s34FrameSeed(1, 0)).toBe(1); // t=0 bits are 0 -> seed unchanged
    expect(s34FrameSeed(7, 0.016)).toBe(s34FrameSeed(7, 0.016));
    const a = s34GpuSpawnOracle(s34FrameSeed(1, 0.016), 0, SPAWN);
    const b = s34GpuSpawnOracle(s34FrameSeed(1, 0.032), 0, SPAWN);
    expect(a.posX).not.toBe(b.posX);
    expect(a.life).not.toBe(b.life);
  });

  it("emit(1) per frame no longer repeats the same particle across 100 frames", () => {
    const seen = new Set<number>();
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 1 / 60;
      seen.add(s34GpuSpawnOracle(s34FrameSeed(1, Math.fround(t)), 0, SPAWN).posX);
    }
    expect(seen.size).toBe(100);
  });
});

it("gpu_particles.wgsl never uses a named member on the vec4u `u0`/vec4f `u1` lanes", () => {
  const bad = code(COMPUTE).match(/params\.u[01]\.(?![xyzw]\b)\w+/g);
  expect(bad).toBeNull();
});
