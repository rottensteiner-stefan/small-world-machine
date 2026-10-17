import type { Object3D } from "../Object3D.js";
import type { Scene } from "../Scene.js";
import type { OctreeNode } from "./Octree.js";
import type { Matrix4 } from "../../math/index.js";
import { Frustum } from "../../math/index.js";
import type { Collidable } from "../../interfaces/index.js";

/**
 * Handles frustum culling for objects in a scene.
 */
export class FrustumCuller {
  private _frustum: Frustum = new Frustum();
  private _queryHits: Collidable[] = [];

  /** The octree nodes that were intersected during the last cull operation. */
  public lastIntersectedNodes: Set<OctreeNode> = new Set();

  /** The number of visible objects during the last cull operation. */
  public lastVisibleCount: number = 0;

  /**
   * Culls objects in the scene that are outside the camera frustum.
   */
  public cull(scene: Scene, vpMatrix: Matrix4): number {
    scene.markRenderListDirty();
    this._frustum.setFromMatrix(vpMatrix);
    this.lastIntersectedNodes.clear();

    // Reset culling state for all objects
    this._resetCulling(scene.root);

    if (scene.staticOctree || scene.dynamicOctree) {
      if (scene.staticOctree) {
        this._queryHits.length = 0;
        scene.staticOctree.query(this._frustum, this._queryHits, this.lastIntersectedNodes);
        const hits = this._queryHits;
        const hitLen = hits.length;
        for (let i = 0; i < hitLen; i++) {
          const obj = hits[i] as Object3D;
          if (obj.isVisible) {
            obj.inFrustum = true;
          }
        }
      }
      if (scene.dynamicOctree) {
        this._queryHits.length = 0;
        scene.dynamicOctree.query(this._frustum, this._queryHits, this.lastIntersectedNodes);
        const hits = this._queryHits;
        const hitLen = hits.length;
        for (let i = 0; i < hitLen; i++) {
          const obj = hits[i] as Object3D;
          if (obj.isVisible) {
            obj.inFrustum = true;
          }
        }
      }

      const count: number = this._countVisible(scene.root);

      this.lastVisibleCount = count;
      return count;
    }

    // Fallback without octrees
    let visibleCount: number = 0;
    for (let i: number = 0; i < scene.objects.length; i++) {
      visibleCount += this._checkNode(scene.objects[i]!);
    }

    this.lastVisibleCount = visibleCount;
    return visibleCount;
  }

  private _resetCulling(obj: Object3D): void {
    obj.inFrustum = !(obj.frustumCulled && obj.bounds);
    for (let i: number = 0; i < obj.children.length; i++) {
      this._resetCulling(obj.children[i]!);
    }
  }

  private _countVisible(obj: Object3D): number {
    let count: number = obj.isVisible && obj.inFrustum ? 1 : 0;
    for (let i: number = 0; i < obj.children.length; i++) {
      count += this._countVisible(obj.children[i]!);
    }
    return count;
  }

  private _checkNode(obj: Object3D): number {
    if (obj.isVisible && obj.frustumCulled && obj.bounds) {
      obj.inFrustum = this._frustum.intersectsVolume(obj.bounds);
    } else {
      obj.inFrustum = true;
    }

    const visible = obj.isVisible && obj.inFrustum;
    let count = visible ? 1 : 0;
    for (let i: number = 0; i < obj.children.length; i++) {
      count += this._checkNode(obj.children[i]!);
    }
    return count;
  }
}
