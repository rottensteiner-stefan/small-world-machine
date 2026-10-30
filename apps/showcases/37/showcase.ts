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
  bakeSceneDecals,
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
import { Fire } from "@small-world-machine/vfx-extras";

export class Showcase extends AbstractShowcase {
  private _refCamPos = new Vector3D(0.65, 1.15, 2.45);
  private _refCamTarget = new Vector3D(-0.1, 0.85, -0.5);

  // --- Living-light rig (deterministic flicker, no Math.random) ---
  private _flickerT: number = 0;
  private _pendantLight: SpotLight | undefined;
  private _floorLampLight: PointLight | undefined;
  private _candleLight: PointLight | undefined;
  private _fireplaceLight: PointLight | undefined;
  private _flameMats: StandardMaterial[] = [];
  private _hearthFire: Fire | undefined;

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
      // 1.02 (was 1.05): keep shadows deep so the fire lights actually carry the room
      // instead of the whole frame sitting at the top of the tone curve (a CG tell).
      toneMapping.exposure = 1.02;
    }

    // Parametric Color Grading (Warm Brown/Orange Atmosphere, Consensus 18)
    const colorGrading = this.renderer.postProcessing.get<ColorGradingElement>(
      PostProcessingEffectType.COLOR_GRADING,
    );
    if (colorGrading) {
      colorGrading.enabled = true;
      // Softened (was temperature 0.28 / saturation 0.95 / contrast 1.06): a heavy warm bake
      // reads as "filter demo". We keep the cozy direction but let the light sources do the work.
      colorGrading.temperature = 0.2;
      colorGrading.saturation = 0.9;
      colorGrading.contrast = 1.04;
      colorGrading.lift = new Color(0.015, 0.012, 0.008);
      colorGrading.gamma = new Color(1.03, 0.985, 0.925);
      colorGrading.gain = new Color(1.04, 1.0, 0.96);
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
      // Threshold raised 0.8 -> 0.95 so ONLY the actual emitters bloom (flames, shade, fire),
      // never the whole painted room. Intensity nudged down for the same anti-CG reason.
      bloom.intensity = 0.4;
      bloom.threshold = 0.95;
      bloom.radius = 0.55;
      bloom.color = new Color(1, 0.963, 0.877);
    }

    // Vignette (Strong corner darkening, Consensus 1 & 14)
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      // 0.68 darkness was a hard "photo filter" ring; drop to a soft cinematic falloff that
      // never reads as a grade. Offset pushed outward (0.82 -> 0.88) so only the true corners darken.
      vignette.darkness = 0.5;
      vignette.offset = 0.88;
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

    // Custom warm IBL: baked from a procedural "dark warm room at night" equirectangular panorama
    // (generator: .agents/scratches/gen-warm-ibl.mjs, baker: scripts/ibl-bake.ts; the linear 8-bit
    // export was re-encoded per pixel to the sRGB IBL contract of ADR 0048/0049). Low
    // intensity on purpose -- it must only add a faint indirect warm fill and believable warm
    // reflection hints on the brass/wood, never wash out the candle-lit mood.
    await this.loadIbl("./assets/ibl/", 0.4);

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
      Texture.fromUrl("./assets/wood_floor_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_floor_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_floor_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/wall_plaster_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/wall_plaster_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/wall_plaster_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_wainscot_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_wainscot_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_wainscot_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_brick_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_brick_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_brick_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_mantel_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_mantel_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/fireplace_mantel_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_beams_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_beams_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/wood_beams_roughness.webp", wrapRepeat),
      Texture.fromUrl("./assets/wool_rug_albedo.webp", wrapRepeat),
      Texture.fromUrl("./assets/wool_rug_normal.webp", wrapRepeat),
      Texture.fromUrl("./assets/wool_rug_roughness.webp", wrapRepeat),
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
      // 0.48 was far too glossy and read as a veneer of plastic under the pendant/candle
      // highlights. Base roughness is a MULTIPLIER on the roughness map in the standard shader
      // (`obj.roughness * roughnessMap.g`), so a matte, natural diele needs a high base: 0.8.
      roughness: 0.8,
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
      color: new Color(0.85, 0.822, 0.793),
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
      color: new Color(0.982, 0.972, 0.953),
    });

    const brassVaseMat = new StandardMaterial({
      color: new Color(0.963, 0.872, 0.596),
      metallic: 0.98,
      roughness: 0.28,
      reflectivity: 0.0,
    });

    const darkTrimMat = new StandardMaterial({
      color: new Color(0.459, 0.381, 0.317),
      metallic: 0.0,
      roughness: 0.6,
    });

    const darkInteriorMat = new StandardMaterial({
      color: new Color(0.148, 0.148, 0.148),
      metallic: 0.0,
      roughness: 0.95,
    });

    const pendantShadeMat = new StandardMaterial({
      color: new Color(0.982, 0.953, 0.877),
      emissiveColor: new Color(1, 0.944, 0.839),
      // 0.8 instead of 1.1: keeps the shade a lit fabric rather than a flat blown-out white disc
      // (the previous 1.1 flooded the whole silhouette under ACES).
      emissiveIntensity: 0.8,
      metallic: 0.0,
      roughness: 0.75,
    });

    // Floor lamp shade -- warmed & damped from harsh magenta (0.98,0.35,0.55) to a dusty blush/
    // terracotta so the accent stays visible but stops fighting the warm palette (user decision:
    // "wärmer/gedämpfter").
    const floorLampShadeMat = new StandardMaterial({
      color: new Color(0.934, 0.743, 0.703),
      emissiveColor: new Color(0.977, 0.805, 0.73),
      emissiveIntensity: 0.7,
      metallic: 0.0,
      roughness: 0.4,
    });

    const sofaFabricMat = new StandardMaterial({
      color: new Color(0.381, 0.335, 0.299),
      metallic: 0.0,
      roughness: 0.92,
    });

    const coffeeTableMat = new StandardMaterial({
      diffuseMap: woodFloorDiff,
      normalMap: woodFloorNorm,
      roughnessMap: woodFloorRough,
      metallic: 0.0,
      roughness: 0.36,
      color: new Color(0.716, 0.596, 0.502),
    });

    const candleWaxMat = new StandardMaterial({
      color: new Color(0.977, 0.963, 0.924),
      metallic: 0.0,
      roughness: 0.35,
    });

    const candleFlameMat = new StandardMaterial({
      color: new Color(1, 0.85, 0.533),
      emissiveColor: new Color(1, 0.85, 0.533),
      emissiveIntensity: 3.0,
      metallic: 0.0,
      roughness: 0.1,
    });
    // Shared by every candle flame on the coffee table; flickered in update().
    this._flameMats.push(candleFlameMat);

    // ------------------------------------------------------------------------
    // 5. Lighting Hierarchy (Phase 2 & Consensus 1, 3, 19)
    // ------------------------------------------------------------------------

    // Minimal Warm Ambient Light -- slightly lifted (intensity 0.2 -> 0.3) so the room never
    // collapses into flat black voids; a faint simulated bounce fill, kept below the mood.
    const ambientLight = new AmbientLight({
      color: new Color(0.335, 0.278, 0.232),
      intensity: 0.3,
    });
    this.scene.add(ambientLight);

    // Dominant Pendant Light (SpotLight with Shadow Map, pointing down) -- 2.6 instead of 3.6 so
    // the hero light still reads as the warm source without scorching the table into blown highs.
    const pendantLight = new SpotLight({
      color: new Color(1, 0.963, 0.914),
      intensity: 2.6,
      distance: 7.0,
      decay: 2.0,
      angle: (78 * Math.PI) / 180,
      penumbra: 0.35,
      direction: new Vector3D(0.05, -1, 0.05).normalize(),
    });
    pendantLight.position.set(0.05, 1.95, -0.2);
    pendantLight.castShadow = true;
    pendantLight.shadowBias = 0.002;
    // 2048 instead of 1024: reduces the blocky stair-step aliasing on the sofa/stair shadows. The
    // engine's shadow filter is a contact-hardening 3x3 PCF (no cinematic soft-shadow blur), so
    // the highest impact is map resolution for cleaner edges.
    pendantLight.shadowResolution = 2048;
    this._pendantLight = pendantLight;
    this.scene.add(pendantLight);

    // Upward Ceiling Fill Light from Pendant
    const pendantUpLight = new SpotLight({
      color: new Color(1, 0.944, 0.877),
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
    // Floor lamp accent light -- warmed (rose instead of magenta) and damped (0.28) so its wall
    // wash reads as a soft cozy accent, not a clashing magenta splash (user decision).
    const floorLampLight = new PointLight({
      color: new Color(1, 0.793, 0.73),
      intensity: 0.28,
      distance: 2.4,
      decay: 2.0,
    });
    floorLampLight.position.set(-0.1, 1.35, -2.15);
    this._floorLampLight = floorLampLight;
    this.scene.add(floorLampLight);

    // Fireplace fire light (Warm firelight inside hearth, Consensus 15) -- there is now a real
    // HearthFire below (see section 7), so the light is no longer a hidden "bulb behind bricks":
    // it is driven by the fire's FireLightBehavior (temperature follows the flicker). Base kept at
    // a hearth-appropriate 1.6 so the room mood stays cozy instead of a blown-out fire glare.
    const fireplaceLight = new PointLight({
      color: new Color(1, 0.696, 0.381),
      intensity: 1.6,
      distance: 6.0,
      decay: 2.0,
    });
    fireplaceLight.position.set(2.15, 0.35, -0.15);
    this._fireplaceLight = fireplaceLight;
    this.scene.add(fireplaceLight);

    // Candle Cluster PointLight (Warm flickering glow on coffee table, Consensus 3) -- 0.52 keeps
    // the candles intimate instead of behaving like small high-intensity spotlights.
    const candleLight = new PointLight({
      color: new Color(1, 0.822, 0.502),
      intensity: 0.52,
      distance: 2.0,
      decay: 2.0,
    });
    candleLight.position.set(-0.05, 0.58, -0.35);
    this._candleLight = candleLight;
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

    // Hearth cavity: the dark plug from the shipping baseline becomes a real recessed firebox the
    // camera can look into. Thin cavity panels replace the solid cube ("no flat glow plane, no
    // packed glowing spheres" stays doctrine -- the fire below is what lives here now).
    const hearthFloor = new Object3D("HearthFloor");
    hearthFloor.geometry = cubeGeom;
    hearthFloor.material = darkInteriorMat;
    hearthFloor.scale.set(0.8, 0.05, 0.52);
    hearthFloor.position.set(0, 0.025, 0.26);
    hearthFloor.receiveShadow = true;
    fireplace.add(hearthFloor);

    const hearthBack = new Object3D("HearthBack");
    hearthBack.geometry = cubeGeom;
    hearthBack.material = darkInteriorMat;
    hearthBack.scale.set(0.8, 0.7, 0.05);
    hearthBack.position.set(0, 0.36, 0.5);
    fireplace.add(hearthBack);

    const hearthSideL = new Object3D("HearthSideL");
    hearthSideL.geometry = cubeGeom;
    hearthSideL.material = darkInteriorMat;
    hearthSideL.scale.set(0.05, 0.7, 0.5);
    hearthSideL.position.set(-0.4, 0.36, 0.26);
    fireplace.add(hearthSideL);

    const hearthSideR = new Object3D("HearthSideR");
    hearthSideR.geometry = cubeGeom;
    hearthSideR.material = darkInteriorMat;
    hearthSideR.scale.set(0.05, 0.7, 0.5);
    hearthSideR.position.set(0.4, 0.36, 0.26);
    fireplace.add(hearthSideR);

    // Logs laid in the cavity for the fire to burn on, reusing the scene's beam material.
    const hearthLogGeom = new Cylinder({
      radiusTop: 0.045,
      radiusBottom: 0.045,
      height: 0.5,
      radialSegments: 10,
    }).getGeometryData();
    const hearthLogs: ReadonlyArray<readonly [number, number, number, number]> = [
      [-0.16, 0.06, 0.18, 0.5],
      [0.16, 0.06, 0.32, -0.4],
      [-0.1, 0.06, 0.36, 0.15],
      [0.04, 0.12, 0.2, -0.25],
      [0.12, 0.12, 0.3, 0.7],
    ];
    for (let i = 0; i < hearthLogs.length; i++) {
      const placement = hearthLogs[i]!;
      const log = new Object3D(`HearthLog_${i}`);
      log.geometry = hearthLogGeom;
      log.material = beamMat;
      log.rotation.z = Math.PI / 2;
      log.rotation.y = placement[3]!;
      log.position.set(placement[0]!, placement[1]!, placement[2]!);
      log.castShadow = true;
      fireplace.add(log);
    }

    // HearthFire fills the cavity through the shared Fire prefab (plan P-compose): flame cards,
    // glow, embers, smoke, ember bed and soot. Positioned in fireplace-local coordinates (the
    // group rotates them with the mantel); the embers/smoke meshes go to the scene root because
    // their instance matrices are world-space. Driven externally in update() so the room's other
    // living-light rig is untouched.
    const hearthFire = new Fire({
      name: "HearthFire",
      preset: "campfire",
      position: new Vector3D(0.05, 0.05, 0.25),
      seed: 1,
      temperatureK: 1950,
      // No smoke in the sealed masonry firebox: without a chimney shaft the plume clips the hood
      // and the firelight (distance 6) blows the puffs out into a uniform bright wall across the
      // opening. The flame/glow/embers/bed/soot carry the fire; smoke stays a showcase-45 demo.
      data: { width: 0.44, height: 0.6, glowSize: 1.05, glowIntensity: 0.5, smoke: false },
      light: fireplaceLight,
    });
    fireplace.add(hearthFire.root);
    // Bed and soot were authored in the same local frame — parent them here so they rotate with
    // the hearth; the injected light stays scene-level at its authored hearth position.
    fireplace.add(hearthFire.emberBed!.mesh);
    hearthFire.emberBed!.mesh.position.set(0, 0.065, 0.25);
    fireplace.add(hearthFire.soot!);
    hearthFire.soot!.position.set(0, 0.06, 0.25);
    hearthFire.soot!.scale.set(0.7, 0.12, 0.4);
    this.scene.add(hearthFire.embers!.mesh);
    if (hearthFire.smoke) this.scene.add(hearthFire.smoke.mesh);
    this._hearthFire = hearthFire;

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
      new Color(0.659, 0.422, 0.381),
      new Color(0.381, 0.533, 0.481),
      new Color(0.459, 0.459, 0.579),
      new Color(0.621, 0.561, 0.381),
    ];
    for (let shelfIdx = 0; shelfIdx < 4; shelfIdx++) {
      const bookBlock = new Object3D(`Books_${shelfIdx}`);
      bookBlock.geometry = cubeGeom;
      const bColor = bookColors[shelfIdx % bookColors.length] ?? new Color(0.579, 0.481, 0.351);
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
      color: new Color(0.317, 0.351, 0.278),
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

    // The hearth soot decal has no opaque-depth box-decals on WEB_GL1 (ADR 0029): bake it into the
    // floor geometry only there, after the whole scene exists so it clips against nothing else.
    if (this.renderer.type === RendererType.WEB_GL1 && this._hearthFire?.soot) {
      bakeSceneDecals(this.scene.root);
    }

    // QA surface for the automated live gate -- proves the living-light rig actually moves
    // (a static still would keep these identical across samples).
    (window as unknown as Record<string, unknown>)["__qaSwm37"] = {
      sample: (): { candle: number; fire: number; flame: number } => ({
        candle: this._candleLight?.intensity ?? 0,
        fire: this._fireplaceLight?.intensity ?? 0,
        flame: this._flameMats[0]?.emissiveIntensity ?? 0,
      }),
      // Points the fly camera straight at the hearth mouth so the automated gate (and any visual
      // review) can actually look INTO the firebox instead of the default living-room framing
      // which clips the fireplace to a thin sliver on the right edge. Uses setInitialCamera so the
      // FPS strategy's theta/phi (not only position/target) are re-oriented.
      faceHearth: (): void => {
        if (!this.camera) return;
        this.setInitialCamera(new Vector3D(1.05, 0.95, 0.15), new Vector3D(2.35, 0.45, -0.2));
      },
    };
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._flickerT += deltaTime;
    const t = this._flickerT;

    // Candle cluster: fast, small-amplitude quiver (a living flame, not a bulb).
    if (this._candleLight) {
      this._candleLight.intensity = 0.52 * this._flicker(t, 21.0, 0.16, 7.3);
    }
    // Fireplace wood fire: the full HearthFire prefab (flame, glow, embers, smoke, bed, soot) is
    // driven here with the live camera — pause/slow-motion are not part of this room's rig, so raw
    // deltaTime is correct. Its FireLightBehavior takes over the fireplace light intensity/colour.
    if (this._hearthFire) {
      this._hearthFire.update(deltaTime, this.camera.position);
    }
    // Floor lamp: faint mains hum.
    if (this._floorLampLight) {
      this._floorLampLight.intensity = 0.28 * this._flicker(t, 3.2, 0.05, 11.8);
    }
    // Pendant bulb: near-imperceptible instability so the hero light never feels synthetic.
    if (this._pendantLight) {
      this._pendantLight.intensity = 2.6 * this._flicker(t, 13.0, 0.03, 5.4);
    }

    // Candle flames + fire bed pulse with the same draft noise. Kept below the old hard 3.0 core
    // so the bloom threshold (0.95) doesn't smear the little flames into plate-sized white discs.
    for (const m of this._flameMats) {
      m.emissiveIntensity = 1.5 + 1.6 * this._flicker(t, 23.0, 0.3, 4.6);
    }
  }

  /** Deterministic organic flicker: damped layered sines + a slow breathe (no Math.random). */
  private _flicker(t: number, speed: number, amp: number, seed: number): number {
    const n =
      Math.sin(t * speed + seed) * 0.55 +
      Math.sin(t * speed * 2.17 + seed * 1.7) * 0.28 +
      Math.sin(t * speed * 3.73 + seed * 2.9) * 0.17;
    const breathe = 1 + 0.045 * Math.sin(t * 0.21 + seed * 6.0);
    const v = (1 + n * amp) * breathe;
    return v < 0 ? 0 : v;
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase37] Failed to start:", err));
