import { Decal, Quaternion, Vector3D, createDecalShell } from "@small-world-machine/engine";
import type { Object3D } from "@small-world-machine/engine";

/** A surface hit in world space; `normal` is the unit surface normal facing the viewer. */
export interface DecalStampHit {
  point: Vector3D;
  normal: Vector3D;
}

/** What the tool needs from the host (MakerApp); kept structural so it can be tested without an engine. */
export interface DecalStampContext {
  /** Ray-picks the surface under a canvas-relative pointer position (the ghost is not pickable). */
  raycast: (canvasX: number, canvasY: number) => DecalStampHit | undefined;
  /** The ghost lives in the scene root while it follows the mouse. */
  scene: { add: (obj: Object3D) => void; remove: (obj: Object3D) => void };
  /** Loads the kit decal's textures into `decal.material` (KitRegistry.hydrateDecal). */
  hydrate: (decal: Decal) => Promise<boolean>;
  /** Commits a stamped decal as one undo step (MakerApp.addObject). */
  addObject: (decal: Decal) => void;
  /** Translation nudge step in metres, and scale nudge step, following the grid snap. */
  getNudgeStep: () => number;
  getScaleStep: () => number;
  setStatus: (message: string) => void;
}

/** The kit decal being stamped. `kitDecal` is the namespaced id (`kit/id`), `size` is [width, height, depth]. */
export interface ArmedDecal {
  kitDecal: string;
  name: string;
  size: [number, number, number];
}

const SPIN_STEP = Math.PI / 12; // 15 degrees
const GHOST_OPACITY = 0.5;
const MIN_WIDTH = 0.05;
const GHOST_NAME = "DecalStampGhost";

