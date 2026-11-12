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
import { Hud, type HzbParam, type HudActions } from "./Hud.js";

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
export class Showcase extends AbstractShowcase {
  private _logTimer = 0;
  private _hud: Hud | null = null;
  private _ambientLight: AmbientLight | null = null;
  private _sunLight: DirectionalLight | null = null;
  private _wall: Object3D | null = null;
  private _ground: Object3D | null = null;
  private _fieldObjects: Object3D[] = [];

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

    this._ambientLight = new AmbientLight({
      color: new Color(0.533, 0.561, 0.596),
      intensity: 0.55,
    });
    this.scene.add(this._ambientLight);
    this._sunLight = new DirectionalLight({ color: new Color(1, 0.991, 0.963), intensity: 1.4 });
    this._sunLight.position.set(8, 18, 10);
    this._sunLight.direction.set(-0.4, -1.0, -0.3);
    this._sunLight.castShadow = true;
    this._sunLight.shadowResolution = 2048;
    this.scene.add(this._sunLight);

    // Ground.
    this._ground = new Object3D("Ground");
    this._ground.geometry = new Cube({ size: 1 }).getGeometryData();
    this._ground.scale.set(60, 0.4, 60);
    this._ground.position.set(0, -0.2, -10);
    this._ground.material = new StandardMaterial({
      color: new Color(0.2, 0.22, 0.25),
      roughness: 0.9,
    });
    this._ground.receiveShadow = true;
    this.scene.add(this._ground);

    // The occluder: a wide, solid wall between the camera and the hidden field.
    this._wall = new Object3D("OccludingWall");
    this._wall.geometry = new Cube({ size: 1 }).getGeometryData();
    this._wall.scale.set(WALL_HALF_WIDTH * 2, 6, 1);
    this._wall.position.set(0, 3, WALL_Z);
    this._wall.material = new StandardMaterial({
      color: new Color(0.55, 0.35, 0.15),
      roughness: 0.7,
      metallic: 0.1,
    });
    this._wall.castShadow = true;
    this._wall.receiveShadow = true;
    this.scene.add(this._wall);

    // The hidden field: individually-drawn objects directly behind the wall. Everything with
    // |x| < WALL_HALF_WIDTH is fully hidden from the default straight-on view; the objects
    // peeking past the wall's edges stay visible from the start, for contrast.
    const cols = 16;
    const rows = 6;
    this._fieldObjects = [];
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
        this._fieldObjects.push(obj);
      }
    }

    // Live-tuning HUD (ShowcaseDrawer pattern)
    this._createLiveTuningUI();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    // Let the HUD consume its toggle key before default handling.
    if (this._hud && this._hud.handleKey(event)) return;
    super.onKeyDown(event);
  }

  public override destroy(): void {
    this._hud?.dispose();
    super.destroy();
  }

  /** Creates the live-tuning HUD panel (ShowcaseDrawer pattern). */
  private _createLiveTuningUI(): void {
    const hudActions: HudActions = {
      setParam: (param: HzbParam, value: number): void => {
        switch (param) {
          case "ambientIntensity":
            if (this._ambientLight) this._ambientLight.intensity = value;
            break;
          case "sunIntensity":
            if (this._sunLight) this._sunLight.intensity = value;
            break;
          case "shadowResolution":
            if (this._sunLight) this._sunLight.shadowResolution = Math.round(value);
            break;
          case "wallWidth":
            if (this._wall) this._wall.scale.x = value;
            break;
          case "wallRoughness":
            if (this._wall && this._wall.material instanceof StandardMaterial) {
              this._wall.material.roughness = value;
            }
            break;
          case "wallMetallic":
            if (this._wall && this._wall.material instanceof StandardMaterial) {
              this._wall.material.metallic = value;
            }
            break;
          case "groundRoughness":
            if (this._ground && this._ground.material instanceof StandardMaterial) {
              this._ground.material.roughness = value;
            }
            break;
          case "fieldRoughness":
            for (const obj of this._fieldObjects) {
              if (obj.material instanceof StandardMaterial) obj.material.roughness = value;
            }
            break;
          case "fieldMetallic":
            for (const obj of this._fieldObjects) {
              if (obj.material instanceof StandardMaterial) obj.material.metallic = value;
            }
            break;
        }
      },
    };
    this._hud = new Hud(hudActions, this);
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
const app = new Showcase();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase33] Failed to start:", err));
