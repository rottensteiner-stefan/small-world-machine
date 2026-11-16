import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  FlyController,
  Fog,
  FogMode,
  GltfLoader,
  Ground,
  MathUtils,
  Object3D,
  PlanarReflectionNode,
  PointLight,
  PostProcessingEffectType,
  RendererType,
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
  EngineOptions,
  GeometryDataInterface,
  HbaoElement,
  ToneMappingElement,
  VolumetricFogElement,
  CustomShaderMaterial,
  OpenWaterMaterial,
} from "@small-world-machine/engine";
import {
  createEmissiveAccentMaterial,
  createFortressArmorMaterial,
  createRockFoundationMaterial,
  createStormOceanMaterial,
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
    moonIntensity: 2.9,
    moonDirection: new Vector3D(-0.62, -0.5, -0.26).normalize(),
    ambientColor: new Color(0.12, 0.18, 0.3),
    ambientIntensity: 0.56,
    hangarColor: new Color(1.0, 0.16, 0.08),
    hangarIntensity: 44,
    fogColor: new Color(0.015, 0.025, 0.045),
    fogDensity: 0.0018,
    volumetricDensity: 0.0018,
    exposure: 1.15,
    envIntensity: 1.2,
  },
  twilight: {
    moonColor: new Color(0.72, 0.84, 1.0),
    moonIntensity: 3.1,
    moonDirection: new Vector3D(-0.48, -0.65, -0.58).normalize(),
    ambientColor: new Color(0.22, 0.3, 0.42),
    ambientIntensity: 0.85,
    hangarColor: new Color(1.0, 0.22, 0.12),
    hangarIntensity: 32,
    fogColor: new Color(0.026, 0.04, 0.068),
    fogDensity: 0.0016,
    volumetricDensity: 0.0016,
    exposure: 1.25,
    envIntensity: 1.4,
  },
  redAlert: {
    moonColor: new Color(0.68, 0.24, 0.24),
    moonIntensity: 2.1,
    moonDirection: new Vector3D(-0.55, -0.78, -0.32).normalize(),
    ambientColor: new Color(0.32, 0.09, 0.11),
    ambientIntensity: 0.72,
    hangarColor: new Color(1.0, 0.08, 0.04),
    hangarIntensity: 95,
    fogColor: new Color(0.045, 0.014, 0.018),
    fogDensity: 0.0024,
    volumetricDensity: 0.0032,
    exposure: 1.18,
    envIntensity: 0.85,
  },
};

const FLY_SPEED_DEFAULT = 24;
const FLY_SPEED_MIN = 2;
const FLY_SPEED_MAX = 180;
const FLY_SPEED_STEP = 1.25;

const OCEAN_SIZE = 760;
const OCEAN_SEGMENTS = 240;
const BASE_HOVER_SHUTTLE_Y = 33.4;

/**
 * Showcase 53 — Fortress Inquisitorius (Ocean Moon Nur).
 *
 * Monumental 84 m obsidian-durasteel obelisk with mid-height cantilevered through-flight
 * hangar deck, central basalt/pilaster core spine, ceiling-racked TIE silhouettes,
 * 3-tier waterline wetness (`CustomShaderMaterial`), `OpenWaterMaterial` + `PlanarReflectionNode`,
 * and modular props.
 */
export class Showcase extends AbstractShowcase {
  private _hud?: Hud;
  private _fly: FlyController | undefined = undefined;
  private _reflection: PlanarReflectionNode | undefined = undefined;
  private _oceanMaterial: OpenWaterMaterial | undefined = undefined;
  private _armorMaterial: CustomShaderMaterial | undefined = undefined;
  private _rockMaterial: CustomShaderMaterial | undefined = undefined;
  private _moonLight?: DirectionalLight;
  private _ambientLight?: AmbientLight;
  private readonly _hangarLights: PointLight[] = [];
  private readonly _deckLights: PointLight[] = [];
  private _hoverShuttleNodes: Object3D[] = [];
  private _cameraPreset: CameraPresetKey = "wide";
  private _atmosphere: AtmosphereKey = "storm";
  private _reflectionEnabled: boolean = true;
  private _bloomEnabled: boolean = true;
  private _fogEnabled: boolean = true;
  private _elapsed: number = 0;
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
    this.defaultFar = 950;
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    this._applyCameraPreset("wide");
    this.renderer.setClearColor(new Color(0.012, 0.022, 0.042, 1.0));

    this._setupLighting();
    this._setupPostProcessing();

