import type { GeometryDataInterface } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  BoundingBox,
  CameraStrategyType,
  Color,
  Cube,
  CullMode,
  Cylinder,
  DirectionalLight,
  GltfLoader,
  GroomingRat,
  Object3D,
  Plane,
  PointLight,
  Sphere,
  StageMovementBehavior,
  StageZone,
  StandardMaterial,
  Texture,
  TextureWrap,
  Torus,
} from "@small-world-machine/engine";
import { OrbitController } from "@small-world-machine/engine/core/controllers/OrbitController.js";
import { OilPuddleMaterial } from "@small-world-machine/liquid-extras";
import { Vector2D } from "@small-world-machine/engine/math/index.js";
import { ViennaMapModal } from "../../ui/ViennaMapModal.js";
import { PlayerRig } from "../shared/PlayerRig.js";
import type { PlayerRigType } from "../shared/PlayerRig.js";

/** Half-extent (world units) of the walkable square on the diorama floor. The real floor plate
 * (`topFloor`, see `_buildFoundationPlatform`) spans ±2.1 with the left/back walls sitting right
 * at that edge (see `_buildVaultedWalls`) -- ±1.9 leaves a small margin so the character can't
 * walk into a wall, while still covering effectively the whole open floor. Unlike the 2.5D stage
 * scenes (flakturm-tunnel), this is a REAL 3D floor viewed by a free-orbiting camera
 * (`OrbitController`), so every `StageZone` point uses `scale: 1.0` -- no forced-perspective
 * illusion needed or wanted here, see docs/guides/2-5d-scenes.md §3 ("doesn't apply" case). */
const FLOOR_HALF_SIZE = 1.9;

export class CharacterDioramaShowcase extends AbstractShowcase {
  private _dioramaRoot: Object3D | undefined;
  /** Player rig owning every character/clip/lantern/crossfade concern -- see `scenes/shared/PlayerRig.ts`. */
  private _playerRig: PlayerRig | undefined;
  /** Guards the one-shot default showcase pose (the original `_loadCharacter`'s first-load
   * `root.rotation.y = -0.5` line) so it is applied exactly once, right after the first switch
   * completes -- preserves the original sequence byte-for-byte regardless of loop timing. */
  private _firstCharacterReady: boolean = false;
  private _turntableActive: boolean = false;
  private _oilSlickMaterial: OilPuddleMaterial | undefined;
  /** Held state for the SHIFT+arrow-key character-rotation controls (continuous, not a per-press
   * toggle) -- see `_initHUD()`'s keydown/keyup listeners and the `update()` rotation step. Only
   * active while SHIFT is held; plain arrows/WASD walk instead (see `_movementBehavior`), same
   * split as flakturm-tunnel's `MANUAL_ROTATE_SPEED` convention. */
  private _rotateLeftHeld: boolean = false;
  private _rotateRightHeld: boolean = false;
  private static readonly _ROTATE_SPEED = 1.5; // radians per second
  private _stageZone: StageZone | undefined;

  // Textures
  private _wallTexture: Texture | undefined;
  private _floorTexture: Texture | undefined;
  private _floorNormalTexture: Texture | undefined;
  private _floorRoughnessTexture: Texture | undefined;
  private _brickTexture: Texture | undefined;
  private _barrelTexture: Texture | undefined;
  private _barrelNormalTexture: Texture | undefined;
  private _barrelRoughnessTexture: Texture | undefined;
  private _crateTexture: Texture | undefined;
  private _crateNormalTexture: Texture | undefined;
  private _crateRoughnessTexture: Texture | undefined;
  private _debrisTexture: Texture | undefined;
  private _debrisNormalTexture: Texture | undefined;
  private _debrisRoughnessTexture: Texture | undefined;

  // HUD Elements
  private _lblChar!: HTMLElement;
  private _lblTorch!: HTMLElement;
  private _lblTurntable!: HTMLElement;
  private _lblNoir!: HTMLElement;
  private _mapModal!: ViennaMapModal;
  private _animButtons: HTMLButtonElement[] = [];
  private _hudBoxes: HTMLElement[] = [];
  private _hudVisible: boolean = false;

  // Articulated Grooming & Diorama Rats
  private _rat2Head: Object3D | undefined;
  private _rat2TailSegments: Object3D[] = [];
  private _rat3Head: Object3D | undefined;

  // Lamp Flicker & Bulbs
  private _lampLight1: PointLight | undefined;
  private _lampLight2: PointLight | undefined;
  private _bulbMat1: StandardMaterial | undefined;
  private _bulbMat2: StandardMaterial | undefined;

  public override async setupScene(): Promise<void> {
    this.camera.position.set(3.8, 2.7, 4.2);
    this.camera.target.set(0, 1.1, 0);
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);

    this.camera.addBehavior(
      new OrbitController({
        input: this.input,
        lookSensitivity: 0.005,
        rotationSpeed: 1.5,
      }),
    );

    // 1. Studio & Environmental Lighting
    const ambientLight = new DirectionalLight({ color: new Color(0.533, 0.551, 0.621) });
    ambientLight.intensity = 0.65;
    ambientLight.position.set(1.0, 6.0, 2.0);
    this.scene.add(ambientLight);

    const keySpot = new PointLight({ color: new Color(1, 0.963, 0.893) });
    keySpot.intensity = 2.2;
    keySpot.distance = 12.0;
    keySpot.position.set(2.2, 3.8, 2.6);
    this.scene.add(keySpot);

    const cyberRimLight = new PointLight({ color: new Color(0.459, 0.793, 0.929) });
    cyberRimLight.intensity = 1.4;
    cyberRimLight.distance = 8.0;
    cyberRimLight.position.set(-2.5, 2.0, -2.5);
    this.scene.add(cyberRimLight);

