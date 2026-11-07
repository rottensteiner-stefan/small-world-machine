import type { BloomElement, CubeTexture } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cylinder,
  DirectionalLight,
  GltfLoader,
  Object3D,
  PostProcessingEffectType,
  RendererType,
  SpotLight,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import { Hud, type HelmetSlider, type HudState, type LightingPresetId } from "./Hud.js";
import { isTypingTarget } from "../shared/ShowcaseDrawer.js";

interface LightingPresetConfig {
  spotIntensity: number;
  spotColor: Color;
  sunIntensity: number;
  sunColor: Color;
  fillIntensity: number;
  fillColor: Color;
  ambientIntensity: number;
  ambientColor: Color;
  emissiveIntensity: number;
  bloomIntensity: number;
}

const LIGHT_PRESETS: Record<LightingPresetId, LightingPresetConfig> = {
  studio: {
    spotIntensity: 4.0,
    spotColor: new Color(1, 0.929, 0.85),
    sunIntensity: 1.5,
    sunColor: new Color(1, 0.977, 0.953),
    fillIntensity: 0.5,
    fillColor: new Color(0.579, 0.73, 0.904),
    ambientIntensity: 0.25,
    ambientColor: new Color(0.351, 0.381, 0.422),
    emissiveIntensity: 1.0,
    bloomIntensity: 1.8,
  },
  cyberpunk: {
    spotIntensity: 6.5,
    spotColor: new Color(0.1, 0.85, 1.0),
    sunIntensity: 0.8,
    sunColor: new Color(0.85, 0.1, 0.65),
    fillIntensity: 1.4,
    fillColor: new Color(1.0, 0.05, 0.4),
    ambientIntensity: 0.15,
    ambientColor: new Color(0.1, 0.15, 0.3),
    emissiveIntensity: 3.0,
    bloomIntensity: 3.0,
  },
  highnoon: {
    spotIntensity: 1.0,
    spotColor: new Color(1.0, 0.98, 0.95),
    sunIntensity: 3.2,
    sunColor: new Color(1.0, 0.98, 0.92),
    fillIntensity: 0.4,
    fillColor: new Color(0.85, 0.9, 0.95),
    ambientIntensity: 0.45,
    ambientColor: new Color(0.45, 0.52, 0.65),
    emissiveIntensity: 0.8,
    bloomIntensity: 1.2,
  },
  noir: {
    spotIntensity: 8.0,
    spotColor: new Color(0.95, 0.95, 1.0),
    sunIntensity: 0.0,
    sunColor: new Color(0, 0, 0),
    fillIntensity: 0.15,
    fillColor: new Color(0.2, 0.25, 0.35),
    ambientIntensity: 0.04,
    ambientColor: new Color(0.04, 0.05, 0.07),
    emissiveIntensity: 1.2,
    bloomIntensity: 2.2,
  },
};

const CAMERA_PRESETS = {
  hero: { pos: new Vector3D(0, 0.3, 3), target: new Vector3D(0, 0.3, 0) },
  macro: { pos: new Vector3D(0, 0.35, 1.35), target: new Vector3D(0, 0.3, 0) },
  side: { pos: new Vector3D(2.2, 0.35, 1.2), target: new Vector3D(0, 0.3, 0) },
  top: { pos: new Vector3D(1.5, 2.2, 2.0), target: new Vector3D(0, 0.2, 0) },
};

export class Showcase extends AbstractShowcase {
  private _helmet?: Object3D;
  private _helmetMaterial?: StandardMaterial;
  private _pedestalMaterial?: StandardMaterial;
  private _groundMaterial?: StandardMaterial;

  private _keySpotLight?: SpotLight;
  private _mainLight?: DirectionalLight;
  private _fillLight?: DirectionalLight;
  private _ambientLight?: AmbientLight;
  private _envTexture?: CubeTexture;
  private _bloom?: BloomElement;

  private _time: number = 0;
  private _hud?: Hud;

