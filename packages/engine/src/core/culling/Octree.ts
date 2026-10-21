import type { Collidable, BoundingVolume } from "../../interfaces/index.js";
import { BoundingBox, Collision } from "../../physix/index.js";
import type { Frustum } from "../../math/index.js";
import { MathPool, Vector3D } from "../../math/index.js";

/**
 * Configuration options for an octree node.
 */
export interface OctreeOptions {
  /** The maximum depth of the octree. Defaults to 8. */
  maxDepth?: number;
  /** The maximum number of objects in a node before it subdivides. Defaults to 10. */
  maxObjects?: number;
}

/**
 * A node in the octree.
 */
export class OctreeNode {
  /** The children of this node. */
  public children: OctreeNode[] = [];
  /** The objects stored in this node. */
  public objects: Collidable[] = [];

  private _depth: number;
  private _maxDepth: number;
  private _maxObjects: number;

  private static _nodePool: OctreeNode[] = [];

  public static acquire(
    boundsMin: Vector3D,
    boundsMax: Vector3D,
    depth: number,
    options: OctreeOptions,
  ): OctreeNode {
    const node = this._nodePool.pop();
    if (node) {
      node.bounds.min.copyFrom(boundsMin);
      node.bounds.max.copyFrom(boundsMax);
      node.bounds.center.copyFrom(boundsMin).add(boundsMax).scale(0.5);
      node._depth = depth;
      node._maxDepth = options.maxDepth ?? 8;
      node._maxObjects = options.maxObjects ?? 10;
      node.objects.length = 0;
      node.children.length = 0;
      return node;
    }
    return new OctreeNode(
      new BoundingBox(
        new Vector3D(boundsMin.x, boundsMin.y, boundsMin.z),
        new Vector3D(boundsMax.x, boundsMax.y, boundsMax.z),
      ),
      depth,
      options,
    );
  }

  public static release(node: OctreeNode): void {
    node.objects.length = 0;
    for (let i = 0; i < node.children.length; i++) {
      OctreeNode.release(node.children[i]!);
    }
    node.children.length = 0;
    this._nodePool.push(node);
  }

  /**
   * Creates a new OctreeNode.
   * @param bounds The bounds of this node.
   * @param depth The current depth of this node.
   * @param options The configuration options.
   */
  constructor(
    public bounds: BoundingBox,
    depth: number = 0,
    options: OctreeOptions = {},
  ) {
    const { maxDepth = 8, maxObjects = 10 } = options;
    this._depth = depth;
    this._maxDepth = maxDepth;
    this._maxObjects = maxObjects;
  }

  /**
   * Inserts an object into the octree.
   */
  public insert(obj: Collidable): boolean {
    if (undefined === obj.bounds) {
      return false;
    }

    if (false === this.bounds.containsVolume(obj.bounds)) {
      return false;
    }

    if (0 < this.children.length) {
      for (let i: number = 0; i < this.children.length; i++) {
        if (this.children[i]!.insert(obj)) {
          return true;
        }
      }
    }

    this.objects.push(obj);
    if (this.objects.length > this._maxObjects && this._depth < this._maxDepth) {
      this._subdivide();
    }

    return true;
  }

