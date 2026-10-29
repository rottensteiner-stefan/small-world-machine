import type {
  BloomElement,
  ColorGradingElement,
  DepthOfFieldElement,
  EngineOptions,
  GrainElement,
  HbaoElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  Fog,
  FogMode,
  GltfLoader,
  InstancedMesh,
  Matrix4,
  Object3D,
  OrbitController,
  Plane,
  PlanarReflectionNode,
  PointLight,
  PostProcessingEffectType,
  Quaternion,
  RainStreaks,
  RendererType,
  SpotLight,
  StandardMaterial,
  Texture,
  Vector2D,
  Vector3D,
} from "@small-world-machine/engine";
import {
  DropImpactSystem,
  FLUID_PRESETS,
  FluidPreset,
  RainPuddleMaterial,
} from "@small-world-machine/liquid-extras";
import { attachDevTools } from "@small-world-machine/tools";
import { CyberpunkHud } from "./Hud.js";

enum Mood {
  NIGHT = "night",
  DAY = "day",
}

enum CameraView {
  STREET = "street",
  PUDDLE = "puddle",
}

interface MoodPreset {
  ambientColor: Color;
  ambientIntensity: number;
  keyColor: Color;
  keyIntensity: number;
  spotIntensity: number;
  /** Multiplier on every neon light and emissive surface. */
  neon: number;
  facadeEmissive: number;
  /** Mirror strength of the wet film on open asphalt (the puddles themselves are separate). */
  streetReflectivity: number;
  fogColor: Color;
  fogDensity: number;
  showSkybox: boolean;
  clearColor: Color;
  bloom: number;
  vignetteDarkness: number;
  vignetteOffset: number;
  gradingEnabled: boolean;
  saturation: number;
  contrast: number;
  lift: Color;
  gain: Color;
  grain: number;
  rainIntensity: number;
  dripIntensity: number;
}

// Night = the original neon look. Day = an overcast rainy day: flat sky light, muted saturation,
// lifted blacks, cool highlights, vignette, fine grain.
const MOODS: Record<Mood, MoodPreset> = {
  [Mood.NIGHT]: {
    ambientColor: new Color(0.232, 0.299, 0.409),
    ambientIntensity: 0.2,
    keyColor: new Color(0.481, 0.696, 0.85),
    keyIntensity: 0.4,
    spotIntensity: 2.2,
    neon: 1.0,
    facadeEmissive: 1.5,
    streetReflectivity: 0.35,
    fogColor: new Color(0.148, 0.169, 0.218),
    fogDensity: 0.014,
    showSkybox: true,
    clearColor: new Color(0, 0, 0, 1),
    bloom: 0.65,
    vignetteDarkness: 0.65,
    vignetteOffset: 0.9,
    gradingEnabled: false,
    saturation: 1.0,
    contrast: 1.0,
    lift: new Color(0, 0, 0),
    gain: new Color(1, 1, 1),
    grain: 0.0,
    rainIntensity: 0.75,
    dripIntensity: 0.45,
  },
  [Mood.DAY]: {
    ambientColor: new Color(0.805, 0.816, 0.839),
    ambientIntensity: 0.85,
    keyColor: new Color(0.934, 0.944, 0.963),
    keyIntensity: 0.55,
    spotIntensity: 0.0,
    neon: 0.12,
    facadeEmissive: 0.15,
    // Without neon there is nothing bright for the thin film to mirror; rough asphalt reads matte.
    streetReflectivity: 0.05,
    fogColor: new Color(0.816, 0.828, 0.839),
    fogDensity: 0.03,
    showSkybox: false,
    clearColor: new Color(0.904, 0.914, 0.924, 1),
    bloom: 0.12,
    vignetteDarkness: 0.95,
    vignetteOffset: 0.7,
    gradingEnabled: true,
    saturation: 0.35,
    contrast: 1.15,
    lift: new Color(0.035, 0.035, 0.035),
    gain: new Color(0.97, 1.02, 1.03),
    grain: 0.06,
    rainIntensity: 0.55,
    dripIntensity: 0.6,
  },
};

// DEFAULT repeats WATER's value in the enum, so list the distinct liquids explicitly.
const FLUID_CYCLE: readonly FluidPreset[] = [
  FluidPreset.WATER,
  FluidPreset.SEAWATER,
  FluidPreset.BLOOD,
  FluidPreset.OLIVE_OIL,
  FluidPreset.USED_MOTOR_OIL,
  FluidPreset.BATTERY_ACID,
  FluidPreset.SULFURIC_ACID_98,
];

