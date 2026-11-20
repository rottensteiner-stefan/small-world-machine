import { Object3D } from "./Object3D.js";
import type { OctreeOptions } from "./culling/Octree.js";
import { Octree } from "./culling/Octree.js";
import type { Fog } from "./Fog.js";
import type { Vector3D } from "../math/index.js";
import type { BoundingBox, SpatialHash, Joint } from "../physix/index.js";
import { BoundingType, ShaderFlag, Topology, WireframeMode } from "../enums/index.js";
import type { AbstractLight, DirectionalLight } from "./lights/index.js";
import type { SkinnedMesh } from "./animation/SkinnedMesh.js";
import type { FogVolume } from "./objects/FogVolume.js";
import type { Collidable } from "../interfaces/index.js";
import { compareDecals } from "./decals/DecalMath.js";
import type { Decal } from "./objects/Decal.js";
import type { AbstractMaterial } from "./materials/AbstractMaterial.js";
import {
  MANIFEST_FLAG_TRANSMISSION,
  type RenderManifest,
} from "../renderers/shaders/RenderManifest.js";

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
  /** Scene-internal fill cursor of `objects` during a collection (see `getVisibleObjectsSorted`). */
  fill?: number;
  /** Scene-internal fast-lookup back-reference to the owning material and flat lookup key. */
  materialRef?: AbstractMaterial;
  lookupKey?: string;
}

/** Empty opaque batches survive this many frames (cheap re-show) before the scene drops them. */
const BATCH_IDLE_FRAMES = 120;

/**
 * Distance table of the running transparent-object sort in `Scene.getVisibleObjectsSorted`.
 * Only ever set synchronously around `Array.prototype.sort` (module-level comparator avoids
 * per-frame closure allocations).
 */
let _sortTransparentDists: Float64Array | undefined;

function compareTransparentIndices(a: number, b: number): number {
  return _sortTransparentDists![b]! - _sortTransparentDists![a]!;
}

export interface RenderList {
  opaqueLookup: Map<string, RenderBatch>;
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

