import { Behavior } from "./Behavior.js";
import type { Camera } from "../index.js";
import { Object3D } from "../Object3D.js";
import { MathPool, Vector3D } from "../../math/index.js";
import type { Ray } from "../../physix/index.js";

/**
 * Allows an object to be dragged around in 3D space.
 * Dragging happens on a plane parallel to the camera view.
 */
export class DraggableBehavior extends Behavior {
  private _camera: Camera;
  private _isDragging: boolean = false;
  private _planeNormal: Vector3D = new Vector3D();
  private _planePoint: Vector3D = new Vector3D();
  private _dragOffset: Vector3D = new Vector3D();
  /** The exact closures wired onto the target in `onAttach()` -- kept so `onDetach()` can
   * identity-check before clearing `target.onPointerDown`/`onPointerUp`/`onPointerMove`, since
   * those are single-slot callbacks another behavior may have overwritten in the meantime (see
   * `HoverBehavior.onDetach()` for the same pattern). */
  private _onPointerDown: ((ray: Ray, intersectionPoint: Vector3D) => void) | undefined;
  private _onPointerUp: (() => void) | undefined;
  private _onPointerMove: ((ray: Ray) => void) | undefined;

  constructor(camera: Camera) {
    super();
    this._camera = camera;
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    target.isPickable = true;

    this._onPointerDown = (_ray: Ray, intersectionPoint: Vector3D): void => {
      this._isDragging = true;

      // Define the drag plane normal (facing the camera)
      // We compute the forward direction from the camera's position and target
      this._planeNormal.copyFrom(this._camera.target).sub(this._camera.position).normalize();

      this._planePoint.copyFrom(target.position);
      this._dragOffset.copyFrom(target.position).sub(intersectionPoint);
    };

    this._onPointerUp = (): void => {
      this._isDragging = false;
    };

    this._onPointerMove = (ray: Ray): void => {
      if (!this._isDragging) return;

      // Intersect ray with the drag plane: (p - p0) . n = 0
      // p = o + t * d
      // (o + t * d - p0) . n = 0
      // t * (d . n) + (o - p0) . n = 0
      // t = (p0 - o) . n / (d . n)

      const denom = ray.direction.dot(this._planeNormal);
      if (Math.abs(denom) > 1e-6) {
        const p0_minus_o = MathPool.acquireVector().copyFrom(this._planePoint).sub(ray.origin);
        const t = p0_minus_o.dot(this._planeNormal) / denom;
        MathPool.releaseVector(p0_minus_o);

        if (t >= 0) {
          const hitPoint = ray.at(t);
          hitPoint.add(this._dragOffset); // maintain the offset where the user clicked
          target.position.copyFrom(hitPoint);
        }
      }
    };

    target.onPointerDown = this._onPointerDown;
    target.onPointerUp = this._onPointerUp;
    target.onPointerMove = this._onPointerMove;
  }

  public override onDetach(): void {
    if (this.target instanceof Object3D) {
      if (this.target.onPointerDown === this._onPointerDown) {
        this.target.onPointerDown = undefined;
      }
      if (this.target.onPointerUp === this._onPointerUp) {
        this.target.onPointerUp = undefined;
      }
      if (this.target.onPointerMove === this._onPointerMove) {
        this.target.onPointerMove = undefined;
      }
    }
    this._onPointerDown = undefined;
    this._onPointerUp = undefined;
    this._onPointerMove = undefined;
    super.onDetach();
  }

  public override update(_deltaTime: number): void {
    // Logic is event-driven by pointers
  }
}
