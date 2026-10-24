import { Object3D } from "../Object3D.js";
import { MAX_SKINNED_BONES, type Skeleton } from "./Skeleton.js";
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

  constructor(name?: string) {
    super(name);
  }

  /**
   * Binds a skeleton to this mesh.
   */
  public bind(skeleton: Skeleton, bindMatrix?: Matrix4): void {
    this.skeleton = skeleton;
    if (bindMatrix) {
      this.bindMatrix.data.set(bindMatrix.data);
    }
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
