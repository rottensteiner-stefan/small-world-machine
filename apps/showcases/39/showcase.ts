import type {
  BloomElement,
  EngineOptions,
  HbaoElement,
  ToneMappingElement,
  VignetteElement,
  VolumetricFogElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  CatmullRomSpline,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  FlyController,
  FogVolume,
  FogVolumeShape,
  Keys,
  Object3D,
  OrbitController,
  Plane,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  Sphere,
  StandardMaterial,
  Texture,
  TextureWrap,
  ToneMappingMode,
  Vector2D,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";
import { GoldenCapture, parseGoldenSpec } from "./GoldenCapture.js";

interface CameraPreset {
  readonly name: string;
  readonly position: Vector3D;
  readonly target: Vector3D;
}

/**
 * Showcase 39: "Atmospheric Sanctum: Volumetric Froxel Fog & Interior Carving"
 *
 * Demonstrates the complete Small World Machine Froxel Volumetric Fog architecture:
 * 1. True 3D Froxel grid with in-register optical depth integration and 3D temporal reprojection (WebGPU)
 *    and half-resolution cross-bilateral raymarching (WebGL2 fallback).
 * 2. Cascaded Directional Light Shadows (CSM) projecting razor-sharp, self-shadowed light shafts
 *    through high architectural clerestory skylights.
 * 3. Analytical FogVolume nodes:
 *    - Positive glowing mist volume (Cylinder) with animated 3D procedural noise around the altar.
 *    - Negative density carving volume (Box, density = -1.2) carving crystal-clear space inside
 *      the rear vaulted meditation chamber despite the heavy surrounding atmospheric fog.
 *    - Incense brazier localized sphere mist with warm orange emission.
 * 4. Interactive runtime controls:
 *    - [F]: Toggle Volumetric Fog on/off
 *    - [C]: Toggle Negative Density Carving on/off
 *    - [N]: Toggle 3D Procedural Rolling Mist on/off
 *    - [1] / [2]: Switch Sun Angle (High Noon vs. Low Dramatic Golden Angle)
 *    - [V]: Switch Camera Navigation (Orbit vs. Free-Fly)
 */
class Showcase39 extends AbstractShowcase {
  private _sunLight!: DirectionalLight;
  private _ambientLight!: AmbientLight;
  private _altarLight!: PointLight;
  private _brazierLight!: PointLight;
  private _chamberLight!: PointLight;

  private _fogElement: VolumetricFogElement | undefined = undefined;
  private _altarMistVolume!: FogVolume;
  private _chamberCarverVolume!: FogVolume;
  private _brazierMistVolume!: FogVolume;
  private _skylightMistVolume!: FogVolume;
  private _shrineRelic!: Object3D;
  private _baseGodRayStrength = 3.8;

  private _leylineActive = true;
  private _leylineSpline!: CatmullRomSpline;
  private _leylineOrb!: Object3D;
  private _leylineLight!: PointLight;
  private readonly _leylineMotes: Object3D[] = [];

  private _orbitController?: OrbitController;
  private _flyController?: FlyController;
  private _isFlyMode = true;
  private _activePresetIdx = 0;
  private _orbitPivot = new Vector3D(0, 2.5, -4);
  private _isHoveringHud = false;
  private _isDraggingHud = false;

  private readonly _cameraPresets: CameraPreset[] = [
    {
      name: "Nave",
      position: new Vector3D(0, 4.5, 22),
      target: new Vector3D(0, 2.5, -4),
    },
    {
      name: "Altar",
      position: new Vector3D(4.2, 2.6, 3.5),
      target: new Vector3D(0, 1.6, -4.5),
    },
    {
      name: "Portal",
      position: new Vector3D(0, 2.8, -11.5),
      target: new Vector3D(0, 2.4, -21.0),
    },
    {
      name: "Carved Room",
      position: new Vector3D(2.4, 2.4, -18.5),
      target: new Vector3D(0, 1.8, -21.5),
    },
  ];

  private _sunMode: 1 | 2 = 2;
  private _time = 0;
  private _goldenCapture: GoldenCapture | undefined;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      quality: {
        maxPixelRatio: 1.5,
        clusteredLighting: {
          tileSize: [8, 8],
          zSlices: 64,
        },
      },
      ...options,
    });
  }

  /**
   * Runs the regular showcase boot, then -- only when the golden query parameters are present --
   * the deterministic per-preset capture on top of the fully-ready scene (see GoldenCapture.ts).
   */
  public override async start(): Promise<void> {
    const golden = parseGoldenSpec();
    await super.start();
    if (golden) {
      this._goldenCapture = new GoldenCapture(this, {
        resetClock: (): void => {
          this._time = 0;
        },
        applyPreset: (index: number): void => {
          this._applyCameraPreset(index, true);
        },
      });
      await this._goldenCapture.run(golden);
    }
  }

  public override destroy(): void {
    this._goldenCapture?.dispose();
    super.destroy();
  }

  protected override onCanvasRecreated(): void {
    // Keep cursor unlocked on click so drag-look and HUD interaction stay frictionless.
  }

  protected override async setupScene(): Promise<void> {
    // --- 1. Cinematic Post-Processing Pipeline ---
    this.renderer.postProcessing.enabled = true;

    // ACES Filmic Tone Mapping for crisp contrast in light shafts
    const toneMapping = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    if (toneMapping) {
      toneMapping.enabled = true;
      toneMapping.mode = ToneMappingMode.ACES_FILMIC;
      toneMapping.exposure = 1.15;
      toneMapping.gamma = 2.2;
    }

    // Atmospheric Bloom for soft solar glare around skylights and glowing altar mist
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.55;
      bloom.threshold = 0.85;
      bloom.softThreshold = 0.3;
      bloom.radius = 1.2;
    }

    // Horizon-Based Ambient Occlusion (HBAO)
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 1.0;
      hbao.intensity = 1.5;
    }

    // Vignette
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      vignette.darkness = 0.65;
      vignette.offset = 0.6;
    }

    // --- 2. Froxel Volumetric Fog Configuration ---
    this._fogElement = this.renderer.postProcessing.get<VolumetricFogElement>(
      PostProcessingEffectType.VOLUMETRIC_FOG,
    );
    if (this._fogElement) {
      this._fogElement.enabled = true;
      this._fogElement.density = 0.024;
      this._fogElement.intensity = 1.05;
      this._fogElement.ambientInject = 0.16;
      this._fogElement.height = 0.0;
      this._fogElement.heightFalloff = 0.03;
      this._fogElement.asymmetry = 0.6; // Forward Mie scattering for god rays
      this._fogElement.color = new Color(0.96, 0.97, 1.0);
      this._fogElement.castDirectionalShadow = true;
      this._fogElement.maxDistance = 65.0;
      this._fogElement.jitter = 0.25;
    }

    // --- 3. Camera Setup & Strategy ---
    this.defaultFov = (58 * Math.PI) / 180;
    this.defaultNear = 0.5;
    this.defaultFar = 85.0;
    this.configureCamera();

    this._flyController = new FlyController({
      input: this.input,
      moveSpeed: 8.0,
      fastMultiplier: 2.5,
      slowMultiplier: 0.35,
      lookSensitivity: 0.004,
      enableVertical: true,
      flyInLookDirection: true,
    });
    this.camera.addBehavior(this._flyController);

    this._orbitController = new OrbitController({
      input: this.input,
    });
    this._orbitController.enabled = false;
    this.camera.addBehavior(this._orbitController);

    this._applyCameraPreset(0, true);

    // --- 4. PBR Texture Sets & Architectural Materials ---
    const wrapRepeat = {
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
    };

    const [
      floorAlbedo,
      floorNormal,
      floorOrm,
      marbleAlbedo,
      marbleNormal,
      marbleOrm,
      basaltAlbedo,
      basaltNormal,
      basaltOrm,
      goldAlbedo,
      goldNormal,
      goldOrm,
      ashlarAlbedo,
      ashlarNormal,
      ashlarOrm,
      carvedAlbedo,
      carvedNormal,
      carvedRough,
    ] = await Promise.all([
      Texture.fromUrl("./assets/sanctum_floor_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/sanctum_floor_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/sanctum_floor_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/cathedral_marble_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/cathedral_marble_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/cathedral_marble_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/volcanic_basalt_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/volcanic_basalt_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/volcanic_basalt_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/sacred_gold_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/sacred_gold_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/sacred_gold_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/sanctum_ashlar_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/sanctum_ashlar_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/sanctum_ashlar_roughness.webp", wrapRepeat),
      Texture.fromUrl("../38/assets/carved_masonry_albedo.png", wrapRepeat),
      Texture.fromUrl("../38/assets/carved_masonry_normal.png", wrapRepeat),
      Texture.fromUrl("../38/assets/carved_masonry_roughness.png", wrapRepeat),
      this.loadIbl("../27/assets/ibl", 0.25),
    ]);

    // 4x4m square Opus-Sectile stone & terracotta-porphyry tiles across the 36x64m nave floor
    floorAlbedo.repeat = { x: 9, y: 16 };
    floorNormal.repeat = { x: 9, y: 16 };
    floorOrm.repeat = { x: 9, y: 16 };

    // Fluted Botticino/Calacatta marble with smoky & gold veins along the 12 colonnade pillars
    marbleAlbedo.repeat = { x: 2, y: 4 };
    marbleNormal.repeat = { x: 2, y: 4 };
    marbleOrm.repeat = { x: 2, y: 4 };

    // Obsidian basalt with gold-pyrite veins for dais steps, vault ribs, and tracery mullions
    basaltAlbedo.repeat = { x: 3, y: 3 };
    basaltNormal.repeat = { x: 3, y: 3 };
    basaltOrm.repeat = { x: 3, y: 3 };

    // Hammered antique bronze & 24K gold rosette filigree for the Altar and Relic Shrine
    goldAlbedo.repeat = { x: 2, y: 2 };
    goldNormal.repeat = { x: 2, y: 2 };
    goldOrm.repeat = { x: 2, y: 2 };

    // Monumental Gothic cathedral stone ashlar for outer nave walls and clerestory ceilings
    ashlarAlbedo.repeat = { x: 8, y: 2.5 };
    ashlarNormal.repeat = { x: 8, y: 2.5 };
    ashlarOrm.repeat = { x: 8, y: 2.5 };

    // Crisp carved terracotta-sandstone masonry for the zero-fog rear meditation chamber
    carvedAlbedo.repeat = { x: 3, y: 2 };
    carvedNormal.repeat = { x: 3, y: 2 };
    carvedRough.repeat = { x: 3, y: 2 };

    const stoneFloorMat = new StandardMaterial({
      color: new Color(0.95, 0.94, 0.92),
      diffuseMap: floorAlbedo,
      normalMap: floorNormal,
      normalScale: new Vector2D(1.15, 1.15),
      roughnessMap: floorOrm,
      metallicMap: floorOrm,
      aoMap: floorOrm,
      roughness: 0.95,
      metallic: 1.0,
    });

    const pillarMat = new StandardMaterial({
      color: new Color(0.96, 0.94, 0.9),
      diffuseMap: marbleAlbedo,
      normalMap: marbleNormal,
      normalScale: new Vector2D(1.2, 1.2),
      roughnessMap: marbleOrm,
      metallicMap: marbleOrm,
      aoMap: marbleOrm,
      roughness: 0.9,
      metallic: 1.0,
    });

    const darkBasaltMat = new StandardMaterial({
      color: new Color(0.92, 0.94, 0.98),
      diffuseMap: basaltAlbedo,
      normalMap: basaltNormal,
      normalScale: new Vector2D(1.1, 1.1),
      roughnessMap: basaltOrm,
      metallicMap: basaltOrm,
      aoMap: basaltOrm,
      roughness: 0.9,
      metallic: 1.0,
    });

    const goldTrimMat = new StandardMaterial({
      color: new Color(1.0, 0.94, 0.82),
      diffuseMap: goldAlbedo,
      normalMap: goldNormal,
      normalScale: new Vector2D(1.25, 1.25),
      roughnessMap: goldOrm,
      metallicMap: goldOrm,
      aoMap: goldOrm,
      roughness: 0.85,
      metallic: 1.0,
    });

    const hallWallMat = new StandardMaterial({
      color: new Color(0.88, 0.85, 0.82),
      diffuseMap: ashlarAlbedo,
      normalMap: ashlarNormal,
      normalScale: new Vector2D(1.3, 1.3),
      roughnessMap: ashlarOrm,
      aoMap: ashlarOrm,
      roughness: 0.95,
      metallic: 0.04,
    });

    const chamberWallMat = new StandardMaterial({
      color: new Color(0.76, 0.66, 0.58),
      diffuseMap: carvedAlbedo,
      normalMap: carvedNormal,
      normalScale: new Vector2D(1.35, 1.35),
      roughnessMap: carvedRough,
      roughness: 0.85,
      metallic: 0.02,
    });

    // Helper: Box mesh
    const createBox = (
      name: string,
      sx: number,
      sy: number,
      sz: number,
      mat: StandardMaterial,
    ): Object3D => {
      const obj = new Object3D(name);
      obj.geometry = new Cube({ size: 1 }).getGeometryData();
      obj.scale.set(sx, sy, sz);
      obj.material = mat;
      return obj;
    };

    // Helper: Cylinder mesh
    const createCylinder = (
      name: string,
      radius: number,
      height: number,
      mat: StandardMaterial,
    ): Object3D => {
      const obj = new Object3D(name);
      obj.geometry = new Cylinder({
        radiusTop: radius,
        radiusBottom: radius,
        height,
        radialSegments: 24,
      }).getGeometryData();
      obj.material = mat;
      return obj;
    };

    // --- 5. Scene Architecture & Geometry ---
    // Ground floor
    const floor = new Object3D("SanctumFloor");
    floor.geometry = new Plane({ width: 36, height: 64 }).getGeometryData();
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.material = stoneFloorMat;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // High clerestory ceiling slabs (solid boxes so CSM shadows block all light outside the central skylight)
    const ceilingLeft = createBox("CeilingLeft", 14.0, 0.8, 64.0, hallWallMat);
    ceilingLeft.position.set(-11, 10.4, 0);
    ceilingLeft.castShadow = true;
    ceilingLeft.receiveShadow = true;
    this.scene.add(ceilingLeft);

    const ceilingRight = createBox("CeilingRight", 14.0, 0.8, 64.0, hallWallMat);
    ceilingRight.position.set(11, 10.4, 0);
    ceilingRight.castShadow = true;
    ceilingRight.receiveShadow = true;
    this.scene.add(ceilingRight);

    // Solid roof slab over the rear section (Z < -15) and front vestibule (Z > 16) so light only enters through the nave skylight bays
    const ceilingRear = createBox("CeilingRear", 10.0, 0.8, 18.0, hallWallMat);
    ceilingRear.position.set(0, 10.4, -23.0);
    ceilingRear.castShadow = true;
    this.scene.add(ceilingRear);

    const ceilingFront = createBox("CeilingFront", 10.0, 0.8, 16.0, hallWallMat);
    ceilingFront.position.set(0, 10.4, 24.0);
    ceilingFront.castShadow = true;
    this.scene.add(ceilingFront);

    // Longitudinal skylight tracery mullions running along the nave (Z): these slice diagonal sunlight
    // into coherent 3D curtains of light & shadow aligned with the viewer's sightlines!
    for (const mx of [-2.7, -0.9, 0.9, 2.7]) {
      const mullion = createBox(`SkylightMullion_${mx}`, 0.65, 1.1, 32.0, darkBasaltMat);
      mullion.position.set(mx, 9.75, -1.0);
      mullion.castShadow = true;
      this.scene.add(mullion);
    }

    // Colonnade Pillars along the grand central nave
    const numPillars = 6;
    for (let i = 0; i < numPillars; i++) {
      const z = 14 - i * 6.0;

      // Left column
      const colL = createCylinder(`ColL_${i}`, 0.65, 10.0, pillarMat);
      colL.position.set(-5.5, 5.0, z);
      colL.castShadow = true;
      colL.receiveShadow = true;
      this.scene.add(colL);

      // Right column
      const colR = createCylinder(`ColR_${i}`, 0.65, 10.0, pillarMat);
      colR.position.set(5.5, 5.0, z);
      colR.castShadow = true;
      colR.receiveShadow = true;
      this.scene.add(colR);

      // Side-aisle vault ribs connecting outer walls to the colonnade pillars (leaving the central
      // skylight tracery bays unobstructed along Z so diagonal God Ray curtains stream cleanly)
      const archL = createBox(`ArchL_${i}`, 6.5, 0.8, 0.9, darkBasaltMat);
      archL.position.set(-8.5, 9.6, z);
      archL.castShadow = true;
      this.scene.add(archL);

      const archR = createBox(`ArchR_${i}`, 6.5, 0.8, 0.9, darkBasaltMat);
      archR.position.set(8.5, 9.6, z);
      archR.castShadow = true;
      this.scene.add(archR);
    }

    // Outer Hall Side Walls
    const wallLeft = createBox("WallLeft", 1.0, 10.0, 64.0, hallWallMat);
    wallLeft.position.set(-18, 5, 0);
    wallLeft.castShadow = true;
    wallLeft.receiveShadow = true;
    this.scene.add(wallLeft);

    const wallRight = createBox("WallRight", 1.0, 10.0, 64.0, hallWallMat);
    wallRight.position.set(18, 5, 0);
    wallRight.castShadow = true;
    wallRight.receiveShadow = true;
    this.scene.add(wallRight);

    // Rear Cathedral Outer Wall (closes the building behind the meditation chamber so no stray light leaks in)
    const rearOuterWall = createBox("RearOuterWall", 36.0, 11.0, 1.0, hallWallMat);
    rearOuterWall.position.set(0, 5.5, -26.5);
    rearOuterWall.castShadow = true;
    rearOuterWall.receiveShadow = true;
    this.scene.add(rearOuterWall);

    // Front Entrance Arch
    const frontWallLeft = createBox("FrontWallLeft", 12.0, 10.0, 1.0, hallWallMat);
    frontWallLeft.position.set(-12, 5, 26);
    frontWallLeft.castShadow = true;
    this.scene.add(frontWallLeft);

    const frontWallRight = createBox("FrontWallRight", 12.0, 10.0, 1.0, hallWallMat);
    frontWallRight.position.set(12, 5, 26);
    frontWallRight.castShadow = true;
    this.scene.add(frontWallRight);

    // --- 6. Central Altar Dais ---
    const daisStep1 = createCylinder("DaisStep1", 5.0, 0.3, darkBasaltMat);
    daisStep1.position.set(0, 0.15, -4);
    daisStep1.receiveShadow = true;
    this.scene.add(daisStep1);

    const daisStep2 = createCylinder("DaisStep2", 3.6, 0.3, darkBasaltMat);
    daisStep2.position.set(0, 0.45, -4);
    daisStep2.receiveShadow = true;
    this.scene.add(daisStep2);

    const altarBlock = createBox("AltarBlock", 2.2, 1.2, 1.4, goldTrimMat);
    altarBlock.position.set(0, 1.2, -4);
    altarBlock.castShadow = true;
    altarBlock.receiveShadow = true;
    this.scene.add(altarBlock);

    // --- 7. Rear Enclosed Meditation Chamber (For Negative Density Carving Demo) ---
    // A fully enclosed room at the back (Z = -22) with a doorway arch.
    const chamberBackWall = createBox("ChamberBackWall", 14.0, 8.0, 1.0, chamberWallMat);
    chamberBackWall.position.set(0, 4.0, -26);
    chamberBackWall.castShadow = true;
    chamberBackWall.receiveShadow = true;
    this.scene.add(chamberBackWall);

    const chamberLeftWall = createBox("ChamberLeftWall", 1.0, 8.0, 10.0, chamberWallMat);
    chamberLeftWall.position.set(-6.5, 4.0, -21);
    chamberLeftWall.castShadow = true;
    chamberLeftWall.receiveShadow = true;
    this.scene.add(chamberLeftWall);

    const chamberRightWall = createBox("ChamberRightWall", 1.0, 8.0, 10.0, chamberWallMat);
    chamberRightWall.position.set(6.5, 4.0, -21);
    chamberRightWall.castShadow = true;
    chamberRightWall.receiveShadow = true;
    this.scene.add(chamberRightWall);

    const chamberCeiling = createBox("ChamberCeiling", 14.0, 0.8, 10.0, chamberWallMat);
    chamberCeiling.position.set(0, 8.0, -21);
    chamberCeiling.castShadow = true;
    this.scene.add(chamberCeiling);

    // Front portal of meditation chamber with doorway opening
    const portalLeft = createBox("PortalLeft", 4.5, 8.0, 1.0, chamberWallMat);
    portalLeft.position.set(-4.5, 4.0, -16);
    portalLeft.castShadow = true;
    this.scene.add(portalLeft);

    const portalRight = createBox("PortalRight", 4.5, 8.0, 1.0, chamberWallMat);
    portalRight.position.set(4.5, 4.0, -16);
    portalRight.castShadow = true;
    this.scene.add(portalRight);

    const portalLintel = createBox("PortalLintel", 5.0, 3.2, 1.0, darkBasaltMat);
    portalLintel.position.set(0, 6.4, -16);
    portalLintel.castShadow = true;
    this.scene.add(portalLintel);

    // An inner relic shrine inside the carved room
    const shrinePedestal = createCylinder("ShrinePedestal", 0.8, 1.6, goldTrimMat);
    shrinePedestal.position.set(0, 0.8, -21);
    shrinePedestal.castShadow = true;
    this.scene.add(shrinePedestal);

    const shrineRelic = new Object3D("ShrineRelic");
    shrineRelic.geometry = new Sphere({
      radius: 0.4,
      widthSegments: 24,
      heightSegments: 24,
    }).getGeometryData();
    shrineRelic.material = goldTrimMat;
    shrineRelic.position.set(0, 2.0, -21);
    shrineRelic.castShadow = true;
    this._shrineRelic = shrineRelic;
    this.scene.add(shrineRelic);

    // --- 8. FogVolume Nodes (Option R Phase 3 & 5) ---

    // A. Positive Localized Mist Volume (Swirling Cyan Mist over Central Altar with 3D Noise)
    this._altarMistVolume = new FogVolume({
      name: "AltarMysticMist",
      shape: FogVolumeShape.CYLINDER,
      size: new Vector3D(4.2, 2.8, 4.2),
      density: 0.9,
      edgeFade: 0.35,
      albedo: new Color(0.18, 0.95, 0.78),
      emission: new Color(0.04, 0.5, 0.38),
      emissionIntensity: 1.4,
      noiseScale: 0.75,
      noiseAmount: 0.7,
      noiseSpeed: 0.35,
    });
    this._altarMistVolume.position.set(0, 1.5, -4);
    this.scene.add(this._altarMistVolume);

    // B. Negative Density Carving Volume (Clears Fog out of Rear Meditation Chamber)
    this._chamberCarverVolume = new FogVolume({
      name: "ChamberInteriorCarver",
      shape: FogVolumeShape.BOX,
      size: new Vector3D(5.8, 4.0, 5.0),
      density: -1.2, // Negative density cleanses fog to 0.0!
      edgeFade: 0.15,
    });
    this._chamberCarverVolume.position.set(0, 4.0, -21);
    this.scene.add(this._chamberCarverVolume);

    // C. Incense Brazier Localized Mist (Warm Amber Sphere)
    const brazierStand = createCylinder("BrazierStand", 0.4, 1.8, darkBasaltMat);
    brazierStand.position.set(-4.5, 0.9, 4.0);
    brazierStand.castShadow = true;
    this.scene.add(brazierStand);

    this._brazierMistVolume = new FogVolume({
      name: "IncenseBrazierMist",
      shape: FogVolumeShape.SPHERE,
      size: new Vector3D(2.4, 2.4, 2.4),
      density: 0.75,
      edgeFade: 0.4,
      albedo: new Color(1.0, 0.65, 0.25),
      emission: new Color(0.85, 0.35, 0.08),
      emissionIntensity: 2.2,
      noiseScale: 0.9,
      noiseAmount: 0.8,
      noiseSpeed: 0.45,
    });
    this._brazierMistVolume.position.set(-4.5, 2.2, 4.0);
    this.scene.add(this._brazierMistVolume);

    // D. Clerestory Skylight Dust & Mist Volume (Wind-drifting 3D turbulence inside the upper God Ray shafts)
    this._skylightMistVolume = new FogVolume({
      name: "SkylightDustCurrents",
      shape: FogVolumeShape.BOX,
      size: new Vector3D(5.5, 3.8, 15.0),
      density: 0.045,
      edgeFade: 0.45,
      albedo: new Color(1.0, 0.96, 0.88),
      noiseScale: 0.38,
      noiseAmount: 0.75,
      noiseSpeed: 0.35,
    });
    this._skylightMistVolume.position.set(0, 5.8, -1.0);
    this.scene.add(this._skylightMistVolume);

    // --- 9. Dynamic Lights & CSM Cascades ---
    this._ambientLight = new AmbientLight({
      color: new Color(0.18, 0.22, 0.28),
      intensity: 0.35,
    });
    this.scene.add(this._ambientLight);

    this._sunLight = new DirectionalLight({
      color: new Color(1.0, 0.94, 0.86),
      intensity: 2.8,
      castShadow: true,
      numCascades: 4,
    });
    this._sunLight.cascadeSplits = [6.0, 16.0, 32.0, 65.0];
    this._sunLight.shadowBias = 0.0012;
    this._updateSunAngle();
    this.scene.add(this._sunLight);

    // Warm Altar point light illuminating the mystic mist
    this._altarLight = new PointLight({
      color: new Color(0.15, 0.95, 0.75),
      intensity: 1.8,
      distance: 9.0,
      volumetricIntensity: 6.0, // makes the altar glow visibly scatter in the fog (WebGPU and WebGL2)
    });
    this._altarLight.position.set(0, 1.8, -4);
    this.scene.add(this._altarLight);

    // Brazier ember point light
    this._brazierLight = new PointLight({
      color: new Color(1.0, 0.55, 0.15),
      intensity: 2.2,
      distance: 8.0,
      volumetricIntensity: 6.0, // makes the brazier glow visibly scatter in the fog (WebGPU and WebGL2)
    });
    this._brazierLight.position.set(-4.5, 2.1, 4.0);
    this.scene.add(this._brazierLight);

    // Warm relic light inside the carved meditation chamber. The chamber sits beyond every other
    // light (z = -21 vs. altar z = -4 / brazier z = 4), so without a local source it stays a dark
    // void and the Interior Carving toggle can never be seen. With carving ON the room now reads
    // as a lit, clear interior; with carving OFF the surrounding fog scatters this glow into a
    // warm veil that hides the relic behind its beam (the carve bounds stop just outside the
    // doorway, so a candle glow still spills into the nave fog for atmosphere).
    this._chamberLight = new PointLight({
      color: new Color(1.0, 0.74, 0.46),
      intensity: 2.4,
      distance: 9.0,
      volumetricIntensity: 3.2, // scatters in the fog once carving is disabled
    });
    this._chamberLight.position.set(0, 3.4, -21);
    this.scene.add(this._chamberLight);

    // --- 10. Mystic Leyline Stream (Catmull-Rom Energy Beam & Motes) ---
    const leylinePoints = [
      new Vector3D(0.0, 2.0, -21.0), // Starts at Relic in Crypt
      new Vector3D(0.0, 2.5, -16.5), // Glides toward Crypt door
      new Vector3D(0.0, 2.9, -13.5), // Centers through portal arch
      new Vector3D(1.4, 3.4, -9.0), // High energetic curve in Nave
      new Vector3D(0.7, 2.8, -6.5), // Dipping toward Altar dais
      new Vector3D(0.0, 1.9, -4.0), // Swirls into Altar bowl
    ];
    this._leylineSpline = new CatmullRomSpline(leylinePoints);

    const orbMat = new StandardMaterial({
      color: new Color(0.25, 0.98, 0.88),
      emissiveColor: new Color(0.18, 0.95, 0.82),
      emissiveIntensity: 6.0,
      roughness: 0.1,
    });

    const sphereGeo = new Sphere({
      radius: 0.14,
      widthSegments: 16,
      heightSegments: 16,
    }).getGeometryData();

    this._leylineOrb = new Object3D("LeylineOrb");
    this._leylineOrb.geometry = sphereGeo;
    this._leylineOrb.material = orbMat;
    this.scene.add(this._leylineOrb);

    this._leylineLight = new PointLight({
      color: new Color(0.2, 0.95, 0.82),
      intensity: 2.4,
      distance: 8.0,
      volumetricIntensity: 4.5, // lights up surrounding volumetric fog!
    });
    this.scene.add(this._leylineLight);

    const moteGeo = new Sphere({
      radius: 0.055,
      widthSegments: 10,
      heightSegments: 10,
    }).getGeometryData();

    const NUM_MOTES = 24;
    for (let i = 0; i < NUM_MOTES; i++) {
      const frac = i / NUM_MOTES;
      // Spectral gradient along the stream: cyan -> golden amber -> emerald green
      const r = 0.2 + 0.65 * Math.sin(frac * Math.PI);
      const g = 0.92;
      const b = 0.85 - 0.55 * Math.sin(frac * Math.PI);

      const moteMat = new StandardMaterial({
        color: new Color(r, g, b),
        emissiveColor: new Color(r, g, b),
        emissiveIntensity: 4.5,
        roughness: 0.2,
      });

      const mote = new Object3D(`LeylineMote_${i}`);
      mote.geometry = moteGeo;
      mote.material = moteMat;
      this._leylineMotes.push(mote);
      this.scene.add(mote);
    }

    // --- 11. Interactive HUD ---
    this._createHud();

    attachDevTools(this);
  }

  private _updateSunAngle(): void {
    const swayX = Math.sin(this._time * 0.36) * 0.11 + Math.cos(this._time * 0.19) * 0.04;
    const swayZ = Math.cos(this._time * 0.27) * 0.07;
    const breathe = 1.0 + Math.sin(this._time * 0.58) * 0.12 + Math.cos(this._time * 1.15) * 0.05;

    if (this._sunMode === 1) {
      // High noon celestial beams pouring steeply through the skylight tracery
      this._sunLight.direction.set(0.26 + swayX, -0.9, 0.35 + swayZ);
      this._sunLight.direction.normalize();
      this._sunLight.color.set(0.95, 0.97, 1.0);
      this._sunLight.intensity = 3.0;
      this._sunLight.volumetricIntensity = this._baseGodRayStrength * breathe;
    } else {
      // Golden-hour sun streaming diagonally across the skylight mullions & central nave
      this._sunLight.direction.set(-0.34 + swayX, -0.84, 0.42 + swayZ);
      this._sunLight.direction.normalize();
      this._sunLight.color.set(1.0, 0.86, 0.66);
      this._sunLight.intensity = 3.4;
      this._sunLight.volumetricIntensity = this._baseGodRayStrength * breathe;
    }
  }

  private _applyCameraPreset(index: number, instant = false): void {
    const preset = this._cameraPresets[index];
    if (!preset) return;
    this._activePresetIdx = index;

    if (instant) {
      this.camera.cancelFlight?.();
      this._orbitPivot.copyFrom(preset.target);
      this.setInitialCamera(preset.position, preset.target);
      this._syncCameraStrategy();
      return;
    }

    const startZ = this.camera.position.z;
    const endZ = preset.position.z;
    const crossingPortal = (startZ > -15.0 && endZ < -16.0) || (startZ < -16.0 && endZ > -15.0);

    const waypoints = crossingPortal ? [new Vector3D(0.0, 2.9, -13.5)] : undefined;

    this._syncCameraStrategy();

    this.camera.flyTo?.({
      position: preset.position,
      target: preset.target,
      waypoints,
      onComplete: () => {
        this._orbitPivot.copyFrom(preset.target);
        this._syncCameraStrategy();
      },
      onCancel: () => {
        this._syncCameraStrategy();
      },
    });
  }

  private _setCameraMode(flyMode: boolean): void {
    if (this._isFlyMode === flyMode) return;
    if (flyMode) {
      // Orbit -> Fly: compute forward look angles (theta, phi) from current target - position
      const dir = this.camera.target.clone().sub(this.camera.position);
      const len = dir.length();
      if (len > 1e-4) {
        dir.scale(1.0 / len);
        this.camera.phi = Math.asin(Math.max(-0.9999, Math.min(0.9999, dir.y)));
        this.camera.theta = Math.atan2(dir.x, -dir.z);
      }
    } else {
      // Fly -> Orbit: place orbit pivot 12m ahead along the current look direction
      const sinT = Math.sin(this.camera.theta);
      const cosT = Math.cos(this.camera.theta);
      const sinP = Math.sin(this.camera.phi);
      const cosP = Math.cos(this.camera.phi);
      const orbitDist = 12.0;
      this._orbitPivot.set(
        this.camera.position.x + sinT * cosP * orbitDist,
        this.camera.position.y + sinP * orbitDist,
        this.camera.position.z - cosT * cosP * orbitDist,
      );
      this.camera.target.copyFrom(this._orbitPivot);
    }
    this._isFlyMode = flyMode;
    this._syncCameraStrategy();
  }

  private _syncCameraStrategy(): void {
    const isFlying = this.camera.isFlying ?? false;
    const canControl = !this._isHoveringHud && !this._isDraggingHud && !isFlying;
    if (this._isFlyMode) {
      this.camera.setStrategy(CameraStrategyType.FPS);
      if (this._flyController) this._flyController.enabled = canControl;
      if (this._orbitController) this._orbitController.enabled = false;
    } else {
      this.camera.target.copyFrom(this._orbitPivot);
      this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
      if (this._flyController) this._flyController.enabled = false;
      if (this._orbitController) this._orbitController.enabled = canControl;
    }
    this.camera.updateViewMatrix();
  }

  public override resetCamera(): void {
    this._applyCameraPreset(this._activePresetIdx, false);
    this._updateHudText();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;

    // Movement keys interrupt a camera fly-through so the user immediately has manual control
    if (this.camera.isFlying) {
      const isNav = (
        [
          Keys.W,
          Keys.A,
          Keys.S,
          Keys.D,
          Keys.UP,
          Keys.DOWN,
          Keys.LEFT,
          Keys.RIGHT,
        ] as readonly string[]
      ).includes(event.code);
      if (isNav) {
        this.camera.cancelFlight?.();
        this._orbitPivot.copyFrom(this.camera.target);
        this._syncCameraStrategy();
      }
    }

    switch (event.code) {
      case Keys.F:
        if (this._fogElement) {
          this._fogElement.enabled = !this._fogElement.enabled;
          this._updateHudText();
        }
        break;
      case Keys.C:
        if (!this._isFlyMode) {
          this._chamberCarverVolume.enabled = !this._chamberCarverVolume.enabled;
          this._updateHudText();
        }
        break;
      case Keys.N: {
        const activeNoise = this._altarMistVolume.noiseAmount > 0.0;
        this._altarMistVolume.noiseAmount = activeNoise ? 0.0 : 0.7;
        this._brazierMistVolume.noiseAmount = activeNoise ? 0.0 : 0.8;
        this._skylightMistVolume.noiseAmount = activeNoise ? 0.0 : 0.75;
        this._updateHudText();
        break;
      }
      case Keys.D1:
        this._sunMode = 1;
        this._updateSunAngle();
        this._updateHudText();
        break;
      case Keys.D2:
        this._sunMode = 2;
        this._updateSunAngle();
        this._updateHudText();
        break;
      case Keys.V:
        this._setCameraMode(!this._isFlyMode);
        this._updateHudText();
        break;
      case Keys.L:
        this._leylineActive = !this._leylineActive;
        this._updateHudText();
        break;
      case Keys.I:
        this._toggleInspector();
        break;
    }
  }

  private _hudElement?: HTMLElement;
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
    const existingHud = document.getElementById("showcase-hud");
    if (existingHud) existingHud.remove();
    const existingBtn = document.getElementById("sanctumInspectorBtn");
    if (existingBtn) existingBtn.remove();

    const hud = document.createElement("aside");
    hud.id = "showcase-hud";
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
          if ("wheel" === ev) {
            this.input.mouse.zoom = 0;
            this.input.mouse.wheelX = 0;
            this.input.mouse.wheelY = 0;
          }
        },
        { passive: "wheel" === ev || "touchstart" === ev || "touchmove" === ev },
      );
    }

    hud.addEventListener("pointerenter", () => {
      this._isHoveringHud = true;
      if (this._flyController) this._flyController.enabled = false;
      if (this._orbitController) this._orbitController.enabled = false;
    });

    hud.addEventListener("pointerleave", (e: PointerEvent) => {
      if (0 === e.buttons && !this._isDraggingHud) {
        this._isHoveringHud = false;
        this._syncCameraStrategy();
      }
    });

    hud.addEventListener("pointerdown", () => {
      this._isHoveringHud = true;
      this._isDraggingHud = true;
      if (this._flyController) this._flyController.enabled = false;
      if (this._orbitController) this._orbitController.enabled = false;
      this.input.mouse.dx = 0;
      this.input.mouse.dy = 0;
      this.input.mouse.zoom = 0;
      this.input.mouse.left = false;
    });

    window.addEventListener("pointerup", () => {
      if (!this._isDraggingHud) return;
      this._isDraggingHud = false;
      if (!this._hudElement?.matches(":hover")) {
        this._isHoveringHud = false;
        this._syncCameraStrategy();
      }
    });

    // Footer toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "sanctumInspectorBtn";
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

    this._updateHudText();
  }

  private _updateHudText(): void {
    if (!this._hudElement) return;
    const fogOn = this._fogElement?.enabled ?? false;
    const carverOn = this._chamberCarverVolume.enabled;
    const noiseOn = this._altarMistVolume.noiseAmount > 0.0;
    const rendererBackend = this.renderer.constructor.name.includes("GPU")
      ? "WebGPU (Froxel)"
      : "WebGL2 (Raymarch)";

    this._hudElement.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title">
          <span>🌫️</span> Atmospheric Sanctum
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">${rendererBackend}</span>
          <button id="sanctumHudClose" class="hud-close-btn" title="Close Panel">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <div class="hud-section">
          <div class="section-title">🌫️ Volumetric Fog & Mist</div>
          <div class="hud-row">
            <label for="swFog">Volumetric Fog</label>
            <label class="hud-switch">
              <input type="checkbox" id="swFog" ${fogOn ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row">
            <label for="swCarver">Interior Carving</label>
            <label class="hud-switch">
              <input type="checkbox" id="swCarver" ${carverOn ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row">
            <label for="swNoise">3D Rolling Mist</label>
            <label class="hud-switch">
              <input type="checkbox" id="swNoise" ${noiseOn ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row">
            <label for="swLeyline">✨ Mystic Leyline [L]</label>
            <label class="hud-switch">
              <input type="checkbox" id="swLeyline" ${this._leylineActive ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:4px;margin-top:6px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <label for="rngDensity">Fog Density</label>
              <span id="valDensity">${(this._fogElement?.density ?? 0.024).toFixed(3)}</span>
            </div>
            <input type="range" id="rngDensity" min="0.005" max="0.060" step="0.001" value="${this._fogElement?.density ?? 0.024}">
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:4px;margin-top:4px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <label for="rngShafts">God Ray Strength</label>
              <span id="valShafts">${this._baseGodRayStrength.toFixed(1)}</span>
            </div>
            <input type="range" id="rngShafts" min="0.0" max="8.0" step="0.1" value="${this._baseGodRayStrength}">
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:4px;margin-top:4px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <label for="rngAsymmetry">Mie Asymmetry (g)</label>
              <span id="valAsymmetry">${(this._fogElement?.asymmetry ?? 0.6).toFixed(2)}</span>
            </div>
            <input type="range" id="rngAsymmetry" min="0.0" max="0.85" step="0.01" value="${this._fogElement?.asymmetry ?? 0.6}">
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title">☀️ Sun & Navigation</div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <label>Sun Alignment</label>
            <div class="preset-group">
              <button class="btn-preset ${this._sunMode === 1 ? "active" : ""}" id="btnSunNoon">High Noon</button>
              <button class="btn-preset ${this._sunMode === 2 ? "active" : ""}" id="btnSunGolden">Golden Hour</button>
            </div>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
            <label>Camera Mode [V]</label>
            <div class="preset-group">
              <button class="btn-preset ${this._isFlyMode ? "active" : ""}" id="btnCamFly">Free-Fly (WASD)</button>
              <button class="btn-preset ${!this._isFlyMode ? "active" : ""}" id="btnCamOrbit">Orbit Mode</button>
            </div>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
            <label>Camera Viewpoints</label>
            <div class="preset-group">
              <button class="btn-preset ${this._activePresetIdx === 0 ? "active" : ""}" data-cam="0">Nave</button>
              <button class="btn-preset ${this._activePresetIdx === 1 ? "active" : ""}" data-cam="1">Altar</button>
              <button class="btn-preset ${this._activePresetIdx === 2 ? "active" : ""}" data-cam="2">Portal</button>
              <button class="btn-preset ${this._activePresetIdx === 3 ? "active" : ""}" data-cam="3">Carved Room</button>
            </div>
          </div>
        </div>

        <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; padding: 2px 4px;">
          Use <strong>WASD / Arrows</strong> + <strong>Drag</strong> (or <strong>Scroll</strong>) to fly into the carved chamber (Z = -21), or pick a viewpoint above.
        </div>
      </div>
    `;

    document.getElementById("sanctumHudClose")?.addEventListener("click", () => {
      this._toggleInspector(false);
    });

    // Hook up switch listeners
    document.getElementById("swFog")?.addEventListener("change", (e) => {
      if (this._fogElement) {
        this._fogElement.enabled = (e.target as HTMLInputElement).checked;
      }
    });

    document.getElementById("swCarver")?.addEventListener("change", (e) => {
      this._chamberCarverVolume.enabled = (e.target as HTMLInputElement).checked;
    });

    document.getElementById("swNoise")?.addEventListener("change", (e) => {
      const active = (e.target as HTMLInputElement).checked;
      this._altarMistVolume.noiseAmount = active ? 0.7 : 0.0;
      this._brazierMistVolume.noiseAmount = active ? 0.8 : 0.0;
      this._skylightMistVolume.noiseAmount = active ? 0.75 : 0.0;
    });

    document.getElementById("swLeyline")?.addEventListener("change", (e) => {
      this._leylineActive = (e.target as HTMLInputElement).checked;
    });

    document.getElementById("rngDensity")?.addEventListener("input", (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (this._fogElement) this._fogElement.density = v;
      const lbl = document.getElementById("valDensity");
      if (lbl) lbl.textContent = v.toFixed(3);
    });

    document.getElementById("rngShafts")?.addEventListener("input", (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      this._baseGodRayStrength = v;
      this._updateSunAngle();
      const lbl = document.getElementById("valShafts");
      if (lbl) lbl.textContent = v.toFixed(1);
    });

    document.getElementById("rngAsymmetry")?.addEventListener("input", (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (this._fogElement) this._fogElement.asymmetry = v;
      const lbl = document.getElementById("valAsymmetry");
      if (lbl) lbl.textContent = v.toFixed(2);
    });

    // Hook up preset buttons
    document.getElementById("btnSunNoon")?.addEventListener("click", () => {
      this._sunMode = 1;
      this._updateSunAngle();
      this._updateHudText();
    });

    document.getElementById("btnSunGolden")?.addEventListener("click", () => {
      this._sunMode = 2;
      this._updateSunAngle();
      this._updateHudText();
    });

    document.getElementById("btnCamOrbit")?.addEventListener("click", () => {
      this._setCameraMode(false);
      this._updateHudText();
    });

    document.getElementById("btnCamFly")?.addEventListener("click", () => {
      this._setCameraMode(true);
      this._updateHudText();
    });

    this._hudElement.querySelectorAll<HTMLButtonElement>("button[data-cam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const camIdx = parseInt(btn.dataset["cam"] ?? "0", 10);
        this._applyCameraPreset(camIdx);
        this._updateHudText();
      });
    });
  }

  protected override update(dt: number): void {
    this._time += dt;

    // In Free-Fly mode, allow mouse wheel / trackpad two-finger scroll to dolly along the look vector
    if (
      this._isFlyMode &&
      !this._isHoveringHud &&
      !this._isDraggingHud &&
      !this.camera.isFlying &&
      0 !== this.input.mouse.zoom
    ) {
      const dollyStep = -this.input.mouse.zoom * 18.0;
      const sinT = Math.sin(this.camera.theta);
      const cosT = Math.cos(this.camera.theta);
      const sinP = Math.sin(this.camera.phi);
      const cosP = Math.cos(this.camera.phi);
      this.camera.position.x += sinT * cosP * dollyStep;
      this.camera.position.y += sinP * dollyStep;
      this.camera.position.z += -cosT * cosP * dollyStep;
    }

    // Gentle celestial drift and cloud-scud breathing of the skylight God Ray curtains
    this._updateSunAngle();

    // Gentle levitation of the golden Shrine Relic inside the carved meditation chamber
    if (this._shrineRelic) {
      this._shrineRelic.position.y = 2.0 + Math.sin(this._time * 1.8) * 0.08;
      this._shrineRelic.rotation.y = this._time * 0.45;
    }

    // Gentle pulsing & flicker of the altar and brazier point lights
    if (this._altarLight) {
      this._altarLight.intensity = 1.8 + Math.sin(this._time * 2.5) * 0.25;
    }
    if (this._brazierLight) {
      this._brazierLight.intensity =
        2.2 + Math.sin(this._time * 6.0) * 0.35 + Math.cos(this._time * 11.0) * 0.15;
    }

    // Animated Mystic Leyline stream flowing along the Catmull-Rom spline
    if (this._leylineOrb) {
      this._leylineOrb.isVisible = this._leylineActive;
      this._leylineLight.intensity = this._leylineActive
        ? 2.2 + Math.sin(this._time * 6.0) * 0.4
        : 0.0;

      if (this._leylineActive) {
        // Continuous loop along the spline: ~8 seconds per round-trip
        const headT = (this._time * 0.125) % 1.0;
        this._leylineSpline.getPoint(headT, this._leylineOrb.position);
        this._leylineLight.position.copyFrom(this._leylineOrb.position);

        const tempMotePos = new Vector3D();
        const numMotes = this._leylineMotes.length;
        for (let i = 0; i < numMotes; i++) {
          const mote = this._leylineMotes[i]!;
          mote.isVisible = true;

          // Trailing phase offset
          const moteT = (headT - (i + 1) * 0.026 + 1.0) % 1.0;
          this._leylineSpline.getPoint(moteT, tempMotePos);

          // Double-helix vortex swirl around spline core
          const angle = this._time * 5.0 + i * 0.65;
          const swirlRadius = 0.2 + Math.sin(i * 0.8) * 0.07;
          mote.position.set(
            tempMotePos.x + Math.cos(angle) * swirlRadius,
            tempMotePos.y + Math.sin(angle) * swirlRadius,
            tempMotePos.z + Math.sin(angle * 0.5) * 0.08,
          );
        }
      } else {
        for (let i = 0; i < this._leylineMotes.length; i++) {
          this._leylineMotes[i]!.isVisible = false;
        }
      }
    }
  }
}

const app = new Showcase39();
app.start().catch((err: unknown) => console.error("[Showcase39] Failed to start:", err));
// QA instrumentation hook for the browser capture scripts (same convention as Showcase 28).
if (typeof window !== "undefined") {
  const w = window as Window & { __showcase39?: Showcase39 };
  w.__showcase39 = app;
}
