import { AmbientLight } from "../../core/lights/AmbientLight.js";
import { DirectionalLight } from "../../core/lights/DirectionalLight.js";
import { Camera } from "../../core/cameras/Camera.js";
import { Object3D } from "../../core/Object3D.js";
import { Scene } from "../../core/Scene.js";
import { Color } from "../../core/colors/Color.js";
import { RenderTarget, Texture } from "../../core/textures/index.js";
import { OrthographicProjection } from "../../math/projections/OrthographicProjection.js";
import { Vector3D } from "../../math/Vector3D.js";
import { Renderer } from "../../interfaces/Renderer.js";

export interface ImposterBakeOptions {
  /** Number of horizontal angles baked around the object's Y axis. Defaults to 8. */
  angleCount?: number;
  /** Square resolution of each baked angle texture, in pixels. Defaults to 128. */
  resolution?: number;
  /** Bake-time ambient light color. Defaults to a neutral grey. */
  ambientColor?: Color;
  ambientIntensity?: number;
  /** Bake-time key light color/intensity/direction. */
  lightColor?: Color;
  lightIntensity?: number;
  lightDirection?: [number, number, number];
}

const DEFAULT_ANGLE_COUNT = 8;
const DEFAULT_RESOLUTION = 128;

/** Union bounding sphere over `root` and every descendant's own geometry bounds. Needed because
 * `Object3D.computeBounds()` only looks at `this.geometry` -- it does NOT recurse into
 * children -- so a compound object built the way `buildTree()`-style helpers do (a geometry-less
 * root grouping several geometry-bearing parts) would otherwise report no bounds at all, and
 * `bakeImposter` would frame the camera on empty space at the root's own position. Assumes
 * `updateMatrixWorld()` has already run on `root` (and therefore its whole subtree). */
function computeSubtreeBoundingSphere(root: Object3D): { center: Vector3D; radius: number } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const visit = (obj: Object3D): void => {
    if (obj.geometry) {
      obj.computeBounds();
      const b = obj.bounds;
      if (b) {
        const r = b.getBroadRadius();
        minX = Math.min(minX, b.center.x - r);
        minY = Math.min(minY, b.center.y - r);
        minZ = Math.min(minZ, b.center.z - r);
        maxX = Math.max(maxX, b.center.x + r);
        maxY = Math.max(maxY, b.center.y + r);
        maxZ = Math.max(maxZ, b.center.z + r);
      }
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);

  if (!isFinite(minX)) return { center: root.position.clone(), radius: 1 };

  const center = new Vector3D((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const radius = Math.max(
    0.5,
    Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2,
  );
  return { center, radius };
}

/**
 * Bakes `targetObject` into `angleCount` camera-facing snapshots (one `RenderTarget` texture per
 * horizontal angle around Y), the way an AAA imposter atlas stands in for a complex mesh at
 * distance. Reuses the exact render-to-texture recipe `PlanarReflectionNode.updateReflection()`
 * already uses (`setRenderTarget` -> `render` -> `setRenderTarget(null)`), just from `angleCount`
 * fixed vantage points instead of one mirrored one. `targetObject` must be fully configured
 * (geometry + material set) and must NOT already be part of the caller's live scene -- this
 * builds its own isolated `Scene` containing only `targetObject` plus the bake lighting, so
 * baking never touches or is affected by the real world.
 *
 * Synchronous, matching `PlanarReflectionNode.updateReflection()`: `renderer.render()` only
 * queues GPU work, it doesn't need awaiting, and the returned textures are valid to sample in
 * any later frame once the queue has processed them (same ordering guarantee any render-target
 * texture already relies on).
 */
export function bakeImposter(
  renderer: Renderer,
  targetObject: Object3D,
  options: ImposterBakeOptions = {},
): Texture[] {
  const angleCount = options.angleCount ?? DEFAULT_ANGLE_COUNT;
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;

  const bakeScene = new Scene();
  bakeScene.add(
    new AmbientLight({
      color: options.ambientColor ?? new Color(0.4, 0.4, 0.4),
      intensity: options.ambientIntensity ?? 0.6,
    }),
  );
  const light = new DirectionalLight({
    color: options.lightColor ?? new Color(1, 1, 1),
    intensity: options.lightIntensity ?? 1.2,
  });
  const [lx, ly, lz] = options.lightDirection ?? [-0.5, -1.0, -0.3];
  light.direction.set(lx, ly, lz);
  bakeScene.add(light);
  bakeScene.add(targetObject);

  targetObject.updateMatrixWorld();
  const { center, radius } = computeSubtreeBoundingSphere(targetObject);

  const camera = new Camera(
    new OrthographicProjection({
      left: -radius * 1.1,
      right: radius * 1.1,
      // Swapped vs. the usual bottom<top convention: RenderTarget textures come out of the
      // renderer in WebGPU's native top-left row order, but `Plane`/`Sprite`'s UV mapping
      // (V=1 at the quad's top, V=0 at its bottom -- see src/geometry/Plane.ts) assumes the
      // bottom-left-origin convention regular loaded images get Y-flip-corrected into during
      // upload (`Texture`'s `flipY` option). A render target never goes through that image-load
      // step, so without this pre-flip every baked angle displays upside down on the sprite.
      bottom: radius * 1.1,
      top: -radius * 1.1,
      near: 0.01,
      far: radius * 4,
    }),
  );
  camera.up.set(0, 1, 0);

  const textures: Texture[] = [];
  for (let i = 0; i < angleCount; i++) {
    const angle = (i / angleCount) * Math.PI * 2;
    camera.position.set(
      center.x + Math.sin(angle) * radius * 2,
      center.y,
      center.z + Math.cos(angle) * radius * 2,
    );
    camera.target.set(center.x, center.y, center.z);
    camera.updateViewMatrix();

    const target = RenderTarget.create({ width: resolution, height: resolution });
    renderer.setRenderTarget(target);
    renderer.render(bakeScene, camera.viewProjectionMatrix, camera.position, camera.viewMatrix);
    renderer.setRenderTarget(null);

    textures.push(target);
  }

  return textures;
}
