/**
 * Seeded, reproducible camera paths for Showcase 51 (vegetation measurement rig, ADR 0059 step 0).
 *
 * Pure module, intentionally engine-free: no imports, no DOM, no `Math.random`. Every path is a
 * LOOPED sequence of seeded keyframes, interpolated with CENTRIPETAL Catmull-Rom (alpha = 0.5),
 * which is derivative-continuous, has no per-segment self-intersections and no overshoot spikes —
 * exactly what the measurement rig needs (no teleports, bounded to the scatter area, comparable
 * across tiers and across runs).
 *
 * Contract (bind for every consumer, incl. `.agents/scripts/veg-bench.mjs`):
 *   `sample(t)`: `t` is normalized [0, 1] and LOOPED (any `t` incl. outside [0,1]); returns the
 *   camera pose in engine world units, right-handed, +Y up: `position` = eye, `target` = look-at.
 *
 * Path guarantees (constraints documented per path; enforced by
 * `apps/showcases/51/tests/CameraPaths.test.ts` against the fixed seed):
 *   - walk:    duration 120 s, ground radius 15..45 m, height 2..4 m     (hard floor 1.2 m)
 *   - flight:  duration  30 s, ground radius 20..70 m, height 6..20 m    (hard floor 3 m; the
 *              pop-sensitive path named in the ADR 0059 step 2 gate)
 *   - aerial:  duration  60 s, ground radius 30..90 m, height 60..110 m  (hard floor 40 m)
 *   - all: |x|,|z| stay inside the ~200×200 m scatter area (±100 m), no NaN, same-seed
 *     reproducible, pairwise distinct.
 */
export type PathName = "walk" | "flight" | "aerial";

/** Camera pose sample in engine world coordinates (meters, right-handed, +Y up). */
export interface CameraSample {
  /** Eye position. */
  position: [number, number, number];
  /** Look-at target. */
  target: [number, number, number];
}

/** One reproducible camera path over the showcase-51 scatter area. */
export interface CameraPath {
  readonly name: PathName;
  /** Time of one full loop in seconds; normalized `t` maps 1:1 onto one loop. */
  readonly durationSeconds: number;
  /**
   * Samples the loop. `t` is normalized [0, 1] and wrapped (looped), so any real `t` is valid.
   * Returns a fresh object every call; callers that need the previous sample must copy it.
   */
  sample(t: number): CameraSample;
}

export const CAMERA_PATH_NAMES: readonly PathName[] = ["walk", "flight", "aerial"];

/** Deterministic master seed the paths are derived from. Changing it changes every path. */
export const PATH_SEED = 0x5eed51; // "seed51" -- fixed; see the unit test for enforced guarantees.

/** Local mulberry32 PRNG (exported for reproducibility checks; deterministic, no `Math.random`). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PathSpec {
  readonly seed: number;
  readonly durationSeconds: number;
  readonly keyframes: number;
  /** Ground-plane radius band of the camera loop (m). */
  readonly radiusMin: number;
  readonly radiusMax: number;
  /** Absolute height band of the camera eye (m). */
  readonly heightMin: number;
  readonly heightMax: number;
  /** Total angular sweep of one loop in turns (may be fractional). */
  readonly sweepTurns: number;
  /** Look-target: ground radius band from the origin (m). */
  readonly targetRadiusMin: number;
  readonly targetRadiusMax: number;
  /** Look-target height band (m). */
  readonly targetHeightMin: number;
  readonly targetHeightMax: number;
}