  public get objects(): readonly Object3D[] {
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
  /** Collection cursors (see `getVisibleObjectsSorted`): fill index of the frustum list and the
   * last material whose manifest was built, so a run of objects sharing it builds it once. */
  private _frustumFill: number = 0;
  private _transparentFill: number = 0;
  private _decalsFill: number = 0;
  private _transparentDists: Float64Array = new Float64Array(64);
  private _transparentOrder: number[] = [];
  private _transparentScratch: Object3D[] = [];
  private _collectMaterial: AbstractMaterial | undefined = undefined;
  private _collectManifest: RenderManifest | undefined = undefined;
  private readonly _fastBatchByMat: Map<AbstractMaterial, RenderBatch> = new Map();

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

  // Scene-registered node lists maintained on attach/detach (avoids per-frame whole-tree walks).
  private readonly _lights: AbstractLight[] = [];
  private readonly _directionalLights: DirectionalLight[] = [];
  private readonly _fogVolumes: FogVolume[] = [];
  private readonly _skinnedMeshes: SkinnedMesh[] = [];
  private readonly _behaviorNodes: Object3D[] = [];
  private readonly _physicsNodes: Object3D[] = [];

  public get lights(): readonly AbstractLight[] {
    return this._lights;
  }

  public get directionalLights(): readonly DirectionalLight[] {
    return this._directionalLights;
  }

  public get fogVolumes(): readonly FogVolume[] {
    return this._fogVolumes;
  }

  public get skinnedMeshes(): readonly SkinnedMesh[] {
    return this._skinnedMeshes;
  }

  public get behaviorNodes(): readonly Object3D[] {
    return this._behaviorNodes;
  }

  public get physicsNodes(): readonly Object3D[] {
    return this._physicsNodes;
  }

  /** @internal */
  public _registerLight(light: AbstractLight): void {
    this._lights.push(light);
  }

  /** @internal */
  public _unregisterLight(light: AbstractLight): void {
    Scene._unregisterFrom(this._lights, light);
  }

  /** @internal */
  public _registerDirectionalLight(light: DirectionalLight): void {
    this._directionalLights.push(light);
  }

  /** @internal */
  public _unregisterDirectionalLight(light: DirectionalLight): void {
    Scene._unregisterFrom(this._directionalLights, light);
  }

  /** @internal */
  public _registerFogVolume(volume: FogVolume): void {
    this._fogVolumes.push(volume);
  }

  /** @internal */
  public _unregisterFogVolume(volume: FogVolume): void {
    Scene._unregisterFrom(this._fogVolumes, volume);
  }

  /** @internal */
  public _registerSkinnedMesh(mesh: SkinnedMesh): void {
    this._skinnedMeshes.push(mesh);
  }

  /** @internal */
  public _unregisterSkinnedMesh(mesh: SkinnedMesh): void {
    Scene._unregisterFrom(this._skinnedMeshes, mesh);
  }

  /** @internal */
  public _registerBehaviorNode(node: Object3D): void {
    this._behaviorNodes.push(node);
  }

  /** @internal */
  public _unregisterBehaviorNode(node: Object3D): void {
    Scene._unregisterFrom(this._behaviorNodes, node);
  }

  /** @internal */
  public _registerPhysicsNode(node: Object3D): void {
    this._physicsNodes.push(node);
  }

  /** @internal */
  public _unregisterPhysicsNode(node: Object3D): void {
    Scene._unregisterFrom(this._physicsNodes, node);
  }

  private static _unregisterFrom<T>(arr: T[], item: T): void {
    const idx = arr.indexOf(item);
    if (idx !== -1) arr.splice(idx, 1);
  }

  constructor() {
    this.root._setScene(this);
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
    // 1. Update behaviors (flat list of scene-registered nodes with behaviors; re-check slot on
    // self-removal so neither the behavior loop nor the node loop skips the shifted element).
    const behaviorNodes = this._behaviorNodes;
    for (let i = 0; i < behaviorNodes.length; i++) {
      const obj = behaviorNodes[i]!;
      const behaviors = obj.behaviors;
      for (let j = 0; j < behaviors.length; j++) {
        const b = behaviors[j]!;
        if (b.isActive) b.update(deltaTime);
        if (behaviors[j] !== b) j--;
      }
      if (behaviorNodes[i] !== obj) i--;
    }
    // 2. Update matrices
    this.root.updateMatrixWorld();
    // 3. Compute skinning matrices. Must run after the full matrix pass above: a
    // SkinnedMesh's joints live elsewhere in the tree (siblings/cousins, not
    // descendants), so their worldMatrix isn't guaranteed to be current yet
    // during step 2's single top-down traversal.
    const skinned = this._skinnedMeshes;
    for (let i = 0; i < skinned.length; i++) {
      const mesh = skinned[i]!;
      if (mesh.skeleton) {
        mesh.skeleton.update(mesh.worldMatrix);
      }
    }
    if (undefined !== this.dynamicOctree) {
      this.updateDynamicOctree();
    }
  }

  public updateLights(camera: import("../interfaces/index.js").CameraInterfaceData): void {
    const dirLights = this._directionalLights;
    for (let i = 0; i < dirLights.length; i++) {
      dirLights[i]!.updateCascades(camera);
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

    // Refill the persistent lists by index and trim once at the end: `length = 0` would make V8
    // drop the backing stores, so the (thousands-long) lists regrew from zero every frame.
    this._transparentFill = 0;
    this._decalsFill = 0;
    const batches = this._renderList.opaqueBatches;
    for (let i = 0; i < batches.length; i++) {
      batches[i]!.fill = 0;
    }
    this.lastOcclusionCulledCount = 0;
    this._frustumFill = 0;
    this._collectMaterial = undefined;
    this._collectManifest = undefined;

    this._collectVisible(this.root, this._renderList);
    this._renderList.transparent.length = this._transparentFill;
    this._renderList.decals.length = this._decalsFill;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      batch.objects.length = batch.fill ?? 0;
    }
    this.lastFrustumVisibleObjects.length = this._frustumFill;
    this._collectMaterial = undefined;
    this._collectManifest = undefined;
    this._pruneIdleBatches(this._renderList);

    (this._renderList.decals as Decal[]).sort(compareDecals);

    // Sort transparent objects back-to-front using precomputed distances (Schwartzian sort, zero-GC).
    const transparent = this._renderList.transparent;
    const transparentCount = transparent.length;
    if (transparentCount > 1) {
      if (this._transparentDists.length < transparentCount) {
        let cap = this._transparentDists.length;
        while (cap < transparentCount) cap *= 2;
        this._transparentDists = new Float64Array(cap);
      }
      const dists = this._transparentDists;
      const order = this._transparentOrder;
      const cx = camPos.x;
      const cy = camPos.y;
      const cz = camPos.z;
      for (let i = 0; i < transparentCount; i++) {
        const d = transparent[i]!.worldMatrix.data;
        const dx = d[12]! - cx;
        const dy = d[13]! - cy;
        const dz = d[14]! - cz;
        dists[i] = dx * dx + dy * dy + dz * dz;
        order[i] = i;
      }
      order.length = transparentCount;
      _sortTransparentDists = dists;
      order.sort(compareTransparentIndices);
      _sortTransparentDists = undefined;
      const scratch = this._transparentScratch;
      for (let i = 0; i < transparentCount; i++) {
        scratch[i] = transparent[order[i]!]!;
      }
      scratch.length = transparentCount;
      for (let i = 0; i < transparentCount; i++) {
        transparent[i] = scratch[i]!;
      }
    }

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
      if (batch.lookupKey !== undefined) {
        renderList.opaqueLookup.delete(batch.lookupKey);
      }
      if (
        batch.materialRef !== undefined &&
        this._fastBatchByMat.get(batch.materialRef) === batch
      ) {
        this._fastBatchByMat.delete(batch.materialRef);
      }
    }
  }

