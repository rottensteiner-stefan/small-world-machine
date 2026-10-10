// S1 (Wellen-Sonde <-> Auftriebswahrheit): golden-vector regression + G2 constants-equality
// manifest for the OpenWaterSurfaceProbe -- the CPU "same-field" mirror of the GPU Gerstner
// surface.
//
// Sources of truth, audited op-for-op (see OpenWaterSurfaceProbe.ts):
//   - packages/engine/src/core/materials/liquid/shaders/OpenWater.vert.glsl lines 85-107
//   - packages/engine/src/core/materials/shaders/chunks/liquid_gerstner_wave.glsl
//     (the WGSL chunk liquid_gerstner_wave.wgsl is byte-equivalent in behavior: plain
//     normalize, same constants, same left-assoc `w * speed * time`)
//
// Tolerance policy -- NO hand-picked tolerance and NO single global bound. The asserted delta
// bound is derived per sample (see perVectorBound): per wave the absolute error is about
//   amplitude * MAX_CHAIN_OPS * F32_EPS * (1 + |k*dot| + |w*speed*time|),
// summed over the six waves and multiplied by SAFETY_FACTOR. The phase is a difference of two
// products, so its error scales with their magnitudes; a realistic small-phase sample gets a
// micro-metre bound, a huge-phase outlier a large one. (An earlier version used one worst-case
// value for every vector, several metres, ten times the real wave height -- it could not see any
// moderate mirror error. The "catch a realistic mirror error" test below guards against that.)
//   MAX_CHAIN_OPS = 29 is derived from the shader: the longest dependency chain from raw
//   material fields to the final height is 3 ops (w6 cross-swell derivation) + 20 ops (deepest
//   single wave incl. normalize, k, sqrt(9.81*k), phase -> sin -> a*sinf) + 6 chained accumulator
//   adds (5 sum adds + 1 rest offset). SAFETY_FACTOR = 2.0 is a documented margin, not a fit.
// The precision ladder (fixed lane sets x x/z/time/speed grids, worst cases included) is both
// checked against the per-vector bound and re-measured against COMMITTED_WORST_DELTA, a
// behavior canary: any mirror drift changes the measured worst delta and fails.
//
// The independent golden below is a hand-written f64 mirror of the same shader: separate code
// path, identical op order, no Math.fround. The probe's f64 mode is the same pure math in the
// same order, so it must equal the golden BIT-FOR-BIT for every committed vector. That bitwise
// identity pins every constant of the manifest (PI_2 = 6.28318530718, gravity 9.81, clamps
// 0.001, w4/w5/w6 weights 0.45/0.42/0.35/0.35/0.25/0.22, rotations 0.5/0.866): fixture "E"
// drives w*speed*time into the thousands, so ANY drift in those constants changes the phase and
// breaks the bitwise equality. Constants are additionally cross-checked by known-answer tests
// (w1-only, see below).

import { describe, it, expect } from "vitest";
import { OpenWaterMaterial } from "../../../src/core/materials/liquid/OpenWaterMaterial.js";
import { OpenWaterSurfaceProbe } from "../../../src/core/materials/liquid/OpenWaterSurfaceProbe.js";

type WaveLane = readonly [number, number, number, number];
interface WaveLaneSet {
  wave1: WaveLane;
  wave2: WaveLane;
  wave3: WaveLane;
}

const F32_EPS = 1.1920928955078125e-7; // 2^-23, rel. error of one correctly-rounded f32 op
const MAX_CHAIN_OPS = 29; // longest op chain raw fields -> final height (see header)
const SAFETY_FACTOR = 2.0;
// Measured max |f32 probe - f64 golden| over the ladder MONIKER below (re-measured in-test).
const COMMITTED_WORST_DELTA = 3.6415662818872363;