const PATH_SPECS: Readonly<Record<PathName, PathSpec>> = {
  walk: {
    seed: 0x77a10c1,
    durationSeconds: 120,
    keyframes: 24,
    radiusMin: 15,
    radiusMax: 45,
    heightMin: 2,
    heightMax: 4,
    sweepTurns: 2,
    targetRadiusMin: 0,
    targetRadiusMax: 8,
    targetHeightMin: 0.5,
    targetHeightMax: 1.5,
  },
  flight: {
    seed: 0xf11_6a7,
    durationSeconds: 30,
    keyframes: 18,
    radiusMin: 20,
    radiusMax: 70,
    heightMin: 6,
    heightMax: 20,
    sweepTurns: 2.5,
    targetRadiusMin: 0,
    targetRadiusMax: 16,
    targetHeightMin: 0,
    targetHeightMax: 2.5,
  },
  aerial: {
    seed: 0xa31a1,
    durationSeconds: 60,
    keyframes: 12,
    radiusMin: 30,
    radiusMax: 90,
    heightMin: 60,
    heightMax: 110,
    sweepTurns: 3,
    targetRadiusMin: 0,
    targetRadiusMax: 30,
    targetHeightMin: 0,
    targetHeightMax: 8,
  },
};

type V3 = [number, number, number];

/** Euclidean distance between two points. */
function distance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Knot time delta for the centripetal (alpha = 0.5) parametrization. Coincident points get a tiny
 * non-zero delta so the CR basis below never divides by zero (degenerate keyframes -> NaN guard).
 */
function knotDelta(d0: number): number {
  return d0 < 1e-9 ? 1e-3 : Math.sqrt(d0);
}

/** Interpolation weight with a zero-denominator guard (coincident knots -> 0.5 midpoint). */
function weight(c: number, a: number, b: number): number {
  const den = b - a;
  if (den === 0) return 0.5;
  return (c - a) / den;
}

/**
 * Closed-loop control points for segment `i` of `n` keyframes (indices wrap).
 * Returns four tuples; no temporary arrays are allocated per sample.
 */
type Control4 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

function controlPoints(pts: readonly V3[], i: number): Control4 {
  const n = pts.length;
  const im1 = (i - 1 + n) % n;
  const ip1 = (i + 1) % n;
  const ip2 = (i + 2) % n;
  return [pts[im1]!, pts[i]!, pts[ip1]!, pts[ip2]!];
}

/**
 * Evaluates the closed-loop centripetal Catmull-Rom at segment `i`, local parameter `s` in [0,1).
 *
 * Reference (B. B. Clark, "Centripetal Catmull-Rom spline"; standard nested evaluation):
 *   t0..t3 are chord-length knot times of the four control points (alpha 0.5), the curve passes
 *   through p1..p2 for tc in [t1, t2], and per-coordinate
 *     A1 = mix(p0, p1, tc, t1..t0)   A2 = mix(p1, p2, tc, t2..t1)   A3 = mix(p2, p3, tc, t3..t2)
 *     B1 = mix(A1, A2, tc, t2..t0)   B2 = mix(A2, A3, tc, t3..t1)
 *     C  = mix(B1, B2, tc, t2..t1).
 */
function sampleSegment(
  pts: readonly V3[],
  bases: readonly number[][],
  segment: number,
  s: number,
): V3 {
  const n = pts.length;
  const i = segment % n;
  const basis = bases[i]!;
  const t0 = basis[0]!;
  const t1 = basis[1]!;
  const t2 = basis[2]!;
  const t3 = basis[3]!;
  const tc = t1 + (t2 - t1) * s;
  const [p0, p1, p2, p3] = controlPoints(pts, i);

  const mix = (c0: number, c1: number, u0: number, u1: number, tv: number): number =>
    c0 * (1 - weight(tv, u0, u1)) + c1 * weight(tv, u0, u1);

  const evalCoord = (a0: number, a1: number, a2: number, a3: number): number => {
    const A1 = mix(a0, a1, t0, t1, tc);
    const A2 = mix(a1, a2, t1, t2, tc);
    const A3 = mix(a2, a3, t2, t3, tc);
    const B1 = mix(A1, A2, t0, t2, tc);
    const B2 = mix(A2, A3, t1, t3, tc);
    return mix(B1, B2, t1, t2, tc);
  };

  return [
    evalCoord(p0[0], p1[0], p2[0], p3[0]),
    evalCoord(p0[1], p1[1], p2[1], p3[1]),
    evalCoord(p0[2], p1[2], p2[2], p3[2]),
  ];
}

