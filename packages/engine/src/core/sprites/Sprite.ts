import { Object3D } from "../Object3D.js";
import { SpriteMaterial } from "../materials/SpriteMaterial.js";
import { Plane } from "../../geometry/Plane.js";

/**
 * A Sprite is a 2D plane that typically always faces the camera.
 */
export class Sprite extends Object3D {
  /**
   * Creates a new Sprite.
   * @param material The material for the sprite.
   * @param name The name of the sprite.
   */
  constructor(material: SpriteMaterial = new SpriteMaterial(), name: string = "Sprite") {
    super(name);
    this.material = material;

    // Use a shared plane geometry for all sprites (if possible, but for now we create one)
    // The Plane in this engine is on the XZ plane by default.
    // For a sprite, we typically want it to be "upright" in local space if it's on the XY plane,
    // but the billboard logic will align it anyway.
    this.geometry = new Plane({ width: 1, height: 1 }).getGeometryData();
  }
}
