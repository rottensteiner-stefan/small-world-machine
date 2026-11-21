import { Object3D } from "../Object3D.js";
import type { Scene } from "../Scene.js";
import type { Bone } from "./Bone.js";
import { MAX_SKINNED_BONES, Skeleton } from "./Skeleton.js";
import { Matrix4, MathPool } from "../../math/index.js";
import { BoundingBox } from "../../physix/index.js";

/**
 * A mesh that is deformed by a skeletal hierarchy via GPU skinning.
 */
export class SkinnedMesh extends Object3D {
  /** The skeleton associated with this skinned mesh. */
  public skeleton?: Skeleton;
  /** The initial bind matrix of the mesh. */
  public bindMatrix: Matrix4 = new Matrix4();
  /**
   * Per-mesh flattened bone matrices (`bones.length * 16`), isolated from other `SkinnedMesh`es
   * that share the same `Skeleton` instance (AN03).
   */
  public boneMatrices: Float32Array = new Float32Array(16);

  private _lastBoundsBoneMatrices: Float32Array | undefined = undefined;
  private _lastBoundsWorldMatrix: Float32Array = new Float32Array(16);
  private _hasBoundsSnapshot: boolean = false;

  constructor(name?: string) {
    super(name);
  }

  protected override _onEnterScene(scene: Scene): void {
    super._onEnterScene(scene);
    scene._registerSkinnedMesh(this);
  }

  protected override _onExitScene(scene: Scene): void {
    scene._unregisterSkinnedMesh(this);
    super._onExitScene(scene);
  }

  /**
   * Binds a skeleton to this mesh and sizes its per-mesh `boneMatrices` buffer.
   */
  public bind(skeleton: Skeleton, bindMatrix?: Matrix4): void {
    this.skeleton = skeleton;
    const requiredFloats = Math.max(1, skeleton.bones.length) * 16;
    if (this.boneMatrices.length !== requiredFloats) {
      this.boneMatrices = new Float32Array(requiredFloats);
    }
    this._hasBoundsSnapshot = false;
    if (bindMatrix) {
      this.bindMatrix.data.set(bindMatrix.data);
    }
  }

  /**
   * Computes this mesh's isolated `boneMatrices` from its skeleton and refreshes pose-aware bounds
   * whenever the bone pose or world matrix changed since the last bounds update (AN03 / AN04).
   * Zero-allocation in steady state.
   */
  public updateSkinning(): void {
    if (!this.skeleton) return;
    const requiredFloats = Math.max(1, this.skeleton.bones.length) * 16;
    if (this.boneMatrices.length !== requiredFloats) {
      this.boneMatrices = new Float32Array(requiredFloats);
      this._hasBoundsSnapshot = false;
    }
    this.skeleton.update(this.worldMatrix, this.boneMatrices);

    if (!this.isCollidable || !this.geometry) return;

    const bm = this.boneMatrices;
    const wm = this.worldMatrix.data;
    let dirty = !this.bounds || !this._hasBoundsSnapshot;
    if (!dirty) {
      const prevBm = this._lastBoundsBoneMatrices;
      const prevWm = this._lastBoundsWorldMatrix;
      if (!prevBm || prevBm.length !== bm.length) {
        dirty = true;
      } else {
        for (let i = 0; i < 16; i++) {
          if (wm[i] !== prevWm[i]) {
            dirty = true;
            break;
          }
        }
        if (!dirty) {
          for (let i = 0; i < bm.length; i++) {
            if (bm[i] !== prevBm[i]) {
              dirty = true;
              break;
            }
          }
        }
      }
    }

    if (dirty) {
      this.computeBounds();
      if (!this._lastBoundsBoneMatrices || this._lastBoundsBoneMatrices.length !== bm.length) {
        this._lastBoundsBoneMatrices = new Float32Array(bm.length);
      }
      this._lastBoundsBoneMatrices.set(bm);
      this._lastBoundsWorldMatrix.set(wm);
      this._hasBoundsSnapshot = true;
    }
  }

