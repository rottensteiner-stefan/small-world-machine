import type {
  BloomElement,
  ColorGradingElement,
  GrainElement,
  HbaoElement,
  ToneMappingElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cone,
  Cube,
  Cylinder,
  DirectionalLight,
  FlickerBehavior,
  FlyController,
  Fog,
  FogMode,
  Object3D,
  PointLight,
  PostProcessingEffectType,
  Pyramid,
  RendererType,
  Sphere,
  StandardMaterial,
  Texture,
  TextureWrap,
  ToneMappingMode,
  Vector3D,
} from "@small-world-machine/engine";
import { box } from "../shared/prim.js";
import { GoldenCapture, parseGoldenSpec } from "./GoldenCapture.js";

interface CameraPreset {
  name: string;
  position: Vector3D;
  target: Vector3D;
}

enum TimeOfDay {
  GOLDEN_HOUR = "Golden Hour (Morning)",
  MIDDAY = "Midday Sun",
  MIDNIGHT = "Midnight Starlight",
}

class Showcase38 extends AbstractShowcase {
  private _sunLight!: DirectionalLight;
  private _ambientLight!: AmbientLight;
  private _toneMapping!: ToneMappingElement;
  private _colorGrading!: ColorGradingElement;
  private _fog!: Fog;

  private _timeOfDayMode: TimeOfDay = TimeOfDay.GOLDEN_HOUR;
  private _flickerEnabled: boolean = true;
  private _flickerBehaviors: FlickerBehavior[] = [];
  private _audioMuted: boolean = false;
  private _activePresetIdx: number = 0;

  private _hudElement: HTMLElement | null = null;
  private _goldenCapture: GoldenCapture | undefined;

  private readonly _cameraPresets: CameraPreset[] = [
    {
      name: "1: The Siq Canyon Gorge",
      position: new Vector3D(0.0, 3.5, 25.0),
      target: new Vector3D(0.0, 13.0, -2.0),
    },
    {
      name: "2: Al-Khazneh Plaza Full View",
      position: new Vector3D(0.0, 3.5, 17.0),
      target: new Vector3D(0.0, 14.5, -2.0),
    },
    {
      name: "3: Colonnade Portico & Threshold",
      position: new Vector3D(3.2, 2.2, -1.0),
      target: new Vector3D(-1.5, 3.8, -5.0),
    },
    {
      name: "4: Main Inner Sanctum Hall",
      position: new Vector3D(0.0, 2.4, -6.5),
      target: new Vector3D(0.0, 3.4, -18.0),
    },
    {
      name: "5: Rear Shrine & Altar Niche",
      position: new Vector3D(0.0, 2.4, -16.5),
      target: new Vector3D(0.0, 3.0, -22.5),
    },
  ];

  /**
   * Runs the regular showcase boot, then -- only when the golden query parameters are present --
   * the deterministic per-preset capture on top of the fully-ready scene (see GoldenCapture.ts).
   */
  public override async start(): Promise<void> {
    const golden = parseGoldenSpec();
    await super.start();
    if (golden) {
      this._goldenCapture = new GoldenCapture(this, {
        disableFlicker: (): void => {
          this._flickerEnabled = false;
        },
        applyPreset: (index: number): void => {
          const preset = this._cameraPresets[index];
          if (!preset) return;
          this._activePresetIdx = index;
          this.setInitialCamera(preset.position, preset.target);
        },
      });
      await this._goldenCapture.run(golden);
    }
  }

  protected override async setupScene(): Promise<void> {
    // ------------------------------------------------------------------------
    // 1. Post-Processing Pipeline Setup
    // ------------------------------------------------------------------------
    this.renderer.postProcessing.enabled = true;

    // ACES Filmic Tone Mapping
    const toneMapping = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    if (toneMapping) {
      toneMapping.enabled = true;
      toneMapping.mode = ToneMappingMode.ACES_FILMIC;
      toneMapping.exposure = 1.15;
      this._toneMapping = toneMapping;
    }

    // Parametric Color Grading (Jordanian Sandstone Atmosphere)
    const colorGrading = this.renderer.postProcessing.get<ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    if (colorGrading) {
      colorGrading.enabled = true;
      colorGrading.temperature = 0.32;
      colorGrading.saturation = 1.05;
      colorGrading.contrast = 1.08;
      colorGrading.lift = new Color(0.03, 0.015, 0.01);
      colorGrading.gamma = new Color(1.05, 0.96, 0.88);
      colorGrading.gain = new Color(1.08, 1.02, 0.94);
      this._colorGrading = colorGrading;
    }

    // HBAO Screen-Space Ambient Occlusion (Rich contact shadows in column fluting & rock crevices)
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 0.85;
      hbao.intensity = 1.45;
    }