    await Promise.all([
      this.loadIbl("/assets/showcases/53/ibl", ATMOSPHERES[this._atmosphere].envIntensity),
      this.loadSkybox("/assets/showcases/53/ibl/env.webp", 1200),
    ]);

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
    this._applyAtmosphere(this._atmosphere);
    this._setupControls();
    this._installQaHook();
    this._createHud();
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._elapsed += deltaTime;

    if (this._armorMaterial) {
      updateFortressWaterlineTime(this._armorMaterial, this._elapsed);
    }
    if (this._rockMaterial) {
      updateFortressWaterlineTime(this._rockMaterial, this._elapsed);
    }
    if (this._oceanMaterial) {
      this._oceanMaterial.time = this._elapsed;
    }
    if (this._reflectionEnabled) {
      this._reflection?.updateReflection(this.scene, this.camera, this.renderer);
    }

    // Gentle hover bob on the approaching eastern shuttle (zero allocation)
    const bobOffset = Math.sin(this._elapsed * 1.4) * 0.45;
    for (let i = 0; i < this._hoverShuttleNodes.length; i++) {
      const node = this._hoverShuttleNodes[i]!;
      node.position.y = BASE_HOVER_SHUTTLE_Y + bobOffset;
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
      direction: new Vector3D(-0.55, -0.78, -0.32).normalize(),
      color: new Color(0.62, 0.78, 1.0),
      intensity: 2.8,
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
    // Deep ocean floor keeps OpaqueCapture depth finite for Beer-Lambert & shoreline foam
    const seaBed = new Object3D("NurSeaBed");
    seaBed.geometry = new Ground({
      width: OCEAN_SIZE + 260,
      depth: OCEAN_SIZE + 260,
    }).getGeometryData();
    seaBed.material = new StandardMaterial({
      color: new Color(0.004, 0.01, 0.02),
      roughness: 0.95,
      metallic: 0.0,
    });
    seaBed.position.set(0, -18.0, 0);
    seaBed.receiveShadow = false;
    this.scene.add(seaBed);

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
    const oceanHalf = (OCEAN_SIZE + 60) * 0.5;
    const oceanGeo = new Ground({
      width: OCEAN_SIZE + 60,
      depth: OCEAN_SIZE + 60,
      widthSegments: OCEAN_SEGMENTS,
      depthSegments: OCEAN_SEGMENTS,
    }).getGeometryData();
    // Concentrate vertex resolution (~0.95 m spacing) around the fortress & camera corridor
    // while keeping total vertex count <= 65,535 for Uint16 WebGL1 compatibility.
    const verts = oceanGeo.vertices;
    for (let i = 0; i < verts.length; i += 3) {
      const nx = verts[i]! / oceanHalf;
      const nz = verts[i + 2]! / oceanHalf;
      verts[i] = oceanHalf * (0.28 * nx + 0.72 * nx * nx * nx);
      verts[i + 2] = oceanHalf * (0.28 * nz + 0.72 * nz * nz * nz);
    }
    ocean.geometry = oceanGeo;
    this._oceanMaterial = createStormOceanMaterial(this._reflection, {
      waterColor: new Color(0.01, 0.036, 0.072),
      deepWaterColor: new Color(0.003, 0.01, 0.025),
      edgeColor: new Color(0.12, 0.2, 0.3),
      edgeSoftness: 1.4,
      foamColor: new Color(0.68, 0.78, 0.86),
      foamDistance: 2.8,
      foamCutoff: 0.46,
      foamNoiseScale: 1.15,
      foamNoiseSpeed: 1.15,
      reflectionStrength: 0.84,
      reflectionDistortion: 0.14,
      reflectionRoughness: 0.03,
    });
    ocean.material = this._oceanMaterial;
    ocean.position.set(0, FORTRESS_WATER_Y, 0);
    ocean.receiveShadow = true;
    this._reflection.excludedObjects.push(ocean);
    this.scene.add(ocean);
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
      this._oceanMaterial.reflectionStrength = on ? 0.84 : 0.0;
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
      },
      setCameraPreset: (preset: CameraPresetKey): void => this._setCameraPreset(preset),
      setAtmosphere: (atmosphere: AtmosphereKey): void => this._setAtmosphere(atmosphere),
      setReflection: (on: boolean): void => this._setReflection(on),
      setBloom: (on: boolean): void => this._setBloom(on),
      setFog: (on: boolean): void => this._setFog(on),
    };
  }

  public override destroy(): void {
    this.canvas?.removeEventListener("wheel", this._onWheel);
    this._hud?.dispose();
    delete window.__qaSwm53;
    super.destroy();
  }
}

const app = new Showcase();
app.start().catch((err: unknown): void => {
  console.error("[Showcase53] Failed to start:", err);
});
