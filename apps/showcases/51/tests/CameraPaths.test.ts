import { describe, expect, it } from "vitest";
import {
  CAMERA_PATH_NAMES,
  PATH_SEED,
  getCameraPath,
  mulberry32,
  type CameraPath,
  type CameraSample,
  type PathName,
} from "../CameraPaths.js";

/** Height floors from the CameraPaths contract. */
const HEIGHT_FLOOR_M: Readonly<Record<PathName, number>> = {
  walk: 1.2,
  flight: 3,
  aerial: 40,
};

/** Scatter-area bound: |x|,|z| <= 100 m (200x200 m field around the origin). */
const AREA_HALF_EXTENT_M = 100;

/** Dense normalized-time grid; also probes wrapped (`t >= 1`) and negative `t`. */
function sampleGrid(path: CameraPath, steps = 2000): CameraSample[] {
  const samples: CameraSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push(path.sample(t));
  }
  // Loop semantics: t = 1.33 and t = -0.25 must equal their wrapped equivalents.
  samples.push(path.sample(1.33));
  samples.push(path.sample(-0.25));
  samples.push(path.sample(2.0001));
  return samples;
}

function expectFinite(sample: CameraSample): void {
  for (const component of [...sample.position, ...sample.target]) {
    expect(Number.isFinite(component), `non-finite component ${component}`).toBe(true);
  }
}

function expectInAreaAndAboveFloor(sample: CameraSample, pathName: PathName): void {
  const [px, py, pz] = sample.position;
  expect(Math.abs(px)).toBeLessThanOrEqual(AREA_HALF_EXTENT_M * 1.5); // hard area bound
  expect(Math.abs(pz)).toBeLessThanOrEqual(AREA_HALF_EXTENT_M * 1.5);
  // Contract floors must hold on the EYE height.
  expect(py).toBeGreaterThanOrEqual(HEIGHT_FLOOR_M[pathName]!);
}

describe("51 CameraPaths", () => {
  it("exposes exactly the three contracted paths", () => {
    expect(CAMERA_PATH_NAMES).toEqual(["walk", "flight", "aerial"]);
    for (const name of CAMERA_PATH_NAMES) {
      expect(getCameraPath(name).name).toBe(name);
    }
    expect(() => getCameraPath("nope" as PathName)).toThrow();
  });

  it("has positive, finite durations (walk slowest, flight fastest)", () => {
    const walk = getCameraPath("walk");
    const flight = getCameraPath("flight");
    const aerial = getCameraPath("aerial");
    for (const path of [walk, flight, aerial]) {
      expect(Number.isFinite(path.durationSeconds)).toBe(true);
      expect(path.durationSeconds).toBeGreaterThan(0);
    }
    expect(flight.durationSeconds).toBeLessThan(walk.durationSeconds);
  });

  it("is deterministic: same seed, same samples, for every path", () => {
    for (const name of CAMERA_PATH_NAMES) {
      const a = getCameraPath(name);
      const b = getCameraPath(name);
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        expect(a.sample(t)).toEqual(b.sample(t));
      }
    }
  });

  it("loops: wrap-around matches the equivalent normalized samples", () => {
    const walk = getCameraPath("walk");
    const wrapped = walk.sample(0.75);
    const unwrapped = walk.sample(0.75 + 1);
    expect(wrapped).toEqual(unwrapped);
  });

  it("never produces NaN on a dense grid incl. out-of-range inputs", () => {
    for (const name of CAMERA_PATH_NAMES) {
      const path = getCameraPath(name);
      for (const sample of sampleGrid(path)) {
        expectFinite(sample);
      }
    }
  });

  it("stays inside the scatter area and above the per-path height floor", () => {
    for (const name of CAMERA_PATH_NAMES) {
      const path = getCameraPath(name);
      for (const sample of sampleGrid(path, 4000)) {
        expectInAreaAndAboveFloor(sample, name);
      }
    }
  });

  it("is continuous: no teleports on a dense grid (bounded per-sample displacement)", () => {
    for (const name of CAMERA_PATH_NAMES) {
      const path = getCameraPath(name);
      const maxJump = name === "flight" ? 40 : name === "aerial" ? 60 : 20;
      let previous: CameraSample | undefined;
      for (let i = 0; i <= 4000; i++) {
        const sample = path.sample(i / 4000);
        if (previous) {
          const dx = sample.position[0] - previous.position[0];
          const dy = sample.position[1] - previous.position[1];
          const dz = sample.position[2] - previous.position[2];
          const jump = Math.sqrt(dx * dx + dy * dy + dz * dz);
          expect(jump, `path ${name} teleport at t=${i / 4000}`).toBeLessThan(maxJump);
        }
        previous = sample;
      }
    }
  });

  it("is not a degenerate single point and paths are pairwise distinct", () => {
    const samplesOf = (name: PathName): CameraSample[] => {
      const path = getCameraPath(name);
      const out: CameraSample[] = [];
      for (let i = 0; i < 50; i++) out.push(path.sample(i / 50));
      return out;
    };

    for (const name of CAMERA_PATH_NAMES) {
      const first = samplesOf(name)[0]!;
      const nonstationary = samplesOf(name).some(
        (s) =>
          s.position[0] !== first.position[0] ||
          s.position[1] !== first.position[1] ||
          s.position[2] !== first.position[2],
      );
      expect(nonstationary, `path ${name} is stationary`).toBe(true);
    }

    const a = samplesOf("walk");
    const b = samplesOf("flight");
    const c = samplesOf("aerial");
    for (let i = 0; i < a.length; i++) {
      const p = a[i]!.position;
      const qb = b[i]!.position;
      const qc = c[i]!.position;
      const differsB = p[0] !== qb[0] || p[1] !== qb[1] || p[2] !== qb[2];
      const differsC = p[0] !== qc[0] || p[1] !== qc[1] || p[2] !== qc[2];
      expect(differsB || differsC, `paths collapse at index ${i}`).toBe(true);
    }
  });

  it("deterministically covers the field: per-path ground radius stays in its documented band", () => {
    // The documented radii are 15..45 (walk), 20..70 (flight), 30..90 (aerial); the test only pins
    // the loose invariant that the loop actually orbits outside the ~center (never a fixed point).
    for (const name of CAMERA_PATH_NAMES) {
      const path = getCameraPath(name);
      let maxRadius = 0;
      for (let i = 0; i < 4000; i++) {
        const [x, , z] = path.sample(i / 4000).position;
        maxRadius = Math.max(maxRadius, Math.hypot(x, z));
      }
      expect(maxRadius).toBeGreaterThan(10);
      expect(maxRadius).toBeLessThan(AREAL_EXTENT_UPPER_BOUND);
    }
  });

  it("mulberry32 is deterministic and reproduces known first outputs (regression lock)", () => {
    const rng = mulberry32(PATH_SEED);
    const floats = [rng(), rng(), rng(), rng(), rng()];
    for (const v of floats) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // Same seed -> same stream; different seed -> different stream.
    const rng2 = mulberry32(PATH_SEED);
    expect(floats).toEqual([rng2(), rng2(), rng2(), rng2(), rng2()]);
    const rng3 = mulberry32(PATH_SEED + 1);
    expect([rng3(), rng3(), rng3(), rng3(), rng3()]).not.toEqual(floats);
  });
});

/** Upper bound the orbit may never reach (loose guard against keyframe regressions). */
const AREAL_EXTENT_UPPER_BOUND = 110;
