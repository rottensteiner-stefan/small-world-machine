import { Object3D } from "./Object3D.js";
import type { OctreeOptions } from "./culling/Octree.js";
import { Octree } from "./culling/Octree.js";
import type { Fog } from "./Fog.js";
import type { Vector3D } from "../math/index.js";
import type { BoundingBox, SpatialHash, Joint } from "../physix/index.js";
import { BoundingType, Topology, WireframeMode } from "../enums/index.js";
import { DirectionalLight } from "./lights/index.js";
import { SkinnedMesh } from "./animation/SkinnedMesh.js";
import type { Collidable } from "../interfaces/index.js";
import { compareDecals } from "./decals/DecalMath.js";
import type { Decal } from "./objects/Decal.js";

export interface RenderBatch {
  shaderId: string;
  topology: Topology;
  matUuid: string;
  wireframeMode?: WireframeMode;
  /** World width (m) of a line caster's shadow; `0` = 1-texel line (`RenderManifest.state.shadowWidth`). */
  shadowWidth?: number;
  objects: Object3D[];
  /** Consecutive frames this batch collected no object; the scene prunes it after `BATCH_IDLE_FRAMES`. */
  idleFrames?: number;
}

/** Empty opaque batches survive this many frames (cheap re-show) before the scene drops them. */
const BATCH_IDLE_FRAMES = 120;

export interface RenderList {
  opaqueLookup: Map<string, Map<Topology, Map<string, RenderBatch>>>;
  opaqueBatches: RenderBatch[];
  transparent: Object3D[];
  /** Box-projected decals, drawn after the opaque pass and before the transparent pass. */
  decals: Object3D[];
}

/**
 * A scene that holds a collection of 3D objects.
 */
export class Scene {
  public readonly root: Object3D = new Object3D("SceneRoot");

  public get objects(): Object3D[] {
    return this.root.children;
  }

  public staticOctree: Octree | undefined = undefined;
  public dynamicOctree: Octree | undefined = undefined;
  public spatialHash: SpatialHash | undefined = undefined;
  /**
   * Single registration channel for lightweight static colliders (e.g. `StaticCollider`)
   * that aren't part of the `Object3D` scene graph. All consumers resolve against ONE
   * structure derived from this channel:
   * - `updateStaticOctree()` auto-enters them into the static octree, so the
   *   `CollisionResolution` player/camera path, picking and frustum queries see them
   *   (no "ghost walls");
   * - `PhysicsSystem` drains this array into its broadphase, so rigid bodies collide with
   *   them.
   * Apps must call `updateStaticOctree()` after pushing colliders (same contract as adding
   * `isStatic` Object3D obstacles), or the octree-derived consumers lag behind.
   */
  public staticColliders: Collidable[] = [];
  /** Physics joints / articulated constraints evaluated by PhysicsSystem. */
  public joints: Joint[] = [];
  public fog?: Fog;

  /** How many objects `_collectVisible()` skipped this call because `occlusionCulled` was set
   * (WebGPU Hierarchical-Z culling, see docs/adr/0008-...). Reset at the top of
   * `getVisibleObjectsSorted()`; always 0 on WebGL1/WebGL2, where `occlusionCulled` is never
   * set. Reflects whichever of `getVisibleObjectsSorted()`'s per-frame callers (DepthPrePassGPU,
   * then MainRenderPass) ran last. */
  public lastOcclusionCulledCount = 0;

  /** Every `isVisible && inFrustum` object from the last `getVisibleObjectsSorted()` call --
   * i.e. `_collectVisible()`'s own visibility/frustum gate, captured as a byproduct of that
   * walk, before its `occlusionCulled` gate (`lastOcclusionCulledCount`'s check) filters
   * anything further. Populated for every object regardless of whether it has geometry/material
   * (unlike `RenderList`, which only batches drawable objects), so a consumer that needs "what's
   * in frustum" without "and also drawable" -- e.g. `WebGPURenderer._dispatchHzbTest()`'s HZB
   * candidate list, which must include currently-occlusion-culled objects too so they can be
   * re-tested and un-culled -- can read this instead of walking the scene tree a second time. */
  public lastFrustumVisibleObjects: Object3D[] = [];

  // Global Environment (IBL)
  public irradianceMap?: import("./textures/index.js").CubeTexture;
  public prefilterMap?: import("./textures/index.js").CubeTexture;
  public brdfLUT?: import("./textures/index.js").Texture;
  public environmentIntensity: number = 1.0;

  // Persistent cache for rendering
  private readonly _renderList: RenderList = {
    opaqueLookup: new Map(),
    opaqueBatches: [],
    transparent: [],
    decals: [],
  };

