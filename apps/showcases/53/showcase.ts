import {
  AbstractShowcase,
  AmbientLight,
  attachRainStreaks,
  Color,
  DirectionalLight,
  Easing,
  FlyController,
  Fog,
  FogMode,
  GltfLoader,
  Keys,
  MathUtils,
  mulberry32,
  Object3D,
  OceanGridGeometry,
  OceanMaterial,
  PlanarReflectionNode,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  SpotLight,
  StandardMaterial,
  Texture,
  TextureWrap,
  ToneMappingMode,
  Vector2D,
  Vector3D,
} from "@small-world-machine/engine";
import type {
  AbstractMaterial,
  BloomElement,
  CubeTexture,
  EngineOptions,
  GeometryDataInterface,
  HbaoElement,
  ToneMappingElement,
  VolumetricFogElement,
  CustomShaderMaterial,
  OceanWaveSample,
  RainStreaks,
} from "@small-world-machine/engine";
import {
  ColorOverLifeAffector,
  DragAffector,
  GravityAffector,
  ParticleMeshRenderer,
  ParticleSystem,
  SizeGrowthAffector,
  SmokeSpriteMaterial,
} from "@small-world-machine/vfx-extras";
import type { ParticleOptions } from "@small-world-machine/vfx-extras";
import {
  createEmissiveAccentMaterial,
  createRockFoundationMaterial,
  createTrimArmorMaterial,
  FORTRESS_WATER_Y,
  updateFortressWaterlineTime,
} from "./FortressMaterials.js";
import type { FortressPbrMaps } from "./FortressMaterials.js";
import { ATMOSPHERE_KEYS, Hud } from "./Hud.js";
import type { AtmosphereKey, CameraPresetKey, FortressHudState } from "./Hud.js";

interface CameraView {
  position: Vector3D;
  target: Vector3D;
}

interface AtmospherePreset {
  moonColor: Color;
  moonIntensity: number;
  moonDirection: Vector3D;
  ambientColor: Color;
  ambientIntensity: number;
  hangarColor: Color;
  hangarIntensity: number;
  fogColor: Color;
  fogDensity: number;
  volumetricDensity: number;
  exposure: number;
  envIntensity: number;
}

interface PropPart {
  name: string;
  geometry: GeometryDataInterface;
  material: AbstractMaterial;
  offset: Vector3D;
}

interface BuoyNode {
  root: Object3D;
  baseX: number;
  baseZ: number;
  baseYaw: number;
}

interface SearchlightNode {
  light: SpotLight;
  phaseOffset: number;
  speed: number;
  baseYaw: number;
}

interface QaSwm53Hook {
  sample(): FortressHudState & {
    renderer: string;
    trisEstimate: number;
    time: number;
    isFlying: boolean;
    cameraPosition: [number, number, number];
  };
  setView(pos: number[], target: number[]): void;
  setCameraPreset(preset: CameraPresetKey, instant?: boolean): void;
  setAtmosphere(atmosphere: AtmosphereKey): void;
  setReflection(on: boolean): void;
  setBloom(on: boolean): void;
  setFog(on: boolean): void;
  setHbao(on: boolean): void;
  setHiDpi(on: boolean): void;
  setSearchlights(on: boolean): void;
  triggerLightning(): void;
}

declare global {
  interface Window {
    __qaSwm53?: QaSwm53Hook;
  }
}

const CAMERA_VIEWS: Record<CameraPresetKey, CameraView> = {
  wide: {
    position: new Vector3D(490, 145, 870),
    target: new Vector3D(0, 278, 0),
  },
  hangar: {
    position: new Vector3D(106, 121.5, 52),
    target: new Vector3D(56, 121.5, 10),
  },
  crown: {
    position: new Vector3D(-225, 290, 470),
    target: new Vector3D(0, 365, 0),
  },
  waterline: {
    position: new Vector3D(185, 22, 235),
    target: new Vector3D(0, 62, 0),
  },
  trench: {
    position: new Vector3D(-228, 22, 168),
    target: new Vector3D(-132, 10, 56),
  },
};

const ATMOSPHERES: Record<AtmosphereKey, AtmospherePreset> = {
  storm: {
    moonColor: new Color(0.58, 0.76, 1.0),
    moonIntensity: 3.1,
    moonDirection: new Vector3D(0.38, -0.4, 0.83).normalize(),
    ambientColor: new Color(0.14, 0.2, 0.32),
    ambientIntensity: 0.62,
    hangarColor: new Color(1.0, 0.16, 0.08),
    hangarIntensity: 260,
    fogColor: new Color(0.015, 0.025, 0.045),
    fogDensity: 0.00022,
    volumetricDensity: 0.00055,
    exposure: 1.18,
    envIntensity: 1.25,
  },
  twilight: {
    moonColor: new Color(0.72, 0.84, 1.0),
    moonIntensity: 3.3,
    moonDirection: new Vector3D(0.32, -0.48, 0.82).normalize(),
    ambientColor: new Color(0.22, 0.3, 0.42),
    ambientIntensity: 0.88,
    hangarColor: new Color(1.0, 0.22, 0.12),
    hangarIntensity: 210,
    fogColor: new Color(0.026, 0.04, 0.068),
    fogDensity: 0.00018,
    volumetricDensity: 0.00048,
    exposure: 1.25,
    envIntensity: 1.45,
  },
  redAlert: {
    moonColor: new Color(0.68, 0.24, 0.24),
    moonIntensity: 2.3,
    moonDirection: new Vector3D(0.42, -0.46, 0.78).normalize(),
    ambientColor: new Color(0.32, 0.09, 0.11),
    ambientIntensity: 0.75,
    hangarColor: new Color(1.0, 0.08, 0.04),
    hangarIntensity: 480,
    fogColor: new Color(0.045, 0.014, 0.018),
    fogDensity: 0.0003,
    volumetricDensity: 0.00085,
    exposure: 1.2,
    envIntensity: 0.9,
  },
};

const FLY_SPEED_DEFAULT = 65;
const FLY_SPEED_MIN = 2;
const FLY_SPEED_MAX = 600;
const FLY_SPEED_STEP = 1.25;

const BASE_HOVER_SHUTTLE_Y = 132.0;
const SEARCHLIGHT_INTENSITY = 1200;
const DEFAULT_MAX_PIXEL_RATIO = 1.15;
const HIGH_DPI_MAX_PIXEL_RATIO = 1.5;

const FLIGHT_NAV_KEYS: ReadonlySet<string> = new Set([
  Keys.W,
  Keys.A,
  Keys.S,
  Keys.D,
  Keys.UP,
  Keys.DOWN,
  Keys.LEFT,
  Keys.RIGHT,
  Keys.SPACE,
  Keys.E,
  Keys.Q,
  Keys.C,
]);

/**
 * Showcase 53 — Dark Fortress (Wassermond).
 *
 * Canonical 1:1 485 m closed Mustafar volcanic basalt obelisk (Obi-Wan Kenobi Part IV)
 * with mid-height cantilevered 24 m durasteel through-flight hangar bay, carved basalt
 * core cliff bays & curved pilasters, 16 ceiling-racked 1:1 Hex-Wing fighters,
 * 20 m Tri-Wing shuttles, 1.82 m Space Trooper formation, 3-tier waterline wetness
 * (`CustomShaderMaterial`), and horizon-spanning `OceanGridGeometry` + `OceanMaterial`.
 */