  private _subdivide(): void {
    // Guard against re-subdividing an already-subdivided node. Without this, a node whose own
    // fallback `objects` list (objects that don't fit any existing child -- e.g. ones spanning
    // multiple octants, or, since Octree.insert() grows `root.bounds` for out-of-range objects,
    // repeated growth on an already-subdivided root) crosses `_maxObjects` again would push a
    // SECOND set of 8 children computed from the current (possibly since-grown) bounds on top of
    // the existing 8, leaving two overlapping generations of children under one parent.
    if (0 < this.children.length) return;

    const min: Vector3D = this.bounds.min;
    const max: Vector3D = this.bounds.max;
    const center: Vector3D = MathPool.acquireVector().copyFrom(min).add(max).scale(0.5);

    const dims: number[][] = [
      [min.x, center.x],
      [center.x, max.x],
      [min.y, center.y],
      [center.y, max.y],
      [min.z, center.z],
      [center.z, max.z],
    ];

    for (let x: number = 0; x < 2; x++) {
      for (let y: number = 0; y < 2; y++) {
        for (let z: number = 0; z < 2; z++) {
          const childMinX = dims[0]?.[x] ?? 0;
          const childMinY = dims[2]?.[y] ?? 0;
          const childMinZ = dims[4]?.[z] ?? 0;
          const childMaxX = dims[1]?.[x] ?? 0;
          const childMaxY = dims[3]?.[y] ?? 0;
          const childMaxZ = dims[5]?.[z] ?? 0;

          const childMin = MathPool.acquireVector().set(childMinX, childMinY, childMinZ);
          const childMax = MathPool.acquireVector().set(childMaxX, childMaxY, childMaxZ);

          this.children.push(
            OctreeNode.acquire(childMin, childMax, this._depth + 1, {
              maxDepth: this._maxDepth,
              maxObjects: this._maxObjects,
            }),
          );

          MathPool.releaseVector(childMin);
          MathPool.releaseVector(childMax);
        }
      }
    }

    MathPool.releaseVector(center);

    // Process objects from the back to avoid shifting or creating new arrays
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj: Collidable = this.objects[i]!;
      let insertedInChild: boolean = false;
      for (let j = 0; j < this.children.length; j++) {
        if (this.children[j]!.insert(obj)) {
          insertedInChild = true;
          break;
        }
      }

      // If it went into a child, remove it from this node
      if (insertedInChild) {
        // Fast remove (swap with last element and pop)
        const lastIdx = this.objects.length - 1;
        if (i !== lastIdx) {
          this.objects[i] = this.objects[lastIdx]!;
        }
        this.objects.pop();
      }
    }
  }

  /**
   * Queries the octree for objects that intersect with the frustum.
   */
  public query(frustum: Frustum, result: Collidable[], intersectedNodes?: Set<OctreeNode>): void {
    if (!frustum.intersectsBox(this.bounds)) return;
    if (intersectedNodes) intersectedNodes.add(this);

    for (let i: number = 0; i < this.objects.length; i++) {
      const obj = this.objects[i]!;
      if (obj.bounds && frustum.intersectsVolume(obj.bounds)) {
        result.push(obj);
      }
    }
    for (let i: number = 0; i < this.children.length; i++) {
      this.children[i]!.query(frustum, result, intersectedNodes);
    }
  }

  /**
   * Queries the octree for objects that intersect with a ray.
   */
  public queryRay(
    ray: import("../../physix/index.js").Ray,
    result: Collidable[],
    intersectedNodes?: Set<OctreeNode>,
  ): void {
    if (ray.intersectsBox(this.bounds) < 0) return;
    if (intersectedNodes) intersectedNodes.add(this);

    for (let i: number = 0; i < this.objects.length; i++) {
      result.push(this.objects[i]!);
    }
    for (let i: number = 0; i < this.children.length; i++) {
      this.children[i]!.queryRay(ray, result, intersectedNodes);
    }
  }

  /**
   * Queries the octree for objects that intersect with a specific volume.
   */
  public queryVolume(volume: BoundingVolume, result: Collidable[]): void {
    if (!Collision.test(this.bounds, volume)) return;

    for (let i: number = 0; i < this.objects.length; i++) {
      const obj = this.objects[i]!;
      if (obj.isCollidable !== false && obj.bounds && Collision.test(obj.bounds, volume)) {
        result.push(obj);
      }
    }
    for (let i: number = 0; i < this.children.length; i++) {
      this.children[i]!.queryVolume(volume, result);
    }
  }

  /**
   * Removes an object from this node or its children.
   * Collapses child nodes back to the pool if remaining descendant objects <= maxObjects.
   * @param obj The object to remove.
   * @returns True if the object was found and removed.
   */
  public remove(obj: Collidable): boolean {
    const idx = this.objects.indexOf(obj);
    if (idx !== -1) {
      const lastIdx = this.objects.length - 1;
      if (idx !== lastIdx) {
        this.objects[idx] = this.objects[lastIdx]!;
      }
      this.objects.pop();
      if (this.children.length > 0) {
        this._tryCollapse();
      }
      return true;
    }

    if (this.children.length > 0) {
      let removed = false;
      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i]!;
        if (!obj.bounds || child.bounds.intersectsVolume(obj.bounds)) {
          if (child.remove(obj)) {
            removed = true;
            break;
          }
        }
      }

      if (!removed) {
        for (let i = 0; i < this.children.length; i++) {
          if (this.children[i]!.remove(obj)) {
            removed = true;
            break;
          }
        }
      }

      if (removed) {
        this._tryCollapse();
      }

      return removed;
    }

    return false;
  }

  private _tryCollapse(): void {
    if (this.children.length === 0) return;

    let total = this.objects.length;
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]!;
      child._tryCollapse();
      if (child.children.length > 0) return;
      total += child.objects.length;
    }

    if (total <= this._maxObjects) {
      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i]!;
        for (let j = 0; j < child.objects.length; j++) {
          this.objects.push(child.objects[j]!);
        }
        OctreeNode.release(child);
      }
      this.children.length = 0;
    }
  }

  public clear(): void {
    this.objects.length = 0;
    for (let i = 0; i < this.children.length; i++) {
      OctreeNode.release(this.children[i]!);
    }
    this.children.length = 0;
  }
}

