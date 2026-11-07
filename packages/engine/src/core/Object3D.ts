import type { AbstractMaterial } from "./materials/index.js";
import type { BoundingVolume, GeometryDataInterface, Collidable } from "../interfaces/index.js";
import type { Quaternion } from "../math/index.js";
import { MathUtils, Matrix4, Vector3D, MathPool } from "../math/index.js";
import type { Behavior } from "./behaviors/Behavior.js";
import { attachBehavior, detachBehavior } from "./behaviors/Behavior.js";
import { PickingBehavior } from "./behaviors/PickingBehavior.js";
import type { RigidBody } from "../physix/RigidBody.js";
import type { InspectorField } from "./Inspectable.js";
import { shallowCloneWithValueTypes } from "./CloneUtils.js";

/** Shared exposed default for `lookAt()`'s `up` parameter -- never mutated by the method. */
const _UNIT_UP = new Vector3D(0, 1, 0);

/** Shared scratch backing `getWorldPosition()` when the caller omits `out` -- overwritten on each call. */
const _scratchWorldPosition = new Vector3D();

let _nextObjectId = 1;

/**
 * Base class for all 3D objects in the scene.
 */
export class Object3D implements Collidable {
  /** Base schema every object exposes regardless of subclass -- see
   * `collectInspectorSchema()` in `./Inspectable.js`, which merges this with whatever a
   * subclass (e.g. `AbstractLight`, `AbstractMaterial`) declares on top. Transform fields use
   * `path` since position/rotation/scale are nested `Vector3D` instances, not own properties. */
  public static readonly inspector: Record<string, InspectorField> = {
    name: { type: "string", label: "Name" },
    position: { type: "vec3", label: "Position", step: 0.1 },
    rotation: { type: "vec3", label: "Rotation", step: 0.05 },
    scale: { type: "vec3", label: "Scale", step: 0.05 },
    isVisible: { type: "boolean", label: "Visible" },
    castShadow: { type: "boolean", label: "Cast Shadow", row: "shadows" },
    receiveShadow: { type: "boolean", label: "Recv Shadow", row: "shadows" },
  };

  /** Resets the global object ID generator (useful for deterministic tests). */
  public static resetNextId(): void {
    _nextObjectId = 1;
  }

  public static _getNextId(): number {
    return _nextObjectId++;
  }

  public id: number = _nextObjectId++;
  public readonly uuid: string = MathUtils.generateUUID();
  public name: string = "";
  /** Optional app-defined category tag, for typed identification instead of matching on `name`. */
  public tag?: string;
  /** Name of the Maker prefab this node was instantiated from, if any -- provenance only, per
   * ADR 0010's Phase 2 "stamped copies" decision: no live link back to the source, just a record
   * of where this subtree came from. Round-tripped via the `SWM_prefab_instance` glTF extension
   * (`WorldWriter`/`GltfLoader`). */
  public prefabSource?: string;
  /** Custom user-defined data storage dictionary. */
  public userData: Record<string, unknown> = {};

  public rigidBody?: RigidBody;

  public geometry: GeometryDataInterface | undefined = undefined;
  public material: AbstractMaterial | undefined = undefined;
  public bounds: BoundingVolume | undefined = undefined;

  /** 32-bit collision layer bitmask this object belongs to (default: 1). */
  public collisionLayer: number = 1;
  /** 32-bit collision mask specifying which layers this object interacts with (default: 0xFFFFFFFF). */
  public collisionMask: number = 0xffffffff;
  /** If true, this object acts as a trigger/sensor (fires trigger events without physical force). */
  public isTrigger: boolean = false;

  public position: Vector3D = new Vector3D();
  public rotation: Vector3D = new Vector3D();
  public quaternion?: Quaternion;
  public scale: Vector3D = new Vector3D(1, 1, 1);

  public localMatrix: Matrix4 = new Matrix4();
  public worldMatrix: Matrix4 = new Matrix4();

  public parent: Object3D | undefined = undefined;
  public children: Object3D[] = [];
  public behaviors: Behavior[] = [];
  public animations: import("./animation/AnimationClip.js").AnimationClip[] = [];

  /**
   * Set by `Scene` on its hidden root object. Lets `remove()` notify the owning scene to queue
   * GPU-resource release for a discarded subtree even when called on a nested object directly
   * (`someParent.remove(child)`) instead of through `Scene.remove()` -- see `remove()`/`add()`.
   */
  public pendingRemovalSink?: (obj: Object3D) => void;

