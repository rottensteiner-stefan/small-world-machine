import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import { StandardMaterial } from "../materials/index.js";
import { Color } from "../colors/index.js";
import { AbstractLight } from "../lights/index.js";

/**
 * Shifts the color of a Material or Light continuously through the HSL spectrum.
 */
export class RainbowBehavior extends Behavior {
  public speed: number;
  private _hue: number = 0;

  /**
   * @param speed The speed of the color transition (hue shift per second).
   */
  constructor(speed: number = 0.5) {
    super();
    this.speed = speed;
  }

  public override update(deltaTime: number): void {
    this._hue += this.speed * deltaTime;
    if (this._hue > 1.0) this._hue -= 1.0;
    if (this._hue < 0.0) this._hue += 1.0;

    const color = Color.fromHSL(this._hue * 360, 1.0, 0.5);

    if (this.target) {
      if (
        this.target instanceof Object3D &&
        this.target.material &&
        this.target.material instanceof StandardMaterial
      ) {
        this.target.material.color.copyFrom(color);
      } else if (this.target instanceof AbstractLight) {
        this.target.color.copyFrom(color);
      }
    }
  }
}