    // 2. Load Textures
    try {
      this._wallTexture = await Texture.fromUrl("/assets/the-whisper/diorama/wall_tiles.webp", {
        addressModeU: TextureWrap.REPEAT,
        addressModeV: TextureWrap.REPEAT,
      });
      this._floorTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/floor_pavement.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
        },
      );
      this._floorNormalTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/floor_pavement_normal.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
        },
      );
      this._floorRoughnessTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/floor_pavement_roughness.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
        },
      );
      this._brickTexture = await Texture.fromUrl("/assets/the-whisper/diorama/brick_masonry.webp", {
        addressModeU: TextureWrap.REPEAT,
        addressModeV: TextureWrap.REPEAT,
      });
      this._barrelTexture = await Texture.fromUrl("/assets/the-whisper/diorama/barrel_rust.webp", {
        addressModeU: TextureWrap.REPEAT,
        addressModeV: TextureWrap.REPEAT,
        flipY: true,
      });
      this._barrelNormalTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/barrel_rust_normal.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
          flipY: true,
        },
      );
      this._barrelRoughnessTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/barrel_rust_roughness.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
          flipY: true,
        },
      );
      this._crateTexture = await Texture.fromUrl("/assets/the-whisper/diorama/crate_wood.webp", {
        addressModeU: TextureWrap.REPEAT,
        addressModeV: TextureWrap.REPEAT,
        flipY: true,
      });
      this._crateNormalTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/crate_wood_normal.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
          flipY: true,
        },
      );
      this._crateRoughnessTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/crate_wood_roughness.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
          flipY: true,
        },
      );
      this._debrisTexture = await Texture.fromUrl("/assets/the-whisper/diorama/debris_pile.webp", {
        addressModeU: TextureWrap.REPEAT,
        addressModeV: TextureWrap.REPEAT,
        flipY: true,
      });
      this._debrisNormalTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/debris_pile_normal.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
          flipY: true,
        },
      );
      this._debrisRoughnessTexture = await Texture.fromUrl(
        "/assets/the-whisper/diorama/debris_pile_roughness.webp",
        {
          addressModeU: TextureWrap.REPEAT,
          addressModeV: TextureWrap.REPEAT,
          flipY: true,
        },
      );
    } catch (err) {
      console.warn("[CharacterDiorama] Texture loading fallback:", err);
    }

    // 3. Build 3D Diorama Stage Geometry
    this._dioramaRoot = new Object3D("DioramaRoot");
    this.scene.add(this._dioramaRoot);

    this._buildFoundationPlatform();
    this._buildVaultedWalls();
    this._buildCutawayStubs();
    this._buildIndustrialPipes();
    await this._buildConstructionLamps();
    this._buildCornerDebrisPile();
    await this._buildStreetProps();
    this._buildCornerRats();

    // 4. Walkable floor as one StageZone covering the open square (see FLOOR_HALF_SIZE) --
    // scale 1.0 throughout, real 3D depth via the free-orbiting camera, no forced perspective.
    this._stageZone = new StageZone({
      id: "diorama_floor",
      name: "DIORAMA-BODEN",
      points: [
        { u: 0, v: 0, scale: 1.0 },
        { u: 1, v: 0, scale: 1.0 },
        { u: 1, v: 1, scale: 1.0 },
        { u: 0, v: 1, scale: 1.0 },
      ],
    });

    // 5. Player rig + initial character (all shared player plumbing lives in `PlayerRig` -- see
    // `scenes/shared/PlayerRig.ts`; `C` cycles the skin, see `_cycleCharacter`).
    this._buildPlayerRig();
    this._initHUD();
    await this._playerRig!.switchCharacter("male");
  }

  /**
   * 1. 3D Foundation Podest (Bodenplatte mit echter PBR-Pflastertextur & Schichten)
   */
  private _buildFoundationPlatform(): void {
    const root = this._dioramaRoot!;
    const floorPavementMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: this._floorTexture,
      normalMap: this._floorNormalTexture,
      normalScale: new Vector2D(2.0, 2.0),
      roughnessMap: this._floorRoughnessTexture,
      roughness: 0.92,
      metallic: 0.02,
    });
    const concreteMat = new StandardMaterial({
      color: new Color(0.35, 0.36, 0.38),
      diffuseMap: this._brickTexture,
      roughness: 0.9,
    });
    const brickSubMat = new StandardMaterial({
      color: new Color(0.85, 0.85, 0.85),
      diffuseMap: this._brickTexture,
      roughness: 0.85,
    });

    // Oberste Pflaster-Fläche
    const topFloor = new Object3D("TopFloorPavement");
    topFloor.geometry = new Cube({ size: 1.0 }).getGeometryData();
    topFloor.scale.set(4.2, 0.04, 4.2);
    topFloor.material = floorPavementMat;
    topFloor.position.set(0, -0.02, 0);
    root.add(topFloor);

    // Massiver Unterbau-Kern (0.35m dicke Fundamentschicht)
    const slabCore = new Object3D("FoundationSlabCore");
    slabCore.geometry = new Cube({ size: 1.0 }).getGeometryData();
    slabCore.scale.set(4.2, 0.35, 4.2);
    slabCore.material = concreteMat;
    slabCore.position.set(0, -0.215, 0);
    root.add(slabCore);

    // Gebrochene gestufte Ziegel- und Steinblöcke an den Schnittkanten (+X und +Z)
    for (let i = 0; i < 7; i++) {
      const stepBlockX = new Object3D("FoundationBrickStepX_" + i);
      stepBlockX.geometry = new Cube({ size: 1.0 }).getGeometryData();
      const w = 0.45 + (i % 3) * 0.15;
      const h = 0.14;
      const d = 0.28;
      stepBlockX.scale.set(w, h, d);
      stepBlockX.material = i % 2 === 0 ? brickSubMat : concreteMat;
      stepBlockX.position.set(-1.8 + i * 0.6, -0.18 - (i % 3) * 0.05, 2.16);
      stepBlockX.rotation.y = i % 2 === 0 ? 0.06 : -0.06;
      root.add(stepBlockX);

      const stepBlockZ = new Object3D("FoundationBrickStepZ_" + i);
      stepBlockZ.geometry = new Cube({ size: 1.0 }).getGeometryData();
      stepBlockZ.scale.set(d, h, w);
      stepBlockZ.material = i % 2 === 0 ? brickSubMat : concreteMat;
      stepBlockZ.position.set(2.16, -0.18 - (i % 3) * 0.05, -1.8 + i * 0.6);
      stepBlockZ.rotation.y = i % 2 === 0 ? -0.06 : 0.06;
      root.add(stepBlockZ);
    }
  }

  /**
   * 2. Gewölbte Backstein-Mauern (mit PBR Fliesen- & Ziegeltexturen)
   */
  private _buildVaultedWalls(): void {
    const root = this._dioramaRoot!;
    const wallTileMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: this._wallTexture,
      roughness: 0.4,
      metallic: 0.08,
    });
    // Custom single-panel geometry (see _buildArchWallGeometry) -- cull mode NONE is a safety
    // net for whichever winding direction its normals end up matching after the arch-height
    // displacement, verified against the previous per-column cubes' correct outward orientation.
    wallTileMat.cullMode = CullMode.NONE;
    const brickMasonryMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: this._brickTexture,
      roughness: 0.85,
      metallic: 0.05,
    });

    const numColumns = 10;
    const colWidth = 4.2 / numColumns;
    const wallThickness = 0.24;
    const wallWidth = 4.2;
    const peakHeight = 3.6;
    const archHeight = (t: number): number => peakHeight - Math.pow(t, 1.7) * 1.75;

    // --- Linke Wand: 1 zusammenhängendes Mesh mit stetigen UVs statt 10 einzeln gestreckter
    // Würfel (siehe .agents/notes/diorama.md Abschnitt 1.1 "Zebra-Effekt" + Abschnitt 5.1). ---
    const leftWallPanel = new Object3D("LeftWallPanel");
    leftWallPanel.geometry = this._buildArchWallGeometry(
      "x",
      -2.1 - wallThickness / 2,
      1,
      -2.1,
      wallWidth,
      peakHeight,
      16,
      archHeight,
    );
    leftWallPanel.material = wallTileMat;
    root.add(leftWallPanel);

    // --- Rückwand: dasselbe. ---
    const backWallPanel = new Object3D("BackWallPanel");
    backWallPanel.geometry = this._buildArchWallGeometry(
      "z",
      -2.1 - wallThickness / 2,
      1,
      -2.1,
      wallWidth,
      peakHeight,
      16,
      archHeight,
    );
    backWallPanel.material = wallTileMat;
    root.add(backWallPanel);

    // Kopfbogen-Ziegel (Stirnseite/Ziegeldicke oben) bleiben pro Säule -- eigenes Material,
    // eigene kleine Fläche, von der UV-Streckung nicht betroffen.
    for (let i = 0; i < numColumns; i++) {
      const t = i / (numColumns - 1);
      const colHeight = archHeight(t);

      const posZ = -2.1 + (i + 0.5) * colWidth;
      const topCapLeft = new Object3D("TopCapLeft_" + i);
      topCapLeft.geometry = new Cube({ size: 1.0 }).getGeometryData();
      topCapLeft.scale.set(wallThickness + 0.04, 0.12, colWidth);
      topCapLeft.material = brickMasonryMat;
      topCapLeft.position.set(-2.1 - wallThickness / 2, colHeight + 0.06, posZ);
      topCapLeft.rotation.x = t * 0.35;
      root.add(topCapLeft);

      const posX = -2.1 + (i + 0.5) * colWidth;
      const topCapBack = new Object3D("TopCapBack_" + i);
      topCapBack.geometry = new Cube({ size: 1.0 }).getGeometryData();
      topCapBack.scale.set(colWidth, 0.12, wallThickness + 0.04);
      topCapBack.material = brickMasonryMat;
      topCapBack.position.set(posX, colHeight + 0.06, -2.1 - wallThickness / 2);
      topCapBack.rotation.z = -t * 0.35;
      root.add(topCapBack);
    }

    // Gestufte, unregelmäßig ausgebrochene Ziegel-Zähne an den beiden äußeren Stirnseiten-Schnitten.
    // Jede Reihe variiert in Höhe, Vorsprungtiefe, Länge und leichter Verkippung -- ein perfekt
    // gleichmäßiges Zick-Zack-Raster (feste 0.22-Schrittweite, feste 2-Phasen-Alternanz) sah zu
    // gebaut/ordentlich aus, nicht wie eine tatsächlich eingestürzte Mauerkante. Deterministischer
    // Sinus-Hash statt Math.random(), damit das Bruchmuster bei jedem Laden gleich aussieht.
    const toothRnd = (seed: number): number => {
      const x = Math.sin(seed * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    let toothYLeft = 0.16;
    let toothIndexLeft = 0;
    while (toothYLeft < 1.95) {
      const seed = toothIndexLeft * 7.31 + 11;
      const brickHeight = 0.13 + toothRnd(seed) * 0.11;
      const protrusion = toothRnd(seed + 1) * 0.12 - 0.02; // kann leicht zurückspringen
      const brickLength = 0.15 + toothRnd(seed + 2) * 0.14;
      const missing = toothRnd(seed + 3) < 0.2; // ausgebrochener/fehlender Ziegel

      if (!missing) {
        const toothLeft = new Object3D("ToothLeft_" + toothIndexLeft);
        toothLeft.geometry = new Cube({ size: 1.0 }).getGeometryData();
        toothLeft.scale.set(
          wallThickness + Math.max(protrusion, 0.0) + 0.02,
          brickHeight,
          brickLength,
        );
        toothLeft.material = brickMasonryMat;
        toothLeft.position.set(
          -2.1 - wallThickness / 2 - Math.max(protrusion, 0.0) * 0.4,
          toothYLeft + brickHeight / 2,
          2.14 + (toothRnd(seed + 4) - 0.5) * 0.22,
        );
        toothLeft.rotation.x = (toothRnd(seed + 5) - 0.5) * 0.3;
        toothLeft.rotation.y = (toothRnd(seed + 6) - 0.5) * 0.2;
        toothLeft.rotation.z = (toothRnd(seed + 7) - 0.5) * 0.22;
        root.add(toothLeft);
      }

      toothYLeft += brickHeight + toothRnd(seed + 8) * 0.05;
      toothIndexLeft++;
    }

    let toothYRight = 0.16;
    let toothIndexRight = 0;
    while (toothYRight < 1.95) {
      // Anderer Offset in der Seed-Sequenz, damit die rechte Seite nicht wie ein Spiegelbild
      // der linken aussieht.
      const seed = toothIndexRight * 9.73 + 401;
      const brickHeight = 0.13 + toothRnd(seed) * 0.11;
      const protrusion = toothRnd(seed + 1) * 0.12 - 0.02;
      const brickLength = 0.15 + toothRnd(seed + 2) * 0.14;
      const missing = toothRnd(seed + 3) < 0.2;

      if (!missing) {
        const toothRight = new Object3D("ToothRight_" + toothIndexRight);
        toothRight.geometry = new Cube({ size: 1.0 }).getGeometryData();
        toothRight.scale.set(
          brickLength,
          brickHeight,
          wallThickness + Math.max(protrusion, 0.0) + 0.02,
        );
        toothRight.material = brickMasonryMat;
        toothRight.position.set(
          2.14 + (toothRnd(seed + 4) - 0.5) * 0.22,
          toothYRight + brickHeight / 2,
          -2.1 - wallThickness / 2 - Math.max(protrusion, 0.0) * 0.4,
        );
        toothRight.rotation.x = (toothRnd(seed + 5) - 0.5) * 0.22;
        toothRight.rotation.y = (toothRnd(seed + 6) - 0.5) * 0.2;
        toothRight.rotation.z = (toothRnd(seed + 7) - 0.5) * 0.3;
        root.add(toothRight);
      }

      toothYRight += brickHeight + toothRnd(seed + 8) * 0.05;
      toothIndexRight++;
    }
  }

  /**
   * Baut ein zusammenhängendes, gebogenes Wandpanel (ein Mesh statt N einzelner Säulen-Cubes),
   * damit die Textur eine stetige UV-Zuordnung über die gesamte Wandbreite bekommt statt an
   * jeder Säulengrenze neu zu wiederholen (siehe .agents/notes/diorama.md Abschnitt 1.1 + 5.1).
   *
   * Geometrie: 2 Zeilen (Boden Y=0, Bogenkante Y=archHeight(t)) x (widthSegments+1) Spalten.
   * Normalen werden explizit als fixe Achsrichtung gesetzt (nicht aus der Windung abgeleitet),
   * die Windung selbst ist daher für die Beleuchtung irrelevant -- CullMode.NONE am Material
   * ist das Sicherheitsnetz, falls eine Seite trotzdem "falsch herum" gewinded ist.
   */
  private _buildArchWallGeometry(
    axis: "x" | "z",
    fixedCoord: number,
    normalDir: number,
    alongStart: number,
    width: number,
    peakHeight: number,
    widthSegments: number,
    archHeightFn: (t: number) => number,
  ): GeometryDataInterface {
    const vertices: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= widthSegments; i++) {
      const t = i / widthSegments;
      const along = alongStart + t * width;
      const topY = archHeightFn(t);

      if (axis === "x") {
        vertices.push(fixedCoord, 0, along, fixedCoord, topY, along);
        normals.push(normalDir, 0, 0, normalDir, 0, 0);
      } else {
        vertices.push(along, 0, fixedCoord, along, topY, fixedCoord);
        normals.push(0, 0, normalDir, 0, 0, normalDir);
      }
      // V wird gespiegelt (1 - ...), analog zu Ground.ts -- die Engine lädt Texturen mit Zeile 0
      // oben, sonst steht das Wandmotiv auf dem Kopf.
      uvs.push(t, 1, t, 1 - topY / peakHeight);
    }

    for (let i = 0; i < widthSegments; i++) {
      const bl = i * 2;
      const tl = i * 2 + 1;
      const br = (i + 1) * 2;
      const tr = (i + 1) * 2 + 1;
      indices.push(bl, tl, br, tl, tr, br);
    }

    const verticesArray = new Float32Array(vertices);
    return {
      vertices: verticesArray,
      indices: new Uint16Array(indices),
      uvs: new Float32Array(uvs),
      normals: new Float32Array(normals),
      getBoundingVolume: () => BoundingBox.fromVertices(verticesArray),
    };
  }

  /**
   * 3. Herausgerissene Rohrstümpfe & lose herabhängende Kabelstränge
   */
  private _buildCutawayStubs(): void {
    const root = this._dioramaRoot!;
    const rustyPipeMat = new StandardMaterial({
      color: new Color(0.42, 0.28, 0.22),
      metallic: 0.75,
      roughness: 0.45,
    });
    const darkCableMat = new StandardMaterial({
      color: new Color(0.12, 0.14, 0.16),
      roughness: 0.7,
    });

    // 1. Rohrstümpfe am Fundament (vorne links unter dem Boden)
    const floorPipe1 = new Object3D("FloorPipeStub1");
    floorPipe1.geometry = new Cylinder({
      radiusTop: 0.075,
      radiusBottom: 0.075,
      height: 0.6,
      radialSegments: 12,
    }).getGeometryData();
    floorPipe1.material = rustyPipeMat;
    floorPipe1.rotation.x = Math.PI / 2 + 0.12;
    floorPipe1.rotation.y = 0.18;
    floorPipe1.position.set(-0.65, -0.18, 2.28);
    root.add(floorPipe1);

    const floorPipe2 = new Object3D("FloorPipeStub2");
    floorPipe2.geometry = new Cylinder({
      radiusTop: 0.055,
      radiusBottom: 0.055,
      height: 0.5,
      radialSegments: 10,
    }).getGeometryData();
    floorPipe2.material = rustyPipeMat;
    floorPipe2.rotation.x = Math.PI / 2 + 0.16;
    floorPipe2.position.set(-0.35, -0.24, 2.24);
    root.add(floorPipe2);

    // 2. Rohrstumpf an der rechten Wand-Schnittfläche
    const wallPipeRight = new Object3D("WallPipeStubRight");
    wallPipeRight.geometry = new Cylinder({
      radiusTop: 0.065,
      radiusBottom: 0.065,
      height: 0.55,
      radialSegments: 12,
    }).getGeometryData();
    wallPipeRight.material = rustyPipeMat;
    wallPipeRight.rotation.z = Math.PI / 2 - 0.22;
    wallPipeRight.position.set(2.32, 2.2, -2.05);
    root.add(wallPipeRight);

    // 3. Rohrstumpf an der linken Wand-Schnittfläche
    const wallPipeLeft = new Object3D("WallPipeStubLeft");
    wallPipeLeft.geometry = new Cylinder({
      radiusTop: 0.065,
      radiusBottom: 0.065,
      height: 0.55,
      radialSegments: 12,
    }).getGeometryData();
    wallPipeLeft.material = rustyPipeMat;
    wallPipeLeft.rotation.x = Math.PI / 2 + 0.22;
    wallPipeLeft.position.set(-2.05, 2.2, 2.32);
    root.add(wallPipeLeft);

    // 4. Lose Kabelbündel / Drahtstränge an der rechten Schnittseite
    for (let c = 0; c < 3; c++) {
      const cable = new Object3D("DanglingCableRight_" + c);
      cable.geometry = new Cylinder({
        radiusTop: 0.007,
        radiusBottom: 0.005,
        height: 0.75 + c * 0.18,
        radialSegments: 6,
      }).getGeometryData();
      cable.material = darkCableMat;
      cable.rotation.z = -0.18 + c * 0.14;
      cable.rotation.x = 0.12 * c;
      cable.position.set(2.28 + c * 0.04, 1.55 - c * 0.12, -2.1);
      root.add(cable);
    }

    // 5. Lose Kabelbündel an der linken Schnittseite
    for (let c = 0; c < 3; c++) {
      const cable = new Object3D("DanglingCableLeft_" + c);
      cable.geometry = new Cylinder({
        radiusTop: 0.007,
        radiusBottom: 0.005,
        height: 0.75 + c * 0.18,
        radialSegments: 6,
      }).getGeometryData();
      cable.material = darkCableMat;
      cable.rotation.x = 0.18 - c * 0.14;
      cable.rotation.z = -0.12 * c;
      cable.position.set(-2.1, 1.55 - c * 0.12, 2.28 + c * 0.04);
      root.add(cable);
    }
  }

  /**
   * 4. 3D Schutt- & Trümmerhaufen in der Ecke (Texturiertes Polygon-Relief + 3D-Trümmer)
   */
  private _buildCornerDebrisPile(): void {
    const root = this._dioramaRoot!;
    const debrisMoundMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: this._debrisTexture,
      normalMap: this._debrisNormalTexture,
      normalScale: new Vector2D(2.2, 2.2),
      roughnessMap: this._debrisRoughnessTexture,
      roughness: 0.92,
      metallic: 0.05,
    });
    debrisMoundMat.cullMode = CullMode.NONE;

    // 1. Großes unebenes "Polygon-Etwas" (Müllberg-Mesh)
    const debrisMound = new Object3D("DebrisMound");
    debrisMound.geometry = this._buildDebrisMoundGeometry();
    debrisMound.material = debrisMoundMat;
    root.add(debrisMound);

    const brickMat = new StandardMaterial({
      color: new Color(0.9, 0.9, 0.9),
      diffuseMap: this._brickTexture,
      roughness: 0.85,
    });
    const tileShardMat = new StandardMaterial({
      color: new Color(0.9, 0.9, 0.9),
      diffuseMap: this._wallTexture,
      roughness: 0.4,
    });
    const tinCanMat = new StandardMaterial({
      color: new Color(0.65, 0.68, 0.72),
      metallic: 0.9,
      roughness: 0.25,
    });

    // 2. Herausragende 3D-Ziegelsteine im und am Haufen
    const brickPositions = [
      [-1.35, 0.22, -1.15, 0.35, 0.22],
      [-1.15, 0.18, -1.35, -0.45, 0.15],
      [-1.65, 0.28, -1.55, 0.8, -0.2],
      [-1.25, 0.24, -1.25, -0.25, 0.45],
      [-0.95, 0.12, -1.25, 0.5, 0.0],
      [-1.25, 0.14, -0.95, 0.15, -0.35],
      [-1.55, 0.32, -1.45, 0.45, 0.3],
      [-0.75, 0.06, -1.1, 0.6, -0.1],
    ];

    brickPositions.forEach((pos, idx) => {
      const brick = new Object3D("DebrisBrick_" + idx);
      brick.geometry = new Cube({ size: 1.0 }).getGeometryData();
      brick.scale.set(0.24, 0.11, 0.12);
      brick.material = brickMat;
      brick.position.set(pos[0]!, pos[1]!, pos[2]!);
      brick.rotation.y = pos[3]!;
      brick.rotation.z = pos[4]!;
      root.add(brick);
    });

    // 3. Abgeplatzte Fliesenscherben auf dem Haufen
    const shardPositions = [
      [-1.15, 0.16, -1.05, 0.55],
      [-1.4, 0.25, -1.15, -0.75],
      [-1.05, 0.15, -1.3, 0.25],
      [-1.3, 0.22, -1.45, -0.35],
      [-0.85, 0.08, -1.2, 0.4],
    ];

    shardPositions.forEach((pos, idx) => {
      const shard = new Object3D("TileShard_" + idx);
      shard.geometry = new Plane({ width: 0.18, height: 0.18 }).getGeometryData();
      shard.material = tileShardMat;
      shard.position.set(pos[0]!, pos[1]!, pos[2]!);
      shard.rotation.x = -Math.PI / 2 + 0.15;
      shard.rotation.y = pos[3]!;
      root.add(shard);
    });

    // 4. Zerdrückte Blechdosen
    for (let c = 0; c < 3; c++) {
      const tinCan = new Object3D("DebrisCan_" + c);
      tinCan.geometry = new Cylinder({
        radiusTop: 0.04,
        radiusBottom: 0.04,
        height: 0.12,
        radialSegments: 10,
      }).getGeometryData();
      tinCan.scale.set(1.0, 0.65, 0.85); // Leicht zerbeult
      tinCan.material = tinCanMat;
      tinCan.rotation.z = Math.PI / 2;
      tinCan.rotation.y = c * 1.1;
      tinCan.position.set(-1.1 - c * 0.2, 0.12 - c * 0.03, -1.2 - c * 0.1);
      root.add(tinCan);
    }
  }

  /**
   * Baut ein unebenes, zerklüftetes Polygon-Mesh für den Schutt- und Müllhaufen im Mauereck.
   */
  private _buildDebrisMoundGeometry(): GeometryDataInterface {
    const segs = 8;
    const minX = -2.05;
    const maxX = -0.45;
    const minZ = -2.05;
    const maxZ = -0.45;

    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const getCragNoise = (ix: number, iz: number): number => {
      const s = Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453;
      return (s - Math.floor(s)) * 2.0 - 1.0;
    };

    for (let iz = 0; iz <= segs; iz++) {
      const tz = iz / segs;
      const z = minZ + tz * (maxZ - minZ);

      for (let ix = 0; ix <= segs; ix++) {
        const tx = ix / segs;
        const x = minX + tx * (maxX - minX);

        const distFromCorner = Math.sqrt(tx * tx + tz * tz) / Math.SQRT2;
        let h = Math.max(0, 0.44 * (1.0 - Math.pow(distFromCorner, 1.3)));

        if (tx < 0.95 && tz < 0.95 && distFromCorner < 0.9) {
          const noise = getCragNoise(ix, iz);
          h += noise * 0.05 + Math.sin(tx * 8.0) * Math.cos(tz * 8.0) * 0.04;
          h = Math.max(0.015, h);
        } else {
          h = 0.005;
        }

        vertices.push(x, h, z);
        uvs.push(tx, tz);
      }
    }

    for (let iz = 0; iz < segs; iz++) {
      for (let ix = 0; ix < segs; ix++) {
        const i0 = iz * (segs + 1) + ix;
        const i1 = i0 + 1;
        const i2 = (iz + 1) * (segs + 1) + ix;
        const i3 = i2 + 1;

        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      }
    }

    const vArr = new Float32Array(vertices);
    const nArr = new Float32Array(vertices.length);

    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 3;
      const b = indices[i + 1]! * 3;
      const c = indices[i + 2]! * 3;

      const ax = vArr[a]!,
        ay = vArr[a + 1]!,
        az = vArr[a + 2]!;
      const bx = vArr[b]!,
        by = vArr[b + 1]!,
        bz = vArr[b + 2]!;
      const cx = vArr[c]!,
        cy = vArr[c + 1]!,
        cz = vArr[c + 2]!;

      const abx = bx - ax,
        aby = by - ay,
        abz = bz - az;
      const acx = cx - ax,
        acy = cy - ay,
        acz = cz - az;

      const fnx = aby * acz - abz * acy;
      const fny = abz * acx - abx * acz;
      const fnz = abx * acy - aby * acx;
      nArr[a] = (nArr[a] ?? 0) + fnx;
      nArr[a + 1] = (nArr[a + 1] ?? 0) + fny;
      nArr[a + 2] = (nArr[a + 2] ?? 0) + fnz;

      nArr[b] = (nArr[b] ?? 0) + fnx;
      nArr[b + 1] = (nArr[b + 1] ?? 0) + fny;
      nArr[b + 2] = (nArr[b + 2] ?? 0) + fnz;

      nArr[c] = (nArr[c] ?? 0) + fnx;
      nArr[c + 1] = (nArr[c + 1] ?? 0) + fny;
      nArr[c + 2] = (nArr[c + 2] ?? 0) + fnz;
    }

    for (let i = 0; i < nArr.length; i += 3) {
      const nx = nArr[i]!,
        ny = nArr[i + 1]!,
        nz = nArr[i + 2]!;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
      nArr[i] = nx / len;
      nArr[i + 1] = ny / len;
      nArr[i + 2] = nz / len;
    }

    return {
      vertices: vArr,
      indices: new Uint16Array(indices),
      uvs: new Float32Array(uvs),
      normals: nArr,
      getBoundingVolume: () => BoundingBox.fromVertices(vArr),
    };
  }

  private _buildIndustrialPipes(): void {
    const root = this._dioramaRoot!;
    const copperMat = new StandardMaterial({
      color: new Color(0.72, 0.45, 0.28),
      metallic: 0.9,
      roughness: 0.2,
    });
    const steelMat = new StandardMaterial({
      color: new Color(0.35, 0.38, 0.42),
      metallic: 0.94,
      roughness: 0.25,
    });
    const valveRedMat = new StandardMaterial({
      color: new Color(0.85, 0.15, 0.12),
      metallic: 0.35,
      roughness: 0.4,
    });

    // Horizontales Rohr um die 90°-Ecke
    const hPipeBack = new Object3D("HorizontalPipeBack");
    hPipeBack.geometry = new Cylinder({
      radiusTop: 0.075,
      radiusBottom: 0.075,
      height: 4.1,
      radialSegments: 16,
    }).getGeometryData();
    hPipeBack.material = copperMat;
    hPipeBack.rotation.z = Math.PI / 2;
    hPipeBack.position.set(0.0, 2.2, -1.95);
    root.add(hPipeBack);

    const hPipeLeft = new Object3D("HorizontalPipeLeft");
    hPipeLeft.geometry = new Cylinder({
      radiusTop: 0.075,
      radiusBottom: 0.075,
      height: 4.1,
      radialSegments: 16,
    }).getGeometryData();
    hPipeLeft.material = copperMat;
    hPipeLeft.rotation.x = Math.PI / 2;
    hPipeLeft.position.set(-1.95, 2.2, 0.0);
    root.add(hPipeLeft);

    // Eck-Winkel (Elbow)
    const cornerElbow = new Object3D("CornerPipeElbow");
    cornerElbow.geometry = new Torus({
      radius: 0.12,
      tube: 0.075,
      radialSegments: 12,
      tubularSegments: 16,
    }).getGeometryData();
    cornerElbow.material = copperMat;
    cornerElbow.position.set(-1.95, 2.2, -1.95);
    root.add(cornerElbow);

    // Wandhalterungen & Flansche
    for (const pos of [
      [-1.1, 2.2, -1.95],
      [0.6, 2.2, -1.95],
      [-1.95, 2.2, -1.1],
      [-1.95, 2.2, 0.6],
    ]) {
      const flange = new Object3D("Flange");
      flange.geometry = new Cylinder({
        radiusTop: 0.1,
        radiusBottom: 0.1,
        height: 0.04,
        radialSegments: 14,
      }).getGeometryData();
      flange.material = steelMat;
      if (pos[0] === -1.95) {
        flange.rotation.x = Math.PI / 2;
      } else {
        flange.rotation.z = Math.PI / 2;
      }
      flange.position.set(pos[0]!, pos[1]!, pos[2]!);
      root.add(flange);
    }

    // Rotes Handrad-Ventil
    const valve = new Object3D("ValveWheel");
    valve.geometry = new Torus({
      radius: 0.11,
      tube: 0.018,
      radialSegments: 12,
      tubularSegments: 16,
    }).getGeometryData();
    valve.material = valveRedMat;
    valve.position.set(-0.2, 2.2, -1.82);
    root.add(valve);

    // Vertikales Fallrohr
    const vPipe = new Object3D("VerticalDrainPipe");
    vPipe.geometry = new Cylinder({
      radiusTop: 0.07,
      radiusBottom: 0.07,
      height: 3.2,
      radialSegments: 16,
    }).getGeometryData();
    vPipe.material = steelMat;
    vPipe.position.set(0.35, 1.6, -1.95);
    root.add(vPipe);
  }

  private async _buildConstructionLamps(): Promise<void> {
    const root = this._dioramaRoot!;
    const gltfLoader = new GltfLoader();

    let lampMesh1: Object3D | undefined;
    let lampMesh2: Object3D | undefined;

    try {
      lampMesh1 = await gltfLoader.load("/assets/the-whisper/diorama/wall_lamp.glb");
      lampMesh2 = await gltfLoader.load("/assets/the-whisper/diorama/wall_lamp.glb");
    } catch (e) {
      console.warn("[CharacterDiorama] Could not load wall_lamp.glb:", e);
    }

    const darkCableMat = new StandardMaterial({
      color: new Color(0.18, 0.2, 0.22),
      metallic: 0.8,
      roughness: 0.4,
    });

    // 1. Industrielle Bunker-Wandleuchte an der linken Wand (Tripo3D Schiffsarmatur mit Schutzgitter)
    const lampGroupLeft = new Object3D("IndustrialWallLamp_Left");
    lampGroupLeft.position.set(-2.0, 2.35, -0.35);
    lampGroupLeft.rotation.y = Math.PI / 2;

    if (lampMesh1) {
      lampMesh1.scale.set(0.38, 0.38, 0.38);
      lampMesh1.rotation.y = -Math.PI / 2;
      lampGroupLeft.add(lampMesh1);
    }

    const light1 = new PointLight({ color: new Color(1, 0.934, 0.805) });
    light1.intensity = 3.8;
    light1.distance = 11.0;
    light1.position.set(0, 0, 0.18);
    lampGroupLeft.add(light1);
    this._lampLight1 = light1;

    // Vertikales Schutzrohr nach unten zum Hauptleitungsrohr
    const conduitLeft = new Object3D("ConduitPipeLeft");
    conduitLeft.geometry = new Cylinder({
      radiusTop: 0.012,
      radiusBottom: 0.012,
      height: 1.4,
      radialSegments: 8,
    }).getGeometryData();
    conduitLeft.material = darkCableMat;
    conduitLeft.position.set(0, -0.85, -0.05);
    lampGroupLeft.add(conduitLeft);

    root.add(lampGroupLeft);

    // 2. Industrielle Bunker-Wandleuchte an der Rückwand
    const lampGroupBack = new Object3D("IndustrialWallLamp_Back");
    lampGroupBack.position.set(0.85, 2.35, -2.0);
    lampGroupBack.rotation.y = 0;

    if (lampMesh2) {
      lampMesh2.scale.set(0.38, 0.38, 0.38);
      lampMesh2.rotation.y = -Math.PI / 2;
      lampGroupBack.add(lampMesh2);
    }

    const light2 = new PointLight({ color: new Color(1, 0.953, 0.839) });
    light2.intensity = 3.8;
    light2.distance = 11.0;
    light2.position.set(0, 0, 0.18);
    lampGroupBack.add(light2);
    this._lampLight2 = light2;

    const conduitBack = new Object3D("ConduitPipeBack");
    conduitBack.geometry = new Cylinder({
      radiusTop: 0.012,
      radiusBottom: 0.012,
      height: 1.4,
      radialSegments: 8,
    }).getGeometryData();
    conduitBack.material = darkCableMat;
    conduitBack.position.set(0, -0.85, -0.05);
    lampGroupBack.add(conduitBack);

    root.add(lampGroupBack);
  }

  private async _buildStreetProps(): Promise<void> {
    const root = this._dioramaRoot!;
    const metalMat = new StandardMaterial({
      color: new Color(0.22, 0.25, 0.28),
      metallic: 0.7,
      roughness: 0.4,
    });
    const sodaMat = new StandardMaterial({
      color: new Color(0.9, 0.1, 0.2),
      metallic: 0.85,
      roughness: 0.2,
    });

    const crateMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: this._crateTexture,
      normalMap: this._crateNormalTexture,
      normalScale: new Vector2D(1.8, 1.8),
      roughnessMap: this._crateRoughnessTexture,
      roughness: 0.92,
      metallic: 0.04,
    });

    const barrelMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: this._barrelTexture,
      normalMap: this._barrelNormalTexture,
      normalScale: new Vector2D(2.5, 2.5),
      roughnessMap: this._barrelRoughnessTexture,
      metallic: 0.5,
      roughness: 0.65,
    });

    // 6 Holzkisten im Eck- und Wandbereich (teilweise im Schutthaufen versunken, teilweise daneben)
    const cratesConfig = [
      // 1. Kiste 1: Tief im Mauereck halb im Müllhaufen versunken & verkeilt
      {
        name: "Crate1",
        size: [0.56, 0.54, 0.56],
        pos: [-1.48, 0.18, -1.35],
        rotX: 0.12,
        rotY: 0.28,
        rotZ: -0.09,
      },
      // 2. Kiste 2: An der Rückwand halb in die Schuttflanke eingegraben
      {
        name: "Crate2",
        size: [0.5, 0.5, 0.5],
        pos: [-1.05, 0.16, -1.62],
        rotX: -0.14,
        rotY: -0.22,
        rotZ: 0.1,
      },
      // 3. Kiste 3: Freistehend auf dem Pflasterboden neben dem Haufen & Fass
      {
        name: "Crate3",
        size: [0.46, 0.44, 0.46],
        pos: [-1.58, 0.22, 0.05],
        rotX: 0.0,
        rotY: 0.3,
        rotZ: 0.0,
      },
      // 4. Kiste 4: Auf Crate1 gestapelt und ragt aus dem Schutt heraus
      {
        name: "Crate4",
        size: [0.48, 0.46, 0.48],
        pos: [-1.44, 0.66, -1.3],
        rotX: 0.08,
        rotY: -0.1,
        rotZ: -0.04,
      },
      // 5. Kiste 5: Freistehend auf dem Pflasterboden zur Raummitte hin
      {
        name: "Crate5",
        size: [0.42, 0.42, 0.42],
        pos: [-0.6, 0.21, -1.55],
        rotX: 0.0,
        rotY: 0.18,
        rotZ: 0.0,
      },
      // 6. Kiste 6: Oberste Kiste auf Crate4 balanciert
      {
        name: "Crate6",
        size: [0.38, 0.36, 0.38],
        pos: [-1.4, 1.07, -1.26],
        rotX: 0.04,
        rotY: 0.16,
        rotZ: 0.02,
      },
    ];

    cratesConfig.forEach((cfg) => {
      const crate = new Object3D(cfg.name);
      crate.geometry = new Cube({ size: 1.0 }).getGeometryData();
      crate.scale.set(cfg.size[0]!, cfg.size[1]!, cfg.size[2]!);
      crate.material = crateMat;
      crate.position.set(cfg.pos[0]!, cfg.pos[1]!, cfg.pos[2]!);
      crate.rotation.x = cfg.rotX;
      crate.rotation.y = cfg.rotY;
      crate.rotation.z = cfg.rotZ;
      root.add(crate);
    });

    // 3D Tripo-PBR Industriefass (Industrial Kit) mit 2x3 Rillenbändern und Verschlusskappe
    let barrelModel: Object3D | undefined;
    try {
      const gltfLoader = new GltfLoader();
      barrelModel = await gltfLoader.load("/assets/the-whisper/diorama/barrel_oil_black.glb");
    } catch {
      // Fallback zu prozeduralem Zylinder
    }

    if (barrelModel) {
      barrelModel.name = "MetalBarrel";
      barrelModel.scale.set(0.82, 0.82, 0.82);
      barrelModel.position.set(-1.45, 0.41, 0.6);
      barrelModel.rotation.y = 0.65;
      root.add(barrelModel);
    } else {
      const metalBarrel = new Object3D("MetalBarrel");
      metalBarrel.geometry = new Cylinder({
        radiusTop: 0.25,
        radiusBottom: 0.25,
        height: 0.78,
        radialSegments: 32,
      }).getGeometryData();
      metalBarrel.material = barrelMat;
      metalBarrel.position.set(-1.45, 0.39, 0.6);
      root.add(metalBarrel);
    }

    // Dicke, schmierige Öllache am Fassboden -- gemutete Dünnschicht-Iridiszenz + ein echtes,
    // dynamisches Glanzlicht (aus den vorhandenen Wandlaternen) plus ein fixer warmer Glimmfleck
    // am Auslaufpunkt. Bewusst ohne Wellen-/Fließanimation: eine träge, fast stehende Lache statt
    // eines bewegten Gewässers. Erste-Klasse-Material aus @small-world-machine/liquid-extras (die frühere
    // app-lokale OilSlickMaterial-Kopie in diesem Ordner wurde zugunsten dieses Material entfernt).
    this._oilSlickMaterial = new OilPuddleMaterial({
      highlightPoint: new Vector2D(0.5, 0.68),
      splatterBaseRadius: 0.4,
      meniscusStrength: 0.9,
    });
    const oilSlick = new Object3D("OilSlick");
    oilSlick.geometry = new Plane({ width: 1.05, height: 0.85 }).getGeometryData();
    oilSlick.material = this._oilSlickMaterial;
    oilSlick.position.set(-1.32, 0.006, 0.68);
    oilSlick.rotation.set(-Math.PI / 2, 0.4, 0);
    oilSlick.receiveShadow = true;
    root.add(oilSlick);

    const can1 = new Object3D("SodaCan1");
    can1.geometry = new Cylinder({
      radiusTop: 0.035,
      radiusBottom: 0.035,
      height: 0.11,
      radialSegments: 12,
    }).getGeometryData();
    can1.material = sodaMat;
    can1.position.set(-0.8, 0.055, -0.9);
    can1.rotation.z = Math.PI / 2;
    can1.rotation.y = 0.4;
    root.add(can1);

    const can2 = new Object3D("SodaCan2");
    can2.geometry = new Cylinder({
      radiusTop: 0.035,
      radiusBottom: 0.035,
      height: 0.11,
      radialSegments: 12,
    }).getGeometryData();
    can2.material = metalMat;
    can2.position.set(-0.6, 0.055, -1.1);
    root.add(can2);

    const grate = new Object3D("DrainGrate");
    grate.geometry = new Cube({ size: 1.0 }).getGeometryData();
    grate.scale.set(0.4, 0.02, 0.4);
    grate.material = metalMat;
    grate.position.set(-1.0, 0.01, 1.2);
    root.add(grate);
  }

  private _buildCornerRats(): void {
    const root = this._dioramaRoot!;
    const ratMat = new StandardMaterial({
      color: new Color(0.24, 0.22, 0.2),
      roughness: 0.92,
      metallic: 0.02,
    });
    const pinkMat = new StandardMaterial({
      color: new Color(0.88, 0.58, 0.58),
      roughness: 0.45,
      metallic: 0.05,
    });
    const eyeMat = new StandardMaterial({
      color: new Color(1.0, 0.05, 0.05),
      roughness: 0.1,
      metallic: 0.8,
    });

    // ==========================================
    // 1. Ratte 1: Die Haupt-Putzratte (wiederverwendbare GroomingRat Extension)
    // ==========================================
    const rat1 = new GroomingRat({
      furColor: new Color(0.24, 0.22, 0.2),
      skinColor: new Color(0.88, 0.58, 0.58),
      eyeColor: new Color(1.0, 0.05, 0.05),
    });
    // Auf Kiste 3 platziert (Crate3 bei [-1.58, 0.22, 0.05], 0.44m Höhe -> Deckfläche bei y = 0.44)
    rat1.position.set(-1.54, 0.45, 0.06);
    rat1.rotation.y = 0.85; // Blickt schräg in den beleuchteten Raum & zum Spieler
    root.add(rat1);

    // ==========================================
    // 2. Ratte 2: Schnüffelnde Ratte auf dem Schutthaufen (blickt in den Raum)
    // ==========================================
    const rat2 = new Object3D("Rat_DebrisSniffer");
    rat2.position.set(-1.18, 0.26, -1.08);
    rat2.rotation.y = 0.78; // Blickt in den offenen Raum / zur Raummitte
    root.add(rat2);

    const body2 = new Object3D("Rat2Body");
    body2.geometry = new Sphere({
      radius: 0.06,
      widthSegments: 10,
      heightSegments: 8,
    }).getGeometryData();
    body2.material = ratMat;
    body2.scale.set(0.95, 0.8, 1.5);
    rat2.add(body2);

    const head2 = new Object3D("Rat2Head");
    head2.position.set(0, 0.03, 0.08);
    rat2.add(head2);
    this._rat2Head = head2;

    const skull2 = new Object3D("Rat2Skull");
    skull2.geometry = new Sphere({
      radius: 0.038,
      widthSegments: 8,
      heightSegments: 6,
    }).getGeometryData();
    skull2.material = ratMat;
    skull2.scale.set(0.85, 0.85, 1.25);
    head2.add(skull2);

    for (const side of [-0.022, 0.022]) {
      const eye = new Object3D("Rat2Eye_" + (side < 0 ? "L" : "R"));
      eye.geometry = new Sphere({
        radius: 0.0065,
        widthSegments: 6,
        heightSegments: 6,
      }).getGeometryData();
      eye.material = eyeMat;
      eye.position.set(side, 0.012, 0.025);
      head2.add(eye);
    }

    this._rat2TailSegments = [];
    let tZ2 = -0.08;
    for (let s = 0; s < 5; s++) {
      const seg = new Object3D("Rat2Tail_" + s);
      seg.geometry = new Cylinder({
        radiusTop: 0.01 - s * 0.0015,
        radiusBottom: 0.008 - s * 0.0015,
        height: 0.05,
        radialSegments: 6,
      }).getGeometryData();
      seg.material = pinkMat;
      seg.rotation.x = Math.PI / 2;
      seg.position.set(-0.01 * s, -0.01, tZ2);
      rat2.add(seg);
      this._rat2TailSegments.push(seg);
      tZ2 -= 0.042;
    }

    // ==========================================
    // 3. Ratte 3: Neugierig lauernde Ratte zwischen Kiste 1 & 2
    // ==========================================
    const rat3 = new Object3D("Rat_Peeker");
    rat3.position.set(-1.25, 0.06, -1.82);
    rat3.rotation.y = 0.35;
    root.add(rat3);

    const head3 = new Object3D("Rat3Head");
    head3.geometry = new Sphere({
      radius: 0.042,
      widthSegments: 8,
      heightSegments: 6,
    }).getGeometryData();
    head3.material = ratMat;
    head3.scale.set(0.85, 0.85, 1.25);
    rat3.add(head3);
    this._rat3Head = head3;

    for (const side of [-0.024, 0.024]) {
      const eye = new Object3D("Rat3Eye_" + (side < 0 ? "L" : "R"));
      eye.geometry = new Sphere({
        radius: 0.007,
        widthSegments: 6,
        heightSegments: 6,
      }).getGeometryData();
      eye.material = eyeMat;
      eye.position.set(side, 0.015, 0.028);
      head3.add(eye);
    }
  }

  /** Builds the shared player rig with this scene's per-scene settings (scales, the movement
   *  factory bound to this diorama's floor zone, the matte material pass, the lantern light).
   *  Everything else -- clip pool, crossfade, lantern hand-bone sync, character switching -- lives
   *  in `PlayerRig` and is identical across the dusk scenes. */
  private _buildPlayerRig(): void {
    const lanternLight = new PointLight({ color: new Color(1, 0.904, 0.659) });
    lanternLight.intensity = 1.8;
    lanternLight.distance = 4.5;

    this._playerRig = new PlayerRig({
      parent: this._dioramaRoot!,
      lanternParent: this.scene.root,
      input: this.input,
      defaultStartUV: { u: 0.526, v: 0.526 },
      characters: {
        male: {
          url: "/assets/the-whisper/mannequin/player-male/character.glb",
          scale: 1.7,
        },
        female: {
          url: "/assets/the-whisper/mannequin/player-female/character.glb",
          scale: 1.7,
        },
        yoshi: {
          url: "/assets/the-whisper/mannequin/yoshi/character.glb",
          scale: 1.35,
        },
      },
      lanternLight,
      adjustMaterials: (player: Object3D): void => {
        // Matte Oberflächen für Kleidung und Haut (verhindert unnatürlichen Latex-/Speck-Glanz) --
        // in-place auf dem StandardMaterial, nicht Ersetzung (anders als der Tunnel-Showcase).
        const matte = (obj: Object3D): void => {
          if (obj.material && obj.material instanceof StandardMaterial) {
            obj.material.roughness = 0.92;
            obj.material.metallic = 0.02;
            obj.material.metallicMap = undefined;
          }
          for (const child of obj.children) {
            matte(child);
          }
        };
        matte(player);
      },
      createMovementBehavior: (startUv): StageMovementBehavior =>
        new StageMovementBehavior({
          input: this.input,
          speed: 0.28,
          runMultiplier: 2.0,
          rotationSpeed: 12.0,
          facingOffset: Math.PI, // same rig convention as flakturm-tunnel's identical mannequin assets
          startFacing: "back",
          zones: this._stageZone ? [this._stageZone] : [],
          // A floor-plane mapping (v -> world Z, fixed Y), not a backdrop-wall mapping (v -> world
          // Y, fixed Z) -- doesn't fit StageProjection's "flat-plane" shape, so this stays "custom".
          projection: { mode: "custom" },
          customUvToWorld: (u: number, v: number): { x: number; y: number; z: number } => ({
            x: (u - 0.5) * 2 * FLOOR_HALF_SIZE,
            y: 0,
            z: (v - 0.5) * 2 * FLOOR_HALF_SIZE,
          }),
          startUV: startUv,
        }),
      onCharacterReady: (): void => {
        // Original showcase pose is a deliberate aesthetic default (angled toward the camera at
        // rest) -- applied once, after the behavior's own first-load setup. Preserved byte-for-
        // byte from the old `_loadCharacter`'s first-load line, even though the rig/behavior may
        // overwrite `rotation.y` again on the loop's first frame; keeping the exact original
        // sequence removes any dependence on loop timing.
        if (!this._firstCharacterReady) {
          this._firstCharacterReady = true;
          this._playerRig!.root.rotation.y = -0.5;
        }
        this._updateHUDLabels();
        this._playAnimation(this._playerRig!.lanternEnabled ? "idle_torch" : "idle_1", 0);
      },
    });
  }

  /** Thin wrapper: delegates playback to the shared rig and keeps the HUD button highlight in
   *  sync. The rig owns the actual crossfade machinery (see `scenes/shared/PlayerRig.ts`). */
  private _playAnimation(name: string, fadeSeconds: number = 0.35): void {
    this._playerRig?.play(name, { fadeSeconds });
    this._updateActiveButtonUI(name);
  }

  private _toggleNoir(): void {
    const active =
      this.renderer.postProcessing.enabled && this.renderer.postProcessing.filterMode === 2;
    if (active) {
      this.renderer.postProcessing.enabled = false;
      this.renderer.postProcessing.filterMode = 0;
      if (this._lblNoir) this._lblNoir.textContent = "AUS";
      const btn = document.getElementById("btn-noir");
      if (btn) btn.classList.remove("active");
    } else {
      this.renderer.postProcessing.enabled = true;
      this.renderer.postProcessing.filterMode = 2;
      if (this._lblNoir) this._lblNoir.textContent = "AN";
      const btn = document.getElementById("btn-noir");
      if (btn) btn.classList.add("active");
    }
  }

  private _initHUD(): void {
    // The giant keyboard-shortcut boxes (`.info-badge` + `.deck-panel`, see index.html) cover the
    // barrel and the oil puddle -- hidden by default; [H] brings them back for interactive sessions.
    this._hudBoxes = Array.from(document.querySelectorAll<HTMLElement>(".info-badge, .deck-panel"));
    this._setHudVisible(false);

    this._mapModal = new ViennaMapModal("character_diorama");
    this._lblChar = document.getElementById("lbl-char")!;
    this._lblTorch = document.getElementById("lbl-torch")!;
    this._lblTurntable = document.getElementById("lbl-turntable")!;
    this._lblNoir = document.getElementById("lbl-noir")!;

    document.getElementById("btn-char")?.addEventListener("click", () => this._cycleCharacter());
    document.getElementById("btn-torch")?.addEventListener("click", () => this._toggleTorch());
    document
      .getElementById("btn-turntable")
      ?.addEventListener("click", () => this._toggleTurntable());
    document.getElementById("btn-noir")?.addEventListener("click", () => this._toggleNoir());
    document.getElementById("btn-map")?.addEventListener("click", () => this._mapModal.toggle());

    const animContainer = document.getElementById("anim-buttons");
    if (animContainer) {
      this._animButtons = Array.from(
        animContainer.querySelectorAll<HTMLButtonElement>("button[data-anim]"),
      );
      this._animButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const anim = btn.getAttribute("data-anim");
          if (anim) this._playAnimation(anim);
        });
      });
    }

    window.addEventListener("keydown", (e) => {
      const k = e.key.toUpperCase();
      if (k === "C") this._cycleCharacter();
      else if (k === "L") this._toggleTorch();
      else if (k === "N") this._toggleNoir();
      else if (k === "H") this._setHudVisible(!this._hudVisible);
      else if (k === " ") {
        e.preventDefault();
        this._toggleTurntable();
      } else if (k === "1") this._playAnimation("idle_1");
      else if (k === "2") this._playAnimation("idle_2");
      else if (k === "3") this._playAnimation("idle_torch");
      else if (k === "4") this._playAnimation("walk");
      else if (k === "5") this._playAnimation("walk_torch");
      else if (k === "6") this._playAnimation("run_1");
      else if (k === "7") this._playAnimation("run_2");
      else if (k === "8") this._playAnimation("run_torch");
      else if (k === "9") this._playAnimation("stairs_up");
      else if (k === "0") this._playAnimation("stairs_down");
      else if (e.key === "ArrowLeft") {
        e.preventDefault();
        this._rotateLeftHeld = true;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        this._rotateRightHeld = true;
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "ArrowLeft") this._rotateLeftHeld = false;
      else if (e.key === "ArrowRight") this._rotateRightHeld = false;
    });
    // A held arrow key stops being tracked as "held" if the keyup never reaches this page (e.g.
    // released while another window had focus) -- clear both on blur so rotation can't get stuck.
    window.addEventListener("blur", () => {
      this._rotateLeftHeld = false;
      this._rotateRightHeld = false;
    });
  }

  private _setHudVisible(visible: boolean): void {
    this._hudVisible = visible;
    for (const el of this._hudBoxes) {
      el.style.display = visible ? "" : "none";
    }
  }

  private _cycleCharacter(): void {
    const current = this._playerRig?.currentType ?? "male";
    const next: PlayerRigType =
      current === "male" ? "female" : current === "female" ? "yoshi" : "male";
    // The rig guards re-entrancy (a fast double `C` returns the same in-flight switch) and
    // propagates load errors -- fail fast, caught once here.
    this._playerRig
      ?.switchCharacter(next)
      .catch((err: unknown) => console.error("[CharacterDiorama] Character switch failed:", err));
  }

  private _toggleTorch(): void {
    if (!this._playerRig) return;
    this._playerRig.setLanternEnabled(!this._playerRig.lanternEnabled);
    const lanternOn = this._playerRig.lanternEnabled;
    const active = this._playerRig.activeAnimation;

    if (active === "idle_1" || active === "idle_2") {
      if (lanternOn) this._playAnimation("idle_torch");
    } else if (active === "idle_torch") {
      if (!lanternOn) this._playAnimation("idle_1");
    } else if (active === "walk" && lanternOn) {
      this._playAnimation("walk_torch");
    } else if (active === "walk_torch" && !lanternOn) {
      this._playAnimation("walk");
    } else if ((active === "run_1" || active === "run_2") && lanternOn) {
      this._playAnimation("run_torch");
    } else if (active === "run_torch" && !lanternOn) {
      this._playAnimation("run_1");
    }

    this._updateHUDLabels();
  }

  private _toggleTurntable(): void {
    this._turntableActive = !this._turntableActive;
    this._updateHUDLabels();
  }

  private _updateHUDLabels(): void {
    const charType = this._playerRig?.currentType ?? "male";
    const lanternOn = this._playerRig?.lanternEnabled ?? true;
    if (this._lblChar) {
      this._lblChar.textContent =
        charType === "male"
          ? "Spieler (Männlich)"
          : charType === "female"
            ? "Spielerin (Weiblich)"
            : "🦖 Yoshi";
    }
    if (this._lblTorch) {
      this._lblTorch.textContent = lanternOn ? "AN" : "AUS";
      this._lblTorch.style.color = lanternOn ? "#ffb84d" : "#8a99ad";
    }
    if (this._lblTurntable) {
      this._lblTurntable.textContent = this._turntableActive ? "AN" : "AUS";
      this._lblTurntable.style.color = this._turntableActive ? "#00f0ff" : "#8a99ad";
    }
  }

  private _updateActiveButtonUI(activeAnim: string): void {
    this._animButtons.forEach((btn) => {
      if (btn.getAttribute("data-anim") === activeAnim) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  public override update(deltaTime: number): void {
    super.update(deltaTime);

    if (this._turntableActive && this._dioramaRoot) {
      this._dioramaRoot.rotation.y += deltaTime * 0.35;
    }

    // SHIFT+[←]/[→]: manual in-place rotation, same convention as flakturm-tunnel's
    // MANUAL_ROTATE_SPEED. Takes priority over walking while held -- StageMovementBehavior gets
    // disabled for the duration so the two controls don't fight over rotation.y, since it also
    // reads plain arrow keys for movement.
    const isShiftHeld = this.input.isPressed("ShiftLeft") || this.input.isPressed("ShiftRight");
    const rigRoot = this._playerRig?.root;
    const movement = this._playerRig?.movementBehavior;
    if (rigRoot && isShiftHeld && (this._rotateLeftHeld || this._rotateRightHeld)) {
      if (movement) movement.enabled = false;
      if (this._rotateLeftHeld)
        rigRoot.rotation.y -= deltaTime * CharacterDioramaShowcase._ROTATE_SPEED;
      if (this._rotateRightHeld)
        rigRoot.rotation.y += deltaTime * CharacterDioramaShowcase._ROTATE_SPEED;
    } else if (movement) {
      movement.enabled = true;
    }

    if (this._oilSlickMaterial) {
      this._oilSlickMaterial.time += deltaTime;
    }

    // Clip crossfade, animation playback and lantern hand-bone sync all live in the shared rig.
    this._playerRig?.update(deltaTime);

    const time = performance.now() * 0.001;

    // Kräftiges, unregelmäßiges Halogen-Flackern mit Spannungs-Dips (Graphic Noir Stimmung)
    if (this._lampLight1) {
      const n1 =
        Math.sin(time * 8.5) * 0.7 + Math.sin(time * 19.3) * 0.45 + Math.sin(time * 41.7) * 0.3;
      const brownout1 = Math.sin(time * 2.3) > 0.82 && Math.sin(time * 37.0) > 0.1 ? 1.6 : 0.0;
      const intensity1 = Math.max(0.8, 3.8 + n1 - brownout1);
      this._lampLight1.intensity = intensity1;

      if (this._bulbMat1) {
        const glowFactor = Math.min(1.0, intensity1 / 3.8);
        this._bulbMat1.color.set(1.0 * glowFactor, 0.94 * glowFactor, 0.78 * glowFactor);
      }
    }

    if (this._lampLight2) {
      const n2 =
        Math.sin(time * 9.7 + 1.4) * 0.7 +
        Math.sin(time * 21.1) * 0.45 +
        Math.sin(time * 39.2) * 0.3;
      const brownout2 =
        Math.sin(time * 2.9 + 1.1) > 0.85 && Math.sin(time * 43.0) > 0.1 ? 1.8 : 0.0;
      const intensity2 = Math.max(0.8, 3.8 + n2 - brownout2);
      this._lampLight2.intensity = intensity2;

      if (this._bulbMat2) {
        const glowFactor = Math.min(1.0, intensity2 / 3.8);
        this._bulbMat2.color.set(1.0 * glowFactor, 0.94 * glowFactor, 0.78 * glowFactor);
      }
    }

    // Ratte 2 & 3: Umgebungs-Animationen (Schnüffeln & Hervorlugen)
    if (this._rat2Head) {
      this._rat2Head.rotation.x = Math.sin(time * 8.0) * 0.12 + Math.sin(time * 22.0) * 0.03;
      this._rat2Head.rotation.y = Math.sin(time * 1.8) * 0.25;
    }
    for (let s = 0; s < this._rat2TailSegments.length; s++) {
      const seg = this._rat2TailSegments[s]!;
      seg.rotation.y = Math.sin(time * 3.2 + s * 0.8) * (0.12 + s * 0.07);
    }

    // Ratte 3: Vorsichtiges Hervorlugen
    if (this._rat3Head) {
      this._rat3Head.position.z = Math.sin(time * 1.2) * 0.02;
      this._rat3Head.rotation.y = Math.sin(time * 2.5) * 0.2;
    }
  }
}

const app = new CharacterDioramaShowcase();
app.start().catch((err) => console.error("[CharacterDiorama] Startup failed:", err));
