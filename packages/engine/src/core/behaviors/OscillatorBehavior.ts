import type { InspectorField } from "./Behavior.js";
import { Behavior } from "./Behavior.js";
import { OscillatorType } from "../../enums/index.js";
import { Noise } from "../../utils/index.js";

/**
 * Configuration options for the OscillatorBehavior.
 */
export interface OscillatorOptions {
  /** The mathematical function to use. Defaults to SINE. */
  type?: OscillatorType;
  /** How strong the oscillation is. Defaults to 1.0. */
  amplitude?: number;
  /** How fast the oscillation is. Defaults to 1.0. */
  frequency?: number;
  /** The base value offset. Defaults to 0.0. */
  offset?: number;
  /**
   * Callback executed every frame with the new oscillating value.
   * This is where you apply the value to your target (e.g. position, scale, intensity).
   */
  onUpdate: (value: number, deltaTime: number) => void;
}

/**
 * A generalized behavior that encapsulates mathematical oscillation (Sine, Noise, etc.).
 * It does not know *what* it is animating, it only generates a value and calls the `onUpdate` callback.
 */
export class OscillatorBehavior extends Behavior {
  public static override readonly inspector: Record<string, InspectorField> = {
    type: {
      type: "choice",
      label: "Type",
      options: {
        Sine: OscillatorType.SINE,
        Cosine: OscillatorType.COSINE,
        Noise: OscillatorType.NOISE,
      },
    },
    amplitude: { type: "number", min: 0, max: 20, step: 0.1, label: "Amplitude" },
    frequency: { type: "number", min: 0, max: 50, step: 0.1, label: "Frequency" },
    offset: { type: "number", min: -100, max: 100, step: 0.5, label: "Offset" },
  };

  public type: OscillatorType;
  public amplitude: number;
  public frequency: number;
  public offset: number;
  public onUpdate: (value: number, deltaTime: number) => void;

  private _time: number = 0;

  /**
   * Creates a new OscillatorBehavior.
   * @param options Configuration options including the mandatory `onUpdate` callback.
   */
  constructor(options: OscillatorOptions) {
    super();
    this.type = options.type ?? OscillatorType.DEFAULT;
    this.amplitude = options.amplitude ?? 1.0;
    this.frequency = options.frequency ?? 1.0;
    this.offset = options.offset ?? 0.0;
    this.onUpdate = options.onUpdate;
  }

  public override update(deltaTime: number): void {
    if (!this.target) return;

    this._time += deltaTime;
    let val = 0;

    switch (this.type) {
      case OscillatorType.SINE:
        val = Math.sin(this._time * this.frequency) * this.amplitude;
        break;
      case OscillatorType.COSINE:
        val = Math.cos(this._time * this.frequency) * this.amplitude;
        break;
      case OscillatorType.NOISE:
        // Use Simplex Noise for a smooth but unpredictable organic value
        val = Noise.simplex2(this._time * this.frequency, 0) * this.amplitude;
        break;
    }

    // Pass the calculated value back to the user
    this.onUpdate(this.offset + val, deltaTime);
  }
}
