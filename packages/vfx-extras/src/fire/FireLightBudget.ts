import type { CameraInterfaceData, PointLight } from "@small-world-machine/engine";
import { Behavior, Vector3D } from "@small-world-machine/engine";
import type { FireLightBehavior } from "./FireLightBehavior.js";

/** Rank offset for lights whose whole range lies behind the camera: picked only if slots remain. */
const BEHIND_CAMERA_PENALTY = 1e12;

/**
 * Configuration options for {@link FireLightBudget}.
 */
export interface FireLightBudgetOptions {
  /** How many fires may light the scene at once. Defaults to 8. */
  maxActive?: number | undefined;
  /** Seconds a light takes to fade fully in or out when it enters or leaves the budget. Defaults to 0.5. */
  fadeTime?: number | undefined;
}

/**
 * Keeps only the fires nearest to the camera as real point lights; the rest keep their flame and
 * glow but drop out of the light list (`isVisible = false`). WebGL1/WebGL2 shade only the first 16
 * point lights in scene order, so twenty wall torches would otherwise silently lose the farthest
 * ones at random. Lights fade over {@link fadeTime} instead of popping. Attach to the camera.
 */
export class FireLightBudget extends Behavior<CameraInterfaceData> {
  /** @domain maximum simultaneously lit fires (>=0); leave headroom for non-fire lights on WebGL. */
  public maxActive: number;
  /** @domain fade duration in seconds (>0). */
  public fadeTime: number;

  private readonly _fires: FireLightBehavior[] = [];
  private _distances: Float32Array = new Float32Array(0);
  private _selected: Uint8Array = new Uint8Array(0);
  private readonly _scratch: Vector3D = new Vector3D(0, 0, 0);
  private readonly _forward: Vector3D = new Vector3D(0, 0, 0);

  constructor(options: FireLightBudgetOptions = {}) {
    super();
    this.maxActive = options.maxActive ?? 8;
    this.fadeTime = options.fadeTime ?? 0.5;
  }

  /** Number of registered fires. */
  public get count(): number {
    return this._fires.length;
  }

  /**
   * Puts a fire light under budget control. Not for the frame loop (grows scratch buffers).
   */
  public register(fire: FireLightBehavior): void {
    if (this._fires.includes(fire)) {
      return;
    }
    this._fires.push(fire);
    this._distances = new Float32Array(this._fires.length);
    this._selected = new Uint8Array(this._fires.length);
  }

  /**
   * Releases a fire from budget control and restores it to fully lit.
   */
  public unregister(fire: FireLightBehavior): void {
    const index = this._fires.indexOf(fire);
    if (index < 0) {
      return;
    }
    this._fires.splice(index, 1);
    fire.fade = 1;
    const light = fire.light;
    if (light) {
      light.isVisible = true;
    }
  }

  // Distance ranks the fires, but a light whose whole range sphere lies behind the camera cannot
  // reach anything visible, so it only gets a slot after every fire that can. Lights just behind
  // the camera still rank normally: they light the wall in front of it.
  private _rank(
    light: PointLight | undefined,
    cameraPosition: Vector3D,
    forward: Vector3D,
    hasForward: boolean,
  ): number {
    if (!light) {
      return Infinity;
    }
    const offset = light.getWorldPosition(this._scratch).sub(cameraPosition);
    const distanceSq = offset.lengthSq();
    if (hasForward && offset.dot(forward) < -light.distance) {
      return BEHIND_CAMERA_PENALTY + distanceSq;
    }
    return distanceSq;
  }

  /** @inheritdoc */
  public update(deltaTime: number): void {
    const camera = this.target;
    if (!camera) {
      return;
    }
    const fires = this._fires;
    const count = fires.length;
    const distances = this._distances;
    const selected = this._selected;

    const forward = this._forward.copyFrom(camera.target).sub(camera.position);
    const forwardLength = forward.length();
    if (forwardLength > 1e-6) forward.scale(1 / forwardLength);

    for (let i = 0; i < count; i++) {
      distances[i] = this._rank(fires[i]!.light, camera.position, forward, forwardLength > 1e-6);
      selected[i] = 0;
    }

    // Partial selection: maxActive is small, so repeated min-search beats a sort and allocates nothing.
    const budget = Math.min(this.maxActive, count);
    for (let pick = 0; pick < budget; pick++) {
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < count; i++) {
        if (selected[i] === 0 && distances[i]! < bestDistance) {
          best = i;
          bestDistance = distances[i]!;
        }
      }
      if (best < 0) {
        break;
      }
      selected[best] = 1;
    }

    const step = this.fadeTime > 0 ? deltaTime / this.fadeTime : 1;
    for (let i = 0; i < count; i++) {
      const fire = fires[i]!;
      const fade =
        selected[i] === 1 ? Math.min(1, fire.fade + step) : Math.max(0, fire.fade - step);
      fire.fade = fade;
      const light = fire.light;
      if (light) {
        light.isVisible = fade > 0;
      }
    }
  }
}
