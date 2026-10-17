import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";

/**
 * Makes an object bob up and down on the Y-axis using a sine wave.
 * Ideal for floating power-ups, boats, or hovering items.
 */
export class BobbingBehavior extends Behavior {
  public amplitude: number;
  public frequency: number;
  private _time: number = 0;
  private _startY: number = 0;
  private _isInitialized: boolean = false;

  /**
   * @param amplitude How high/low the object bobs (in world units).
   * @param frequency How fast the object bobs.
   */
  constructor(amplitude: number = 0.5, frequency: number = 2.0) {
    super();
    this.amplitude = amplitude;
    this.frequency = frequency;
  }

  public override update(deltaTime: number): void {
    if (this.target && this.target instanceof Object3D) {
      if (!this._isInitialized) {
        this._startY = this.target.position.y;
        this._isInitialized = true;
      }
      this._time += deltaTime;
      this.target.position.y =
        this._startY + Math.sin(this._time * this.frequency) * this.amplitude;
    }
  }
}
