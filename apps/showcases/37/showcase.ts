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
  Cube,
  Cylinder,
  FlyController,
  Object3D,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  Sphere,
  SpotLight,
  StandardMaterial,
  Texture,
  TextureWrap,
  ToneMappingMode,
  Vector3D,
} from "@small-world-machine/engine";
import { box } from "../shared/prim.js";

class Showcase37 extends AbstractShowcase {
  private _refCamPos = new Vector3D(0.65, 1.15, 2.45);
  private _refCamTarget = new Vector3D(-0.1, 0.85, -0.5);

  protected override async setupScene(): Promise<void> {
    // ------------------------------------------------------------------------
    // 1. Post-Processing Pipeline Setup (Phase 2 Specification)
    // ------------------------------------------------------------------------
    this.renderer.postProcessing.enabled = true;

    // ACES Filmic Tone Mapping
    const toneMapping = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    if (toneMapping) {
      toneMapping.enabled = true;
      toneMapping.mode = ToneMappingMode.ACES_FILMIC;
      toneMapping.exposure = 1.05;
    }

    // Parametric Color Grading (Warm Brown/Orange Atmosphere, Consensus 18)
    const colorGrading = this.renderer.postProcessing.get<ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    if (colorGrading) {
      colorGrading.enabled = true;
      colorGrading.temperature = 0.28;
      colorGrading.saturation = 0.95;
      colorGrading.contrast = 1.06;
      colorGrading.lift = new Color(0.02, 0.015, 0.01);
      colorGrading.gamma = new Color(1.04, 0.98, 0.9);
      colorGrading.gain = new Color(1.05, 1.0, 0.95);
    }

    // HBAO Screen-Space Ambient Occlusion (Contact shadows in corners & furniture)
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 0.65;
      hbao.intensity = 1.35;
    }

