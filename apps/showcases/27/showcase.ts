import {
  AbstractShowcase,
  AmbientLight,
  BloomElement,
  CameraStrategyType,
  Color,
  Cube,
  CubeLayout,
  CubeTexture,
  Cylinder,
  DirectionalLight,
  EngineOptions,
  HbaoElement,
  Object3D,
  OrbitController,
  PerspectiveProjection,
  PostProcessingEffectType,
  ProjectionType,
  RendererType,
  SkyboxMaterial,
  SpotLight,
  StandardMaterial,
  Texture,
  Torus,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

class Showcase27 extends AbstractShowcase {
  private _ringGroup!: Object3D;
  private _innerRings: Object3D[] = [];
  private _keySpotLightA!: SpotLight;
  private _keySpotLightB!: SpotLight;
  private _sunLight!: DirectionalLight;
  private _time: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    // Post-Processing: HBAO for micro contact shadows + Subtle Bloom
    this.renderer.postProcessing.enabled = true;
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 0.8;
      hbao.intensity = 1.2;
    }

    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.6;
      bloom.threshold = 1.0;
    }

    // Camera setup
    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect = window.innerWidth / window.innerHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (55 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 500,
      });
      this.camera.updateProjectionMatrix();
    }

    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 4.5, 7.5);
    this.camera.target.set(0, 2.2, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input, audio: this.audio }));

    // 1. Ambient Light (Low for sharp shadow contrast)
    this.scene.add(
      new AmbientLight({
        color: new Color(0.08, 0.09, 0.12),
        intensity: 0.25,
      }),
    );

    // 2. Cascaded Sun Light (CSM) - faint cool moonlight, the spots carry the shadows
    const sunLight = new DirectionalLight({
      color: new Color(0.7, 0.78, 1.0),
      intensity: 0.2,
    });
    sunLight.position.set(8, 12, 6);
    sunLight.direction.set(-0.8, -1.0, -0.6);
    sunLight.castShadow = true;
    sunLight.shadowBias = 0.002;
    this._sunLight = sunLight;
    this.scene.add(sunLight);

    // 3. Two Moving Spotlights for Cross-Shadowing
    // Spot A: Warm Amber
    this._keySpotLightA = new SpotLight({
      color: new Color(1.0, 0.65, 0.3),
      intensity: 5.0,
      direction: new Vector3D(0, -1, 0),
      angle: Math.PI / 4,
      penumbra: 0.4,
      distance: 30.0,
    });
    this._keySpotLightA.position.set(-4, 7, 3);
    this._keySpotLightA.castShadow = true;
    this._keySpotLightA.shadowResolution = 2048;
    this._keySpotLightA.shadowBias = 0.003;
    this.scene.add(this._keySpotLightA);

    // Spot B: Cool Cyan
    this._keySpotLightB = new SpotLight({
      color: new Color(0.3, 0.75, 1.0),
      intensity: 4.5,
      direction: new Vector3D(0, -1, 0),
      angle: Math.PI / 4.2,
      penumbra: 0.35,
      distance: 30.0,
    });
    this._keySpotLightB.position.set(4, 6, -3);
    this._keySpotLightB.castShadow = true;
    this._keySpotLightB.shadowResolution = 2048;
    this._keySpotLightB.shadowBias = 0.003;
    this.scene.add(this._keySpotLightB);

    // Load Environment Map & PBR Textures
    const envTexture = new CubeTexture();
    const irradianceTexture = new CubeTexture();
    const prefilterTexture = new CubeTexture();

    let whiteMarble: Texture[] = [];
    let blackMarble: Texture[] = [];
    let bronze: Texture[] = [];

    try {
      const [brdfTexture, ...textures] = await Promise.all([
        Texture.fromUrl("./assets/ibl/brdf_lut.webp"),
        Texture.fromUrl("./assets/marble_gold_diffuse.webp"),
        Texture.fromUrl("./assets/marble_gold_normal.webp"),
        Texture.fromUrl("./assets/marble_gold_roughness.webp"),
        Texture.fromUrl("./assets/marble_gold_metalness.webp"),
        Texture.fromUrl("./assets/marble_black_diffuse.webp"),
        Texture.fromUrl("./assets/marble_black_normal.webp"),
        Texture.fromUrl("./assets/marble_black_roughness.webp"),
        Texture.fromUrl("./assets/bronze_diffuse.webp"),
        Texture.fromUrl("./assets/bronze_normal.webp"),
        Texture.fromUrl("./assets/bronze_roughness.webp"),
        Texture.fromUrl("./assets/bronze_metalness.webp"),
        envTexture.loadFrom("./assets/ibl/env.webp", CubeLayout.CROSS_HORIZONTAL),
        irradianceTexture.loadFrom("./assets/ibl/irradiance.webp", CubeLayout.CROSS_HORIZONTAL),
        prefilterTexture.loadMipmapsFrom(
          [
            "./assets/ibl/prefilter/mip0.webp",
            "./assets/ibl/prefilter/mip1.webp",
            "./assets/ibl/prefilter/mip2.webp",
            "./assets/ibl/prefilter/mip3.webp",
            "./assets/ibl/prefilter/mip4.webp",
          ],
          CubeLayout.CROSS_HORIZONTAL,
        ),
      ]);

      const skybox = new Object3D("Skybox");
      skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
      skybox.material = new SkyboxMaterial({ cubeMap: envTexture });
      skybox.frustumCulled = false;
      this.scene.add(skybox);

      this.scene.brdfLUT = brdfTexture;
      this.scene.irradianceMap = irradianceTexture;
      this.scene.prefilterMap = prefilterTexture;
      this.scene.environmentIntensity = 0.5;

      whiteMarble = textures.slice(0, 4) as Texture[];
      blackMarble = textures.slice(4, 7) as Texture[];
      bronze = textures.slice(7, 11) as Texture[];
      for (const texture of blackMarble) {
        texture.repeat.x = 3;
        texture.repeat.y = 3;
      }
    } catch (e) {
      console.warn("Could not load IBL / PBR textures:", e);
    }

    // Materials (ambientCG CC0: Marble006, Metal008; Calacatta-Gold is generated by scripts/gen-marble-textures.py)
    const marbleWhite = new StandardMaterial({
      color: new Color(1, 1, 1),
      diffuseMap: whiteMarble[0],
      normalMap: whiteMarble[1],
      roughnessMap: whiteMarble[2],
      metallicMap: whiteMarble[3],
      roughness: 1.0,
      metallic: 1.0,
      envMap: envTexture,
    });

    const blackMarbleMaterial = new StandardMaterial({
      color: new Color(1, 1, 1),
      diffuseMap: blackMarble[0],
      normalMap: blackMarble[1],
      roughnessMap: blackMarble[2],
      roughness: 1.0,
      metallic: 0.0,
      envMap: envTexture,
    });

    const bronzeMetal = new StandardMaterial({
      color: new Color(1, 1, 1),
      diffuseMap: bronze[0],
      normalMap: bronze[1],
      roughnessMap: bronze[2],
      metallicMap: bronze[3],
      roughness: 1.0,
      metallic: 1.0,
      envMap: envTexture,
    });

    // 4. Temple Floor (Grand Shadow Receiver)
    const floor = new Object3D("TempleFloor");
    floor.geometry = new Cylinder({
      radiusTop: 14,
      radiusBottom: 14,
      height: 0.3,
      radialSegments: 64,
    }).getGeometryData();
    floor.material = blackMarbleMaterial;
    floor.position.set(0, -0.15, 0);
    this.scene.add(floor);

    // 5. Surrounding Pillar Colonnade (Classical Doric/Tuscan Order with Base & Capital)
    // Shared geometries instantiated once for optimal GPU buffer reuse across all 12 columns.
    const plinthGeom = new Cube().getGeometryData();
    const lowerTorusGeom = new Cylinder({
      radiusTop: 0.52,
      radiusBottom: 0.55,
      height: 0.1,
      radialSegments: 32,
    }).getGeometryData();
    const upperTorusGeom = new Cylinder({
      radiusTop: 0.43,
      radiusBottom: 0.48,
      height: 0.08,
      radialSegments: 32,
    }).getGeometryData();
    const shaftGeom = new Cylinder({
      radiusTop: 0.35,
      radiusBottom: 0.4,
      height: 4.6,
      radialSegments: 32,
    }).getGeometryData();
    const neckRingGeom = new Cylinder({
      radiusTop: 0.38,
      radiusBottom: 0.38,
      height: 0.06,
      radialSegments: 32,
    }).getGeometryData();
    const echinusGeom = new Cylinder({
      radiusTop: 0.52,
      radiusBottom: 0.36,
      height: 0.2,
      radialSegments: 32,
    }).getGeometryData();
    const abacusGeom = new Cube().getGeometryData();

    const pillarCount = 12;
    const colonnadeRadius = 9.5;
    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const x = Math.sin(angle) * colonnadeRadius;
      const z = Math.cos(angle) * colonnadeRadius;

      const colGroup = new Object3D(`Pillar_${i}`);
      colGroup.position.set(x, 0, z);
      colGroup.rotation.y = angle;

      // Base (Plinth + Stepped Torus Moldings)
      const plinth = new Object3D(`Pillar_${i}_Plinth`);
      plinth.geometry = plinthGeom;
      plinth.material = marbleWhite;
      plinth.scale.set(1.1, 0.16, 1.1);
      plinth.position.set(0, 0.08, 0);
      plinth.castShadow = true;
      colGroup.add(plinth);

      const lowerTorus = new Object3D(`Pillar_${i}_LowerTorus`);
      lowerTorus.geometry = lowerTorusGeom;
      lowerTorus.material = marbleWhite;
      lowerTorus.position.set(0, 0.21, 0);
      lowerTorus.castShadow = true;
      colGroup.add(lowerTorus);

      const upperTorus = new Object3D(`Pillar_${i}_UpperTorus`);
      upperTorus.geometry = upperTorusGeom;
      upperTorus.material = marbleWhite;
      upperTorus.position.set(0, 0.3, 0);
      upperTorus.castShadow = true;
      colGroup.add(upperTorus);

      // Shaft
      const shaft = new Object3D(`Pillar_${i}_Shaft`);
      shaft.geometry = shaftGeom;
      shaft.material = marbleWhite;
      shaft.position.set(0, 2.64, 0);
      shaft.castShadow = true;
      colGroup.add(shaft);

      // Capital (Astragal Neck Ring + Flared Echinus + Stepped Abacus Slab)
      const neckRing = new Object3D(`Pillar_${i}_NeckRing`);
      neckRing.geometry = neckRingGeom;
      neckRing.material = marbleWhite;
      neckRing.position.set(0, 4.97, 0);
      neckRing.castShadow = true;
      colGroup.add(neckRing);

      const echinus = new Object3D(`Pillar_${i}_Echinus`);
      echinus.geometry = echinusGeom;
      echinus.material = marbleWhite;
      echinus.position.set(0, 5.1, 0);
      echinus.castShadow = true;
      colGroup.add(echinus);

      const abacusLower = new Object3D(`Pillar_${i}_AbacusLower`);
      abacusLower.geometry = abacusGeom;
      abacusLower.material = marbleWhite;
      abacusLower.scale.set(1.02, 0.1, 1.02);
      abacusLower.position.set(0, 5.25, 0);
      abacusLower.castShadow = true;
      colGroup.add(abacusLower);

      const abacusUpper = new Object3D(`Pillar_${i}_AbacusUpper`);
      abacusUpper.geometry = abacusGeom;
      abacusUpper.material = marbleWhite;
      abacusUpper.scale.set(1.1, 0.08, 1.1);
      abacusUpper.position.set(0, 5.34, 0);
      abacusUpper.castShadow = true;
      colGroup.add(abacusUpper);

      this.scene.add(colGroup);

      // Narrow warm uplight aimed at the pillar so the gold veins catch the light (a spot, not a point
      // light: a point light mirrors as a bright orb in the polished floor).
      const uplight = new SpotLight({
        color: new Color(1.0, 0.74, 0.35),
        intensity: 8.5,
        direction: new Vector3D(Math.sin(angle) * 1.4, 2.6, Math.cos(angle) * 1.4),
        angle: Math.PI / 8.5,
        penumbra: 0.6,
        distance: 10.0,
      });
      uplight.position.set(
        Math.sin(angle) * (colonnadeRadius - 1.4),
        0.15,
        Math.cos(angle) * (colonnadeRadius - 1.4),
      );
      this.scene.add(uplight);
    }

    // 6. Central Pedestal
    const centralPedestal = new Object3D("CentralPedestal");
    centralPedestal.geometry = new Cylinder({
      radiusTop: 1.8,
      radiusBottom: 2.2,
      height: 1.2,
      radialSegments: 48,
      sideUvRepeat: [10, 1],
    }).getGeometryData();
    centralPedestal.material = blackMarbleMaterial;
    centralPedestal.position.set(0, 0.6, 0);
    centralPedestal.castShadow = true;
    this.scene.add(centralPedestal);

    // 7. Hero Shadow Instrument: "The Armillary Sphere" (Gimbals & Torus Rings)
    this._ringGroup = new Object3D("ArmillaryCore");
    this._ringGroup.position.set(0, 3.2, 0);
    this.scene.add(this._ringGroup);

    // Ring 1 (Outer Bronze Ring)
    const ring1 = new Object3D("ArmillaryRing1");
    ring1.geometry = new Torus({
      radius: 2.0,
      tube: 0.08,
      radialSegments: 48,
      tubularSegments: 64,
    }).getGeometryData();
    ring1.material = bronzeMetal;
    ring1.castShadow = true;
    this._ringGroup.add(ring1);
    this._innerRings.push(ring1);

    // Ring 2 (Middle Ring - Perpendicular)
    const ring2 = new Object3D("ArmillaryRing2");
    ring2.geometry = new Torus({
      radius: 1.6,
      tube: 0.07,
      radialSegments: 48,
      tubularSegments: 64,
    }).getGeometryData();
    ring2.material = bronzeMetal;
    ring2.rotation.x = Math.PI / 2;
    ring2.castShadow = true;
    this._ringGroup.add(ring2);
    this._innerRings.push(ring2);

    // Ring 3 (Inner Ring - Diagonal)
    const ring3 = new Object3D("ArmillaryRing3");
    ring3.geometry = new Torus({
      radius: 1.2,
      tube: 0.06,
      radialSegments: 48,
      tubularSegments: 64,
    }).getGeometryData();
    ring3.material = bronzeMetal;
    ring3.rotation.y = Math.PI / 4;
    ring3.castShadow = true;
    this._ringGroup.add(ring3);
    this._innerRings.push(ring3);

    // Center Golden Core
    const corePillar = new Object3D("CorePillar");
    corePillar.geometry = new Cylinder({
      radiusTop: 0.06,
      radiusBottom: 0.06,
      height: 3.8,
      radialSegments: 16,
    }).getGeometryData();
    corePillar.material = bronzeMetal;
    corePillar.castShadow = true;
    this._ringGroup.add(corePillar);
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._time += deltaTime;

    // Rotate Armillary Rings at different harmonic speeds for shifting lattice shadows
    if (this._ringGroup) {
      this._ringGroup.rotation.y += deltaTime * 0.3;
    }
    if (this._innerRings[0]) {
      this._innerRings[0].rotation.x += deltaTime * 0.4;
    }
    if (this._innerRings[1]) {
      this._innerRings[1].rotation.z += deltaTime * 0.5;
    }
    if (this._innerRings[2]) {
      this._innerRings[2].rotation.y += deltaTime * 0.6;
    }

    // Orbit the two Spotlights in opposite directions to cast dual chromatic shadows
    if (this._keySpotLightA) {
      const angleA = this._time * 0.6;
      this._keySpotLightA.position.set(Math.sin(angleA) * 5.5, 6.5, Math.cos(angleA) * 5.5);
      this._keySpotLightA.direction.set(
        -this._keySpotLightA.position.x * 0.6,
        -2.5,
        -this._keySpotLightA.position.z * 0.6,
      );
      this._keySpotLightA.updateMatrixWorld();
    }

    if (this._keySpotLightB) {
      const angleB = -this._time * 0.45;
      this._keySpotLightB.position.set(Math.sin(angleB) * 6.0, 7.0, Math.cos(angleB) * 6.0);
      this._keySpotLightB.direction.set(
        -this._keySpotLightB.position.x * 0.6,
        -2.5,
        -this._keySpotLightB.position.z * 0.6,
      );
      this._keySpotLightB.updateMatrixWorld();
    }

    // Drift the sun slowly to reveal changing shadow rakes
    if (this._sunLight) {
      const sunAngle = this._time * 0.1;
      this._sunLight.direction.set(-Math.cos(sunAngle) * 0.8, -1.0, -Math.sin(sunAngle) * 0.8);
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase27();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase27] Failed to start:", err));
