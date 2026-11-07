import type { Vector3D, Color } from "@small-world-machine/engine";

export interface ParticleOptions {
  position?: Vector3D;
  velocity?: Vector3D;
  acceleration?: Vector3D;
  color?: Color;
  size?: number;
  alpha?: number;
  mass?: number;
  life?: number;
  maxLife?: number;
  heat?: number;
}

/**
 * Parallel (SoA) per-particle state buffers owned by a `ParticleSystem`, laid out for future
 * direct GPU upload: positions/velocities/accelerations are xyz-strided, colors are
 * rgba-strided, one slot per particle index. Affectors and renderers read and write these
 * buffers via particle indices instead of per-particle heap objects.
 */
export interface ParticleArrays {
  /** N*3 (xyz) stride, one entry per particle slot. */
  positions: Float32Array;
  /** N*3 (xyz) stride, one entry per particle slot. */
  velocities: Float32Array;
  /** N*3 (xyz) stride; accumulated by affectors per frame and integrated once by the system. */
  accelerations: Float32Array;
  /** N*4 (rgba) stride, one entry per particle slot. */
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  masses: Float32Array;
  lives: Float32Array;
  maxLives: Float32Array;
  heats: Float32Array;
  /** 1 = live slot, 0 = free/dead slot. */
  aliveFlags: Uint8Array;
}
