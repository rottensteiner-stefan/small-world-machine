import type {
  BloomElement,
  ColorGradingElement,
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
  InstancedMesh,
  MathUtils,
  Matrix4,
  Object3D,
  OrbitController,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  Sphere,
  StandardMaterial,
  Torus,
  Vector3D,
  WeatherEmitter,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const STREET_HALF_WIDTH = 6;
const STREET_LENGTH = 60;
const HOT_ZONE_Z = -16;

/**
 * Showcase 32: "Radioactive Ashfall: Fallout Zone Vienna"
 *
 * A ruined street in the "The Whisper" world's Donauauen fallout belt -- collapsed apartment
 * blocks, a leaking radioactive hot zone at the street's end, and a constant fall of irradiated
 * ash drifting through the haze. Demonstrates the new `WeatherEmitter`
 * (`src/environment/weather/WeatherEmitter.ts`): a high-altitude ashfall field plus a dense,
 * ground-hugging toxic dust layer around the hot zone, both `InstancedMesh`-backed with zero
 * renderer changes. Also exercises the engine's built-in `Fog` (EXP2) for the toxic haze.
 */
class Showcase32 extends AbstractShowcase {
  private _hotZoneLight!: PointLight;
  private _ashfall!: WeatherEmitter;
  private _groundDust!: WeatherEmitter;
  private _time = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 1.0;
      bloom.threshold = 0.85;
    }
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 1.0;
      hbao.intensity = 1.1;
    }
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      vignette.darkness = 0.8;
      vignette.offset = 0.5;
    }
    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    if (grain) {
      grain.enabled = true;
      grain.intensity = 0.06;
    }
    const colorGrading = this.renderer.postProcessing.get<ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    if (colorGrading) {
      // Sickly, desaturated fallout-zone grade: cool/green cast, crushed shadows, no hot highlights.
      colorGrading.enabled = true;
      colorGrading.contrast = 1.15;
      colorGrading.saturation = 0.75;
      colorGrading.temperature = -0.3;
      colorGrading.tint = -0.2;
      colorGrading.lift.set(0.0, 0.02, 0.0);
      colorGrading.gain.set(0.95, 1.0, 0.9);
    }

    this.defaultFov = (58 * Math.PI) / 180;
    this.defaultFar = 120;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 2.4, 22);
    this.camera.target.set(0, 3.5, HOT_ZONE_Z);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // Sickly, radiation-haze atmosphere -- EXP2 falloff hides the far street end in murk, and
    // doubles as a cheap depth cue since the scene has no volumetric fog (see AAA research #13).
    const fogColor = new Color(0.435, 0.47, 0.41);
    this.scene.fog = new Fog({
      mode: FogMode.EXP2,
      color: fogColor,
      density: 0.028,
    });
    // There's no skybox in this ruin -- without a matching clear color the "empty sky" above the
    // rooflines renders as a pure black void instead of reading as a hazy, overcast fallout sky.
    this.renderer.setClearColor(fogColor);

    this.scene.add(new AmbientLight({ color: new Color(0.396, 0.435, 0.367), intensity: 0.5 }));

    const sun = new DirectionalLight({
      color: new Color(0.877, 0.904, 0.793),
      intensity: 1.1,
    });
    sun.position.set(-10, 25, 15);
    sun.direction.set(0.4, -1.0, -0.5);
    sun.castShadow = true;
    sun.shadowBias = 0.0012;
    sun.shadowResolution = 2048;
    this.scene.add(sun);

    this._buildStreet();
    this._buildHotZone();
    this._buildWeather();
  }

  private _buildStreet(): void {
    const asphaltMat = new StandardMaterial({
      color: new Color(0.381, 0.381, 0.367),
      roughness: 0.95,
      metallic: 0.0,
    });
    const concreteMat = new StandardMaterial({
      color: new Color(0.621, 0.612, 0.579),
      roughness: 0.9,
      metallic: 0.0,
    });
    const rustMat = new StandardMaterial({
      color: new Color(0.579, 0.422, 0.335),
      roughness: 0.8,
      metallic: 0.4,
    });
    this._concreteMat = concreteMat;

    const ground = new Object3D("Street");
    ground.geometry = new Cube({ size: 1 }).getGeometryData();
    ground.scale.set(STREET_HALF_WIDTH * 2 + 12, 0.4, STREET_LENGTH);
    ground.position.set(0, -0.2, -STREET_LENGTH / 2 + 20);
    ground.material = asphaltMat;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Two rows of collapsed apartment-block shells flanking the street, each with a jagged,
    // irregular broken roofline rather than a flat top.
    const numBuildings = 6;
    for (const side of [-1, 1]) {
      for (let i = 0; i < numBuildings; i++) {
        const z = 24 - i * (STREET_LENGTH / numBuildings);
        const height = 8 + ((i * 7 + (side + 1)) % 5);
        const depth = 7 + (i % 3);
        const x = side * (STREET_HALF_WIDTH + 4 + (i % 2) * 1.5);

        const block = new Object3D(`Building_${side}_${i}`);
        block.geometry = new Cube({ size: 1 }).getGeometryData();
        block.scale.set(6, height, depth);
        block.position.set(x, height / 2, z);
        block.material = concreteMat;
        block.castShadow = true;
        block.receiveShadow = true;
        this.scene.add(block);

        // Broken roofline: 2-3 smaller tilted slabs perched at the top edge.
        for (let r = 0; r < 2; r++) {
          const rubbleTop = new Object3D(`RoofBreak_${side}_${i}_${r}`);
          rubbleTop.geometry = new Cube({ size: 1 }).getGeometryData();
          rubbleTop.scale.set(2.2, 1.0, 2.0);
          rubbleTop.position.set(x + (r - 0.5) * 2.4, height + 0.3, z + (r % 2 === 0 ? -1.5 : 1.5));
          rubbleTop.rotation.set(
            Math.sin(i * 3.1 + r) * 0.4,
            Math.cos(i * 2.2 + side) * 0.6,
            Math.sin(i * 1.7 + r * 2) * 0.35,
          );
          rubbleTop.material = concreteMat;
          rubbleTop.castShadow = true;
          this.scene.add(rubbleTop);
        }

        // A rusted collapsed girder leaning against the base.
        const girder = new Object3D(`Girder_${side}_${i}`);
        girder.geometry = new Cylinder({
          radiusTop: 0.12,
          radiusBottom: 0.12,
          height: 5.5,
          radialSegments: 6,
        }).getGeometryData();
        girder.rotation.z = side * 0.9;
        girder.position.set(x - side * 3.2, 1.6, z + 2);
        girder.material = rustMat;
        girder.castShadow = true;
        this.scene.add(girder);
      }
    }

    this._buildDebris();
  }

  private _concreteMat!: StandardMaterial;

  private _buildDebris(): void {
    const debrisCount = 40;
    const debrisMesh = new InstancedMesh(
      "StreetDebris",
      new Cube({ size: 1 }).getGeometryData(),
      this._concreteMat,
      debrisCount,
    );
    const pos = new Vector3D();
    const rot = new Vector3D();
    const scale = new Vector3D();
    const m = new Matrix4();
    for (let i = 0; i < debrisCount; i++) {
      const x = (Math.random() - 0.5) * (STREET_HALF_WIDTH * 2 - 1);
      const z = 24 - Math.random() * STREET_LENGTH;
      const s = 0.2 + Math.random() * 0.5;
      pos.set(x, s * 0.5, z);
      rot.set(Math.random(), Math.random() * Math.PI, Math.random());
      scale.set(s, s * 0.6, s);
      m.compose(pos, rot, scale);
      debrisMesh.setMatrixAt(i, m);
    }
    debrisMesh.castShadow = true;
    debrisMesh.receiveShadow = true;
    this.scene.add(debrisMesh);
  }

  private _buildHotZone(): void {
    const craterMat = new StandardMaterial({
      color: new Color(0.317, 0.317, 0.299),
      roughness: 0.95,
      metallic: 0.0,
    });
    const glowMat = new StandardMaterial({
      color: new Color(0.659, 1, 0.621),
      emissiveColor: new Color(0.793, 1.489, 0.659),
      emissiveIntensity: 2.2,
      transparent: true,
      roughness: 0.2,
    });
    const drumMat = new StandardMaterial({
      color: new Color(0.696, 0.596, 0.256),
      roughness: 0.7,
      metallic: 0.35,
    });

    const crater = new Object3D("Crater");
    crater.geometry = new Cylinder({
      radiusTop: 3.2,
      radiusBottom: 3.2,
      height: 0.3,
      radialSegments: 24,
    }).getGeometryData();
    crater.position.set(0, 0.02, HOT_ZONE_Z);
    crater.material = craterMat;
    crater.receiveShadow = true;
    this.scene.add(crater);

    const rimGlow = new Object3D("CraterGlow");
    rimGlow.geometry = new Torus({
      radius: 2.6,
      tube: 0.12,
      radialSegments: 12,
      tubularSegments: 32,
    }).getGeometryData();
    rimGlow.rotation.x = MathUtils.HALF_PI;
    rimGlow.position.set(0, 0.2, HOT_ZONE_Z);
    rimGlow.material = glowMat;
    this.scene.add(rimGlow);

    const glowCore = new Object3D("GlowCore");
    glowCore.geometry = new Sphere({
      radius: 0.5,
      widthSegments: 12,
      heightSegments: 10,
    }).getGeometryData();
    glowCore.position.set(0, 0.3, HOT_ZONE_Z);
    glowCore.material = glowMat;
    this.scene.add(glowCore);

    // Toppled radioactive drums scattered around the crater lip.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + 0.4;
      const dist = 3.6 + (i % 2) * 0.6;
      const drum = new Object3D(`Drum_${i}`);
      drum.geometry = new Cylinder({
        radiusTop: 0.4,
        radiusBottom: 0.4,
        height: 1.0,
        radialSegments: 16,
      }).getGeometryData();
      drum.rotation.z = MathUtils.HALF_PI;
      drum.rotation.y = angle;
      drum.position.set(Math.cos(angle) * dist, 0.4, HOT_ZONE_Z + Math.sin(angle) * dist);
      drum.material = drumMat;
      drum.castShadow = true;
      drum.receiveShadow = true;
      this.scene.add(drum);
    }

    // The one visible "geiger click" cue in the scene: an irregularly flickering green point
    // light rather than a literal HUD icon (see plan -- kept purely diegetic/visual).
    this._hotZoneLight = new PointLight({
      color: new Color(0.73, 1, 0.659),
      intensity: 3.2,
      distance: 14,
    });
    this._hotZoneLight.position.set(0, 1.2, HOT_ZONE_Z);
    this.scene.add(this._hotZoneLight);

    // A second, dim window-light deep in one of the buildings for depth -- keeps the scene under
    // the engine's 4-point-light global cap (this is light #2 of 2).
    const windowLight = new PointLight({
      color: new Color(0.73, 0.762, 0.659),
      intensity: 0.9,
      distance: 10,
    });
    windowLight.position.set(STREET_HALF_WIDTH + 3, 4, 6);
    this.scene.add(windowLight);
  }

  private _buildWeather(): void {
    const ashMat = new StandardMaterial({
      color: new Color(0.762, 0.749, 0.703),
      emissiveColor: new Color(0.278, 0.317, 0.232),
      emissiveIntensity: 0.15,
      roughness: 0.9,
    });
    this._ashfall = new WeatherEmitter("Ashfall", {
      count: 500,
      center: new Vector3D(0, 9, -6),
      spawnArea: { width: 34, depth: 50, height: 16 },
      fallSpeed: [1.2, 2.4],
      wind: new Vector3D(0.4, 0, -0.15),
      windGustiness: 0.5,
      particleSize: [0.05, 0.11],
      material: ashMat,
    });
    this.scene.add(this._ashfall.mesh);

    const dustMat = new StandardMaterial({
      color: new Color(0.621, 0.659, 0.561),
      emissiveColor: new Color(0.579, 0.793, 0.481),
      emissiveIntensity: 0.4,
      transparent: true,
      roughness: 0.6,
    });
    this._groundDust = new WeatherEmitter("GroundDust", {
      count: 150,
      center: new Vector3D(0, 0.8, HOT_ZONE_Z),
      spawnArea: { width: 12, depth: 12, height: 1.6 },
      fallSpeed: [0.05, 0.15],
      wind: new Vector3D(0.1, 0, 0.05),
      windGustiness: 0.6,
      particleSize: [0.05, 0.12],
      tumble: true,
      material: dustMat,
    });
    this.scene.add(this._groundDust.mesh);
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    this._ashfall.update(deltaTime);
    this._groundDust.update(deltaTime);

    if (this._hotZoneLight) {
      const geigerClick =
        Math.sin(this._time * 11.0) * 0.25 +
        Math.sin(this._time * 27.0 + 1.7) * 0.15 +
        (Math.sin(this._time * 43.0) > 0.85 ? 0.6 : 0);
      this._hotZoneLight.intensity = 3.0 + geigerClick;
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase32();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase32] Failed to start:", err));