  private readonly _state: HudState = {
    preset: "studio",
    autoRotate: true,
    rotateSpeed: 0.4,
    orbitSpotLight: true,
    emissiveIntensity: 1.0,
    roughness: 1.0,
    metallic: 1.0,
    clearcoat: 0.0,
    envMapEnabled: true,
    spotIntensity: 4.0,
    sunIntensity: 1.5,
    ambientIntensity: 0.25,
    bloomEnabled: true,
    bloomIntensity: 1.8,
  };

  protected override async setupScene(): Promise<void> {
    // Post-Processing is nice for PBR
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = this._state.bloomIntensity;
      bloom.threshold = 0.8; // Natural HDR bloom threshold for glowing visor
      bloom.radius = 1.0;
      bloom.color = new Color(1.086, 0.904, 1.238);
      this._bloom = bloom;
    }

    // Camera setup
    this.defaultFov = (60 * Math.PI) / 180;
    this.configureCamera();

    this.defaultMoveSpeed = 5.0;
    this.setInitialCamera(new Vector3D(0, 0.3, 3), new Vector3D(0, 0.3, 0));

    // Setup Lights to showcase PBR and dramatic shadows
    const ambientLight = new AmbientLight({
      color: new Color(0.351, 0.381, 0.422),
      intensity: this._state.ambientIntensity,
    });
    this._ambientLight = ambientLight;
    this.scene.add(ambientLight);

    const mainLight = new DirectionalLight({
      color: new Color(1, 0.977, 0.953),
      intensity: this._state.sunIntensity,
    });
    mainLight.position.set(5, 8, 5);
    mainLight.direction.set(-1, -1.5, -1);
    mainLight.castShadow = true;
    mainLight.shadowBias = 0.003;
    this._mainLight = mainLight;
    this.scene.add(mainLight);

    // Studio Key Spotlight for crisp contour shadows
    const keySpotLight = new SpotLight({
      color: new Color(1, 0.929, 0.85),
      intensity: this._state.spotIntensity,
      direction: new Vector3D(0, -1, -0.5),
      angle: Math.PI / 4,
      penumbra: 0.3,
      distance: 20.0,
    });
    keySpotLight.position.set(0, 4, 2);
    keySpotLight.castShadow = true;
    keySpotLight.shadowResolution = 2048;
    keySpotLight.shadowBias = 0.004;
    this._keySpotLight = keySpotLight;
    this.scene.add(keySpotLight);

    const fillLight = new DirectionalLight({
      color: new Color(0.579, 0.73, 0.904),
      intensity: 0.5,
    });
    fillLight.position.set(-5, 2, -2);
    fillLight.direction.set(1, -0.4, 0.5);
    this._fillLight = fillLight;
    this.scene.add(fillLight);

    // Load an environment map for reflections
    const envTexture = await this.loadSkybox("./assets/ibl/env.webp");
    await this.loadIbl("./assets/ibl/");
    this._envTexture = envTexture;

    // Exhibition Pedestal (Receives self & cast shadows from the helmet)
    const pedestal = new Object3D("ExhibitionPedestal");
    pedestal.geometry = new Cylinder({
      radiusTop: 0.8,
      radiusBottom: 0.9,
      height: 1.6,
      radialSegments: 48,
    }).getGeometryData();
    const pedestalMaterial = new StandardMaterial({
      color: new Color(0.381, 0.381, 0.409),
      roughness: 0.35,
      metallic: 0.8,
      envMap: envTexture,
    });
    pedestal.material = pedestalMaterial;
    this._pedestalMaterial = pedestalMaterial;
    pedestal.position.set(0, -1.5, 0);
    pedestal.castShadow = true;
    this.scene.add(pedestal);

    // Studio Ground Floor
    const ground = new Object3D("StudioFloor");
    ground.geometry = new Cylinder({
      radiusTop: 12.0,
      radiusBottom: 12.0,
      height: 0.1,
      radialSegments: 64,
    }).getGeometryData();
    const groundMaterial = new StandardMaterial({
      color: new Color(0.278, 0.299, 0.317),
      roughness: 0.6,
      metallic: 0.2,
      envMap: envTexture,
    });
    ground.material = groundMaterial;
    this._groundMaterial = groundMaterial;
    ground.position.set(0, -2.35, 0);
    this.scene.add(ground);

