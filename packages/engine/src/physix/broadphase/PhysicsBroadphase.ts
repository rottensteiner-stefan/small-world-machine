import { Octree } from "../../core/culling/Octree.js";
import { Vector3D } from "../../math/index.js";
import type { Collidable, BoundingVolume } from "../../interfaces/index.js";
import { BoundingBox } from "../BoundingBox.js";
import type { Ray } from "../Ray.js";
import { BoundingType } from "../../enums/index.js";
import { Object3D } from "../../core/Object3D.js";

/** Padding added to the computed world AABB to guard against boundary floating-point edge cases. */
const BROADPHASE_EPSILON: number = 0.01;

/** Default safety expansion margin for fattened AABBs (fat AABB shell). */
export const DEFAULT_BROADPHASE_FAT_MARGIN: number = 0.1;

export interface PhysicsBroadphaseOptions {
  /** Safety expansion margin for fattened AABBs. Defaults to 0.1. */
  fatMargin?: number;
  /** Velocity multiplier for predictive fattening along movement vectors. Defaults to 0.0. */
  velocityMultiplier?: number;
}

/**
 * Internal tracking proxy for a collider in the broadphase acceleration structure.
 */
export interface BroadphaseProxy {
  collider: Collidable;
  /** Fattened / bloated AABB with safety margin for temporal coherence */
  fatBounds: BoundingBox;
  /** Whether this collider is currently inserted in the active Octree */
  inTree: boolean;
  /** True if collider is static / immotile */
  isStatic: boolean;
}

/**
 * Manages the spatial acceleration structure (Octree) with temporal coherence and fattened AABBs.
 * Objects that remain within their fattened bounding shell skip expensive spatial re-sorting.
 */
export class PhysicsBroadphase {
  private _tree?: Octree;
  private _worldMin: Vector3D = new Vector3D();
  private _worldMax: Vector3D = new Vector3D();
  private _fallback: Collidable[] = [];
  private _proxies: Map<Collidable, BroadphaseProxy> = new Map();
  private _activeColliders: Set<Collidable> = new Set();

  /** Safety margin added to tight collider bounds to create the fattened AABB shell. */
  public fatMargin: number;

  /** Lookahead factor to expand fat AABB along current velocity vector. */
  public velocityMultiplier: number;

  /** Number of colliders that skipped spatial re-sorting in the last update frame. */
  public skippedCount: number = 0;

  /** Number of colliders that moved outside their fat bounds and were re-inserted. */
  public movedCount: number = 0;

  constructor(options: PhysicsBroadphaseOptions = {}) {
    this.fatMargin = options.fatMargin ?? DEFAULT_BROADPHASE_FAT_MARGIN;
    this.velocityMultiplier = options.velocityMultiplier ?? 0.0;
  }

  /** Returns the underlying Octree structure, if initialized. */
  public get tree(): Octree | undefined {
    return this._tree;
  }

  /** Returns uninserted colliders that fall back to brute-force checking. */
  public get fallback(): readonly Collidable[] {
    return this._fallback;
  }

  /** Returns the internal proxy map for diagnostic inspection. */
  public get proxies(): ReadonlyMap<Collidable, BroadphaseProxy> {
    return this._proxies;
  }

  /**
   * Computes a fattened bounding box around the collider's tight bounding volume.
   */
  private _computeFatBounds(collider: Collidable, outFat: BoundingBox): void {
    const b = collider.bounds!;
    let minX: number, minY: number, minZ: number;
    let maxX: number, maxY: number, maxZ: number;

    if (b.type === BoundingType.BOX) {
      const box = b as BoundingBox;
      minX = box.min.x;
      minY = box.min.y;
      minZ = box.min.z;
      maxX = box.max.x;
      maxY = box.max.y;
      maxZ = box.max.z;
    } else {
      const r = b.getBroadRadius();
      const cx = b.center.x;
      const cy = b.center.y;
      const cz = b.center.z;
      minX = cx - r;
      minY = cy - r;
      minZ = cz - r;
      maxX = cx + r;
      maxY = cy + r;
      maxZ = cz + r;
    }

    const margin = this.fatMargin;
    outFat.min.set(minX - margin, minY - margin, minZ - margin);
    outFat.max.set(maxX + margin, maxY + margin, maxZ + margin);

    // Optional velocity extrapolation for fast-moving dynamic bodies
    if (collider instanceof Object3D && collider.rigidBody && this.velocityMultiplier > 0) {
      const vx = collider.rigidBody.velocity.x * this.velocityMultiplier;
      const vy = collider.rigidBody.velocity.y * this.velocityMultiplier;
      const vz = collider.rigidBody.velocity.z * this.velocityMultiplier;
      if (vx < 0) outFat.min.x += vx;
      else outFat.max.x += vx;
      if (vy < 0) outFat.min.y += vy;
      else outFat.max.y += vy;
      if (vz < 0) outFat.min.z += vz;
      else outFat.max.z += vz;
    }

    outFat.center.copyFrom(outFat.min).add(outFat.max).scale(0.5);
  }