// ------------------------------------------------------------------------------------------- //
// Independent golden reference: the same pure f64 math as the shader, written out here so it
// shares no code with the probe. Op order and constants mirror OpenWater.vert.glsl + chunk.
// ------------------------------------------------------------------------------------------- //
function waveHeightF64(wave: WaveLane, speed: number, x: number, z: number, time: number): number {
  const dirX = wave[0];
  const dirY = wave[1];
  const steepness = wave[2];
  const wavelength = Math.max(wave[3], 0.001);
  const k = 6.28318530718 / wavelength;
  const w = Math.sqrt(9.81 * k);
  const a = steepness / Math.max(k, 0.001);
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  const nx = dirX / len;
  const ny = dirY / len;
  const dot = nx * x + ny * z;
  const kDot = k * dot;
  const wSpeed = w * speed;
  const phaseTerm = wSpeed * time;
  const phase = kDot - phaseTerm;
  const sinf = Math.sin(phase);
  return a * sinf;
}

function surfaceHeightF64(
  lanes: WaveLaneSet,
  speed: number,
  x: number,
  z: number,
  time: number,
): number {
  const { wave1, wave2, wave3 } = lanes;
  const w4: WaveLane = [wave1[1], -wave1[0], wave1[2] * 0.45, wave1[3] * 0.42];
  const w5: WaveLane = [-wave2[1], wave2[0], wave2[2] * 0.35, wave2[3] * 0.35];
  const w6: WaveLane = [
    wave1[0] * 0.5 - wave1[1] * 0.866,
    wave1[0] * 0.866 + wave1[1] * 0.5,
    wave1[2] * 0.25,
    wave1[3] * 0.22,
  ];
  let sum = 0;
  for (const w of [wave1, wave2, wave3, w4, w5, w6]) {
    sum += waveHeightF64(w, speed, x, z, time);
  }
  return sum;
}

// ------------------------------------------------------------------------------------------- //
// Committed golden vectors: fixed (wave lanes, x, z, time) inputs -> expected surface height.
// The expected value derives from surfaceHeightF64 (f64, exact mirror); the f32-mode probe must
// stay within the ladder-derived bound of it, and the f64-mode probe must equal it bitwise.
// ------------------------------------------------------------------------------------------- //
interface GoldenVector {
  id: string;
  lanes: WaveLaneSet;
  speed: number;
  x: number;
  z: number;
  time: number;
  golden: number;
  /** Why this vector is in the regression set (worst-case class it covers). */
  purpose: string;
}

const GOLDEN_VECTORS: readonly GoldenVector[] = [
  {
    id: "A-default",
    lanes: { wave1: [1, 0.5, 0.1, 10], wave2: [0.2, 0.8, 0.15, 6], wave3: [-0.3, 0.7, 0.05, 3] },
    speed: 1,
    x: 1.5,
    z: -2,
    time: 1,
    golden: 0.03891708539442204,
    purpose: "default OpenWaterMaterial lanes, modest args",
  },
  {
    id: "B-default-large-phase",
    lanes: { wave1: [1, 0.5, 0.1, 10], wave2: [0.2, 0.8, 0.15, 6], wave3: [-0.3, 0.7, 0.05, 3] },
    speed: 1,
    x: -40,
    z: 30,
    time: 10,
    golden: 0.03364727595703829,
    purpose: "default lanes, |phase| in the tens",
  },
  {
    id: "C-wavelength-clamp-band",
    lanes: {
      wave1: [0.8, 0.6, 1.0, 0.001],
      wave2: [0.3, 0.9, 0.9, 0.0012],
      wave3: [-0.4, 0.5, 0.8, 0.001],
    },
    speed: 1,
    x: 0.05,
    z: 0.02,
    time: 0.5,
    golden: 0.00015368584330395223,
    purpose: "wavelengths pressed against the 0.001 clamp, steep slopes",
  },
  {
    id: "D-near-degenerate-direction",
    lanes: { wave1: [1e-5, 1e-5, 0.5, 3], wave2: [0.5, -0.2, 0.4, 2], wave3: [0.1, 0.7, 0.3, 5] },
    speed: 10,
    x: 1000,
    z: -500,
    time: 100,
    golden: 0.0428464212633341,
    purpose: "near-degenerate wave1 direction + large phase",
  },
  {
    id: "E-huge-amplitude-large-phase",
    lanes: {
      wave1: [0.6, 0.8, 0.7, 100],
      wave2: [-0.4, 0.3, 0.6, 80],
      wave3: [0.9, 0.2, 0.5, 1e4],
    },
    speed: 0.1,
    x: 5e4,
    z: 1e4,
    time: 1e5,
    golden: 398.3400640010567,
    purpose: "huge amplitude (a3 ~ 795) + phase magnitude ~76k -> worst f32/f64 decorrelation",
  },
];

