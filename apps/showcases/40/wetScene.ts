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

/** World layout shared with scripts/check-decals.mjs (`wetChecks`). */
export const WET_CAMERA_HEIGHT = 12;
export const WET_DECAL_X = { wet: -0.8, dark: 0.8 } as const;
export const WET_DECAL_SIZE = 2.4;
const KIT_DECALS = "/assets/kits/flakturm/decals";

/**
 * `?wet=1` variant: the kit's real `flakturm/wet_puddle` textures on a rough grey floor, lit by an
 * overhead sun and seen from straight above (the sun's mirror peak points at the camera near the
 * screen centre, as in `?orm=1`). Left: the full preset (dark albedo + ORM roughness 0.05).
 * Right: the same albedo with a neutral ORM, so the darkening and the gloss can be told apart.
 * `?sun=<intensity>` overrides the sun (default 0.4) to see how much gloss a brighter light adds.
 */
export async function setupWetScene(scene: Scene, camera: Camera): Promise<void> {
  const sunParam = Number(new URLSearchParams(location.search).get("sun"));
  const sun = new DirectionalLight({
    color: Color.WHITE,
    intensity: Number.isFinite(sunParam) && sunParam > 0 ? sunParam : 0.4,
  });
  sun.direction.set(0, -1, 0);
  scene.add(sun);
  scene.add(new AmbientLight({ color: Color.WHITE, intensity: 1.0 }));

  const floor = new Object3D("Floor");
  floor.geometry = new Ground({ width: 40, depth: 40 }).getGeometryData();
  floor.material = new StandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 1 });
  scene.add(floor);

  const [albedo, orm] = await Promise.all([
    Texture.fromUrl(`${KIT_DECALS}/wet_puddle.webp`),
    Texture.fromUrl(`${KIT_DECALS}/wet_puddle_orm.webp`),
  ]);
  const base = { diffuseMap: albedo, roughness: 1 };
  const wet = new Decal(new DecalMaterial({ ...base, ormMap: orm }), "WetPuddle");
  const dark = new Decal(new DecalMaterial(base), "DarkOnly");
  wet.setPosition(WET_DECAL_X.wet, 0, 0).setScale(WET_DECAL_SIZE, 1, WET_DECAL_SIZE);
  dark.setPosition(WET_DECAL_X.dark, 0, 0).setScale(WET_DECAL_SIZE, 1, WET_DECAL_SIZE);
  scene.add(wet);
  scene.add(dark);

  camera.setStrategy(CameraStrategyType.SMOOTH);
  camera.position.set(0, WET_CAMERA_HEIGHT, 0);
  camera.target.set(0, 0, 0);
  camera.up.set(0, 0, -1);
  camera.updateViewMatrix();
}
