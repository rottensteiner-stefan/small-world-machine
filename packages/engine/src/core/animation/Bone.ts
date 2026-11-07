import { Object3D } from "../Object3D.js";
import { Matrix4 } from "../../math/Matrix4.js";

/**
 * Represents a single bone in a skeletal hierarchy.
 */
export class Bone extends Object3D {
  /** Inverse bind matrix used to transform vertices from mesh space to bone space. */
  public inverseBindMatrix: Matrix4 = new Matrix4();

  constructor(name?: string) {
    super(name);
  }

  /**
   * The bone's current accumulated *uniform* world-space scale -- 1.0 for a "clean" rig, but
   * often far from it: FBX-to-glTF pipelines (Mixamo included) commonly leave a leftover
   * cm-to-m unit-conversion scale (e.g. ~100x) baked into an ancestor node somewhere above the
   * bone. GPU skinning never shows this: `Skeleton.update()` computes
   * `bone.worldMatrix * inverseBindMatrix`, relative to the bone's own bind pose, so any scale
   * shared with the skinned mesh's own ancestor chain cancels out there regardless of its value.
   *
   * A plain `Object3D` parented directly onto a bone (e.g. a hand-held prop) has no such
   * cancellation and inherits the raw scale -- multiply an attached child's own scale by
   * `1 / bone.getAccumulatedWorldScale()` to counteract it (and its local position offset the
   * same way, or track world position directly instead of parenting -- see
   * `GameAppScene2._syncLanternTransform()` in the former game-app tunnel-stage scene
   * for a worked example, including why it deliberately does NOT parent onto the bone at all).
   *
   * This is detection only, by design: automatically "baking" the scale out of the rig itself
   * (resetting ancestor `scale` to 1, distributing it into descendant `position`s, and correcting
   * `inverseBindMatrix` to compensate) was attempted and reverted -- it breaks skinning whenever
   * the skinned mesh and the bone hierarchy are SIBLING branches under the same scaled ancestor
   * (the common real-world topology, including this engine's own Mixamo-derived rigs): the mesh's
   * own world matrix shares and cancels that ancestor scale exactly the same way the bones' does,
   * so "fixing" only the bones' side re-introduces the scale factor into the skinning result
   * instead of removing it. Requires `updateMatrixWorld()` to have run at least once.
   */
  public getAccumulatedWorldScale(): number {
    const m = this.worldMatrix.data;
    return Math.hypot(m[0]!, m[1]!, m[2]!);
  }
}
