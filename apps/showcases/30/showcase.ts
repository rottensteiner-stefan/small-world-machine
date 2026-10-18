import type {
  BloomElement,
  EngineOptions,
  HbaoElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Circle,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  GltfLoader,
  Object3D,
  OrbitController,
  PlanarReflectionNode,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  SpotLight,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

/**
 * Showcase 30: "The Rain-Drenched Cyberpunk Albedo: Screen-Space Reflections & Neon Wetness"
 *
 * Benchmark testing planar & screen-space reflection response, roughness gradient
 * on water puddles, contrasting teal/magenta specular highlights, and HDR neon bloom.
 */
class Showcase30 extends AbstractShowcase {
  private _neonSignMagenta!: Object3D;
  private _neonSignCyan!: Object3D;
  private _spotTeal!: SpotLight;
  private _spotPink!: SpotLight;
  private _puddlePlates: Object3D[] = [];
  private _reflectionNode!: PlanarReflectionNode;
  private _hoverCar!: Object3D;
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
    // Post-Processing: Vivid Cyberpunk Neon Glow + Cinematographic Vignette & HBAO
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.65;
      bloom.threshold = 1.0;
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

    // Camera setup (Low-angle rain street camera)
    this.defaultFov = (48 * Math.PI) / 180;
    this.defaultFar = 150;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    // Genuine "wet street photography" framing: near-puddle-level height and a near-horizontal
    // view. The puddle's reflection strength is Fresnel-driven (like real water/wet asphalt) --
    // it's strong at grazing angles and fades fast the higher/steeper the camera looks down, so
    // camera HEIGHT above the puddle plane matters as much as the aim angle. Confirmed visually:
    // at (x, 0.16-0.2, z) with a ~1 degree elevation angle, the car's own lights mirror clearly;
    // the earlier (0, 0.5, 5.5)/(0, 0.3, -1) framing looked shallow-angled too but sat too high
    // above the plane (0.485 vs 0.16) for the reflection to read.
    this.camera.position.set(1.4, 0.42, 5.2);
    this.camera.target.set(0, 0.6, -1.0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // 1. Dark Rainy Night Ambient
    const ambientLight = new AmbientLight({
      color: new Color(0.04, 0.07, 0.14),
      intensity: 0.2,
    });
    this.scene.add(ambientLight);

    // 2. Far Street Rim Light (Moonlight through rain haze)
    const moonLight = new DirectionalLight({
      color: new Color(0.2, 0.45, 0.7),
      intensity: 0.4,
    });
    moonLight.position.set(5, 15, -10);
    moonLight.direction.set(-0.3, -1.0, 0.5);
    moonLight.castShadow = true;
    this.scene.add(moonLight);

    // 3. Neon Cyberpunk Street Spotlights
    this._spotTeal = new SpotLight({
      color: new Color(0.05, 0.95, 1.0),
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
      color: new Color(1.0, 0.08, 0.65),
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
        t.repeat.x = 10;
        t.repeat.y = 18;
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

    // Materials Palette
    const dryAsphaltMat = new StandardMaterial({
      color: new Color(0.35, 0.38, 0.42),
      diffuseMap: asphaltDiffuse,
      normalMap: asphaltNormal,
      roughnessMap: asphaltRoughness,
      roughness: 0.35,
      metallic: 0.05,
      envMap: envTexture,
    });

    // Real planar reflection for the puddles (mirrors the actual scene -- car, neon signs, rain
    // rig -- each frame) instead of only the static skybox envMap, which alone can never show any
    // local light source in the puddles. All 4 puddles share one node/render target since they're
    // coplanar (same puddle height).
    this._reflectionNode = new PlanarReflectionNode("PuddleReflection", 1024, 1024);
    this._reflectionNode.position.set(0, 0.003, 0);
    this.scene.add(this._reflectionNode);

    const wetPuddleMat = new StandardMaterial({
      color: new Color(0.02, 0.025, 0.035),
      roughness: 0.02,
      metallic: 0.95,
      envMap: envTexture,
      reflectionMap: this._reflectionNode.renderTarget,
      reflectivity: 0.85,
      // Low, not the 0.5 default: a puddle should stay clearly reflective across a normal range
      // of viewing angles, not almost only within the last few degrees before a grazing angle
      // (pure Fresnel reads as an on/off switch, not a puddle -- see reflectionFresnelBlend's own
      // doc comment). Still keeps a real angle-dependent boost near grazing, just far less steep.
      reflectionFresnelBlend: 0.15,
    });

    // Cyberpunk building facade with emissive scattered windows
    const buildingMat = new StandardMaterial({
      color: new Color(0.7, 0.75, 0.85),
      diffuseMap: facadeDiffuse,
      normalMap: facadeNormal,
      roughnessMap: facadeRoughness,
      emissiveMap: facadeEmission,
      emissiveColor: new Color(1.0, 1.0, 1.0),
      emissiveIntensity: 1.5,
      roughness: 0.75,
      metallic: 0.1,
      envMap: envTexture,
    });

    // Plain brushed dark metal for the conduits (no texture set: a pipe doesn't need one).
    const chromeMat = new StandardMaterial({
      color: new Color(0.55, 0.6, 0.66),
      roughness: 0.3,
      metallic: 0.9,
      envMap: envTexture,
    });

    // emissiveColor is already > 1 (HDR); intensity stays near 1 so bloom doesn't saturate everything.
    const neonMagentaMat = new StandardMaterial({
      color: new Color(1.0, 0.05, 0.6),
      emissiveColor: new Color(3.5, 0.1, 1.8),
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });

    const neonCyanMat = new StandardMaterial({
      color: new Color(0.05, 0.95, 1.0),
      emissiveColor: new Color(0.1, 3.2, 3.8),
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });

    const neonGoldMat = new StandardMaterial({
      color: new Color(1.0, 0.8, 0.1),
      emissiveColor: new Color(3.0, 2.2, 0.2),
      emissiveIntensity: 1.0,
      roughness: 0.1,
    });

    // 4. Main Wet Asphalt Ground
    const street = new Object3D("CyberStreet");
    street.geometry = new Cube({ size: 1 }).getGeometryData();
    street.scale.set(16, 0.4, 28);
    street.material = dryAsphaltMat;
    street.position.set(0, -0.2, 0);
    street.receiveShadow = true;
    this.scene.add(street);

    // 5. Mirrored Rain Water Puddles (4 distinct puddles across the wet street)
    const puddleConfigs = [
      { x: 0.4, z: 2.0, rx: 1.3, rz: 1.7 }, // Puddle 0: Mirror pool for hover car rear & underglow
      { x: -2.2, z: -0.8, rx: 1.0, rz: 1.3 }, // Puddle 1: Mid-ground left beside car
      { x: 2.5, z: -2.5, rx: 1.0, rz: 1.4 }, // Puddle 2: Distant right alley
      { x: -2.3, z: 2.8, rx: 0.9, rz: 1.2 }, // Puddle 3: Foreground left
    ];

    for (let p = 0; p < puddleConfigs.length; p++) {
      const cfg = puddleConfigs[p]!;
      const puddle = new Object3D(`Puddle_${p}`);
      puddle.geometry = new Circle({
        radius: 1.0,
        segments: 48,
      }).getGeometryData();
      puddle.scale.set(cfg.rx, 1.0, cfg.rz);
      puddle.material = wetPuddleMat;
      puddle.position.set(cfg.x, 0.003, cfg.z);
      puddle.receiveShadow = true;
      this.scene.add(puddle);
      this._puddlePlates.push(puddle);
    }

    // Exclude the street pavement and puddles from the reflection sub-render so the mirror camera
    // underneath has an unobstructed line of sight up to the car, buildings, and sky.
    this._reflectionNode.excludedObjects.push(street, ...this._puddlePlates);

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
      color: new Color(1.0, 0.05, 0.6),
      intensity: 4.5,
      distance: 12.0,
    });
    magentaLight.position.set(-4.4, 5.5, 1.0);
    this.scene.add(magentaLight);

    this._neonSignCyan = new Object3D("NeonSignCyan");
    this._neonSignCyan.geometry = new Cube({ size: 1 }).getGeometryData();
    this._neonSignCyan.scale.set(0.15, 4.0, 3.0);
    this._neonSignCyan.material = neonCyanMat;
    this._neonSignCyan.position.set(4.8, 6.2, -3.0);
    this.scene.add(this._neonSignCyan);

    const cyanLight = new PointLight({
      color: new Color(0.05, 0.95, 1.0),
      intensity: 4.5,
      distance: 12.0,
    });
    cyanLight.position.set(4.4, 6.2, -3.0);
    this.scene.add(cyanLight);

    // Overhead Street Arch Sign
    const overheadSign = new Object3D("OverheadSign");
    overheadSign.geometry = new Cube({ size: 1 }).getGeometryData();
    overheadSign.scale.set(6.0, 0.5, 0.2);
    overheadSign.material = neonGoldMat;
    overheadSign.position.set(0, 7.5, -6.0);
    this.scene.add(overheadSign);

    // 8. Futuristic Hover Vehicle in Center
    // Real low-poly mesh (Kenney "Car Kit", CC0 -- see REFERENCES.md) instead of the old
    // hand-stacked chassis/cockpit box primitives.
    this._hoverCar = new Object3D("HoverCar");
    this._hoverCar.position.set(0, 0.8, -1.0);
    this._hoverCar.rotation.y = Math.PI - 0.25;
    this.scene.add(this._hoverCar);

    try {
      const carLoader = new GltfLoader({ basePath: "./assets/car/" });
      const carModel = await carLoader.load("sedan-sports.glb");
      carModel.scale.set(1.35, 1.35, 1.35);
      carModel.castShadow = true;
      this._hoverCar.add(carModel);
    } catch (e) {
      console.warn("Could not load hover car model:", e);
    }

    // Underglow strip (an actual emissive mesh under the belly, not just a light -- a PointLight
    // alone illuminates the puddle below but isn't itself visible as a "glow") + a real PointLight
    // alongside it so the glow actually lights the asphalt/puddle underneath. Sells the
    // "hovering, not driving" read.
    const underglowBar = new Object3D("UnderglowBar");
    underglowBar.geometry = new Cube({ size: 1 }).getGeometryData();
    underglowBar.scale.set(0.35, 0.03, 2.2);
    underglowBar.material = new StandardMaterial({
      color: new Color(0.05, 0.95, 1.0),
      emissiveColor: new Color(0.1, 1.1, 1.3),
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });
    underglowBar.position.set(0, 0.04, 0);
    this._hoverCar.add(underglowBar);

    const underglowLight = new PointLight({
      color: new Color(0.05, 0.95, 1.0),
      intensity: 0.8,
      distance: 2.5,
    });
    underglowLight.position.set(0, 0.04, 0);
    this._hoverCar.add(underglowLight);

    // sedan-sports.glb front is +Z (headlights), rear is -Z (spoiler & taillights).
    const headlights = new Object3D("Headlights");
    headlights.geometry = new Cube({ size: 1 }).getGeometryData();
    headlights.scale.set(1.15, 0.05, 0.1);
    headlights.material = new StandardMaterial({
      color: new Color(0.9, 0.95, 1.0),
      emissiveColor: new Color(3.0, 3.2, 4.0),
      emissiveIntensity: 1.0,
      roughness: 0.1,
    });
    headlights.position.set(0, 0.28, 1.6);
    this._hoverCar.add(headlights);

    const headlightBeam = new PointLight({
      color: new Color(0.85, 0.95, 1.0),
      intensity: 1.5,
      distance: 6.0,
    });
    headlightBeam.position.set(0, 0.28, 1.7);
    this._hoverCar.add(headlightBeam);

    const tailLights = new Object3D("TailLights");
    tailLights.geometry = new Cube({ size: 1 }).getGeometryData();
    tailLights.scale.set(1.15, 0.05, 0.1);
    tailLights.material = new StandardMaterial({
      color: new Color(1.0, 0.0, 0.05),
      emissiveColor: new Color(4.5, 0.05, 0.2),
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });
    tailLights.position.set(0, 0.3, -1.62);
    this._hoverCar.add(tailLights);

    const tailLightGlow = new PointLight({
      color: new Color(1.0, 0.05, 0.1),
      intensity: 1.0,
      distance: 3.0,
    });
    tailLightGlow.position.set(0, 0.3, -1.7);
    this._hoverCar.add(tailLightGlow);
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    // Hover vehicle levitation bobbing
    if (this._hoverCar) {
      this._hoverCar.position.y = 0.8 + Math.sin(this._time * 2.5) * 0.08;
      this._hoverCar.rotation.z = Math.sin(this._time * 1.5) * 0.02;
    }

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
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase30();
attachDevTools(app);
(window as unknown as { __app: Showcase30 }).__app = app;
app.start().catch((err: unknown) => console.error("[Showcase30] Failed to start:", err));
