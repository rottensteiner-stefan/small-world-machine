import type { Vec3Like } from "./Vec3Like.js";
import type { BoxBounds } from "./VoronoiCells.js";
import { mulberry32 } from "./VoronoiCells.js";

/**
 * Configuration options for 3D Poisson disk sampling.
 */
export interface PoissonDiskSampleOptions {
  /** The sampling volume. Defaults to a (-1,-1,-1)..(1,1,1) cube. */
  bounds?: BoxBounds;
  /** The minimum allowed distance between any two samples. Defaults to 0.3. */
  minDistance?: number;
  /** Seed for the deterministic random generator. Defaults to 1. */
  seed?: number;
  /** Candidate attempts per active sample before giving up on it. Defaults to 30. */
  maxAttempts?: number;
}

/**
 * Generates points inside a box with Bridson's "fast Poisson disk sampling"
 * algorithm, guaranteeing no two points are closer than `minDistance`. Unlike
 * plain uniform random points, this avoids tiny sliver cells sitting right next
 * to oversized ones when used as `VoronoiCellsOptions.points` -- seeds end up
 * roughly evenly spaced instead of clustering by chance.
 * @param options The configuration options.
 * @returns The generated points (at least 1, the initial seed).
 */
export function poissonDiskSample(options: PoissonDiskSampleOptions = {}): Vec3Like[] {
  const {
    bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    minDistance = 0.3,
    seed = 1,
    maxAttempts = 30,
  } = options;

  const r: number = Math.max(0.000001, minDistance);
  const rng: () => number = mulberry32(seed);
  const cellSize: number = r / Math.sqrt(3);

  const sizeX: number = bounds.max.x - bounds.min.x;
  const sizeY: number = bounds.max.y - bounds.min.y;
  const sizeZ: number = bounds.max.z - bounds.min.z;

  const grid: Map<string, number> = new Map();
  const cellOf = (p: Vec3Like): [number, number, number] => [
    Math.floor((p.x - bounds.min.x) / cellSize),
    Math.floor((p.y - bounds.min.y) / cellSize),
    Math.floor((p.z - bounds.min.z) / cellSize),
  ];
  const keyOf = (ix: number, iy: number, iz: number): string => `${ix},${iy},${iz}`;

  const samples: Vec3Like[] = [];

  const isFarEnough = (p: Vec3Like): boolean => {
    const [cx, cy, cz] = cellOf(p);
    for (let dz: number = -2; dz <= 2; dz++) {
      for (let dy: number = -2; dy <= 2; dy++) {
        for (let dx: number = -2; dx <= 2; dx++) {
          const neighborIdx: number | undefined = grid.get(keyOf(cx + dx, cy + dy, cz + dz));
          if (undefined === neighborIdx) continue;
          const q: Vec3Like = samples[neighborIdx]!;
          const ddx: number = p.x - q.x;
          const ddy: number = p.y - q.y;
          const ddz: number = p.z - q.z;
          if (ddx * ddx + ddy * ddy + ddz * ddz < r * r) return false;
        }
      }
    }
    return true;
  };

  const addSample = (p: Vec3Like): number => {
    const index: number = samples.length;
    samples.push(p);
    const [cx, cy, cz] = cellOf(p);
    grid.set(keyOf(cx, cy, cz), index);
    return index;
  };

  const isInBounds = (p: Vec3Like): boolean =>
    p.x >= bounds.min.x &&
    p.x <= bounds.max.x &&
    p.y >= bounds.min.y &&
    p.y <= bounds.max.y &&
    p.z >= bounds.min.z &&
    p.z <= bounds.max.z;

  const first: Vec3Like = {
    x: bounds.min.x + rng() * sizeX,
    y: bounds.min.y + rng() * sizeY,
    z: bounds.min.z + rng() * sizeZ,
  };
  const active: number[] = [addSample(first)];

  while (active.length > 0) {
    const activeSlot: number = Math.floor(rng() * active.length);
    const activeIndex: number = active[activeSlot]!;
    const origin: Vec3Like = samples[activeIndex]!;

    let placed: boolean = false;
    for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
      const theta: number = Math.acos(2 * rng() - 1);
      const phi: number = rng() * Math.PI * 2;
      const radius: number = r * (1 + rng());
      const candidate: Vec3Like = {
        x: origin.x + radius * Math.sin(theta) * Math.cos(phi),
        y: origin.y + radius * Math.sin(theta) * Math.sin(phi),
        z: origin.z + radius * Math.cos(theta),
      };

      if (isInBounds(candidate) && isFarEnough(candidate)) {
        active.push(addSample(candidate));
        placed = true;
        break;
      }
    }

    if (!placed) active.splice(activeSlot, 1);
  }

  return samples;
}