  private _collectVisible(obj: Object3D, renderList: RenderList): void {
    // Only proceed if object is visible
    if (!obj.isVisible) return;

    // Frustum Culling gates THIS node's own inclusion only — it must never prune the subtree.
    // A child can be independently in-frustum while its parent's bounds failed (parent bounds
    // are NOT auto-unioned with children in this engine; stale/manual bounds are possible), so
    // skipping the recursion here would swallow a visible child. The per-child gate is a cheap
    // boolean, so descending a culled branch is negligible. (HZB occlusion below IS monotonic w.r.t.
    // containment and stays a genuine subtree-skip.)
    if (obj.frustumCulled && obj.bounds && !obj.inFrustum) {
      this._collectVisibleChildren(obj, renderList);
      return;
    }

    this.lastFrustumVisibleObjects[this._frustumFill++] = obj;

    // Hierarchical-Z occlusion culling (WebGPU-only, see docs/adr/0008-...) -- a second,
    // independent gate: frustum-culled objects never reach here, and this never overrides
    // `inFrustum`. Always false on WebGL1/WebGL2, so this is a permanent no-op there.
    if (obj.occlusionCulled) {
      this.lastOcclusionCulledCount++;
      return;
    }

    if ((obj.geometry || obj.positionBuffer) && obj.material) {
      // Scene order keeps parts sharing a material together: build each manifest once per run.
      if (obj.material !== this._collectMaterial) {
        this._collectMaterial = obj.material;
        this._collectManifest = obj.material.getRenderManifest();
      }
      const manifest = this._collectManifest!;
      const isTransmission =
        manifest.flagMask !== undefined
          ? (manifest.flagMask & MANIFEST_FLAG_TRANSMISSION) !== 0
          : manifest.flags?.includes(ShaderFlag.TRANSMISSION) === true;

      if (manifest.state?.isDecal) {
        renderList.decals[this._decalsFill++] = obj;
      } else if (manifest.state?.transparent) {
        renderList.transparent[this._transparentFill++] = obj;
      } else if (isTransmission) {
        // KHR_materials_transmission: the fragment block samples `u_opaqueMap`, which the
        // renderers only populate via the opaque-scene capture of the TRANSPARENT pass
        // (`copyToOpaqueTexture` / `captureOpaqueTexture`). A transmission material left in the
        // opaque list samples the white default texture and blows out flat white (Showcase 50,
        // ABeautifulGame pawn finials). Classifying it as transparent is the shader's own
        // contract on every tier; the fragment outputs full opacity, so the blend pass renders
        // it byte-identically to opaque apart from the refraction capture.
        renderList.transparent[this._transparentFill++] = obj;
      } else {
        const shaderId = manifest.shaderId;
        // AbstractGeometry always sets .topology explicitly, so this only matters for
        // hand-built GeometryData that skips it -- default to triangles rather than
        // guessing from index count (a 2-index geometry isn't reliably a line).
        const topology = manifest.state?.topology || obj.geometry?.topology || Topology.DEFAULT;
        const wireframeMode = manifest.state?.wireframeMode || WireframeMode.DEFAULT;
        const shadowWidth = manifest.state?.shadowWidth ?? 0;

        let batch = this._fastBatchByMat.get(obj.material);
        if (!batch || batch.topology !== topology || batch.shaderId !== shaderId) {
          const matUuid = obj.material.uuid;
          const key = `${shaderId}|${topology}|${matUuid}`;
          batch = renderList.opaqueLookup.get(key);
          if (!batch) {
            batch = {
              shaderId,
              topology,
              matUuid,
              wireframeMode,
              shadowWidth,
              objects: [],
              fill: 0,
              materialRef: obj.material,
              lookupKey: key,
            };
            renderList.opaqueLookup.set(key, batch);
            renderList.opaqueBatches.push(batch);
            if (!this._fastBatchByMat.has(obj.material)) {
              this._fastBatchByMat.set(obj.material, batch);
            }
          } else {
            batch.wireframeMode = wireframeMode;
            batch.shadowWidth = shadowWidth;
          }
        } else {
          // The batch is reused to save GC, but properties like wireframeMode can change at runtime!
          batch.wireframeMode = wireframeMode;
          batch.shadowWidth = shadowWidth;
        }
        const fill = batch.fill ?? 0;
        batch.objects[fill] = obj;
        batch.fill = fill + 1;
      }
    }

    this._collectVisibleChildren(obj, renderList);
  }

  /**
   * Recurses visibility collection into `obj`'s children — shared by the normal path and the
   * frustum-failed-parent path (containment fix, see `_collectVisible` note above).
   */
  private _collectVisibleChildren(obj: Object3D, renderList: RenderList): void {
    for (let i: number = 0; i < obj.children.length; i++) {
      this._collectVisible(obj.children[i]!, renderList);
    }
  }

  public get octree(): Octree | undefined {
    return this.staticOctree;
  }
}
