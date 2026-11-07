import { Behavior } from "./Behavior.js";
import type { Object3D } from "../index.js";
import { StandardMaterial, CustomShaderMaterial } from "../materials/index.js";
import type { Color } from "../colors/index.js";

export interface EmissivePulseOptions {
  /** The base emissive intensity. Defaults to 0.2. */
  baseIntensity?: number;
  /** The speed of the heartbeat pulse. Defaults to 4.0. */
  pulseSpeed?: number;
  /** The maximum amplitude of the pulse. Defaults to 2.0. */
  pulseAmplitude?: number;
}

/**
 * A generic behavior that makes the emissive property of an object's material
 * pulsate in a "heartbeat" rhythm. It automatically modulates StandardMaterial
 * or CustomShaderMaterials that expose an emissive parameter.
 */
export class EmissivePulseBehavior extends Behavior {
  public baseIntensity: number;
  public pulseSpeed: number;
  public pulseAmplitude: number;

  private _time: number = 0;

  constructor(options: EmissivePulseOptions = {}) {
    super();
    this.baseIntensity = options.baseIntensity ?? 0.2;
    this.pulseSpeed = options.pulseSpeed ?? 4.0;
    this.pulseAmplitude = options.pulseAmplitude ?? 2.0;
  }

  public override update(deltaTime: number): void {
    if (!this.target) return;
    const obj = this.target as Object3D;
    const mat = obj.material;

    if (!mat) return;

    this._time += deltaTime;

    // Heartbeat math: double peak per cycle
    const hb1 = Math.max(0.0, Math.sin(this._time * this.pulseSpeed));
    const hb2 = Math.max(0.0, Math.sin(this._time * this.pulseSpeed + 0.5));
    const heartbeat = Math.pow(hb1, 12.0) + Math.pow(hb2, 12.0) * 0.5;

    const finalIntensity = this.baseIntensity + heartbeat * this.pulseAmplitude;

    // Apply to standard material
    if (mat instanceof StandardMaterial) {
      mat.emissiveIntensity = finalIntensity;
    }
    // Apply to our custom shader fallback (u_specColor.a contains intensity)
    else if (mat instanceof CustomShaderMaterial && mat.properties["u_specColor"]) {
      const color = mat.properties["u_specColor"] as Color;
      // We assume the alpha channel of u_specColor maps to emissive intensity
      // based on our CustomShaderMaterial conventions.
      color.a = finalIntensity;
    }
  }
}
