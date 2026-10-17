import type { Particle } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface TurbulenceOptions {
  /** Frequency / spatial scale of the turbulence field. Defaults to 1.0. */
  frequency?: number;
  /** Force amplitude / speed of the turbulent gusts. Defaults to 5.0. */
  strength?: number;
  /** Evolution speed of the noise field over time. Defaults to 1.0. */
  evolutionSpeed?: number;
}

/**
 * Generates continuous pseudo-fluid rotational turbulence (divergence-free curl approximations)
 * for realistic smoke, dust clouds, flames, and energetic plasma.
 */
export class TurbulenceAffector implements ParticleAffector {
  public frequency: number;
  public strength: number;
  public evolutionSpeed: number;
  private _time: number = 0;

  constructor(options: TurbulenceOptions = {}) {
    this.frequency = options.frequency ?? 1.0;
    this.strength = options.strength ?? 5.0;
    this.evolutionSpeed = options.evolutionSpeed ?? 1.0;
  }

  public apply(particle: Particle, _dt: number): void {
    const f = this.frequency;
    const t = this._time;

    const px = particle.position.x * f;
    const py = particle.position.y * f;
    const pz = particle.position.z * f;

    // Fast trigonometric curl approximation (divergence-free curl-noise field)
    const fx = Math.sin(py + t) * Math.cos(pz + t * 0.7);
    const fy = Math.sin(pz + t) * Math.cos(px + t * 0.7);
    const fz = Math.sin(px + t) * Math.cos(py + t * 0.7);

    particle.acceleration.x += (fx * this.strength) / particle.mass;
    particle.acceleration.y += (fy * this.strength) / particle.mass;
    particle.acceleration.z += (fz * this.strength) / particle.mass;
  }

  public applyBatch(particles: readonly Particle[], count: number, _dt: number): void {
    const t = this._time;
    const f = this.frequency;
    const strength = this.strength;

    for (let i = 0; i < count; i++) {
      const particle = particles[i]!;
      if (particle.dead) {
        continue;
      }

      const px = particle.position.x * f;
      const py = particle.position.y * f;
      const pz = particle.position.z * f;

      const fx = Math.sin(py + t) * Math.cos(pz + t * 0.7);
      const fy = Math.sin(pz + t) * Math.cos(px + t * 0.7);
      const fz = Math.sin(px + t) * Math.cos(py + t * 0.7);

      particle.acceleration.x += (fx * strength) / particle.mass;
      particle.acceleration.y += (fy * strength) / particle.mass;
      particle.acceleration.z += (fz * strength) / particle.mass;
    }
  }

  public beginFrame(dt: number): void {
    this._time += dt * this.evolutionSpeed;
  }
}
