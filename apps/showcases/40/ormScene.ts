import type { Camera, Scene } from "@small-world-machine/engine";
import {
  AmbientLight,
  CameraStrategyType,
  Color,
  Decal,
  DecalMaterial,
  DirectionalLight,
  Ground,
  Object3D,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";

/** World layout shared with scripts/check-decals.mjs (`ormChecks`). */
export const ORM_DECAL_X: readonly number[] = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5];
export const ORM_CAMERA_HEIGHT = 12;

function solidTexture(css: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 4, 4);
  return Texture.fromCanvas(canvas, { generateMipmaps: false });
}

/**
 * `?orm=1` variant: flat white decals in a row on a grey floor, lit by an overhead sun and seen from
 * straight above. The sun's mirror peak points at the camera near the screen centre, so roughness is
 * visible there (decal 3 sits next to the centre on purpose):
 * 0 control (rough), 1 ORM with AO = 0, 2 neutral ORM (all ones, must equal the control),
 * 3 ORM with G = 0.4 (a clear specular peak instead of the rough control), 4 red emissive map,
 * 5 unlit decal with the same emissive map (emission must not apply there), 6 material
 * metallic = 1 with a neutral ORM, 7 material metallic = 1 with ORM B = 0 (the map switches the
 * metal off again: equals the control).
 */
export function setupOrmScene(scene: Scene, camera: Camera): void {
  const sun = new DirectionalLight({ color: Color.WHITE, intensity: 0.4 });
  sun.direction.set(0, -1, 0);
  scene.add(sun);
  scene.add(new AmbientLight({ color: Color.WHITE, intensity: 1.0 }));

  const floor = new Object3D("Floor");
  floor.geometry = new Ground({ width: 40, depth: 40 }).getGeometryData();
  floor.material = new StandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 1 });
  scene.add(floor);

  const white = solidTexture("#ffffff");
  const aoZero = solidTexture("rgb(0,255,255)");
  const neutral = solidTexture("rgb(255,255,255)");
  const emissive = solidTexture("#ffffff");
  const smooth = solidTexture("rgb(255,102,255)");
  const nonMetal = solidTexture("rgb(255,255,0)");
  const red = new Color(1, 0, 0, 1);

  const base = { diffuseMap: white, roughness: 1 };
  const materials: DecalMaterial[] = [
    new DecalMaterial(base),
    new DecalMaterial({ ...base, ormMap: aoZero }),
    new DecalMaterial({ ...base, ormMap: neutral }),
    new DecalMaterial({ ...base, ormMap: smooth }),
    new DecalMaterial({ ...base, emissiveMap: emissive, emissiveColor: red }),
    new DecalMaterial({ ...base, emissiveMap: emissive, emissiveColor: red, unlit: true }),
    new DecalMaterial({ ...base, metallic: 1, ormMap: neutral }),
    new DecalMaterial({ ...base, metallic: 1, ormMap: nonMetal }),
  ];
  materials.forEach((material, i) => {
    const decal = new Decal(material, `OrmDecal${i}`);
    decal.setPosition(ORM_DECAL_X[i]!, 0, 0).setScale(2.4, 1, 2.4);
    scene.add(decal);
  });

  camera.setStrategy(CameraStrategyType.SMOOTH);
  camera.position.set(0, ORM_CAMERA_HEIGHT, 0);
  camera.target.set(0, 0, 0);
  camera.up.set(0, 0, -1);
  camera.updateViewMatrix();
}
