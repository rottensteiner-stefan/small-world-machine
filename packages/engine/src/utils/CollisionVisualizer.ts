import { Color } from "../core/colors/index.js";
import { Object3D } from "../core/Object3D.js";
import { Scene } from "../core/Scene.js";
import { WireframeMaterial } from "../core/materials/index.js";
import { Cube, Sphere } from "../geometry/index.js";
import { BoundingType } from "../enums/index.js";

/**
 * Utility to visualize collision boundaries (AABBs and Spheres) in the scene.
 */
export class CollisionVisualizer {
  private _debugObjects: Map<string, Object3D> = new Map();
  private _cubeGeo: Cube;
  private _sphereGeo: Sphere;
  private _boxMat: WireframeMaterial;
  private _sphereMat: WireframeMaterial;

  constructor() {
    this._cubeGeo = new Cube({ size: 1 });
    this._sphereGeo = new Sphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    this._boxMat = new WireframeMaterial(new Color(0, 255, 0, 1)); // Green for boxes
    this._sphereMat = new WireframeMaterial(new Color(255, 255, 0, 1)); // Yellow for spheres
  }

  /**
   * Updates the debug visualization for the given scene.
   * Compares existing debug objects with current scene bounds and adds/removes/updates them.
   * @param scene The scene to visualize.
   */
  public update(scene: Scene): void {
    const activeUuids: Set<string> = new Set<string>();

    for (let i: number = 0; i < scene.objects.length; i++) {
      const obj: Object3D = scene.objects[i]!;
      // Don't visualize debug objects themselves
      if (Scene.isDebugObject(obj)) {
        continue;
      }
      this._traverse(obj, scene, activeUuids);
    }

    // Cleanup stale debug objects
    for (const [uuid, debugObj] of this._debugObjects.entries()) {
      if (!activeUuids.has(uuid)) {
        scene.remove(debugObj);
        this._debugObjects.delete(uuid);
      }
    }
  }

  /**
   * Recursively traverses the object hierarchy to find and update bounds.
   * @param obj The current object to check.
   * @param scene The scene to add debug objects to.
   * @param activeUuids Set to track which debug objects are still needed.
   * @private
   */
  private _traverse(obj: Object3D, scene: Scene, activeUuids: Set<string>): void {
    if (obj.bounds) {
      let debugObj: Object3D | undefined = this._debugObjects.get(obj.uuid);
      if (undefined === debugObj) {
        debugObj = new Object3D(`debug_${obj.uuid}`);
        debugObj.frustumCulled = false;
        if (BoundingType.BOX === obj.bounds.type) {
          debugObj.geometry = this._cubeGeo.getGeometryData();
          debugObj.material = this._boxMat;
        } else {
          debugObj.geometry = this._sphereGeo.getGeometryData();
          debugObj.material = this._sphereMat;
        }
        scene.add(debugObj);
        this._debugObjects.set(obj.uuid, debugObj);
      }

      // Sync transforms
      if (BoundingType.BOX === obj.bounds.type) {
        const box = obj.bounds;
        const sizeX: number = box.max.x - box.min.x;
        const sizeY: number = box.max.y - box.min.y;
        const sizeZ: number = box.max.z - box.min.z;
        debugObj.position.copyFrom(box.center);
        debugObj.scale.set(sizeX, sizeY, sizeZ);
      } else {
        const r = obj.bounds.getBroadRadius();
        debugObj.position.copyFrom(obj.bounds.center);
        debugObj.scale.set(r * 2, r * 2, r * 2);
      }
      debugObj.updateMatrixWorld();
      activeUuids.add(obj.uuid);
    }

    for (let i: number = 0; i < obj.children.length; i++) {
      this._traverse(obj.children[i]!, scene, activeUuids);
    }
  }
}
