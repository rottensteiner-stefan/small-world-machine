import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import { Vector3D } from "../../math/index.js";
import type { CameraInterfaceData } from "../../interfaces/index.js";

/**
 * Applies a brief, volume-preserving-ish squash-and-stretch impulse to an object's scale,
 * driven by a damped spring so it overshoots and settles back to the base scale — the classic
 * "game feel" cue for landings, launches, and impacts.
 */
export class SquashStretchBehavior extends Behavior {
  public stiffness: number;
  public damping: number;

  private readonly _baseScale: Vector3D = new Vector3D(1, 1, 1);
  private _offset: number = 0;
  private _velocity: number = 0;

  /**
   * @param stiffness Spring stiffness driving the scale back to normal. Higher = snappier. Default 220.
   * @param damping Spring damping. Higher = less overshoot/oscillation. Default 14.
   */
  constructor(stiffness: number = 220, damping: number = 14) {
    super();
    this.stiffness = stiffness;
    this.damping = damping;
  }

  /** @inheritdoc */
  public override onAttach(target: Object3D | CameraInterfaceData): void {
    super.onAttach(target);
    if (target instanceof Object3D) {
      this._baseScale.copyFrom(target.scale);
    }
  }

  /**
   * Triggers a squash-and-stretch impulse.
   * @param intensity Squash amount along Y (0 = none, 1 = fully flattened). The object stretches
   * outward on X/Z by roughly half of that to read as volume-preserving. Default 0.35.
   */
  public trigger(intensity: number = 0.35): void {
    this._offset = intensity;
    this._velocity = 0;
  }

  /** @inheritdoc */
  public override update(deltaTime: number): void {
    if (!(this.target instanceof Object3D)) {
      return;
    }

    const force: number = -this.stiffness * this._offset - this.damping * this._velocity;
    this._velocity += force * deltaTime;
    this._offset += this._velocity * deltaTime;

    if (0.001 > Math.abs(this._offset) && 0.001 > Math.abs(this._velocity)) {
      this._offset = 0;
      this._velocity = 0;
    }

    this.target.scale.x = this._baseScale.x * (1 + 0.5 * this._offset);
    this.target.scale.y = this._baseScale.y * (1 - this._offset);
    this.target.scale.z = this._baseScale.z * (1 + 0.5 * this._offset);
  }
}