    // Load the GLTF Model
    try {
      const gltfLoader = new GltfLoader({ basePath: "./assets/" });
      const helmet = await gltfLoader.load("DamagedHelmet.glb");
      helmet.position.set(0, 0, 0);

      // Recursively configure castShadow and environment map, grab material
      const setupHelmetNode = (node: Object3D): void => {
        node.castShadow = true;
        if (node.material instanceof StandardMaterial) {
          node.material.envMap = envTexture;
          this._helmetMaterial = node.material;
        }
        node.children.forEach(setupHelmetNode);
      };
      setupHelmetNode(helmet);

      this._helmet = helmet;
      this.scene.add(helmet);
    } catch (e) {
      console.error("Failed to load DamagedHelmet:", e);
    }

    // Initialize interactive HUD
    this._hud = new Hud(
      {
        applyPreset: (preset: LightingPresetId): void => this._applyPreset(preset),
        toggleAutoRotate: (): void => {
          this._state.autoRotate = !this._state.autoRotate;
          this._hud?.sync(this._state);
        },
        toggleOrbitSpot: (): void => {
          this._state.orbitSpotLight = !this._state.orbitSpotLight;
          this._hud?.sync(this._state);
        },
        toggleEnvMap: (): void => this._toggleEnvMap(),
        toggleBloom: (): void => this._toggleBloom(),
        setSlider: (name: HelmetSlider, val: number): void => this._setSlider(name, val),
        flyToCamera: (view: keyof typeof CAMERA_PRESETS): void => this._flyToCamera(view),
        resetToReference: (): void => this._resetToReference(),
      },
      this,
    );
    this._hud.sync(this._state);
  }

  private _applyPreset(preset: LightingPresetId): void {
    const cfg = LIGHT_PRESETS[preset];
    this._state.preset = preset;

    this._state.spotIntensity = cfg.spotIntensity;
    this._state.sunIntensity = cfg.sunIntensity;
    this._state.ambientIntensity = cfg.ambientIntensity;
    this._state.emissiveIntensity = cfg.emissiveIntensity;
    this._state.bloomIntensity = cfg.bloomIntensity;

    if (this._keySpotLight) {
      this._keySpotLight.intensity = cfg.spotIntensity;
      this._keySpotLight.color.copyFrom(cfg.spotColor);
    }
    if (this._mainLight) {
      this._mainLight.intensity = cfg.sunIntensity;
      this._mainLight.color.copyFrom(cfg.sunColor);
    }
    if (this._fillLight) {
      this._fillLight.intensity = cfg.fillIntensity;
      this._fillLight.color.copyFrom(cfg.fillColor);
    }
    if (this._ambientLight) {
      this._ambientLight.intensity = cfg.ambientIntensity;
      this._ambientLight.color.copyFrom(cfg.ambientColor);
    }
    if (this._helmetMaterial) {
      this._helmetMaterial.emissiveIntensity = cfg.emissiveIntensity;
    }
    if (this._bloom) {
      this._bloom.intensity = cfg.bloomIntensity;
    }

    this._hud?.sync(this._state);
  }

  private _toggleEnvMap(): void {
    this._state.envMapEnabled = !this._state.envMapEnabled;
    const env = this._state.envMapEnabled ? this._envTexture : undefined;
    if (this._helmetMaterial) this._helmetMaterial.envMap = env;
    if (this._pedestalMaterial) this._pedestalMaterial.envMap = env;
    if (this._groundMaterial) this._groundMaterial.envMap = env;
    this._hud?.sync(this._state);
  }

  private _toggleBloom(): void {
    this._state.bloomEnabled = !this._state.bloomEnabled;
    if (this._bloom) {
      this._bloom.enabled = this._state.bloomEnabled;
    }
    this._hud?.sync(this._state);
  }

  private _setSlider(name: HelmetSlider, val: number): void {
    switch (name) {
      case "RotateSpeed":
        this._state.rotateSpeed = val;
        break;
      case "EmissiveIntensity":
        this._state.emissiveIntensity = val;
        if (this._helmetMaterial) this._helmetMaterial.emissiveIntensity = val;
        break;
      case "Roughness":
        this._state.roughness = val;
        if (this._helmetMaterial) this._helmetMaterial.roughness = val;
        break;
      case "Metallic":
        this._state.metallic = val;
        if (this._helmetMaterial) this._helmetMaterial.metallic = val;
        break;
      case "Clearcoat":
        this._state.clearcoat = val;
        if (this._helmetMaterial) this._helmetMaterial.clearcoat = val;
        break;
      case "SpotIntensity":
        this._state.spotIntensity = val;
        if (this._keySpotLight) this._keySpotLight.intensity = val;
        break;
      case "SunIntensity":
        this._state.sunIntensity = val;
        if (this._mainLight) this._mainLight.intensity = val;
        break;
      case "AmbientIntensity":
        this._state.ambientIntensity = val;
        if (this._ambientLight) this._ambientLight.intensity = val;
        break;
      case "BloomIntensity":
        this._state.bloomIntensity = val;
        if (this._bloom) this._bloom.intensity = val;
        break;
    }
    this._hud?.sync(this._state);
  }

  private _flyToCamera(view: keyof typeof CAMERA_PRESETS): void {
    const target = CAMERA_PRESETS[view];
    if (target) {
      this.camera.flyTo({
        position: target.pos,
        target: target.target,
        duration: 0.9,
      });
    }
  }

  private _resetToReference(): void {
    this._state.autoRotate = true;
    this._state.rotateSpeed = 0.4;
    this._state.orbitSpotLight = true;
    this._state.roughness = 1.0;
    this._state.metallic = 1.0;
    this._state.clearcoat = 0.0;
    this._state.envMapEnabled = true;
    this._state.bloomEnabled = true;

    if (this._helmetMaterial) {
      this._helmetMaterial.roughness = 1.0;
      this._helmetMaterial.metallic = 1.0;
      this._helmetMaterial.clearcoat = 0.0;
      this._helmetMaterial.envMap = this._envTexture;
    }
    if (this._pedestalMaterial) this._pedestalMaterial.envMap = this._envTexture;
    if (this._groundMaterial) this._groundMaterial.envMap = this._envTexture;
    if (this._bloom) this._bloom.enabled = true;

    this._applyPreset("studio");
    this._flyToCamera("hero");
  }

  public override destroy(): void {
    this._hud?.dispose();
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (isTypingTarget()) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.code === "Space") {
      event.preventDefault();
      this._state.autoRotate = !this._state.autoRotate;
      this._hud?.sync(this._state);
    } else if (event.code === "Digit1") {
      this._applyPreset("studio");
    } else if (event.code === "Digit2") {
      this._applyPreset("cyberpunk");
    } else if (event.code === "Digit3") {
      this._applyPreset("highnoon");
    } else if (event.code === "Digit4") {
      this._applyPreset("noir");
    } else if (event.code === "KeyR") {
      this._resetToReference();
    }
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    this._time += deltaTime;

    // Rotate helmet when autoRotate is active
    if (this._helmet && this._state.autoRotate) {
      this._helmet.rotation.y += deltaTime * this._state.rotateSpeed;
      this._helmet.updateMatrixWorld();
    }

    // Orbit key spotlight when enabled
    if (this._keySpotLight && this._state.orbitSpotLight) {
      const angle = this._time * 0.5;
      this._keySpotLight.position.x = Math.sin(angle) * 2.5;
      this._keySpotLight.position.z = 2.0 + Math.cos(angle) * 1.0;
      this._keySpotLight.direction.set(
        -this._keySpotLight.position.x * 0.3,
        -1.0,
        -this._keySpotLight.position.z * 0.3,
      );
      this._keySpotLight.updateMatrixWorld();
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase({
  rendererType: RendererType.WEB_GPU,
});
app.start().catch((err: unknown) => console.error("[Showcase13] Failed to start:", err));
