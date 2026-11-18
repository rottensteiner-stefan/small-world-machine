import {
  AbstractShowcase,
  AmbientLight,
  attachRainStreaks,
  Color,
  DirectionalLight,
  FlyController,
  Fog,
  FogMode,
  GltfLoader,
  MathUtils,
  mulberry32,
  Object3D,
  OceanGridGeometry,
  OceanMaterial,
  PlanarReflectionNode,
  PointLight,
  PostProcessingEffectType,
  RendererType,
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
  createFortressArmorMaterial,
  createRockFoundationMaterial,
  createTrimArmorMaterial,
  createWindowTrimMaterial,
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

interface QaSwm53Hook {
  sample(): FortressHudState & {
    renderer: string;
    trisEstimate: number;
    time: number;
  };
  setView(pos: number[], target: number[]): void;
  setCameraPreset(preset: CameraPresetKey): void;
  setAtmosphere(atmosphere: AtmosphereKey): void;
  setReflection(on: boolean): void;
  setBloom(on: boolean): void;
  setFog(on: boolean): void;
  triggerLightning(): void;
}

declare global {
  interface Window {
    __qaSwm53?: QaSwm53Hook;
  }
}

const CAMERA_VIEWS: Record<CameraPresetKey, CameraView> = {
  wide: {
    position: new Vector3D(102, 24, 138),
    target: new Vector3D(0, 42, 0),
  },
  hangar: {
    position: new Vector3D(26, 35.0, 22),
    target: new Vector3D(1.0, 35.4, 0.5),
  },
  crown: {
    position: new Vector3D(-28, 54, 74),
    target: new Vector3D(0, 61, 0),
  },
  waterline: {
    position: new Vector3D(42, 4.8, 48),
    target: new Vector3D(0, 14, 0),
  },
};

const ATMOSPHERES: Record<AtmosphereKey, AtmospherePreset> = {
  storm: {
    moonColor: new Color(0.58, 0.76, 1.0),
    moonIntensity: 3.1,
    moonDirection: new Vector3D(0.38, -0.4, 0.83).normalize(),
    ambientColor: new Color(0.12, 0.18, 0.3),
    ambientIntensity: 0.56,
    hangarColor: new Color(1.0, 0.16, 0.08),
    hangarIntensity: 44,
    fogColor: new Color(0.015, 0.025, 0.045),
    fogDensity: 0.00048,
    volumetricDensity: 0.0018,
    exposure: 1.15,
    envIntensity: 1.2,
  },
  twilight: {
    moonColor: new Color(0.72, 0.84, 1.0),
    moonIntensity: 3.3,
    moonDirection: new Vector3D(0.32, -0.48, 0.82).normalize(),
    ambientColor: new Color(0.22, 0.3, 0.42),
    ambientIntensity: 0.85,
    hangarColor: new Color(1.0, 0.22, 0.12),
    hangarIntensity: 32,
    fogColor: new Color(0.026, 0.04, 0.068),
    fogDensity: 0.00042,
    volumetricDensity: 0.0016,
    exposure: 1.25,
    envIntensity: 1.4,
  },
  redAlert: {
    moonColor: new Color(0.68, 0.24, 0.24),
    moonIntensity: 2.3,
    moonDirection: new Vector3D(0.42, -0.46, 0.78).normalize(),
    ambientColor: new Color(0.32, 0.09, 0.11),
    ambientIntensity: 0.72,
    hangarColor: new Color(1.0, 0.08, 0.04),
    hangarIntensity: 95,
    fogColor: new Color(0.045, 0.014, 0.018),
    fogDensity: 0.00065,
    volumetricDensity: 0.0032,
    exposure: 1.18,
    envIntensity: 0.85,
  },
};

const FLY_SPEED_DEFAULT = 24;
const FLY_SPEED_MIN = 2;
const FLY_SPEED_MAX = 180;
const FLY_SPEED_STEP = 1.25;

const BASE_HOVER_SHUTTLE_Y = 33.4;

/**
 * Showcase 53 — Fortress Inquisitorius (Ocean Moon Nur).
 *
 * Monumental 84 m obsidian-durasteel obelisk with mid-height cantilevered through-flight
 * hangar deck, central basalt/pilaster core spine, ceiling-racked TIE silhouettes,
 * 3-tier waterline wetness (`CustomShaderMaterial`), horizon-spanning `OceanGridGeometry`
 * + `OceanMaterial` with `PlanarReflectionNode`, and modular props.
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
    size: 2.0,
    maxLife: 3.0,
    alpha: 0.24,
  };
  private _armorMaterial: CustomShaderMaterial | undefined = undefined;
  private _rockMaterial: CustomShaderMaterial | undefined = undefined;
  private _moonLight?: DirectionalLight;
  private _ambientLight?: AmbientLight;
  private readonly _hangarLights: PointLight[] = [];
  private readonly _deckLights: PointLight[] = [];
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
  private _elapsed: number = 0;
  private _manualLightningTimer: number = 0;
  private _trisEstimate: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      postProcessing: { enabled: true },
      quality: { maxPixelRatio: 1.5 },
      ...options,
    });
    this.defaultCameraController = "fly";
    this.defaultMoveSpeed = FLY_SPEED_DEFAULT;
    this.defaultFov = MathUtils.degToRad(40);
    this.defaultFar = 2800;
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    this._applyCameraPreset("wide");
    this.renderer.setClearColor(new Color(0.012, 0.022, 0.042, 1.0));

    this._setupLighting();
    this._setupPostProcessing();

    const [, skyCube] = await Promise.all([
      this.loadIbl("/assets/showcases/53/ibl", ATMOSPHERES[this._atmosphere].envIntensity),
      this.loadSkybox("/assets/showcases/53/ibl/env.webp", 2600),
    ]);
    this._skyCube = skyCube;

    const texOpts = {
      generateMipmaps: true,
      flipY: false,
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
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
      winAlbedo,
      winNormal,
      winRoughness,
      winEmissive,
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
      Texture.fromUrl("/assets/showcases/53/textures/window_albedo.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/window_normal.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/window_roughness.webp", texOpts),
      Texture.fromUrl("/assets/showcases/53/textures/window_emissive.webp", texOpts),
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
    const windowMaps: FortressPbrMaps = {
      diffuseMap: winAlbedo,
      normalMap: winNormal,
      roughnessMap: winRoughness,
      emissiveMap: winEmissive,
      envMap: this.scene.prefilterMap,
    };

    const armorMat = createFortressArmorMaterial(armorMaps, {
      color: new Color(0.2, 0.22, 0.26),
      metallic: 0.72,
      roughness: 0.56,
      normalScale: new Vector2D(0.75, 0.75),
      waterY: FORTRESS_WATER_Y,
      wetBandHeight: 4.0,
      waveLapAmplitude: 0.38,
      wetAlbedoScale: 0.38,
    });
    const rockMat = createRockFoundationMaterial(rockMaps, {
      wetWaterline: true,
      color: new Color(0.14, 0.15, 0.18),
      metallic: 0.05,
      roughness: 0.48,
      waterY: FORTRESS_WATER_Y,
      wetBandHeight: 4.4,
      waveLapAmplitude: 0.42,
      wetAlbedoScale: 0.35,
    });
    const trimMat = createTrimArmorMaterial(trimMaps, {
      color: new Color(0.13, 0.15, 0.18),
      metallic: 0.88,
      roughness: 0.34,
    });
    const deckMat = createTrimArmorMaterial(trimMaps, {
      color: new Color(0.11, 0.13, 0.16),
      metallic: 0.9,
      roughness: 0.22,
    });
    const windowMat = createWindowTrimMaterial(windowMaps, {
      color: new Color(0.16, 0.18, 0.22),
      emissiveColor: new Color(1.0, 1.0, 1.0),
      emissiveIntensity: 2.8,
    });
    const coolLightMat = createEmissiveAccentMaterial(new Color(0.62, 0.86, 1.0), 1.65);
    const visorMat = createEmissiveAccentMaterial(new Color(1.0, 0.14, 0.08), 3.4);
    const hangarMat = createEmissiveAccentMaterial(new Color(1.0, 0.16, 0.08), 3.0);
    const beaconMat = createEmissiveAccentMaterial(new Color(0.45, 0.82, 1.0), 2.5);
    const ionMat = createEmissiveAccentMaterial(new Color(0.45, 0.85, 1.0), 3.4);

    this._armorMaterial = armorMat;
    this._rockMaterial = rockMat;

    const loader = new GltfLoader();
    const [fortressRoot, padRoot, turretRoot, shuttleRoot] = await Promise.all([
      loader.load("/assets/showcases/53/models/fortress.glb"),
      loader.load("/assets/showcases/53/models/landing_pad.glb"),
      loader.load("/assets/showcases/53/models/turbolaser.glb"),
      loader.load("/assets/showcases/53/models/imperial_shuttle.glb"),
    ]);

    const fortressMaterialsByNode: Record<string, AbstractMaterial> = {
      BastionBase: armorMat,
      BastionRock: rockMat,
      FlightDeck: deckMat,
      MainWedge: armorMat,
      TrimFins: trimMat,
      WindowBand: windowMat,
      HangarLights: coolLightMat,
      CommandCrown: armorMat,
      BridgeVisor: visorMat,
      HangarGlow: hangarMat,
    };

    fortressRoot.traverse((node): void => {
      if (!node.geometry) return;
      const key = node.name.replace(/_mesh$/, "");
      const mat = fortressMaterialsByNode[key] ?? armorMat;
      node.material = mat;
      const isGlowing = key === "BridgeVisor" || key === "HangarGlow" || key === "HangarLights";
      node.castShadow = !isGlowing;
      node.receiveShadow = !isGlowing;
      this._trisEstimate += Math.floor((node.geometry.indices?.length ?? 0) / 3);
    });
    this.scene.add(fortressRoot);

    this._placeModularProps(padRoot, turretRoot, shuttleRoot, {
      trimMat,
      armorMat,
      beaconMat,
      visorMat,
      ionMat,
    });

    this._setupOcean();
    this._setupWeatherAndSpray();
    this._applyAtmosphere(this._atmosphere);
    this._setupControls();
    this._installQaHook();
    this._createHud();
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._elapsed += deltaTime;
    if (this._manualLightningTimer > 0) {
      this._manualLightningTimer = Math.max(0, this._manualLightningTimer - deltaTime);
    }

    if (this._armorMaterial) {
      updateFortressWaterlineTime(this._armorMaterial, this._elapsed);
    }
    if (this._rockMaterial) {
      updateFortressWaterlineTime(this._rockMaterial, this._elapsed);
    }

    const bobOffset = Math.sin(this._elapsed * 1.4) * 0.45;
    for (let i = 0; i < this._hoverShuttleNodes.length; i++) {
      const node = this._hoverShuttleNodes[i]!;
      node.position.y = BASE_HOVER_SHUTTLE_Y + bobOffset;
    }

    if (this._oceanMaterial) {
      this._oceanMaterial.time = this._elapsed;
      this._oceanMaterial.downwashStrength = 0.92 - bobOffset * 0.18;
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

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (this._hud?.handleKey(event)) return;
    if (event.defaultPrevented) return;
    if (event.code === "Digit1") this._setCameraPreset("wide");
    else if (event.code === "Digit2") this._setCameraPreset("hangar");
    else if (event.code === "Digit3") this._setCameraPreset("crown");
    else if (event.code === "Digit4") this._setCameraPreset("waterline");
    else if (event.code === "KeyL") {
      const nextIdx = (ATMOSPHERE_KEYS.indexOf(this._atmosphere) + 1) % ATMOSPHERE_KEYS.length;
      this._setAtmosphere(ATMOSPHERE_KEYS[nextIdx]!);
    } else if (event.code === "KeyF") {
      this._manualLightningTimer = 0.55;
    } else if (event.code === "KeyR") {
      this._setCameraPreset(this._cameraPreset);
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

    // Central crimson bridge & blast-door glow inside mid-height canyon
    const hangarPositions: [number, number, number][] = [
      [0.0, 33.2, 8.2],
      [-7.2, 33.5, 0.0],
      [7.2, 33.5, 0.0],
    ];
    for (const [hx, hy, hz] of hangarPositions) {
      const light = new PointLight({
        color: new Color(1.0, 0.16, 0.08),
        intensity: 34,
        distance: 34,
      });
      light.position.set(hx, hy, hz);
      this._hangarLights.push(light);
      this.scene.add(light);
    }

    // Cool steel-cyan overhead flood lights illuminating the cantilevered flight deck
    const deckPositions: [number, number, number][] = [
      [-9.6, 37.8, 1.5],
      [9.6, 37.8, 1.5],
    ];
    for (const [dx, dy, dz] of deckPositions) {
      const light = new PointLight({
        color: new Color(0.68, 0.88, 1.0),
        intensity: 48,
        distance: 38,
      });
      light.position.set(dx, dy, dz);
      this._deckLights.push(light);
      this.scene.add(light);
    }

    this.scene.fog = new Fog({
      mode: FogMode.EXP2,
      color: new Color(0.035, 0.055, 0.09),
      density: 0.0042,
    });
  }

  private _setupPostProcessing(): void {
    const pp = this.renderer.postProcessing;
    pp.enabled = true;

    const hbao = pp.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 1.4;
      hbao.intensity = 1.15;
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
      vfog.density = 0.0018;
      vfog.maxDistance = 240;
      vfog.heightFalloff = 0.036;
      vfog.asymmetry = 0.22;
      vfog.ambientInject = 0.08;
    }

    const tone = pp.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
    if (tone) {
      tone.enabled = true;
      tone.mode = ToneMappingMode.AGX;
      tone.exposure = 1.15;
    }
  }

  private _setupOcean(): void {
    this._reflection = new PlanarReflectionNode({
      name: "NurOceanReflection",
      width: 1024,
      height: 1024,
      resolutionScale: this.renderer.quality.reflectionResolutionScale ?? 1,
    });
    this._reflection.position.set(0, FORTRESS_WATER_Y, 0);
    this._reflection.clipPlaneOffset = -0.35;
    this.scene.add(this._reflection);

    const ocean = new Object3D("NurOcean");
    ocean.geometry = new OceanGridGeometry({
      radius: 2400,
      radialSegments: 160,
      angularSegments: 192,
      radialExponent: 3.4,
      detailRadius: 380,
    }).getGeometryData();
    this._oceanMaterial = new OceanMaterial({
      waterColor: new Color(0.012, 0.048, 0.088),
      deepWaterColor: new Color(0.003, 0.011, 0.026),
      scatterColor: new Color(0.035, 0.22, 0.28),
      scatterStrength: 0.48,
      roughness: 0.068,
      windSpeed: 1.28,
      windDirection: new Vector2D(0.84, 0.54),
      waveScale: 1.05,
      waveWavelength: 34.0,
      swellFadeStart: 350,
      swellFadeEnd: 1950,
      detailScale: 1.05,
      detailStrength: 1.2,
      foamColor: new Color(0.72, 0.81, 0.88),
      foamDistance: 3.0,
      foamCoverage: 0.36,
      waterAbsorption: [0.65, 0.28, 0.16],
      refractionStrength: 0.025,
      reflectionMap: this._reflection.renderTarget,
      reflectionStrength: 0.82,
      reflectionDistortion: 0.11,
      reflectionRoughness: 0.04,
      causticsStrength: 0.52,
      downwashCenter: new Vector2D(28.0, -8.5),
      downwashRadius: 15.5,
      downwashStrength: 0.92,
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
      count: 9000,
      seed: 5301,
      halfExtent: 15,
      height: 20,
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
      softFadeDistance: 2.2,
      lightIntensity: 0,
    });

    this._spraySystem = new ParticleSystem({ capacity: 220 });
    this._spraySystem.addAffector(
      new GravityAffector({ acceleration: new Vector3D(3.8, -0.55, 2.45) }),
    );
    this._spraySystem.addAffector(new DragAffector({ drag: 0.95 }));
    this._spraySystem.addAffector(new SizeGrowthAffector({ rate: 0.45, maxScale: 3.6 }));
    this._spraySystem.addAffector(
      new ColorOverLifeAffector({
        startColor: sprayStart,
        endColor: sprayEnd,
        interpolateColor: false,
      }),
    );

    this._sprayRenderer = new ParticleMeshRenderer({
      name: "NurSeaSprayMist",
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
        // Bias wave-crash mist toward the windward perimeter while circling the basalt crags.
        let angle = rand() * Math.PI * 2;
        if (rand() < 0.5) {
          angle = Math.atan2(-0.54, -0.84) + (rand() - 0.5) * 2.1;
        }
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const radius = 18.5 + rand() * 11.5;
        this._sprayPos.set(cosA * radius, FORTRESS_WATER_Y + 0.05 + rand() * 0.45, sinA * radius);
        const radialBurst = 0.8 + rand() * 1.4;
        this._sprayVel.set(
          cosA * radialBurst + 3.4 + (rand() - 0.5) * 1.4,
          0.95 + rand() * 1.25,
          sinA * radialBurst + 2.2 + (rand() - 0.5) * 1.4,
        );
        this._sprayColor.r = seedRand();
        opts.size = 0.85 + rand() * 0.9;
        opts.maxLife = 1.9 + rand() * 1.3;
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
    mats: {
      trimMat: AbstractMaterial;
      armorMat: AbstractMaterial;
      beaconMat: AbstractMaterial;
      visorMat: AbstractMaterial;
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
      ShuttleHull: mats.trimMat,
      ShuttleCockpit: mats.visorMat,
      ShuttleEngines: mats.ionMat,
    });

    const padPlacements: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: -25.5, y: 2.32, z: 10.5, yaw: 0.4 },
    ];
    this._instantiateParts(padParts, padPlacements, 1.0, false);

    const buoyPlacements: Array<{ x: number; z: number; yaw: number }> = [
      { x: -34.0, z: 22.0, yaw: 0.3 },
      { x: -18.0, z: 31.0, yaw: 1.1 },
      { x: 22.0, z: 27.0, yaw: -0.6 },
      { x: 32.0, z: -14.0, yaw: -1.4 },
    ];
    const buoyScale = 0.28;
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
      { x: -15.6, y: 2.85, z: 15.6, yaw: -0.78 },
      { x: 15.6, y: 2.85, z: 15.6, yaw: 0.78 },
      { x: -15.6, y: 2.85, z: -15.6, yaw: -2.35 },
      { x: 15.6, y: 2.85, z: -15.6, yaw: 2.35 },
    ];
    this._instantiateParts(turretParts, turretPlacements, 0.9, true);

    const landedShuttles: Array<{ x: number; y: number; z: number; yaw: number }> = [
      { x: -25.5, y: 2.32, z: 10.5, yaw: 0.55 },
      { x: 9.2, y: 30.8, z: 3.8, yaw: 0.65 },
      { x: -9.4, y: 30.8, z: 3.6, yaw: -0.42 },
    ];
    this._instantiateParts(shuttleParts, landedShuttles, 0.72, true);

    this._hoverShuttleNodes = this._instantiateParts(
      shuttleParts,
      [{ x: 28.0, y: BASE_HOVER_SHUTTLE_Y, z: -8.5, yaw: -1.15 }],
      0.72,
      true,
    );
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
  }

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

  private _applyCameraPreset(preset: CameraPresetKey): void {
    const view = CAMERA_VIEWS[preset];
    this.setInitialCamera(view.position.clone(), view.target.clone());
    if (this._oceanMesh) {
      OceanGridGeometry.snapToTarget(this._oceanMesh, view.position.x, view.position.z, 8);
    }
  }

  private _setCameraPreset(preset: CameraPresetKey): void {
    this._cameraPreset = preset;
    this._applyCameraPreset(preset);
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
    const deckIntensity = key === "redAlert" ? 16 : 48;
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

  private _state(): FortressHudState {
    return {
      cameraPreset: this._cameraPreset,
      atmosphere: this._atmosphere,
      reflection: this._reflectionEnabled,
      bloom: this._bloomEnabled,
      fog: this._fogEnabled,
    };
  }

  private _createHud(): void {
    this._hud = new Hud(this, {
      setCameraPreset: (preset: CameraPresetKey): void => this._setCameraPreset(preset),
      setAtmosphere: (atmo: AtmosphereKey): void => this._setAtmosphere(atmo),
      toggleReflection: (): void => this._setReflection(!this._reflectionEnabled),
      toggleBloom: (): void => this._setBloom(!this._bloomEnabled),
      toggleFog: (): void => this._setFog(!this._fogEnabled),
      resetView: (): void => this._applyCameraPreset(this._cameraPreset),
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
      }),
      setView: (pos: number[], target: number[]): void => {
        this.setInitialCamera(
          new Vector3D(pos[0]!, pos[1]!, pos[2]!),
          new Vector3D(target[0]!, target[1]!, target[2]!),
        );
        if (this._oceanMesh) {
          OceanGridGeometry.snapToTarget(this._oceanMesh, pos[0]!, pos[2]!, 8);
        }
      },
      setCameraPreset: (preset: CameraPresetKey): void => this._setCameraPreset(preset),
      setAtmosphere: (atmosphere: AtmosphereKey): void => this._setAtmosphere(atmosphere),
      setReflection: (on: boolean): void => this._setReflection(on),
      setBloom: (on: boolean): void => this._setBloom(on),
      setFog: (on: boolean): void => this._setFog(on),
      triggerLightning: (): void => {
        this._manualLightningTimer = 0.55;
      },
    };
  }

  public override destroy(): void {
    this.canvas?.removeEventListener("wheel", this._onWheel);
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
