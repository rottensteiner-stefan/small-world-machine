import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  Grid,
  Ground,
  MathUtils,
  Object3D,
  Plane,
  Sphere,
  StandardMaterial,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";
import { GoldenCapture, parseGoldenSpec, type GoldenSpec } from "./GoldenCapture.js";
import { MaterialLabHud, type MaterialLabSlider } from "./Hud.js";

interface MaterialSpec {
  name: string;
  color: Color;
  metallic: number;
  roughness: number;
}

/** Travel direction of the reference key light: from upper-left-front down onto the floor. */
const KEY_DIRECTION_REFERENCE = new Vector3D(2.5, -4, -1.5);
const KEY_INTENSITY_REFERENCE = 1.6;
const AMBIENT_INTENSITY_REFERENCE = 0.22;
/** The repo has no neutral studio HDRI; the nebula set gives chrome something to mirror. */
const IBL_PATH = "../13/assets/ibl";
const IBL_INTENSITY = 1.0;
const MATERIAL_STEP = 0.05;
const ANGLE_STEP_DEG = 5;
const ANGLE_STEP_FINE_DEG = 1;
const ELEVATION_MIN_DEG = 5;
const ELEVATION_MAX_DEG = 89;
const RAD_TO_DEG = 180 / Math.PI;
const CUSTOM_PRESET = -1;

/**
 * Showcase 43 — Kanon 1m Studio (E11B reference cell, P3).
 *
 * Minimal studio reference for PBR/shadow scale and drift protection: a 1m material ball on a
 * neutral ground plane under a hard studio key light. The golden mode (`st43-*` pools) is fully
 * STATIC: only the ball's material changes, studio, light and camera stay as authored, so every
 * frame is byte-identical.
 *
 * Interactive mode (no golden query) adds a material/light lab on top of the same cell: orbit
 * camera, material presets and roughness/metallic/color, key-light angles, optional IBL and a 1m
 * grid. Key `0` restores the exact golden reference state.
 */
export class Showcase extends AbstractShowcase {
  private readonly _golden: GoldenSpec | undefined;
  private _ballMaterial: StandardMaterial | undefined;
  private _key: DirectionalLight | undefined;
  private _ambient: AmbientLight | undefined;
  private _grid: Object3D | undefined;
  private _goldenCapture: GoldenCapture | undefined;
  private _presetIndex: number = 0;
  private _azimuthDeg: number = 0;
  private _elevationDeg: number = 0;
  private _gridVisible: boolean = false;
  private _iblEnabled: boolean = false;
  private _iblLoad: Promise<void> | undefined;
  private _hud: MaterialLabHud | undefined;

  /** The ball's material variants exposed as golden pools (`st43-*`, see GoldenCapture.ts). */
  private readonly _materials: readonly MaterialSpec[] = [
    { name: "Matte", color: new Color(0.85, 0.82, 0.78), metallic: 0.0, roughness: 0.95 },
    { name: "Satin", color: new Color(0.7, 0.62, 0.5), metallic: 0.0, roughness: 0.45 },
    { name: "Polished Metal", color: new Color(0.9, 0.9, 0.92), metallic: 0.95, roughness: 0.35 },
    { name: "Chrome", color: new Color(0.95, 0.97, 1.0), metallic: 1.0, roughness: 0.06 },
  ];

  constructor() {
    super();
    this._golden = parseGoldenSpec();
    // Golden captures need the authored framing; interactive sessions orbit the ball (R resets).
    this.defaultCameraController = this._golden ? "none" : "orbit";
  }

  /**
   * Runs the regular showcase boot, then either the deterministic per-material golden capture
   * (see GoldenCapture.ts) or, in interactive mode, the material/light lab HUD.
   */
  public override async start(): Promise<void> {
    await super.start();
    if (!this._golden) {
      this._createHud();
      return;
    }
    this._goldenCapture = new GoldenCapture(this, {
      applyMaterial: (index: number): void => this._applyPreset(index),
    });
    await this._goldenCapture.run(this._golden);
  }

  protected override onCanvasRecreated(): void {
    // No pointer lock: orbit drag and HUD sliders need a free cursor.
  }

