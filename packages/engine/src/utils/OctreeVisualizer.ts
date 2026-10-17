import { Color } from "../core/colors/index.js";
import { Object3D } from "../core/Object3D.js";
import type { Scene } from "../core/Scene.js";
import type { OctreeNode } from "../core/culling/Octree.js";
import { WireframeMaterial } from "../core/materials/index.js";
import { Cube } from "../geometry/index.js";
import type { BoundingBox } from "../physix/index.js";

/**
 * Utility to visualize the Octree structure in the scene.
 */
export class OctreeVisualizer {
  private _debugObjects: Object3D[] = [];
  private _cubeGeo: Cube;
  private _nodeMat: WireframeMaterial;
  private _activeNodeMat: WireframeMaterial;
  private _dynamicNodeMat: WireframeMaterial;

  constructor() {
    this._cubeGeo = new Cube({ size: 1 });
    this._nodeMat = new WireframeMaterial(new Color(100, 100, 100, 0.5)); // Gray for static nodes
    this._activeNodeMat = new WireframeMaterial(new Color(0, 255, 255, 1)); // Cyan for active nodes
    this._dynamicNodeMat = new WireframeMaterial(new Color(255, 165, 0, 0.5)); // Orange for dynamic nodes
  }

  /**
   * Updates the debug visualization for the octrees in the given scene.
   * @param scene The scene containing the octrees.
   * @param activeNodes Optional list of nodes that are currently active (intersected by frustum).
   */
  public update(scene: Scene, activeNodes: Set<OctreeNode> = new Set()): void {
    if (!scene.staticOctree && !scene.dynamicOctree) {
      this._clear(scene);
      return;
    }

    let objIndex: number = 0;

    // Visualize Static Octree
    if (scene.staticOctree) {
      this._traverse(scene.staticOctree.root, scene, activeNodes, (node, isActive) => {
        objIndex = this._updateDebugObject(node, isActive, this._nodeMat, objIndex, scene);
      });
    }

    // Visualize Dynamic Octree
    if (scene.dynamicOctree) {
      this._traverse(scene.dynamicOctree.root, scene, activeNodes, (node, isActive) => {
        objIndex = this._updateDebugObject(node, isActive, this._dynamicNodeMat, objIndex, scene);
      });
    }

    // Remove extra debug objects
    while (this._debugObjects.length > objIndex) {
      const debugObj = this._debugObjects.pop();
      if (debugObj) {
        scene.remove(debugObj);
      }
    }
  }

  /**
   * Updates or creates a debug object for a node.
   * @private
   */
  private _updateDebugObject(
    node: OctreeNode,
    isActive: boolean,
    defaultMat: WireframeMaterial,
    objIndex: number,
    scene: Scene,
  ): number {
    let debugObj: Object3D;
    if (objIndex < this._debugObjects.length) {
      debugObj = this._debugObjects[objIndex]!;
    } else {
      debugObj = new Object3D(`debug_octree_${objIndex}`);
      debugObj.frustumCulled = false;
      debugObj.geometry = this._cubeGeo.getGeometryData();
      this._debugObjects.push(debugObj);
      scene.add(debugObj);
    }

    debugObj.material = isActive ? this._activeNodeMat : defaultMat;

    const box: BoundingBox = node.bounds;
    const sizeX: number = box.max.x - box.min.x;
    const sizeY: number = box.max.y - box.min.y;
    const sizeZ: number = box.max.z - box.min.z;

    debugObj.position.copyFrom(box.center);
    debugObj.scale.set(sizeX, sizeY, sizeZ);
    debugObj.updateMatrixWorld();

    return objIndex + 1;
  }

  /**
   * Clears all debug objects from the scene.
   * @param scene The scene to clear.
   * @private
   */
  private _clear(scene: Scene): void {
    for (const debugObj of this._debugObjects) {
      scene.remove(debugObj);
    }
    this._debugObjects = [];
  }

  /**
   * Recursively traverses the octree nodes.
   * @private
   */
  private _traverse(
    node: OctreeNode,
    scene: Scene,
    activeNodes: Set<OctreeNode>,
    callback: (node: OctreeNode, isActive: boolean) => void,
  ): void {
    callback(node, activeNodes.has(node));

    for (let i: number = 0; i < node.children.length; i++) {
      this._traverse(node.children[i]!, scene, activeNodes, callback);
    }
  }
}