  // Objects (plus their full descendant subtree) removed since the last time a
  // renderer drained this queue. Consumed once per frame to release GPU resources
  // (e.g. geometry buffers) tied to objects that have actually left the scene graph,
  // as opposed to objects merely re-parented or temporarily hidden.
  private _pendingRemovals: Object3D[] = [];

  constructor() {
    // Lets Object3D.remove() queue GPU-resource release even when called on a nested object
    // directly (`someParent.remove(child)`) instead of through this method -- see
    // Object3D.pendingRemovalSink.
    this.root.pendingRemovalSink = (obj: Object3D): void => {
      this._collectSubtree(obj, this._pendingRemovals);
    };
  }

  public add(...objs: Object3D[]): void {
    this.root.add(...objs);
    this.markRenderListDirty();
  }

  public remove(...objs: Object3D[]): void {
    this.root.remove(...objs);
    this.markRenderListDirty();
  }

  private _collectSubtree(obj: Object3D, out: Object3D[]): void {
    out.push(obj);
    for (const child of obj.children) {
      this._collectSubtree(child, out);
    }
  }

  /**
   * Drains and returns the objects removed from this scene since the last call.
   * Renderers call this once per frame to release GPU resources tied to objects
   * that have actually left the scene graph.
   */
  public consumeRemovedObjects(): Object3D[] {
    if (0 === this._pendingRemovals.length) return this._pendingRemovals;
    const removed = this._pendingRemovals;
    this._pendingRemovals = [];
    return removed;
  }

  public initOctrees(bounds: BoundingBox, options: OctreeOptions = {}): void {
    this.staticOctree = new Octree(bounds, options);
    this.dynamicOctree = new Octree(bounds, options);
  }

  public getObjectByName(name: string): Object3D | undefined {
    // Avoid returning the hidden root itself
    const found = this.root.getObjectByName(name);
    return found === this.root ? undefined : found;
  }

  public update(deltaTime: number = 0): void {
    // 1. Update behaviors
    this._updateBehaviorsRecursive(this.root, deltaTime);
    // 2. Update matrices
    this.root.updateMatrixWorld();
    // 3. Compute skinning matrices. Must run after the full matrix pass above: a
    // SkinnedMesh's joints live elsewhere in the tree (siblings/cousins, not
    // descendants), so their worldMatrix isn't guaranteed to be current yet
    // during step 2's single top-down traversal.
    this._updateSkinnedMeshesRecursive(this.root);
    if (undefined !== this.dynamicOctree) {
      this.updateDynamicOctree();
    }
  }

  private _updateSkinnedMeshesRecursive(obj: Object3D): void {
    if (obj instanceof SkinnedMesh && obj.skeleton) {
      obj.skeleton.update(obj.worldMatrix);
    }
    for (const child of obj.children) {
      this._updateSkinnedMeshesRecursive(child);
    }
  }

  public updateLights(camera: import("../interfaces/index.js").CameraInterfaceData): void {
    this._updateLightsRecursive(this.root, camera);
  }

  private _updateLightsRecursive(
    obj: Object3D,
    camera: import("../interfaces/index.js").CameraInterfaceData,
  ): void {
    if (obj instanceof DirectionalLight) {
      obj.updateCascades(camera);
    }
    for (const child of obj.children) {
      this._updateLightsRecursive(child, camera);
    }
  }

  /**
   * Scene-wide reset of the WebGPU Hierarchical-Z occlusion flag (S3 DP-4A, teleport path): walks
   * the whole scene graph and sets `occlusionCulled = false` on every node. Called by
   * `SmallWorldMachine.notifyCameraTeleport()` so a cut/teleport cannot leave objects wrongly
   * culled on stale HZB state (the renderer-side `_occludedStreak` clear lives in
   * `HzbOcclusionSystem`/the renderer delegate). Always a no-op in effect on WebGL1/WebGL2, where
   * `occlusionCulled` is never set (see the field's contract on `Object3D`).
   */
  public resetOcclusionCulled(): void {
    this._resetOcclusionCulledRecursive(this.root);
  }

  private _resetOcclusionCulledRecursive(obj: Object3D): void {
    obj.occlusionCulled = false;
    for (let i = 0; i < obj.children.length; i++) {
      this._resetOcclusionCulledRecursive(obj.children[i]!);
    }
  }

  public updateStaticOctree(): void {
    if (!this.staticOctree) return;
    this.staticOctree.clear();
    this._addObjectToOctree(this.root, true);
    this._addStaticCollidersToOctree();
  }