  protected override async setupScene(): Promise<void> {
    this.defaultFov = MathUtils.degToRad(52);
    this.configureCamera();

    // 5x5 m studio floor -- neutral, high-roughness gray.
    const floor = new Object3D("StudioFloor");
    floor.geometry = new Ground({ width: 5, depth: 5 }).getGeometryData();
    floor.material = new StandardMaterial({
      color: new Color(0.28, 0.28, 0.3),
      metallic: 0.0,
      roughness: 0.9,
    });
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Neutral backdrop wall so the frame is not empty behind the ball.
    const backdrop = new Object3D("StudioBackdrop");
    backdrop.geometry = new Plane({ width: 6, height: 3.2 }).getGeometryData();
    backdrop.material = new StandardMaterial({
      color: new Color(0.16, 0.16, 0.18),
      metallic: 0.0,
      roughness: 1.0,
    });
    backdrop.setPosition(0, 1.6, -1.9);
    this.scene.add(backdrop);

    // The 1m material ball (radius 0.5), resting on the floor at the origin.
    const ball = new Object3D("MaterialBall");
    ball.geometry = new Sphere({
      radius: 0.5,
      widthSegments: 64,
      heightSegments: 48,
    }).getGeometryData();
    const reference = this._materials[0]!;
    // The color is cloned because presets are later copied INTO this material; sharing the
    // reference would let slider edits overwrite the preset table.
    const ballMaterial = new StandardMaterial({
      color: reference.color.clone(),
      metallic: reference.metallic,
      roughness: reference.roughness,
    });
    ball.material = ballMaterial;
    ball.setPosition(0, 0.5, 0);
    ball.castShadow = true;
    ball.receiveShadow = true;
    this._ballMaterial = ballMaterial;
    this.scene.add(ball);

    // Hard studio key light: casts the reference shadow on the floor (shadow/PBR drift protection).
    const key = new DirectionalLight({ color: Color.WHITE, intensity: KEY_INTENSITY_REFERENCE });
    key.direction.copyFrom(KEY_DIRECTION_REFERENCE);
    key.castShadow = true;
    key.shadowResolution = 2048;
    key.shadowBias = 0.0008;
    this._key = key;
    this.scene.add(key);
    this._syncLightAnglesFromDirection();

    const ambient = new AmbientLight({
      color: Color.WHITE,
      intensity: AMBIENT_INTENSITY_REFERENCE,
    });
    this._ambient = ambient;
    this.scene.add(ambient);

    // 1m scale grid, only added to the scene on demand (key G).
    const grid = new Object3D("ScaleGrid");
    grid.geometry = new Grid({ size: 5, divisions: 5 }).getGeometryData();
    const gridMaterial = new WireframeMaterial();
    gridMaterial.color = new Color(0.45, 0.75, 0.9);
    grid.material = gridMaterial;
    grid.setPosition(0, 0.003, 0);
    this._grid = grid;

    // Fixed inspection framing (about 1.9 m from the ball centre).
    const camPos = new Vector3D(1.6, 1.4, 2.6);
    const camTarget = new Vector3D(0, 0.5, 0);
    this.camera.position.copyFrom(camPos);
    this.camera.target.copyFrom(camTarget);
    this.setInitialCamera(camPos, camTarget);
    this.camera.updateViewMatrix();
  }

  protected override update(_deltaTime: number): void {
    // Fully static reference cell: nothing moves, so the frame is byte-identical every time.
  }

