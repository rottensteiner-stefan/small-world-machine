import type {
  BloomElement,
  EngineOptions,
  HbaoElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractGeometry,
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
  Noise,
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
  private _rainMesh!: InstancedMesh;
  private _rainPositions!: Float32Array;
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
    this.camera.position.set(1.4, 0.52, 4.4);
    this.camera.target.set(0, 0.35, -0.9);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // Atmospheric Rain Haze (deep night indigo, prevents background washout)
    this.scene.fog = new Fog({
      color: new Color(0.015, 0.02, 0.035),
      mode: FogMode.EXP2,
      density: 0.014,
    });

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

    // Real planar reflection for the wet asphalt street and puddles (mirrors the actual scene:
    // skyscrapers, glowing facade windows, neon signs, and hover car each frame).
    this._reflectionNode = new PlanarReflectionNode("PuddleReflection", 1024, 1024);
    this._reflectionNode.position.set(0, 0.001, 0);
    this.scene.add(this._reflectionNode);

    // Materials Palette: Soaking wet tarmac with glossy specular sheen & planar building reflections
    const dryAsphaltMat = new StandardMaterial({
      color: new Color(0.22, 0.24, 0.28),
      diffuseMap: asphaltDiffuse,
      normalMap: asphaltNormal,
      roughnessMap: asphaltRoughness,
      roughness: 0.25,
      metallic: 0.15,
      envMap: envTexture,
      reflectionMap: this._reflectionNode.renderTarget,
      reflectivity: 0.45,
      reflectionFresnelBlend: 0.25,
    });

    const wetPuddleMat = new StandardMaterial({
      color: new Color(0.02, 0.025, 0.035),
      roughness: 0.02,
      metallic: 0.95,
      envMap: envTexture,
      reflectionMap: this._reflectionNode.renderTarget,
      reflectivity: 0.9,
      // Low, not the 0.5 default: a puddle should stay clearly reflective across a normal range
      // of viewing angles, not almost only within the last few degrees before a grazing angle
      // (pure Fresnel reads as an on/off switch, not a puddle -- see reflectionFresnelBlend's own
      // doc comment). Still keeps a real angle-dependent boost near grazing, just far less steep.
      reflectionFresnelBlend: 0.15,
    });

    // Cyberpunk building facade: rain-soaked with glossy wet sheen
    const buildingMat = new StandardMaterial({
      color: new Color(0.65, 0.7, 0.8),
      diffuseMap: facadeDiffuse,
      normalMap: facadeNormal,
      roughnessMap: facadeRoughness,
      emissiveMap: facadeEmission,
      emissiveColor: new Color(1.0, 1.0, 1.0),
      emissiveIntensity: 1.5,
      roughness: 0.45,
      metallic: 0.25,
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

    interface SplashGeometryOptions {
      radius?: number;
      segments?: number;
      seed?: number;
      warp?: number;
      frequency?: number;
      satellites?: number;
    }

    /**
     * Procedural organic splash / puddle geometry based on multi-frequency simplex noise warping,
     * overlapping secondary lobes, and satellite droplets (matching the techniques demonstrated
     * in public/tools/splatter-gen.html).
     */
    class SplashGeometry extends AbstractGeometry {
      public radius: number;
      public segments: number;
      public seed: number;
      public warp: number;
      public frequency: number;
      public satellites: number;

      constructor(options: SplashGeometryOptions = {}) {
        super();
        this.radius = options.radius ?? 1.0;
        this.segments = Math.max(16, options.segments ?? 64);
        this.seed = options.seed ?? 1.0;
        this.warp = options.warp ?? 0.35;
        this.frequency = options.frequency ?? 2.4;
        this.satellites = options.satellites ?? 5;
        this.generateGeometryData();
      }

      protected override generateGeometryData(): void {
        const v: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        const norm: number[] = [];

        let s = this.seed;
        const rand = (): number => {
          s = (s * 9301 + 49297) % 233280;
          return s / 233280;
        };

        const addBlob = (
          cx: number,
          cz: number,
          rBase: number,
          segs: number,
          warpAmp: number,
          freq: number,
          seedOffset: number,
        ): void => {
          const centerIdx = v.length / 3;
          v.push(cx, 0, cz);
          norm.push(0, 1, 0);
          uv.push(0.5 + cx / (this.radius * 2.5), 0.5 + cz / (this.radius * 2.5));

          const baseVertex = v.length / 3;
          for (let i = 0; i <= segs; i++) {
            const theta = (i / segs) * Math.PI * 2;
            const nx = Math.cos(theta);
            const nz = Math.sin(theta);

            // Continuous 2D noise loop sampled on the circle
            const n1 = Noise.simplex2(nx * freq + seedOffset, nz * freq + seedOffset * 1.7);
            const n2 =
              Noise.simplex2(
                nx * (freq * 2.3) + seedOffset * 3.1,
                nz * (freq * 2.3) + seedOffset * 4.3,
              ) * 0.4;
            const r = rBase * Math.max(0.15, 1.0 + (n1 + n2) * warpAmp);

            const px = cx + nx * r;
            const pz = cz + nz * r;

            v.push(px, 0, pz);
            norm.push(0, 1, 0);
            uv.push(0.5 + px / (this.radius * 2.5), 0.5 + pz / (this.radius * 2.5));
          }

          for (let i = 0; i < segs; i++) {
            idx.push(centerIdx, baseVertex + i + 1, baseVertex + i);
          }
        };

        // 1. Main splash body
        addBlob(0, 0, this.radius, this.segments, this.warp, this.frequency, this.seed * 7.13);

        // 2. Secondary overlapping lobes to break radial symmetry into organic puddles
        const lobeCount = 2 + Math.floor(rand() * 3);
        for (let l = 0; l < lobeCount; l++) {
          const lobeAngle = rand() * Math.PI * 2;
          const lobeDist = this.radius * (0.25 + rand() * 0.35);
          const lobeR = this.radius * (0.4 + rand() * 0.35);
          const lx = Math.cos(lobeAngle) * lobeDist;
          const lz = Math.sin(lobeAngle) * lobeDist;
          addBlob(
            lx,
            lz,
            lobeR,
            32,
            this.warp * 0.8,
            this.frequency * 1.2,
            this.seed * 11.3 + l * 5.7,
          );
        }

        // 3. Small satellite droplets scattered around the splash
        for (let k = 0; k < this.satellites; k++) {
          const satAngle = rand() * Math.PI * 2;
          const satDist = this.radius * (1.1 + rand() * 0.45);
          const satR = this.radius * (0.05 + rand() * 0.08);
          const sx = Math.cos(satAngle) * satDist;
          const sz = Math.sin(satAngle) * satDist;
          addBlob(sx, sz, satR, 12, 0.2, 2.0, this.seed * 19.1 + k * 3.3);
        }

        this._vertices = new Float32Array(v);
        this._normals = new Float32Array(norm);
        this._uvs = new Float32Array(uv);
        this._indices = this._createIndexArray(idx.length);
        this._indices.set(idx);
        this.computeTangents();
      }
    }

    // 5. Mirrored Rain Water Puddles (4 distinct organic splash puddles across the wet street)
    const puddleConfigs = [
      { x: 0.1, z: 0.0, rx: 1.9, rz: 2.6, seed: 1.4, warp: 0.38, satellites: 7 }, // Puddle 0: Under & behind hover car
      { x: -3.4, z: -2.5, rx: 1.1, rz: 1.5, seed: 4.8, warp: 0.42, satellites: 4 }, // Puddle 1: Distant left alley
      { x: 3.4, z: -2.5, rx: 1.1, rz: 1.5, seed: 9.1, warp: 0.35, satellites: 4 }, // Puddle 2: Distant right alley
      { x: -2.6, z: 3.4, rx: 1.0, rz: 1.3, seed: 13.5, warp: 0.45, satellites: 5 }, // Puddle 3: Foreground left
    ];

    for (let p = 0; p < puddleConfigs.length; p++) {
      const cfg = puddleConfigs[p]!;
      const puddle = new Object3D(`Puddle_${p}`);
      puddle.geometry = new SplashGeometry({
        radius: 1.0,
        segments: 64,
        seed: cfg.seed,
        warp: cfg.warp,
        satellites: cfg.satellites,
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
    // Real low-poly mesh (Kenney "Car Kit", CC0 -- see REFERENCES.md), reskinned with
    // high-gloss sapphire cyberpunk metallic paint and illuminated light bars.
    this._hoverCar = new Object3D("HoverCar");
    this._hoverCar.position.set(0, 0.08, -0.9);
    this._hoverCar.rotation.y = Math.PI - 0.35;
    this.scene.add(this._hoverCar);

    // Soft camera-side key light to sculpt the car's metallic body contours and spoiler
    const carKeyLight = new PointLight({
      color: new Color(0.65, 0.8, 1.0),
      intensity: 2.5,
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
              color: new Color(0.12, 0.22, 0.38),
              roughness: 0.14,
              metallic: 0.9,
              envMap: envTexture,
            });
          } else if (node.name.includes("wheel")) {
            node.material = new StandardMaterial({
              color: new Color(0.04, 0.04, 0.05),
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
      color: new Color(0.05, 0.95, 1.0),
      emissiveColor: new Color(0.1, 1.1, 1.3),
      emissiveIntensity: 1.5,
      roughness: 0.1,
    });
    underglowBar.position.set(0, 0.03, 0);
    this._hoverCar.add(underglowBar);

    const underglowLight = new PointLight({
      color: new Color(0.05, 0.95, 1.0),
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
    tailLights.scale.set(1.25, 0.06, 0.1);
    tailLights.material = new StandardMaterial({
      color: new Color(1.0, 0.0, 0.05),
      emissiveColor: new Color(5.0, 0.1, 0.2),
      emissiveIntensity: 2.0,
      roughness: 0.1,
    });
    tailLights.position.set(0, 0.3, -1.62);
    this._hoverCar.add(tailLights);

    const tailLightGlow = new PointLight({
      color: new Color(1.0, 0.05, 0.1),
      intensity: 2.0,
      distance: 3.5,
    });
    tailLightGlow.position.set(0, 0.3, -1.7);
    this._hoverCar.add(tailLightGlow);

    // 9. Torrential Cyberpunk Rain Streaks
    const RAIN_COUNT = 1000;
    const rainGeom = new Cube({ size: 1 }).getGeometryData();
    const rainMat = new StandardMaterial({
      color: new Color(0.7, 0.85, 1.0),
      emissiveColor: new Color(0.4, 0.6, 0.9),
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metallic: 0.9,
    });
    this._rainMesh = new InstancedMesh("RainSystem", rainGeom, rainMat, RAIN_COUNT);
    this._rainPositions = new Float32Array(RAIN_COUNT * 3);

    const rainMat4 = new Matrix4();
    for (let i = 0; i < RAIN_COUNT; i++) {
      const rx = (Math.random() - 0.5) * 14.0;
      const ry = Math.random() * 14.0;
      const rz = (Math.random() - 0.5) * 22.0;
      this._rainPositions[i * 3 + 0] = rx;
      this._rainPositions[i * 3 + 1] = ry;
      this._rainPositions[i * 3 + 2] = rz;

      rainMat4.identity();
      rainMat4.data[0] = 0.012;
      rainMat4.data[5] = 0.45;
      rainMat4.data[10] = 0.012;
      rainMat4.data[12] = rx;
      rainMat4.data[13] = ry;
      rainMat4.data[14] = rz;
      this._rainMesh.setMatrixAt(i, rainMat4);
    }
    this._rainMesh.castShadow = false;
    this.scene.add(this._rainMesh);
    this._reflectionNode.excludedObjects.push(this._rainMesh);
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    // Hover vehicle levitation bobbing
    if (this._hoverCar) {
      this._hoverCar.position.y = 0.08 + Math.sin(this._time * 2.0) * 0.015;
      this._hoverCar.rotation.z = Math.sin(this._time * 1.5) * 0.01;
    }

    // Dynamic rain fall
    if (this._rainMesh && this._rainPositions) {
      const fallSpeed = 24.0 * deltaTime;
      const windX = -2.0 * deltaTime;
      const windZ = -1.0 * deltaTime;
      const count = this._rainMesh.instanceCount;
      const matrices = this._rainMesh.instanceMatrices;

      for (let i = 0; i < count; i++) {
        let x = this._rainPositions[i * 3 + 0]! + windX;
        let y = this._rainPositions[i * 3 + 1]! - fallSpeed;
        let z = this._rainPositions[i * 3 + 2]! + windZ;

        if (y < 0.0) {
          y = 13.0 + Math.random() * 2.0;
          x = (Math.random() - 0.5) * 14.0;
          z = (Math.random() - 0.5) * 22.0;
        }

        this._rainPositions[i * 3 + 0] = x;
        this._rainPositions[i * 3 + 1] = y;
        this._rainPositions[i * 3 + 2] = z;

        const offset = i * 16;
        matrices[offset + 12] = x;
        matrices[offset + 13] = y;
        matrices[offset + 14] = z;
      }
      this._rainMesh.instanceMatrixNeedsUpdate = true;
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
