import type { Object3D } from "../../core/Object3D.js";
import type { AbstractMaterial } from "../../core/materials/AbstractMaterial.js";

/**
 * Utility for querying and applying glTF 2.0 Material Variants (`KHR_materials_variants`).
 */
export class GltfVariants {
  /**
   * Returns the list of variant names stored on the glTF root object, if any.
   *
   * @param root The root Object3D returned by GltfLoader.
   */
  public static getVariantNames(root: Object3D): string[] {
    return (root.userData["gltfVariants"] as string[]) || [];
  }

  /**
   * Selects and applies a material variant across all meshes in the object hierarchy.
   *
   * @param root The root Object3D containing the model hierarchy.
   * @param variant The variant name (string), variant index (number), or null/undefined to reset to original default materials.
   * @returns `true` if the variant was recognized and applied (or reset to default), `false` if the variant name/index was not found.
   */
  public static selectVariant(
    root: Object3D,
    variant: string | number | null | undefined,
  ): boolean {
    const variantNames = this.getVariantNames(root);

    let targetIndex: number | null = null;
    if (typeof variant === "number") {
      if (variant < 0 || (variantNames.length > 0 && variant >= variantNames.length)) {
        return false;
      }
      targetIndex = variant;
    } else if (typeof variant === "string") {
      const idx = variantNames.indexOf(variant);
      if (idx !== -1) {
        targetIndex = idx;
      } else {
        return false;
      }
    } else if (variant === null || variant === undefined) {
      targetIndex = null;
    }

    root.traverse((obj) => {
      const variantMap = obj.userData["gltfMaterialVariants"] as
        Record<number, AbstractMaterial> | undefined;
      if (variantMap) {
        if (targetIndex !== null && variantMap[targetIndex]) {
          obj.material = variantMap[targetIndex];
        } else if (obj.userData["gltfDefaultMaterial"]) {
          obj.material = obj.userData["gltfDefaultMaterial"] as AbstractMaterial;
        }
      }
    });

    return true;
  }
}