    // Bloom (Warm halo around lampshades and candles)
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.45;
      bloom.threshold = 0.8;
      bloom.radius = 0.55;
      bloom.color = new Color(1.0, 0.92, 0.75);
    }

    // Vignette (Strong corner darkening, Consensus 1 & 14)
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      vignette.darkness = 0.68;
      vignette.offset = 0.82;
      vignette.roundness = 2.0;
    }

    // Film Grain (Analog film texture)
    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    if (grain) {
      grain.enabled = true;
      grain.intensity = 0.012;
    }

    // ------------------------------------------------------------------------
    // 2. Camera Setup (66° FOV, Corner Framing, Consensus 4 & 23)
    this.defaultFov = (66 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();

    this.camera.setStrategy(CameraStrategyType.FPS);
    this.setInitialCamera(this._refCamPos, this._refCamTarget);

    const flyCtrl = new FlyController({
      input: this.input,
      moveSpeed: 2.2,
      fastMultiplier: 2.2,
      slowMultiplier: 0.4,
      lookSensitivity: 0.003,
      enableVertical: true,
      flyInLookDirection: true,
    });
    this.camera.addBehavior(flyCtrl);

    // ------------------------------------------------------------------------
    // 3. Load PBR Textures
    // ------------------------------------------------------------------------
    const wrapRepeat = {
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
    };

    const [
      woodFloorDiff,
      woodFloorNorm,
      woodFloorRough,
      wallPlasterDiff,
      wallPlasterNorm,
      wallPlasterRough,
      woodWainscotDiff,
      woodWainscotNorm,
      woodWainscotRough,
      fireplaceBrickDiff,
      fireplaceBrickNorm,
      fireplaceBrickRough,
      fireplaceMantelDiff,
      fireplaceMantelNorm,
      fireplaceMantelRough,
      woodBeamsDiff,
      woodBeamsNorm,
      woodBeamsRough,
      woolRugDiff,
      woolRugNorm,
      woolRugRough,
    ] = await Promise.all([
      Texture.fromUrl("./assets/wood_floor_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_floor_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_floor_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/wall_plaster_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/wall_plaster_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/wall_plaster_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_wainscot_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_wainscot_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_wainscot_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_brick_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_brick_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_brick_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_mantel_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_mantel_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_mantel_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_beams_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_beams_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/wood_beams_roughness.png", wrapRepeat),
      Texture.fromUrl("./assets/wool_rug_albedo.png", wrapRepeat),
      Texture.fromUrl("./assets/wool_rug_normal.png", wrapRepeat),
      Texture.fromUrl("./assets/wool_rug_roughness.png", wrapRepeat),
    ]);

    // Setup texture repeats
    woodFloorDiff.repeat = { x: 3.5, y: 3.5 };
    woodFloorNorm.repeat = { x: 3.5, y: 3.5 };
    woodFloorRough.repeat = { x: 3.5, y: 3.5 };

    wallPlasterDiff.repeat = { x: 2.2, y: 1.4 };
    wallPlasterNorm.repeat = { x: 2.2, y: 1.4 };
    wallPlasterRough.repeat = { x: 2.2, y: 1.4 };

    woodWainscotDiff.repeat = { x: 4.0, y: 1.0 };
    woodWainscotNorm.repeat = { x: 4.0, y: 1.0 };
    woodWainscotRough.repeat = { x: 4.0, y: 1.0 };

    fireplaceBrickDiff.repeat = { x: 2.0, y: 2.5 };
    fireplaceBrickNorm.repeat = { x: 2.0, y: 2.5 };
    fireplaceBrickRough.repeat = { x: 2.0, y: 2.5 };

    woodBeamsDiff.repeat = { x: 1.0, y: 3.0 };
    woodBeamsNorm.repeat = { x: 1.0, y: 3.0 };
    woodBeamsRough.repeat = { x: 1.0, y: 3.0 };

    // ------------------------------------------------------------------------
    // 4. Create PBR Materials (Phase 2 Specifications)
    // ------------------------------------------------------------------------
    const floorMat = new StandardMaterial({
      diffuseMap: woodFloorDiff,
      normalMap: woodFloorNorm,
      roughnessMap: woodFloorRough,
      metallic: 0.0,
      roughness: 0.48,
    });

    const rugMat = new StandardMaterial({
      diffuseMap: woolRugDiff,
      normalMap: woolRugNorm,
      roughnessMap: woolRugRough,
      metallic: 0.0,
      roughness: 0.98,
    });

    const plasterMat = new StandardMaterial({
      diffuseMap: wallPlasterDiff,
      normalMap: wallPlasterNorm,
      roughnessMap: wallPlasterRough,
      metallic: 0.0,
      roughness: 0.88,
    });

    const wainscotMat = new StandardMaterial({
      diffuseMap: woodWainscotDiff,
      normalMap: woodWainscotNorm,
      roughnessMap: woodWainscotRough,
      metallic: 0.0,
      roughness: 0.55,
    });

    const beamMat = new StandardMaterial({
      diffuseMap: woodBeamsDiff,
      normalMap: woodBeamsNorm,
      roughnessMap: woodBeamsRough,
      metallic: 0.0,
      roughness: 0.75,
    });

    const ceilingWoodMat = new StandardMaterial({
      diffuseMap: woodFloorDiff,
      normalMap: woodFloorNorm,
      roughnessMap: woodFloorRough,
      metallic: 0.0,
      roughness: 0.8,
      color: new Color(0.7, 0.65, 0.6),
    });

    const brickMat = new StandardMaterial({
      diffuseMap: fireplaceBrickDiff,
      normalMap: fireplaceBrickNorm,
      roughnessMap: fireplaceBrickRough,
      metallic: 0.0,
      roughness: 0.85,
    });

    const mantelStoneMat = new StandardMaterial({
      diffuseMap: fireplaceMantelDiff,
      normalMap: fireplaceMantelNorm,
      roughnessMap: fireplaceMantelRough,
      metallic: 0.0,
      roughness: 0.38,
      color: new Color(0.96, 0.94, 0.9),
    });

    const brassVaseMat = new StandardMaterial({
      color: new Color(0.92, 0.74, 0.32),
      metallic: 0.98,
      roughness: 0.28,
      reflectivity: 0.0,
    });

    const darkTrimMat = new StandardMaterial({
      color: new Color(0.18, 0.12, 0.08),
      metallic: 0.0,
      roughness: 0.6,
    });

    const darkInteriorMat = new StandardMaterial({
      color: new Color(0.015, 0.015, 0.015),
      metallic: 0.0,
      roughness: 0.95,
    });

    const pendantShadeMat = new StandardMaterial({
      color: new Color(0.96, 0.9, 0.75),
      emissiveColor: new Color(1.0, 0.88, 0.68),
      emissiveIntensity: 1.1,
      metallic: 0.0,
      roughness: 0.75,
    });

    const floorLampShadeMat = new StandardMaterial({
      color: new Color(0.98, 0.35, 0.55),
      emissiveColor: new Color(1.0, 0.3, 0.55),
      emissiveIntensity: 1.0,
      metallic: 0.0,
      roughness: 0.4,
    });

    const sofaFabricMat = new StandardMaterial({
      color: new Color(0.12, 0.09, 0.07),
      metallic: 0.0,
      roughness: 0.92,
    });

    const coffeeTableMat = new StandardMaterial({
      diffuseMap: woodFloorDiff,
      normalMap: woodFloorNorm,
      roughnessMap: woodFloorRough,
      metallic: 0.0,
      roughness: 0.36,
      color: new Color(0.48, 0.32, 0.22),
    });

    const candleWaxMat = new StandardMaterial({
      color: new Color(0.95, 0.92, 0.84),
      metallic: 0.0,
      roughness: 0.35,
    });

    const candleFlameMat = new StandardMaterial({
      color: new Color(1.0, 0.7, 0.25),
      emissiveColor: new Color(1.0, 0.7, 0.25),
      emissiveIntensity: 3.0,
      metallic: 0.0,
      roughness: 0.1,
    });

    // ------------------------------------------------------------------------
    // 5. Lighting Hierarchy (Phase 2 & Consensus 1, 3, 19)
    // ------------------------------------------------------------------------

    // Minimal Warm Ambient Light
    const ambientLight = new AmbientLight({
      color: new Color(0.08, 0.05, 0.03),
      intensity: 0.2,
    });
    this.scene.add(ambientLight);

    // Dominant Pendant Light (SpotLight with Shadow Map, pointing down)
    const pendantLight = new SpotLight({
      color: new Color(1.0, 0.92, 0.82),
      intensity: 3.6,
      distance: 7.0,
      decay: 2.0,
      angle: (78 * Math.PI) / 180,
      penumbra: 0.35,
      direction: new Vector3D(0.05, -1, 0.05).normalize(),
    });
    pendantLight.position.set(0.05, 1.95, -0.2);
    pendantLight.castShadow = true;
    pendantLight.shadowBias = 0.002;
    pendantLight.shadowResolution = 1024;
    this.scene.add(pendantLight);

    // Upward Ceiling Fill Light from Pendant
    const pendantUpLight = new SpotLight({
      color: new Color(1.0, 0.88, 0.75),
      intensity: 0.9,
      distance: 3.0,
      decay: 2.0,
      angle: (65 * Math.PI) / 180,
      penumbra: 0.5,
      direction: new Vector3D(0, 1, 0),
    });
    pendantUpLight.position.set(0.05, 2.05, -0.2);
    pendantUpLight.castShadow = false;
    this.scene.add(pendantUpLight);

    // Floor Lamp Accent Light (Warm Pink Accent behind sofa, Consensus 1 & 21)
    const floorLampLight = new PointLight({
      color: new Color(1.0, 0.45, 0.65),
      intensity: 0.45,
      distance: 2.4,
      decay: 2.0,
    });
    floorLampLight.position.set(-0.1, 1.35, -2.15);
    this.scene.add(floorLampLight);

    // Fireplace Ember Glow (Warm Orange inside hearth, Consensus 15)
    const fireplaceLight = new PointLight({
      color: new Color(1.0, 0.45, 0.12),
      intensity: 0.85,
      distance: 3.0,
      decay: 2.0,
    });
    fireplaceLight.position.set(2.15, 0.35, -0.15);
    this.scene.add(fireplaceLight);

    // Candle Cluster PointLight (Warm flickering glow on coffee table, Consensus 3)
    const candleLight = new PointLight({
      color: new Color(1.0, 0.65, 0.22),
      intensity: 0.75,
      distance: 2.0,
      decay: 2.0,
    });
    candleLight.position.set(-0.05, 0.58, -0.35);
    this.scene.add(candleLight);

    // ------------------------------------------------------------------------
    // 6. Geometry & Scene Construction (Room & Props)
    // ------------------------------------------------------------------------
    const cubeGeom = new Cube({ size: 1 }).getGeometryData();

    // Floor (Dunkle Holzdielen / Schiffboden, diagonal in die Tiefe laufend, Consensus 12)
    const floor = new Object3D("Floor");
    floor.geometry = cubeGeom;
    floor.material = floorMat;
    floor.scale.set(6.4, 0.02, 6.4);
    floor.position.set(0, -0.01, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Wool Rug (Wollteppich mit Rautenmuster, Consensus 17 & 24)
    const rug = new Object3D("Rug");
    rug.geometry = cubeGeom;
    rug.material = rugMat;
    rug.scale.set(2.4, 0.008, 3.4);
    rug.position.set(0.0, 0.004, -0.4);
    rug.receiveShadow = true;
    this.scene.add(rug);

    // Ceiling Plane (Dark Wooden Planks Ceiling, Consensus 13)
    const ceiling = new Object3D("Ceiling");
    ceiling.geometry = cubeGeom;
    ceiling.material = ceilingWoodMat;
    ceiling.scale.set(6.4, 0.02, 6.4);
    ceiling.position.set(0, 2.58, 0);
    ceiling.receiveShadow = true;
    this.scene.add(ceiling);

    // Ceiling Timber Cross Beams (Schwere Holzbalken im Kreuzmuster, Consensus 13)
    const beamZCoords = [-1.8, -0.2, 1.4];
    beamZCoords.forEach((bz, idx) => {
      const beamX = new Object3D(`CeilingBeamX_${idx}`);
      beamX.geometry = cubeGeom;
      beamX.material = beamMat;
      beamX.scale.set(6.4, 0.18, 0.22);
      beamX.position.set(0, 2.48, bz);
      beamX.castShadow = true;
      beamX.receiveShadow = true;
      this.scene.add(beamX);
    });

    const beamXCoords = [-1.8, 0.3, 2.0];
    beamXCoords.forEach((bx, idx) => {
      const beamZ = new Object3D(`CeilingBeamZ_${idx}`);
      beamZ.geometry = cubeGeom;
      beamZ.material = beamMat;
      beamZ.scale.set(0.22, 0.18, 6.4);
      beamZ.position.set(bx, 2.48, 0);
      beamZ.castShadow = true;
      beamZ.receiveShadow = true;
      this.scene.add(beamZ);
    });

    // Helper to create two-part walls (Lower Wainscot + Chair Rail + Upper Plaster)
    const createTwoPartWall = (
      name: string,
      w: number,
      pos: [number, number, number],
      rotY: number = 0,
    ): Object3D => {
      const wallRoot = new Object3D(name);
      wallRoot.position.set(pos[0], pos[1], pos[2]);
      wallRoot.rotation.y = rotY;

      // Lower Wainscoting (y = 0..1.0)
      const wainscot = new Object3D(`${name}_Wainscot`);
      wainscot.geometry = cubeGeom;
      wainscot.material = wainscotMat;
      wainscot.scale.set(w, 1.0, 0.04);
      wainscot.position.set(0, 0.5, 0);
      wainscot.receiveShadow = true;
      wallRoot.add(wainscot);

      // Chair Rail Trim (y = 1.0..1.06)
      const chairRail = new Object3D(`${name}_ChairRail`);
      chairRail.geometry = cubeGeom;
      chairRail.material = darkTrimMat;
      chairRail.scale.set(w, 0.06, 0.07);
      chairRail.position.set(0, 1.03, 0.015);
      chairRail.receiveShadow = true;
      chairRail.castShadow = true;
      wallRoot.add(chairRail);

      // Upper Plaster Wall (y = 1.06..2.58)
      const plaster = new Object3D(`${name}_Plaster`);
      plaster.geometry = cubeGeom;
      plaster.material = plasterMat;
      plaster.scale.set(w, 1.52, 0.02);
      plaster.position.set(0, 1.82, 0);
      plaster.receiveShadow = true;
      wallRoot.add(plaster);

      // Baseboard Trim (y = 0..0.1)
      const baseboard = new Object3D(`${name}_Baseboard`);
      baseboard.geometry = cubeGeom;
      baseboard.material = darkTrimMat;
      baseboard.scale.set(w, 0.12, 0.06);
      baseboard.position.set(0, 0.06, 0.015);
      baseboard.receiveShadow = true;
      wallRoot.add(baseboard);

      return wallRoot;
    };

    // North Wall (Z = -3.0)
    const northWall = createTwoPartWall("NorthWall", 6.4, [0, 0, -3.0]);
    this.scene.add(northWall);

    // South Wall (Z = +3.0)
    const southWall = createTwoPartWall("SouthWall", 6.4, [0, 0, 3.0], Math.PI);
    this.scene.add(southWall);

    // West Wall (X = -3.0)
    const westWall = createTwoPartWall("WestWall", 6.4, [-3.0, 0, 0], Math.PI / 2);
    this.scene.add(westWall);

    // East Wall (X = +3.0, with fireplace and doorway, Consensus 6 & 10)
    const eastWallSection1 = createTwoPartWall("EastWall_1", 2.2, [3.0, 0, -1.9], -Math.PI / 2);
    this.scene.add(eastWallSection1);

    const eastWallSection2 = createTwoPartWall("EastWall_2", 1.2, [3.0, 0, 0.7], -Math.PI / 2);
    this.scene.add(eastWallSection2);

    // Dark Doorway (Rechts neben dem Kamin, Consensus 10)
    const doorFrame = new Object3D("DoorFrame");
    doorFrame.position.set(2.95, 0, 1.5);
    doorFrame.rotation.y = -Math.PI / 2;

    const doorArch = new Object3D("DoorArch");
    doorArch.geometry = cubeGeom;
    doorArch.material = darkTrimMat;
    doorArch.scale.set(1.15, 0.12, 0.18);
    doorArch.position.set(0, 2.15, 0);
    doorFrame.add(doorArch);

    const doorPostL = new Object3D("DoorPostL");
    doorPostL.geometry = cubeGeom;
    doorPostL.material = darkTrimMat;
    doorPostL.scale.set(0.12, 2.15, 0.18);
    doorPostL.position.set(-0.52, 1.07, 0);
    doorFrame.add(doorPostL);

    const doorPostR = new Object3D("DoorPostR");
    doorPostR.geometry = cubeGeom;
    doorPostR.material = darkTrimMat;
    doorPostR.scale.set(0.12, 2.15, 0.18);
    doorPostR.position.set(0.52, 1.07, 0);
    doorFrame.add(doorPostR);

    const darkVestibule = new Object3D("DarkVestibule");
    darkVestibule.geometry = cubeGeom;
    darkVestibule.material = darkInteriorMat;
    darkVestibule.scale.set(1.0, 2.15, 1.2);
    darkVestibule.position.set(0, 1.07, -0.6);
    doorFrame.add(darkVestibule);
    this.scene.add(doorFrame);

    // ------------------------------------------------------------------------
    // 7. Fireplace (Tapered Chimney Hood, Columns, Mantel, Consensus 6 & 15)
    // ------------------------------------------------------------------------
    const fireplace = new Object3D("Fireplace");
    fireplace.position.set(2.45, 0, -0.15);
    fireplace.rotation.y = -Math.PI / 2 - 0.12;

    // Lower Brick Base
    const chimneyLower = new Object3D("ChimneyLower");
    chimneyLower.geometry = cubeGeom;
    chimneyLower.material = brickMat;
    chimneyLower.scale.set(1.5, 0.95, 0.55);
    chimneyLower.position.set(0, 0.475, 0.05);
    chimneyLower.receiveShadow = true;
    chimneyLower.castShadow = true;
    fireplace.add(chimneyLower);

    // Tapered Upper Chimney Hood
    const chimneyUpper = new Object3D("ChimneyUpper");
    chimneyUpper.geometry = cubeGeom;
    chimneyUpper.material = brickMat;
    chimneyUpper.scale.set(1.2, 1.55, 0.45);
    chimneyUpper.position.set(0, 1.75, -0.02);
    chimneyUpper.receiveShadow = true;
    chimneyUpper.castShadow = true;
    fireplace.add(chimneyUpper);

    // Dark Firebox Cavity (Unbeleuchtete Öffnung)
    const firebox = new Object3D("Firebox");
    firebox.geometry = cubeGeom;
    firebox.material = darkInteriorMat;
    firebox.scale.set(0.82, 0.72, 0.56);
    firebox.position.set(0, 0.36, 0.1);
    fireplace.add(firebox);

    // Limestone Mantel Top Shelf
    const mantelShelf = new Object3D("MantelShelf");
    mantelShelf.geometry = cubeGeom;
    mantelShelf.material = mantelStoneMat;
    mantelShelf.scale.set(1.65, 0.1, 0.62);
    mantelShelf.position.set(0, 0.95, 0.12);
    mantelShelf.castShadow = true;
    mantelShelf.receiveShadow = true;
    fireplace.add(mantelShelf);

    // Two Limestone Columns
    const colGeom = new Cylinder({
      radiusTop: 0.065,
      radiusBottom: 0.065,
      height: 0.85,
      radialSegments: 16,
    }).getGeometryData();

    const colL = new Object3D("ColL");
    colL.geometry = colGeom;
    colL.material = mantelStoneMat;
    colL.position.set(-0.58, 0.475, 0.3);
    colL.castShadow = true;
    colL.receiveShadow = true;
    fireplace.add(colL);

    const colR = new Object3D("ColR");
    colR.geometry = colGeom;
    colR.material = mantelStoneMat;
    colR.position.set(0.58, 0.475, 0.3);
    colR.castShadow = true;
    colR.receiveShadow = true;
    fireplace.add(colR);

    this.scene.add(fireplace);

    // Firewood Box & Logs (Rechts neben Kamin, Consensus 22)
    const firewoodBox = new Object3D("FirewoodBox");
    firewoodBox.position.set(2.45, 0, 0.7);
    firewoodBox.rotation.y = -0.25;

    const boxBase = box("BoxBase", beamMat, [0.6, 0.35, 0.45], [0, 0.18, 0], {
      cast: true,
      receive: true,
    });
    firewoodBox.add(boxBase);

    // Stacked Logs inside
    const logGeom = new Cylinder({
      radiusTop: 0.045,
      radiusBottom: 0.045,
      height: 0.5,
      radialSegments: 10,
    }).getGeometryData();

    for (let i = 0; i < 4; i++) {
      const log = new Object3D(`Log_${i}`);
      log.geometry = logGeom;
      log.material = beamMat;
      log.rotation.z = Math.PI / 2;
      log.rotation.y = 0.1 * i;
      log.position.set(0, 0.32 + 0.06 * Math.floor(i / 2), -0.08 + 0.12 * (i % 2));
      log.castShadow = true;
      firewoodBox.add(log);
    }
    this.scene.add(firewoodBox);

    // ------------------------------------------------------------------------
    // 8. Staircase on Left (Stufen kommen nach vorne/unten zum Betrachter, Consensus 5)
    // ------------------------------------------------------------------------
    const stairs = new Object3D("Stairs");
    stairs.position.set(-2.45, 0, 0.15);
    stairs.rotation.y = Math.PI;

    const numSteps = 12;
    const stepHeight = 0.21;
    const stepDepth = 0.28;
    const stepWidth = 1.05;

    for (let i = 0; i < numSteps; i++) {
      const step = new Object3D(`Step_${i}`);
      step.geometry = cubeGeom;
      step.material = beamMat;
      step.scale.set(stepWidth, stepHeight, stepDepth);
      step.position.set(0, (i + 0.5) * stepHeight, (i + 0.5) * stepDepth);
      step.castShadow = true;
      step.receiveShadow = true;
      stairs.add(step);
    }

    // Wooden Balusters & Handrail (local x = -0.50 -> world X = -1.95, facing the room!)
    const handrail = new Object3D("Handrail");
    handrail.geometry = cubeGeom;
    handrail.material = darkTrimMat;
    handrail.scale.set(0.06, 0.08, numSteps * stepDepth * 1.08);
    handrail.rotation.x = -Math.atan2(stepHeight, stepDepth);
    handrail.position.set(-0.5, (numSteps * stepHeight) / 2 + 0.72, (numSteps * stepDepth) / 2);
    handrail.castShadow = true;
    stairs.add(handrail);

    // Balusters on each step
    for (let i = 0; i < numSteps; i++) {
      const post = new Object3D(`Baluster_${i}`);
      post.geometry = cubeGeom;
      post.material = darkTrimMat;
      post.scale.set(0.035, 0.72, 0.035);
      post.position.set(-0.5, (i + 1) * stepHeight + 0.36, (i + 0.5) * stepDepth);
      post.castShadow = true;
      stairs.add(post);
    }

    // Newel Post at the foot of stairs
    const newelPost = new Object3D("NewelPost");
    newelPost.geometry = cubeGeom;
    newelPost.material = darkTrimMat;
    newelPost.scale.set(0.08, 0.95, 0.08);
    newelPost.position.set(-0.5, 0.475, 0.5 * stepDepth);
    newelPost.castShadow = true;
    stairs.add(newelPost);

    this.scene.add(stairs);

    // ------------------------------------------------------------------------
    // 9. Bookcase & Floating Wall Shelf (Consensus 8 & 9)
    // ------------------------------------------------------------------------
    const bookcase = new Object3D("Bookcase");
    bookcase.position.set(-1.65, 0, -2.85);

    const caseFrame = new Object3D("CaseFrame");
    caseFrame.geometry = cubeGeom;
    caseFrame.material = beamMat;
    caseFrame.scale.set(0.9, 1.9, 0.3);
    caseFrame.position.set(0, 0.95, 0);
    caseFrame.castShadow = true;
    caseFrame.receiveShadow = true;
    bookcase.add(caseFrame);

    // Book rows
    const bookColors: Color[] = [
      new Color(0.4, 0.15, 0.12),
      new Color(0.12, 0.25, 0.2),
      new Color(0.18, 0.18, 0.3),
      new Color(0.35, 0.28, 0.12),
    ];
    for (let shelfIdx = 0; shelfIdx < 4; shelfIdx++) {
      const bookBlock = new Object3D(`Books_${shelfIdx}`);
      bookBlock.geometry = cubeGeom;
      const bColor = bookColors[shelfIdx % bookColors.length] ?? new Color(0.3, 0.2, 0.1);
      bookBlock.material = new StandardMaterial({
        color: bColor,
        metallic: 0.0,
        roughness: 0.85,
      });
      bookBlock.scale.set(0.78, 0.34, 0.22);
      bookBlock.position.set(0, 0.32 + shelfIdx * 0.42, 0.03);
      bookBlock.castShadow = true;
      bookcase.add(bookBlock);
    }
    this.scene.add(bookcase);

    // Floating Wall Shelf (Consensus 9)
    const wallShelf = new Object3D("WallShelf");
    wallShelf.position.set(-0.65, 1.85, -2.88);

    const shelfPlank = new Object3D("ShelfPlank");
    shelfPlank.geometry = cubeGeom;
    shelfPlank.material = beamMat;
    shelfPlank.scale.set(0.85, 0.04, 0.24);
    shelfPlank.position.set(0, 0, 0);
    shelfPlank.castShadow = true;
    wallShelf.add(shelfPlank);

    // Dark Bottles on shelf
    const bottleGeom = new Cylinder({
      radiusTop: 0.02,
      radiusBottom: 0.045,
      height: 0.24,
      radialSegments: 12,
    }).getGeometryData();
    const bottleMat = new StandardMaterial({
      color: new Color(0.08, 0.1, 0.06),
      metallic: 0.1,
      roughness: 0.25,
    });

    const bottle1 = new Object3D("Bottle1");
    bottle1.geometry = bottleGeom;
    bottle1.material = bottleMat;
    bottle1.position.set(-0.15, 0.14, 0);
    bottle1.castShadow = true;
    wallShelf.add(bottle1);

    const bottle2 = new Object3D("Bottle2");
    bottle2.geometry = bottleGeom;
    bottle2.material = bottleMat;
    bottle2.position.set(0.12, 0.14, 0);
    bottle2.castShadow = true;
    wallShelf.add(bottle2);

    this.scene.add(wallShelf);

    // ------------------------------------------------------------------------
    // 10. Furniture (Sofa, Coffee Table, Candles, Consensus 2, 3, 6)
    // ------------------------------------------------------------------------

    // Rustic 3-Seater Sofa (Hinter dem Couchtisch, Consensus 6)
    const sofa = new Object3D("Sofa");
    sofa.position.set(-0.25, 0, -1.55);

    // Base Seat Box
    const sofaBase = new Object3D("SofaBase");
    sofaBase.geometry = cubeGeom;
    sofaBase.material = sofaFabricMat;
    sofaBase.scale.set(2.2, 0.42, 0.85);
    sofaBase.position.set(0, 0.21, 0);
    sofaBase.castShadow = true;
    sofaBase.receiveShadow = true;
    sofa.add(sofaBase);

    // Backrest
    const sofaBack = new Object3D("SofaBack");
    sofaBack.geometry = cubeGeom;
    sofaBack.material = sofaFabricMat;
    sofaBack.scale.set(2.2, 0.55, 0.24);
    sofaBack.position.set(0, 0.65, -0.3);
    sofaBack.castShadow = true;
    sofaBack.receiveShadow = true;
    sofa.add(sofaBack);

    // Left Armrest
    const sofaArmL = new Object3D("SofaArmL");
    sofaArmL.geometry = cubeGeom;
    sofaArmL.material = sofaFabricMat;
    sofaArmL.scale.set(0.24, 0.32, 0.85);
    sofaArmL.position.set(-1.0, 0.48, 0);
    sofaArmL.castShadow = true;
    sofa.add(sofaArmL);

    // Right Armrest
    const sofaArmR = new Object3D("SofaArmR");
    sofaArmR.geometry = cubeGeom;
    sofaArmR.material = sofaFabricMat;
    sofaArmR.scale.set(0.24, 0.32, 0.85);
    sofaArmR.position.set(1.0, 0.48, 0);
    sofaArmR.castShadow = true;
    sofa.add(sofaArmR);
    this.scene.add(sofa);

    // Rustic Coffee Table (Mitte auf Teppich, Consensus 2)
    const coffeeTable = new Object3D("CoffeeTable");
    coffeeTable.position.set(-0.05, 0, -0.35);

    const tableTop = new Object3D("TableTop");
    tableTop.geometry = cubeGeom;
    tableTop.material = coffeeTableMat;
    tableTop.scale.set(1.25, 0.06, 0.75);
    tableTop.position.set(0, 0.42, 0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    coffeeTable.add(tableTop);

    // 4 Table Legs
    const legPositions: [number, number][] = [
      [-0.54, -0.3],
      [0.54, -0.3],
      [-0.54, 0.3],
      [0.54, 0.3],
    ];
    legPositions.forEach(([lx, lz], idx) => {
      const leg = new Object3D(`Leg_${idx}`);
      leg.geometry = cubeGeom;
      leg.material = coffeeTableMat;
      leg.scale.set(0.08, 0.42, 0.08);
      leg.position.set(lx, 0.21, lz);
      leg.castShadow = true;
      coffeeTable.add(leg);
    });

    // Candles on Tray (Consensus 3)
    const candleTray = new Object3D("CandleTray");
    candleTray.geometry = new Cylinder({
      radiusTop: 0.16,
      radiusBottom: 0.16,
      height: 0.015,
      radialSegments: 16,
    }).getGeometryData();
    candleTray.material = darkTrimMat;
    candleTray.position.set(0, 0.46, 0);
    candleTray.castShadow = true;
    coffeeTable.add(candleTray);

    const candleHeights = [0.08, 0.13, 0.16];
    const candleOffsets: [number, number][] = [
      [-0.05, -0.04],
      [0.05, -0.02],
      [-0.01, 0.06],
    ];
    candleHeights.forEach((ch, idx) => {
      const offset = candleOffsets[idx] ?? [0, 0];
      const [cx, cz] = offset;
      const candle = new Object3D(`Candle_${idx}`);
      candle.geometry = new Cylinder({
        radiusTop: 0.025,
        radiusBottom: 0.025,
        height: ch,
        radialSegments: 12,
      }).getGeometryData();
      candle.material = candleWaxMat;
      candle.position.set(cx, 0.47 + ch / 2, cz);
      candle.castShadow = true;
      coffeeTable.add(candle);

      // Flame
      const flame = new Object3D(`Flame_${idx}`);
      flame.geometry = new Sphere({
        radius: 0.012,
        widthSegments: 8,
        heightSegments: 6,
      }).getGeometryData();
      flame.material = candleFlameMat;
      flame.position.set(cx, 0.47 + ch + 0.015, cz);
      coffeeTable.add(flame);
    });

    this.scene.add(coffeeTable);

    // ------------------------------------------------------------------------
    // 11. Foreground Right Round Table + Brass Vase (Consensus 7 & 16)
    // ------------------------------------------------------------------------
    const roundTable = new Object3D("RoundTable");
    roundTable.position.set(1.22, 0, 1.45);

    const roundTop = new Object3D("RoundTop");
    roundTop.geometry = new Cylinder({
      radiusTop: 0.32,
      radiusBottom: 0.32,
      height: 0.04,
      radialSegments: 24,
    }).getGeometryData();
    roundTop.material = darkTrimMat;
    roundTop.position.set(0, 0.42, 0);
    roundTop.castShadow = true;
    roundTop.receiveShadow = true;
    roundTable.add(roundTop);

    const tablePedestal = new Object3D("TablePedestal");
    tablePedestal.geometry = new Cylinder({
      radiusTop: 0.055,
      radiusBottom: 0.09,
      height: 0.4,
      radialSegments: 16,
    }).getGeometryData();
    tablePedestal.material = darkTrimMat;
    tablePedestal.position.set(0, 0.2, 0);
    tablePedestal.castShadow = true;
    roundTable.add(tablePedestal);

    // Large Brass Vase (Gealtertes Messing, Consensus 16)
    const brassVase = new Object3D("BrassVase");
    brassVase.position.set(0, 0.44, 0);

    const vaseBelly = new Object3D("VaseBelly");
    vaseBelly.geometry = new Cylinder({
      radiusTop: 0.14,
      radiusBottom: 0.1,
      height: 0.24,
      radialSegments: 20,
    }).getGeometryData();
    vaseBelly.material = brassVaseMat;
    vaseBelly.position.set(0, 0.12, 0);
    vaseBelly.castShadow = true;
    brassVase.add(vaseBelly);

    const vaseNeck = new Object3D("VaseNeck");
    vaseNeck.geometry = new Cylinder({
      radiusTop: 0.07,
      radiusBottom: 0.12,
      height: 0.12,
      radialSegments: 16,
    }).getGeometryData();
    vaseNeck.material = brassVaseMat;
    vaseNeck.position.set(0, 0.3, 0);
    vaseNeck.castShadow = true;
    brassVase.add(vaseNeck);

    const vaseRim = new Object3D("VaseRim");
    vaseRim.geometry = new Cylinder({
      radiusTop: 0.105,
      radiusBottom: 0.07,
      height: 0.03,
      radialSegments: 16,
    }).getGeometryData();
    vaseRim.material = brassVaseMat;
    vaseRim.position.set(0, 0.375, 0);
    vaseRim.castShadow = true;
    brassVase.add(vaseRim);

    roundTable.add(brassVase);
    this.scene.add(roundTable);

    // ------------------------------------------------------------------------
    // 12. Pendant Lamp (Leinenschirm, Consensus 1 & 20)
    // ------------------------------------------------------------------------
    const pendantMesh = new Object3D("PendantMesh");
    pendantMesh.position.set(0.05, 1.95, -0.2);

    // Hanging Wire
    const wire = new Object3D("PendantWire");
    wire.geometry = new Cylinder({
      radiusTop: 0.005,
      radiusBottom: 0.005,
      height: 0.55,
      radialSegments: 6,
    }).getGeometryData();
    wire.material = darkTrimMat;
    wire.position.set(0, 0.35, 0);
    pendantMesh.add(wire);

    // Linen Lamp Shade
    const shade = new Object3D("PendantShade");
    shade.geometry = new Cylinder({
      radiusTop: 0.24,
      radiusBottom: 0.29,
      height: 0.26,
      radialSegments: 20,
    }).getGeometryData();
    shade.material = pendantShadeMat;
    shade.position.set(0, 0.02, 0);
    pendantMesh.add(shade);

    this.scene.add(pendantMesh);

    // ------------------------------------------------------------------------
    // 13. Floor Lamp (Pinkes Schirmchen, Consensus 1 & 21)
    // ------------------------------------------------------------------------
    const floorLamp = new Object3D("FloorLamp");
    floorLamp.position.set(-0.1, 0, -2.15);

    // Thin Metal Pole
    const lampPole = new Object3D("LampPole");
    lampPole.geometry = new Cylinder({
      radiusTop: 0.015,
      radiusBottom: 0.015,
      height: 1.45,
      radialSegments: 8,
    }).getGeometryData();
    lampPole.material = darkTrimMat;
    lampPole.position.set(0, 0.72, 0);
    lampPole.castShadow = true;
    floorLamp.add(lampPole);

    // Pink Shade Cone
    const pinkShade = new Object3D("PinkShade");
    pinkShade.geometry = new Cylinder({
      radiusTop: 0.06,
      radiusBottom: 0.15,
      height: 0.16,
      radialSegments: 16,
    }).getGeometryData();
    pinkShade.material = floorLampShadeMat;
    pinkShade.position.set(0, 1.45, 0);
    floorLamp.add(pinkShade);

    this.scene.add(floorLamp);
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase37({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase37] Failed to start:", err));
