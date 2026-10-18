import { Vector3D } from "@small-world-machine/engine";
import { ParticleSystem } from "./ParticleSystem.js";
import { PointAttractorAffector } from "./affectors/PointAttractorAffector.js";
import { PlanarSpringAffector } from "./affectors/PlanarSpringAffector.js";
import { ThermalCoolingAffector } from "./affectors/ThermalCoolingAffector.js";
import { FadeOutZoneAffector } from "./affectors/FadeOutZoneAffector.js";

export interface AccretionDiskOptions {
  /** Total number of particles in the disk. Defaults to 400. */
  particleCount?: number;
  /** Center of the singularity / black hole. Defaults to (0, 0, 0). */
  center?: Vector3D;
  /** Innermost spawning radius of the dense torus. Defaults to 0.6. */
  innerRadius?: number;
  /** Outermost boundary radius of the disk. Defaults to 3.0. */
  outerRadius?: number;
  /** Absorption / Event Horizon radius where particles get swallowed. Defaults to 0.35. */
  eventHorizonRadius?: number;
  /** Outer boundary radius of the gravitational redshift fading zone. Defaults to 0.55. */
  fadeStartRadius?: number;
  /** Singularity gravitational mass (GM). Defaults to particleCount. */
  mass?: number;
  /** Vertical thickness of the accretion disk. Defaults to 0.2. */
  diskThickness?: number;
  /** Orbital velocity multiplier (< 1.0 creates a slow inward spiral). Defaults to 0.98. */
  driftFactor?: number;
}

/**
 * High-level simulation system for a black hole accretion disk with Keplerian orbital
 * velocity, relativistic redshift fading, thermodynamic cooling, and event horizon absorption.
 */
export class AccretionDiskEmitter {
  public system: ParticleSystem;
  public center: Vector3D;
  public innerRadius: number;
  public outerRadius: number;
  public eventHorizonRadius: number;
  public fadeStartRadius: number;
  public mass: number;
  public diskThickness: number;
  public driftFactor: number;

  public attractor: PointAttractorAffector;
  public planarSpring: PlanarSpringAffector;
  public thermal: ThermalCoolingAffector;
  public fadeOut: FadeOutZoneAffector;

  constructor(options: AccretionDiskOptions = {}) {
    const count = options.particleCount ?? 400;
    this.center = options.center?.clone() ?? new Vector3D(0, 0, 0);
    this.innerRadius = options.innerRadius ?? 0.6;
    this.outerRadius = options.outerRadius ?? 3.0;
    this.eventHorizonRadius = options.eventHorizonRadius ?? 0.35;
    this.fadeStartRadius = options.fadeStartRadius ?? 0.55;
    this.mass = options.mass ?? count;
    this.diskThickness = options.diskThickness ?? 0.2;
    this.driftFactor = options.driftFactor ?? 0.98;

    this.attractor = new PointAttractorAffector({
      center: this.center,
      strength: this.mass,
      softening: 0.5,
      plummer: true,
    });

    this.planarSpring = new PlanarSpringAffector({
      axis: "y",
      planePosition: this.center.y,
      stiffness: 2.0,
      damping: 0.5,
    });

    this.thermal = new ThermalCoolingAffector({
      heatCenter: this.center,
      compressionRadius: 1.0,
      coolingRate: 1.5,
      maxHeat: 10.0,
      updateColor: true,
    });

    this.fadeOut = new FadeOutZoneAffector({
      center: this.center,
      fadeStartRadius: this.fadeStartRadius,
      fadeEndRadius: this.eventHorizonRadius,
      shrinkSize: true,
    });

    this.system = new ParticleSystem({
      capacity: count,
      affectors: [this.attractor, this.planarSpring, this.thermal, this.fadeOut],
      onParticleDied: (index: number): void => {
        this.respawnParticle(index);
      },
    });

    this._initParticles(count);
  }

  private _initParticles(count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r =
        this.innerRadius + Math.pow(Math.random(), 2) * (this.outerRadius - this.innerRadius);
      const y = this.center.y + (Math.random() - 0.5) * this.diskThickness;

      const posX = this.center.x + Math.cos(angle) * r;
      const posZ = this.center.z + Math.sin(angle) * r;

      const orbitalSpeed = Math.sqrt(this.mass / r) * this.driftFactor;
      const velX = -Math.sin(angle) * orbitalSpeed;
      const velZ = Math.cos(angle) * orbitalSpeed;

      const baseHeat = Math.max(0, 10.0 - r);
      this.system.emit({
        position: new Vector3D(posX, y, posZ),
        velocity: new Vector3D(velX, (Math.random() - 0.5) * 0.2, velZ),
        heat: baseHeat,
        size: 0.1,
      });
    }
  }

  public respawnParticle(index: number): void {
    const angle = Math.random() * Math.PI * 2;
    const r = this.outerRadius;
    const y = this.center.y + (Math.random() - 0.5) * this.diskThickness;

    const arrays = this.system.arrays;
    const o = index * 3;
    arrays.positions[o] = this.center.x + Math.cos(angle) * r;
    arrays.positions[o + 1] = y;
    arrays.positions[o + 2] = this.center.z + Math.sin(angle) * r;

    const orbitalSpeed = Math.sqrt(this.mass / r) * this.driftFactor;
    arrays.velocities[o] = -Math.sin(angle) * orbitalSpeed;
    arrays.velocities[o + 1] = 0;
    arrays.velocities[o + 2] = Math.cos(angle) * orbitalSpeed;

    arrays.heats[index] = 2.0;
    arrays.sizes[index] = 0.1;
    arrays.alphas[index] = 1.0;
    arrays.lives[index] = 0;
    arrays.maxLives[index] = Infinity;
    arrays.aliveFlags[index] = 1;
  }

  public update(dt: number): void {
    this.system.update(dt);
  }
}