// ------------------------------------------------------------------------------------------- //
// Precision ladder: fixed lane sets x grids covering the worst-case classes. Must reproduce
// COMMITTED_WORST_DELTA bit-exactly; see measurement in describe below.
// ------------------------------------------------------------------------------------------- //
const LADDER_LANE_SETS: readonly WaveLaneSet[] = [
  { wave1: [1, 0.5, 0.1, 10], wave2: [0.2, 0.8, 0.15, 6], wave3: [-0.3, 0.7, 0.05, 3] },
  {
    wave1: [0.8, 0.6, 1.0, 0.001],
    wave2: [0.3, 0.9, 1.5, 0.0011],
    wave3: [-0.4, 0.5, 1.4, 0.0012],
  },
  {
    wave1: [1e-5, 1e-5, 0.5, 3],
    wave2: [0.5, -0.2, 0.4, 2],
    wave3: [0.1, 0.7, 0.3, 5],
  },
  {
    wave1: [0.6, 0.8, 0.7, 100],
    wave2: [-0.4, 0.3, 0.6, 80],
    wave3: [0.9, 0.2, 0.5, 1e4],
  },
  {
    wave1: [2, -1, 1.5, 0.8],
    wave2: [0.2, 2, 1.4, 0.5],
    wave3: [-1.5, -0.5, 1.0, 0.001],
  },
  {
    wave1: [0.001, 0.001, 1.2, 200],
    wave2: [0.3, 0.3, 1.0, 0.001],
    wave3: [-0.1, 0.05, 0.9, 2],
  },
  {
    wave1: [0.70710678, 0.70710678, 0.5, 1.7],
    wave2: [-0.6, 0.8, 0.3, 3.3],
    wave3: [0.3, -0.1, 1.1, 0.001],
  },
];

const LADDER_XS: readonly number[] = [0, 1e-6, 1e-3, 0.1, 1, 10, 1e3];
const LADDER_ZS: readonly number[] = [0, 1e-5, 0.01, 1, 1e2, 1e4];
const LADDER_TIMES: readonly number[] = [0, 0.001, 1, 100, 1e5];
const LADDER_SPEEDS: readonly number[] = [0.1, 1, 10];

function measureWorstDelta(): number {
  let worst = 0.0;
  for (const lanes of LADDER_LANE_SETS) {
    for (const speed of LADDER_SPEEDS) {
      const probe = new OpenWaterSurfaceProbe({ ...lanes, speed }, { f32Precision: true });
      for (const x of LADDER_XS) {
        for (const z of LADDER_ZS) {
          for (const time of LADDER_TIMES) {
            const delta = Math.abs(
              probe.heightAt(x, z, time) - surfaceHeightF64(lanes, speed, x, z, time),
            );
            if (delta > worst) worst = delta;
          }
        }
      }
    }
  }
  return worst;
}

/**
 * A-priori f32 error bound for ONE sample, derived from that sample's own magnitudes instead of
 * a global worst case. Per wave the height is `a * sin(phase)`, so the absolute error is about
 * `a * (phaseError + opsError)`. The phase is a difference of two products, so its error scales
 * with `|k*dot| + |w*speed*time|`; every other op contributes one relative `F32_EPS`. The chain
 * length is MAX_CHAIN_OPS and the margin SAFETY_FACTOR. A small-phase realistic sample therefore
 * gets a tiny bound, a huge-phase outlier a large one -- never one value for all.
 */