const STREET_WIDTH = 16;
const STREET_LENGTH = 28;
const ASPHALT_REPEAT_X = 10;
const ASPHALT_REPEAT_Z = 18;

// The focal length is not a preset value: it follows from the camera's FOV and the DoF sensor
// size (see _applyLens), otherwise the blur would belong to a different lens than the framing.
interface CameraPreset {
  position: Vector3D;
  target: Vector3D;
  fStop: number;
}

// Focus sits on the camera target; stopped down so the street view stays readable.
const STREET_CAMERA: CameraPreset = {
  position: new Vector3D(1.4, 0.52, 4.4),
  target: new Vector3D(0, 0.35, -0.9),
  fStop: 4.0,
};
// Low close-up of the foreground puddle, wide open so the street around it falls out of focus.
const PUDDLE_CAMERA: CameraPreset = {
  position: new Vector3D(-2.45, 0.29, 4.12),
  target: new Vector3D(-2.6, 0.0, 3.4),
  fStop: 1.8,
};

const PUDDLE_BASINS = [
  { x: 0.1, z: 0.0, radiusX: 1.6, radiusZ: 2.2 }, // under & behind the hover car
  { x: -3.4, z: -2.5, radiusX: 0.95, radiusZ: 1.3 }, // distant left alley
  { x: 3.4, z: -2.5, radiusX: 0.95, radiusZ: 1.3 }, // distant right alley
  // Foreground left, framed by the puddle camera; small enough that its shore stays in frame.
  { x: -2.6, z: 3.4, radiusX: 0.42, radiusZ: 0.3 },
];

/**
 * Showcase 30: "The Rain-Drenched Cyberpunk Albedo: Screen-Space Reflections & Neon Wetness"
 *
 * Benchmark testing planar reflection response on physically based rain puddles
 * (RainPuddleMaterial: dielectric Fresnel, dispersive rain rings, frayed shorelines), contrasting
 * teal/magenta specular highlights and HDR neon bloom, plus an overcast day mood and a low puddle
 * close-up camera.
 *
 * Keys: C = street / puddle camera, N = night / day mood, F = next liquid (drop-impact system).
 */