  /**
   * Expands the running world AABB to include a collider's bounding volume.
   */
  private _trackColliderBounds(bounds: BoundingVolume): void {
    const r = bounds.getBroadRadius();
    const cx = bounds.center.x;
    const cy = bounds.center.y;
    const cz = bounds.center.z;

    if (cx - r < this._worldMin.x) this._worldMin.x = cx - r;
    if (cy - r < this._worldMin.y) this._worldMin.y = cy - r;
    if (cz - r < this._worldMin.z) this._worldMin.z = cz - r;

    if (cx + r > this._worldMax.x) this._worldMax.x = cx + r;
    if (cy + r > this._worldMax.y) this._worldMax.y = cy + r;
    if (cz + r > this._worldMax.z) this._worldMax.z = cz + r;
  }

  /**
   * Rebuilds or incrementally updates the Octree broadphase structure with temporal coherence.
   * Colliders that stay within their fattened bounding shell skip tree removal/reinsertion.
   * @param allColliders Array of all collidable entities.
   */
  public update(allColliders: readonly Collidable[]): void {
    this.skippedCount = 0;
    this.movedCount = 0;
    this._activeColliders.clear();

    const toReinsert: Collidable[] = [];
    const isFirstBuild = !this._tree;

    // 1. Process all colliders with temporal coherence checks
    for (let i = 0; i < allColliders.length; i++) {
      const collider = allColliders[i]!;
      this._activeColliders.add(collider);

      if (!collider.bounds) continue;

      let proxy = this._proxies.get(collider);

      if (proxy && !isFirstBuild) {
        // TEMPORAL COHERENCE: Check if current tight bounds is still inside cached fatBounds
        if (proxy.fatBounds.containsVolume(collider.bounds)) {
          // Inside fat bounding shell: SKIP spatial re-sorting!
          this.skippedCount++;
          continue;
        }

        // Moved outside fat bounds: remove from old octree position
        if (proxy.inTree && this._tree) {
          this._tree.remove(collider);
          proxy.inTree = false;
        }
      } else if (!proxy) {
        const isStatic = collider instanceof Object3D ? collider.isStatic : false;
        proxy = {
          collider,
          fatBounds: new BoundingBox(new Vector3D(), new Vector3D()),
          inTree: false,
          isStatic,
        };
        this._proxies.set(collider, proxy);
      }

      this._computeFatBounds(collider, proxy.fatBounds);
      toReinsert.push(collider);
      this.movedCount++;
    }

    // 2. Clean up removed proxies
    for (const [collider, proxy] of this._proxies.entries()) {
      if (!this._activeColliders.has(collider)) {
        if (proxy.inTree && this._tree) {
          this._tree.remove(collider);
        }
        this._proxies.delete(collider);
      }
    }

    // 3. Build initial tree or re-fit if ALL objects moved / empty tree
    if (isFirstBuild || !this._tree || (this.skippedCount === 0 && toReinsert.length > 0)) {
      this._worldMin.set(Infinity, Infinity, Infinity);
      this._worldMax.set(-Infinity, -Infinity, -Infinity);

      for (let i = 0; i < allColliders.length; i++) {
        const c = allColliders[i]!;
        if (c.bounds) {
          this._trackColliderBounds(c.bounds);
        }
      }

      if (this._worldMin.x !== Infinity) {
        this._worldMin.x -= BROADPHASE_EPSILON;
        this._worldMin.y -= BROADPHASE_EPSILON;
        this._worldMin.z -= BROADPHASE_EPSILON;
        this._worldMax.x += BROADPHASE_EPSILON;
        this._worldMax.y += BROADPHASE_EPSILON;
        this._worldMax.z += BROADPHASE_EPSILON;

        if (!this._tree) {
          this._tree = new Octree(new BoundingBox(this._worldMin.clone(), this._worldMax.clone()));
        } else if (this.skippedCount === 0) {
          this._tree.root.bounds.min.copyFrom(this._worldMin);
          this._tree.root.bounds.max.copyFrom(this._worldMax);
          this._tree.root.bounds.center.copyFrom(this._worldMin).add(this._worldMax).scale(0.5);
          this._tree.clear();
          toReinsert.length = 0;
          for (let i = 0; i < allColliders.length; i++) {
            const c = allColliders[i]!;
            if (c.bounds) toReinsert.push(c);
          }
        }
      }
    }

    // 4. Re-insert dirty/moved colliders.
    //
    // SOUNDNESS: placements must be driven by the FAT bounds, not the tight bounds. The temporal
    // coherence skip above only skips a collider while its CURRENT tight bounds stay inside the
    // fat shell computed at its last placement. If the octree had placed that collider by its
    // tight bounds, it would sit in a leaf node too small to cover the fat shell, and a query
    // issued near the collider's (moved but skipped) position would never reach that leaf --
    // the collider silently vanishes from every future query until it finally escapes the shell.
    // Placing by the fat bounds guarantees the placement node encloses the whole shell, so any
    // query that intersects the collider's current bounds necessarily reaches its node. The
    // leaf-level overlap test keeps reading the collider's TIGHT bounds at query time, so the
    // narrow phase still sees exact geometry. See `_placeCollider`, which is also the single
    // insertion code path used by the CCD-reinsert flow.
    if (this._tree && toReinsert.length > 0) {
      for (let i = 0; i < toReinsert.length; i++) {
        const collider = toReinsert[i]!;
        const proxy = this._proxies.get(collider);
        if (!proxy) continue;
        this._placeCollider(collider, proxy);
      }
    }

    // 5. Update fallback list
    this._fallback.length = 0;
    for (let i = 0; i < allColliders.length; i++) {
      const collider = allColliders[i]!;
      const proxy = this._proxies.get(collider);
      if (!collider.bounds || (proxy && !proxy.inTree)) {
        this._fallback.push(collider);
      }
    }
  }