function perVectorBound(
  lanes: WaveLaneSet,
  speed: number,
  x: number,
  z: number,
  time: number,
): number {
  const { wave1, wave2, wave3 } = lanes;
  const w4: WaveLane = [wave1[1], -wave1[0], wave1[2] * 0.45, wave1[3] * 0.42];
  const w5: WaveLane = [-wave2[1], wave2[0], wave2[2] * 0.35, wave2[3] * 0.35];
  const w6: WaveLane = [
    wave1[0] * 0.5 - wave1[1] * 0.866,
    wave1[0] * 0.866 + wave1[1] * 0.5,
    wave1[2] * 0.25,
    wave1[3] * 0.22,
  ];
  let bound = 0;
  for (const wave of [wave1, wave2, wave3, w4, w5, w6]) {
    const k = 6.28318530718 / Math.max(wave[3], 0.001);
    const amplitude = Math.abs(wave[2]) / Math.max(k, 0.001);
    const len = Math.sqrt(wave[0] * wave[0] + wave[1] * wave[1]);
    const kDot = Math.abs(k * ((wave[0] / len) * x + (wave[1] / len) * z));
    const wSpeedTime = Math.abs(Math.sqrt(9.81 * k) * speed * time);
    bound += amplitude * MAX_CHAIN_OPS * F32_EPS * (1 + kDot + wSpeedTime);
  }
  return bound * SAFETY_FACTOR;
}

describe("S1 OpenWaterSurfaceProbe golden-vector regression", () => {
  it("f64 mode equals the golden reference bit-for-bit for every committed vector", () => {
    for (const v of GOLDEN_VECTORS) {
      const probe = new OpenWaterSurfaceProbe(
        { ...v.lanes, speed: v.speed },
        { f32Precision: false },
      );
      // Same pure math, same op order -> must be bitwise identical to the independent golden.
      expect(probe.heightAt(v.x, v.z, v.time)).toBe(v.golden);
    }
  });

  it("the precision ladder still reproduces the committed worst case (behavior canary, not a bound)", () => {
    expect(measureWorstDelta()).toBe(COMMITTED_WORST_DELTA);
  });

  it("f32 mode stays within its own per-vector bound for every committed vector", () => {
    for (const v of GOLDEN_VECTORS) {
      const probe = new OpenWaterSurfaceProbe(
        { ...v.lanes, speed: v.speed },
        { f32Precision: true },
      );
      const delta = Math.abs(probe.heightAt(v.x, v.z, v.time) - v.golden);
      const bound = perVectorBound(v.lanes, v.speed, v.x, v.z, v.time);
      expect(delta, `${v.id} (#${v.purpose})`).toBeLessThanOrEqual(bound);
    }
  });

  it("f32 mode stays within the per-vector bound across the whole precision ladder", () => {
    for (const lanes of LADDER_LANE_SETS) {
      for (const speed of LADDER_SPEEDS) {
        const probe = new OpenWaterSurfaceProbe({ ...lanes, speed }, { f32Precision: true });
        for (const x of LADDER_XS) {
          for (const z of LADDER_ZS) {
            for (const time of LADDER_TIMES) {
              const delta = Math.abs(
                probe.heightAt(x, z, time) - surfaceHeightF64(lanes, speed, x, z, time),
              );
              expect(delta).toBeLessThanOrEqual(perVectorBound(lanes, speed, x, z, time));
            }
          }
        }
      }
    }
  });

  it("the per-vector bound is tight enough to catch a realistic mirror error", () => {
    // A realistic surface sample (moderate phase). A 2% steepness error in one lane is a
    // plausible transcription mistake; the old global worst-case bound (several metres) could
    // never see it, the per-vector bound must.
    const lanes: WaveLaneSet = {
      wave1: [1, 0.5, 0.35, 8],
      wave2: [0.2, 0.8, 0.3, 5],
      wave3: [-0.3, 0.7, 0.2, 3],
    };
    const speed = 1;
    const [x, z, time] = [3.7, -2.1, 1.3];
    const bound = perVectorBound(lanes, speed, x, z, time);
    expect(bound).toBeLessThan(1e-3);

    const wrong: WaveLaneSet = { ...lanes, wave1: [1, 0.5, 0.35 * 1.02, 8] };
    const wrongProbe = new OpenWaterSurfaceProbe({ ...wrong, speed }, { f32Precision: true });
    const delta = Math.abs(
      wrongProbe.heightAt(x, z, time) - surfaceHeightF64(lanes, speed, x, z, time),
    );
    expect(delta).toBeGreaterThan(bound);
  });
});

