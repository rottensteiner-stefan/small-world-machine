import { AmbientLight } from "../../core/lights/AmbientLight.js";
import { DirectionalLight } from "../../core/lights/DirectionalLight.js";
import { Camera } from "../../core/cameras/Camera.js";
import type { Object3D } from "../../core/Object3D.js";
import { Scene } from "../../core/Scene.js";
import { Color } from "../../core/colors/Color.js";
import type { Texture } from "../../core/textures/index.js";
import { RenderTarget } from "../../core/textures/index.js";
import { RendererType } from "../../enums/index.js";
import { OrthographicProjection } from "../../math/projections/OrthographicProjection.js";
import { Vector3D } from "../../math/Vector3D.js";
import type { Renderer } from "../../interfaces/Renderer.js";

export interface ImposterBakeOptions {
  /** Number of horizontal angles baked around the object's Y axis. Defaults to 8. */
  angleCount?: number;
  /** Square resolution of each baked angle texture, in pixels. Defaults to 128. */
  resolution?: number;
  /** Background each baked angle texture is cleared to. Defaults to fully transparent
   * black, so a billboard composites over whatever sits behind it instead of carrying the
   * renderer's (usually opaque, scene-specific) clear color into the texture. */
  clearColor?: Color;
  /** Bake-time ambient light color. Defaults to a neutral grey. */
  ambientColor?: Color;
  ambientIntensity?: number;
  /** Bake-time key light color/intensity/direction. */
  lightColor?: Color;
  lightIntensity?: number;
  lightDirection?: [number, number, number];
  /** Anchors the baked vertical frame so the object's lowest point (its ground line) sits at
   * the bottom edge of every angle texture, instead of framing the object's bounding sphere
   * centered. For objects that stand on the ground (trees, characters, props) this plants the
   * base of the baked billboard exactly at the sprite's bottom edge, so an `ImposterSprite`
   * placed with its lower edge at the floor level does not read as hovering above the ground.
   * Defaults to false (centered framing -- callers relying on the previous vertical centering
   * are unaffected). */
  groundAtBottom?: boolean;
}

const DEFAULT_ANGLE_COUNT = 8;
const DEFAULT_RESOLUTION = 128;

/** Union bounding sphere over `root` and every descendant's own geometry bounds. Needed because
 * `Object3D.computeBounds()` only looks at `this.geometry` -- it does NOT recurse into
 * children -- so a compound object built the way `buildTree()`-style helpers do (a geometry-less
 * root grouping several geometry-bearing parts) would otherwise report no bounds at all, and
 * `bakeImposter` would frame the camera on empty space at the root's own position. Assumes
 * `updateMatrixWorld()` has already run on `root` (and therefore its whole subtree). */
function computeSubtreeBoundingSphere(root: Object3D): {
  center: Vector3D;
  radius: number;
  minY: number;
} {
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

  if (!isFinite(minX)) {
    return { center: root.position.clone(), radius: 1, minY: root.position.y };
  }

  const center = new Vector3D((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const radius = Math.max(
    0.5,
    Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2,
  );
  return { center, radius, minY };
}

/**
 * Computes the vertical framing of the bake frustum, in scene-relative Y (relative to the
 * subtree's bounding-sphere center, matching the camera orbit). With `groundAtBottom` the lower
 * frustum edge is anchored at the object's ground line (`minY`, minus a small anti-clip margin)
 * instead of centered, and the same vertical extent as the centered frame is preserved upward --
 * so the baked billboard keeps its full height but its base lands exactly at the sprite's bottom.
 * @returns `center`, `radius`, `minY` (the object's genuine ground line) and the frustum's
 * `lower`/`upper` Y in frustum-relative space (i.e. relative to `center.y`, the space the ortho
 * projection expects).
 */
export function computeImposterVerticalFrame(
  root: Object3D,
  groundAtBottom: boolean,
): { center: Vector3D; radius: number; minY: number; lower: number; upper: number } {
  const { center, radius, minY } = computeSubtreeBoundingSphere(root);
  const halfExtent = radius * 1.1;

  if (!groundAtBottom) {
    return { center, radius, minY, lower: -halfExtent, upper: halfExtent };
  }

  // Anchor the world-space ground line (minY) slightly above the image's bottom edge so the
  // base's AA edge is never clipped; keep the vertical span identical to the centered frame.
  const lower = minY - radius * 0.08 - center.y;
  const upper = lower + 2 * halfExtent;
  return { center, radius, minY, lower, upper };
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
  const bakeClear = options.clearColor?.clone() ?? new Color(0, 0, 0, 0);

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
  const { center, radius, lower, upper } = computeImposterVerticalFrame(
    targetObject,
    options.groundAtBottom === true,
  );

  const halfExtent = radius * 1.1;
  // The render target's row 0 is the TOP of the image on WebGPU (top-left framebuffer origin)
  // but the BOTTOM on WebGL (bottom-left origin), while Sprite/Plane always sample V=1 at the
  // quad's top. So the bake must be pre-flipped vertically ONLY where row 0 is the top. The
  // previous unconditional pre-flip made WebGPU upright but left WebGL imposters upside down.
  const flipForWebGpuRowOrder = renderer.type === RendererType.WEB_GPU;

  const camera = new Camera(
    new OrthographicProjection({
      left: -halfExtent,
      right: halfExtent,
      // `lower`/`upper` already mirror the object's ground-line anchoring (scene-relative).
      // Swapped vs. the usual bottom<top convention on the WebGPU leg: this compensates for the
      // row-order mismatch described above. On the WebGL leg the conventional bottom<top mapping
      // is used instead -- and in both cases the same world-space Y that was `lower` (the ground
      // line, when groundAtBottom) lands at the BOTTOM of the output image.
      bottom: flipForWebGpuRowOrder ? upper : lower,
      top: flipForWebGpuRowOrder ? lower : upper,
      near: 0.01,
      far: radius * 4,
    }),
  );
  camera.up.set(0, 1, 0);

  // The bake renders through the same pass as the live frame, which clears each target with the
  // renderer's clear color. A billboard must not bake the scene's sky into itself, so the clear
  // color is overridden for the bake and restored afterwards.
  const previousClear = renderer.clearColor.clone();
  renderer.setClearColor(bakeClear);

  const textures: Texture[] = [];
  try {
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
  } finally {
    renderer.setClearColor(previousClear);
  }

  return textures;
}
