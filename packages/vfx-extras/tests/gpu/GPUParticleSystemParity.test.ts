/**
 * C2 (T8) — GPUParticleSystem verification (GPU compute lane), Charlie's skeleton upgraded by Bob
 * (T7) once `packages/vfx-extras/src/gpu/GPUParticleSystem.ts` landed. Host-side parity rows are
 * REAL tests below (deterministic, no GPU runtime needed); the rows that genuinely need a WebGPU
 * runtime (actual f32 GPU simulation on `navigator.gpu`) stay `it.todo`-gated for browser runs.
 *
 *   @invariant S34-GPU-CPU-PARITY: GPU simulation output within documented tolerance of the CPU
 *     SoA reference (seeded golden; position/life/velocity per-tolerance).
 *   @invariant S34-POOL-PARTITION: alive+dead == capacity at all times, slots in [0,capacity),
 *     storage buffers never overrun (bounded CAS pop / reap) regardless of emitCount.
 *   @invariant S34-SCREEN-COLLISION-TAPS: csSimulate performs exactly 2 texel loads per colliding
 *     particle — 1 depth tap + conditional ADR 0028 normal tap; no extra VRAM allocation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  s34GpuSpawnOracle,
  s34Hash11,
  type GpuSpawnOracleParams,
} from "../../src/gpu/GPUParticleSystem.js";

/**
 * Parity golden for `@invariant S34-GPU-CPU-PARITY` (host-side, deterministic).
 *
 * What is verified here WITHOUT a GPU runtime:
 *   1. The exported CPU twin `s34GpuSpawnOracle` reproduces an INDEPENDENTLY computed reference
 *      vector bit-for-bit (burned in below; produced by a structurally different, throwaway
 *      hand-rolled script with the same published constants `0x45d9f3b` / `0x9e3779b9` /
 *      `6.283185307179586`). This is the CPU SoA reference of the seeded golden.
 *   2. The actual `gpu_particles.wgsl` / `gpu_particles_draw.wgsl` source is pinned to that
 *      recipe: the invariant tags, the exact hash/spawn constants, the `@group(1)` binding
 *      window 21..30, the indirect-args layout and the alive-list draw mapping must appear
 *      verbatim -- any silent drift in the shader that runs on the GPU fails here.
 *   3. A 20 000-lane seeded sample stays inside every documented budget (spawn box, radius,
 *      speed, life, tint envelope) and its mean converges to the analytic box center within the
 *      metric tolerance -- the same distributional bound the C2 browser-gated GPU run must meet.
 *
 * Honest scope: WebGPU execution itself (f32 rounding, runtime counters) is compile-verified
 * here, runtime-pending in a browser; this suite pins every value the GPU shader can only read
 * from source.
 */

const WEBGPU_AVAILABLE = typeof navigator !== "undefined" && "gpu" in navigator;

const COMPUTE_WGSL = readFileSync(
  new URL(
    "../../../engine/src/renderers/shaders/source/web_gpu/particles/gpu_particles.wgsl",
    import.meta.url,
  ),
  "utf8",
);
const DRAW_WGSL = readFileSync(
  new URL(
    "../../../engine/src/renderers/shaders/source/web_gpu/particles/gpu_particles_draw.wgsl",
    import.meta.url,
  ),
  "utf8",
);

/** Fixed invocation contract of the golden below -- EXACT domain of every burn-in value. */
const GOLDEN: GpuSpawnOracleParams = {
  seed: 0x5eed,
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
  speedFactor: 3,
  alphaMul: 0.5,
  baseColorR: 1,
  baseColorG: 0.5,
  baseColorB: 0.25,
  baseColorA: 1,
};

/**
 * Independently computed reference vector (throwaway script, structurally different code) for
 * seed 0x5eed. These doubles ARE the CPU SoA reference of the seeded golden.
 */
