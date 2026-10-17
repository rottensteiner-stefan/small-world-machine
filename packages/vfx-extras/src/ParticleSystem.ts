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

  constructor(options: ParticleSystemOptions = {}) {
    this.capacity = options.capacity ?? 1000;
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
      // Find a dead particle to reuse
      const dead = this.particles.find((p) => p.dead);
      if (dead) {
        dead.reset(options);
        return dead;
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
    const total = this.particles.length;

    // Per-frame hook for time-dependent state (must not accumulate per particle).
    for (const affector of this.affectors) {
      affector.beginFrame?.(dt);
    }

    for (let i = total - 1; i >= 0; i--) {
      const p = this.particles[i]!;

      if (p.dead) {
        continue;
      }

      p.life += dt;
      if (p.life >= p.maxLife) {
        p.dead = true;
        this.onParticleDied?.(p, i);
        continue;
      }

      // Reset acceleration for new force accumulation
      p.acceleration.set(0, 0, 0);

      // Apply affectors
      for (const affector of this.affectors) {
        affector.apply(p, dt, i, total);
      }

      // Integrate velocity and position
      p.velocity.x += p.acceleration.x * dt;
      p.velocity.y += p.acceleration.y * dt;
      p.velocity.z += p.acceleration.z * dt;

      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;

      if (p.dead) {
        this.onParticleDied?.(p, i);
      }
    }
  }

  /**
   * Removes all dead particles from the array (compacting the active pool).
   */
  public compact(): void {
    this.particles = this.particles.filter((p) => !p.dead);
  }

  /**
   * Clears all particles.
   */
  public clear(): void {
    this.particles.length = 0;
  }
}
