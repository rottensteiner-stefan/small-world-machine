import type { BloomElement } from "@small-world-machine/engine";
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

class Showcase13 extends AbstractShowcase {
  private _helmet?: Object3D;
  private _keySpotLight?: SpotLight;
  private _time: number = 0;

  protected override async setupScene(): Promise<void> {
    // Post-Processing is nice for PBR
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 1.8;
      bloom.threshold = 0.8; // Natural HDR bloom threshold for glowing visor
      bloom.radius = 1.0;
      bloom.color = new Color(1.2, 0.8, 1.6);
    }

    // Camera setup
    this.defaultFov = (60 * Math.PI) / 180;
    this.configureCamera();

    this.defaultMoveSpeed = 5.0;
    this.setInitialCamera(new Vector3D(0, 0.3, 3), new Vector3D(0, 0.3, 0));

    // Setup Lights to showcase PBR and dramatic shadows
    const ambientLight = new AmbientLight({
      color: new Color(0.1, 0.12, 0.15),
      intensity: 0.25, // Low ambient to let shadows pop with high contrast
    });
    this.scene.add(ambientLight);

    const mainLight = new DirectionalLight({
      color: new Color(1.0, 0.95, 0.9),
      intensity: 1.5,
    });
    mainLight.position.set(5, 8, 5);
    mainLight.direction.set(-1, -1.5, -1);
    mainLight.castShadow = true;
    mainLight.shadowBias = 0.003;
    this.scene.add(mainLight);

    // Studio Key Spotlight for crisp contour shadows
    const keySpotLight = new SpotLight({
      color: new Color(1.0, 0.85, 0.7),
      intensity: 4.0,
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
      color: new Color(0.3, 0.5, 0.8), // Soft blue rim/fill light
      intensity: 0.5,
    });
    fillLight.position.set(-5, 2, -2);
    fillLight.direction.set(1, -0.4, 0.5);
    this.scene.add(fillLight);

    // Load an environment map for reflections
    // Skybox + real IBL (irradiance/prefilter/BRDF LUT), baked via tools/ibl-gen.html -- fail fast.
    const envTexture = await this.loadSkybox("./assets/ibl/env.webp");
    await this.loadIbl("./assets/ibl/");

    // Exhibition Pedestal (Receives self & cast shadows from the helmet)
    const pedestal = new Object3D("ExhibitionPedestal");
    pedestal.geometry = new Cylinder({
      radiusTop: 0.8,
      radiusBottom: 0.9,
      height: 1.6,
      radialSegments: 48,
    }).getGeometryData();
    pedestal.material = new StandardMaterial({
      color: new Color(0.12, 0.12, 0.14),
      roughness: 0.35,
      metallic: 0.8,
      envMap: envTexture,
    });
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
    ground.material = new StandardMaterial({
      color: new Color(0.06, 0.07, 0.08),
      roughness: 0.6,
      metallic: 0.2,
      envMap: envTexture,
    });
    ground.position.set(0, -2.35, 0);
    this.scene.add(ground);

    // Load the GLTF Model
    try {
      const gltfLoader = new GltfLoader({ basePath: "./assets/" });
      const helmet = await gltfLoader.load("DamagedHelmet.glb");

      helmet.position.set(0, 0, 0);

      // Recursively configure castShadow and environment map
      const setupHelmetNode = (node: Object3D): void => {
        node.castShadow = true;
        if (node.material && "envMap" in node.material && envTexture) {
          (node.material as StandardMaterial).envMap = envTexture;
        }
        node.children.forEach(setupHelmetNode);
      };
      setupHelmetNode(helmet);

      this._helmet = helmet;
      this.scene.add(helmet);
    } catch (e) {
      console.error("Failed to load DamagedHelmet:", e);
    }
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    this._time += deltaTime;

    // Slowly rotate the helmet to show off dynamic shadows, PBR reflections, and normal maps
    if (this._helmet) {
      this._helmet.rotation.y += deltaTime * 0.4;
      this._helmet.updateMatrixWorld();
    }

    // Orbit the key spotlight slightly to create living, drifting shadow edges
    if (this._keySpotLight) {
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
const app = new Showcase13({
  rendererType: RendererType.WEB_GPU,
});
app.start().catch((err: unknown) => console.error("[Showcase13] Failed to start:", err));
