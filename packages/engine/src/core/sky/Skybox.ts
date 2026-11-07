import { Object3D } from "../Object3D.js";
import { Cube } from "../../geometry/index.js";
import { CubeTexture } from "../textures/index.js";
import { SkyboxMaterial } from "../materials/index.js";

/**
 * Configuration options for the Skydome.
 */
export interface SkyboxOptions {
  /** The name of the object. Defaults to "Skydome". */
  name?: string;
  /** The size of the skybox cube. */
  size?: number;
  /** An array of paths to the cube map textures or a CubeTexture instance. */
  source: string[] | CubeTexture;
}

/**
 * A skybox that surrounds the scene.
 */
export class Skybox extends Object3D {
  constructor(options: SkyboxOptions) {
    const { name = "Skybox", size = 1000, source } = options;
    super(name);

    this.geometry = new Cube({ size }).getGeometryData();

    let cubeMap: CubeTexture;
    if (Array.isArray(source)) {
      cubeMap = new CubeTexture(source);
    } else {
      cubeMap = source;
    }

    this.material = new SkyboxMaterial({ cubeMap });
    this.frustumCulled = false;
  }
}
