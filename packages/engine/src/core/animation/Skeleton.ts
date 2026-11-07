import type { Bone } from "./Bone.js";
import { Matrix4 } from "../../math/Matrix4.js";

/**
 * Upper bound on bones per skeleton, matching `u_boneMatrices[64]` in
 * `base_vertex_header.vert.glsl`. Bones beyond this index are dropped from the GPU upload
 * (see `WebGL2Renderer`) rather than corrupting whatever uniform happens to follow the array.
 */
export const MAX_SKINNED_BONES = 64;

/**
 * Manages an array of bones, computing skinning matrices for the GPU.
 */
export class Skeleton {
  /** The ordered list of bones belonging to this skeleton. */
  public bones: Bone[];
  /** Flattened array containing the 16-element transform matrix for each bone. */
  public boneMatrices: Float32Array;
  /** Inverse bind matrices for each bone. */
  public boneInverses: Matrix4[];

  private _identityMatrix: Matrix4 = new Matrix4();
  private _invMeshWorld: Matrix4 = new Matrix4();
  private _tempMat: Matrix4 = new Matrix4();
  private _finalMat: Matrix4 = new Matrix4();

  constructor(bones: Bone[] = [], boneInverses?: Matrix4[]) {
    if (bones.length > MAX_SKINNED_BONES) {
      console.warn(
        `[Skeleton] ${bones.length} bones exceeds the ${MAX_SKINNED_BONES}-bone GPU skinning limit; ` +
          `bones from index ${MAX_SKINNED_BONES} onward will not deform this mesh.`,
      );
    }

    this.bones = [...bones];
    this.boneInverses = boneInverses ? [...boneInverses] : [];

    // Ensure we have inverse bind matrices for all bones
    if (this.boneInverses.length === 0) {
      for (let i = 0; i < this.bones.length; i++) {
        this.boneInverses.push(this.bones[i]?.inverseBindMatrix ?? new Matrix4());
      }
    }

    this.boneMatrices = new Float32Array(Math.max(1, this.bones.length) * 16);
  }

  /**
   * Computes the final bone transformation matrices relative to the skinned mesh's world matrix.
   * @param meshWorldMatrix The world matrix of the SkinnedMesh.
   */
  public update(meshWorldMatrix?: Matrix4): void {
    const invMeshWorld = this._invMeshWorld;
    if (meshWorldMatrix) {
      invMeshWorld.data.set(meshWorldMatrix.data);
      // A singular mesh world matrix (e.g. a zero-scale "pop-in" spawn) can't be inverted --
      // fall back to identity instead of re-applying the non-inverted world matrix a second time.
      if (!invMeshWorld.invert()) {
        invMeshWorld.data.set(this._identityMatrix.data);
      }
    } else {
      invMeshWorld.data.set(this._identityMatrix.data);
    }

    const tempMat = this._tempMat;
    const finalMat = this._finalMat;
    const bones = this.bones;
    const boneCount = bones.length;
    const boneInverses = this.boneInverses;
    const boneMatrices = this.boneMatrices;

    for (let i = 0; i < boneCount; i++) {
      const bone = bones[i];
      if (!bone) continue;

      const invBind = boneInverses[i] ?? bone.inverseBindMatrix;

      // bone.worldMatrix * invBind
      Matrix4.multiply(bone.worldMatrix, invBind, tempMat);

      // invMeshWorld * (bone.worldMatrix * invBind)
      if (meshWorldMatrix) {
        Matrix4.multiply(invMeshWorld, tempMat, finalMat);
        boneMatrices.set(finalMat.data, i * 16);
      } else {
        boneMatrices.set(tempMat.data, i * 16);
      }
    }
  }

  /**
   * Finds a bone by its name.
   */
  public getBoneByName(name: string): Bone | undefined {
    for (let i = 0; i < this.bones.length; i++) {
      if (this.bones[i]?.name === name) {
        return this.bones[i];
      }
    }
    return undefined;
  }
}