const REFERENCE: ReadonlyArray<{
  readonly lane: number;
  readonly p0: number;
  readonly p1: number;
  readonly p2: number;
  readonly r: number;
  readonly v0: number;
  readonly v1: number;
  readonly v2: number;
  readonly life: number;
  readonly c0: number;
  readonly c1: number;
  readonly c2: number;
  readonly c3: number;
}> = [
  {
    lane: 0,
    p0: -1.9870858192443848,
    p1: -0.9029759168624878,
    p2: 2.8334290981292725,
    r: 0.09534999430179597,
    v0: 0.3064016804372461,
    v1: -2.9693384170532227,
    v2: 0.2985755770941315,
    life: 1.8277302384376526,
    c0: 0.5521711349487305,
    c1: 0.27608556747436525,
    c2: 0.13804278373718262,
    c3: 1,
  },
  {
    lane: 1,
    p0: 1.944838285446167,
    p1: 0.6367009878158569,
    p2: 1.7034339904785156,
    r: 0.07228949666023254,
    v0: -2.493955919527503,
    v1: -1.6646418571472168,
    v2: -0.09566273510197967,
    life: 3.9464852809906006,
    c0: 0.5783818006515503,
    c1: 0.28919090032577516,
    c2: 0.14459545016288758,
    c3: 1,
  },
  {
    lane: 7,
    p0: -1.8762073516845703,
    p1: -0.20435750484466553,
    p2: 2.757936716079712,
    r: 0.05440202355384827,
    v0: -1.2130746626323967,
    v1: -2.6539864540100098,
    v2: -0.6962799471553602,
    life: 1.7109663486480713,
    c0: 0.5681181073188782,
    c1: 0.2840590536594391,
    c2: 0.14202952682971956,
    c3: 1,
  },
];

