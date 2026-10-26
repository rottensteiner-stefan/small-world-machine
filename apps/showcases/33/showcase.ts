import type { EngineOptions } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  Object3D,
  OrbitController,
  RendererType,
  Sphere,
  StandardMaterial,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const WALL_HALF_WIDTH = 5;
const FIELD_Z = -10;
const WALL_Z = -8;

/**
 * Showcase 33: "Hidden City"
 *
 * Demonstrates AAA research item #14 (Hierarchical-Z Occlusion Culling, WebGPU-only -- see
 * docs/adr/0008-hzb-occlusion-culling-webgpu-only.md): a wide occluding wall in front of the
 * camera spawn hides a dense field of individually-drawn (not instanced -- an `InstancedMesh`
 * would only ever be tested as one aggregate bounds, which wouldn't show *per-object* culling)
 * cubes and spheres behind it. Occlusion culling is invisible when it's working correctly
 * (culled objects are hidden either way), so the actual proof is watching objects "pop in" as
 * you orbit around the wall's edge -- and the console readout confirms the pipeline is doing
 * real work even when nothing visibly changes.
 */
class Showcase33 extends AbstractShowcase {
  private _logTimer = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      enableOcclusionCulling: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    this.defaultFov = (55 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 3, 16);
    this.camera.target.set(0, 3, WALL_Z);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    this.scene.add(new AmbientLight({ color: new Color(0.533, 0.561, 0.596), intensity: 0.55 }));
    const sun = new DirectionalLight({ color: new Color(1, 0.991, 0.963), intensity: 1.4 });
    sun.position.set(8, 18, 10);
    sun.direction.set(-0.4, -1.0, -0.3);
    sun.castShadow = true;
    sun.shadowResolution = 2048;
    this.scene.add(sun);

    // Ground.
    const ground = new Object3D("Ground");
    ground.geometry = new Cube({ size: 1 }).getGeometryData();
    ground.scale.set(60, 0.4, 60);
    ground.position.set(0, -0.2, -10);
    ground.material = new StandardMaterial({
      color: new Color(0.2, 0.22, 0.25),
      roughness: 0.9,
    });
    ground.receiveShadow = true;
    this.scene.add(ground);

    // The occluder: a wide, solid wall between the camera and the hidden field.
    const wall = new Object3D("OccludingWall");
    wall.geometry = new Cube({ size: 1 }).getGeometryData();
    wall.scale.set(WALL_HALF_WIDTH * 2, 6, 1);
    wall.position.set(0, 3, WALL_Z);
    wall.material = new StandardMaterial({
      color: new Color(0.55, 0.35, 0.15),
      roughness: 0.7,
      metallic: 0.1,
    });
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.scene.add(wall);

    // The hidden field: individually-drawn objects directly behind the wall. Everything with
    // |x| < WALL_HALF_WIDTH is fully hidden from the default straight-on view; the objects
    // peeking past the wall's edges stay visible from the start, for contrast.
    const cols = 16;
    const rows = 6;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = (col - (cols - 1) / 2) * 1.2;
        const y = 0.6 + row * 1.2;
        const isSphere = (row + col) % 2 === 0;
        const obj = new Object3D(`Field_${row}_${col}`);
        obj.geometry = isSphere
          ? new Sphere({ radius: 0.45, widthSegments: 12, heightSegments: 10 }).getGeometryData()
          : new Cube({ size: 0.8 }).getGeometryData();
        obj.position.set(x, y, FIELD_Z);
        const hue = (col / cols + row / rows) * 0.5;
        obj.material = new StandardMaterial({
          color: new Color(0.3 + hue * 0.5, 0.5 - hue * 0.2, 0.9 - hue * 0.4),
          roughness: 0.5,
          metallic: 0.2,
        });
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.scene.add(obj);
      }
    }
  }

  protected override update(deltaTime: number): void {
    this._logTimer += deltaTime;
    if (this._logTimer < 1) return;
    this._logTimer = 0;

    // Counted locally from the scene graph rather than via a `FrustumCuller` instance's
    // `lastVisibleCount` -- this class has no reference to the culler instance, only the scene.
    let frustumVisible = 0;
    const countVisible = (obj: Object3D): void => {
      if (obj.isVisible && obj.inFrustum) frustumVisible++;
      for (const child of obj.children) countVisible(child);
    };
    for (const obj of this.scene.objects) countVisible(obj);

    const occlusionCulled = this.scene.lastOcclusionCulledCount;
    console.log(
      `[HZB] frustum-visible=${frustumVisible} occlusion-culled=${occlusionCulled} ` +
        `rendered=${frustumVisible - occlusionCulled}`,
    );
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase33();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase33] Failed to start:", err));
