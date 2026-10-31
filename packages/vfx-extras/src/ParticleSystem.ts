import type { ParticleOptions, ParticleArrays } from "./Particle.js";
import type { ParticleAffector } from "./ParticleAffector.js";

export interface ParticleSystemOptions {
  /** Maximum number of particles in the pool. Defaults to 1000. */
  capacity?: number;
  /** Initial affectors attached to the system. */
  affectors?: ParticleAffector[];
  /** Optional callback when a particle dies or exceeds its maxLife (index-based). */
  onParticleDied?: (index: number) => void;
}

/**
 * Manages simulation, integration, pooling, and affector pipelines for particles, backed by
 * parallel `Float32Array` fields (structure-of-arrays) -- engine-consistent with
 * `WeatherEmitter` and GPU-upload-ready for instanced/compute rendering. Particle state is
 * addressed by slot index, never by per-particle heap object; `update()` performs zero
 * allocation.
 *
 * Slots are recycled through a free list once the pool is full; `compact()` reclaims dead slots.
 */
export class ParticleSystem {
  /** SoA state buffers, one entry per particle slot index (see `ParticleArrays`). */
  public readonly arrays: ParticleArrays;
  public affectors: ParticleAffector[] = [];
  public readonly capacity: number;
  public onParticleDied: ((index: number) => void) | undefined;

  private _size = 0;
  private _freeIndices: number[] = [];
  /** Per-frame marker, reused across ticks (zero allocation): 1 = survived the life check this frame. */
  private _frameFlags: Uint8Array;

  private readonly _positions: Float32Array;
  private readonly _velocities: Float32Array;
  private readonly _accelerations: Float32Array;
  private readonly _colors: Float32Array;
  private readonly _sizes: Float32Array;
  private readonly _alphas: Float32Array;
  private readonly _masses: Float32Array;
  private readonly _lives: Float32Array;
  private readonly _maxLives: Float32Array;
  private readonly _heats: Float32Array;
  private readonly _aliveFlags: Uint8Array;

  constructor(options: ParticleSystemOptions = {}) {
    this.capacity = options.capacity ?? 1000;
    this._positions = new Float32Array(this.capacity * 3);
    this._velocities = new Float32Array(this.capacity * 3);
    this._accelerations = new Float32Array(this.capacity * 3);
    this._colors = new Float32Array(this.capacity * 4);
    this._sizes = new Float32Array(this.capacity);
    this._alphas = new Float32Array(this.capacity);
    this._masses = new Float32Array(this.capacity);
    this._lives = new Float32Array(this.capacity);
    this._maxLives = new Float32Array(this.capacity);
    this._heats = new Float32Array(this.capacity);
    this._aliveFlags = new Uint8Array(this.capacity);
    this._frameFlags = new Uint8Array(this.capacity);

    this.arrays = {
      positions: this._positions,
      velocities: this._velocities,
      accelerations: this._accelerations,
      colors: this._colors,
      sizes: this._sizes,
      alphas: this._alphas,
      masses: this._masses,
      lives: this._lives,
      maxLives: this._maxLives,
      heats: this._heats,
      aliveFlags: this._aliveFlags,
    };

    if (options.affectors) {
      this.affectors.push(...options.affectors);
    }
    this.onParticleDied = options.onParticleDied;
  }

  /**
   * Adds an affector / force field modifier to the simulation pipeline.
   */
  public addAffector(affector: ParticleAffector): this {
    this.affectors.push(affector);
    return this;
  }