/**
 * An octree for spatial partitioning.
 */
export class Octree {
  public root: OctreeNode;

  constructor(bounds: BoundingBox, options: OctreeOptions = {}) {
    this.root = new OctreeNode(bounds, 0, options);
  }

  /**
   * Removes an object from the octree.
   * @param obj The object to remove.
   * @returns True if found and removed.
   */
  public remove(obj: Collidable): boolean {
    return this.root.remove(obj);
  }

  public insert(obj: Collidable): boolean {
    if (this.root.insert(obj)) return true;
    if (!obj.bounds) return false;

    // The object's world bounds fall outside the octree's fixed root extent (e.g. a spawned or
    // teleported object beyond the initial world size). Dropping it here would leave it
    // permanently invisible: FrustumCuller._resetCulling marks every frustumCulled object as
    // culled up front, and only re-marks objects that a query() call actually returns as
    // in-frustum -- an object insert() never accepts is never returned. Grow the root AABB to
    // include it and retry instead.
    const radius = obj.bounds.getBroadRadius();
    const c = obj.bounds.center;
    const min = MathPool.acquireVector().set(c.x - radius, c.y - radius, c.z - radius);
    const max = MathPool.acquireVector().set(c.x + radius, c.y + radius, c.z + radius);
    this.root.bounds.min.min(min);
    this.root.bounds.max.max(max);
    this.root.bounds.center.copyFrom(this.root.bounds.min).add(this.root.bounds.max).scale(0.5);
    MathPool.releaseVector(min);
    MathPool.releaseVector(max);

    return this.root.insert(obj);
  }

  public query(
    frustum: Frustum,
    outResult: Collidable[],
    intersectedNodes?: Set<OctreeNode>,
  ): void {
    this.root.query(frustum, outResult, intersectedNodes);
  }

  public queryRay(
    ray: import("../../physix/index.js").Ray,
    outResult: Collidable[],
    intersectedNodes?: Set<OctreeNode>,
  ): void {
    this.root.queryRay(ray, outResult, intersectedNodes);
  }

  public queryVolume(volume: BoundingVolume, outResult: Collidable[]): void {
    this.root.queryVolume(volume, outResult);
  }

  public clear(): void {
    this.root.clear();
  }
}