  public isVisible: boolean = true;
  /**
   * Whether this object generates bounds and participates in physics/raycasting. Defaults to true.
   * Contract (decided 2026-10, review 7d): `isCollidable = false` => `computeBounds()` leaves
   * `bounds` undefined, so the object is never frustum-culled, never octree-inserted and never
   * HZB occlusion-tested (it always draws). Subclasses that are non-collidable but still want
   * culling (Decal, FogVolume) override `computeBounds()` to supply cull-only bounds; such
   * objects are excluded from collision queries via `Octree.queryVolume`/`resolveSphereCollisions`.
   */
  public isCollidable: boolean = true;
  public frustumCulled: boolean = true;
  /**
   * Declares intent that this object does not move after setup.
   *
   * Documented contract (Phase-1 gate, D5): `isStatic` is intentional state, NOT an
   * optimization lever — there is no cached fast path. Whether static or not, the scene
   * graph rebuilds the world matrix of an object that has `matrixWorldNeedsUpdate` set;
   * non-static objects (the default) request this every frame and are always rebuilt.
   * `setPosition()/setRotation()/setScale()/translate()` never set `matrixWorldNeedsUpdate`,
   * matching the high-churn dynamic paths. Under a live `Scene` root the per-frame traversal
   * forces updates, so even a later-moved static subtree is picked up; only STANDALONE
   * subtrees outside a scene root (e.g. a detached DecalPool/FogVolume subtree) freeze until
   * `matrixWorldNeedsUpdate = true` — call `updateMatrixWorld()` there explicitly.
   */
  public isStatic: boolean = false;
  public matrixWorldNeedsUpdate: boolean = true;
  public inFrustum: boolean = true;
  /** Set only by WebGPU Hierarchical-Z occlusion culling (see docs/adr/0008-...), one frame
   * stale by design (`mapAsync` GPU->CPU readback is never synchronous). Unlike `inFrustum`,
   * NOT reset every frame -- only `WebGPURenderer.applyPendingOcclusionResults()` writes it, for
   * whichever objects it has a fresh readback for; everything else keeps its last known value.
   * Always false on WebGL1/WebGL2 (never written there), making `Scene._collectVisible()`'s
   * check a permanent no-op on those backends. */
  public occlusionCulled: boolean = false;

  public castShadow: boolean = false;
  public receiveShadow: boolean = false;

  public isPickable: boolean = false;
  public onPointerEnter: (() => void) | undefined;
  public onPointerLeave: (() => void) | undefined;
  public onPointerClick?: () => void;

  private _pickingBehavior?: PickingBehavior;

  private _ensurePickingBehavior(): PickingBehavior {
    if (!this._pickingBehavior) {
      this._pickingBehavior = new PickingBehavior();
      this.addBehavior(this._pickingBehavior);
    }
    return this._pickingBehavior;
  }

  public get onPointerDown():
    ((ray: import("../physix/index.js").Ray, intersectionPoint: Vector3D) => void) | undefined {
    return this._pickingBehavior?.onPointerDown;
  }
  public set onPointerDown(
    handler:
      ((ray: import("../physix/index.js").Ray, intersectionPoint: Vector3D) => void) | undefined,
  ) {
    this._ensurePickingBehavior().onPointerDown = handler;
  }

  public get onPointerUp(): (() => void) | undefined {
    return this._pickingBehavior?.onPointerUp;
  }
  public set onPointerUp(handler: (() => void) | undefined) {
    this._ensurePickingBehavior().onPointerUp = handler;
  }

  public get onPointerMove(): ((ray: import("../physix/index.js").Ray) => void) | undefined {
    return this._pickingBehavior?.onPointerMove;
  }
  public set onPointerMove(handler: ((ray: import("../physix/index.js").Ray) => void) | undefined) {
    this._ensurePickingBehavior().onPointerMove = handler;
  }

  constructor(name?: string) {
    this.name = name || MathUtils.generateUUID();
  }

  public add(...children: Object3D[]): void {
    for (const child of children) {
      // Re-parenting, not a discard: detach without notifying any scene, so the child's GPU
      // resources aren't released while it's still alive elsewhere in the graph.
      if (child.parent) child.parent._detach(child);
      child.parent = this;
      this.children.push(child);
    }
  }