  /**
   * Removes an affector from the pipeline.
   */
  public removeAffector(affector: ParticleAffector): boolean {
    const idx = this.affectors.indexOf(affector);
    if (idx !== -1) {
      this.affectors.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Number of slots currently allocated (issued by `emit`, pending reclamation by `compact()`).
   */
  public get activeCount(): number {
    return this._size;
  }

  /**
   * Whether the given slot is currently a live particle.
   */
  public isAlive(index: number): boolean {
    return index >= 0 && index < this._size && this._aliveFlags[index] === 1;
  }

  /**
   * Spawns or recycles a particle with the given options.
   * @returns The slot index of the spawned particle, or -1 when the pool is full.
   */
  public emit(options: ParticleOptions = {}): number {
    let index: number;
    if (this._size >= this.capacity) {
      const free = this._freeIndices;
      if (free.length <= 0) {
        return -1;
      }
      index = free.pop()!;
    } else {
      index = this._size++;
    }
    this._applyOptions(index, options);
    return index;
  }

  /** Writes `options` into the SoA buffers of the given slot and marks it alive. */
  private _applyOptions(index: number, options: ParticleOptions): void {
    const o = index * 3;
    const c = index * 4;

    const pos = options.position;
    if (pos) {
      this._positions[o] = pos.x;
      this._positions[o + 1] = pos.y;
      this._positions[o + 2] = pos.z;
    } else {
      this._positions[o] = 0;
      this._positions[o + 1] = 0;
      this._positions[o + 2] = 0;
    }

    const vel = options.velocity;
    if (vel) {
      this._velocities[o] = vel.x;
      this._velocities[o + 1] = vel.y;
      this._velocities[o + 2] = vel.z;
    } else {
      this._velocities[o] = 0;
      this._velocities[o + 1] = 0;
      this._velocities[o + 2] = 0;
    }

    const acc = options.acceleration;
    if (acc) {
      this._accelerations[o] = acc.x;
      this._accelerations[o + 1] = acc.y;
      this._accelerations[o + 2] = acc.z;
    } else {
      this._accelerations[o] = 0;
      this._accelerations[o + 1] = 0;
      this._accelerations[o + 2] = 0;
    }

    const col = options.color;
    if (col) {
      this._colors[c] = col.r;
      this._colors[c + 1] = col.g;
      this._colors[c + 2] = col.b;
      this._colors[c + 3] = col.a;
    } else {
      this._colors[c] = 1;
      this._colors[c + 1] = 1;
      this._colors[c + 2] = 1;
      this._colors[c + 3] = 1;
    }

    this._sizes[index] = options.size ?? 1.0;
    this._alphas[index] = options.alpha ?? 1.0;
    this._masses[index] = options.mass ?? 1.0;
    this._lives[index] = options.life ?? 0;
    this._maxLives[index] = options.maxLife ?? Infinity;
    this._heats[index] = options.heat ?? 0;
    this._aliveFlags[index] = 1;
  }

  /**
   * Updates all particles for one frame / tick.
   * @param dt Delta time in seconds.
   */
  public update(dt: number): void {
    const arrays = this.arrays;
    const affectors = this.affectors;
    const total = this._size;
    const flags = this._frameFlags;
    const free = this._freeIndices;

    // Per-frame hook for time-dependent state (must not accumulate per particle).
    for (let a = 0; a < affectors.length; a++) {
      affectors[a]!.beginFrame?.(dt);
    }

    // Reused per-frame marker (zero allocation). A slot is only processed by later passes when it
    // was alive at the start of this frame, so pre-dead slots are skipped. Life-expired slots are
    // reported to onParticleDied from the integration pass (deferred), because a handler that
    // respawns the particle must not make it visible to the affector passes again this frame.
    flags.fill(0);

    // Life advance + acceleration reset for live slots.
    for (let i = total - 1; i >= 0; i--) {
      if (arrays.aliveFlags[i] === 0) {
        continue;
      }
      flags[i] = 1;
      arrays.lives[i] = arrays.lives[i]! + dt;
      if (arrays.lives[i]! >= arrays.maxLives[i]!) {
        arrays.aliveFlags[i] = 0;
        continue;
      }
      const o = i * 3;
      arrays.accelerations[o] = 0;
      arrays.accelerations[o + 1] = 0;
      arrays.accelerations[o + 2] = 0;
    }

    // Affectors: one batched call per affector when supported, else the per-slot fallback.
    for (let a = 0; a < affectors.length; a++) {
      const affector = affectors[a]!;
      if (affector.applyBatch !== undefined) {
        affector.applyBatch(arrays, total, dt);
        continue;
      }
      for (let i = total - 1; i >= 0; i--) {
        if (flags[i] === 0 || arrays.aliveFlags[i] === 0) {
          continue;
        }
        affector.apply(arrays, i, dt);
      }
    }

    // Integrate velocity and position. A slot killed this frame (life-expired or by an affector)
    // is still integrated and only reported to onParticleDied afterwards, preserving the respawn
    // contract of e.g. AccretionDisk and keeping the free-list index of still-dead slots.
    for (let i = total - 1; i >= 0; i--) {
      if (flags[i] === 0) {
        continue;
      }
      const o = i * 3;
      arrays.velocities[o] = arrays.velocities[o]! + arrays.accelerations[o]! * dt;
      arrays.velocities[o + 1] = arrays.velocities[o + 1]! + arrays.accelerations[o + 1]! * dt;
      arrays.velocities[o + 2] = arrays.velocities[o + 2]! + arrays.accelerations[o + 2]! * dt;
      arrays.positions[o] = arrays.positions[o]! + arrays.velocities[o]! * dt;
      arrays.positions[o + 1] = arrays.positions[o + 1]! + arrays.velocities[o + 1]! * dt;
      arrays.positions[o + 2] = arrays.positions[o + 2]! + arrays.velocities[o + 2]! * dt;
      if (arrays.aliveFlags[i] === 0) {
        this.onParticleDied?.(i);
        if (arrays.aliveFlags[i] === 0) {
          free.push(i);
        }
      }
    }

    // Post-integration hook for position-correcting affectors (e.g. SDF collision push-out),
    // invoked after integration so corrected state is final for the frame.
    for (let a = 0; a < affectors.length; a++) {
      affectors[a]!.postIntegrate?.(arrays, total, dt);
    }
  }

  /**
   * Removes all dead slots from the pool, compacting live particles to the lowest indices.
   */
  public compact(): void {
    this._freeIndices = [];
    const current = this._size;
    let write = 0;
    for (let i = 0; i < current; i++) {
      if (this._aliveFlags[i] === 0) {
        continue;
      }
      if (write !== i) {
        const srcO = i * 3;
        const dstO = write * 3;
        this._positions[dstO] = this._positions[srcO]!;
        this._positions[dstO + 1] = this._positions[srcO + 1]!;
        this._positions[dstO + 2] = this._positions[srcO + 2]!;
        this._velocities[dstO] = this._velocities[srcO]!;
        this._velocities[dstO + 1] = this._velocities[srcO + 1]!;
        this._velocities[dstO + 2] = this._velocities[srcO + 2]!;
        this._accelerations[dstO] = this._accelerations[srcO]!;
        this._accelerations[dstO + 1] = this._accelerations[srcO + 1]!;
        this._accelerations[dstO + 2] = this._accelerations[srcO + 2]!;

        const srcC = i * 4;
        const dstC = write * 4;
        this._colors[dstC] = this._colors[srcC]!;
        this._colors[dstC + 1] = this._colors[srcC + 1]!;
        this._colors[dstC + 2] = this._colors[srcC + 2]!;
        this._colors[dstC + 3] = this._colors[srcC + 3]!;

        this._sizes[write] = this._sizes[i]!;
        this._alphas[write] = this._alphas[i]!;
        this._masses[write] = this._masses[i]!;
        this._lives[write] = this._lives[i]!;
        this._maxLives[write] = this._maxLives[i]!;
        this._heats[write] = this._heats[i]!;

        this._aliveFlags[write] = 1;
        this._aliveFlags[i] = 0;
      }
      write++;
    }
    for (let i = write; i < this.capacity; i++) {
      this._aliveFlags[i] = 0;
    }
    this._size = write;
  }

  /**
   * Clears all particles.
   */
  public clear(): void {
    this._freeIndices = [];
    this._size = 0;
    this._aliveFlags.fill(0);
    this._frameFlags.fill(0);
  }
}