    // Bloom (Warm halo around flickering torches and sunlit facade crests)
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.55;
      bloom.threshold = 0.78;
      bloom.radius = 0.6;
      bloom.color = new Color(1.0, 0.86, 0.65);
    }

    // Vignette (Focus on central architecture)
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      vignette.darkness = 0.62;
      vignette.offset = 0.85;
      vignette.roundness = 2.0;
    }

    // Film Grain (Cinematic analog look)
    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    if (grain) {
      grain.enabled = true;
      grain.intensity = 0.01;
    }

    // ------------------------------------------------------------------------
    // 2. Camera Setup (65° FOV, First-Person / Fly Controller)
    // ------------------------------------------------------------------------
    this.defaultFar = 200;
    this.configureCamera();

    this.camera.setStrategy(CameraStrategyType.FPS);
    const initialPreset = this._cameraPresets[0]!;
    this.setInitialCamera(initialPreset.position, initialPreset.target);

    const flyCtrl = new FlyController({
      input: this.input,
      moveSpeed: 4.5,
      fastMultiplier: 2.5,
      slowMultiplier: 0.35,
      lookSensitivity: 0.003,
      enableVertical: true,
      flyInLookDirection: true,
    });
    this.camera.addBehavior(flyCtrl);

    // ------------------------------------------------------------------------
    // 3. Desert Dust Fog & Environment Atmosphere
    // ------------------------------------------------------------------------
    this._fog = new Fog({
      mode: FogMode.EXP2,
      density: 0.006,
      color: new Color(0.55, 0.35, 0.22),
    });
    this.scene.fog = this._fog;

    // ------------------------------------------------------------------------
    // 4. Load PBR Textures
    // ------------------------------------------------------------------------
    const wrapRepeat = {
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
    };

    const [
      sandstoneBandedDiff,
      sandstoneBandedNorm,
      sandstoneBandedRough,
      carvedMasonryDiff,
      carvedMasonryNorm,
      carvedMasonryRough,
      cliffRockDiff,
      cliffRockNorm,
      cliffRockRough,
      plazaSandDiff,
      plazaSandNorm,
      plazaSandRough,
      torchWoodDiff,
      torchWoodNorm,
      torchWoodRough,
      forgedIronDiff,
      forgedIronNorm,
      forgedIronRough,
      flagstoneDiff,
      flagstoneNorm,
      flagstoneRough,
    ] = await Promise.all([
      Texture.fromUrl("./assets/sandstone_banded_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/sandstone_banded_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/sandstone_banded_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/carved_masonry_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/carved_masonry_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/carved_masonry_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/weathered_cliff_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/weathered_cliff_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/weathered_cliff_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/plaza_sand_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/plaza_sand_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/plaza_sand_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/torch_wood_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/torch_wood_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/torch_wood_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/forged_iron_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/forged_iron_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/forged_iron_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/paved_flagstone_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/paved_flagstone_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/paved_flagstone_roughness.png", wrapRepeat),
    ]);

    sandstoneBandedDiff.repeat = { x: 3.0, y: 3.0 };
    sandstoneBandedNorm.repeat = { x: 3.0, y: 3.0 };
    sandstoneBandedRough.repeat = { x: 3.0, y: 3.0 };

    carvedMasonryDiff.repeat = { x: 2.5, y: 2.5 };
    carvedMasonryNorm.repeat = { x: 2.5, y: 2.5 };
    carvedMasonryRough.repeat = { x: 2.5, y: 2.5 };

    cliffRockDiff.repeat = { x: 4.0, y: 8.0 };
    cliffRockNorm.repeat = { x: 4.0, y: 8.0 };
    cliffRockRough.repeat = { x: 4.0, y: 8.0 };

    plazaSandDiff.repeat = { x: 6.0, y: 6.0 };
    plazaSandNorm.repeat = { x: 6.0, y: 6.0 };
    plazaSandRough.repeat = { x: 6.0, y: 6.0 };

    flagstoneDiff.repeat = { x: 3.5, y: 3.5 };
    flagstoneNorm.repeat = { x: 3.5, y: 3.5 };
    flagstoneRough.repeat = { x: 3.5, y: 3.5 };

    // ------------------------------------------------------------------------
    // 5. PBR Materials
    // ------------------------------------------------------------------------
    const bandedSandstoneMat = new StandardMaterial({
      diffuseMap: sandstoneBandedDiff,
      normalMap: sandstoneBandedNorm,
      roughnessMap: sandstoneBandedRough,
      metallic: 0.0,
      roughness: 0.82,
    });

    const carvedMasonryMat = new StandardMaterial({
      diffuseMap: carvedMasonryDiff,
      normalMap: carvedMasonryNorm,
      roughnessMap: carvedMasonryRough,
      metallic: 0.0,
      roughness: 0.78,
    });

    const flagstoneMat = new StandardMaterial({
      diffuseMap: flagstoneDiff,
      normalMap: flagstoneNorm,
      roughnessMap: flagstoneRough,
      metallic: 0.0,
      roughness: 0.84,
    });

    const cliffRockMat = new StandardMaterial({
      diffuseMap: cliffRockDiff,
      normalMap: cliffRockNorm,
      roughnessMap: cliffRockRough,
      metallic: 0.0,
      roughness: 0.88,
    });

    const plazaSandMat = new StandardMaterial({
      diffuseMap: plazaSandDiff,
      normalMap: plazaSandNorm,
      roughnessMap: plazaSandRough,
      metallic: 0.0,
      roughness: 0.95,
    });

    const torchWoodMat = new StandardMaterial({
      diffuseMap: torchWoodDiff,
      normalMap: torchWoodNorm,
      roughnessMap: torchWoodRough,
      metallic: 0.0,
      roughness: 0.75,
    });

    const forgedIronMat = new StandardMaterial({
      diffuseMap: forgedIronDiff,
      normalMap: forgedIronNorm,
      roughnessMap: forgedIronRough,
      metallic: 0.88,
      roughness: 0.38,
    });

    const flameMat = new StandardMaterial({
      color: new Color(1.0, 0.65, 0.2),
      emissiveColor: new Color(1.0, 0.55, 0.1),
      emissiveIntensity: 4.0,
      metallic: 0.0,
      roughness: 0.1,
    });

    const emberMat = new StandardMaterial({
      color: new Color(0.2, 0.08, 0.04),
      emissiveColor: new Color(1.0, 0.25, 0.02),
      emissiveIntensity: 2.2,
      metallic: 0.0,
      roughness: 0.9,
    });

    // ------------------------------------------------------------------------
    // 6. Lighting Hierarchy (Sun + Cascaded Shadows + Ambient)
    // ------------------------------------------------------------------------
    this._ambientLight = new AmbientLight({
      color: new Color(0.18, 0.12, 0.08),
      intensity: 0.25,
    });
    this.scene.add(this._ambientLight);

    // Directional Sun Light angled through the Siq Canyon
    this._sunLight = new DirectionalLight({
      direction: new Vector3D(0.55, -0.65, -0.52).normalize(),
      color: new Color(1.0, 0.88, 0.72),
      intensity: 2.8,
      numCascades: 4,
      cascadeSplitLambda: 0.65,
    });
    this._sunLight.castShadow = true;
    this._sunLight.shadowBias = 0.0015;
    this._sunLight.shadowResolution = 2048;
    this.scene.add(this._sunLight);

    // ------------------------------------------------------------------------
    // 7. Geometries Pool
    // ------------------------------------------------------------------------
    const cubeGeom = new Cube({ size: 1 }).getGeometryData();
    const colShaftGeom = new Cylinder({
      radiusTop: 0.52,
      radiusBottom: 0.58,
      height: 1.0,
      radialSegments: 24,
    }).getGeometryData();
    const tholosColGeom = new Cylinder({
      radiusTop: 0.32,
      radiusBottom: 0.36,
      height: 1.0,
      radialSegments: 20,
    }).getGeometryData();
    const cylinderGeom = new Cylinder({
      radiusTop: 1,
      radiusBottom: 1,
      height: 1,
      radialSegments: 24,
    }).getGeometryData();
    const coneGeom = new Cone({ radius: 1, height: 1, radialSegments: 24 }).getGeometryData();
    const sphereGeom = new Sphere({
      radius: 1,
      widthSegments: 16,
      heightSegments: 12,
    }).getGeometryData();
    const pyramidGeom = new Pyramid({ base: 1, height: 1 }).getGeometryData();

    // ------------------------------------------------------------------------
    // 8. Procedural Builders (Corinthian Columns, Torches, Braziers)
    // ------------------------------------------------------------------------

    const buildCorinthianColumn = (
      name: string,
      x: number,
      y: number,
      z: number,
      height: number,
      isTholos: boolean = false,
    ): Object3D => {
      const colGroup = new Object3D(name);
      colGroup.position.set(x, y, z);

      const shaftG = isTholos ? tholosColGeom : colShaftGeom;
      const baseR = isTholos ? 0.42 : 0.68;
      const capR = isTholos ? 0.46 : 0.74;

      // 1. Plinth (Square bottom base)
      const plinth = new Object3D(`${name}_Plinth`);
      plinth.geometry = cubeGeom;
      plinth.material = carvedMasonryMat;
      plinth.scale.set(baseR * 2.2, 0.45, baseR * 2.2);
      plinth.position.set(0, 0.225, 0);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      colGroup.add(plinth);

      // 2. Attic Torus Rings
      const torus1 = new Object3D(`${name}_Torus1`);
      torus1.geometry = cylinderGeom;
      torus1.material = carvedMasonryMat;
      torus1.scale.set(baseR * 1.15, 0.2, baseR * 1.15);
      torus1.position.set(0, 0.55, 0);
      torus1.castShadow = true;
      torus1.receiveShadow = true;
      colGroup.add(torus1);

      // 3. Fluted Shaft
      const shaftH = height - 1.8;
      const shaft = new Object3D(`${name}_Shaft`);
      shaft.geometry = shaftG;
      shaft.material = carvedMasonryMat;
      shaft.scale.set(1.0, shaftH, 1.0);
      shaft.position.set(0, 0.65 + shaftH * 0.5, 0);
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      colGroup.add(shaft);

      // 4. Corinthian Capital (Tiered acanthus bell + Abacus slab)
      const capY = 0.65 + shaftH;
      const capBell = new Object3D(`${name}_CapBell`);
      capBell.geometry = cylinderGeom;
      capBell.material = carvedMasonryMat;
      capBell.scale.set(capR * 1.1, 0.75, capR * 1.1);
      capBell.position.set(0, capY + 0.375, 0);
      capBell.castShadow = true;
      capBell.receiveShadow = true;
      colGroup.add(capBell);

      const capAbacus = new Object3D(`${name}_Abacus`);
      capAbacus.geometry = cubeGeom;
      capAbacus.material = carvedMasonryMat;
      capAbacus.scale.set(capR * 2.4, 0.35, capR * 2.4);
      capAbacus.position.set(0, capY + 0.75 + 0.175, 0);
      capAbacus.castShadow = true;
      capAbacus.receiveShadow = true;
      colGroup.add(capAbacus);

      this.scene.add(colGroup);
      return colGroup;
    };

    const buildWallTorch = (
      name: string,
      x: number,
      y: number,
      z: number,
      normalDir: Vector3D,
      lightIntensity: number = 4.2,
      lightDistance: number = 14.0,
    ): void => {
      const torchGroup = new Object3D(name);
      torchGroup.position.set(x, y, z);

      // Iron wall mounting plate
      const mount = new Object3D(`${name}_Mount`);
      mount.geometry = cubeGeom;
      mount.material = forgedIronMat;
      mount.scale.set(0.22, 0.45, 0.08);
      mount.castShadow = true;
      torchGroup.add(mount);

      // Angled iron arm extending outward
      const arm = new Object3D(`${name}_Arm`);
      arm.geometry = cylinderGeom;
      arm.material = forgedIronMat;
      arm.scale.set(0.04, 0.45, 0.04);
      arm.position.set(normalDir.x * 0.22, 0.05, normalDir.z * 0.22);
      arm.rotation.set(normalDir.z * 0.45, 0, -normalDir.x * 0.45);
      arm.castShadow = true;
      torchGroup.add(arm);

      // Wooden torch staff
      const staffPos = new Vector3D(normalDir.x * 0.42, 0.25, normalDir.z * 0.42);
      const staff = new Object3D(`${name}_Staff`);
      staff.geometry = cylinderGeom;
      staff.material = torchWoodMat;
      staff.scale.set(0.07, 0.85, 0.07);
      staff.position.copyFrom(staffPos);
      staff.castShadow = true;
      torchGroup.add(staff);

      // Iron binding ring & basket
      const basket = new Object3D(`${name}_Basket`);
      basket.geometry = cylinderGeom;
      basket.material = forgedIronMat;
      basket.scale.set(0.12, 0.22, 0.12);
      basket.position.set(staffPos.x, staffPos.y + 0.42, staffPos.z);
      basket.castShadow = true;
      torchGroup.add(basket);

      // Emissive flame core
      const flameCore = new Object3D(`${name}_FlameCore`);
      flameCore.geometry = sphereGeom;
      flameCore.material = flameMat;
      flameCore.scale.set(0.14, 0.28, 0.14);
      flameCore.position.set(staffPos.x, staffPos.y + 0.62, staffPos.z);
      torchGroup.add(flameCore);

      this.scene.add(torchGroup);

      // Warm PointLight (2150K color temperature)
      const torchLight = new PointLight({
        name: `${name}_Light`,
        color: new Color(1.0, 0.58, 0.22),
        intensity: lightIntensity,
        distance: lightDistance,
        decay: 2.0,
      });
      torchLight.position.set(x + staffPos.x, y + staffPos.y + 0.65, z + staffPos.z);
      this.scene.add(torchLight);

      // Organic flame flicker behavior (unique per torch)
      const baseIntensity = lightIntensity;
      const flicker = new FlickerBehavior({
        minStableTime: 0.05,
        maxStableTime: 0.35,
        minFlickerTime: 0.5,
        maxFlickerTime: 2.0,
        minMultiplier: 0.22,
        smoothness: 0.45,
        frequency: 14.0 + Math.random() * 6.0,
        noiseOffset: Math.random() * 10000.0,
        onUpdate: (multiplier: number): void => {
          if (!this._flickerEnabled) {
            torchLight.intensity = baseIntensity;
            flameCore.scale.set(0.14, 0.28, 0.14);
            return;
          }
          torchLight.intensity = baseIntensity * multiplier;
          const s = 0.14 * (0.6 + multiplier * 0.8);
          const sy = 0.28 * (0.5 + multiplier * 1.0);
          flameCore.scale.set(s, sy, s);
        },
      });
      torchGroup.addBehavior(flicker);
      this._flickerBehaviors.push(flicker);
    };

    const buildFireBrazier = (name: string, x: number, y: number, z: number): void => {
      const brazierGroup = new Object3D(name);
      brazierGroup.position.set(x, y, z);

      // Heavy wrought-iron tripod base
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3;
        const leg = new Object3D(`${name}_Leg_${i}`);
        leg.geometry = cylinderGeom;
        leg.material = forgedIronMat;
        leg.scale.set(0.06, 0.95, 0.06);
        leg.position.set(Math.sin(angle) * 0.48, 0.45, Math.cos(angle) * 0.48);
        leg.rotation.set(-Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35);
        leg.castShadow = true;
        brazierGroup.add(leg);
      }

      // Wrought-iron fire basin bowl
      const bowl = new Object3D(`${name}_Bowl`);
      bowl.geometry = cylinderGeom;
      bowl.material = forgedIronMat;
      bowl.scale.set(0.95, 0.35, 0.95);
      bowl.position.set(0, 0.85, 0);
      bowl.castShadow = true;
      brazierGroup.add(bowl);

      // Glowing charcoal bed
      const embers = new Object3D(`${name}_Embers`);
      embers.geometry = cylinderGeom;
      embers.material = emberMat;
      embers.scale.set(0.85, 0.15, 0.85);
      embers.position.set(0, 0.98, 0);
      brazierGroup.add(embers);

      // Central roaring flame cone
      const mainFlame = new Object3D(`${name}_MainFlame`);
      mainFlame.geometry = coneGeom;
      mainFlame.material = flameMat;
      mainFlame.scale.set(0.48, 0.95, 0.48);
      mainFlame.position.set(0, 1.45, 0);
      brazierGroup.add(mainFlame);

      this.scene.add(brazierGroup);

      // Powerful central PointLight (2000K)
      const brazierLight = new PointLight({
        name: `${name}_Light`,
        color: new Color(1.0, 0.52, 0.16),
        intensity: 7.5,
        distance: 22.0,
        decay: 2.0,
      });
      brazierLight.position.set(x, y + 1.5, z);
      this.scene.add(brazierLight);

      const flicker = new FlickerBehavior({
        minStableTime: 0.08,
        maxStableTime: 0.45,
        minFlickerTime: 0.6,
        maxFlickerTime: 2.2,
        minMultiplier: 0.32,
        smoothness: 0.52,
        frequency: 11.5 + Math.random() * 3.0,
        noiseOffset: Math.random() * 10000.0,
        onUpdate: (multiplier: number): void => {
          if (!this._flickerEnabled) {
            brazierLight.intensity = 7.5;
            mainFlame.scale.set(0.48, 0.95, 0.48);
            return;
          }
          brazierLight.intensity = 7.5 * multiplier;
          const s = 0.48 * (0.65 + multiplier * 0.7);
          const sy = 0.95 * (0.55 + multiplier * 0.9);
          mainFlame.scale.set(s, sy, s);
        },
      });
      brazierGroup.addBehavior(flicker);
      this._flickerBehaviors.push(flicker);
    };

    // ------------------------------------------------------------------------
    // 9. Scene Construction: The Siq Canyon Gorge (Approach Corridor)
    // ------------------------------------------------------------------------

    // Plaza Sand Floor
    const plazaFloor = new Object3D("PlazaFloor");
    plazaFloor.geometry = cubeGeom;
    plazaFloor.material = plazaSandMat;
    plazaFloor.scale.set(55.0, 0.2, 70.0);
    plazaFloor.position.set(0, -0.1, 20.0);
    plazaFloor.receiveShadow = true;
    this.scene.add(plazaFloor);

    // Towering Siq Canyon Cliff Walls (Left & Right framing the approach)
    const canyonSegments = [
      { x: -16.0, z: 12.0, sx: 14.0, sy: 46.0, sz: 18.0, rotY: 0.08 },
      { x: 16.0, z: 12.0, sx: 14.0, sy: 46.0, sz: 18.0, rotY: -0.08 },
      { x: -14.0, z: 28.0, sx: 16.0, sy: 48.0, sz: 20.0, rotY: -0.05 },
      { x: 14.0, z: 28.0, sx: 16.0, sy: 48.0, sz: 20.0, rotY: 0.06 },
      { x: -12.0, z: 44.0, sx: 18.0, sy: 50.0, sz: 22.0, rotY: 0.04 },
      { x: 12.0, z: 44.0, sx: 18.0, sy: 50.0, sz: 22.0, rotY: -0.04 },
    ];

    canyonSegments.forEach((seg, idx) => {
      const cliff = new Object3D(`SiqCliff_${idx}`);
      cliff.geometry = cubeGeom;
      cliff.material = cliffRockMat;
      cliff.scale.set(seg.sx, seg.sy, seg.sz);
      cliff.position.set(seg.x, seg.sy * 0.5, seg.z);
      cliff.rotation.y = seg.rotY;
      cliff.castShadow = true;
      cliff.receiveShadow = true;
      this.scene.add(cliff);
    });

    // ------------------------------------------------------------------------
    // 10. Scene Construction: Al-Khazneh Facade (Lower Tier & Portico)
    // ------------------------------------------------------------------------

    // Sheer Rock Buttresses framing the facade flanks (Left & Right)
    this.scene.add(
      box("RockFlank_Left", cliffRockMat, [5.5, 38.0, 9.0], [-14.2, 19.0, -2.0], {
        cast: true,
        receive: true,
      }),
    );

    this.scene.add(
      box("RockFlank_Right", cliffRockMat, [5.5, 38.0, 9.0], [14.2, 19.0, -2.0], {
        cast: true,
        receive: true,
      }),
    );

    // Stylobate Stepped Podium (5 steps leading from Y=0 to Y=1.0)
    for (let step = 0; step < 5; step++) {
      const stepWidth = 24.2 - step * 0.35;
      const stepDepth = 3.8 - step * 0.65;
      const stepY = step * 0.2 + 0.1;
      const stepZ = 0.5 - step * 0.32;

      const stepMesh = new Object3D(`StylobateStep_${step}`);
      stepMesh.geometry = cubeGeom;
      stepMesh.material = flagstoneMat;
      stepMesh.scale.set(stepWidth, 0.2, stepDepth);
      stepMesh.position.set(0, stepY, stepZ);
      stepMesh.receiveShadow = true;
      stepMesh.castShadow = true;
      this.scene.add(stepMesh);
    }

    // Portico Colonnade Floor ($Y = 1.0$)
    const porticoFloor = new Object3D("PorticoFloor");
    porticoFloor.geometry = cubeGeom;
    porticoFloor.material = flagstoneMat;
    porticoFloor.scale.set(24.0, 0.2, 4.2);
    porticoFloor.position.set(0, 0.9, -1.8);
    porticoFloor.receiveShadow = true;
    this.scene.add(porticoFloor);

    // 6 Lower Corinthian Columns ($Y = 1.0$ to $11.5\,\text{m}$)
    const colXCoords = [-10.2, -6.2, -2.2, 2.2, 6.2, 10.2];
    colXCoords.forEach((cx, idx) => {
      buildCorinthianColumn(`LowerColumn_${idx}`, cx, 1.0, -0.6, 10.5, false);

      // Engaged Wall Pilasters directly behind each column against the back portico wall
      const pilaster = new Object3D(`LowerPilaster_${idx}`);
      pilaster.geometry = cubeGeom;
      pilaster.material = carvedMasonryMat;
      pilaster.scale.set(1.1, 10.5, 0.35);
      pilaster.position.set(cx, 6.25, -3.3);
      pilaster.castShadow = true;
      pilaster.receiveShadow = true;
      this.scene.add(pilaster);
    });

    // Lower Architrave with 3 stepped fascia bands ($Y = 11.5$ to $12.5\,\text{m}$)
    const lowerArchitrave = new Object3D("LowerArchitrave");
    lowerArchitrave.geometry = cubeGeom;
    lowerArchitrave.material = carvedMasonryMat;
    lowerArchitrave.scale.set(24.5, 0.95, 3.2);
    lowerArchitrave.position.set(0, 11.975, -1.2);
    lowerArchitrave.castShadow = true;
    lowerArchitrave.receiveShadow = true;
    this.scene.add(lowerArchitrave);

    // Fascia relief rib
    const architraveRib = new Object3D("LowerArchitrave_Rib");
    architraveRib.geometry = cubeGeom;
    architraveRib.material = carvedMasonryMat;
    architraveRib.scale.set(24.7, 0.18, 3.35);
    architraveRib.position.set(0, 12.35, -1.2);
    architraveRib.castShadow = true;
    this.scene.add(architraveRib);

    // Lower Sculpted Frieze ($Y = 12.5$ to $13.4\,\text{m}$)
    const lowerFrieze = new Object3D("LowerFrieze");
    lowerFrieze.geometry = cubeGeom;
    lowerFrieze.material = carvedMasonryMat;
    lowerFrieze.scale.set(24.8, 0.85, 3.4);
    lowerFrieze.position.set(0, 12.875, -1.2);
    lowerFrieze.castShadow = true;
    lowerFrieze.receiveShadow = true;
    this.scene.add(lowerFrieze);

    // Modillion Cornice ($Y = 13.3$ to $14.2\,\text{m}$)
    const lowerCornice = new Object3D("LowerCornice");
    lowerCornice.geometry = cubeGeom;
    lowerCornice.material = carvedMasonryMat;
    lowerCornice.scale.set(25.4, 0.65, 3.8);
    lowerCornice.position.set(0, 13.625, -1.2);
    lowerCornice.castShadow = true;
    lowerCornice.receiveShadow = true;
    this.scene.add(lowerCornice);

    // Dentil band under the cornice
    const dentilBand = new Object3D("LowerDentilBand");
    dentilBand.geometry = cubeGeom;
    dentilBand.material = carvedMasonryMat;
    dentilBand.scale.set(25.1, 0.22, 3.6);
    dentilBand.position.set(0, 13.35, -1.2);
    dentilBand.castShadow = true;
    this.scene.add(dentilBand);

    // Central Triangular Pediment ($X \in [-5.2, 5.2], Y = 14.0$ to $17.5\,\text{m}$)
    const pediment = new Object3D("CentralPediment");
    pediment.geometry = pyramidGeom;
    pediment.material = carvedMasonryMat;
    pediment.scale.set(10.8, 3.6, 3.2);
    pediment.position.set(0, 13.95, -1.2);
    pediment.rotation.set(0, Math.PI * 0.25, 0);
    pediment.castShadow = true;
    pediment.receiveShadow = true;
    this.scene.add(pediment);

    // Pediment Raking Cornice Trim (Sloping eaves)
    const pedimentCornice = new Object3D("CentralPedimentCornice");
    pedimentCornice.geometry = pyramidGeom;
    pedimentCornice.material = carvedMasonryMat;
    pedimentCornice.scale.set(11.2, 3.8, 3.4);
    pedimentCornice.position.set(0, 14.05, -1.2);
    pedimentCornice.rotation.set(0, Math.PI * 0.25, 0);
    pedimentCornice.castShadow = true;
    this.scene.add(pedimentCornice);

    // Tympanum Medallion Relief (Gorgoneion / Isis Solar Disk)
    const tympanumMedallion = new Object3D("TympanumMedallion");
    tympanumMedallion.geometry = cylinderGeom;
    tympanumMedallion.material = carvedMasonryMat;
    tympanumMedallion.scale.set(0.75, 0.15, 0.75);
    tympanumMedallion.position.set(0, 15.1, -0.4);
    tympanumMedallion.rotation.set(Math.PI * 0.5, 0, 0);
    tympanumMedallion.castShadow = true;
    this.scene.add(tympanumMedallion);

    // Pediment Apex Urn / Floral Acroterion
    const apexAcroterion = new Object3D("ApexAcroterion");
    apexAcroterion.geometry = cylinderGeom;
    apexAcroterion.material = carvedMasonryMat;
    apexAcroterion.scale.set(0.65, 1.4, 0.65);
    apexAcroterion.position.set(0, 17.8, -0.4);
    apexAcroterion.castShadow = true;
    this.scene.add(apexAcroterion);

    const apexUrnFinial = new Object3D("ApexUrnFinial");
    apexUrnFinial.geometry = sphereGeom;
    apexUrnFinial.material = carvedMasonryMat;
    apexUrnFinial.scale.set(0.55, 0.85, 0.55);
    apexUrnFinial.position.set(0, 18.7, -0.4);
    apexUrnFinial.castShadow = true;
    this.scene.add(apexUrnFinial);

    // Corner Sphinx / Eagle Acroteria on Left and Right Pediment Eaves
    [-5.3, 5.3].forEach((acx, idx) => {
      const cornerAcro = new Object3D(`CornerAcroterion_${idx}`);
      cornerAcro.geometry = cubeGeom;
      cornerAcro.material = carvedMasonryMat;
      cornerAcro.scale.set(0.7, 1.1, 0.7);
      cornerAcro.position.set(acx, 14.5, -0.4);
      cornerAcro.castShadow = true;
      this.scene.add(cornerAcro);
    });

    // ------------------------------------------------------------------------
    // 11. Scene Construction: Al-Khazneh Facade (Upper Tier & Tholos)
    // ------------------------------------------------------------------------

    // Upper Rock Niche Back Wall behind pavilions and Tholos
    const upperNicheBack = new Object3D("UpperRockNiche_Back");
    upperNicheBack.geometry = cubeGeom;
    upperNicheBack.material = cliffRockMat;
    upperNicheBack.scale.set(24.5, 20.0, 2.5);
    upperNicheBack.position.set(0, 24.5, -3.6);
    upperNicheBack.castShadow = true;
    upperNicheBack.receiveShadow = true;
    this.scene.add(upperNicheBack);

    // Upper Attic Podium ($Y = 14.0$ to $15.5\,\text{m}$)
    const upperPodium = new Object3D("UpperPodium");
    upperPodium.geometry = cubeGeom;
    upperPodium.material = carvedMasonryMat;
    upperPodium.scale.set(24.5, 1.5, 3.5);
    upperPodium.position.set(0, 14.75, -1.5);
    upperPodium.castShadow = true;
    upperPodium.receiveShadow = true;
    this.scene.add(upperPodium);

    const upperPodiumCap = new Object3D("UpperPodium_Cap");
    upperPodiumCap.geometry = cubeGeom;
    upperPodiumCap.material = carvedMasonryMat;
    upperPodiumCap.scale.set(24.8, 0.25, 3.7);
    upperPodiumCap.position.set(0, 15.45, -1.5);
    upperPodiumCap.castShadow = true;
    this.scene.add(upperPodiumCap);

    // Central Circular Tholos Temple (Radius $3.2\,\text{m}, Y = 15.5$ to $26.0\,\text{m}$)
    const tholosPodium = new Object3D("TholosPodium");
    tholosPodium.geometry = cylinderGeom;
    tholosPodium.material = carvedMasonryMat;
    tholosPodium.scale.set(3.5, 0.8, 3.5);
    tholosPodium.position.set(0, 15.9, -1.5);
    tholosPodium.castShadow = true;
    tholosPodium.receiveShadow = true;
    this.scene.add(tholosPodium);

    // Tholos Inner Cella Drum with Niche
    const tholosCella = new Object3D("TholosCella");
    tholosCella.geometry = cylinderGeom;
    tholosCella.material = carvedMasonryMat;
    tholosCella.scale.set(2.1, 7.8, 2.1);
    tholosCella.position.set(0, 20.2, -1.8);
    tholosCella.castShadow = true;
    tholosCella.receiveShadow = true;
    this.scene.add(tholosCella);

    // Tyche / Isis-Fortuna Statue inside central Tholos Cella Niche
    const tychePlinth = new Object3D("TycheStatue_Plinth");
    tychePlinth.geometry = cubeGeom;
    tychePlinth.material = carvedMasonryMat;
    tychePlinth.scale.set(0.9, 0.45, 0.7);
    tychePlinth.position.set(0, 16.6, -0.6);
    tychePlinth.castShadow = true;
    this.scene.add(tychePlinth);

    const tycheBody = new Object3D("TycheStatue_Body");
    tycheBody.geometry = cylinderGeom;
    tycheBody.material = carvedMasonryMat;
    tycheBody.scale.set(0.42, 2.4, 0.38);
    tycheBody.position.set(0, 18.0, -0.6);
    tycheBody.castShadow = true;
    this.scene.add(tycheBody);

    const tycheCornucopia = new Object3D("TycheStatue_Cornucopia");
    tycheCornucopia.geometry = coneGeom;
    tycheCornucopia.material = carvedMasonryMat;
    tycheCornucopia.scale.set(0.28, 1.4, 0.28);
    tycheCornucopia.position.set(0.35, 18.4, -0.5);
    tycheCornucopia.rotation.set(-0.35, 0, 0.45);
    tycheCornucopia.castShadow = true;
    this.scene.add(tycheCornucopia);

    // 4 Front Tholos Corinthian Columns
    const tholosRadius = 2.6;
    for (let i = 0; i < 4; i++) {
      const angle = -Math.PI * 0.4 + (i * Math.PI * 0.8) / 3;
      const tx = Math.sin(angle) * tholosRadius;
      const tz = -1.5 + Math.cos(angle) * tholosRadius;
      buildCorinthianColumn(`TholosCol_${i}`, tx, 16.3, tz, 7.5, true);
    }

    // Tholos Circular Entablature & Dentils
    const tholosEntablature = new Object3D("TholosEntablature");
    tholosEntablature.geometry = cylinderGeom;
    tholosEntablature.material = carvedMasonryMat;
    tholosEntablature.scale.set(3.6, 1.1, 3.6);
    tholosEntablature.position.set(0, 24.35, -1.5);
    tholosEntablature.castShadow = true;
    tholosEntablature.receiveShadow = true;
    this.scene.add(tholosEntablature);

    const tholosModillionCornice = new Object3D("TholosModillionCornice");
    tholosModillionCornice.geometry = cylinderGeom;
    tholosModillionCornice.material = carvedMasonryMat;
    tholosModillionCornice.scale.set(3.9, 0.45, 3.9);
    tholosModillionCornice.position.set(0, 25.0, -1.5);
    tholosModillionCornice.castShadow = true;
    this.scene.add(tholosModillionCornice);

    // Conical Tholos Roof with stepped flared base
    const tholosRoofBase = new Object3D("TholosRoof_Base");
    tholosRoofBase.geometry = cylinderGeom;
    tholosRoofBase.material = carvedMasonryMat;
    tholosRoofBase.scale.set(3.4, 0.5, 3.4);
    tholosRoofBase.position.set(0, 25.45, -1.5);
    tholosRoofBase.castShadow = true;
    this.scene.add(tholosRoofBase);

    const tholosRoof = new Object3D("TholosRoof");
    tholosRoof.geometry = coneGeom;
    tholosRoof.material = carvedMasonryMat;
    tholosRoof.scale.set(3.4, 3.4, 3.4);
    tholosRoof.position.set(0, 27.2, -1.5);
    tholosRoof.castShadow = true;
    tholosRoof.receiveShadow = true;
    this.scene.add(tholosRoof);

    // The Iconic Funerary Urn ($Y = 28.8$ to $33.5\,\text{m}$)
    const urnPedestal = new Object3D("UrnPedestal");
    urnPedestal.geometry = cubeGeom;
    urnPedestal.material = carvedMasonryMat;
    urnPedestal.scale.set(1.4, 0.5, 1.4);
    urnPedestal.position.set(0, 29.0, -1.5);
    urnPedestal.castShadow = true;
    this.scene.add(urnPedestal);

    const urnCapital = new Object3D("UrnCapital");
    urnCapital.geometry = cylinderGeom;
    urnCapital.material = carvedMasonryMat;
    urnCapital.scale.set(0.95, 0.7, 0.95);
    urnCapital.position.set(0, 29.55, -1.5);
    urnCapital.castShadow = true;
    this.scene.add(urnCapital);

    const urnBody = new Object3D("UrnBody");
    urnBody.geometry = sphereGeom;
    urnBody.material = carvedMasonryMat;
    urnBody.scale.set(1.2, 1.9, 1.2);
    urnBody.position.set(0, 30.9, -1.5);
    urnBody.castShadow = true;
    this.scene.add(urnBody);

    const urnLip = new Object3D("UrnLip");
    urnLip.geometry = cylinderGeom;
    urnLip.material = carvedMasonryMat;
    urnLip.scale.set(0.85, 0.35, 0.85);
    urnLip.position.set(0, 32.1, -1.5);
    urnLip.castShadow = true;
    this.scene.add(urnLip);

    const urnTop = new Object3D("UrnTop");
    urnTop.geometry = coneGeom;
    urnTop.material = carvedMasonryMat;
    urnTop.scale.set(0.65, 1.2, 0.65);
    urnTop.position.set(0, 32.85, -1.5);
    urnTop.castShadow = true;
    this.scene.add(urnTop);

    // Left & Right Broken Pediment Wings (Aediculae)
    const wingXCoords = [-7.8, 7.8];
    wingXCoords.forEach((wx, idx) => {
      const isLeft = idx === 0;

      // 2 Wing Front Columns
      buildCorinthianColumn(`WingCol_${idx}_0`, wx - 1.8, 15.5, -1.5, 8.5, true);
      buildCorinthianColumn(`WingCol_${idx}_1`, wx + 1.8, 15.5, -1.5, 8.5, true);

      // 2 Wing Back Pilasters
      [-1.8, 1.8].forEach((px, pidx) => {
        const backPilaster = new Object3D(`WingBackPilaster_${idx}_${pidx}`);
        backPilaster.geometry = cubeGeom;
        backPilaster.material = carvedMasonryMat;
        backPilaster.scale.set(0.85, 8.5, 0.35);
        backPilaster.position.set(wx + px, 19.75, -3.2);
        backPilaster.castShadow = true;
        backPilaster.receiveShadow = true;
        this.scene.add(backPilaster);
      });

      // Sculpted Amazon / Nike Statue Relief in the pavilion center
      const amazonPlinth = new Object3D(`AmazonPlinth_${idx}`);
      amazonPlinth.geometry = cubeGeom;
      amazonPlinth.material = carvedMasonryMat;
      amazonPlinth.scale.set(1.2, 0.45, 0.65);
      amazonPlinth.position.set(wx, 16.4, -2.4);
      amazonPlinth.castShadow = true;
      this.scene.add(amazonPlinth);

      const amazonBody = new Object3D(`AmazonBody_${idx}`);
      amazonBody.geometry = cylinderGeom;
      amazonBody.material = carvedMasonryMat;
      amazonBody.scale.set(0.45, 2.6, 0.38);
      amazonBody.position.set(wx, 17.9, -2.4);
      amazonBody.castShadow = true;
      this.scene.add(amazonBody);

      // Wing Entablature
      const wingEnt = new Object3D(`WingEnt_${idx}`);
      wingEnt.geometry = cubeGeom;
      wingEnt.material = carvedMasonryMat;
      wingEnt.scale.set(6.2, 1.2, 3.2);
      wingEnt.position.set(wx, 24.6, -1.5);
      wingEnt.castShadow = true;
      wingEnt.receiveShadow = true;
      this.scene.add(wingEnt);

      const wingCornice = new Object3D(`WingCornice_${idx}`);
      wingCornice.geometry = cubeGeom;
      wingCornice.material = carvedMasonryMat;
      wingCornice.scale.set(6.6, 0.45, 3.5);
      wingCornice.position.set(wx, 25.3, -1.5);
      wingCornice.castShadow = true;
      this.scene.add(wingCornice);

      // Authentic Broken Pediment Wing Raking Cornice (Sloping inward toward center)
      const brokenPed = new Object3D(`BrokenPed_${idx}`);
      brokenPed.geometry = cubeGeom;
      brokenPed.material = carvedMasonryMat;
      brokenPed.scale.set(5.2, 0.55, 3.2);
      brokenPed.position.set(wx, 26.6, -1.5);
      brokenPed.rotation.set(0, 0, isLeft ? 0.38 : -0.38);
      brokenPed.castShadow = true;
      brokenPed.receiveShadow = true;
      this.scene.add(brokenPed);

      // Wing Outer Gable Apex Acroterion (Eagle / Urn)
      const wingEagle = new Object3D(`WingEagle_${idx}`);
      wingEagle.geometry = cylinderGeom;
      wingEagle.material = carvedMasonryMat;
      wingEagle.scale.set(0.55, 1.2, 0.55);
      const eagleX = isLeft ? wx - 2.4 : wx + 2.4;
      wingEagle.position.set(eagleX, 28.0, -1.5);
      wingEagle.castShadow = true;
      this.scene.add(wingEagle);
    });

    // Cavernous Rock Overhang Arch above the Tholos & Facade ($Y = 34.0$ to $42.0\,\text{m}$)
    const upperRockOverhang = new Object3D("UpperRockOverhang");
    upperRockOverhang.geometry = cubeGeom;
    upperRockOverhang.material = cliffRockMat;
    upperRockOverhang.scale.set(34.0, 8.0, 7.5);
    upperRockOverhang.position.set(0, 36.5, -2.5);
    upperRockOverhang.castShadow = true;
    upperRockOverhang.receiveShadow = true;
    this.scene.add(upperRockOverhang);

    // Sheer Mountain Cliff Towering Above the Facade ($Y = 38.0$ to $54.0\,\text{m}$)
    const mountainCrown = new Object3D("MountainCrown");
    mountainCrown.geometry = cubeGeom;
    mountainCrown.material = cliffRockMat;
    mountainCrown.scale.set(44.0, 18.0, 16.0);
    mountainCrown.position.set(0, 46.0, -8.0);
    mountainCrown.castShadow = true;
    mountainCrown.receiveShadow = true;
    this.scene.add(mountainCrown);

    // ------------------------------------------------------------------------
    // 12. Scene Construction: Vestibule Portico & Grand Portal ($Z \in [-3.8, 0]$)
    // ------------------------------------------------------------------------

    // Left & Right Portico Front Walls framing the portal
    const porticoWallLeft = new Object3D("PorticoWallLeft");
    porticoWallLeft.geometry = cubeGeom;
    porticoWallLeft.material = bandedSandstoneMat;
    porticoWallLeft.scale.set(9.0, 11.0, 1.2);
    porticoWallLeft.position.set(-7.5, 6.5, -3.5);
    porticoWallLeft.castShadow = true;
    porticoWallLeft.receiveShadow = true;
    this.scene.add(porticoWallLeft);

    const porticoWallRight = new Object3D("PorticoWallRight");
    porticoWallRight.geometry = cubeGeom;
    porticoWallRight.material = bandedSandstoneMat;
    porticoWallRight.scale.set(9.0, 11.0, 1.2);
    porticoWallRight.position.set(7.5, 6.5, -3.5);
    porticoWallRight.castShadow = true;
    porticoWallRight.receiveShadow = true;
    this.scene.add(porticoWallRight);

    // Dioscuri (Castor & Pollux) Equestrian Bas-Relief Panels flanking the portal
    [-8.2, 8.2].forEach((rx, idx) => {
      const isLeft = idx === 0;
      const name = isLeft ? "Dioscuri_Left" : "Dioscuri_Right";

      // Molded Relief Frame
      const reliefFrame = new Object3D(`${name}_Frame`);
      reliefFrame.geometry = cubeGeom;
      reliefFrame.material = carvedMasonryMat;
      reliefFrame.scale.set(3.2, 5.2, 0.25);
      reliefFrame.position.set(rx, 5.5, -3.32);
      reliefFrame.castShadow = true;
      reliefFrame.receiveShadow = true;
      this.scene.add(reliefFrame);

      // Carved Pedestal
      const reliefPlinth = new Object3D(`${name}_Plinth`);
      reliefPlinth.geometry = cubeGeom;
      reliefPlinth.material = carvedMasonryMat;
      reliefPlinth.scale.set(2.8, 0.65, 0.4);
      reliefPlinth.position.set(rx, 3.25, -3.22);
      reliefPlinth.castShadow = true;
      this.scene.add(reliefPlinth);

      // Sculpted Rearing Steed Silhouette
      const horseBody = new Object3D(`${name}_HorseBody`);
      horseBody.geometry = cylinderGeom;
      horseBody.material = carvedMasonryMat;
      horseBody.scale.set(0.75, 2.2, 0.45);
      horseBody.position.set(rx + (isLeft ? 0.3 : -0.3), 5.2, -3.18);
      horseBody.rotation.set(0, 0, isLeft ? -0.45 : 0.45);
      horseBody.castShadow = true;
      this.scene.add(horseBody);

      // Sculpted Warrior Figure
      const riderBody = new Object3D(`${name}_Rider`);
      riderBody.geometry = cylinderGeom;
      riderBody.material = carvedMasonryMat;
      riderBody.scale.set(0.38, 1.8, 0.35);
      riderBody.position.set(rx + (isLeft ? -0.35 : 0.35), 6.1, -3.15);
      riderBody.castShadow = true;
      this.scene.add(riderBody);
    });

    // Multi-tiered Open Monumental Portal Frame ($Y = 1.0$ to $10.5\,\text{m}$, open entrance between X = -1.9 and +1.9)
    // Outer Stepped Door Jambs (Left & Right)
    const portalOuterJambLeft = new Object3D("PortalOuterJamb_Left");
    portalOuterJambLeft.geometry = cubeGeom;
    portalOuterJambLeft.material = carvedMasonryMat;
    portalOuterJambLeft.scale.set(0.8, 8.2, 0.5);
    portalOuterJambLeft.position.set(-2.8, 5.1, -3.3);
    portalOuterJambLeft.castShadow = true;
    portalOuterJambLeft.receiveShadow = true;
    this.scene.add(portalOuterJambLeft);

    const portalOuterJambRight = new Object3D("PortalOuterJamb_Right");
    portalOuterJambRight.geometry = cubeGeom;
    portalOuterJambRight.material = carvedMasonryMat;
    portalOuterJambRight.scale.set(0.8, 8.2, 0.5);
    portalOuterJambRight.position.set(2.8, 5.1, -3.3);
    portalOuterJambRight.castShadow = true;
    portalOuterJambRight.receiveShadow = true;
    this.scene.add(portalOuterJambRight);

    // Inner Stepped Door Jambs (Left & Right)
    const portalInnerJambLeft = new Object3D("PortalInnerJamb_Left");
    portalInnerJambLeft.geometry = cubeGeom;
    portalInnerJambLeft.material = carvedMasonryMat;
    portalInnerJambLeft.scale.set(0.6, 7.6, 0.6);
    portalInnerJambLeft.position.set(-2.2, 4.8, -3.35);
    portalInnerJambLeft.castShadow = true;
    portalInnerJambLeft.receiveShadow = true;
    this.scene.add(portalInnerJambLeft);

    const portalInnerJambRight = new Object3D("PortalInnerJamb_Right");
    portalInnerJambRight.geometry = cubeGeom;
    portalInnerJambRight.material = carvedMasonryMat;
    portalInnerJambRight.scale.set(0.6, 7.6, 0.6);
    portalInnerJambRight.position.set(2.2, 4.8, -3.35);
    portalInnerJambRight.castShadow = true;
    portalInnerJambRight.receiveShadow = true;
    this.scene.add(portalInnerJambRight);

    // Monumental Portal Lintels (Above the open door opening)
    const portalInnerLintel = new Object3D("PortalInnerLintel");
    portalInnerLintel.geometry = cubeGeom;
    portalInnerLintel.material = carvedMasonryMat;
    portalInnerLintel.scale.set(5.0, 0.8, 0.6);
    portalInnerLintel.position.set(0, 9.0, -3.35);
    portalInnerLintel.castShadow = true;
    portalInnerLintel.receiveShadow = true;
    this.scene.add(portalInnerLintel);

    const portalOuterLintel = new Object3D("PortalOuterLintel");
    portalOuterLintel.geometry = cubeGeom;
    portalOuterLintel.material = carvedMasonryMat;
    portalOuterLintel.scale.set(6.4, 1.2, 0.5);
    portalOuterLintel.position.set(0, 10.0, -3.3);
    portalOuterLintel.castShadow = true;
    portalOuterLintel.receiveShadow = true;
    this.scene.add(portalOuterLintel);

    // Overdoor Bracketed Cornice with Dentils ($Y = 10.6$ to $11.4\,\text{m}$)
    const portalFrieze = new Object3D("PortalOverdoorFrieze");
    portalFrieze.geometry = cubeGeom;
    portalFrieze.material = carvedMasonryMat;
    portalFrieze.scale.set(5.6, 0.65, 0.7);
    portalFrieze.position.set(0, 10.75, -3.15);
    portalFrieze.castShadow = true;
    this.scene.add(portalFrieze);

    const portalCornice = new Object3D("PortalOverdoorCornice");
    portalCornice.geometry = cubeGeom;
    portalCornice.material = carvedMasonryMat;
    portalCornice.scale.set(6.0, 0.55, 0.9);
    portalCornice.position.set(0, 11.35, -3.1);
    portalCornice.castShadow = true;
    this.scene.add(portalCornice);

    // Left and Right Carved Console Brackets
    [-2.6, 2.6].forEach((bx, idx) => {
      const bracket = new Object3D(`PortalBracket_${idx}`);
      bracket.geometry = cubeGeom;
      bracket.material = carvedMasonryMat;
      bracket.scale.set(0.45, 0.9, 0.6);
      bracket.position.set(bx, 10.45, -3.05);
      bracket.castShadow = true;
      this.scene.add(bracket);
    });

    // 2 Exterior Portico Torches flanking the grand portal
    buildWallTorch("PorticoTorch_Left", -3.4, 4.2, -3.4, new Vector3D(0, 0, 1), 4.5, 15.0);
    buildWallTorch("PorticoTorch_Right", 3.4, 4.2, -3.4, new Vector3D(0, 0, 1), 4.5, 15.0);

    // ------------------------------------------------------------------------
    // 13. Scene Construction: Walkable Rock-Hewn Inner Sanctum
    // ------------------------------------------------------------------------

    // Main Hall Floor ($X \in [-7, 7], Z \in [-17.5, -3.5], Y = 1.0$)
    const sanctumFloor = new Object3D("SanctumFloor");
    sanctumFloor.geometry = cubeGeom;
    sanctumFloor.material = flagstoneMat;
    sanctumFloor.scale.set(14.0, 0.2, 14.0);
    sanctumFloor.position.set(0, 0.9, -10.5);
    sanctumFloor.receiveShadow = true;
    this.scene.add(sanctumFloor);

    // Main Hall Ceiling ($Y = 10.5$)
    const sanctumCeiling = new Object3D("SanctumCeiling");
    sanctumCeiling.geometry = cubeGeom;
    sanctumCeiling.material = bandedSandstoneMat;
    sanctumCeiling.scale.set(14.0, 0.2, 14.0);
    sanctumCeiling.position.set(0, 10.6, -10.5);
    sanctumCeiling.receiveShadow = true;
    this.scene.add(sanctumCeiling);

    // Main Hall Left Wall with doorway opening into left chamber ($Z \in [-17.5, -3.5]$)
    const leftWallFront = new Object3D("SanctumLeftWall_Front");
    leftWallFront.geometry = cubeGeom;
    leftWallFront.material = bandedSandstoneMat;
    leftWallFront.scale.set(0.6, 9.5, 4.5);
    leftWallFront.position.set(-7.0, 5.75, -5.75);
    leftWallFront.castShadow = true;
    leftWallFront.receiveShadow = true;
    this.scene.add(leftWallFront);

    const leftWallRear = new Object3D("SanctumLeftWall_Rear");
    leftWallRear.geometry = cubeGeom;
    leftWallRear.material = bandedSandstoneMat;
    leftWallRear.scale.set(0.6, 9.5, 4.5);
    leftWallRear.position.set(-7.0, 5.75, -15.25);
    leftWallRear.castShadow = true;
    leftWallRear.receiveShadow = true;
    this.scene.add(leftWallRear);

    const leftWallHeader = new Object3D("SanctumLeftWall_Header");
    leftWallHeader.geometry = cubeGeom;
    leftWallHeader.material = bandedSandstoneMat;
    leftWallHeader.scale.set(0.6, 4.5, 5.0);
    leftWallHeader.position.set(-7.0, 8.25, -10.5);
    leftWallHeader.castShadow = true;
    leftWallHeader.receiveShadow = true;
    this.scene.add(leftWallHeader);

    // Main Hall Right Wall with doorway opening into right chamber
    const rightWallFront = new Object3D("SanctumRightWall_Front");
    rightWallFront.geometry = cubeGeom;
    rightWallFront.material = bandedSandstoneMat;
    rightWallFront.scale.set(0.6, 9.5, 4.5);
    rightWallFront.position.set(7.0, 5.75, -5.75);
    rightWallFront.castShadow = true;
    rightWallFront.receiveShadow = true;
    this.scene.add(rightWallFront);

    const rightWallRear = new Object3D("SanctumRightWall_Rear");
    rightWallRear.geometry = cubeGeom;
    rightWallRear.material = bandedSandstoneMat;
    rightWallRear.scale.set(0.6, 9.5, 4.5);
    rightWallRear.position.set(7.0, 5.75, -15.25);
    rightWallRear.castShadow = true;
    rightWallRear.receiveShadow = true;
    this.scene.add(rightWallRear);

    const rightWallHeader = new Object3D("SanctumRightWall_Header");
    rightWallHeader.geometry = cubeGeom;
    rightWallHeader.material = bandedSandstoneMat;
    rightWallHeader.scale.set(0.6, 4.5, 5.0);
    rightWallHeader.position.set(7.0, 8.25, -10.5);
    rightWallHeader.castShadow = true;
    rightWallHeader.receiveShadow = true;
    this.scene.add(rightWallHeader);

    // Main Hall Rear Wall with central portal opening into rear altar sanctuary ($Z = -17.5$)
    const rearWallLeft = new Object3D("SanctumRearWall_Left");
    rearWallLeft.geometry = cubeGeom;
    rearWallLeft.material = bandedSandstoneMat;
    rearWallLeft.scale.set(4.5, 9.5, 0.6);
    rearWallLeft.position.set(-4.75, 5.75, -17.5);
    rearWallLeft.castShadow = true;
    rearWallLeft.receiveShadow = true;
    this.scene.add(rearWallLeft);

    const rearWallRight = new Object3D("SanctumRearWall_Right");
    rearWallRight.geometry = cubeGeom;
    rearWallRight.material = bandedSandstoneMat;
    rearWallRight.scale.set(4.5, 9.5, 0.6);
    rearWallRight.position.set(4.75, 5.75, -17.5);
    rearWallRight.castShadow = true;
    rearWallRight.receiveShadow = true;
    this.scene.add(rearWallRight);

    const rearWallHeader = new Object3D("SanctumRearWall_Header");
    rearWallHeader.geometry = cubeGeom;
    rearWallHeader.material = bandedSandstoneMat;
    rearWallHeader.scale.set(5.0, 3.5, 0.6);
    rearWallHeader.position.set(0, 8.75, -17.5);
    rearWallHeader.castShadow = true;
    rearWallHeader.receiveShadow = true;
    this.scene.add(rearWallHeader);

    // 4 Wall Torches in the Main Hall Quadrants
    buildWallTorch("SanctumTorch_FL", -6.6, 3.8, -6.0, new Vector3D(1, 0, 0), 3.8, 12.0);
    buildWallTorch("SanctumTorch_FR", 6.6, 3.8, -6.0, new Vector3D(-1, 0, 0), 3.8, 12.0);
    buildWallTorch("SanctumTorch_RL", -6.6, 3.8, -15.0, new Vector3D(1, 0, 0), 3.8, 12.0);
    buildWallTorch("SanctumTorch_RR", 6.6, 3.8, -15.0, new Vector3D(-1, 0, 0), 3.8, 12.0);

    // Centerpiece: Grand Wrought-Iron Fire Brazier in Atrium Center
    buildFireBrazier("CenterBrazier", 0.0, 1.0, -10.5);

    // ------------------------------------------------------------------------
    // 14. Scene Construction: Rear Shrine & Holy of Holies ($Z \in [-23.5, -17.5]$)
    // ------------------------------------------------------------------------

    // Elevated Sanctuary Steps (3 steps leading up to Y=1.6)
    for (let s = 0; s < 3; s++) {
      const stepMesh = new Object3D(`ShrineStep_${s}`);
      stepMesh.geometry = cubeGeom;
      stepMesh.material = flagstoneMat;
      stepMesh.scale.set(4.6, 0.2, 0.6);
      stepMesh.position.set(0, 1.1 + s * 0.2, -17.2 - s * 0.6);
      stepMesh.receiveShadow = true;
      stepMesh.castShadow = true;
      this.scene.add(stepMesh);
    }

    // Rear Shrine Floor ($Y = 1.6$)
    const shrineFloor = new Object3D("ShrineFloor");
    shrineFloor.geometry = cubeGeom;
    shrineFloor.material = flagstoneMat;
    shrineFloor.scale.set(6.4, 0.2, 5.5);
    shrineFloor.position.set(0, 1.5, -20.5);
    shrineFloor.receiveShadow = true;
    this.scene.add(shrineFloor);

    // Rear Shrine Ceiling ($Y = 8.5$)
    const shrineCeiling = new Object3D("ShrineCeiling");
    shrineCeiling.geometry = cubeGeom;
    shrineCeiling.material = bandedSandstoneMat;
    shrineCeiling.scale.set(6.4, 0.2, 5.5);
    shrineCeiling.position.set(0, 8.6, -20.5);
    shrineCeiling.receiveShadow = true;
    this.scene.add(shrineCeiling);

    // Rear Shrine Walls
    const shrineWallBack = new Object3D("ShrineWallBack");
    shrineWallBack.geometry = cubeGeom;
    shrineWallBack.material = bandedSandstoneMat;
    shrineWallBack.scale.set(6.4, 7.0, 0.6);
    shrineWallBack.position.set(0, 5.1, -23.5);
    shrineWallBack.castShadow = true;
    shrineWallBack.receiveShadow = true;
    this.scene.add(shrineWallBack);

    const shrineWallLeft = new Object3D("ShrineWallLeft");
    shrineWallLeft.geometry = cubeGeom;
    shrineWallLeft.material = bandedSandstoneMat;
    shrineWallLeft.scale.set(0.6, 7.0, 5.5);
    shrineWallLeft.position.set(-3.2, 5.1, -20.5);
    shrineWallLeft.castShadow = true;
    shrineWallLeft.receiveShadow = true;
    this.scene.add(shrineWallLeft);

    const shrineWallRight = new Object3D("ShrineWallRight");
    shrineWallRight.geometry = cubeGeom;
    shrineWallRight.material = bandedSandstoneMat;
    shrineWallRight.scale.set(0.6, 7.0, 5.5);
    shrineWallRight.position.set(3.2, 5.1, -20.5);
    shrineWallRight.castShadow = true;
    shrineWallRight.receiveShadow = true;
    this.scene.add(shrineWallRight);

    // Monolithic Carved Nabataean Stone Altar Block (Betyl Shrine)
    const altarBase = new Object3D("AltarBase");
    altarBase.geometry = cubeGeom;
    altarBase.material = carvedMasonryMat;
    altarBase.scale.set(2.4, 0.45, 1.4);
    altarBase.position.set(0, 1.825, -21.8);
    altarBase.castShadow = true;
    altarBase.receiveShadow = true;
    this.scene.add(altarBase);

    const altarBlock = new Object3D("AltarBlock");
    altarBlock.geometry = cubeGeom;
    altarBlock.material = carvedMasonryMat;
    altarBlock.scale.set(1.8, 1.2, 1.0);
    altarBlock.position.set(0, 2.65, -21.8);
    altarBlock.castShadow = true;
    altarBlock.receiveShadow = true;
    this.scene.add(altarBlock);

    const altarBetyl = new Object3D("AltarBetyl");
    altarBetyl.geometry = pyramidGeom;
    altarBetyl.material = carvedMasonryMat;
    altarBetyl.scale.set(0.75, 1.1, 0.55);
    altarBetyl.position.set(0, 3.8, -21.8);
    altarBetyl.castShadow = true;
    this.scene.add(altarBetyl);

    // 2 Wall Torches flanking the Altar Niche
    buildWallTorch("ShrineTorch_Left", -2.8, 3.6, -21.5, new Vector3D(1, 0, 0), 3.5, 10.0);
    buildWallTorch("ShrineTorch_Right", 2.8, 3.6, -21.5, new Vector3D(-1, 0, 0), 3.5, 10.0);

    // ------------------------------------------------------------------------
    // 15. Scene Construction: Left & Right Ritual Side Chambers
    // ------------------------------------------------------------------------

    // Left Chamber ($X \in [-13.5, -7.0], Z \in [-14.0, -7.0]$)
    const leftRoomFloor = new Object3D("LeftRoomFloor");
    leftRoomFloor.geometry = cubeGeom;
    leftRoomFloor.material = flagstoneMat;
    leftRoomFloor.scale.set(6.5, 0.2, 7.0);
    leftRoomFloor.position.set(-10.25, 0.9, -10.5);
    leftRoomFloor.receiveShadow = true;
    this.scene.add(leftRoomFloor);

    const leftRoomCeiling = new Object3D("LeftRoomCeiling");
    leftRoomCeiling.geometry = cubeGeom;
    leftRoomCeiling.material = bandedSandstoneMat;
    leftRoomCeiling.scale.set(6.5, 0.2, 7.0);
    leftRoomCeiling.position.set(-10.25, 7.1, -10.5);
    leftRoomCeiling.receiveShadow = true;
    this.scene.add(leftRoomCeiling);

    const leftRoomOuterWall = new Object3D("LeftRoomOuterWall");
    leftRoomOuterWall.geometry = cubeGeom;
    leftRoomOuterWall.material = bandedSandstoneMat;
    leftRoomOuterWall.scale.set(0.6, 6.0, 7.0);
    leftRoomOuterWall.position.set(-13.5, 4.0, -10.5);
    leftRoomOuterWall.castShadow = true;
    leftRoomOuterWall.receiveShadow = true;
    this.scene.add(leftRoomOuterWall);

    const leftRoomBench = new Object3D("LeftRoomBench");
    leftRoomBench.geometry = cubeGeom;
    leftRoomBench.material = carvedMasonryMat;
    leftRoomBench.scale.set(1.2, 0.65, 5.5);
    leftRoomBench.position.set(-12.7, 1.325, -10.5);
    leftRoomBench.castShadow = true;
    leftRoomBench.receiveShadow = true;
    this.scene.add(leftRoomBench);

    buildWallTorch("LeftRoomTorch", -13.1, 3.2, -10.5, new Vector3D(1, 0, 0), 3.2, 9.0);

    // Right Chamber ($X \in [7.0, 13.5], Z \in [-14.0, -7.0]$)
    const rightRoomFloor = new Object3D("RightRoomFloor");
    rightRoomFloor.geometry = cubeGeom;
    rightRoomFloor.material = flagstoneMat;
    rightRoomFloor.scale.set(6.5, 0.2, 7.0);
    rightRoomFloor.position.set(10.25, 0.9, -10.5);
    rightRoomFloor.receiveShadow = true;
    this.scene.add(rightRoomFloor);

    const rightRoomCeiling = new Object3D("RightRoomCeiling");
    rightRoomCeiling.geometry = cubeGeom;
    rightRoomCeiling.material = bandedSandstoneMat;
    rightRoomCeiling.scale.set(6.5, 0.2, 7.0);
    rightRoomCeiling.position.set(10.25, 7.1, -10.5);
    rightRoomCeiling.receiveShadow = true;
    this.scene.add(rightRoomCeiling);

    const rightRoomOuterWall = new Object3D("RightRoomOuterWall");
    rightRoomOuterWall.geometry = cubeGeom;
    rightRoomOuterWall.material = bandedSandstoneMat;
    rightRoomOuterWall.scale.set(0.6, 6.0, 7.0);
    rightRoomOuterWall.position.set(13.5, 4.0, -10.5);
    rightRoomOuterWall.castShadow = true;
    rightRoomOuterWall.receiveShadow = true;
    this.scene.add(rightRoomOuterWall);

    const rightRoomBench = new Object3D("RightRoomBench");
    rightRoomBench.geometry = cubeGeom;
    rightRoomBench.material = carvedMasonryMat;
    rightRoomBench.scale.set(1.2, 0.65, 5.5);
    rightRoomBench.position.set(12.7, 1.325, -10.5);
    rightRoomBench.castShadow = true;
    rightRoomBench.receiveShadow = true;
    this.scene.add(rightRoomBench);

    buildWallTorch("RightRoomTorch", 13.1, 3.2, -10.5, new Vector3D(-1, 0, 0), 3.2, 9.0);

    // ------------------------------------------------------------------------
    // 16. Canyon Wind Audio
    // ------------------------------------------------------------------------
    if (this.audio) {
      try {
        await this.audio.load("canyon_wind", "./assets/canyon_wind.mp3");
        this.audio.playMusic("canyon_wind", true, 0.4);
      } catch (err: unknown) {
        console.warn("[Showcase38] Canyon wind audio autoplay:", err);
      }
    }

    // ------------------------------------------------------------------------
    // 17. HUD Overlay Initialization
    // ------------------------------------------------------------------------
    this._createHud();
  }

  private _setTimeOfDay(mode: TimeOfDay): void {
    this._timeOfDayMode = mode;
    if (mode === TimeOfDay.MIDDAY) {
      // Midday sun: intense, high angle, clear skies
      this._sunLight.direction.set(0.2, -0.92, -0.32).normalize();
      this._sunLight.color.set(1.0, 0.96, 0.88);
      this._sunLight.intensity = 3.5;
      this._ambientLight.color.set(0.25, 0.2, 0.16);
      this._ambientLight.intensity = 0.4;
      this._fog.color.set(0.65, 0.5, 0.35);
      this._fog.density = 0.004;
      if (this._toneMapping) this._toneMapping.exposure = 1.0;
      if (this._colorGrading) {
        this._colorGrading.temperature = 0.12;
        this._colorGrading.saturation = 1.02;
        this._colorGrading.contrast = 1.05;
      }
    } else if (mode === TimeOfDay.MIDNIGHT) {
      // Midnight starlight: dark desert night with glowing torchlight
      this._sunLight.direction.set(0.4, -0.7, -0.6).normalize();
      this._sunLight.color.set(0.08, 0.12, 0.22);
      this._sunLight.intensity = 0.12;
      this._ambientLight.color.set(0.02, 0.02, 0.04);
      this._ambientLight.intensity = 0.08;
      this._fog.color.set(0.05, 0.06, 0.1);
      this._fog.density = 0.008;
      if (this._toneMapping) this._toneMapping.exposure = 1.45;
      if (this._colorGrading) {
        this._colorGrading.temperature = -0.15;
        this._colorGrading.saturation = 1.15;
        this._colorGrading.contrast = 1.12;
      }
    } else {
      // Golden hour: warm low sun slicing through canyon
      this._sunLight.direction.set(0.55, -0.65, -0.52).normalize();
      this._sunLight.color.set(1.0, 0.88, 0.72);
      this._sunLight.intensity = 2.8;
      this._ambientLight.color.set(0.18, 0.12, 0.08);
      this._ambientLight.intensity = 0.25;
      this._fog.color.set(0.55, 0.35, 0.22);
      this._fog.density = 0.006;
      if (this._toneMapping) this._toneMapping.exposure = 1.15;
      if (this._colorGrading) {
        this._colorGrading.temperature = 0.32;
        this._colorGrading.saturation = 1.05;
        this._colorGrading.contrast = 1.08;
      }
    }

    this._updateHud();
  }

  private _inspectorBtn?: HTMLButtonElement;

  private _toggleInspector(force?: boolean): void {
    if (!this._hudElement) return;
    const isCurrentlyOpen = this._hudElement.classList.contains("open");
    const open = undefined !== force ? force : !isCurrentlyOpen;
    if (open) {
      this._hudElement.classList.add("open");
      this._inspectorBtn?.classList.add("active");
    } else {
      this._hudElement.classList.remove("open");
      this._inspectorBtn?.classList.remove("active");
    }
  }

  private _createHud(): void {
    const existingHud = document.getElementById("petra-hud");
    if (existingHud) existingHud.remove();
    const existingBtn = document.getElementById("petraInspectorBtn");
    if (existingBtn) existingBtn.remove();
    const existingStyle = document.getElementById("petraHudStyle");
    if (existingStyle) existingStyle.remove();

    const hud = document.createElement("aside");
    hud.id = "petra-hud";
    hud.className = "swm-inspector-drawer";
    document.body.appendChild(hud);
    this._hudElement = hud;

    // Stop events from leaking to camera controllers
    const stopEvents = [
      "mousedown",
      "mouseup",
      "mousemove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "click",
      "dblclick",
      "contextmenu",
    ];
    for (const ev of stopEvents) {
      hud.addEventListener(
        ev,
        (e) => {
          e.stopPropagation();
        },
        { passive: "wheel" === ev || "touchstart" === ev || "touchmove" === ev },
      );
    }

    // Footer toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "petraInspectorBtn";
    toggleBtn.className = "swm-inspector-btn";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Settings (Toggle)";
    toggleBtn.setAttribute("aria-label", "Toggle Inspector");
    toggleBtn.onclick = (): void => {
      this._toggleInspector();
    };
    this._inspectorBtn = toggleBtn;

    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(toggleBtn);
    } else {
      document.body.appendChild(toggleBtn);
    }

    this._updateHud();
  }

  private _updateHud(): void {
    if (!this._hudElement) return;
    this._hudElement.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title">
          <span>🏛️</span> Al-Khazneh — Petra
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">Petra Lab</span>
          <button id="petraHudClose" class="hud-close-btn" title="Close Inspector">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <div class="hud-section">
          <div class="section-title">⚙️ Atmosphere & Audio</div>
          <div class="hud-row">
            <label for="selTimeOfDay">Time of Day</label>
            <select id="selTimeOfDay">
              <option value="${TimeOfDay.GOLDEN_HOUR}" ${this._timeOfDayMode === TimeOfDay.GOLDEN_HOUR ? "selected" : ""}>Golden Hour</option>
              <option value="${TimeOfDay.MIDDAY}" ${this._timeOfDayMode === TimeOfDay.MIDDAY ? "selected" : ""}>Midday Sun</option>
              <option value="${TimeOfDay.MIDNIGHT}" ${this._timeOfDayMode === TimeOfDay.MIDNIGHT ? "selected" : ""}>Midnight Starlight</option>
            </select>
          </div>
          <div class="hud-row">
            <label for="swFlicker">Flame Flicker</label>
            <label class="hud-switch">
              <input type="checkbox" id="swFlicker" ${this._flickerEnabled ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row">
            <label for="swAudio">Canyon Wind Audio</label>
            <label class="hud-switch">
              <input type="checkbox" id="swAudio" ${!this._audioMuted ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title">📍 Camera Positions</div>
          <div class="preset-group">
            <button class="btn-preset ${this._activePresetIdx === 0 ? "active" : ""}" data-cam="0">Siq Gorge</button>
            <button class="btn-preset ${this._activePresetIdx === 1 ? "active" : ""}" data-cam="1">Plaza</button>
            <button class="btn-preset ${this._activePresetIdx === 2 ? "active" : ""}" data-cam="2">Portico</button>
            <button class="btn-preset ${this._activePresetIdx === 3 ? "active" : ""}" data-cam="3">Sanctum</button>
            <button class="btn-preset ${this._activePresetIdx === 4 ? "active" : ""}" data-cam="4">Shrine</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById("petraHudClose")?.addEventListener("click", () => {
      this._toggleInspector(false);
    });

    // Dropdown change listener
    document.getElementById("selTimeOfDay")?.addEventListener("change", (e) => {
      const mode = (e.target as HTMLSelectElement).value as TimeOfDay;
      this._setTimeOfDay(mode);
    });

    // Switch listeners
    document.getElementById("swFlicker")?.addEventListener("change", (e) => {
      this._flickerEnabled = (e.target as HTMLInputElement).checked;
    });

    document.getElementById("swAudio")?.addEventListener("change", (e) => {
      this._audioMuted = !(e.target as HTMLInputElement).checked;
      if (this.audio) {
        this.audio.setMusicVolume(this._audioMuted ? 0.0 : 0.4);
      }
    });

    // Preset button click listeners
    this._hudElement.querySelectorAll<HTMLButtonElement>("button[data-cam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const camIdx = parseInt(btn.dataset["cam"] ?? "0", 10);
        const preset = this._cameraPresets[camIdx];
        if (preset) {
          this._activePresetIdx = camIdx;
          this.setInitialCamera(preset.position, preset.target);
          this._updateHud();
        }
      });
    });
  }

  public override destroy(): void {
    this._goldenCapture?.dispose();
    if (this._hudElement && this._hudElement.parentNode) {
      this._hudElement.parentNode.removeChild(this._hudElement);
    }
    if (this._inspectorBtn && this._inspectorBtn.parentNode) {
      this._inspectorBtn.parentNode.removeChild(this._inspectorBtn);
    }
    const style = document.getElementById("petraHudStyle");
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
    super.destroy();
  }
}

const app = new Showcase38({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase38] Failed to start:", err));