export class Showcase extends AbstractShowcase {
  private _hud?: Hud;
  private _fly: FlyController | undefined = undefined;
  private _reflection: PlanarReflectionNode | undefined = undefined;
  private _oceanMaterial: OceanMaterial | undefined = undefined;
  private _oceanMesh: Object3D | undefined = undefined;
  private _skyCube: CubeTexture | undefined = undefined;
  private _rain: RainStreaks | undefined = undefined;
  private _spraySystem: ParticleSystem | undefined = undefined;
  private _sprayRenderer: ParticleMeshRenderer | undefined = undefined;
  private _sprayMaterial: SmokeSpriteMaterial | undefined = undefined;
  private _sprayAccumulator = 0;
  private readonly _sprayRand = mulberry32(5302);
  private readonly _spraySeedRand = mulberry32(5302 ^ 0x5bd1e995);
  private readonly _sprayPos = new Vector3D();
  private readonly _sprayVel = new Vector3D();
  private readonly _sprayColor = new Color(0, 0, 0, 0.24);
  private readonly _sprayEmitOpts: ParticleOptions = {
    position: this._sprayPos,
    velocity: this._sprayVel,
    color: this._sprayColor,
    size: 4.0,
    maxLife: 3.0,
    alpha: 0.24,
  };
  private _rockMaterial: CustomShaderMaterial | undefined = undefined;
  private _moonLight?: DirectionalLight;
  private _ambientLight?: AmbientLight;
  private readonly _hangarLights: PointLight[] = [];
  private readonly _deckLights: PointLight[] = [];
  private readonly _searchlights: SearchlightNode[] = [];
  private _hoverShuttleNodes: Object3D[] = [];
  private readonly _buoys: BuoyNode[] = [];
  private readonly _waveSample: OceanWaveSample = {
    height: 0,
    displacementX: 0,
    displacementZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    crest: 0,
  };