  public override destroy(): void {
    this._goldenCapture?.dispose();
    this._hud?.dispose();
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (this._golden || event.altKey || event.metaKey || event.ctrlKey) return;
    if (document.activeElement?.tagName === "INPUT") return;
    if (this._hud?.handleKey(event)) {
      event.preventDefault();
      return;
    }

    const shift = event.shiftKey;
    const angleStep = shift ? ANGLE_STEP_FINE_DEG : ANGLE_STEP_DEG;
    switch (event.code) {
      case "Digit0":
        this._resetToReference();
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
        this._applyPreset(Number(event.code.slice(-1)) - 1);
        break;
      case "BracketLeft":
        this._nudgeMaterial(shift ? 0 : -MATERIAL_STEP, shift ? -MATERIAL_STEP : 0);
        break;
      case "BracketRight":
        this._nudgeMaterial(shift ? 0 : MATERIAL_STEP, shift ? MATERIAL_STEP : 0);
        break;
      case "ArrowLeft":
        this._nudgeLight(-angleStep, 0);
        break;
      case "ArrowRight":
        this._nudgeLight(angleStep, 0);
        break;
      case "ArrowUp":
        this._nudgeLight(0, angleStep);
        break;
      case "ArrowDown":
        this._nudgeLight(0, -angleStep);
        break;
      case "KeyE":
        this._setIbl(!this._iblEnabled);
        break;
      case "KeyG":
        this._setGridVisible(!this._gridVisible);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Copies a preset into the ball's single material (no per-change allocation / rebuild). */
  private _applyPreset(index: number): void {
    const spec = this._materials[index];
    const material = this._ballMaterial;
    if (!spec || !material) return;
    material.color.copyFrom(spec.color);
    material.metallic = spec.metallic;
    material.roughness = spec.roughness;
    this._presetIndex = index;
    this._syncHud();
  }

  private _nudgeMaterial(deltaRoughness: number, deltaMetallic: number): void {
    const material = this._ballMaterial;
    if (!material) return;
    material.roughness = Math.min(1, Math.max(0, material.roughness + deltaRoughness));
    material.metallic = Math.min(1, Math.max(0, material.metallic + deltaMetallic));
    this._presetIndex = CUSTOM_PRESET;
    this._syncHud();
  }

  /** Azimuth/elevation describe where the light comes FROM, i.e. the inverted travel direction. */
  private _syncLightAnglesFromDirection(): void {
    const direction = this._key?.direction;
    if (!direction) return;
    const length = direction.length();
    if (length < 1e-6) return;
    this._elevationDeg = Math.asin(-direction.y / length) * RAD_TO_DEG;
    this._azimuthDeg = Math.atan2(-direction.x, -direction.z) * RAD_TO_DEG;
  }

  private _applyLightAngles(): void {
    if (!this._key) return;
    const elevation = MathUtils.degToRad(this._elevationDeg);
    const azimuth = MathUtils.degToRad(this._azimuthDeg);
    const horizontal = Math.cos(elevation);
    this._key.direction.set(
      -horizontal * Math.sin(azimuth),
      -Math.sin(elevation),
      -horizontal * Math.cos(azimuth),
    );
  }

  private _nudgeLight(deltaAzimuthDeg: number, deltaElevationDeg: number): void {
    const azimuth = this._azimuthDeg + deltaAzimuthDeg;
    this._azimuthDeg = ((((azimuth + 180) % 360) + 360) % 360) - 180;
    this._elevationDeg = Math.min(
      ELEVATION_MAX_DEG,
      Math.max(ELEVATION_MIN_DEG, this._elevationDeg + deltaElevationDeg),
    );
    this._applyLightAngles();
    this._syncHud();
  }

  private _setGridVisible(visible: boolean): void {
    if (!this._grid || visible === this._gridVisible) return;
    this._gridVisible = visible;
    if (visible) {
      this.scene.add(this._grid);
    } else {
      this.scene.remove(this._grid);
    }
    this._syncHud();
  }

  /** The IBL set is loaded lazily on first use so the reference look never depends on it. */
  private _setIbl(enabled: boolean): void {
    this._iblEnabled = enabled;
    this._syncHud();
    if (!enabled && !this._iblLoad) return;
    if (!this._iblLoad) {
      this._iblLoad = this.loadIbl(IBL_PATH, IBL_INTENSITY);
    }
    this._iblLoad
      .then((): void => {
        this.scene.environmentIntensity = this._iblEnabled ? IBL_INTENSITY : 0;
      })
      .catch((err: unknown): void => {
        console.error("[Showcase43] IBL load failed:", err);
        this._iblLoad = undefined;
        this._iblEnabled = false;
        this._syncHud();
      });
  }

  private _resetToReference(): void {
    this._applyPreset(0);
    if (this._key) {
      this._key.direction.copyFrom(KEY_DIRECTION_REFERENCE);
      this._key.intensity = KEY_INTENSITY_REFERENCE;
    }
    if (this._ambient) {
      this._ambient.intensity = AMBIENT_INTENSITY_REFERENCE;
    }
    this._syncLightAnglesFromDirection();
    this._setGridVisible(false);
    this._setIbl(false);
    this.resetCamera();
    this._syncHud();
  }

  /** Pushes the current state into the HUD controls; event-driven only, never per frame. */
  private _syncHud(): void {
    const material = this._ballMaterial;
    if (!this._hud || !material) return;
    this._hud.sync({
      presetIndex: this._presetIndex,
      roughness: material.roughness,
      metallic: material.metallic,
      colorHex: material.color.toHex().toLowerCase(),
      azimuthDeg: this._azimuthDeg,
      elevationDeg: this._elevationDeg,
      keyIntensity: this._key?.intensity ?? 0,
      ambient: this._ambient?.intensity ?? 0,
      iblEnabled: this._iblEnabled,
      gridVisible: this._gridVisible,
    });
  }

  private _setSlider(name: MaterialLabSlider, value: number): void {
    switch (name) {
      case "Roughness":
        if (this._ballMaterial) this._ballMaterial.roughness = value;
        this._presetIndex = CUSTOM_PRESET;
        break;
      case "Metallic":
        if (this._ballMaterial) this._ballMaterial.metallic = value;
        this._presetIndex = CUSTOM_PRESET;
        break;
      case "Azimuth":
        this._azimuthDeg = value;
        this._applyLightAngles();
        break;
      case "Elevation":
        this._elevationDeg = value;
        this._applyLightAngles();
        break;
      case "KeyIntensity":
        if (this._key) this._key.intensity = value;
        break;
      case "Ambient":
        if (this._ambient) this._ambient.intensity = value;
        break;
    }
    this._syncHud();
  }

  private _createHud(): void {
    this._hud = new MaterialLabHud(
      String(this.renderer.type),
      this._materials.map((spec) => spec.name),
      { min: ELEVATION_MIN_DEG, max: ELEVATION_MAX_DEG },
      {
        applyPreset: (index: number): void => this._applyPreset(index),
        toggleIbl: (): void => this._setIbl(!this._iblEnabled),
        toggleGrid: (): void => this._setGridVisible(!this._gridVisible),
        resetToReference: (): void => this._resetToReference(),
        setSlider: (name: MaterialLabSlider, value: number): void => this._setSlider(name, value),
        setColor: (hex: string): void => {
          this._ballMaterial?.color.copyFrom(Color.fromHex(hex));
          this._presetIndex = CUSTOM_PRESET;
          this._syncHud();
        },
      },
    );
    this._syncHud();
  }
}

// === START THE ENGINE ===
const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase43] Failed to start:", err));
