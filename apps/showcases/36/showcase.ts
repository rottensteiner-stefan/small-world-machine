import type {
  BloomElement,
  StandardMaterial,
  ToneMappingElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  CubeLayout,
  CubeTexture,
  DirectionalLight,
  GltfLoader,
  Object3D,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  SkyboxMaterial,
  ToneMappingMode,
  Vector3D,
} from "@small-world-machine/engine";

class Showcase36 extends AbstractShowcase {
  protected override async setupScene(): Promise<void> {
    // Post-Processing pipeline: ACES Filmic Tone Mapping + sharp glass edge Bloom
    this.renderer.postProcessing.enabled = true;

    const toneMapping = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    if (toneMapping) {
      toneMapping.enabled = true;
      toneMapping.mode = ToneMappingMode.ACES_FILMIC;
      toneMapping.exposure = 1.0;
    }

    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.5;
      bloom.threshold = 1.15;
      bloom.radius = 0.5;
    }

    // Camera setup
    this.defaultFov = (55 * Math.PI) / 180;
    this.configureCamera();

    // The window pane is ~0.5m tall, centered around y=0.25 -- frame the camera accordingly
    this.defaultMoveSpeed = 2.0;
    this.setInitialCamera(new Vector3D(0, 0.25, 1.1), new Vector3D(0, 0.25, 0));

    // Lighting: a soft backlight sells the shattered glass silhouette and cracks
    const ambientLight = new AmbientLight({
      color: new Color(0.422, 0.435, 0.481),
      intensity: 0.3,
    });
    this.scene.add(ambientLight);

    const backLight = new DirectionalLight({
      color: new Color(1, 0.986, 0.953),
      intensity: 1.1,
    });
    backLight.position.set(0, 3, -6);
    backLight.direction.set(0, -0.3, 1);
    backLight.castShadow = true;
    backLight.shadowBias = 0.003;
    this.scene.add(backLight);

    const fillLight = new DirectionalLight({
      color: new Color(0.579, 0.696, 0.85),
      intensity: 0.4,
    });
    fillLight.position.set(-4, 1, 4);
    fillLight.direction.set(0.6, -0.2, -1);
    this.scene.add(fillLight);

    // Warm accent light near the camera to bring out the metallic clasp/frame detail
    const accentLight = new PointLight({
      color: new Color(1, 0.929, 0.793),
      intensity: 1.5,
      distance: 5.0,
    });
    accentLight.position.set(0.6, 0.4, 1.0);
    this.scene.add(accentLight);

    // Environment map for reflections
    const envTexture = new CubeTexture();
    try {
      await envTexture.loadFrom("./assets/ibl/env.webp", CubeLayout.CROSS_HORIZONTAL);

      const skybox = new Object3D("Skybox");
      skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
      skybox.material = new SkyboxMaterial({
        cubeMap: envTexture,
        color: new Color(0.561, 0.579, 0.621, 1.0),
      });
      skybox.frustumCulled = false;
      this.scene.add(skybox);
    } catch (e) {
      console.warn("Could not load envmap:", e);
    }

    // Real IBL (irradiance/prefilter/BRDF LUT), baked via tools/ibl-gen.html -- fail fast.
    await this.loadIbl("./assets/ibl/");

    // Load the shattered window
    try {
      const gltfLoader = new GltfLoader({ basePath: "./assets/" });
      const brokenWindow = await gltfLoader.load("GlassBrokenWindow.glb");

      brokenWindow.position.set(0, 0, 0);

      const setupNode = (node: Object3D): void => {
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material && "envMap" in node.material && envTexture) {
          (node.material as StandardMaterial).envMap = envTexture;
        }
        node.children.forEach(setupNode);
      };
      setupNode(brokenWindow);

      this.scene.add(brokenWindow);
    } catch (e) {
      console.error("Failed to load GlassBrokenWindow:", e);
    }
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase36({
  rendererType: RendererType.WEB_GPU,
});
app.start().catch((err: unknown) => console.error("[Showcase36] Failed to start:", err));
