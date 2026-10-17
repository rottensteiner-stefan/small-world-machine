import type { GltfJson } from "./types.js";
import { GltfBinaryParser } from "./GltfBinaryParser.js";
import type { Object3D } from "../../core/Object3D.js";
import type { Bone } from "../../core/animation/index.js";
import { Skeleton } from "../../core/animation/index.js";
import { Matrix4 } from "../../math/index.js";

/**
 * Parser for glTF joint hierarchies, inverse bind matrices, and skeletons.
 */
export class GltfSkinParser {
  /**
   * Parses glTF skins into Skeleton instances.
   */
  public static parseSkeletons(
    json: GltfJson,
    buffers: ArrayBuffer[],
    nodeObjects: Object3D[],
  ): Skeleton[] {
    const skeletons: Skeleton[] = [];
    if (!json.skins || !json.accessors) return skeletons;

    for (let i = 0; i < json.skins.length; i++) {
      const skinDef = json.skins[i];
      if (!skinDef) continue;
      const bones: Bone[] = [];
      for (const jIdx of skinDef.joints) {
        const node = nodeObjects[jIdx];
        if (!node) {
          throw new Error(`Skin ${i} references invalid joint node ${jIdx}`);
        }
        bones.push(node as Bone);
      }
      let boneInverses: Matrix4[] | undefined = undefined;

      if (skinDef.inverseBindMatrices !== undefined) {
        const invData = GltfBinaryParser.getBufferData(
          json.accessors[skinDef.inverseBindMatrices],
          json,
          buffers,
        ) as Float32Array | null;
        if (invData) {
          boneInverses = [];
          for (let b = 0; b < bones.length; b++) {
            const m = new Matrix4();
            m.data.set(invData.subarray(b * 16, (b + 1) * 16));
            boneInverses.push(m);
            if (bones[b]) {
              bones[b]!.inverseBindMatrix.data.set(m.data);
            }
          }
        }
      }
      skeletons[i] = new Skeleton(bones, boneInverses);
    }

    return skeletons;
  }
}
