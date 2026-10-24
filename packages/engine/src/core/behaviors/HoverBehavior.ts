import { Behavior } from "./Behavior.js";
import { Object3D } from "../Object3D.js";
import { StandardMaterial } from "../materials/index.js";

/**
 * A gamification behavior that scales up the object and adds a glow when hovered.
 */
export class HoverBehavior extends Behavior {
  private _targetScale: number = 1.0;
  private _currentScale: number = 1.0;
  private _baseScale: number = 1.0;
  private _hoverMultiplier: number = 1.5;
  /** The exact closures wired onto the target in `onAttach()` -- kept so `onDetach()` can
   * identify-check before clearing `target.onPointerEnter`/`onPointerLeave`, since those are
   * single-slot callbacks another behavior may have overwritten in the meantime. */
  private _onPointerEnter: (() => void) | undefined;
  private _onPointerLeave: (() => void) | undefined;
  /** This behavior's private copy of the target's material, made on the first hover. */
  private _ownMaterial: StandardMaterial | undefined;

  constructor(hoverMultiplier: number = 1.5) {
    super();
    this._hoverMultiplier = hoverMultiplier;
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    target.isPickable = true;
    this._baseScale = target.scale.x;
    this._currentScale = this._baseScale;
    this._targetScale = this._baseScale;

    this._onPointerEnter = (): void => {
      this._targetScale = this._baseScale * this._hoverMultiplier;
      // Copy-on-write: many callers share one material across a large grid, and tinting it
      // would glow every object. Cloning only on the first hover (instead of on attach) keeps
      // never-hovered objects on the shared material, so the renderer can still draw them as
      // one instanced batch. The copy is kept afterwards (e.g. for a later recolor).
      if (target.material instanceof StandardMaterial && target.material !== this._ownMaterial) {
        this._ownMaterial = target.material.clone();
        target.material = this._ownMaterial;
      }
      if (target.material instanceof StandardMaterial) {
        target.material.emissiveColor.set(0.2, 0.5, 1.0); // Glow blue
        target.material.emissiveIntensity = 2.0;
      }
    };

    this._onPointerLeave = (): void => {
      this._targetScale = this._baseScale;
      if (target.material instanceof StandardMaterial) {
        target.material.emissiveColor.set(0, 0, 0); // No glow
        target.material.emissiveIntensity = 1.0;
      }
    };

    target.onPointerEnter = this._onPointerEnter;
    target.onPointerLeave = this._onPointerLeave;
  }

  public override onDetach(): void {
    // The base class only clears `this.target` -- these closures were wired directly onto the
    // Object3D's single-slot pointer callbacks in `onAttach()` and would otherwise keep mutating
    // its material forever, regardless of this behavior's own lifecycle. Identity-check before
    // clearing, since another behavior may have overwritten the slot since we set it.
    if (this.target instanceof Object3D) {
      if (this.target.onPointerEnter === this._onPointerEnter) {
        this.target.onPointerEnter = undefined;
      }
      if (this.target.onPointerLeave === this._onPointerLeave) {
        this.target.onPointerLeave = undefined;
      }
    }
    this._onPointerEnter = undefined;
    this._onPointerLeave = undefined;
    super.onDetach();
  }

  public override update(deltaTime: number): void {
    if (!this.target || !(this.target instanceof Object3D)) return;

    // Smooth dampening for scale
    const diff = this._targetScale - this._currentScale;
    if (Math.abs(diff) > 0.001) {
      this._currentScale += diff * 15.0 * deltaTime;
      this.target.setScale(this._currentScale);
    } else {
      this._currentScale = this._targetScale;
      this.target.setScale(this._currentScale);
    }
  }
}