describe("S1 known-answer constant cross-checks (w1-only)", () => {
  const PI2 = 6.28318530718;

  it("zero phase yields exactly zero height (normalize + sin(0) path)", () => {
    // wave = [1,0,s,10]: dir=(1,0), dot=0, phase = k*0 - (w*1)*0 = 0 -> sin(0) = 0.
    expect(OpenWaterSurfaceProbe.waveHeight([1, 0, 0.1, 10], 0, 0, 1, 0, false)).toBe(0);
  });

  it("0.001 wavelength clamp: wave.w clamped, k = PI2/0.001, a = steepness/k (hand-derived)", () => {
    const k = PI2 / 0.001;
    const a = PI2 / k; // steepness = PI2, so a = 1/1000 exactly
    const x = Math.PI / 2 / k; // phase = k*x = pi/2 -> sin = 1
    const h = OpenWaterSurfaceProbe.waveHeight([1, 0, PI2, 0.0001], x, 0, 0, 0, false);
    expect(Math.abs(h - a)).toBeLessThanOrEqual(a * 1e-6);
    // Without the 0.001 clamp a would be 0.0001 -- prove the clamp is actually active.
    expect(Math.abs(h - 0.0001)).toBeGreaterThan(a * 0.5);
  });

  it("0.001 k clamp in a = steepness/max(k,0.001), while phase keeps the raw k", () => {
    const k = PI2 / 1e7; // ~6.28e-7 < 0.001 -> a = steepness/0.001 = 1
    const x = Math.PI / 2 / k; // phase uses the UNclamped k -> sin = 1
    const h = OpenWaterSurfaceProbe.waveHeight([1, 0, 0.001, 1e7], x, 0, 0, 0, false);
    expect(Math.abs(h - 1.0)).toBeLessThanOrEqual(1e-6);
  });

  it("gravity: w = sqrt(9.81*k) with exact construction, speed*time association pinned to +1", () => {
    // k = 9.81/4, w = 9.81/2, a = steepness/k = 1; speed*time = -pi/9.81 makes
    // w*speed*time = -pi/2 (only exact when gravity == 9.81 and the left-assoc
    // (w*speed)*time order holds), so phase = +pi/2 and height = +1 bit-exactly.
    const wave: WaveLane = [1, 0, 9.81 / 4, (4 * PI2) / 9.81];
    const h = OpenWaterSurfaceProbe.waveHeight(wave, 0, 0, -Math.PI / 9.81, 1, false);
    expect(h).toBe(1);
  });
});

describe("S1 G2 constants-equality manifest (same-field proof)", () => {
  it("probe lanes equal the material fields exactly, element per element", () => {
    const wave1: [number, number, number, number] = [0.7, -0.3, 0.12, 9.5];
    const wave2: [number, number, number, number] = [0.4, 0.85, 0.2, 5.2];
    const wave3: [number, number, number, number] = [-0.5, 0.6, 0.08, 2.7];
    const speed = 2.5;

    const material = new OpenWaterMaterial({ wave1, wave2, wave3, speed });
    const probe = OpenWaterSurfaceProbe.fromMaterial(material);
    const lanes = probe.getWaveLanes();

    for (let i = 0; i < 4; i++) {
      expect(lanes.wave1[i]).toBe(wave1[i]);
      expect(lanes.wave2[i]).toBe(wave2[i]);
      expect(lanes.wave3[i]).toBe(wave3[i]);
    }
    expect(lanes.speed).toBe(speed);
  });

  it("the render manifest ships exactly the same fields the probe reads (u_* packing)", () => {
    const wave1: [number, number, number, number] = [0.7, -0.3, 0.12, 9.5];
    const wave2: [number, number, number, number] = [0.4, 0.85, 0.2, 5.2];
    const wave3: [number, number, number, number] = [-0.5, 0.6, 0.08, 2.7];
    const speed = 2.5;

    const material = new OpenWaterMaterial({ wave1, wave2, wave3, speed });
    const props = material.getRenderManifest().properties;
    const extra = props["u_extraParams"] as number[];
    const liquid = props["u_liquidParams"] as number[];
    const thresholds = props["u_thresholds"] as number[];
    const reflectivity = props["u_reflectivity"] as number;

    // Same-field proof: the packed manifest (what ships to the GPU) equals the probe's lanes.
    const probe = OpenWaterSurfaceProbe.fromMaterial(material);
    const lanes = probe.getWaveLanes();

    expect(extra).toHaveLength(4);
    expect(liquid).toHaveLength(4);
    expect(thresholds).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(extra[i]).toBe(lanes.wave1[i]);
      expect(liquid[i]).toBe(lanes.wave2[i]);
      expect(thresholds[i]).toBe(lanes.wave3[i]);
      expect(extra[i]).toBe(wave1[i]);
      expect(liquid[i]).toBe(wave2[i]);
      expect(thresholds[i]).toBe(wave3[i]);
    }
    expect(reflectivity).toBe(speed);
    expect(lanes.speed).toBe(reflectivity);
  });
});

