import type { Object3D } from "../index.js";
import type { CameraInterfaceData } from "../../interfaces/index.js";
import { MathUtils } from "../../math/index.js";
import type { InspectorField } from "../Inspectable.js";
import { shallowCloneWithValueTypes } from "../CloneUtils.js";

/** Re-exported for existing callers that import it from here (e.g. individual Behavior
 * subclasses) -- the canonical definition now lives in `../Inspectable.js`, shared with
 * materials/lights/Object3D. */
export type { InspectorField };

/**
 * Base class for all behaviors attached to an Object3D.
 */
export abstract class Behavior<
  TTarget extends Object3D | CameraInterfaceData = Object3D | CameraInterfaceData,
> {
  public static readonly inspector?: Record<string, InspectorField>;

  public readonly uuid: string = MathUtils.generateUUID();
  public isActive: boolean = true;

  /** The object this behavior is attached to. Set automatically. */
  public target: TTarget | undefined = undefined;

  /**
   * Called when the behavior is attached to an object.
   */
  public onAttach(target: Object3D | CameraInterfaceData): void {
    this.target = target as unknown as TTarget;
  }

  /**
   * Called when the behavior is detached from an object.
   */
  public onDetach(): void {
    this.target = undefined;
  }

  /**
   * Returns an independent copy of this behavior (own `uuid`, `target` cleared -- the caller is
   * expected to `attachBehavior()` it onto the new host, which sets `target` correctly via
   * `onAttach()`). Used by `Object3D.clone()` (Maker's Duplicate command).
   */
  public clone(): Behavior<TTarget> {
    const copy = shallowCloneWithValueTypes(this);
    copy.target = undefined;
    return copy;
  }

  /**
   * Called every frame to update the behavior logic.
   * @param deltaTime The time elapsed since the last frame in seconds.
   */
  public abstract update(deltaTime: number): void;
}

/**
 * Attaches a behavior to a host (Object3D or Camera) and appends it to its
 * behaviors list. Shared by every host so they don't each reimplement the
 * same attach-then-push logic.
 */
export function attachBehavior(
  behaviors: Behavior[],
  behavior: Behavior,
  target: Object3D | CameraInterfaceData,
): void {
  behavior.onAttach(target);
  behaviors.push(behavior);
}

/**
 * Detaches a behavior from a host's behaviors list, if present.
 */
export function detachBehavior(behaviors: Behavior[], behavior: Behavior): void {
  const index: number = behaviors.indexOf(behavior);
  if (-1 !== index) {
    behavior.onDetach();
    behaviors.splice(index, 1);
  }
}
