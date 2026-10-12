import {
  AmbientLight,
  Camera,
  CameraStrategyType,
  Color,
  Decal,
  DecalMaterial,
  DirectionalLight,
  Ground,
  Object3D,
  Scene,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";

/** World layout shared with scripts/check-decals.mjs (`ormChecks`). */
export const ORM_DECAL_X: readonly number[] = [-6, -3, 0, 3, 6];
export const ORM_CAMERA_HEIGHT = 8;

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
 * `?orm=1` variant: five flat white decals in a row on a grey floor, seen from straight above:
 * control, ORM with AO = 0, neutral ORM (all ones, must equal the control), red emissive map, and
 * an unlit decal that carries the same emissive map (emission must not apply there).
 */
export function setupOrmScene(scene: Scene, camera: Camera): void {
  const sun = new DirectionalLight({ color: Color.WHITE, intensity: 0.4 });
  sun.direction.set(-0.3, -1, -0.2);
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
  const red = new Color(1, 0, 0, 1);

  const materials: DecalMaterial[] = [
    new DecalMaterial({ diffuseMap: white }),
    new DecalMaterial({ diffuseMap: white, ormMap: aoZero }),
    new DecalMaterial({ diffuseMap: white, ormMap: neutral }),
    new DecalMaterial({ diffuseMap: white, emissiveMap: emissive, emissiveColor: red }),
    new DecalMaterial({
      diffuseMap: white,
      emissiveMap: emissive,
      emissiveColor: red,
      unlit: true,
    }),
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
