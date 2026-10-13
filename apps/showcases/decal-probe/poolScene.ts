import {
  AmbientLight,
  Camera,
  CameraStrategyType,
  Color,
  DecalMaterial,
  DecalPool,
  DirectionalLight,
  Ground,
  Object3D,
  Scene,
  StandardMaterial,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";

export const POOL_CAPACITY = 4;
export const POOL_CAMERA_HEIGHT = 12;
/** Slot colours, in creation order: red, green, blue, yellow (checked in scripts/check-decals.mjs `poolChecks`). */
const SLOT_COLORS: readonly [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
];

function whiteTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 4, 4);
  return Texture.fromCanvas(canvas, { generateMipmaps: false });
}

/**
 * `?pool=1` variant: a `DecalPool` of four flat, unlit, differently coloured decals over a grey floor,
 * seen from straight above. Nothing is spawned up front: the check script drives `window.__decalPool`
 * (spawn, `update(dt)`, `clear()`), so recycling, restacking and fading can be read back from pixels.
 */
export function setupPoolScene(scene: Scene, camera: Camera): DecalPool {
  const sun = new DirectionalLight({ color: Color.WHITE, intensity: 0.4 });
  sun.direction.set(0, -1, 0);
  scene.add(sun);
  scene.add(new AmbientLight({ color: Color.WHITE, intensity: 1.0 }));

  const floor = new Object3D("Floor");
  floor.geometry = new Ground({ width: 40, depth: 40 }).getGeometryData();
  floor.material = new StandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 1 });
  scene.add(floor);

  const white = whiteTexture();
  let slot = 0;
  const pool = new DecalPool(scene.root, {
    capacity: POOL_CAPACITY,
    size: [2, 2, 1],
    createMaterial: (): DecalMaterial => {
      const [r, g, b] = SLOT_COLORS[slot++ % SLOT_COLORS.length]!;
      return new DecalMaterial({ diffuseMap: white, color: new Color(r, g, b, 1), unlit: true });
    },
  });
  const hooks = window as unknown as {
    __decalPool?: DecalPool;
    __decalPoolSpawn?: (x: number, z: number, lifetime?: number) => void;
  };
  hooks.__decalPool = pool;
  hooks.__decalPoolSpawn = (x, z, lifetime): void => {
    pool.spawn(new Vector3D(x, 0, z), new Vector3D(0, 1, 0), lifetime ? { lifetime } : {});
  };

  camera.setStrategy(CameraStrategyType.SMOOTH);
  camera.position.set(0, POOL_CAMERA_HEIGHT, 0);
  camera.target.set(0, 0, 0);
  camera.up.set(0, 0, -1);
  camera.updateViewMatrix();
  return pool;
}
