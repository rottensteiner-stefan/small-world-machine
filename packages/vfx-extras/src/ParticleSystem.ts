import type { ParticleOptions } from "./Particle.js";
import { Particle } from "./Particle.js";
import type { ParticleAffector } from "./ParticleAffector.js";

export interface ParticleSystemOptions {
  /** Maximum number of particles in the pool. Defaults to 1000. */
  capacity?: number;
  /** Initial affectors attached to the system. */
  affectors?: ParticleAffector[];
  /** Optional callback when a particle dies or exceeds its maxLife. */
  onParticleDied?: (particle: Particle, index: number) => void;
}

/**
 * Manages simulation, integration, pooling, and affector pipelines for particles.
 */
export class ParticleSystem {
  public particles: Particle[] = [];
  public affectors: ParticleAffector[] = [];
  public capacity: number;
  public onParticleDied: ((particle: Particle, index: number) => void) | undefined;

  /** Dead particle slots ready for reuse by emit(), replacing a per-emit O(n) scan. */
  private _freeIndices: number[] = [];
  /** Per-frame marker, reused across ticks (zero allocation): 1 = survived the life check this frame. */
  private _frameFlags: Uint8Array;

  constructor(options: ParticleSystemOptions = {}) {
    this.capacity = options.capacity ?? 1000;
    this._frameFlags = new Uint8Array(this.capacity);
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
   * Spawns or recycles a particle with the given options.
   */
  public emit(options: ParticleOptions = {}): Particle | null {
    if (this.particles.length >= this.capacity) {
      const free = this._freeIndices;
      if (free.length > 0) {
        const p = this.particles[free.pop()!]!;
        p.reset(options);
        return p;
      }
      return null;
    }

    const p = new Particle(options);
    this.particles.push(p);
    return p;
  }

  /**
   * Updates all particles for one frame / tick.
   * @param dt Delta time in seconds.
   */
  public update(dt: number): void {
    const particles = this.particles;
    const affectors = this.affectors;
    const total = particles.length;

    // Per-frame hook for time-dependent state (must not accumulate per particle).
    for (let a = 0; a < affectors.length; a++) {
      affectors[a]!.beginFrame?.(dt);
    }

    // Reused per-frame marker (zero allocation). A slot is only processed by later passes when it
    // was alive at the start of this frame, so pre-dead slots are skipped. Life-expired slots are
    // reported to onParticleDied from the integration pass (deferred), because a handler that
    // respawns the particle must not make it visible to the affector passes again this frame.
    const flags = this._frameFlags;
    flags.fill(0);
    const free = this._freeIndices;

    // Life advance + acceleration reset for live particles.
    for (let i = total - 1; i >= 0; i--) {
      const p = particles[i]!;
      if (p.dead) {
        continue;
      }
      flags[i] = 1;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.dead = true;
        continue;
      }
      p.acceleration.set(0, 0, 0);
    }

    // Affectors: one batched call per affector when supported, else the per-particle fallback.
    for (let a = 0; a < affectors.length; a++) {
      const affector = affectors[a]!;
      if (affector.applyBatch !== undefined) {
        affector.applyBatch(particles, total, dt);
        continue;
      }
      for (let i = total - 1; i >= 0; i--) {
        if (flags[i] === 0) {
          continue;
        }
        const p = particles[i]!;
        if (p.dead) {
          continue;
        }
        affector.apply(p, dt, i, total);
      }
    }

    // Integrate velocity and position. A particle killed this frame (life-expired or by an affector)
    // is still integrated and only reported to onParticleDied afterwards, preserving the respawn
    // contract of e.g. AccretionDisk and keeping the free-list index of still-dead slots.
    for (let i = total - 1; i >= 0; i--) {
      if (flags[i] === 0) {
        continue;
      }
      const p = particles[i]!;
      p.velocity.x += p.acceleration.x * dt;
      p.velocity.y += p.acceleration.y * dt;
      p.velocity.z += p.acceleration.z * dt;
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;
      if (p.dead) {
        this.onParticleDied?.(p, i);
        if (p.dead) {
          free.push(i);
        }
      }
    }
  }

  /**
   * Removes all dead particles from the array (compacting the active pool).
   */
  public compact(): void {
    this._freeIndices = [];
    this.particles = this.particles.filter((p) => !p.dead);
  }

  /**
   * Clears all particles.
   */
  public clear(): void {
    this._freeIndices = [];
    this.particles.length = 0;
  }
}
