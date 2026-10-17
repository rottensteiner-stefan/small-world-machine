import { Object3D } from "../Object3D.js";
import { Sphere, type SphereOptions } from "../../geometry/index.js";
import { BasicMaterial, type BasicMaterialOptions } from "../materials/index.js";
import type { Texture } from "../textures/index.js";

/**
 * Configuration options for the Skydome.
 */
export interface SkydomeOptions {
  /** The name of the object. Defaults to "Skydome". */
  name?: string;
  /** The texture to use for the skydome. */
  texture: Texture;
  /** The radius of the skydome. Defaults to 100. */
  radius?: number;
  /** The number of width segments. Defaults to 32. */
  widthSegments?: number;
  /** The number of height segments. Defaults to 32. */
  heightSegments?: number;
}

/**
 * A skydome that surrounds the scene using a spherical geometry.
 */
export class Skydome extends Object3D {
  declare public material: BasicMaterial;

  /**
   * Creates a new Skydome.
   * @param options The configuration options for the skydome.
   */
  constructor(options: SkydomeOptions) {
    const {
      heightSegments = 32,
      name = "Skydome",
      radius = 100,
      texture,
      widthSegments = 32,
    } = options;
    super(name);

    const sphereOptions: SphereOptions = { heightSegments, radius, widthSegments };
    const geomData = new Sphere(sphereOptions).getGeometryData();

    // Invert the winding order of the indices to make the sphere visible from the inside.
    // This is a cleaner approach than flipping the scale of the object.
    const indices = geomData.indices;
    if (indices) {
      for (let i = 0; i < indices.length; i += 3) {
        const i1 = indices[i];
        const i2 = indices[i + 1];
        if (i1 !== undefined && i2 !== undefined) {
          indices[i] = i2;
          indices[i + 1] = i1;
        }
      }
    }

    this.geometry = geomData;
    this.frustumCulled = false;

    const materialOptions: BasicMaterialOptions = {
      diffuseMap: texture,
    };
    this.material = new BasicMaterial(materialOptions);
  }
}
