import type { ParticleArrays } from "../../src/Particle.js";

/**
 * Shared SoA test harness: construct/clone `ParticleArrays`, set/read single slots, and assert
 * exact field-for-field equality -- replacing the old per-particle-object manipulation so tests
 * exercise the real array-backed data path.
 */

export interface ParticleState {
  pos: [number, number, number];
  vel: [number, number, number];
  acc: [number, number, number];
  col: [number, number, number, number];
  size: number;
  alpha: number;
  mass: number;
  life: number;
  maxLife: number;
  heat: number;
  alive: boolean;
}

export function createArrays(capacity: number): ParticleArrays {
  return {
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    accelerations: new Float32Array(capacity * 3),
    colors: new Float32Array(capacity * 4),
    sizes: new Float32Array(capacity),
    alphas: new Float32Array(capacity),
    masses: new Float32Array(capacity),
    lives: new Float32Array(capacity),
    maxLives: new Float32Array(capacity),
    heats: new Float32Array(capacity),
    aliveFlags: new Uint8Array(capacity),
  };
}

/** Deep-copies the given arrays (used for parallel batch-vs-single reference runs). */
export function cloneArrays(src: ParticleArrays, count: number): ParticleArrays {
  const dst = createArrays(count);
  dst.positions.set(src.positions.subarray(0, count * 3));
  dst.velocities.set(src.velocities.subarray(0, count * 3));
  dst.accelerations.set(src.accelerations.subarray(0, count * 3));
  dst.colors.set(src.colors.subarray(0, count * 4));
  dst.sizes.set(src.sizes.subarray(0, count));
  dst.alphas.set(src.alphas.subarray(0, count));
  dst.masses.set(src.masses.subarray(0, count));
  dst.lives.set(src.lives.subarray(0, count));
  dst.maxLives.set(src.maxLives.subarray(0, count));
  dst.heats.set(src.heats.subarray(0, count));
  dst.aliveFlags.set(src.aliveFlags.subarray(0, count));
  return dst;
}

/** Writes a partial state into a single slot and marks it alive (alive: false overrides). */
export function setState(arrays: ParticleArrays, index: number, s: Partial<ParticleState>): void {
  const o = index * 3;
  const c = index * 4;
  if (s.pos) {
    arrays.positions[o] = s.pos[0];
    arrays.positions[o + 1] = s.pos[1];
    arrays.positions[o + 2] = s.pos[2];
  }
  if (s.vel) {
    arrays.velocities[o] = s.vel[0];
    arrays.velocities[o + 1] = s.vel[1];
    arrays.velocities[o + 2] = s.vel[2];
  }
  if (s.acc) {
    arrays.accelerations[o] = s.acc[0];
    arrays.accelerations[o + 1] = s.acc[1];
    arrays.accelerations[o + 2] = s.acc[2];
  }
  if (s.col) {
    arrays.colors[c] = s.col[0];
    arrays.colors[c + 1] = s.col[1];
    arrays.colors[c + 2] = s.col[2];
    arrays.colors[c + 3] = s.col[3];
  }
  if (s.size !== undefined) arrays.sizes[index] = s.size;
  else arrays.sizes[index] = 1.0;
  if (s.alpha !== undefined) arrays.alphas[index] = s.alpha;
  else arrays.alphas[index] = 1.0;
  if (s.mass !== undefined) arrays.masses[index] = s.mass;
  else arrays.masses[index] = 1.0;
  if (s.life !== undefined) arrays.lives[index] = s.life;
  else arrays.lives[index] = 0;
  if (s.maxLife !== undefined) arrays.maxLives[index] = s.maxLife;
  else arrays.maxLives[index] = Infinity;
  if (s.heat !== undefined) arrays.heats[index] = s.heat;
  else arrays.heats[index] = 0;
  arrays.aliveFlags[index] = s.alive === false ? 0 : 1;
}

export function readState(arrays: ParticleArrays, index: number): ParticleState {
  const o = index * 3;
  const c = index * 4;
  return {
    pos: [arrays.positions[o]!, arrays.positions[o + 1]!, arrays.positions[o + 2]!],
    vel: [arrays.velocities[o]!, arrays.velocities[o + 1]!, arrays.velocities[o + 2]!],
    acc: [arrays.accelerations[o]!, arrays.accelerations[o + 1]!, arrays.accelerations[o + 2]!],
    col: [arrays.colors[c]!, arrays.colors[c + 1]!, arrays.colors[c + 2]!, arrays.colors[c + 3]!],
    size: arrays.sizes[index]!,
    alpha: arrays.alphas[index]!,
    mass: arrays.masses[index]!,
    life: arrays.lives[index]!,
    maxLife: arrays.maxLives[index]!,
    heat: arrays.heats[index]!,
    alive: arrays.aliveFlags[index] === 1,
  };
}

/** Exact (===) field-for-field comparison: batch output must equal per-slot apply output bit for bit. */
export function expectStateEqual(a: ParticleState, b: ParticleState): void {
  for (let k = 0; k < 3; k++) {
    expect(a.pos[k]).toBe(b.pos[k]);
    expect(a.vel[k]).toBe(b.vel[k]);
    expect(a.acc[k]).toBe(b.acc[k]);
  }
  for (let k = 0; k < 4; k++) {
    expect(a.col[k]).toBe(b.col[k]);
  }
  expect(a.size).toBe(b.size);
  expect(a.alpha).toBe(b.alpha);
  expect(a.mass).toBe(b.mass);
  expect(a.life).toBe(b.life);
  expect(a.maxLife).toBe(b.maxLife);
  expect(a.heat).toBe(b.heat);
  expect(a.alive).toBe(b.alive);
}

/** Generic seeded state with a mostly random shape (alive), for branch/parity coverage. */
export function seededState(rng: () => number): ParticleState {
  return {
    pos: [rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6],
    vel: [rng() * 20 - 10, rng() * 20 - 10, rng() * 20 - 10],
    acc: [0, 0, 0],
    col: [rng(), rng(), rng(), rng()],
    size: 0.2 + rng(),
    alpha: rng(),
    mass: 2 + rng() * 4,
    life: rng() * 2,
    maxLife: 5,
    heat: rng() * 10,
    alive: true,
  };
}
