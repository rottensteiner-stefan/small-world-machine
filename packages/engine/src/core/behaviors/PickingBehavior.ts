import { Behavior } from "./Behavior.js";
import type { Vector3D } from "../../math/index.js";
import type { Ray } from "../../physix/index.js";

/**
 * Holds an Object3D's pointer-event handlers. Not constructed directly by user code --
 * Object3D lazily creates and attaches one the first time onPointerDown/onPointerUp/onPointerMove
 * is assigned; its own getters/setters delegate here.
 */
export class PickingBehavior extends Behavior {
  public onPointerDown?: ((ray: Ray, intersectionPoint: Vector3D) => void) | undefined;
  public onPointerUp?: (() => void) | undefined;
  public onPointerMove?: ((ray: Ray) => void) | undefined;

  public update(_deltaTime: number): void {
    // Event-driven by pointer input; no per-frame logic (same pattern as DraggableBehavior).
  }
}