  /**
   * R5 / D6 (Whack-a-Mole): mirrors the static-octree build for `staticColliders`, the
   * non-Object3D registration channel. Without this, an obstacle pushed to `staticColliders`
   * blocks rigid bodies (`PhysicsSystem` drains the array) but not the player/controller,
   * which resolves exclusively through the octrees — the "ghost wall" defect. The octree's
   * `queryVolume` honors `isCollidable`/`isCollidable === false`, so culling-only objects
   * (Decal etc., if ever registered here) stay non-obstacles automatically.
   */
  private _addStaticCollidersToOctree(): void {
    const octree = this.staticOctree!;
    for (let i = 0; i < this.staticColliders.length; i++) {
      const collider = this.staticColliders[i]!;
      if (collider instanceof Object3D && collider.geometry) {
        // Object3D-typed entries may hold stale bounds (e.g. moved since registration).
        collider.computeBounds();
      }
      if (collider.bounds) {
        octree.insert(collider);
      }
    }
  }

  public updateDynamicOctree(): void {
    if (!this.dynamicOctree) return;
    this.dynamicOctree.clear();
    this._addObjectToOctree(this.root, false);
  }

  /**
   * True for auto-generated debug visuals (e.g. `OctreeVisualizer`/`CollisionVisualizer` wireframes),
   * identified by the `debug_` name prefix convention. Centralized here so every consumer of this
   * convention checks it the same way, rather than each re-testing the prefix independently.
   */
  public static isDebugObject(obj: Object3D): boolean {
    return obj.name.startsWith("debug_");
  }

  private _addObjectToOctree(obj: Object3D, checkStatic: boolean): void {
    // Skip debug objects to avoid recursion and unnecessary processing
    if (Scene.isDebugObject(obj)) {
      return;
    }

    if (obj.isStatic === checkStatic) {
      if (obj.geometry) {
        obj.computeBounds();
        if (obj.bounds) {
          const targetOctree = checkStatic ? this.staticOctree : this.dynamicOctree;
          if (!targetOctree?.insert(obj)) {
            let bStr: string = "null";
            if (obj.bounds) {
              if (obj.bounds.type === BoundingType.BOX) {
                const b = obj.bounds;
                bStr = `${b.min.x},${b.min.y},${b.min.z} to ${b.max.x},${b.max.y},${b.max.z}`;
              } else {
                bStr = `non-box bounds (${obj.bounds.type})`;
              }
            }
            console.warn(
              `[Scene] Failed to add ${obj.name} to ${checkStatic ? "static" : "dynamic"} octree. Bounds: ${bStr}`,
            );
          } else {
            // console.log(`[Scene] Added ${obj.name} to ${checkStatic ? "static" : "dynamic"} octree.`);
          }
        }
      }
    }
    for (const child of obj.children) this._addObjectToOctree(child, checkStatic);
  }

  private _updateBehaviorsRecursive(obj: Object3D, deltaTime: number): void {
    for (let i = 0; i < obj.behaviors.length; i++) {
      const b = obj.behaviors[i]!;
      if (b.isActive) b.update(deltaTime);
      // detachBehavior() splices the list; if `b` (or an earlier-indexed sibling) removed itself
      // from within update(), the next behavior has shifted down into slot `i`. Re-visit `i` so
      // it isn't silently skipped -- this preserves attach order for the common case (many
      // showcases combine order-dependent behaviors, e.g. a mover before a LookAt) instead of
      // just reversing the loop.
      if (obj.behaviors[i] !== b) i--;
    }
    for (let i = 0; i < obj.children.length; i++) {
      this._updateBehaviorsRecursive(obj.children[i]!, deltaTime);
    }
  }

  private _lastCamX: number = NaN;
  private _lastCamY: number = NaN;
  private _lastCamZ: number = NaN;
  private _lastVp: Float32Array | undefined = undefined;

  /**
   * Invalidates the cached RenderList, forcing `getVisibleObjectsSorted()` to re-traverse
   * the scene graph on its next call.
   */
  public markRenderListDirty(): void {
    this._lastCamX = NaN;
  }

  /**
   * Returns visible objects, respecting BOTH user visibility and frustum state.
   * Separates opaque and transparent objects.
   * Opaque Grouping: shaderId -> topology -> matUuid -> Object3D[]
   * Transparent: Object3D[] sorted back-to-front
   */
  public getVisibleObjectsSorted(
    vp: Float32Array,
    camPos: Vector3D,
    forceRefresh: boolean = false,
  ): RenderList {
    if (
      !forceRefresh &&
      this._lastCamX === camPos.x &&
      this._lastCamY === camPos.y &&
      this._lastCamZ === camPos.z &&
      this._lastVp === vp
    ) {
      return this._renderList;
    }

    this._lastCamX = camPos.x;
    this._lastCamY = camPos.y;
    this._lastCamZ = camPos.z;
    this._lastVp = vp;

    // Clear the persistent list without destroying the structures (Monomorphism/GC optimization)
    this._renderList.transparent.length = 0;
    this._renderList.decals.length = 0;
    const batches = this._renderList.opaqueBatches;
    for (let i = 0; i < batches.length; i++) {
      batches[i]!.objects.length = 0;
    }
    this.lastOcclusionCulledCount = 0;
    this.lastFrustumVisibleObjects.length = 0;

    this._collectVisible(this.root, this._renderList);
    this._pruneIdleBatches(this._renderList);

    (this._renderList.decals as Decal[]).sort(compareDecals);

    // Sort transparent objects back-to-front
    this._renderList.transparent.sort((a, b) => {
      const aData = a.worldMatrix.data;
      const ax = aData[12]! - camPos.x;
      const ay = aData[13]! - camPos.y;
      const az = aData[14]! - camPos.z;
      const distA = ax * ax + ay * ay + az * az;

      const bData = b.worldMatrix.data;
      const bx = bData[12]! - camPos.x;
      const by = bData[13]! - camPos.y;
      const bz = bData[14]! - camPos.z;
      const distB = bx * bx + by * by + bz * bz;

      return distB - distA; // Furthest first
    });

    return this._renderList;
  }