  private _cameraPreset: CameraPresetKey = "wide";
  private _atmosphere: AtmosphereKey = "storm";
  private _reflectionEnabled: boolean = true;
  private _bloomEnabled: boolean = true;
  private _fogEnabled: boolean = true;
  private _hbaoEnabled: boolean = false;
  private _hiDpiEnabled: boolean = false;
  private _searchlightsEnabled: boolean = true;
  private _waveScale: number = 1.05;
  private _windSpeed: number = 1.28;
  private _choppiness: number = 1.15;
  private _caustics: number = 0.52;
  private _foamCoverage: number = 0.36;
  private _elapsed: number = 0;
  private _manualLightningTimer: number = 0;
  private _trisEstimate: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      postProcessing: { enabled: true },
      quality: { maxPixelRatio: DEFAULT_MAX_PIXEL_RATIO },
      ...options,
    });
    this.defaultCameraController = "fly";
    this.defaultMoveSpeed = FLY_SPEED_DEFAULT;
    this.defaultFov = MathUtils.degToRad(40);
    this.defaultFar = 5200;
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    this._applyCameraPreset("wide", true);
    this.renderer.setClearColor(new Color(0.012, 0.022, 0.042, 1.0));

    this._setupLighting();
    this._setupPostProcessing();

    const [, skyCube] = await Promise.all([
      this.loadIbl("/assets/showcases/53/ibl", ATMOSPHERES[this._atmosphere].envIntensity),
      this.loadSkybox("/assets/showcases/53/ibl/env.webp", 4800),
    ]);
    this._skyCube = skyCube;

    const texOpts = {
      generateMipmaps: true,
      flipY: false,
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
    };

    const shuttleTexOpts = {
      generateMipmaps: true,
      flipY: false,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    };

    const [
      armorAlbedo,
      armorNormal,
      armorRoughness,
      armorMetallic,
      armorAo,
      trimAlbedo,
      trimNormal,
      trimRoughness,
      trimMetallic,
      rockAlbedo,
      rockNormal,
      rockRoughness,
      rockAo,
      shuttleAlbedo,
      shuttleNormal,
      shuttleRoughness,
    ] = await Promise.all([
      Texture.fromUrl("/assets/showcases/53/textures/armor_albedo.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/armor_normal.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/armor_roughness.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/armor_metallic.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/armor_ao.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/trim_albedo.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/trim_normal.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/trim_roughness.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/trim_metallic.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/rock_albedo.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/rock_normal.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/rock_roughness.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/rock_ao.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/shuttle_albedo.webp", shuttleTexOpts),
      Texture.fromUrl("/assets/showcases/53/textures/shuttle_normal.webp", shuttleTexOpts),
      Texture.fromUrl("/assets/showcases/53/textures/shuttle_roughness.webp", shuttleTexOpts),
    ]);

    const armorMaps: FortressPbrMaps = {
      diffuseMap: armorAlbedo,
      normalMap: armorNormal,
      roughnessMap: armorRoughness,
      metallicMap: armorMetallic,
      aoMap: armorAo,
      envMap: this.scene.prefilterMap,
    };
    const trimMaps: FortressPbrMaps = {
      diffuseMap: trimAlbedo,
      normalMap: trimNormal,
      roughnessMap: trimRoughness,
      metallicMap: trimMetallic,
      envMap: this.scene.prefilterMap,
    };
    const rockMaps: FortressPbrMaps = {
      diffuseMap: rockAlbedo,
      normalMap: rockNormal,
      roughnessMap: rockRoughness,
      aoMap: rockAo,
      envMap: this.scene.prefilterMap,
    };

    // 3A/3C: Outer flanks + waterline crags + hangar rock bays use matte dark 4K Mustafar basalt
    const rockMat = createRockFoundationMaterial(rockMaps, {
      wetWaterline: true,
      color: new Color(0.46, 0.49, 0.54),
      metallic: 0.02,
      roughness: 0.9,
      normalScale: new Vector2D(1.55, 1.55),
      waterY: FORTRESS_WATER_Y,
      wetBandHeight: 9.5,
      waveLapAmplitude: 0.85,
      wetAlbedoScale: 0.36,
    });
    // 3B: Human-engineered 4K Cycles-baked Imperial durasteel exclusively for hangar bay deck
    // Puddle/dry steel contrast [0.09..0.76] and edge wear live directly in armor_roughness.webp
    const deckMat = createTrimArmorMaterial(armorMaps, {
      color: new Color(0.76, 0.8, 0.86),
      metallic: 0.96,
      roughness: 0.92,
      normalScale: new Vector2D(1.35, 1.35),
    });
    const trimMat = createTrimArmorMaterial(trimMaps, {
      color: new Color(0.64, 0.68, 0.75),
      metallic: 0.96,
      roughness: 0.88,
      normalScale: new Vector2D(1.25, 1.25),
    });
    const trooperArmorMat = new StandardMaterial({
      color: new Color(0.86, 0.88, 0.9),
      metallic: 0.14,
      roughness: 0.24,
      envMap: this.scene.prefilterMap,
    });
    const trooperUnderMat = new StandardMaterial({
      color: new Color(0.055, 0.06, 0.072),
      metallic: 0.1,
      roughness: 0.66,
      envMap: this.scene.prefilterMap,
    });
    const trooperVisorMat = new StandardMaterial({
      color: new Color(0.015, 0.018, 0.025),
      metallic: 0.35,
      roughness: 0.06,
      envMap: this.scene.prefilterMap,
    });
    const trooperGearMat = new StandardMaterial({
      color: new Color(0.11, 0.12, 0.14),
      metallic: 0.78,
      roughness: 0.36,
      envMap: this.scene.prefilterMap,
    });
    const commanderArmorMat = new StandardMaterial({
      color: new Color(0.76, 0.8, 0.86),
      metallic: 1.0,
      roughness: 0.055,
      envMap: this.scene.prefilterMap,
    });
    const commanderGearMat = new StandardMaterial({
      color: new Color(0.64, 0.68, 0.74),
      metallic: 0.96,
      roughness: 0.14,
      envMap: this.scene.prefilterMap,
    });
    const commanderCapeMat = new StandardMaterial({
      color: new Color(0.025, 0.028, 0.036),
      metallic: 0.03,
      roughness: 0.82,
      envMap: this.scene.prefilterMap,
    });
    const commanderCapeTrimMat = new StandardMaterial({
      color: new Color(0.54, 0.048, 0.055),
      metallic: 0.05,
      roughness: 0.76,
      envMap: this.scene.prefilterMap,
    });
    const shuttleMat = new StandardMaterial({
      color: new Color(0.95, 0.96, 0.98),
      metallic: 0.28,
      roughness: 0.9,
      normalScale: new Vector2D(1.0, 1.0),
      diffuseMap: shuttleAlbedo,
      normalMap: shuttleNormal,
      roughnessMap: shuttleRoughness,
      envMap: this.scene.prefilterMap,
    });
    const shuttleVisorMat = new StandardMaterial({
      color: new Color(0.015, 0.018, 0.025),
      metallic: 0.25,
      roughness: 0.06,
      envMap: this.scene.prefilterMap,
    });
    const hexWingHullMat = new StandardMaterial({
      color: new Color(0.58, 0.62, 0.68),
      metallic: 0.42,
      roughness: 0.42,
      envMap: this.scene.prefilterMap,
    });
    const hexWingSolarMat = new StandardMaterial({
      color: new Color(0.06, 0.07, 0.09),
      metallic: 0.18,
      roughness: 0.26,
      envMap: this.scene.prefilterMap,
    });
    const hexWingTrimMat = new StandardMaterial({
      color: new Color(0.24, 0.27, 0.31),
      metallic: 0.55,
      roughness: 0.38,
      envMap: this.scene.prefilterMap,
    });
    const hexWingCockpitMat = new StandardMaterial({
      color: new Color(0.02, 0.025, 0.035),
      metallic: 0.15,
      roughness: 0.07,
      envMap: this.scene.prefilterMap,
    });
    const coolLightMat = createEmissiveAccentMaterial(new Color(0.66, 0.88, 1.0), 2.2);
    const visorMat = createEmissiveAccentMaterial(new Color(1.0, 0.14, 0.08), 3.8);
    const hangarMat = createEmissiveAccentMaterial(new Color(1.0, 0.16, 0.08), 3.4);
    const beaconMat = createEmissiveAccentMaterial(new Color(0.45, 0.82, 1.0), 2.8);
    const ionMat = createEmissiveAccentMaterial(new Color(0.45, 0.85, 1.0), 3.6);
    const hexWingEngineMat = createEmissiveAccentMaterial(new Color(1.0, 0.22, 0.12), 2.8);

    this._rockMaterial = rockMat;

    const loader = new GltfLoader();
    const [
      fortressRoot,
      padRoot,
      turretRoot,
      shuttleRoot,
      flightShuttleRoot,
      hexWingRoot,
      deckPropsRoot,
    ] = await Promise.all([
      loader.load("/assets/showcases/53/models/fortress.glb"),
      loader.load("/assets/showcases/53/models/landing_pad.glb"),
      loader.load("/assets/showcases/53/models/turbolaser.glb"),
      loader.load("/assets/showcases/53/models/tri_wing_shuttle.glb"),
      loader.load("/assets/showcases/53/models/tri_wing_shuttle_flight.glb"),
      loader.load("/assets/showcases/53/models/hex_wing_fighter.glb"),
      loader.load("/assets/showcases/53/models/deck_props.glb"),
    ]);

    const fortressMaterialsByNode: Record<string, AbstractMaterial> = {
      BastionBase: rockMat,
      BastionRock: rockMat,
      FlightDeck: deckMat,
      MainWedge: rockMat,
      TrimFins: trimMat,
      HangarLights: coolLightMat,
      CommandCrown: rockMat,
      BridgeVisor: visorMat,
      HangarGlow: hangarMat,
    };

    fortressRoot.traverse((node): void => {
      if (!node.geometry) return;
      const key = node.name.replace(/_mesh$/, "");
      const mat = fortressMaterialsByNode[key] ?? rockMat;
      node.material = mat;
      const isGlowing = key === "BridgeVisor" || key === "HangarGlow" || key === "HangarLights";
      node.castShadow = !isGlowing;
      node.receiveShadow = !isGlowing;
      this._trisEstimate += Math.floor((node.geometry.indices?.length ?? 0) / 3);
    });
    this.scene.add(fortressRoot);

    this._placeModularProps(
      padRoot,
      turretRoot,
      shuttleRoot,
      flightShuttleRoot,
      hexWingRoot,
      deckPropsRoot,
      {
        trimMat,
        trooperArmorMat,
        trooperUnderMat,
        trooperVisorMat,
        trooperGearMat,
        commanderArmorMat,
        commanderGearMat,
        commanderCapeMat,
        commanderCapeTrimMat,
        shuttleMat,
        shuttleVisorMat,
        hexWingHullMat,
        hexWingSolarMat,
        hexWingTrimMat,
        hexWingCockpitMat,
        hexWingEngineMat,
        beaconMat,
        ionMat,
      },
    );

    this._setupOcean();
    this._setupWeatherAndSpray();
    this._applyAtmosphere(this._atmosphere);
    this._setupControls();
    this.sceneParams.addParam("Wave Scale", 0.0, 2.5, 0.05, this._waveScale, (v: number): void =>
      this._setWaveScale(v),
    );
    this.sceneParams.addParam("Wind Speed", 0.0, 3.0, 0.05, this._windSpeed, (v: number): void =>
      this._setWindSpeed(v),
    );
    this.sceneParams.addParam("Choppiness", 0.0, 2.5, 0.05, this._choppiness, (v: number): void =>
      this._setChoppiness(v),
    );
    this.sceneParams.addParam("Caustics", 0.0, 1.5, 0.02, this._caustics, (v: number): void =>
      this._setCaustics(v),
    );
    this.sceneParams.addParam(
      "Foam Coverage",
      0.0,
      1.0,
      0.02,
      this._foamCoverage,
      (v: number): void => this._setFoamCoverage(v),
    );
    this._installQaHook();
    this._createHud();
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._elapsed += deltaTime;
    if (this._manualLightningTimer > 0) {
      this._manualLightningTimer = Math.max(0, this._manualLightningTimer - deltaTime);
    }

    if (this._rockMaterial) {
      updateFortressWaterlineTime(this._rockMaterial, this._elapsed);
    }

    const bobOffset = Math.sin(this._elapsed * 1.4) * 0.75;
    for (let i = 0; i < this._hoverShuttleNodes.length; i++) {
      const node = this._hoverShuttleNodes[i]!;
      node.position.y = BASE_HOVER_SHUTTLE_Y + bobOffset;
    }

    if (this._oceanMaterial) {
      this._oceanMaterial.time = this._elapsed;
      this._oceanMaterial.downwashStrength = 0.78 - bobOffset * 0.1;
    }
    this._updateBuoys();
    if (this._oceanMesh) {
      OceanGridGeometry.snapToTarget(
        this._oceanMesh,
        this.camera.position.x,
        this.camera.position.z,
        8,
      );
    }

    const searchlightIntensity = this._searchlightsEnabled ? SEARCHLIGHT_INTENSITY : 0;
    const searchlights = this._searchlights;
    for (let i = 0; i < searchlights.length; i++) {
      const s = searchlights[i]!;
      const yaw = s.baseYaw + Math.sin(this._elapsed * s.speed + s.phaseOffset) * 0.52;
      s.light.direction
        .set(
          Math.sin(yaw),
          -0.34 + 0.06 * Math.cos(this._elapsed * 0.7 + s.phaseOffset),
          Math.cos(yaw),
        )
        .normalize();
      s.light.intensity = searchlightIntensity;
    }

    const flash = this._evalLightningFlash(this._elapsed);
    const preset = ATMOSPHERES[this._atmosphere];
    if (this._moonLight) {
      this._moonLight.intensity = preset.moonIntensity + flash * 6.5;
    }
    if (this._ambientLight) {
      this._ambientLight.intensity = preset.ambientIntensity + flash * 1.35;
    }
    const vfog = this.renderer.postProcessing.get<VolumetricFogElement>(
      PostProcessingEffectType.VOLUMETRIC_FOG,
    );
    if (vfog) {
      vfog.ambientInject = 0.08 + flash * 0.28;
    }

    if (this._rain) {
      this._rain.update(deltaTime, this._elapsed, this.camera.position);
    }
    this._stepSeaSpray(deltaTime);
    if (this._reflectionEnabled) {
      this._reflection?.updateReflection(this.scene, this.camera, this.renderer);
    }
  }

  public override resetCamera(): void {
    this._setCameraPreset(this._cameraPreset, false);
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey || event.ctrlKey) {
      super.onKeyDown(event);
      return;
    }
    if (this.camera.isFlying && FLIGHT_NAV_KEYS.has(event.code)) {
      this.camera.cancelFlight?.();
      this._syncCameraController();
    }
    super.onKeyDown(event);
    if (this._hud?.handleKey(event)) return;
    if (event.defaultPrevented) return;
    if (event.code === Keys.D1) this._setCameraPreset("wide");
    else if (event.code === Keys.D2) this._setCameraPreset("hangar");
    else if (event.code === Keys.D3) this._setCameraPreset("crown");
    else if (event.code === Keys.D4) this._setCameraPreset("waterline");
    else if (event.code === Keys.D5) this._setCameraPreset("trench");
    else if (event.code === Keys.L) {
      const nextIdx = (ATMOSPHERE_KEYS.indexOf(this._atmosphere) + 1) % ATMOSPHERE_KEYS.length;
      this._setAtmosphere(ATMOSPHERE_KEYS[nextIdx]!);
    } else if (event.code === Keys.F) {
      this._manualLightningTimer = 0.55;
    }
  }

  private _setupLighting(): void {
    this._ambientLight = new AmbientLight({
      color: new Color(0.2, 0.27, 0.38),
      intensity: 0.75,
    });
    this.scene.add(this._ambientLight);

    this._moonLight = new DirectionalLight({
      direction: new Vector3D(0.38, -0.4, 0.83).normalize(),
      color: new Color(0.62, 0.78, 1.0),
      intensity: 3.1,
      numCascades: 3,
      cascadeSplitLambda: 0.65,
    });
    this._moonLight.castShadow = true;
    this._moonLight.shadowBias = 0.002;
    this._moonLight.shadowResolution = 2048;
    this.scene.add(this._moonLight);

    // Central crimson bridge & blast-door glow inside the 24 m tall hangar core
    const hangarPositions: [number, number, number][] = [
      [0.0, 123.0, 56.0],
      [-50.0, 124.0, 0.0],
      [50.0, 124.0, 0.0],
    ];
    for (const [hx, hy, hz] of hangarPositions) {
      const light = new PointLight({
        color: new Color(1.0, 0.16, 0.08),
        intensity: 260,
        distance: 150,
      });
      light.position.set(hx, hy, hz);
      this._hangarLights.push(light);
      this.scene.add(light);
    }

    // Cool steel-cyan overhead flood lights illuminating the cantilevered durasteel flight deck
    const deckPositions: [number, number, number][] = [
      [-68.0, 136.0, 16.0],
      [68.0, 136.0, 16.0],
      [-26.0, 136.0, 68.0],
      [26.0, 136.0, 68.0],
    ];
    for (const [dx, dy, dz] of deckPositions) {
      const light = new PointLight({
        color: new Color(0.68, 0.88, 1.0),
        intensity: 340,
        distance: 160,
      });
      light.position.set(dx, dy, dz);
      this._deckLights.push(light);
      this.scene.add(light);
    }

    const searchlightMounts: ReadonlyArray<{
      x: number;
      y: number;
      z: number;
      baseYaw: number;
      phaseOffset: number;
      speed: number;
    }> = [
      { x: -108.0, y: 114.8, z: 42.0, baseYaw: -0.78, phaseOffset: 0.0, speed: 0.48 },
      { x: 108.0, y: 114.8, z: 42.0, baseYaw: 0.78, phaseOffset: 1.15, speed: 0.42 },
    ];
    for (const cfg of searchlightMounts) {
      const yaw = cfg.baseYaw + Math.sin(cfg.phaseOffset) * 0.45;
      const light = new SpotLight({
        color: new Color(0.75, 0.9, 1.0),
        intensity: this._searchlightsEnabled ? SEARCHLIGHT_INTENSITY : 0,
        distance: 750,
        angle: 0.24,
        penumbra: 0.65,
        decay: 1.6,
        direction: new Vector3D(
          Math.sin(yaw),
          -0.32 + 0.06 * Math.cos(cfg.phaseOffset),
          Math.cos(yaw),
        ).normalize(),
      });
      light.position.set(cfg.x, cfg.y, cfg.z);
      light.castShadow = false;
      this.scene.add(light);
      this._searchlights.push({
        light,
        phaseOffset: cfg.phaseOffset,
        speed: cfg.speed,
        baseYaw: cfg.baseYaw,
      });
    }

    this.scene.fog = new Fog({
      mode: FogMode.EXP2,
      color: new Color(0.035, 0.055, 0.09),
      density: 0.00022,
    });
  }

  private _setupPostProcessing(): void {
    const pp = this.renderer.postProcessing;
    pp.enabled = true;

    const hbao = pp.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = this._hbaoEnabled;
      hbao.radius = 2.2;
      hbao.intensity = 1.1;
    }

    const bloom = pp.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.threshold = 1.0;
      bloom.intensity = 0.72;
    }

    const vfog = pp.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    if (vfog) {
      vfog.enabled = true;
      vfog.samples = 12;
      vfog.density = 0.00055;
      vfog.maxDistance = 1200;
      vfog.heightFalloff = 0.012;
      vfog.asymmetry = 0.22;
      vfog.ambientInject = 0.08;
    }

    const tone = pp.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
    if (tone) {
      tone.enabled = true;
      tone.mode = ToneMappingMode.AGX;
      tone.exposure = 1.18;
    }
  }

  private _setupOcean(): void {
    this._reflection = new PlanarReflectionNode({
      name: "WassermondOceanReflection",
      width: 512,
      height: 512,
      resolutionScale: this.renderer.quality.reflectionResolutionScale ?? 1,
    });
    this._reflection.position.set(0, FORTRESS_WATER_Y, 0);
    this._reflection.clipPlaneOffset = -0.35;
    this.scene.add(this._reflection);

    const ocean = new Object3D("WassermondOcean");
    ocean.geometry = new OceanGridGeometry({
      radius: 4400,
      radialSegments: 128,
      angularSegments: 160,
      radialExponent: 3.4,
      detailRadius: 900,
    }).getGeometryData();
    this._oceanMaterial = new OceanMaterial({
      waterColor: new Color(0.012, 0.048, 0.088),
      deepWaterColor: new Color(0.003, 0.011, 0.026),
      scatterColor: new Color(0.035, 0.22, 0.28),
      scatterStrength: 0.48,
      roughness: 0.068,
      windSpeed: this._windSpeed,
      windDirection: new Vector2D(0.84, 0.54),
      waveScale: this._waveScale,
      waveWavelength: 42.0,
      swellFadeStart: 900,
      swellFadeEnd: 3800,
      detailScale: 1.05,
      detailStrength: 1.2,
      choppiness: this._choppiness,
      foamColor: new Color(0.72, 0.81, 0.88),
      foamDistance: 5.5,
      foamCoverage: this._foamCoverage,
      waterAbsorption: [0.65, 0.28, 0.16],
      refractionStrength: 0.025,
      reflectionMap: this._reflection.renderTarget,
      reflectionStrength: 0.82,
      reflectionDistortion: 0.11,
      reflectionRoughness: 0.04,
      causticsStrength: this._caustics,
      downwashCenter: new Vector2D(168.0, -48.0),
      downwashRadius: 46.0,
      downwashStrength: 0.78,
    });
    // On WebGPU/WebGL2 leave envMap undefined so OceanMaterial samples prefiltered IBL; on
    // WebGL1 (no u_prefilterMap) bind the skybox cube so reflections and horizon sky match.
    if (this.renderer.type === RendererType.WEB_GL1 && this._skyCube) {
      this._oceanMaterial.envMap = this._skyCube;
    }
    ocean.material = this._oceanMaterial;
    ocean.position.set(0, FORTRESS_WATER_Y, 0);
    ocean.receiveShadow = true;
    ocean.frustumCulled = false;
    this._oceanMesh = ocean;
    OceanGridGeometry.snapToTarget(ocean, this.camera.position.x, this.camera.position.z, 8);
    this._reflection.excludedObjects.push(ocean);
    this.scene.add(ocean);
    this._updateBuoys();
  }

  private _setupWeatherAndSpray(): void {
    this._rain = attachRainStreaks(this.scene, {
      count: 4500,
      seed: 5301,
      halfExtent: 26,
      height: 32,
      followCameraY: true,
      exposure: 1 / 28,
      windX: 7.4,
      windZ: 4.8,
      dropSizeRange: [0.0008, 0.0026],
      color: new Color(0.8, 0.9, 1.0, 0.48),
      brightness: 1.5,
    });
    this._rain.update(0.016, 0, this.camera.position);
    this._reflection?.excludedObjects.push(this._rain.mesh);

    const sprayStart = new Color(0.32, 0.42, 0.5, 0.085);
    const sprayEnd = new Color(0.18, 0.25, 0.32, 0.0);
    this._sprayMaterial = new SmokeSpriteMaterial({
      tintStart: sprayStart,
      tintEnd: sprayEnd,
      churn: 0.3,
      softFadeDistance: 5.0,
      lightIntensity: 0,
    });

    this._spraySystem = new ParticleSystem({ capacity: 220 });
    this._spraySystem.addAffector(
      new GravityAffector({ acceleration: new Vector3D(6.5, -1.1, 4.2) }),
    );
    this._spraySystem.addAffector(new DragAffector({ drag: 0.95 }));
    this._spraySystem.addAffector(new SizeGrowthAffector({ rate: 1.2, maxScale: 9.0 }));
    this._spraySystem.addAffector(
      new ColorOverLifeAffector({
        startColor: sprayStart,
        endColor: sprayEnd,
        interpolateColor: false,
      }),
    );

    this._sprayRenderer = new ParticleMeshRenderer({
      name: "WassermondSeaSprayMist",
      system: this._spraySystem,
      geometryMode: "octagon",
      material: this._sprayMaterial,
      billboard: "spherical",
      foldAlphaIntoScale: false,
    });
    this._sprayRenderer.mesh.frustumCulled = false;
    this._sprayRenderer.mesh.castShadow = false;
    this._sprayRenderer.mesh.receiveShadow = false;
    this._reflection?.excludedObjects.push(this._sprayRenderer.mesh);
    this.scene.add(this._sprayRenderer.mesh);

    // Pre-warm crashing sea spray around the fortress rock perimeter so t=0 renders read naturally.
    for (let i = 0; i < 24; i++) {
      this._stepSeaSpray(1 / 12);
    }
  }

  private _stepSeaSpray(deltaTime: number): void {
    const sys = this._spraySystem;
    const renderer = this._sprayRenderer;
    if (!sys || !renderer) return;

    const dt = Math.min(deltaTime, 0.05);
    this._sprayAccumulator += dt * 48;
    const emitCount = Math.floor(this._sprayAccumulator);
    if (emitCount > 0) {
      this._sprayAccumulator -= emitCount;
      const rand = this._sprayRand;
      const seedRand = this._spraySeedRand;
      const opts = this._sprayEmitOpts;
      opts.position = this._sprayPos;
      opts.velocity = this._sprayVel;
      opts.color = this._sprayColor;

      for (let i = 0; i < emitCount; i++) {
        // Bias wave-crash mist toward the windward perimeter while circling the 248 m basalt crags.
        let angle = rand() * Math.PI * 2;
        if (rand() < 0.5) {
          angle = Math.atan2(-0.54, -0.84) + (rand() - 0.5) * 2.1;
        }
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const radius = 130.0 + rand() * 34.0;
        this._sprayPos.set(cosA * radius, FORTRESS_WATER_Y + 0.25 + rand() * 1.4, sinA * radius);
        const radialBurst = 2.2 + rand() * 3.4;
        this._sprayVel.set(
          cosA * radialBurst + 5.8 + (rand() - 0.5) * 2.8,
          2.1 + rand() * 2.8,
          sinA * radialBurst + 3.8 + (rand() - 0.5) * 2.8,
        );
        this._sprayColor.r = seedRand();
        opts.size = 2.8 + rand() * 2.6;
        opts.maxLife = 2.4 + rand() * 1.6;
        sys.emit(opts);
      }
    }

    if (this._sprayMaterial) {
      this._sprayMaterial.time = this._elapsed;
    }
    sys.update(dt);
    renderer.sync(this.camera.position);
  }

  private _placeModularProps(
    padRoot: Object3D,
    turretRoot: Object3D,
    shuttleRoot: Object3D,
    flightShuttleRoot: Object3D,
    hexWingRoot: Object3D,
    deckPropsRoot: Object3D,
    mats: {
      trimMat: AbstractMaterial;
      trooperArmorMat: AbstractMaterial;
      trooperUnderMat: AbstractMaterial;
      trooperVisorMat: AbstractMaterial;
      trooperGearMat: AbstractMaterial;
      commanderArmorMat: AbstractMaterial;
      commanderGearMat: AbstractMaterial;
      commanderCapeMat: AbstractMaterial;
      commanderCapeTrimMat: AbstractMaterial;
      shuttleMat: AbstractMaterial;
      shuttleVisorMat: AbstractMaterial;
      hexWingHullMat: AbstractMaterial;
      hexWingSolarMat: AbstractMaterial;
      hexWingTrimMat: AbstractMaterial;
      hexWingCockpitMat: AbstractMaterial;
      hexWingEngineMat: AbstractMaterial;
      beaconMat: AbstractMaterial;
      ionMat: AbstractMaterial;
    },
  ): void {
    const padParts = this._extractParts(padRoot, {
      LandingPadDeck: mats.trimMat,
      LandingPadBeacons: mats.beaconMat,
    });
    const turretParts = this._extractParts(turretRoot, {
      TurbolaserBody: mats.trimMat,
    });
    const shuttleParts = this._extractParts(shuttleRoot, {
      ShuttleHull: mats.shuttleMat,
      ShuttleCockpit: mats.shuttleVisorMat,
      ShuttleEngines: mats.ionMat,
    });
    const flightShuttleParts = this._extractParts(flightShuttleRoot, {
      ShuttleHull: mats.shuttleMat,
      ShuttleCockpit: mats.shuttleVisorMat,
      ShuttleEngines: mats.ionMat,
    });
    const hexWingParts = this._extractParts(hexWingRoot, {
      HexWingHull: mats.hexWingHullMat,
      HexWingSolar: mats.hexWingSolarMat,
      HexWingDarkTrim: mats.hexWingTrimMat,
      HexWingCockpit: mats.hexWingCockpitMat,
      HexWingEngines: mats.hexWingEngineMat,
    });
    const allDeckParts = this._extractParts(deckPropsRoot, {
      SpaceTrooperArmor: mats.trooperArmorMat,
      SpaceTrooperUnder: mats.trooperUnderMat,
      SpaceTrooperVisor: mats.trooperVisorMat,
      SpaceTrooperGear: mats.trooperGearMat,
      CommanderCape: mats.commanderCapeMat,
      CommanderCapeTrim: mats.commanderCapeTrimMat,
      CargoCrate: mats.trimMat,
      FuelDrumCluster: mats.trimMat,
    });
    const trooperParts = allDeckParts.filter((p) => p.name.startsWith("SpaceTrooper"));
    const commanderMaterialOverrides: Record<string, AbstractMaterial> = {
      SpaceTrooperArmor: mats.commanderArmorMat,
      SpaceTrooperGear: mats.commanderGearMat,
      CommanderCape: mats.commanderCapeMat,
      CommanderCapeTrim: mats.commanderCapeTrimMat,
    };
    const commanderParts = allDeckParts
      .filter((p) => p.name.startsWith("SpaceTrooper") || p.name.startsWith("CommanderCape"))
      .map((p) => ({
        ...p,
        name: p.name.replace("SpaceTrooper", "ChromeCommander"),
        material: commanderMaterialOverrides[p.name] ?? p.material,
      }));
    const crateParts = allDeckParts.filter((p) => p.name === "CargoCrate");
    const drumParts = allDeckParts.filter((p) => p.name === "FuelDrumCluster");

    const padPlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: -146.0, y: 8.5, z: 58.0, yaw: 0.4 },
    ];
    this._instantiateParts(padParts, padPlacements, 1.0, false);

    const buoyPlacements: Array<{ x: number; z: number; yaw: number }> = [
      { x: -195.0, z: 118.0, yaw: 0.3 },
      { x: -95.0, z: 182.0, yaw: 1.1 },
      { x: 148.0, z: 168.0, yaw: -0.6 },
      { x: 192.0, z: -88.0, yaw: -1.4 },
    ];
    const buoyScale = 0.25;
    for (const b of buoyPlacements) {
      const root = new Object3D("ImperialSignalBuoy");
      root.position.set(b.x, FORTRESS_WATER_Y + 0.12, b.z);
      root.rotation.set(0, b.yaw, 0);
      for (const part of padParts) {
        const isBeacons = part.name === "LandingPadBeacons" || part.name.includes("Beacon");
        const child = new Object3D(part.name);
        child.geometry = part.geometry;
        child.material = part.material;
        child.position.set(
          part.offset.x * buoyScale,
          part.offset.y * buoyScale,
          part.offset.z * buoyScale,
        );
        child.scale.set(buoyScale, buoyScale, buoyScale);
        child.castShadow = false;
        child.receiveShadow = !isBeacons;
        root.add(child);
        this._trisEstimate += Math.floor((part.geometry.indices?.length ?? 0) / 3);
      }
      this.scene.add(root);
      this._buoys.push({ root, baseX: b.x, baseZ: b.z, baseYaw: b.yaw });
    }

    const turretPlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: -114.0, y: 10.6, z: 114.0, yaw: -0.78 },
      { x: 114.0, y: 10.6, z: 114.0, yaw: 0.78 },
      { x: -114.0, y: 10.6, z: -114.0, yaw: -2.35 },
      { x: 114.0, y: 10.6, z: -114.0, yaw: 2.35 },
    ];
    this._instantiateParts(turretParts, turretPlacements, 1.0, true);

    // -Z forward models rotated +Math.PI to preserve the canonical sentry pad & hangar headings
    const landedShuttles: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: -146.0, y: 8.74, z: 58.0, yaw: 0.55 + Math.PI },
      { x: 68.0, y: 116.0, z: 16.0, yaw: 0.65 + Math.PI },
      { x: -72.0, y: 116.0, z: 14.0, yaw: -0.45 + Math.PI },
    ];
    this._instantiateParts(shuttleParts, landedShuttles, 1.0, true);

    this._hoverShuttleNodes = this._instantiateParts(
      flightShuttleParts,
      [{ x: 168.0, y: BASE_HOVER_SHUTTLE_Y, z: -48.0, yaw: -1.15 + Math.PI }],
      1.0,
      true,
    );

    // 16 instanced 1:1 Hex-Wing Fighters suspended beneath the exact ceiling clamp pylons in fortress.glb
    const hexWingPlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [];
    for (const sx of [-1.0, 1.0]) {
      for (const tz of [-46.0, -30.0, -14.0, 44.0]) {
        hexWingPlacements.push({ x: sx * 72.0, y: 133.2, z: tz, yaw: Math.PI });
      }
      for (const tz of [-38.0, -22.0, 42.0]) {
        hexWingPlacements.push({ x: sx * 58.0, y: 133.2, z: tz, yaw: Math.PI });
      }
    }
    hexWingPlacements.push(
      { x: -26.0, y: 133.2, z: 70.0, yaw: Math.PI },
      { x: 26.0, y: 133.2, z: 70.0, yaw: Math.PI },
    );
    this._instantiateParts(hexWingParts, hexWingPlacements, 1.0, true);

    // 1:1 Human-Scale Space Trooper honor guard & blast-door sentries on FlightDeck (y = 116.0 m)
    const trooperPlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        trooperPlacements.push({
          x: 74.0 + row * 2.2,
          y: 116.0,
          z: 24.0 + col * 2.1,
          yaw: -2.35,
        });
      }
    }
    // Blast-door sentries flanking core doors
    trooperPlacements.push(
      { x: 47.6, y: 116.0, z: 25.2, yaw: Math.PI * 0.5 },
      { x: 47.6, y: 116.0, z: 34.8, yaw: Math.PI * 0.5 },
      { x: 47.6, y: 116.0, z: -4.8, yaw: Math.PI * 0.5 },
      { x: 47.6, y: 116.0, z: 4.8, yaw: Math.PI * 0.5 },
      { x: -47.6, y: 116.0, z: 25.2, yaw: -Math.PI * 0.5 },
      { x: -47.6, y: 116.0, z: 34.8, yaw: -Math.PI * 0.5 },
      { x: 26.2, y: 116.0, z: 50.0, yaw: 0.0 },
      { x: -26.2, y: 116.0, z: 50.0, yaw: 0.0 },
    );
    this._instantiateParts(trooperParts, trooperPlacements, 1.0, true);

    // Chrome Commander (1.95 m tall, mirror chrome armor + red-trimmed asymmetric cape) leading the honor guard
    this._instantiateParts(
      commanderParts,
      [{ x: 72.5, y: 116.0, z: 26.8, yaw: -2.35 }],
      1.07,
      true,
    );

    const cratePlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: 56.0, y: 116.0, z: -34.0, yaw: 0.15 },
      { x: 59.2, y: 116.0, z: -31.0, yaw: 0.25 },
      { x: 86.0, y: 116.0, z: -18.0, yaw: -0.4 },
      { x: 108.0, y: 116.0, z: -8.0, yaw: 0.1 },
      { x: 112.0, y: 116.0, z: -4.5, yaw: 0.35 },
      { x: -58.0, y: 116.0, z: -24.0, yaw: -0.2 },
      { x: -84.0, y: 116.0, z: -22.0, yaw: 0.5 },
      { x: -105.0, y: 116.0, z: 4.0, yaw: -0.15 },
      { x: 36.0, y: 116.0, z: 62.0, yaw: 0.3 },
      { x: -36.0, y: 116.0, z: 64.0, yaw: -0.25 },
    ];
    this._instantiateParts(crateParts, cratePlacements, 1.0, true);

    const drumPlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: 54.0, y: 116.0, z: -28.0, yaw: 0.4 },
      { x: 78.0, y: 116.0, z: 42.0, yaw: 1.1 },
      { x: 104.0, y: 116.0, z: 8.0, yaw: -0.6 },
      { x: 115.0, y: 116.0, z: 6.0, yaw: 0.8 },
      { x: -55.0, y: 116.0, z: -18.0, yaw: -0.9 },
      { x: -82.0, y: 116.0, z: 28.0, yaw: 0.2 },
      { x: 40.0, y: 116.0, z: 58.0, yaw: -0.4 },
      { x: -40.0, y: 116.0, z: 58.0, yaw: 0.7 },
    ];
    this._instantiateParts(drumParts, drumPlacements, 1.0, true);
  }

  private _updateBuoys(): void {
    const oceanMat = this._oceanMaterial;
    if (!oceanMat) return;
    const sample = this._waveSample;
    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    const buoys = this._buoys;
    for (let i = 0; i < buoys.length; i++) {
      const buoy = buoys[i]!;
      oceanMat.sampleWaveAt(buoy.baseX, buoy.baseZ, sample, camX, camZ);
      buoy.root.position.set(
        buoy.baseX + sample.displacementX * 0.45,
        FORTRESS_WATER_Y + sample.height + 0.12,
        buoy.baseZ + sample.displacementZ * 0.45,
      );
      buoy.root.rotation.set(sample.normalZ * 0.65, buoy.baseYaw, -sample.normalX * 0.65);
    }
  }

  private _evalLightningFlash(time: number): number {
    let flash = 0;
    if (this._atmosphere === "storm") {
      const cycle = time % 9.5;
      if (cycle >= 5.2 && cycle <= 5.65) {
        const d1 = (cycle - 5.26) / 0.035;
        const d2 = (cycle - 5.44) / 0.055;
        flash = Math.exp(-d1 * d1) + 0.72 * Math.exp(-d2 * d2);
      }
    }
    if (this._manualLightningTimer > 0) {
      const manual =
        (Math.sin(this._manualLightningTimer * 28.0) * 0.4 + 0.6) *
        Math.min(1, this._manualLightningTimer * 3.0);
      if (manual > flash) {
        flash = manual;
      }
    }
    return flash;
  }

  private _extractParts(
    root: Object3D,
    materialsByNode: Record<string, AbstractMaterial>,
  ): PropPart[] {
    root.updateMatrixWorld(true);
    const origin = root.getWorldPosition().clone();
    const parts: PropPart[] = [];
    root.traverse((node): void => {
      if (!node.geometry) return;
      const key = node.name.replace(/_mesh$/, "");
      const mat = materialsByNode[key] ?? node.material;
      if (!mat) return;
      const offset = node.getWorldPosition(new Vector3D()).sub(origin);
      parts.push({ name: key, geometry: node.geometry, material: mat, offset });
    });
    return parts;
  }

  private _instantiateParts(
    parts: PropPart[],
    placements: ReadonlyArray<{ x: number; y: number; z: number; yaw: number }>,
    scale: number,
    castShadow: boolean,
  ): Object3D[] {
    const created: Object3D[] = [];
    // Part-major loop keeps identical geometry+material runs contiguous for ADR 0046 auto-instancing.
    for (const part of parts) {
      const isEmissive =
        part.name.includes("Beacon") ||
        part.name.includes("Cockpit") ||
        part.name.includes("Engines");
      for (const p of placements) {
        const node = new Object3D(part.name);
        node.geometry = part.geometry;
        node.material = part.material;
        node.position.set(
          p.x + part.offset.x * scale,
          p.y + part.offset.y * scale,
          p.z + part.offset.z * scale,
        );
        node.rotation.set(0, p.yaw, 0);
        node.scale.set(scale, scale, scale);
        node.castShadow = castShadow && !isEmissive;
        node.receiveShadow = !isEmissive;
        this.scene.add(node);
        created.push(node);
        this._trisEstimate += Math.floor((part.geometry.indices?.length ?? 0) / 3);
      }
    }
    return created;
  }

  private _setupControls(): void {
    this.canvas.addEventListener("wheel", this._onWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this._onCanvasPointerDown);
  }

  private readonly _onCanvasPointerDown = (): void => {
    if (!this.camera.isFlying) return;
    this.camera.cancelFlight?.();
    this._syncCameraController();
  };

  private readonly _onWheel = (event: WheelEvent): void => {
    this._fly ??= this.camera.behaviors.find((b): b is FlyController => b instanceof FlyController);
    if (!this._fly) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? FLY_SPEED_STEP : 1 / FLY_SPEED_STEP;
    this._fly.moveSpeed = Math.max(
      FLY_SPEED_MIN,
      Math.min(FLY_SPEED_MAX, this._fly.moveSpeed * factor),
    );
  };

  private _syncCameraController(): void {
    this._fly ??= this.camera.behaviors.find((b): b is FlyController => b instanceof FlyController);
    if (this._fly) {
      this._fly.enabled = !(this.camera.isFlying ?? false);
    }
  }

  private _minFortressClearanceRadius(y: number): number {
    // Keep curved fly-bys clear of the 252 m wing aprons below y=145 and tapered monolith spire above.
    const spireT = MathUtils.clamp((y - 145) / 340, 0, 1);
    return 178 - 120 * spireT;
  }

  private _buildCameraArcWaypoints(
    startPos: Vector3D,
    endPos: Vector3D,
  ): { waypoints: Vector3D[]; duration: number } {
    const dist = startPos.distanceTo(endPos);
    if (dist < 1.0) {
      return { waypoints: [], duration: 0.65 };
    }

    const rStart = Math.hypot(startPos.x, startPos.z);
    const rEnd = Math.hypot(endPos.x, endPos.z);
    const aStart = Math.atan2(startPos.x, startPos.z);
    const aEnd = Math.atan2(endPos.x, endPos.z);
    const deltaAngle = Math.atan2(Math.sin(aEnd - aStart), Math.cos(aEnd - aStart));
    const absAngle = Math.abs(deltaAngle);

    // Nearly radial moves still bank in a subtle lateral arc instead of zooming linearly.
    const radialBlend = Math.max(0, 1 - absAngle / 0.45);
    const swingSign = Math.abs(deltaAngle) > 0.03 ? Math.sign(deltaAngle) : endPos.x >= 0 ? 1 : -1;
    const lateralSwirl = radialBlend * 0.24 * swingSign;
    const lift = MathUtils.clamp(dist * 0.055, 8, 46);
    const outwardExpandMax = Math.min(115, dist * 0.14);

    const fractions = [0.34, 0.68];
    const waypoints: Vector3D[] = [];
    for (let i = 0; i < fractions.length; i++) {
      const t = fractions[i]!;
      const sinCurve = Math.sin(Math.PI * t);
      const angle = aStart + deltaAngle * t + sinCurve * lateralSwirl;
      const y = Math.max(16, MathUtils.lerp(startPos.y, endPos.y, t) + sinCurve * lift);
      const safeHullRadius = this._minFortressClearanceRadius(y);
      const minRadius =
        rEnd < safeHullRadius && t > 0.5
          ? MathUtils.lerp(safeHullRadius, Math.min(safeHullRadius, rEnd + 20), 0.45)
          : safeHullRadius;
      const radius = Math.max(
        minRadius,
        MathUtils.lerp(rStart, rEnd, t) + sinCurve * outwardExpandMax,
      );
      waypoints.push(new Vector3D(Math.sin(angle) * radius, y, Math.cos(angle) * radius));
    }

    const arcDist =
      startPos.distanceTo(waypoints[0]!) +
      waypoints[0]!.distanceTo(waypoints[1]!) +
      waypoints[1]!.distanceTo(endPos);
    const duration = MathUtils.clamp(1.35 + arcDist / 520, 1.65, 3.15);
    return { waypoints, duration };
  }

  private _applyCameraPreset(preset: CameraPresetKey, instant: boolean = false): void {
    const view = CAMERA_VIEWS[preset];
    if (instant) {
      this.camera.cancelFlight?.();
      this.setInitialCamera(view.position.clone(), view.target.clone());
      this._syncCameraController();
      if (this._oceanMesh) {
        OceanGridGeometry.snapToTarget(this._oceanMesh, view.position.x, view.position.z, 8);
      }
      return;
    }

    const { waypoints, duration } = this._buildCameraArcWaypoints(
      this.camera.position,
      view.position,
    );
    void this.camera.flyTo?.({
      position: view.position,
      target: view.target,
      waypoints,
      duration,
      easing: Easing.easeInOutCubic,
      onComplete: (): void => {
        this._syncCameraController();
      },
      onCancel: (): void => {
        this._syncCameraController();
      },
    });
    this._syncCameraController();
  }

  private _setCameraPreset(preset: CameraPresetKey, instant: boolean = false): void {
    this._cameraPreset = preset;
    this._applyCameraPreset(preset, instant);
    this._syncHud();
  }

  private _applyAtmosphere(key: AtmosphereKey): void {
    const preset = ATMOSPHERES[key];
    if (this._moonLight) {
      this._moonLight.color.copyFrom(preset.moonColor);
      this._moonLight.intensity = preset.moonIntensity;
      this._moonLight.direction.copyFrom(preset.moonDirection);
    }
    if (this._ambientLight) {
      this._ambientLight.color.copyFrom(preset.ambientColor);
      this._ambientLight.intensity = preset.ambientIntensity;
    }
    for (const light of this._hangarLights) {
      light.color.copyFrom(preset.hangarColor);
      light.intensity = preset.hangarIntensity;
    }
    const deckIntensity = key === "redAlert" ? 110 : 340;
    for (const light of this._deckLights) {
      light.intensity = deckIntensity;
    }
    if (this.scene.fog) {
      this.scene.fog.color.copyFrom(preset.fogColor);
      this.scene.fog.density = this._fogEnabled ? preset.fogDensity : 0;
    }
    this.scene.environmentIntensity = preset.envIntensity;

    const pp = this.renderer.postProcessing;
    const vfog = pp.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
    if (vfog) {
      vfog.enabled = this._fogEnabled;
      vfog.density = preset.volumetricDensity;
    }
    const tone = pp.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
    if (tone) {
      tone.exposure = preset.exposure;
    }
  }

  private _setAtmosphere(key: AtmosphereKey): void {
    this._atmosphere = key;
    this._applyAtmosphere(key);
    this._syncHud();
  }

  private _setReflection(on: boolean): void {
    this._reflectionEnabled = on;
    if (this._oceanMaterial) {
      this._oceanMaterial.reflectionMap = on ? this._reflection?.renderTarget : undefined;
      this._oceanMaterial.reflectionStrength = on ? 0.82 : 0.0;
    }
    this._syncHud();
  }

  private _setBloom(on: boolean): void {
    this._bloomEnabled = on;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) bloom.enabled = on;
    this._syncHud();
  }

  private _setFog(on: boolean): void {
    this._fogEnabled = on;
    this._applyAtmosphere(this._atmosphere);
    this._syncHud();
  }

  private _setHbao(on: boolean): void {
    this._hbaoEnabled = on;
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) hbao.enabled = on;
    this._syncHud();
  }

  private _setHiDpi(on: boolean): void {
    this._hiDpiEnabled = on;
    (this.renderer.quality as { maxPixelRatio?: number }).maxPixelRatio = on
      ? HIGH_DPI_MAX_PIXEL_RATIO
      : DEFAULT_MAX_PIXEL_RATIO;
    this.renderer.setSize(
      this.canvas.clientWidth || window.innerWidth,
      this.canvas.clientHeight || window.innerHeight,
    );
    this._syncHud();
  }

  private _setSearchlights(on: boolean): void {
    this._searchlightsEnabled = on;
    const intensity = on ? SEARCHLIGHT_INTENSITY : 0;
    for (let i = 0; i < this._searchlights.length; i++) {
      this._searchlights[i]!.light.intensity = intensity;
    }
    this._syncHud();
  }

  private _setWaveScale(v: number): void {
    this._waveScale = v;
    if (this._oceanMaterial) {
      this._oceanMaterial.waveScale = v;
    }
    this._syncHud();
  }

  private _setWindSpeed(v: number): void {
    this._windSpeed = v;
    if (this._oceanMaterial) {
      this._oceanMaterial.windSpeed = v;
    }
    this._syncHud();
  }

  private _setChoppiness(v: number): void {
    this._choppiness = v;
    if (this._oceanMaterial) {
      this._oceanMaterial.choppiness = v;
    }
    this._syncHud();
  }

  private _setCaustics(v: number): void {
    this._caustics = v;
    if (this._oceanMaterial) {
      this._oceanMaterial.causticsStrength = v;
    }
    this._syncHud();
  }

  private _setFoamCoverage(v: number): void {
    this._foamCoverage = v;
    if (this._oceanMaterial) {
      this._oceanMaterial.foamCoverage = v;
    }
    this._syncHud();
  }

  private _state(): FortressHudState {
    return {
      cameraPreset: this._cameraPreset,
      atmosphere: this._atmosphere,
      reflection: this._reflectionEnabled,
      bloom: this._bloomEnabled,
      fog: this._fogEnabled,
      hbao: this._hbaoEnabled,
      hiDpi: this._hiDpiEnabled,
      searchlights: this._searchlightsEnabled,
      oceanParams: {
        waveScale: this._waveScale,
        windSpeed: this._windSpeed,
        choppiness: this._choppiness,
        caustics: this._caustics,
        foamCoverage: this._foamCoverage,
      },
    };
  }

  private _createHud(): void {
    this._hud = new Hud(this, {
      setCameraPreset: (preset: CameraPresetKey): void => this._setCameraPreset(preset),
      setAtmosphere: (atmo: AtmosphereKey): void => this._setAtmosphere(atmo),
      toggleReflection: (): void => this._setReflection(!this._reflectionEnabled),
      toggleBloom: (): void => this._setBloom(!this._bloomEnabled),
      toggleFog: (): void => this._setFog(!this._fogEnabled),
      toggleHbao: (): void => this._setHbao(!this._hbaoEnabled),
      toggleHiDpi: (): void => this._setHiDpi(!this._hiDpiEnabled),
      toggleSearchlights: (): void => this._setSearchlights(!this._searchlightsEnabled),
      triggerLightning: (): void => {
        this._manualLightningTimer = 0.55;
      },
      resetView: (): void => this._setCameraPreset(this._cameraPreset, false),
      setWaveScale: (v: number): void => this._setWaveScale(v),
      setWindSpeed: (v: number): void => this._setWindSpeed(v),
      setChoppiness: (v: number): void => this._setChoppiness(v),
      setCaustics: (v: number): void => this._setCaustics(v),
      setFoamCoverage: (v: number): void => this._setFoamCoverage(v),
    });
    this._syncHud();
  }

  private _syncHud(): void {
    if (!this._hud) return;
    const rendererName = String(this.renderer?.type ?? "unknown");
    this._hud.sync(
      this._state(),
      `Renderer: ${rendererName} · Scene: ~${this._trisEstimate.toLocaleString()} tris`,
    );
  }

  private _installQaHook(): void {
    window.__qaSwm53 = {
      sample: (): ReturnType<QaSwm53Hook["sample"]> => ({
        ...this._state(),
        renderer: String(this.renderer.type),
        trisEstimate: this._trisEstimate,
        time: this._elapsed,
        isFlying: this.camera.isFlying,
        cameraPosition: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      }),
      setView: (pos: number[], target: number[]): void => {
        this.camera.cancelFlight?.();
        this.setInitialCamera(
          new Vector3D(pos[0]!, pos[1]!, pos[2]!),
          new Vector3D(target[0]!, target[1]!, target[2]!),
        );
        this._syncCameraController();
        if (this._oceanMesh) {
          OceanGridGeometry.snapToTarget(this._oceanMesh, pos[0]!, pos[2]!, 8);
        }
      },
      setCameraPreset: (preset: CameraPresetKey, instant: boolean = true): void =>
        this._setCameraPreset(preset, instant),
      setAtmosphere: (atmosphere: AtmosphereKey): void => this._setAtmosphere(atmosphere),
      setReflection: (on: boolean): void => this._setReflection(on),
      setBloom: (on: boolean): void => this._setBloom(on),
      setFog: (on: boolean): void => this._setFog(on),
      setHbao: (on: boolean): void => this._setHbao(on),
      setHiDpi: (on: boolean): void => this._setHiDpi(on),
      setSearchlights: (on: boolean): void => this._setSearchlights(on),
      triggerLightning: (): void => {
        this._manualLightningTimer = 0.55;
      },
    };
  }

  public override destroy(): void {
    this.canvas?.removeEventListener("wheel", this._onWheel);
    this.canvas?.removeEventListener("pointerdown", this._onCanvasPointerDown);
    this._rain?.dispose();
    if (this._sprayRenderer) {
      this._sprayRenderer.mesh.parent?.remove(this._sprayRenderer.mesh);
    }
    this._hud?.dispose();
    delete window.__qaSwm53;
    super.destroy();
  }
}

const app = new Showcase();
app.start().catch((err: unknown): void => {
  console.error("[Showcase53] Failed to start:", err);
});