describe("S1 world-point query (horizontal Gerstner displacement inverted)", () => {
  const lanes: WaveLaneSet = {
    wave1: [1, 0.5, 0.35, 8],
    wave2: [0.2, 0.8, 0.3, 5],
    wave3: [-0.3, 0.7, 0.2, 3],
  };
  const speed = 1;
  const time = 1.3;
  const REST_POINTS: readonly (readonly [number, number])[] = [
    [0, 0],
    [3.7, -2.1],
    [-5.2, 4.4],
    [10, 10],
    [-8.1, -7.3],
  ];

  /** Where the vertex that starts at the rest position ends up, using the shader formulas in f64. */
  function displacedPosition(restX: number, restZ: number): [number, number] {
    const { wave1, wave2, wave3 } = lanes;
    const w4: WaveLane = [wave1[1], -wave1[0], wave1[2] * 0.45, wave1[3] * 0.42];
    const w5: WaveLane = [-wave2[1], wave2[0], wave2[2] * 0.35, wave2[3] * 0.35];
    const w6: WaveLane = [
      wave1[0] * 0.5 - wave1[1] * 0.866,
      wave1[0] * 0.866 + wave1[1] * 0.5,
      wave1[2] * 0.25,
      wave1[3] * 0.22,
    ];
    let dx = 0;
    let dz = 0;
    for (const wave of [wave1, wave2, wave3, w4, w5, w6]) {
      const k = 6.28318530718 / Math.max(wave[3], 0.001);
      const a = wave[2] / Math.max(k, 0.001);
      const len = Math.sqrt(wave[0] * wave[0] + wave[1] * wave[1]);
      const dirX = wave[0] / len;
      const dirY = wave[1] / len;
      const phase = k * (dirX * restX + dirY * restZ) - Math.sqrt(9.81 * k) * speed * time;
      dx += dirX * a * Math.cos(phase);
      dz += dirY * a * Math.cos(phase);
    }
    return [restX + dx, restZ + dz];
  }

  it("returns the height of the vertex that really ends up above the world point", () => {
    const probe = new OpenWaterSurfaceProbe({ ...lanes, speed }, { f32Precision: false });
    for (const [restX, restZ] of REST_POINTS) {
      const [worldX, worldZ] = displacedPosition(restX, restZ);
      const expected = surfaceHeightF64(lanes, speed, restX, restZ, time);
      expect(probe.surfaceHeightAt(worldX, worldZ, time)).toBeCloseTo(expected, 5);
    }
  });

  it("differs measurably from the rest-position query, which is why the inversion is needed", () => {
    const probe = new OpenWaterSurfaceProbe({ ...lanes, speed }, { f32Precision: false });
    let worstNaiveError = 0;
    for (const [restX, restZ] of REST_POINTS) {
      const [worldX, worldZ] = displacedPosition(restX, restZ);
      const expected = surfaceHeightF64(lanes, speed, restX, restZ, time);
      worstNaiveError = Math.max(
        worstNaiveError,
        Math.abs(probe.heightAt(worldX, worldZ, time) - expected),
      );
    }
    expect(worstNaiveError).toBeGreaterThan(1e-3);
  });
});