  /**
   * Drops batches that stayed empty for `BATCH_IDLE_FRAMES` frames. Every material uuid (a clone
   * regenerates it) otherwise leaves an empty batch that is walked forever. Allocation-free.
   */
  private _pruneIdleBatches(renderList: RenderList): void {
    const batches = renderList.opaqueBatches;
    for (let i = batches.length - 1; i >= 0; i--) {
      const batch = batches[i]!;
      if (batch.objects.length > 0) {
        batch.idleFrames = 0;
        continue;
      }
      batch.idleFrames = (batch.idleFrames ?? 0) + 1;
      if (batch.idleFrames < BATCH_IDLE_FRAMES) continue;
      batches.splice(i, 1);
      const topologyMap = renderList.opaqueLookup.get(batch.shaderId);
      const matMap = topologyMap?.get(batch.topology);
      matMap?.delete(batch.matUuid);
      if (matMap && matMap.size === 0) topologyMap!.delete(batch.topology);
      if (topologyMap && topologyMap.size === 0) renderList.opaqueLookup.delete(batch.shaderId);
    }
  }

  private _collectVisible(obj: Object3D, renderList: RenderList): void {
    // Only proceed if object is visible
    if (!obj.isVisible) return;

    // Frustum Culling
    if (obj.frustumCulled && obj.bounds) {
      if (!obj.inFrustum) {
        return;
      }
    }

    this.lastFrustumVisibleObjects.push(obj);

    // Hierarchical-Z occlusion culling (WebGPU-only, see docs/adr/0008-...) -- a second,
    // independent gate: frustum-culled objects never reach here, and this never overrides
    // `inFrustum`. Always false on WebGL1/WebGL2, so this is a permanent no-op there.
    if (obj.occlusionCulled) {
      this.lastOcclusionCulledCount++;
      return;
    }

    if (
      (obj.geometry || (obj as Object3D & { positionBuffer?: unknown }).positionBuffer) &&
      obj.material
    ) {
      const manifest = obj.material.getRenderManifest();

      if (manifest.state?.isDecal) {
        renderList.decals.push(obj);
      } else if (manifest.state?.transparent) {
        renderList.transparent.push(obj);
      } else {
        const shaderId = manifest.shaderId;
        // AbstractGeometry always sets .topology explicitly, so this only matters for
        // hand-built GeometryData that skips it -- default to triangles rather than
        // guessing from index count (a 2-index geometry isn't reliably a line).
        const topology = manifest.state?.topology || obj.geometry?.topology || Topology.DEFAULT;
        const matUuid = obj.material.uuid;
        const wireframeMode = manifest.state?.wireframeMode || WireframeMode.DEFAULT;
        const shadowWidth = manifest.state?.shadowWidth ?? 0;

        if (!renderList.opaqueLookup.has(shaderId))
          renderList.opaqueLookup.set(shaderId, new Map());
        const topologyMap = renderList.opaqueLookup.get(shaderId)!;

        if (!topologyMap.has(topology)) topologyMap.set(topology, new Map());
        const matMap = topologyMap.get(topology)!;

        let batch = matMap.get(matUuid);
        if (!batch) {
          batch = { shaderId, topology, matUuid, wireframeMode, shadowWidth, objects: [] };
          matMap.set(matUuid, batch);
          renderList.opaqueBatches.push(batch);
        } else {
          // The batch is reused to save GC, but properties like wireframeMode can change at runtime!
          batch.wireframeMode = wireframeMode;
          batch.shadowWidth = shadowWidth;
        }
        batch!.objects.push(obj);
      }
    }

    for (let i: number = 0; i < obj.children.length; i++) {
      this._collectVisible(obj.children[i]!, renderList);
    }
  }

  public get octree(): Octree | undefined {
    return this.staticOctree;
  }
}
