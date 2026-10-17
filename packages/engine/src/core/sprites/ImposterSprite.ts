import { Sprite } from "./Sprite.js";
import { SpriteMaterial } from "../materials/SpriteMaterial.js";
import type { Texture } from "../textures/Texture.js";
import type { Camera } from "../cameras/Camera.js";

/**
 * A camera-facing sprite that swaps between the angle textures a prior `bakeImposter()` call
 * produced, picking whichever was baked closest to the current view angle. Inherits `Sprite`'s
 * existing (non-instanced) CPU billboard path for the quad's own facing -- only the texture
 * selection is new here.
 */
export class ImposterSprite extends Sprite {
  private readonly _textures: Texture[];

  constructor(name: string, textures: Texture[]) {
    if (0 === textures.length) throw new Error("ImposterSprite requires at least one texture.");
    super(new SpriteMaterial({ texture: textures[0] }), name);
    this._textures = textures;
  }

  public update(camera: Camera): void {
    const dx = camera.position.x - this.position.x;
    const dz = camera.position.z - this.position.z;
    const viewAngle = Math.atan2(dx, dz);
    const step = (Math.PI * 2) / this._textures.length;
    // Bucket boundaries sit half a step before each bake angle, so the nearest angle wins.
    const index =
      ((Math.round(viewAngle / step) % this._textures.length) + this._textures.length) %
      this._textures.length;
    (this.material as SpriteMaterial).texture = this._textures[index];
  }
}
