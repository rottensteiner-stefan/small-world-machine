import type { Camera, Scene } from "@small-world-machine/engine";
import {
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  DecalMaterial,
  DecalPool,
  DirectionalLight,
  Ground,
  Object3D,
  Raycaster,
  StandardMaterial,
  Texture,
  Vector2D,
  Vector3D,
} from "@small-world-machine/engine";

export const POOL_CAPACITY = 4;
/** World layout of the real-geometry targets, shared with scripts/check-decals.mjs (`poolChecks`). */
export const POOL_SLAB_X = 6;
export const POOL_RECEIVER_X = -6;
export const POOL_SLAB_TILT = Math.PI / 6;
/** Result of `window.__decalPoolShoot`: what the engine's `Raycaster` found and how the spawned decal ended up. */
export interface PoolShot {
  hit: boolean;
  point: [number, number, number];
  normal: [number, number, number];
  /** World-space +Y axis of the spawned decal (must equal `normal`). */
  decalUp: [number, number, number];
  /** Name of the object that was hit. */
  object: string;
}
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
    __decalPoolShoot?: (x: number, z: number, attach: boolean) => PoolShot;
    __decalPoolMoveReceiver?: (x: number, yaw: number) => void;
  };
  hooks.__decalPool = pool;
  hooks.__decalPoolSpawn = (x, z, lifetime): void => {
    pool.spawn(new Vector3D(x, 0, z), new Vector3D(0, 1, 0), lifetime ? { lifetime } : {});
  };

  // Real geometry for the Raycaster: a slab tilted 30 degrees about X (right) and a flat box that can move (left).
  const slab = new Object3D("Slab");
  slab.geometry = new Cube({ size: 1 }).getGeometryData();
  slab.material = new StandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 1 });
  slab.setPosition(POOL_SLAB_X, 1, 0).setRotation(POOL_SLAB_TILT, 0, 0).setScale(4, 1, 4);
  scene.add(slab);
  const receiver = new Object3D("Receiver");
  receiver.geometry = new Cube({ size: 1 }).getGeometryData();
  receiver.material = new StandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 1 });
  receiver.setPosition(POOL_RECEIVER_X, 0.5, 0).setScale(3, 1, 3);
  scene.add(receiver);
  const targets = [floor, slab, receiver];
  const raycaster = new Raycaster();
  hooks.__decalPoolShoot = (x, z, attach): PoolShot => {
    for (const target of targets) {
      target.updateMatrixWorld(true);
      target.computeBounds();
    }
    raycaster.ray.origin.set(x, 20, z);
    raycaster.ray.direction.set(0, -1, 0);
    const hit = raycaster.intersectObjects(targets)[0];
    if (!hit) {
      return { hit: false, point: [0, 0, 0], normal: [0, 0, 0], decalUp: [0, 0, 0], object: "" };
    }
    const decal = pool.spawn(hit.point, hit.normal, attach ? { attachTo: hit.object } : {});
    decal.updateMatrixWorld(true);
    const m = decal.worldMatrix.data;
    return {
      hit: true,
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      decalUp: [m[4]!, m[5]!, m[6]!],
      object: hit.object.name,
    };
  };
  hooks.__decalPoolMoveReceiver = (x, yaw): void => {
    receiver.setPosition(x, 0.5, 0).setRotation(0, yaw, 0);
  };

  // `?shoot=1`: a real pointer click casts a ray from the camera through the pixel and spawns a decal at the hit,
  // the way a game would shoot (checked with real mouse events in scripts/check-decals.mjs `poolClickChecks`).
  if (new URLSearchParams(location.search).get("shoot") === "1") {
    const canvas = document.querySelector("canvas")!;
    canvas.addEventListener("pointerdown", (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2D(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      for (const target of targets) {
        target.updateMatrixWorld(true);
        target.computeBounds();
      }
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(targets)[0];
      if (hit) pool.spawn(hit.point, hit.normal);
    });
  }

  camera.setStrategy(CameraStrategyType.SMOOTH);
  camera.position.set(0, POOL_CAMERA_HEIGHT, 0);
  camera.target.set(0, 0, 0);
  camera.up.set(0, 0, -1);
  camera.updateViewMatrix();
  return pool;
}
