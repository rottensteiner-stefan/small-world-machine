# Coordinate System & Cameras

Understanding the engine's spatial orientation and camera strategies is essential for spatial logic, culling, and input.

## Right-Handed Coordinate System

Small World Machine uses a **right-handed coordinate system**:

- **X axis (+X):** Right
- **Y axis (+Y):** Up
- **Z axis (+Z):** Backward (pointing out of the screen)
- **-Z axis (-Z):** Forward / front (pointing into the screen)

```
        +Y
         ^   -Z (Forward)
         |  /
         | /
         |/
         +-------> +X (Right)
        /
       /
     +Z (Backward)
```

> **Normative — glTF/DCC import contract (S5 gate, EP‑15):** this handedness is the single binding
> spatial contract for all imported assets. The glTF loader applies node transforms **verbatim** and
> performs **no yaw compensation** — it never rotates a model by `+90°` (or any fixed amount) to make
> it "face forward". A character that walks backward after import is therefore an **authoring/export
> error**: the DCC must orient the asset so its forward direction is `-Z`. Facing is a content-creation
> contract, not an engine transform. (Baked constraints: `+X` right, `+Y` up, `-Z` forward; see also
> the [asset-pipeline guide](./asset-pipeline.md) "DCC Export Contract & Coordinate Invariants".)

## Camera Control & Look Formulas

When writing custom look/orbit math or relative movement controls (e.g. WASD), use look-relative trigonometry:

- **Angular orientation:** Theta ($\theta$) and Phi ($\phi$) are defined relative to the $-Z$ vector.
- **Direction vector:**
  $$\text{dirX} = \sin(\theta) \cdot \cos(\phi)$$
  $$\text{dirY} = \sin(\phi)$$
  $$\text{dirZ} = -\cos(\theta) \cdot \cos(\phi)$$

## Camera Strategies

The camera system supports several strategy patterns:

1. **Fixed Camera:** Constant position and target. Used for isometric backdrops.
2. **Smooth Follow:** Linearly interpolates position and target toward a target Object3D, damping the focus.
3. **FPS Camera:** Full mouse-/keyboard-relative look control and WASD movement, with a configurable `heightOffset`.
4. **Isometric Camera:** Parallel orthographic projections; pixel-precise viewport snapping is opt-in (`IsometricStrategy.pixelPerfect`, default `false`).
5. **Manual (default), HybridSync, Stiff:** `ManualCamera` is the default strategy (`CameraStrategyType.MANUAL`); `HYBRID_SYNC` and `STIFF` are further variants.

```typescript
// Lock in the FPS strategy during setup
this.camera.setStrategy(CameraStrategyType.FPS);
this.camera.addBehavior(
  new FPSController({
    input: this.input,
    moveSpeed: 8.0,
    enableCollision: false,
    scene: this.scene,
  }),
);
```

## Frustum Culling

To maximize performance, the engine dynamically discards geometry outside the field of view via **frustum culling**:

```typescript
// Called internally within the renderer's render-list builder
if (frustum.intersectsVolume(object.bounds)) {
  renderList.opaque.add(object);
}
```

All geometries dynamically compute an axis-aligned bounding box (AABB). Frustum culling can be disabled for static background overlays by setting `frustumCulled = false` on an object (e.g. a skybox).

## 2.5D Backgrounds & Texture Orientation

When creating 2.5D matte paintings, UI backgrounds, or billboards:

1. **Use `Plane` geometry:** Always use `Plane({ width, height })` for flat backgrounds. `Plane` generates standard UV coordinates ($U \in [0, 1]$ left to right, $V \in [1, 0]$ top to bottom), facing $+Z$.
2. **WebGL texture vertical flip (`flipY`) & WebP format:** DOM/HTML images have their pixel origin $(0,0)$ at the top left, while WebGL texture coordinates start at $(0,0)$ at the bottom left. `Texture.fromUrl` already defaults to `flipY: true`; pass it explicitly only for clarity or to override it. Prefer **WebP (`.webp`)** over JPEG for 2D art, to avoid dark block artifacts and to enable alpha-channel transparency for foreground layers:
   ```typescript
   const bgTex = await Texture.fromUrl("/assets/path/image.webp", { flipY: true });
   ```
3. **No negative-scale hacks:** Never apply negative scale factors (e.g. `scale.set(-1, -1, 1)`) to 3D objects to mirror textures. Negative scale reverses spatial parity, flips the winding order, and mirrors horizontal coordinates (swapping left and right).
4. **16:9 aspect ratio standard:** Standardize 2.5D background planes and AI-generated matte paintings on a 16:9 ratio (e.g. `Plane({ width: 16, height: 9 })`). Centering at $Y = 4.5$ aligns the bottom edge flush with the stage floor at $Y = 0.0$.