/** Rotates `v` by the unit quaternion `q` (v + 2w(q x v) + 2 q x (q x v)). */
function rotateVector(q: Quaternion, v: Vector3D): Vector3D {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return new Vector3D(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
}

/** Shortest-arc rotation taking the decal's up axis (+Y) onto `normal`. */
export function quaternionFromNormal(normal: Vector3D): Quaternion {
  const len = normal.length();
  if (len < 1e-9) return new Quaternion(0, 0, 0, 1);
  const nx = normal.x / len;
  const ny = normal.y / len;
  const nz = normal.z / len;
  // Antiparallel: the cross product vanishes, any axis in the XZ plane is a valid half-turn.
  if (ny < -0.999999) return new Quaternion(1, 0, 0, 0);
  // axis = Y x n = (nz, 0, -nx), w = 1 + dot(Y, n); normalizing yields the half-angle quaternion.
  const q = new Quaternion(nz, 0, -nx, 1 + ny);
  const qLen = Math.hypot(q.x, q.y, q.z, q.w);
  return new Quaternion(q.x / qLen, q.y / qLen, q.z / qLen, q.w / qLen);
}

/**
 * Orientation of a decal whose +Y is `normal`, additionally spun by `spin` radians about that
 * normal. Returned as the Euler angles (YXZ, like `Object3D.rotation`) so the Maker's gizmo and
 * inspector keep working on the stamped decal; no quaternion is attached to it.
 */
export function decalEulerFromNormal(normal: Vector3D, spin: number): Vector3D {
  const q = quaternionFromNormal(normal);
  q.multiply(new Quaternion(0, Math.sin(spin / 2), 0, Math.cos(spin / 2)));
  return q.toEuler();
}

/**
 * Modal decal stamp tool (ADR 0029, Maker Phase 4b): a ghost decal follows the mouse over the
 * surface, click stamps it. Keys while the mode is on: `R`/`Shift+R` spin by 15 degrees about the
 * surface normal, arrows nudge in the tangent plane, `Shift+arrows` scale, `Esc` leaves. Nudges
 * are relative to the current hit and reset when the mouse moves, so they are for fine-aligning
 * the stamp before clicking.
 */
export class DecalStampTool {
  private _active = false;
  private _armed: ArmedDecal | undefined;
  private _ghost: Decal | undefined;
  private _ghostInScene = false;
  private _hit: DecalStampHit | undefined;
  private _spin = 0;
  private _size: [number, number, number] = [1, 1, 0.5];
  /** Nudge offset along the surface tangent axes (x, z of the unspun decal frame), in metres. */
  private _offsetX = 0;
  private _offsetZ = 0;
  private _button: HTMLButtonElement | undefined;
  /** Bumped on every arm/disable so a slow ghost load can tell it has been superseded. */
  private _generation = 0;
  private _stamping = false;
  private _stampCount = 0;

  constructor(private readonly _ctx: DecalStampContext) {}

  public setButton(button: HTMLButtonElement): void {
    this._button = button;
    this._button.classList.toggle("active", this._active);
  }

  public get isActive(): boolean {
    return this._active;
  }

  public get spin(): number {
    return this._spin;
  }

  public get size(): readonly [number, number, number] {
    return this._size;
  }

  public isGhost(obj: Object3D): boolean {
    return undefined !== this._ghost && obj === this._ghost;
  }

  /** Selects the kit decal to stamp and switches the mode on (ContentDrawer's Decals pill). */
  public arm(decal: ArmedDecal): void {
    this._armed = decal;
    this._size = [...decal.size];
    this._offsetX = 0;
    this._offsetZ = 0;
    this._disposeGhost();
    this._active = true;
    this._syncButton();
    void this._createGhost(++this._generation);
  }

  public toggle(): void {
    if (this._active) this.disable();
    else this._enable();
  }

  public disable(): void {
    if (!this._active) return;
    this._active = false;
    this._generation++;
    this._hit = undefined;
    this._disposeGhost();
    this._syncButton();
  }

  /** @returns Whether the key was consumed (the caller should then skip its own shortcuts). */
  public handleKeyDown(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const key = event.key.toLowerCase();
    if ("d" === key) {
      event.preventDefault();
      this.toggle();
      return true;
    }
    if (!this._active) return false;

    if ("escape" === key) {
      event.preventDefault();
      this.disable();
      return true;
    }
    if ("r" === key) {
      event.preventDefault();
      this._spin += event.shiftKey ? -SPIN_STEP : SPIN_STEP;
      this._updateGhost();
      return true;
    }
    if ("arrowleft" === key || "arrowright" === key || "arrowup" === key || "arrowdown" === key) {
      event.preventDefault();
      if (event.shiftKey) this._scale("arrowright" === key || "arrowup" === key ? 1 : -1);
      else this._nudge(key);
      return true;
    }
    return false;
  }

  public handlePointerMove(canvasX: number, canvasY: number): void {
    if (!this._active) return;
    this._hit = this._ctx.raycast(canvasX, canvasY);
    this._offsetX = 0;
    this._offsetZ = 0;
    this._updateGhost();
  }

  /** The pointer left the canvas: the ghost would otherwise stay frozen on the last hit. */
  public handlePointerLeave(): void {
    this._hit = undefined;
    this._detachGhost();
  }

  /** Stamps at the ghost's current pose. @returns Whether the click was consumed by the tool. */
  public async handlePointerDown(canvasX: number, canvasY: number): Promise<boolean> {
    if (!this._active) return false;
    if (!this._armed) {
      this._ctx.setStatus("Decal stamp: pick a decal in the Content Drawer first");
      return true;
    }
    if (this._stamping) return true;
    this._hit = this._ctx.raycast(canvasX, canvasY);
    this._offsetX = 0;
    this._offsetZ = 0;
    if (!this._hit) return true;

    this._stamping = true;
    try {
      const armed = this._armed;
      const pose = this._pose(this._hit);
      const decal = createDecalShell({
        id: `${armed.name}_${++this._stampCount}`,
        kitDecal: armed.kitDecal,
        size: [...this._size],
        position: [pose.position.x, pose.position.y, pose.position.z],
        rotation: [pose.rotation.x, pose.rotation.y, pose.rotation.z],
      });
      // addObject() swaps an exact (0,0,0) position for a "smart" spawn spot; a stamp must stay put.
      if (0 === decal.position.x && 0 === decal.position.y && 0 === decal.position.z) {
        decal.position.y = 1e-4;
      }
      // Textures must be there before the first render, otherwise the pipeline may not rebuild.
      await this._ctx.hydrate(decal);
      if (this._active) this._ctx.addObject(decal);
    } finally {
      this._stamping = false;
    }
    return true;
  }

  private _enable(): void {
    this._active = true;
    this._syncButton();
    if (!this._armed) {
      this._ctx.setStatus("Decal stamp: pick a decal in the Content Drawer");
      return;
    }
    void this._createGhost(++this._generation);
  }

  private _syncButton(): void {
    this._button?.classList.toggle("active", this._active);
  }

  private async _createGhost(generation: number): Promise<void> {
    const armed = this._armed;
    if (!armed) return;
    const ghost = createDecalShell({
      id: GHOST_NAME,
      kitDecal: armed.kitDecal,
      size: [...this._size],
      opacity: GHOST_OPACITY,
    });
    await this._ctx.hydrate(ghost);
    if (generation !== this._generation || !this._active) return;
    this._ghost = ghost;
    this._updateGhost();
  }

  private _pose(hit: DecalStampHit): { position: Vector3D; rotation: Vector3D } {
    const frame = quaternionFromNormal(hit.normal);
    const tangentX = rotateVector(frame, new Vector3D(1, 0, 0));
    const tangentZ = rotateVector(frame, new Vector3D(0, 0, 1));
    const position = new Vector3D(
      hit.point.x + tangentX.x * this._offsetX + tangentZ.x * this._offsetZ,
      hit.point.y + tangentX.y * this._offsetX + tangentZ.y * this._offsetZ,
      hit.point.z + tangentX.z * this._offsetX + tangentZ.z * this._offsetZ,
    );
    return { position, rotation: decalEulerFromNormal(hit.normal, this._spin) };
  }

  private _updateGhost(): void {
    const ghost = this._ghost;
    if (!ghost) return;
    if (!this._hit) {
      this._detachGhost();
      return;
    }
    const pose = this._pose(this._hit);
    ghost.position.copyFrom(pose.position);
    ghost.rotation.copyFrom(pose.rotation);
    ghost.scale.set(this._size[0], this._size[2], this._size[1]);
    if (!this._ghostInScene) {
      this._ctx.scene.add(ghost);
      this._ghostInScene = true;
    }
  }

  private _detachGhost(): void {
    if (this._ghost && this._ghostInScene) this._ctx.scene.remove(this._ghost);
    this._ghostInScene = false;
  }

  private _disposeGhost(): void {
    this._detachGhost();
    this._ghost = undefined;
  }

  private _nudge(key: string): void {
    const step = this._ctx.getNudgeStep();
    if ("arrowleft" === key) this._offsetX -= step;
    else if ("arrowright" === key) this._offsetX += step;
    else if ("arrowup" === key) this._offsetZ -= step;
    else this._offsetZ += step;
    this._updateGhost();
  }

  /** Uniform scale (keeps the aspect ratio): the width moves by one scale step, the rest follows. */
  private _scale(direction: 1 | -1): void {
    const width = this._size[0];
    const next = Math.max(MIN_WIDTH, width + direction * this._ctx.getScaleStep());
    const ratio = next / width;
    this._size = [next, this._size[1] * ratio, this._size[2] * ratio];
    this._updateGhost();
  }
}
