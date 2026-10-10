import { Vector3D, Color } from "@small-world-machine/engine";

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
 * A simulated individual particle in a ParticleSystem.
 */
export class Particle {
  public position: Vector3D;
  public velocity: Vector3D;
  public acceleration: Vector3D;
  public color: Color;
  public size: number;
  public alpha: number;
  public mass: number;
  public life: number;
  public maxLife: number;
  public heat: number;
  public dead: boolean = false;

  constructor(options: ParticleOptions = {}) {
    this.position = options.position?.clone() ?? new Vector3D(0, 0, 0);
    this.velocity = options.velocity?.clone() ?? new Vector3D(0, 0, 0);
    this.acceleration = options.acceleration?.clone() ?? new Vector3D(0, 0, 0);
    this.color = options.color?.clone() ?? new Color(1, 1, 1, 1);
    this.size = options.size ?? 1.0;
    this.alpha = options.alpha ?? 1.0;
    this.mass = options.mass ?? 1.0;
    this.life = options.life ?? 0;
    this.maxLife = options.maxLife ?? Infinity;
    this.heat = options.heat ?? 0;
  }

  public reset(options: ParticleOptions = {}): void {
    if (options.position) this.position.copyFrom(options.position);
    else this.position.set(0, 0, 0);

    if (options.velocity) this.velocity.copyFrom(options.velocity);
    else this.velocity.set(0, 0, 0);

    if (options.acceleration) this.acceleration.copyFrom(options.acceleration);
    else this.acceleration.set(0, 0, 0);

    if (options.color) this.color.copyFrom(options.color);
    else this.color.set(1, 1, 1, 1);

    this.size = options.size ?? 1.0;
    this.alpha = options.alpha ?? 1.0;
    this.mass = options.mass ?? 1.0;
    this.life = options.life ?? 0;
    this.maxLife = options.maxLife ?? Infinity;
    this.heat = options.heat ?? 0;
    this.dead = false;
  }
}