  /**
   * Inserts (or re-inserts) a single collider into the octree, driven by its FAT bounds.
   *
   * This is the sole placement code path: `update()` uses it for every collider that left its
   * fat shell, and {@link reinsertCollider} uses it when an external system (CCD) moved a body
   * in between updates. The collider's `bounds` is temporarily swapped to the fat proxy for
   * insertion and restored immediately after, so the octree leaf always encloses the whole fat
   * shell while the narrow phase keeps reading exact tight bounds.
   */
  private _placeCollider(collider: Collidable, proxy: BroadphaseProxy): void {
    if (!this._tree) return;

    // Auto-expand tree root bounds if needed
    if (!this._tree.root.bounds.containsBox(proxy.fatBounds)) {
      this._tree.root.bounds.min.min(proxy.fatBounds.min);
      this._tree.root.bounds.max.max(proxy.fatBounds.max);
      this._tree.root.bounds.center
        .copyFrom(this._tree.root.bounds.min)
        .add(this._tree.root.bounds.max)
        .scale(0.5);
    }

    const original = collider.bounds;
    collider.bounds = proxy.fatBounds;
    try {
      proxy.inTree = this._tree.insert(collider);
    } finally {
      collider.bounds = original;
    }
  }

  /**
   * Re-inserts a collider whose position changed outside the normal update cycle (e.g. a body
   * whose position was clamped by CCD *after* `update()` already placed it). Recomputes the fat
   * shell from the current tight bounds and places the collider at its new octree node, so
   * subsequent queries around the body's actual position cannot miss it.
   * @param collider The collider to re-insert.
   */
  public reinsertCollider(collider: Collidable): void {
    if (!collider.bounds || !this._tree) return;

    let proxy = this._proxies.get(collider);
    if (!proxy) {
      const isStatic = collider instanceof Object3D ? collider.isStatic : false;
      proxy = {
        collider,
        fatBounds: new BoundingBox(new Vector3D(), new Vector3D()),
        inTree: false,
        isStatic,
      };
      this._proxies.set(collider, proxy);
    }

    // Remove any stale placement from the pre-clamp position first.
    if (proxy.inTree) {
      this._tree.remove(collider);
      proxy.inTree = false;
    }

    this._computeFatBounds(collider, proxy.fatBounds);
    this._placeCollider(collider, proxy);
    this._activeColliders.add(collider);
  }