  public remove(...children: Object3D[]): void {
    for (const child of children) {
      if (this._detach(child)) this._notifyRemoved(child);
    }
  }

  /** Detaches `child` from this node without notifying any scene. @returns Whether it was found. */
  private _detach(child: Object3D): boolean {
    const index: number = this.children.indexOf(child);
    if (-1 === index) return false;
    child.parent = undefined;
    this.children.splice(index, 1);
    return true;
  }

  private _notifyRemoved(child: Object3D): void {
    let current = this.parent;
    while (current?.parent) {
      current = current.parent;
    }
    const root = current ?? this;
    root.pendingRemovalSink?.(child);
  }

  public getObjectByName(name: string): Object3D | undefined {
    if (this.name === name) return this;
    for (let i = 0; i < this.children.length; i++) {
      const found = this.children[i]!.getObjectByName(name);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Traverses the object and all its descendants in depth-first order, executing the callback for each.
   */
  public traverse(callback: (object: Object3D) => void): void {
    callback(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.traverse(callback);
    }
  }

  public addBehavior(behavior: Behavior): this {
    attachBehavior(this.behaviors, behavior, this);
    return this;
  }

  public removeBehavior(behavior: Behavior): this {
    detachBehavior(this.behaviors, behavior);
    return this;
  }

  public translate(v: Vector3D): this {
    this.position.add(v);
    return this;
  }

  public setPosition(x: number, y: number, z: number): this {
    this.position.set(x, y, z);
    return this;
  }

  public setRotation(x: number, y: number, z: number): this {
    this.rotation.set(x, y, z);
    return this;
  }

  public setScale(x: number, y: number = x, z: number = x): this {
    this.scale.set(x, y, z);
    return this;
  }

  public computeBounds(): this {
    if (!this.isCollidable) {
      this.bounds = undefined;
      return this;
    }

    if (this.geometry) {
      // 1. Get local bounds from geometry
      const localBounds = this.geometry.getBoundingVolume();
      // 2. Transform bounds to world space without re-allocating (if types match, or if a
      //    custom OBB was assigned). When a fresh volume is required, `cloneEmpty` produces
      //    an empty instance of the exact concrete class of `localBounds`, which keeps the
      //    `.type` discriminant valid without a type-conditional constructor ladder.
      if (
        !this.bounds ||
        (this.bounds.type !== 0 /* BoundingType.SPHERE */ &&
          this.bounds.type !== 2 /* BoundingType.OBB */ &&
          this.bounds.type !== 3 /* BoundingType.HULL */ &&
          this.bounds.type !== localBounds.type)
      ) {
        this.bounds = localBounds.cloneEmpty();
      }

      const bounds = this.bounds;
      if (bounds) {
        if (bounds.type === 1 /* BoundingType.BOX */) {
          const b = bounds;
          if (localBounds.type === 1 /* BoundingType.BOX */) {
            b.min.copyFrom(localBounds.min);
            b.max.copyFrom(localBounds.max);
          }
          b.transform(this.worldMatrix);
        } else if (bounds.type === 0 /* BoundingType.SPHERE */) {
          const b = bounds;
          if (localBounds.type === 0 /* BoundingType.SPHERE */) {
            b.center.copyFrom(localBounds.center);
            b.radius = localBounds.radius;
          }
          b.transform(this.worldMatrix);
        } else if (bounds.type === 2 /* BoundingType.OBB */) {
          const b = bounds;
          if (localBounds.type === 1 /* BoundingType.BOX */) {
            b.setLocalCenter(
              (localBounds.min.x + localBounds.max.x) * 0.5,
              (localBounds.min.y + localBounds.max.y) * 0.5,
              (localBounds.min.z + localBounds.max.z) * 0.5,
            );
            b.setLocalHalfExtents(
              (localBounds.max.x - localBounds.min.x) * 0.5,
              (localBounds.max.y - localBounds.min.y) * 0.5,
              (localBounds.max.z - localBounds.min.z) * 0.5,
            );
          } else if (localBounds.type === 2 /* BoundingType.OBB */) {
            b.copyLocalCenterFrom(localBounds.center);
            b.copyLocalHalfExtentsFrom(localBounds.halfExtents);
          }
          b.transform(this.worldMatrix);
        } else if (bounds.type === 3 /* BoundingType.HULL */) {
          // A ConvexHull's shape is never derived from `geometry.getBoundingVolume()`
          // (which only ever produces a Box/Sphere) -- it must be assigned manually
          // (e.g. `obj.bounds = new ConvexHull(...)`), and is then only re-transformed
          // here every frame, exactly like the manually-assigned-OBB branch above.
          bounds.transform(this.worldMatrix);
        }
      }
    }
    return this;
  }

  public lookAt(target: Vector3D, up: Vector3D = _UNIT_UP): this {
    const m = MathPool.acquireMatrix();
    Matrix4.lookAt(this.position, target, up, m);
    m.invert();
    const pos = MathPool.acquireVector();
    const scale = MathPool.acquireVector();
    m.decompose(pos, this.rotation, scale);
    if (this.quaternion) {
      this.quaternion.setFromRotationMatrix(m);
    }
    MathPool.releaseVector(pos);
    MathPool.releaseVector(scale);
    MathPool.releaseMatrix(m);
    return this;
  }

  public updateMatrixWorld(force: boolean = false): void {
    if (force || this.matrixWorldNeedsUpdate || !this.isStatic) {
      if (this.quaternion) {
        this.localMatrix.composeFromQuaternion(this.position, this.quaternion, this.scale);
      } else {
        this.localMatrix.compose(this.position, this.rotation, this.scale);
      }
      if (undefined === this.parent) {
        this.worldMatrix.data.set(this.localMatrix.data);
      } else {
        Matrix4.multiply(this.parent.worldMatrix, this.localMatrix, this.worldMatrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const children = this.children;
    const len = children.length;
    for (let i = 0; i < len; i++) {
      children[i]!.updateMatrixWorld(force);
    }
  }

  /**
   * Reads this object's position in world space, i.e. after resolving the full parent
   * chain -- unlike `position`, which is always local to its immediate parent. Requires
   * `worldMatrix` to be current (see `updateMatrixWorld()`).
   * @param out Optional vector to write into, to avoid allocating one per call. If omitted, a
   * shared module-level scratch is used and overwritten by the next call.
   */
  public getWorldPosition(out: Vector3D = _scratchWorldPosition): Vector3D {
    return out.set(
      this.worldMatrix.data[12]!,
      this.worldMatrix.data[13]!,
      this.worldMatrix.data[14]!,
    );
  }

  /**
   * Returns an independent copy of this object's subtree -- own `uuid`, own transform, own
   * material (via `AbstractMaterial.clone()`), own behaviors (via `Behavior.clone()`, re-attached
   * so `onAttach()` runs against the new instance), and a recursive clone of every child. Used by
   * Maker's Duplicate command.
   *
   * `geometry` and any texture references stay shared by reference -- immutable data, same as
   * every other "place another instance" workflow in the engine. `parent`/`bounds` reset (the
   * caller reparents and bounds recompute lazily); `rigidBody` is deliberately dropped rather
   * than shared, since two objects driven by the same live physics body would move together.
   *
   * Known gap: skinned meshes aren't specially handled -- a cloned `SkinnedMesh`'s `skeleton`
   * would still reference the *original* subtree's bones, not the freshly cloned ones alongside
   * it. Not a concern for Maker's realistic Duplicate targets (props, lights, prefab instances);
   * character rigs go through the Prefab/glTF pipeline instead.
   */
  public clone(): Object3D {
    const copy = shallowCloneWithValueTypes(this);
    copy.id = Object3D._getNextId();
    copy.parent = undefined;
    copy.bounds = undefined;
    // GPU occlusion result belongs to the source instance; a fresh clone starts visible.
    copy.occlusionCulled = false;
    delete copy.rigidBody;
    copy.localMatrix = new Matrix4();
    copy.worldMatrix = new Matrix4();
    copy.material = this.material?.clone();
    copy.userData = { ...this.userData };

    copy.children = this.children.map((child) => {
      const childCopy = child.clone();
      childCopy.parent = copy;
      return childCopy;
    });

    copy.behaviors = [];
    for (const behavior of this.behaviors) {
      attachBehavior(copy.behaviors, behavior.clone(), copy);
    }
    const pickingCopy = copy.behaviors.find(
      (b): b is PickingBehavior => b instanceof PickingBehavior,
    );
    if (pickingCopy) copy._pickingBehavior = pickingCopy;
    else delete copy._pickingBehavior;

    copy.updateMatrixWorld();
    return copy;
  }
}
