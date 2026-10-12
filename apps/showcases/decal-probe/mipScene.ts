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
  Plane,
  Scene,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";

/** World layout shared with scripts/measure-decal-mips.mjs. */
const STRIP_WIDTH = 3;
const STRIP_LENGTH = 16;
const STRIP_CENTER_Z = -4;

/** 256x256 canvas of 1 px black lines every 4 px on white: the mip level chosen clearly matters. */
function lineTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let x = 0; x < canvas.width; x += 4) ctx.fillRect(x, 0, 1, canvas.height);
  for (let y = 0; y < canvas.height; y += 4) ctx.fillRect(0, y, canvas.width, 1);
  return Texture.fromCanvas(canvas, { generateMipmaps: true });
}

/**
 * `?mip=1` variant: a Plane mesh (left, x < 0) and a Decal (right, x > 0) lie flat on the floor
 * carrying the same high-frequency texture, seen at a grazing angle, so mip selection of the
 * hardware (plane) can be compared with the decal's finite-difference gradients. `?mipbias=<n>`
 * sets `DecalMaterial.mipBias`. Exposes `window.mipNudge(dx)` to shift the camera sideways.
 */
export function setupMipScene(scene: Scene, camera: Camera): void {
  const params = new URLSearchParams(location.search);
  const mipBias = Number(params.get("mipbias") ?? "0");

  const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.1 });
  sun.direction.set(-0.4, -1, -0.3);
  scene.add(sun);
  scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.25 }));

  const floor = new Object3D("Floor");
  floor.geometry = new Ground({ width: 40, depth: 40 }).getGeometryData();
  floor.material = new StandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 1 });
  scene.add(floor);

  const texture = lineTexture();
  const planeMaterial = new StandardMaterial({ roughness: 1 });
  planeMaterial.diffuseMap = texture;
  const plane = new Object3D("MipPlane").setPosition(-2, 0.002, STRIP_CENTER_Z);
  plane.geometry = new Plane({ width: STRIP_WIDTH, height: STRIP_LENGTH }).getGeometryData();
  plane.material = planeMaterial;
  plane.setRotation(-Math.PI / 2, 0, 0);
  scene.add(plane);

  const decal = new Decal(new DecalMaterial({ diffuseMap: texture, mipBias }), "MipDecal");
  decal.setPosition(2, 0, STRIP_CENTER_Z).setScale(STRIP_WIDTH, 1, STRIP_LENGTH);
  scene.add(decal);

  camera.setStrategy(CameraStrategyType.SMOOTH);
  camera.position.set(0, 2.5, 6);
  camera.target.set(0, 0, -4);
  camera.updateViewMatrix();

  (window as unknown as { mipNudge: (dx: number) => void }).mipNudge = (dx: number): void => {
    camera.position.x = dx;
    camera.target.x = dx;
    camera.updateViewMatrix();
  };
}