export class Showcase extends AbstractShowcase {
  private _neonSignMagenta!: Object3D;
  private _neonSignCyan!: Object3D;
  private _spotTeal!: SpotLight;
  private _spotPink!: SpotLight;
  private _reflectionNode!: PlanarReflectionNode;
  private _puddleMat!: RainPuddleMaterial;
  private readonly _dropSystem = new DropImpactSystem();
  private _fluidIndex = 0;
  private _hoverCar!: Object3D;
  private readonly _rain = new RainStreaks({ count: 10000 });
  private _time = 0;
  private _mood: Mood = Mood.NIGHT;
  private _cameraView: CameraView = CameraView.STREET;
  private _ambientLight!: AmbientLight;
  private _keyLight!: DirectionalLight;
  private _neonLights: PointLight[] = [];
  private _neonLightBase: number[] = [];
  private _neonMaterials: StandardMaterial[] = [];
  private _neonEmissiveBase: number[] = [];
  private _buildingMat!: StandardMaterial;
  private _streetMat!: StandardMaterial;
  private _skybox: Object3D | undefined;
  private _fog!: Fog;
  private _bloom: BloomElement | undefined;
  private _vignette: VignetteElement | undefined;
  private _grading: ColorGradingElement | undefined;
  private _grain: GrainElement | undefined;
  private _dof: DepthOfFieldElement | undefined;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    // Post-Processing: Vivid Cyberpunk Neon Glow + Cinematographic Vignette & HBAO
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.65;
      bloom.threshold = 1.0;
    }
    this._bloom = bloom;
    this._grading = this.renderer.postProcessing.get<ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    this._grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    this._dof = this.renderer.postProcessing.get<DepthOfFieldElement>(
      PostProcessingEffectType.DEPTH_OF_FIELD,
    );
    if (this._dof) {
      this._dof.enabled = true;
      this._dof.maxCocRatio = 0.02;
    }

    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 0.8;
      hbao.intensity = 1.4;
    }

    const vig = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vig) {
      vig.enabled = true;
      vig.darkness = 0.65;
      vig.offset = 0.9;
    }
    this._vignette = vig;

    // Camera setup (Low-angle rain street camera)
    this.defaultFov = (48 * Math.PI) / 180;
    this.defaultFar = 150;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.copyFrom(STREET_CAMERA.position);
    this.camera.target.copyFrom(STREET_CAMERA.target);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // Atmospheric Rain Haze (deep night indigo, prevents background washout)
    this._fog = new Fog({
      color: new Color(0.148, 0.169, 0.218),
      mode: FogMode.EXP2,
      density: 0.014,
    });
    this.scene.fog = this._fog;

    // 1. Dark Rainy Night Ambient
    this._ambientLight = new AmbientLight({
      color: new Color(0.232, 0.299, 0.409),
      intensity: 0.2,
    });
    this.scene.add(this._ambientLight);

    // 2. Far Street Rim Light (Moonlight through rain haze; overcast sky fill in the day mood)
    this._keyLight = new DirectionalLight({
      color: new Color(0.481, 0.696, 0.85),
      intensity: 0.4,
    });
    this._keyLight.position.set(5, 15, -10);
    this._keyLight.direction.set(-0.3, -1.0, 0.5);
    this._keyLight.castShadow = true;
    this.scene.add(this._keyLight);

    // 3. Neon Cyberpunk Street Spotlights
    this._spotTeal = new SpotLight({
      color: new Color(0.256, 0.977, 1),
      intensity: 2.2,
      angle: Math.PI / 4,
      penumbra: 0.4,
      distance: 25.0,
    });
    this._spotTeal.position.set(-4.5, 6.0, 3.0);
    this._spotTeal.direction.set(1.0, -1.2, -0.5);
    this._spotTeal.castShadow = true;
    this.scene.add(this._spotTeal);

    this._spotPink = new SpotLight({
      color: new Color(1, 0.317, 0.822),
      intensity: 2.2,
      angle: Math.PI / 4,
      penumbra: 0.4,
      distance: 25.0,
    });
    this._spotPink.position.set(4.5, 6.5, -2.0);
    this._spotPink.direction.set(-1.0, -1.2, 0.3);
    this._spotPink.castShadow = true;
    this.scene.add(this._spotPink);

    // Load Environment Map & PBR Texture Maps
    const envTexture = await this.loadSkybox("./assets/ibl/env.webp");
    this._skybox = this.scene.getObjectByName("Skybox");
    await this.loadIbl("./assets/ibl/");

    let asphaltDiffuse: Texture | undefined;
    let asphaltNormal: Texture | undefined;
    let asphaltRoughness: Texture | undefined;

    let facadeDiffuse: Texture | undefined;
    let facadeNormal: Texture | undefined;
    let facadeRoughness: Texture | undefined;
    let facadeEmission: Texture | undefined;

    try {
      // Gemini AI-generated dark wet asphalt with subtle tire tracks & aggregate
      asphaltDiffuse = await Texture.fromUrl("./assets/asphalt_diffuse.webp");
      asphaltNormal = await Texture.fromUrl("./assets/asphalt_normal.webp");
      asphaltRoughness = await Texture.fromUrl("./assets/asphalt_roughness.webp");
      for (const t of [asphaltDiffuse, asphaltNormal, asphaltRoughness]) {
        t.repeat.x = ASPHALT_REPEAT_X;
        t.repeat.y = ASPHALT_REPEAT_Z;
      }

      // Gemini AI-generated cyberpunk skyscraper facade with glowing windows
      facadeDiffuse = await Texture.fromUrl("./assets/facade_diffuse.webp");
      facadeNormal = await Texture.fromUrl("./assets/facade_normal.webp");
      facadeRoughness = await Texture.fromUrl("./assets/facade_roughness.webp");
      facadeEmission = await Texture.fromUrl("./assets/facade_emission.webp");
      for (const t of [facadeDiffuse, facadeNormal, facadeRoughness, facadeEmission]) {
        t.repeat.x = 4;
        t.repeat.y = 3;
      }
    } catch (e) {
      console.warn("Could not load PBR textures:", e);
    }

    // Real planar reflection for the wet asphalt street and puddles (mirrors the actual scene:
    // skyscrapers, glowing facade windows, neon signs, and hover car each frame).
    this._reflectionNode = new PlanarReflectionNode("PuddleReflection", 1024, 1024);
    this._reflectionNode.position.set(0, 0.001, 0);
    this.scene.add(this._reflectionNode);

    // Materials Palette: soaked tarmac. A water film is a dielectric, so no metallic term; the thin
    // film still gives the whole street a soft, Fresnel-weighted mirror sheen. Standing water is the
    // separate RainPuddleMaterial layer below.
    const wetAsphaltMat = new StandardMaterial({
      color: new Color(0.502, 0.523, 0.561),
      diffuseMap: asphaltDiffuse,
      normalMap: asphaltNormal,
      roughnessMap: asphaltRoughness,
      roughness: 0.3,
      metallic: 0.0,
      envMap: envTexture,
      reflectionMap: this._reflectionNode.renderTarget,
      reflectivity: 0.35,
      reflectionFresnelBlend: 0.5,
    });

    // Cyberpunk building facade: rain-soaked with glossy wet sheen
    const buildingMat = new StandardMaterial({
      color: new Color(0.822, 0.85, 0.904),
      diffuseMap: facadeDiffuse,
      normalMap: facadeNormal,
      roughnessMap: facadeRoughness,
      emissiveMap: facadeEmission,
      emissiveColor: new Color(1, 1, 1),
      emissiveIntensity: 1.5,
      roughness: 0.45,
      metallic: 0.25,
      envMap: envTexture,
    });

    // Plain brushed dark metal for the conduits (no texture set: a pipe doesn't need one).
    const chromeMat = new StandardMaterial({
      color: new Color(0.762, 0.793, 0.828),
      roughness: 0.3,
      metallic: 0.9,
      envMap: envTexture,
    });

    // emissiveColor is already > 1 (HDR); intensity stays near 1 so bloom doesn't saturate everything.
    const neonMagentaMat = new StandardMaterial({
      color: new Color(1, 0.256, 0.793),
      emissiveColor: new Color(1.767, 0.351, 1.306),
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });

    const neonCyanMat = new StandardMaterial({
      color: new Color(0.256, 0.977, 1),
      emissiveColor: new Color(0.351, 1.697, 1.835),
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });

    const neonGoldMat = new StandardMaterial({
      color: new Color(1, 0.904, 0.351),
      emissiveColor: new Color(1.648, 1.431, 0.481),
      emissiveIntensity: 1.0,
      roughness: 0.1,
    });
    this._buildingMat = buildingMat;
    this._streetMat = wetAsphaltMat;
    this._neonMaterials.push(neonMagentaMat, neonCyanMat, neonGoldMat);

    // 4. Main Wet Asphalt Ground
    const street = new Object3D("CyberStreet");
    street.geometry = new Cube({ size: 1 }).getGeometryData();
    street.scale.set(STREET_WIDTH, 0.4, STREET_LENGTH);
    street.material = wetAsphaltMat;
    street.position.set(0, -0.2, 0);
    street.receiveShadow = true;
    this.scene.add(street);

    // 5. Rain puddles: one transparent water layer over the whole street. Where water stands is
    // decided per pixel (basins vs. asphalt grain height), so shorelines fray at the real stones.
    // The cube's top face maps U along +x and V along -z, hence the negative z tile period.
    this._puddleMat = new RainPuddleMaterial({
      reflectionMap: this._reflectionNode.renderTarget,
      asphaltMap: asphaltDiffuse,
      asphaltTilePeriod: new Vector2D(
        STREET_WIDTH / ASPHALT_REPEAT_X,
        -STREET_LENGTH / ASPHALT_REPEAT_Z,
      ),
      basins: PUDDLE_BASINS,
    });
    this._dropSystem.addSurface(this._puddleMat);
    const puddleLayer = new Object3D("RainPuddleLayer");
    puddleLayer.geometry = new Plane({
      width: STREET_WIDTH,
      height: STREET_LENGTH,
    }).getGeometryData();
    puddleLayer.rotation.x = -Math.PI / 2;
    puddleLayer.position.set(0, 0.003, 0);
    puddleLayer.material = this._puddleMat;
    this.scene.add(puddleLayer);

    // Exclude the street pavement and puddles from the reflection sub-render so the mirror camera
    // underneath has an unobstructed line of sight up to the car, buildings, and sky.
    this._reflectionNode.excludedObjects.push(street, puddleLayer);

    // Bare winter trees along both kerbs: fine dark branches against the sky are what makes ripple
    // distortion in the puddle mirror readable.
    const barkMat = new StandardMaterial({
      color: new Color(0.278, 0.268, 0.256),
      roughness: 0.85,
      metallic: 0.0,
    });
    const trees = this._createBareTrees(barkMat);
    this.scene.add(trees);

    // 6. Cyberpunk Street Architecture (Alley Skyscrapers & Overhangs)
    for (const side of [-1, 1]) {
      const xBase = side * 6.8;

      // Primary Block
      const bldg = new Object3D(`Building_${side}`);
      bldg.geometry = new Cube({ size: 1 }).getGeometryData();
      bldg.scale.set(3.5, 16.0, 26.0);
      bldg.material = buildingMat;
      bldg.position.set(xBase, 8.0, 0);
      bldg.castShadow = true;
      bldg.receiveShadow = true;
      this.scene.add(bldg);

      // Cyber Conduit Pipes running along the walls
      for (let pipe = 0; pipe < 3; pipe++) {
        const conduit = new Object3D(`Conduit_${side}_${pipe}`);
        conduit.geometry = new Cylinder({
          radiusTop: 0.08,
          radiusBottom: 0.08,
          height: 24.0,
          radialSegments: 12,
        }).getGeometryData();
        conduit.material = chromeMat;
        conduit.rotation.x = Math.PI / 2;
        conduit.position.set(side * 4.9, 1.5 + pipe * 1.2, 0);
        this.scene.add(conduit);
      }
    }

    // 7. Neon Billboards & Hologram Frames (Left & Right)
    this._neonSignMagenta = new Object3D("NeonSignMagenta");
    this._neonSignMagenta.geometry = new Cube({ size: 1 }).getGeometryData();
    this._neonSignMagenta.scale.set(0.15, 3.2, 5.0);
    this._neonSignMagenta.material = neonMagentaMat;
    this._neonSignMagenta.position.set(-4.8, 5.5, 1.0);
    this.scene.add(this._neonSignMagenta);

    const magentaLight = new PointLight({
      color: new Color(1, 0.256, 0.793),
      intensity: 4.5,
      distance: 12.0,
    });
    magentaLight.position.set(-4.4, 5.5, 1.0);
    this.scene.add(magentaLight);
    this._neonLights.push(magentaLight);

    this._neonSignCyan = new Object3D("NeonSignCyan");
    this._neonSignCyan.geometry = new Cube({ size: 1 }).getGeometryData();
    this._neonSignCyan.scale.set(0.15, 4.0, 3.0);
    this._neonSignCyan.material = neonCyanMat;
    this._neonSignCyan.position.set(4.8, 6.2, -3.0);
    this.scene.add(this._neonSignCyan);

    const cyanLight = new PointLight({
      color: new Color(0.256, 0.977, 1),
      intensity: 4.5,
      distance: 12.0,
    });
    cyanLight.position.set(4.4, 6.2, -3.0);
    this.scene.add(cyanLight);
    this._neonLights.push(cyanLight);

    // Overhead Street Arch Sign
    const overheadSign = new Object3D("OverheadSign");
    overheadSign.geometry = new Cube({ size: 1 }).getGeometryData();
    overheadSign.scale.set(6.0, 0.5, 0.2);
    overheadSign.material = neonGoldMat;
    overheadSign.position.set(0, 7.5, -6.0);
    this.scene.add(overheadSign);

    // 8. Futuristic Hover Vehicle in Center
    // Real low-poly mesh (Kenney "Car Kit", CC0 -- see REFERENCES.md), reskinned with
    // high-gloss sapphire cyberpunk metallic paint and illuminated light bars.
    this._hoverCar = new Object3D("HoverCar");
    this._hoverCar.position.set(0, 0.08, -0.9);
    this._hoverCar.rotation.y = Math.PI - 0.35;
    this.scene.add(this._hoverCar);

    // Soft camera-side key light to sculpt the car's metallic body contours and spoiler. The paint
    // mirrors the night sky, which decodes dark since ADR 0049, so this light carries the shape.
    const carKeyLight = new PointLight({
      color: new Color(0.822, 0.904, 1),
      intensity: 7.0,
      distance: 8.0,
    });
    carKeyLight.position.set(2.2, 1.8, 3.2);
    this.scene.add(carKeyLight);

    try {
      const carLoader = new GltfLoader({ basePath: "./assets/car/" });
      const carModel = await carLoader.load("sedan-sports.glb");
      carModel.scale.set(1.35, 1.35, 1.35);

      // Reskin model with sleek cyberpunk metallic car paint and dark wheels
      carModel.traverse((node: Object3D) => {
        if (node.geometry) {
          node.castShadow = true;
          if (node.name.includes("body") || node.name.includes("spoiler")) {
            node.material = new StandardMaterial({
              color: new Color(0.381, 0.502, 0.644),
              roughness: 0.22,
              metallic: 0.75,
              envMap: envTexture,
            });
          } else if (node.name.includes("wheel")) {
            node.material = new StandardMaterial({
              color: new Color(0.232, 0.232, 0.256),
              roughness: 0.5,
              metallic: 0.3,
              envMap: envTexture,
            });
          }
        }
      });

      this._hoverCar.add(carModel);
    } catch (e) {
      console.warn("Could not load hover car model:", e);
    }

    // Underglow strip + PointLight underneath
    const underglowBar = new Object3D("UnderglowBar");
    underglowBar.geometry = new Cube({ size: 1 }).getGeometryData();
    underglowBar.scale.set(0.35, 0.03, 2.2);
    underglowBar.material = new StandardMaterial({
      color: new Color(0.256, 0.977, 1),
      emissiveColor: new Color(0.351, 1.044, 1.127),
      emissiveIntensity: 1.5,
      roughness: 0.1,
    });
    underglowBar.position.set(0, 0.03, 0);
    this._hoverCar.add(underglowBar);

    const underglowLight = new PointLight({
      color: new Color(0.256, 0.977, 1),
      intensity: 2.0,
      distance: 3.5,
    });
    underglowLight.position.set(0, 0.03, 0);
    this._hoverCar.add(underglowLight);

    // sedan-sports.glb front is +Z (headlights), rear is -Z (spoiler & taillights).
    const headlights = new Object3D("Headlights");
    headlights.geometry = new Cube({ size: 1 }).getGeometryData();
    headlights.scale.set(1.15, 0.05, 0.1);
    headlights.material = new StandardMaterial({
      color: new Color(0.953, 0.977, 1),
      emissiveColor: new Color(1.648, 1.697, 1.878),
      emissiveIntensity: 1.0,
      roughness: 0.1,
    });
    headlights.position.set(0, 0.28, 1.6);
    this._hoverCar.add(headlights);

    const headlightBeam = new PointLight({
      color: new Color(0.929, 0.977, 1),
      intensity: 1.5,
      distance: 6.0,
    });
    headlightBeam.position.set(0, 0.28, 1.7);
    this._hoverCar.add(headlightBeam);

    const tailLights = new Object3D("TailLights");
    tailLights.geometry = new Cube({ size: 1 }).getGeometryData();
    tailLights.scale.set(1.25, 0.06, 0.1);
    tailLights.material = new StandardMaterial({
      color: new Color(1, 0, 0.256),
      emissiveColor: new Color(2.078, 0.351, 0.481),
      emissiveIntensity: 2.0,
      roughness: 0.1,
    });
    tailLights.position.set(0, 0.3, -1.62);
    this._hoverCar.add(tailLights);

    const tailLightGlow = new PointLight({
      color: new Color(1, 0.256, 0.351),
      intensity: 2.0,
      distance: 3.5,
    });
    tailLightGlow.position.set(0, 0.3, -1.7);
    this._hoverCar.add(tailLightGlow);

    // 9. Rain: motion-blurred, lit streaks falling at terminal velocity (see RainStreaks).
    this.scene.add(this._rain.mesh);
    this._reflectionNode.excludedObjects.push(this._rain.mesh);

    for (const light of this._neonLights) {
      this._neonLightBase.push(light.intensity);
    }
    for (const mat of this._neonMaterials) {
      this._neonEmissiveBase.push(mat.emissiveIntensity);
    }
    this._applyMood(this._mood);
    this._applyLens(STREET_CAMERA);
    this._createHud();
  }

  private _applyCameraView(view: CameraView): void {
    this._cameraView = view;
    const preset = view === CameraView.PUDDLE ? PUDDLE_CAMERA : STREET_CAMERA;
    // Also makes R return to this view rather than to the boot camera.
    this.setInitialCamera(preset.position, preset.target);
    this.resetCamera();
    this._applyLens(preset);
    this._updateHud();
  }

  private _applyLens(preset: CameraPreset): void {
    if (!this._dof) {
      return;
    }
    this._dof.focalLength = this._dof.sensorHeight / (2 * Math.tan(this.defaultFov / 2));
    this._dof.fStop = preset.fStop;
  }

  /** Keeps focus on the orbit target, so orbiting/zooming never drops the subject out of focus. */
  private _updateFocus(): void {
    if (!this._dof) {
      return;
    }
    this._dof.focusDistance = Math.max(0.1, this.camera.position.distanceTo(this.camera.target));
  }

  private _applyMood(mood: Mood): void {
    this._mood = mood;
    const preset = MOODS[mood];

    this._ambientLight.color = preset.ambientColor.clone();
    this._ambientLight.intensity = preset.ambientIntensity;
    this._keyLight.color = preset.keyColor.clone();
    this._keyLight.intensity = preset.keyIntensity;
    this._spotTeal.intensity = preset.spotIntensity;
    this._spotPink.intensity = preset.spotIntensity;
    for (let i = 0; i < this._neonLights.length; i++) {
      this._neonLights[i]!.intensity = this._neonLightBase[i]! * preset.neon;
    }
    for (let i = 0; i < this._neonMaterials.length; i++) {
      this._neonMaterials[i]!.emissiveIntensity = this._neonEmissiveBase[i]! * preset.neon;
    }
    this._buildingMat.emissiveIntensity = preset.facadeEmissive;
    this._streetMat.reflectivity = preset.streetReflectivity;

    this._fog.color = preset.fogColor.clone();
    this._fog.density = preset.fogDensity;
    if (this._skybox) {
      this._skybox.isVisible = preset.showSkybox;
    }
    this.renderer.setClearColor(preset.clearColor.clone());

    if (this._bloom) {
      this._bloom.intensity = preset.bloom;
    }
    if (this._vignette) {
      this._vignette.darkness = preset.vignetteDarkness;
      this._vignette.offset = preset.vignetteOffset;
    }
    if (this._grading) {
      this._grading.enabled = preset.gradingEnabled;
      this._grading.saturation = preset.saturation;
      this._grading.contrast = preset.contrast;
      this._grading.lift = preset.lift.clone();
      this._grading.gain = preset.gain.clone();
    }
    if (this._grain) {
      this._grain.enabled = preset.grain > 0;
      this._grain.intensity = preset.grain;
    }

    this._puddleMat.rainIntensity = preset.rainIntensity;
    this._puddleMat.dripIntensity = preset.dripIntensity;
    this._updateHud();
  }

  /**
   * Leafless trees as one instanced cylinder batch. Branch radii follow Leonardo's rule
   * (r_parent^2.2 = sum r_child^2.2), so the silhouettes taper like real wood.
   */
  private _createBareTrees(material: StandardMaterial): InstancedMesh {
    const matrices: Matrix4[] = [];
    let seed = 11;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const up = new Vector3D(0, 1, 0);
    const daVinciExponent = 2.2;

    const grow = (
      start: Vector3D,
      dir: Vector3D,
      length: number,
      radius: number,
      depth: number,
    ): void => {
      const rotation = new Quaternion();
      const axis = new Vector3D().crossVectors(up, dir);
      const axisLength = axis.length();
      if (axisLength > 1e-5) {
        rotation.setFromAxisAngle(
          axis.scale(1 / axisLength),
          Math.acos(Math.min(1, Math.max(-1, up.dot(dir)))),
        );
      }
      const mid = start.clone().add(dir.clone().scale(length * 0.5));
      matrices.push(
        new Matrix4().composeFromQuaternion(mid, rotation, new Vector3D(radius, length, radius)),
      );
      if (depth === 0) {
        return;
      }
      const end = start.clone().add(dir.clone().scale(length));
      const childCount = rand() < 0.4 ? 3 : 2;
      const childRadius = radius * Math.pow(childCount, -1 / daVinciExponent);
      for (let c = 0; c < childCount; c++) {
        const yaw = rand() * Math.PI * 2;
        const tilt = 0.35 + rand() * 0.45;
        const side = new Vector3D(Math.cos(yaw), 0, Math.sin(yaw));
        const childDir = dir
          .clone()
          .scale(Math.cos(tilt))
          .add(side.scale(Math.sin(tilt)));
        childDir.y = Math.max(childDir.y, 0.15);
        childDir.normalize();
        grow(end, childDir, length * (0.68 + rand() * 0.12), childRadius, depth - 1);
      }
    };

    const treeRoots = [
      new Vector3D(-4.3, 0, -7.5),
      new Vector3D(4.3, 0, -1.5),
      new Vector3D(-4.3, 0, 6.5),
      new Vector3D(4.3, 0, 8.5),
    ];
    for (const root of treeRoots) {
      grow(root, new Vector3D(0, 1, 0), 1.8, 0.12, 5);
    }

    // Unit cylinder: the per-instance scale carries radius and length.
    const geometry = new Cylinder({
      radiusTop: 0.75,
      radiusBottom: 1,
      height: 1,
      radialSegments: 6,
    }).getGeometryData();
    const mesh = new InstancedMesh("BareTrees", geometry, material, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]!);
    }
    mesh.castShadow = true;
    return mesh;
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    this._dropSystem.apply();
    if (this._puddleMat) {
      this._puddleMat.time = this._time;
      this._puddleMat.setCameraFootprint(this.defaultFov, this.canvas.height);
    }
    this._updateFocus();

    // Hover vehicle levitation bobbing
    if (this._hoverCar) {
      this._hoverCar.position.y = 0.08 + Math.sin(this._time * 2.0) * 0.015;
      this._hoverCar.rotation.z = Math.sin(this._time * 1.5) * 0.01;
    }

    this._rain.update(deltaTime, this._time, this.camera.position);

    // Neon sign pulse flicker
    if (this._neonSignMagenta) {
      const pulseM = 1.0 + Math.sin(this._time * 6.0) * 0.08 + (Math.random() - 0.5) * 0.04;
      this._neonSignMagenta.scale.y = 3.2 * pulseM;
    }
    if (this._neonSignCyan) {
      const pulseC = 1.0 + Math.sin(this._time * 4.5 + 1.0) * 0.08;
      this._neonSignCyan.scale.y = 4.0 * pulseC;
    }

    // Swaying neon spotlights across the wet asphalt
    if (this._spotTeal) {
      this._spotTeal.position.x = -4.5 + Math.sin(this._time * 1.2) * 0.8;
      this._spotTeal.direction.set(
        1.0 + Math.sin(this._time * 0.8) * 0.2,
        -1.2,
        -0.5 + Math.cos(this._time * 0.8) * 0.3,
      );
    }
    if (this._spotPink) {
      this._spotPink.position.x = 4.5 + Math.cos(this._time * 1.4) * 0.8;
      this._spotPink.direction.set(
        -1.0 + Math.cos(this._time * 0.9) * 0.2,
        -1.2,
        0.3 + Math.sin(this._time * 0.9) * 0.3,
      );
    }

    // Re-render the puddle reflections every frame so they track the hover car and swaying
    // neon spotlights, not just the static skybox.
    if (this._reflectionNode && this.camera) {
      this._reflectionNode.updateReflection(this.scene, this.camera, this.renderer);
    }
  }

  private _hud?: CyberpunkHud;

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (this._hud?.handleKey(event)) {
      event.preventDefault();
    }
  }

  private _createHud(): void {
    this._hud?.dispose();
    this._hud = new CyberpunkHud(FLUID_CYCLE, {
      onNight: (night: boolean): void => this._applyMood(night ? Mood.NIGHT : Mood.DAY),
      onPuddleCamera: (puddle: boolean): void =>
        this._applyCameraView(puddle ? CameraView.PUDDLE : CameraView.STREET),
      onFluid: (index: number): void => {
        this._fluidIndex = index;
        this._dropSystem.fluid = FLUID_PRESETS[FLUID_CYCLE[this._fluidIndex]!];
      },
    });
    this._updateHud();
  }

  private _updateHud(): void {
    this._hud?.sync({
      night: this._mood === Mood.NIGHT,
      puddleCamera: this._cameraView === CameraView.PUDDLE,
      fluidIndex: this._fluidIndex,
    });
  }

  public override destroy(): void {
    this._hud?.dispose();
    super.destroy();
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase();
attachDevTools(app);
(window as unknown as { __app: Showcase }).__app = app;
app.start().catch((err: unknown) => console.error("[Showcase30] Failed to start:", err));
