import { Color, Vector3D } from "@small-world-machine/engine";
import type { Particle } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface ThermalCoolingOptions {
  /** Cooling rate per second in vacuum. Defaults to 1.5. */
  coolingRate?: number;
  /** Proximity heat center (e.g. singularity position). Defaults to (0, 0, 0). */
  heatCenter?: Vector3D;
  /** Distance threshold within which compression heating occurs. Defaults to 1.0. */
  compressionRadius?: number;
  /** Heat generation rate near center. Defaults to 10.0. */
  compressionHeatingRate?: number;
  /** Maximum heat value. Defaults to 10.0. */
  maxHeat?: number;
  /** If true, maps particle.heat to particle.color via Color.blackbody. Defaults to true. */
  updateColor?: boolean;
}

/**
 * Simulates thermodynamic heating near a singularity/core and radiative cooling in space.
 * Updates particle.heat and maps it to a blackbody radiation color ramp.
 */
export class ThermalCoolingAffector implements ParticleAffector {
  public coolingRate: number;
  public heatCenter: Vector3D;
  public compressionRadius: number;
  public compressionHeatingRate: number;
  public maxHeat: number;
  public updateColor: boolean;

  constructor(options: ThermalCoolingOptions = {}) {
    this.coolingRate = options.coolingRate ?? 1.5;
    this.heatCenter = options.heatCenter?.clone() ?? new Vector3D(0, 0, 0);
    this.compressionRadius = options.compressionRadius ?? 1.0;
    this.compressionHeatingRate = options.compressionHeatingRate ?? 10.0;
    this.maxHeat = options.maxHeat ?? 10.0;
    this.updateColor = options.updateColor ?? true;
  }

  public apply(particle: Particle, dt: number): void {
    const dx = particle.position.x - this.heatCenter.x;
    const dy = particle.position.y - this.heatCenter.y;
    const dz = particle.position.z - this.heatCenter.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Compression heating
    if (dist < this.compressionRadius) {
      particle.heat += (this.compressionRadius - dist) * this.compressionHeatingRate * dt;
    }

    // Cooling
    particle.heat -= this.coolingRate * dt;
    particle.heat = Math.max(0, Math.min(this.maxHeat, particle.heat));

    if (this.updateColor) {
      const t = Math.min(1.0, particle.heat / (this.maxHeat * 0.8));
      Color.blackbody(t, particle.color);
    }
  }

  public applyBatch(particles: readonly Particle[], count: number, dt: number): void {
    const centerX = this.heatCenter.x;
    const centerY = this.heatCenter.y;
    const centerZ = this.heatCenter.z;
    const compressionRadius = this.compressionRadius;
    const compressionHeatingRate = this.compressionHeatingRate;
    const coolingRate = this.coolingRate;
    const maxHeat = this.maxHeat;
    const updateColor = this.updateColor;

    for (let i = 0; i < count; i++) {
      const particle = particles[i]!;
      if (particle.dead) {
        continue;
      }

      const dx = particle.position.x - centerX;
      const dy = particle.position.y - centerY;
      const dz = particle.position.z - centerZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < compressionRadius) {
        particle.heat += (compressionRadius - dist) * compressionHeatingRate * dt;
      }

      particle.heat -= coolingRate * dt;
      particle.heat = Math.max(0, Math.min(maxHeat, particle.heat));

      if (updateColor) {
        const t = Math.min(1.0, particle.heat / (maxHeat * 0.8));
        Color.blackbody(t, particle.color);
      }
    }
  }
}