/** Precomputes the per-segment knot times of a closed loop (static geometry -> static bases). */
function buildBases(pts: readonly V3[]): readonly number[][] {
  const n = pts.length;
  const bases: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = controlPoints(pts, i);
    const d01 = knotDelta(distance(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]));
    const d12 = knotDelta(distance(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]));
    const d23 = knotDelta(distance(p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]));
    bases.push([0, d01, d01 + d12, d01 + d12 + d23]);
  }
  return bases;
}

interface PathGeometry {
  readonly positions: readonly V3[];
  readonly targets: readonly V3[];
  readonly positionBases: readonly number[][];
  readonly targetBases: readonly number[][];
}

/** Deterministically builds the closed keyframe loop of one path spec. */
function buildGeometry(spec: PathSpec): PathGeometry {
  const rng = mulberry32(spec.seed);
  const count = spec.keyframes;
  const startAngle = rng() * Math.PI * 2;
  const direction = rng() < 0.5 ? 1 : -1;
  const stepAngle = (direction * spec.sweepTurns * Math.PI * 2) / count;
  // Fixed relative look offset: the target stays inside the field while the camera orbits, so the
  // look direction sweeps across the population instead of staring at one point.
  const lookOffset = Math.PI * (0.6 + rng() * 0.6) * direction;

  const positions: V3[] = [];
  const targets: V3[] = [];
  for (let k = 0; k < count; k++) {
    const angle = startAngle + stepAngle * k;
    const radius = spec.radiusMin + rng() * (spec.radiusMax - spec.radiusMin);
    const height = spec.heightMin + rng() * (spec.heightMax - spec.heightMin);
    positions.push([Math.cos(angle) * radius, height, Math.sin(angle) * radius]);

    const targetRadius =
      spec.targetRadiusMin + rng() * (spec.targetRadiusMax - spec.targetRadiusMin);
    const targetHeight =
      spec.targetHeightMin + rng() * (spec.targetHeightMax - spec.targetHeightMin);
    const targetAngle = angle + lookOffset;
    targets.push([
      Math.cos(targetAngle) * targetRadius,
      targetHeight,
      Math.sin(targetAngle) * targetRadius,
    ]);
  }

  return {
    positions,
    targets,
    positionBases: buildBases(positions),
    targetBases: buildBases(targets),
  };
}

class SeededCameraPath implements CameraPath {
  public readonly name: PathName;
  public readonly durationSeconds: number;

  private readonly _spec: PathSpec;
  private _geometry: PathGeometry | undefined;

  constructor(name: PathName, spec: PathSpec) {
    this.name = name;
    this.durationSeconds = spec.durationSeconds;
    this._spec = spec;
  }

  public sample(t: number): CameraSample {
    // Loop the normalized parameter; guard NaN/infinite inputs (treat as 0) so a broken timer can
    // never propagate NaN into the camera pose.
    const wrapped = Number.isFinite(t) && !Number.isNaN(t) ? t - Math.floor(t) : 0;
    const geometry = (this._geometry ??= buildGeometry(this._spec));
    const count = geometry.positions.length;
    const scaled = wrapped * count;
    let segment = Math.floor(scaled);
    if (segment > count - 1) {
      // Floating point can land exactly on the loop end; clamp to the last segment.
      segment = count - 1;
    }
    const local = scaled - segment;
    const position = sampleSegment(geometry.positions, geometry.positionBases, segment, local);
    const target = sampleSegment(geometry.targets, geometry.targetBases, segment, local);
    return { position, target };
  }
}

const PATH_CACHE: Partial<Record<PathName, CameraPath>> = {};

/** Returns the seeded camera path for `name`; throws on an unknown name (fail fast). */
export function getCameraPath(name: PathName): CameraPath {
  const cached = PATH_CACHE[name];
  if (cached) return cached;
  const spec = PATH_SPECS[name];
  if (!spec) {
    throw new Error(`getCameraPath: unknown path '${String(name)}' (expected walk|flight|aerial)`);
  }
  const path = new SeededCameraPath(name, spec);
  PATH_CACHE[name] = path;
  return path;
}