  /** @inheritdoc */
  protected override _rebindAfterClone(
    cloneMap: Map<Object3D, Object3D>,
    skeletonMap: Map<object, object>,
  ): void {
    this._lastBoundsBoneMatrices = undefined;
    this._lastBoundsWorldMatrix = new Float32Array(16);
    this._hasBoundsSnapshot = false;
    this.boneMatrices = new Float32Array(16);

    const origSkeleton = this.skeleton;
    if (!origSkeleton) return;

    let targetSkeleton = skeletonMap.get(origSkeleton) as Skeleton | undefined;
    if (!targetSkeleton) {
      let anyRebound = false;
      const reboundBones: Bone[] = new Array(origSkeleton.bones.length);
      for (let i = 0; i < origSkeleton.bones.length; i++) {
        const origBone = origSkeleton.bones[i]!;
        const clonedBone = cloneMap.get(origBone) as Bone | undefined;
        if (clonedBone) {
          reboundBones[i] = clonedBone;
          anyRebound = true;
        } else {
          reboundBones[i] = origBone;
        }
      }
      if (anyRebound) {
        const clonedInverses = origSkeleton.boneInverses.map((inv) => {
          const copy = new Matrix4();
          copy.data.set(inv.data);
          return copy;
        });
        targetSkeleton = new Skeleton(reboundBones, clonedInverses);
      } else {
        targetSkeleton = origSkeleton;
      }
      skeletonMap.set(origSkeleton, targetSkeleton);
    }

    this.bind(targetSkeleton, this.bindMatrix);
  }

  /**
   * Conservative pose-aware bounding box (F2-A). The bind-pose bounds inherited from
   * `Object3D.computeBounds()` cull a character that animates out of its bind pose (it can
   * be frustum-culled, HZB-occluded or excluded from shadow passes while visibly on screen).
   *
   * Every deformed vertex is `Σ w_i · bone.worldMatrix_i · inverseBind_i · v` (GPU skinning;
   * the mesh's own world transform cancels out through `Skeleton.update`'s `invMeshWorld`), so
   * the union over bones of `(bone.worldMatrix_i · inverseBind_i · localAABB corners)` is a
   * valid conservative superset AABB. Bounded cost: ≤ `MAX_SKINNED_BONES` bones × 8 corners,
   * allocation-free (pooled scratch).
   *
   * Conservativeness edge: the union is only a true superset if the bones were refreshed via
   * `Skeleton.update` with this mesh's exact current world matrix (model·invMeshWorld cancels)
   * and no residual/offset mesh transform is applied afterwards. Callers must refresh skeleton +
   * bounds in that order before any culling decision.
   */
  public override computeBounds(): this {
    // Shared Object3D contract: non-collidable objects carry no bounds (never culled).
    if (!this.isCollidable) {
      this.bounds = undefined;
      return this;
    }

    if (!this.geometry || !this.skeleton || 0 === this.skeleton.bones.length) {
      return super.computeBounds();
    }

    const localBounds = this.geometry.getBoundingVolume();
    if (!localBounds || !(localBounds instanceof BoundingBox)) {
      return super.computeBounds();
    }

    const minL = localBounds.min;
    const maxL = localBounds.max;

    const bones = this.skeleton.bones;
    const invBinds = this.skeleton.boneInverses;
    const boneCount = Math.min(bones.length, MAX_SKINNED_BONES);
    const m = MathPool.acquireMatrix();
    const scratch = MathPool.acquireVector();

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < boneCount; i++) {
      const bone = bones[i];
      if (!bone) continue;
      const invBind = invBinds[i] ?? bone.inverseBindMatrix;
      // M_i = bone.worldMatrix_i * inverseBind_i (the engine's skin transform, world space).
      Matrix4.multiply(bone.worldMatrix, invBind, m);
      // 8 corners of the local AABB, enumerated bitwise (allocation-free).
      for (let c = 0; c < 8; c++) {
        scratch.set(
          (c & 1) === 0 ? minL.x : maxL.x,
          (c & 2) === 0 ? minL.y : maxL.y,
          (c & 4) === 0 ? minL.z : maxL.z,
        );
        m.transformVector(scratch);
        const x = scratch.x;
        const y = scratch.y;
        const z = scratch.z;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }

    MathPool.releaseVector(scratch);
    MathPool.releaseMatrix(m);

    // Reuse an existing BOX bounds instance to stay allocation-free across frames.
    if (!this.bounds || !(this.bounds instanceof BoundingBox)) {
      this.bounds = localBounds.cloneEmpty();
    }
    const b = this.bounds as BoundingBox;
    b.min.set(minX, minY, minZ);
    b.max.set(maxX, maxY, maxZ);
    b.center.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    return this;
  }
}

/**
 * Type guard that checks if an object is a SkinnedMesh.
 */
export function isSkinnedMesh(object: unknown): object is SkinnedMesh {
  return object instanceof SkinnedMesh;
}
