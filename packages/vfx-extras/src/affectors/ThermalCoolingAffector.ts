import { Color, Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
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

  public apply(arrays: ParticleArrays, index: number, dt: number): void {
    const o = index * 3;
    const dx = arrays.positions[o]! - this.heatCenter.x;
    const dy = arrays.positions[o + 1]! - this.heatCenter.y;
    const dz = arrays.positions[o + 2]! - this.heatCenter.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Compression heating
    if (dist < this.compressionRadius) {
      arrays.heats[index]! += (this.compressionRadius - dist) * this.compressionHeatingRate * dt;
    }

    // Cooling
    arrays.heats[index]! -= this.coolingRate * dt;
    arrays.heats[index] = Math.max(0, Math.min(this.maxHeat, arrays.heats[index]!));

    if (this.updateColor) {
      const t = Math.min(1.0, arrays.heats[index]! / (this.maxHeat * 0.8));
      const c = new Color();
      Color.blackbody(t, c);
      const o4 = index * 4;
      arrays.colors[o4] = c.r;
      arrays.colors[o4 + 1] = c.g;
      arrays.colors[o4 + 2] = c.b;
    }
  }

  public applyBatch(arrays: ParticleArrays, count: number, dt: number): void {
    const centerX = this.heatCenter.x;
    const centerY = this.heatCenter.y;
    const centerZ = this.heatCenter.z;
    const compressionRadius = this.compressionRadius;
    const compressionHeatingRate = this.compressionHeatingRate;
    const coolingRate = this.coolingRate;
    const maxHeat = this.maxHeat;
    const updateColor = this.updateColor;
    const heatColor = new Color();

    for (let i = 0; i < count; i++) {
      if (arrays.aliveFlags[i] === 0) {
        continue;
      }

      const o = i * 3;
      const dx = arrays.positions[o]! - centerX;
      const dy = arrays.positions[o + 1]! - centerY;
      const dz = arrays.positions[o + 2]! - centerZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < compressionRadius) {
        arrays.heats[i]! += (compressionRadius - dist) * compressionHeatingRate * dt;
      }

      arrays.heats[i]! -= coolingRate * dt;
      arrays.heats[i] = Math.max(0, Math.min(maxHeat, arrays.heats[i]!));

      if (updateColor) {
        const t = Math.min(1.0, arrays.heats[i]! / (maxHeat * 0.8));
        Color.blackbody(t, heatColor);
        const c4 = i * 4;
        arrays.colors[c4] = heatColor.r;
        arrays.colors[c4 + 1] = heatColor.g;
        arrays.colors[c4 + 2] = heatColor.b;
      }
    }
  }
}