describe("C2 GPUParticleSystem (Bob B1/B2 — S34-GPU-CPU-PARITY / S34-POOL-PARTITION / S34-SCREEN-COLLISION-TAPS)", () => {
  it("CPU oracle reproduces the independent reference golden bit-for-bit", () => {
    for (const ref of REFERENCE) {
      const s = s34GpuSpawnOracle(GOLDEN.seed, ref.lane, GOLDEN);
      expect(s.posX, `lane ${ref.lane} posX`).toBe(ref.p0);
      expect(s.posY, `lane ${ref.lane} posY`).toBe(ref.p1);
      expect(s.posZ, `lane ${ref.lane} posZ`).toBe(ref.p2);
      expect(s.radius, `lane ${ref.lane} radius`).toBe(ref.r);
      expect(s.velX, `lane ${ref.lane} velX`).toBe(ref.v0);
      expect(s.velY, `lane ${ref.lane} velY`).toBe(ref.v1);
      expect(s.velZ, `lane ${ref.lane} velZ`).toBe(ref.v2);
      expect(s.life, `lane ${ref.lane} life`).toBe(ref.life);
      expect(s.colorR, `lane ${ref.lane} colorR`).toBe(ref.c0);
      expect(s.colorG, `lane ${ref.lane} colorG`).toBe(ref.c1);
      expect(s.colorB, `lane ${ref.lane} colorB`).toBe(ref.c2);
      expect(s.colorA, `lane ${ref.lane} colorA`).toBe(ref.c3);
    }
  });

  it("oracle lane hash matches the reference for the golden lanes", () => {
    expect(s34Hash11((0x5eed ^ Math.imul(0, 0x9e3779b9)) >>> 0)).toBe(542300235);
    expect(s34Hash11((0x5eed ^ Math.imul(1, 0x9e3779b9)) >>> 0)).toBe(997956525);
    expect(s34Hash11((0x5eed ^ Math.imul(7, 0x9e3779b9)) >>> 0)).toBe(4190154322);
  });

  it("gpu_particles.wgsl is pinned to the oracle recipe (invariants, constants, bindings)", () => {
    expect(COMPUTE_WGSL).toContain("S34-POOL-PARTITION");
    expect(COMPUTE_WGSL).toContain("S34-SCREEN-COLLISION-TAPS");
    expect(COMPUTE_WGSL).toContain("0x45d9f3bu");
    expect(COMPUTE_WGSL).toContain("0x9E3779B9u");
    expect(COMPUTE_WGSL).toContain("6.283185307179586");
    expect(COMPUTE_WGSL).toContain("fn csEmit");
    expect(COMPUTE_WGSL).toContain("fn csSimulate");
    expect(COMPUTE_WGSL).toContain("fn csPrepareIndirect");
    expect(COMPUTE_WGSL).toContain("ALIVE-INDEX PING-PONG IS HOST-SIDE");
    for (let b = 21; b <= 30; b++) {
      expect(COMPUTE_WGSL, `missing @group(1) @binding(${b})`).toContain(
        `@group(1) @binding(${b})`,
      );
    }
    expect(COMPUTE_WGSL).toContain("drawIndexCount");
    expect(COMPUTE_WGSL).toContain("drawInstanceCount");
    expect(COMPUTE_WGSL).toContain("drawFirstIndex");
    expect(COMPUTE_WGSL).toContain("drawBaseVertex");
    expect(COMPUTE_WGSL).toContain("drawBaseInstance");
    expect(COMPUTE_WGSL).toContain("simulateCount");
    expect(COMPUTE_WGSL).toContain("numDead");
    expect(COMPUTE_WGSL).toContain("appendCursor");
  });

  it("gpu_particles_draw.wgsl maps instance -> alive slot (no direct-slot indexing)", () => {
    expect(DRAW_WGSL).toContain("@group(1) @binding(23) var<storage, read> aliveIndices");
    expect(DRAW_WGSL).toContain("aliveIndices[in.instanceIndex]");
    expect(DRAW_WGSL).toContain("global.projScale");
    expect(DRAW_WGSL).toContain("clipOffset = corner * data.w * global.projScale");
  });

  it("seeded distribution obeys every spawn budget and converges to the box center", () => {
    const N = 20000;
    let meanX = 0;
    let meanY = 0;
    let meanZ = 0;
    // Plain comparisons per lane, ONE assertion at the end: 20k lanes x ~20 `expect` calls cost
    // >5 s on a contended CI runner; the bounds checked are identical, failures name lane + field.
    const violations: string[] = [];
    const within = (lane: number, field: string, v: number, lo: number, hi: number): void => {
      if (!(v >= lo && v <= hi) && violations.length < 20) {
        violations.push(`lane ${lane}: ${field}=${v} outside [${lo}, ${hi}]`);
      }
    };
    const tintLo = 0.8 * GOLDEN.alphaMul;
    const tintHi = 1.2 * GOLDEN.alphaMul;
    for (let lane = 0; lane < N; lane++) {
      const s = s34GpuSpawnOracle(GOLDEN.seed, lane, GOLDEN);
      within(lane, "posX", s.posX, GOLDEN.spawnMinX, GOLDEN.spawnMaxX);
      within(lane, "posY", s.posY, GOLDEN.spawnMinY, GOLDEN.spawnMaxY);
      within(lane, "posZ", s.posZ, GOLDEN.spawnMinZ, GOLDEN.spawnMaxZ);
      within(lane, "radius", s.radius, GOLDEN.minSize, GOLDEN.maxSize);
      within(lane, "life", s.life, GOLDEN.minLife, GOLDEN.maxLife);
      const speed = Math.sqrt(s.velX * s.velX + s.velY * s.velY + s.velZ * s.velZ);
      within(lane, "speed", speed, 0, GOLDEN.speedFactor * (1 + 1e-9));
      within(lane, "colorA", s.colorA, 1, 1);
      // tint in [0.8, 1.2] => color lanes in [0.8, 1.2] * alphaMul * baseColor (per lane).
      within(
        lane,
        "colorR",
        s.colorR,
        tintLo * GOLDEN.baseColorR - 1e-9,
        tintHi * GOLDEN.baseColorR + 1e-9,
      );
      within(
        lane,
        "colorG",
        s.colorG,
        tintLo * GOLDEN.baseColorG - 1e-9,
        tintHi * GOLDEN.baseColorG + 1e-9,
      );
      within(
        lane,
        "colorB",
        s.colorB,
        tintLo * GOLDEN.baseColorB - 1e-9,
        tintHi * GOLDEN.baseColorB + 1e-9,
      );
      meanX += s.posX;
      meanY += s.posY;
      meanZ += s.posZ;
    }
    expect(violations).toEqual([]);
    meanX /= N;
    meanY /= N;
    meanZ /= N;
    // Metric tolerance (documented): the seed-pinned sample mean must stay within 2.5% of the
    // box half-extents while its deterministic value sits ~3 orders below that (uniform-lattice
    // hashing). This is the tolerance bound the C2 browser run mirrors for GPU f32 output.
    expect(Math.abs(meanX)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(meanY)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(meanZ - 2)).toBeLessThanOrEqual(0.1);
  });

  if (!WEBGPU_AVAILABLE) {
    it.todo("navigator.gpu unavailable — actual GPU sim parity/pool/taps rows stay browser-gated");
  } else {
    it.todo("S34-GPU-CPU-PARITY: real GPU output vs CPU reference over seeded frames (browser)");
    it.todo(
      "S34-POOL-PARTITION: alive+dead == capacity under churn incl. emitCount >> capacity (browser)",
    );
    it.todo(
      "S34-SCREEN-COLLISION-TAPS: exactly 1 depth + conditional 1 normal tap per collision (browser)",
    );
  }
});
