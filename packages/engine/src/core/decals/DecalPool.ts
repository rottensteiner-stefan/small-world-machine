import { Matrix4, MathPool, Vector3D } from "../../math/index.js";
import type { Object3D } from "../Object3D.js";
import { Decal } from "../objects/Decal.js";
import type { DecalMaterial } from "../materials/surface/DecalMaterial.js";
import { decalEulerFromNormal } from "./DecalMath.js";

export interface DecalPoolOptions {
  /** Maximum number of decals alive at once; spawning into a full pool recycles the oldest. */
  capacity: number;
  /** Called once per slot. Every pooled decal needs its own material (its opacity fades on its own), the textures can be shared. */
  createMaterial: () => DecalMaterial;
  /** Default box size [width, height, projection depth] in metres. Defaults to [0.5, 0.5, 0.3]. */
  size?: [number, number, number];
  /** Seconds a decal stays before it fades and frees its slot. Defaults to `Infinity` (it lives until recycled). */
  lifetime?: number;
  /** Seconds the fade-out at the end of the lifetime takes. Defaults to 1. */
  fadeSeconds?: number;
  /** Stacking priority of every pooled decal (see `Decal.priority`). Defaults to 0. */
  priority?: number;
}

export interface DecalSpawnOptions {
  size?: [number, number, number];
  /** Rotation about the surface normal in radians. Defaults to 0. */
  spin?: number;
  /** Overrides the pool's lifetime for this decal. */
  lifetime?: number;
  /** The receiver is a moving object: the decal becomes its child and keeps its world pose. */
  attachTo?: Object3D;
}

interface Slot {
  decal: Decal;
  material: DecalMaterial;
  age: number;
  lifetime: number;
  baseOpacity: number;
  active: boolean;
}

/**
 * A fixed-size pool of runtime decals (bullet holes, blood, scorch marks). All decals are created
 * up front and only toggled visible, never added or removed per spawn: removing a node would release
 * its GPU resources, and a pool must not allocate while the game runs. When the pool is full the
 * oldest decal is recycled and restacked on top, so the newest mark is always the one you see.
 *
 * The pool belongs to whoever creates it (a level, a behavior): there is no global instance. The
 * caller finds the hit point and surface normal (for example with a `Raycaster`), the pool only
 * places and ages the decals. `update(dt)` must run once per frame.
 *
 * Decals project from the opaque depth, so on a renderer without decals (WebGL1) spawned decals draw
 * nothing: the baker only handles static ones.
 */
export class DecalPool {
  private readonly _slots: Slot[] = [];
  private readonly _root: Object3D;
  private readonly _size: [number, number, number];
  private readonly _lifetime: number;
  private readonly _fadeSeconds: number;
  private _active = 0;

  constructor(root: Object3D, options: DecalPoolOptions) {
    if (!(options.capacity >= 1) || !Number.isInteger(options.capacity)) {
      throw new Error(`DecalPool: capacity must be a positive integer, got ${options.capacity}`);
    }
    this._root = root;
    this._size = options.size ? [...options.size] : [0.5, 0.5, 0.3];
    this._lifetime = options.lifetime ?? Infinity;
    this._fadeSeconds = options.fadeSeconds ?? 1;
    for (let i = 0; i < options.capacity; i++) {
      const material = options.createMaterial();
      const decal = new Decal(material, `PoolDecal${i}`);
      decal.priority = options.priority ?? 0;
      decal.isVisible = false;
      root.add(decal);
      this._slots.push({
        decal,
        material,
        age: 0,
        lifetime: this._lifetime,
        baseOpacity: material.color.a,
        active: false,
      });
    }
  }

  /** Decals currently alive. */
  public get activeCount(): number {
    return this._active;
  }

  public get capacity(): number {
    return this._slots.length;
  }

  /**
   * Places a decal on the surface at `point` (unit `normal` facing the viewer). Recycles the oldest
   * decal when the pool is full.
   * @returns The decal that was placed (owned by the pool, do not remove it from the scene).
   */
  public spawn(point: Vector3D, normal: Vector3D, options: DecalSpawnOptions = {}): Decal {
    const slot = this._acquire();
    const decal = slot.decal;
    const [w, h, depth] = options.size ?? this._size;

    if (decal.parent !== this._root) this._root.add(decal);
    decal.position.copyFrom(point);
    decal.rotation.copyFrom(decalEulerFromNormal(normal, options.spin ?? 0));
    decal.scale.set(w, depth, h);
    if (options.attachTo) this._attach(decal, options.attachTo);

    slot.age = 0;
    slot.lifetime = options.lifetime ?? this._lifetime;
    slot.material.color.a = slot.baseOpacity;
    slot.active = true;
    this._active++;
    decal.isVisible = true;
    decal.restack();
    return decal;
  }

  /** Ages every live decal, fades the ones in the last `fadeSeconds` of their lifetime and frees expired ones. */
  public update(deltaSeconds: number): void {
    for (const slot of this._slots) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const remaining = slot.lifetime - slot.age;
      if (remaining <= 0) {
        this._release(slot);
      } else if (remaining < this._fadeSeconds) {
        slot.material.color.a = slot.baseOpacity * (remaining / this._fadeSeconds);
      }
    }
  }

  /** Frees every live decal at once. */
  public clear(): void {
    for (const slot of this._slots) if (slot.active) this._release(slot);
  }

  /** Removes all pooled decals from the scene and releases their GPU resources. The pool is unusable afterwards. */
  public dispose(): void {
    for (const slot of this._slots) {
      slot.active = false;
      (slot.decal.parent ?? this._root).remove(slot.decal);
    }
    this._slots.length = 0;
    this._active = 0;
  }

  /** A free slot, else the oldest live one (smallest age is newest, so the largest age goes). */
  private _acquire(): Slot {
    let oldest: Slot | undefined;
    for (const slot of this._slots) {
      if (!slot.active) return slot;
      if (!oldest || slot.age > oldest.age) oldest = slot;
    }
    this._release(oldest!);
    return oldest!;
  }

  private _release(slot: Slot): void {
    slot.active = false;
    slot.decal.isVisible = false;
    this._active--;
    if (slot.decal.parent !== this._root) this._root.add(slot.decal);
  }

  /** Re-parents `decal` under `receiver` without moving it in the world. */
  private _attach(decal: Decal, receiver: Object3D): void {
    receiver.updateMatrixWorld();
    const local = MathPool.acquireMatrix();
    const inverse = MathPool.acquireMatrix();
    const world = MathPool.acquireMatrix();
    world.compose(decal.position, decal.rotation, decal.scale);
    if (Matrix4.invert(receiver.worldMatrix, inverse)) {
      Matrix4.multiply(inverse, world, local);
      const position = MathPool.acquireVector();
      const scale = MathPool.acquireVector();
      local.decompose(position, decal.rotation, scale);
      decal.position.copyFrom(position);
      decal.scale.copyFrom(scale);
      MathPool.releaseVector(position);
      MathPool.releaseVector(scale);
      receiver.add(decal);
    }
    MathPool.releaseMatrix(world);
    MathPool.releaseMatrix(local);
    MathPool.releaseMatrix(inverse);
  }
}
