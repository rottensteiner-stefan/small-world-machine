import { Behavior } from "./Behavior.js";
import type { Object3D } from "../index.js";

/**
 * Configuration options for the PulsatingBehavior.
 */
export interface PulsatingBehaviorOptions {
  /** Minimum value of the pulsation. Defaults to 0.0. */
  min?: number;
  /** Maximum value of the pulsation. Defaults to 1.0. */
  max?: number;
  /** Minimum duration of one full pulsation cycle in seconds. Defaults to 2.0. */
  minDuration?: number;
  /** Maximum duration of one full pulsation cycle in seconds. Defaults to 5.0. */
  maxDuration?: number;
  /** The callback that applies the pulsating value. */
  onUpdate: (value: number, targetObj: Object3D) => void;
}

/**
 * A generic behavior that generates a pulsating value (sine wave) over time
 * and applies it via a callback function.
 */
export class PulsatingBehavior extends Behavior {
  public min: number;
  public max: number;
  public minDuration: number;
  public maxDuration: number;
  public onUpdate: (value: number, targetObj: Object3D) => void;

  private _time: number = 0;
  private _currentDuration: number = 0;
  private _randomOffset: number = 0;

  /**
   * Creates a new PulsatingBehavior.
   * @param options Configuration options.
   */
  constructor(options: PulsatingBehaviorOptions) {
    super();
    this.min = options.min ?? 0.0;
    this.max = options.max ?? 1.0;
    this.minDuration = options.minDuration ?? 2.0;
    this.maxDuration = options.maxDuration ?? 5.0;
    this.onUpdate = options.onUpdate;

    // Pick a random duration within the range for this specific instance
    this._currentDuration =
      this.minDuration + Math.random() * (this.maxDuration - this.minDuration);

    // Add a random time offset so multiple instances don't pulse synchronously
    this._randomOffset = Math.random() * Math.PI * 2;
  }

  public update(deltaTime: number): void {
    if (!this.target) return;

    this._time += deltaTime;

    // Calculate phase based on the current duration, including the random offset
    const phase = (this._time / this._currentDuration) * Math.PI * 2 + this._randomOffset;

    // Sine wave from -1 to 1
    const sineVal = Math.sin(phase);

    // Map -1..1 to 0..1
    const normalized = (sineVal + 1.0) * 0.5;

    // Map to min..max
    const finalValue = this.min + normalized * (this.max - this.min);

    // Pass the value to the callback
    this.onUpdate(finalValue, this.target as Object3D);
  }
}