  /**
   * Tests whether two collidable entities can physically interact or trigger events based on their collision layers & masks.
   * @param a The first collidable entity.
   * @param b The second collidable entity.
   * @returns True if both layer/mask pairs overlap.
   */
  public static canCollide(a: Collidable, b: Collidable): boolean {
    const layerA = a.collisionLayer ?? (a instanceof Object3D ? a.collisionLayer : 1);
    const maskA = a.collisionMask ?? (a instanceof Object3D ? a.collisionMask : 0xffffffff);
    const layerB = b.collisionLayer ?? (b instanceof Object3D ? b.collisionLayer : 1);
    const maskB = b.collisionMask ?? (b instanceof Object3D ? b.collisionMask : 0xffffffff);

    return (layerA & maskB) !== 0 && (layerB & maskA) !== 0;
  }

  /**
   * Queries the broadphase Octree and fallback list for colliders intersecting the given volume.
   * @param volume Target bounding volume.
   * @param outHits Array receiving the potential collider candidates.
   * @param mask Optional 32-bit collision layer mask to filter candidates (default: 0xFFFFFFFF).
   */
  public queryVolume(
    volume: BoundingVolume,
    outHits: Collidable[],
    mask: number = 0xffffffff,
  ): void {
    if (this._tree) {
      if (mask === 0xffffffff) {
        this._tree.queryVolume(volume, outHits);
      } else {
        const tempHits: Collidable[] = [];
        this._tree.queryVolume(volume, tempHits);
        for (let i = 0; i < tempHits.length; i++) {
          const c = tempHits[i]!;
          const layer = c.collisionLayer ?? (c instanceof Object3D ? c.collisionLayer : 1);
          if ((layer & mask) !== 0) {
            outHits.push(c);
          }
        }
      }
    }
    for (let i = 0; i < this._fallback.length; i++) {
      const c = this._fallback[i]!;
      if (mask === 0xffffffff) {
        outHits.push(c);
      } else {
        const layer = c.collisionLayer ?? (c instanceof Object3D ? c.collisionLayer : 1);
        if ((layer & mask) !== 0) {
          outHits.push(c);
        }
      }
    }
  }

  /**
   * Queries the broadphase Octree and fallback list for colliders intersecting the given mathematical ray.
   * @param ray Target ray.
   * @param outHits Array receiving the potential collider candidates.
   * @param mask Optional 32-bit collision layer mask to filter candidates (default: 0xFFFFFFFF).
   */
  public queryRay(ray: Ray, outHits: Collidable[], mask: number = 0xffffffff): void {
    if (this._tree) {
      if (mask === 0xffffffff) {
        this._tree.queryRay(ray, outHits);
      } else {
        const tempHits: Collidable[] = [];
        this._tree.queryRay(ray, tempHits);
        for (let i = 0; i < tempHits.length; i++) {
          const c = tempHits[i]!;
          const layer = c.collisionLayer ?? (c instanceof Object3D ? c.collisionLayer : 1);
          if ((layer & mask) !== 0) {
            outHits.push(c);
          }
        }
      }
    }
    for (let i = 0; i < this._fallback.length; i++) {
      const c = this._fallback[i]!;
      if (mask === 0xffffffff) {
        outHits.push(c);
      } else {
        const layer = c.collisionLayer ?? (c instanceof Object3D ? c.collisionLayer : 1);
        if ((layer & mask) !== 0) {
          outHits.push(c);
        }
      }
    }
  }

  /**
   * Clears all cached proxies, fallback colliders, and resets the spatial tree.
   */
  public clear(): void {
    this._proxies.clear();
    this._activeColliders.clear();
    this._fallback.length = 0;
    if (this._tree) {
      this._tree.clear();
    }
    this.skippedCount = 0;
    this.movedCount = 0;
  }
}
