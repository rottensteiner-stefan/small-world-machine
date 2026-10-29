import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  Object3D,
  OrbitController,
  Plane,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";
import {
  MetalReliefMaterial,
  MetalReliefScreenMaterial,
  ImpastoStrokeMaterial,
  buildStrokeSplats,
  rasterizeSplatColor,
  rasterizeSplatDirection,
} from "@small-world-machine/artistic-extras";
import type { StrokePoint } from "@small-world-machine/artistic-extras";
import { MetalReliefHud } from "./Hud.js";
import type { MetalReliefHudHost, ReliefParam } from "./Hud.js";

function createBoxMesh(
  name: string,
  width: number,
  height: number,
  depth: number,
  mat: MetalReliefMaterial,
): Object3D {
  const obj = new Object3D(name);
  obj.geometry = new Cube({ size: 1 }).getGeometryData();
  obj.setScale(width, height, depth);
  obj.material = mat;
  return obj;
}

function createPlaneMesh(
  name: string,
  width: number,
  height: number,
  mat: MetalReliefMaterial | MetalReliefScreenMaterial | ImpastoStrokeMaterial,
): Object3D {
  const obj = new Object3D(name);
  obj.geometry = new Plane({ width: 1, height: 1 }).getGeometryData();
  obj.setScale(width, height, 1);
  obj.material = mat;
  return obj;
}

function createCylinderMesh(
  name: string,
  radius: number,
  height: number,
  mat: MetalReliefMaterial,
): Object3D {
  const obj = new Object3D(name);
  obj.geometry = new Cylinder({
    radiusTop: radius,
    radiusBottom: radius,
    height,
    radialSegments: 8,
  }).getGeometryData();
  obj.material = mat;
  return obj;
}

/**
 * Mirrors a canvas vertically so that, uploaded un-flipped (engine default),
 * it samples upright on the top-down UVs of the engine Plane (v=1 = top).
 */
function flipCanvasVertically(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  ctx.translate(0, out.height);
  ctx.scale(1, -1);
  ctx.drawImage(src, 0, 0);
  return out;
}

function createFallbackTexture(name: string, accentColor: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#4a5568";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(128, 128, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name, 128, 134);
  return Texture.fromCanvas(flipCanvasVertically(canvas));
}

/**
 * Showcase 41: 3D Metal Wall Relief & Assemblage Art.
 * Offers live switching between:
 * 1) 2.5D Diorama (Layered 3D geometry with camera orbit & parallax)
 * 2) Full-Screen Canvas Shader (Single flat 2D image transformed into metal relief)
 */
export class Showcase extends AbstractShowcase {
  protected override defaultCameraController: "fly" | "orbit" | "none" = "orbit";

  private _displayMode: "fullscreen" | "diorama" | "studio" = "fullscreen";
  private _materials: MetalReliefMaterial[] = [];
  private _dioramaRoot: Object3D = new Object3D("DioramaRoot");
  private _focalGroup: Object3D = new Object3D("FocalGroup");
  private _midgroundGroup: Object3D = new Object3D("MidgroundGroup");
  private _wireGroup: Object3D = new Object3D("WireGroup");
  private _screenGroup: Object3D = new Object3D("ScreenGroup");
  private _screenMesh!: Object3D;
  private _screenMaterial!: MetalReliefScreenMaterial;
  private _activePreset: string = "paris";
  private _orbitController?: OrbitController;
  private _hud!: MetalReliefHud;
  private _isHoveringHud: boolean = false;
  private _isDraggingHud: boolean = false;
  private _isDraggingSplit: boolean = false;
  private _customImageAspect: number = 1.3393;

  private _textures: Record<string, Texture> = {};

  // --- Palette Knife Studio (interactive impasto painting) ---
  private readonly _STUDIO_WIDTH = 1024;
  private readonly _STUDIO_HEIGHT = 768;
  private _studioRoot: Object3D = new Object3D("StudioRoot");
  private _studioMaterial!: ImpastoStrokeMaterial;
  private _studioPaintCanvas!: HTMLCanvasElement;
  private _studioDirCanvas!: HTMLCanvasElement;
  private _studioPaintCtx!: CanvasRenderingContext2D;
  private _studioDirCtx!: CanvasRenderingContext2D;
  private _studioPaintTex!: Texture;
  private _studioDirTex!: Texture;
  private _studioSteelTex!: Texture;
  private _isPainting: boolean = false;
  private _lastPointer: StrokePoint = { x: -1, y: -1 };
  private _brushSizeBase: number = 12;
  private _brushMaxRadius: number = 72;
  private _paintColor: string = "#c0392b";
  private _eraserMode: boolean = false;
  private _studioBaseMode: "steel" | "photo" = "steel";
  private _undoSnapshot: ImageData | null = null;
  private _qaNonce: number = 0;
  /** Palette swatches, selected with keys 1-6 while in the studio. */
  private readonly _swatches: string[] = [
    "#c0392b", // oxide red (accent)
    "#d4af37", // gold leaf
    "#b000ff", // engine violet
    "#38bdf8", // steel blue
    "#f1e9d8", // bone white
    "#1e2b26", // charcoal bronze
  ];

  constructor() {
    super({
      canvasId: "SmallWorldMachine",
      fullscreen: true,
      enablePhysics: false,
    });
  }

  protected override async setupScene(): Promise<void> {
    this.camera.position.set(0, 0, 4.2);
    this.camera.target.set(0, 0, 0);

    // --- Lighting ---
    const ambient = new AmbientLight({
      color: new Color(0.822, 0.839, 0.877),
      intensity: 0.45,
    });
    this.scene.add(ambient);

    const sun = new DirectionalLight({
      color: new Color(1, 0.977, 0.944),
      intensity: 0.95,
      direction: new Vector3D(0.4, 0.7, 0.5).normalize(),
    });
    this.scene.add(sun);

    // Preload realistic photographs for Before/After converter
    try {
      this._textures["paris"] = await Texture.fromUrl("./assets/paris_photo.webp");
    } catch {
      try {
        this._textures["paris"] = await Texture.fromUrl("./assets/paris.webp");
      } catch {
        this._textures["paris"] = createFallbackTexture("Paris", "#e53e3e");
      }
    }

    try {
      this._textures["alps"] = await Texture.fromUrl("./assets/alps_photo.webp");
    } catch {
      try {
        this._textures["alps"] = await Texture.fromUrl("./assets/alps.webp");
      } catch {
        this._textures["alps"] = createFallbackTexture("Alps", "#e53e3e");
      }
    }

    try {
      this._textures["harbor"] = await Texture.fromUrl("./assets/harbor_photo.webp");
    } catch {
      try {
        this._textures["harbor"] = await Texture.fromUrl("./assets/harbor.webp");
      } catch {
        this._textures["harbor"] = createFallbackTexture("Harbor", "#3182ce");
      }
    }

    // --- 1. Assemble Diorama Root (2.5D Mode) ---
    this.scene.add(this._dioramaRoot);

    const bgMat = new MetalReliefMaterial({
      color: new Color(0.72, 0.74, 0.78),
      paletteKnifeStrength: 0.5,
      paletteKnifeScale: 14.0,
      scratchIntensity: 0.5,
      scratchScale: 90.0,
      edgeBevelStrength: 0.6,
      rustStrength: 0.8,
      metallic: 0.55,
      roughness: 0.65,
      wetRainStreaks: 0.5,
    });
    this._materials.push(bgMat);

    const bgPlate = createPlaneMesh("BackgroundPlate", 3.4, 4.6, bgMat).setPosition(0, 0, -0.15);
    this._dioramaRoot.add(bgPlate);

    const groundMat = new MetalReliefMaterial({
      color: new Color(0.4, 0.42, 0.45),
      paletteKnifeStrength: 0.8,
      paletteKnifeScale: 20.0,
      scratchIntensity: 0.6,
      scratchScale: 110.0,
      edgeBevelStrength: 1.1,
      rustStrength: 0.85,
      metallic: 0.7,
      roughness: 0.35,
      wetRainStreaks: 0.9,
    });
    this._materials.push(groundMat);

    const groundPlate = createPlaneMesh("GroundPlate", 3.4, 1.6, groundMat).setPosition(
      0,
      -1.5,
      0.02,
    );
    this._dioramaRoot.add(groundPlate);

    this._dioramaRoot.add(this._midgroundGroup);
    this._dioramaRoot.add(this._focalGroup);
    this._dioramaRoot.add(this._wireGroup);

    this._buildParisMotif();

    // --- 2. Assemble Full-Screen Canvas Quad Mode ---
    this._screenMaterial = new MetalReliefScreenMaterial({
      diffuseMap: this._textures["paris"],
      splitPosition: 0.5,
      reliefStrength: 1.5,
      paletteKnifeStrength: 0.5,
      paletteKnifeScale: 24.0,
      scratchIntensity: 0.4,
      scratchScale: 120.0,
      edgeGlintStrength: 1.2,
      wetRainStreaks: 0.5,
      targetHue: 0.0,
      hueTolerance: 0.12,
      desaturation: 0.95,
      rustStrength: 0.8,
    });

    this._screenMesh = createPlaneMesh(
      "ScreenCanvasQuad",
      4.15,
      3.1,
      this._screenMaterial,
    ).setPosition(0, 0, 0);
    this._screenGroup.add(this._screenMesh);
    this.scene.add(this._screenGroup);

    const orbit = new OrbitController({ input: this.input });
    this._orbitController = orbit;
    this.camera.addBehavior(orbit);

    this._createReliefHud();
    this._createWipeOverlayUI();
    this._setupKeyboardShortcuts();
    this._setupCanvasWipeInteraction();
    this._setupDragAndDrop();
    this._buildStudio();
    this._setupStudioInteraction();
    this._installQaHooks();
    this._setMode("fullscreen");
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    if (this._displayMode === "fullscreen") {
      this._updateDividerLinePosition();
    }
  }

  private _setMode(mode: "fullscreen" | "diorama" | "studio"): void {
    const wasStudio = this._displayMode === "studio";
    this._displayMode = mode;
    const overlay = document.getElementById("wipeDividerOverlay");
    this._hud.syncMode(mode);

    const isStudio = mode === "studio";
    this._dioramaRoot.isVisible = mode === "diorama";
    this._screenGroup.isVisible = !isStudio && mode === "fullscreen";
    this._studioRoot.isVisible = isStudio;
    if (overlay) overlay.style.display = mode === "fullscreen" ? "block" : "none";

    if (this._orbitController) {
      this._orbitController.enabled = mode === "diorama";
    }

    if (isStudio) {
      this.camera.position.set(0, 0, 4.0);
      this.camera.target.set(0, 0, 0);
      this._syncStudioBase();
    } else if (mode === "fullscreen") {
      this.camera.position.set(0, 0, 4.0);
      this.camera.target.set(0, 0, 0);
      if (this._screenMaterial && this._textures[this._activePreset]) {
        this._screenMaterial.diffuseMap = this._textures[this._activePreset];
      }
      this._updateMeshAspect();
    } else if (wasStudio) {
      // Leaving the studio: keep the orbit rig in a neutral pose.
      this.camera.position.set(0, 0, 4.0);
      this.camera.target.set(0, 0, 0);
    }
  }

  private _updateMeshAspect(): void {
    if (!this._screenMesh) return;
    const aspect = this._activePreset === "custom" ? this._customImageAspect : 1200 / 896;
    const fov = (65 * Math.PI) / 180;
    const dist = 4.0;
    const visH = 2 * dist * Math.tan(fov / 2);
    const canvas = document.getElementById("SmallWorldMachine") as HTMLCanvasElement | null;
    const winAspect =
      canvas && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 16 / 9;
    const visW = visH * winAspect;

    let h = visH * 0.82;
    let w = h * aspect;
    if (w > visW * 0.88) {
      w = visW * 0.88;
      h = w / aspect;
    }

    this._screenMesh.setScale(w, h, 1);
    this._updateDividerLinePosition();
  }

  private _buildParisMotif(): void {
    this._clearMotifGroups();

    const towerMat = new MetalReliefMaterial({
      color: new Color(0.55, 0.58, 0.62),
      paletteKnifeStrength: 0.65,
      paletteKnifeScale: 18.0,
      scratchIntensity: 0.45,
      scratchScale: 85.0,
      edgeBevelStrength: 1.4,
      rustStrength: 0.75,
      metallic: 0.75,
      roughness: 0.4,
    });
    this._materials.push(towerMat);

    const archLeft = createBoxMesh("TowerLegL", 0.12, 2.2, 0.05, towerMat)
      .setPosition(-0.9, 0.4, 0.02)
      .setRotation(0, 0, -0.18);
    this._midgroundGroup.add(archLeft);

    const archRight = createBoxMesh("TowerLegR", 0.12, 2.2, 0.05, towerMat)
      .setPosition(-0.4, 0.4, 0.02)
      .setRotation(0, 0, 0.18);
    this._midgroundGroup.add(archRight);

    const archTop = createBoxMesh("TowerPlatform", 0.5, 0.08, 0.06, towerMat).setPosition(
      -0.65,
      1.4,
      0.03,
    );
    this._midgroundGroup.add(archTop);

    const towerSpire = createBoxMesh("TowerSpire", 0.08, 1.2, 0.05, towerMat).setPosition(
      -0.65,
      2.0,
      0.03,
    );
    this._midgroundGroup.add(towerSpire);

    const meshMat = new MetalReliefMaterial({
      color: new Color(0.65, 0.65, 0.68),
      wireMeshStrength: 0.9,
      wireMeshScale: 35.0,
      edgeBevelStrength: 1.0,
      scratchIntensity: 0.3,
      metallic: 0.85,
      roughness: 0.35,
    });
    this._materials.push(meshMat);

    const meshPlate = createPlaneMesh("RailingMesh", 1.2, 0.7, meshMat).setPosition(
      0.95,
      -0.65,
      0.05,
    );
    this._midgroundGroup.add(meshPlate);

    const redLacquerMat = new MetalReliefMaterial({
      color: new Color(0.92, 0.06, 0.1),
      paletteKnifeStrength: 0.9,
      paletteKnifeScale: 10.0,
      scratchIntensity: 0.25,
      scratchScale: 70.0,
      edgeBevelStrength: 1.5,
      colorPopTargetHue: 0.0,
      colorPopTolerance: 0.12,
      colorPopDesaturation: 0.98,
      rustStrength: 0.6,
      metallic: 0.4,
      roughness: 0.3,
    });
    this._materials.push(redLacquerMat);

    const umbrellaCenter = createBoxMesh("UmbrellaCenter", 0.95, 0.45, 0.12, redLacquerMat)
      .setPosition(0.55, 0.75, 0.18)
      .setRotation(0, 0, 0.15);
    this._focalGroup.add(umbrellaCenter);

    const umbrellaLeft = createBoxMesh("UmbrellaLeft", 0.35, 0.25, 0.08, redLacquerMat)
      .setPosition(0.15, 0.62, 0.15)
      .setRotation(0, 0, 0.4);
    this._focalGroup.add(umbrellaLeft);

    const umbrellaRight = createBoxMesh("UmbrellaRight", 0.35, 0.25, 0.08, redLacquerMat)
      .setPosition(0.92, 0.72, 0.15)
      .setRotation(0, 0, -0.2);
    this._focalGroup.add(umbrellaRight);

    const coatMat = new MetalReliefMaterial({
      color: new Color(0.2, 0.22, 0.25),
      paletteKnifeStrength: 0.7,
      paletteKnifeScale: 15.0,
      scratchIntensity: 0.5,
      edgeBevelStrength: 1.3,
      metallic: 0.6,
      roughness: 0.5,
    });
    this._materials.push(coatMat);

    const manBody = createBoxMesh("ManCoat", 0.32, 1.15, 0.14, coatMat)
      .setPosition(0.38, -0.05, 0.15)
      .setRotation(0, 0, 0.05);
    this._focalGroup.add(manBody);

    const womanDress = createBoxMesh("WomanDress", 0.26, 0.85, 0.12, redLacquerMat)
      .setPosition(0.62, -0.15, 0.17)
      .setRotation(0, 0, -0.05);
    this._focalGroup.add(womanDress);

    const wireMat = new MetalReliefMaterial({
      color: new Color(0.95, 0.96, 0.98),
      metallic: 0.98,
      roughness: 0.05,
      edgeBevelStrength: 2.0,
    });
    this._materials.push(wireMat);

    for (let i = 0; i < 3; i++) {
      const wire = createCylinderMesh("WireString" + i, 0.008, 3.8, wireMat)
        .setPosition(-0.2, 1.2 - i * 0.15, 0.22)
        .setRotation(0, 0, -0.42);
      this._wireGroup.add(wire);
    }
  }

  private _buildAlpsMotif(): void {
    this._clearMotifGroups();

    const rockMat = new MetalReliefMaterial({
      color: new Color(0.48, 0.52, 0.58),
      paletteKnifeStrength: 1.1,
      paletteKnifeScale: 16.0,
      scratchIntensity: 0.55,
      edgeBevelStrength: 1.6,
      rustStrength: 0.8,
      metallic: 0.5,
      roughness: 0.7,
    });
    this._materials.push(rockMat);

    const peak1 = createBoxMesh("Peak1", 1.5, 1.8, 0.1, rockMat)
      .setPosition(-0.8, -0.2, 0.04)
      .setRotation(0, 0, 0.55);
    this._midgroundGroup.add(peak1);

    const peak2 = createBoxMesh("Peak2", 1.4, 2.0, 0.08, rockMat)
      .setPosition(0.8, -0.1, 0.02)
      .setRotation(0, 0, -0.5);
    this._midgroundGroup.add(peak2);

    const redGondolaMat = new MetalReliefMaterial({
      color: new Color(0.9, 0.08, 0.12),
      paletteKnifeStrength: 0.6,
      paletteKnifeScale: 12.0,
      scratchIntensity: 0.4,
      edgeBevelStrength: 1.4,
      colorPopTargetHue: 0.0,
      colorPopTolerance: 0.12,
      colorPopDesaturation: 0.98,
      metallic: 0.7,
      roughness: 0.35,
    });
    this._materials.push(redGondolaMat);

    const gondolaBody = createBoxMesh("GondolaBody", 0.9, 0.65, 0.18, redGondolaMat).setPosition(
      0.1,
      0.1,
      0.2,
    );
    this._focalGroup.add(gondolaBody);

    const hangerArm = createBoxMesh("GondolaArm", 0.06, 0.75, 0.06, redGondolaMat).setPosition(
      0.1,
      0.72,
      0.2,
    );
    this._focalGroup.add(hangerArm);

    const wireMat = new MetalReliefMaterial({
      color: new Color(0.95, 0.98, 1.0),
      metallic: 0.98,
      roughness: 0.05,
      edgeBevelStrength: 2.0,
    });
    this._materials.push(wireMat);

    for (let i = 0; i < 4; i++) {
      const rope = createCylinderMesh("CableRope" + i, 0.01, 4.2, wireMat)
        .setPosition(0.0, 1.1 - i * 0.12, 0.22)
        .setRotation(0, 0, -0.38);
      this._wireGroup.add(rope);
    }
  }

  private _buildHarborMotif(): void {
    this._clearMotifGroups();

    const blueHouseMat = new MetalReliefMaterial({
      color: new Color(0.25, 0.55, 0.85),
      paletteKnifeStrength: 0.7,
      edgeBevelStrength: 1.2,
      rustStrength: 0.6,
      colorPopTargetHue: 0.58,
      colorPopTolerance: 0.15,
      metallic: 0.4,
    });
    const redHouseMat = new MetalReliefMaterial({
      color: new Color(0.88, 0.15, 0.12),
      paletteKnifeStrength: 0.7,
      edgeBevelStrength: 1.2,
      rustStrength: 0.6,
      colorPopTargetHue: 0.0,
      colorPopTolerance: 0.12,
      metallic: 0.4,
    });
    const yellowHouseMat = new MetalReliefMaterial({
      color: new Color(0.95, 0.75, 0.1),
      paletteKnifeStrength: 0.7,
      edgeBevelStrength: 1.2,
      rustStrength: 0.6,
      colorPopTargetHue: 0.14,
      colorPopTolerance: 0.12,
      metallic: 0.4,
    });
    this._materials.push(blueHouseMat, redHouseMat, yellowHouseMat);

    const house1 = createBoxMesh("HouseBlue", 0.55, 1.4, 0.08, blueHouseMat).setPosition(
      -0.8,
      0.3,
      0.04,
    );
    this._midgroundGroup.add(house1);

    const house2 = createBoxMesh("HouseRed", 0.55, 1.6, 0.1, redHouseMat).setPosition(
      -0.2,
      0.4,
      0.06,
    );
    this._midgroundGroup.add(house2);

    const house3 = createBoxMesh("HouseYellow", 0.55, 1.35, 0.07, yellowHouseMat).setPosition(
      0.4,
      0.28,
      0.03,
    );
    this._midgroundGroup.add(house3);

    const boatHullMat = new MetalReliefMaterial({
      color: new Color(0.2, 0.22, 0.25),
      paletteKnifeStrength: 0.8,
      edgeBevelStrength: 1.5,
      metallic: 0.85,
      roughness: 0.3,
    });
    this._materials.push(boatHullMat);

    const boat = createBoxMesh("BoatHull", 1.6, 0.45, 0.18, boatHullMat).setPosition(
      0.1,
      -0.65,
      0.18,
    );
    this._focalGroup.add(boat);

    const riggingMat = new MetalReliefMaterial({
      color: new Color(0.95, 0.96, 0.98),
      metallic: 0.98,
      roughness: 0.05,
    });
    this._materials.push(riggingMat);

    const mast = createCylinderMesh("Mast", 0.015, 2.6, riggingMat).setPosition(0.2, 0.55, 0.2);
    this._wireGroup.add(mast);

    const shroudLeft = createCylinderMesh("ShroudL", 0.008, 2.2, riggingMat)
      .setPosition(-0.3, 0.45, 0.22)
      .setRotation(0, 0, 0.35);
    this._wireGroup.add(shroudLeft);

    const shroudRight = createCylinderMesh("ShroudR", 0.008, 2.2, riggingMat)
      .setPosition(0.7, 0.45, 0.22)
      .setRotation(0, 0, -0.35);
    this._wireGroup.add(shroudRight);
  }

  private _clearMotifGroups(): void {
    const clear = (group: Object3D): void => {
      while (group.children.length > 0) {
        group.remove(group.children[0]!);
      }
    };
    clear(this._midgroundGroup);
    clear(this._focalGroup);
    clear(this._wireGroup);
  }

  private _setupKeyboardShortcuts(): void {
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this._hud.handleKey(e)) return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;

      const hud = this._hud.root;
      const isHudActive =
        this._hud.isOpen &&
        (this._isHoveringHud || this._isDraggingHud || hud.contains(document.activeElement));

      if (isHudActive) {
        return;
      }

      if (e.code === "KeyM") {
        const next =
          this._displayMode === "fullscreen"
            ? "diorama"
            : this._displayMode === "diorama"
              ? "studio"
              : "fullscreen";
        this._setMode(next);
        return;
      }

      if (e.code === "KeyP") {
        this._setMode(this._displayMode === "studio" ? "fullscreen" : "studio");
        return;
      }

      // ---- Palette Knife Studio controls ----
      if (this._displayMode === "studio") {
        if (e.code === "BracketLeft") {
          this._brushSizeBase = Math.max(3, this._brushSizeBase - 2);
        } else if (e.code === "BracketRight") {
          this._brushSizeBase = Math.min(120, this._brushSizeBase + 2);
        } else if (e.code === "KeyX") {
          this._eraserMode = !this._eraserMode;
        } else if (e.code === "KeyC") {
          this._clearStudio();
        } else if (e.code === "KeyZ") {
          this._undoStudio();
        } else if (e.code === "KeyQ") {
          this._setStudioBase(this._studioBaseMode === "steel" ? "photo" : "steel");
        } else if (e.code >= "Digit1" && e.code <= "Digit6") {
          const idx = parseInt(e.code.charAt(5), 10) - 1;
          const swatch = this._swatches[idx];
          if (swatch) {
            this._paintColor = swatch;
            this._eraserMode = false;
          }
        }
        return;
      }

      if (e.code === "Space" || e.code === "KeyW") {
        if (this._displayMode === "fullscreen") {
          const cur = this._screenMaterial?.splitPosition ?? 0.5;
          this._setSplitPosition(cur > 0.05 ? 0.0 : 0.5);
        }
        return;
      }

      if (e.code === "Digit1") {
        this._setActivePreset("paris");
        return;
      }

      if (e.code === "Digit2") {
        this._setActivePreset("alps");
        return;
      }

      if (e.code === "Digit3") {
        this._setActivePreset("harbor");
        return;
      }
    });
  }

  private _onReliefPanelClosed(): void {
    this._isHoveringHud = false;
    this._isDraggingHud = false;
    if (this._orbitController) {
      this._orbitController.enabled = true;
    }
  }

  private _setActivePreset(presetId: string): void {
    this._activePreset = presetId;
    this._hud.syncPreset(presetId);

    if (presetId === "paris") this._buildParisMotif();
    else if (presetId === "alps") this._buildAlpsMotif();
    else if (presetId === "harbor") this._buildHarborMotif();

    if (this._screenMaterial) {
      if (this._textures[presetId]) {
        this._screenMaterial.diffuseMap = this._textures[presetId];
      }
      if (presetId === "paris") {
        this._screenMaterial.targetHue = 0.0;
        this._screenMaterial.hueTolerance = 0.12;
        this._screenMaterial.desaturation = 0.95;
        this._screenMaterial.rustStrength = 0.8;
      } else if (presetId === "alps") {
        this._screenMaterial.targetHue = 0.0;
        this._screenMaterial.hueTolerance = 0.12;
        this._screenMaterial.desaturation = 0.95;
        this._screenMaterial.rustStrength = 0.75;
      } else if (presetId === "harbor") {
        this._screenMaterial.targetHue = 0.0;
        this._screenMaterial.hueTolerance = 0.14;
        this._screenMaterial.desaturation = 0.92;
        this._screenMaterial.rustStrength = 0.8;
      }
      this._updateMeshAspect();
    }

    // The Palette Knife Studio base layer follows the active preset in photo mode.
    if (this._studioMaterial && this._textures[presetId]) {
      if (this._studioBaseMode === "photo") {
        this._studioMaterial.baseMap = this._textures[presetId];
      }
    }
  }

  private _getScreenMeshBounds(): { left: number; top: number; width: number; height: number } {
    const canvas = document.getElementById("SmallWorldMachine") as HTMLCanvasElement | null;
    if (!canvas || !this._screenMesh) {
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    const rect = canvas.getBoundingClientRect();
    const sx = this._screenMesh.scale.x * 0.5;
    const sy = this._screenMesh.scale.y * 0.5;

    const pMin = this.camera.project(new Vector3D(-sx, -sy, 0));
    const pMax = this.camera.project(new Vector3D(sx, sy, 0));

    const left = rect.left + (pMin.x * 0.5 + 0.5) * rect.width;
    const right = rect.left + (pMax.x * 0.5 + 0.5) * rect.width;
    const top = rect.top + (-pMax.y * 0.5 + 0.5) * rect.height;
    const bottom = rect.top + (-pMin.y * 0.5 + 0.5) * rect.height;

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  private _updateDividerLinePosition(): void {
    if (this._displayMode !== "fullscreen") return;
    const bounds = this._getScreenMeshBounds();
    const line = document.getElementById("wipeDividerLine");
    if (!line) return;

    const curSplit = this._screenMaterial?.splitPosition ?? 0.5;
    const lineX = bounds.left + curSplit * bounds.width;

    line.style.left = `${lineX}px`;
    line.style.top = `${bounds.top}px`;
    line.style.height = `${bounds.height}px`;

    const pillBefore = document.querySelector(".wipe-pill-before") as HTMLElement | null;
    const pillAfter = document.querySelector(".wipe-pill-after") as HTMLElement | null;
    if (pillBefore) {
      pillBefore.style.left = `${Math.max(16, bounds.left + 16)}px`;
      pillBefore.style.top = `${Math.max(76, bounds.top + 16)}px`;
    }
    if (pillAfter) {
      pillAfter.style.right = `${Math.max(16, window.innerWidth - (bounds.left + bounds.width) + 16)}px`;
      pillAfter.style.top = `${Math.max(76, bounds.top + 16)}px`;
    }
  }

  private _setSplitPosition(pos: number): void {
    const clamped = Math.max(0.0, Math.min(1.0, pos));
    if (this._screenMaterial) {
      this._screenMaterial.splitPosition = clamped;
    }
    this._hud.syncSplit(clamped);
    this._updateDividerLinePosition();
  }

  private _createWipeOverlayUI(): void {
    const existingStyle = document.getElementById("reliefTuningStyle");
    if (existingStyle) existingStyle.remove();
    const style = document.createElement("style");
    style.id = "reliefTuningStyle";
    style.textContent = `
      #wipeDividerOverlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 90;
      }
      .wipe-pill {
        position: fixed;
        top: 96px;
        padding: 6px 14px;
        background: rgba(14, 18, 28, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 20px;
        font-family: var(--font-ui, "Rajdhani", sans-serif);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: #f1f5f9;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        user-select: none;
        pointer-events: none;
      }
      .wipe-pill-before {
        left: 24px;
        border-left: 3px solid #38bdf8;
      }
      .wipe-pill-after {
        right: 24px;
        border-right: 3px solid #b000ff;
      }
      .wipe-divider-line {
        position: fixed;
        width: 2px;
        background: #ffffff;
        box-shadow: 0 0 10px rgba(255, 255, 255, 0.8), 0 0 20px rgba(176, 0, 255, 0.5);
        transform: translateX(-50%);
        pointer-events: auto;
        cursor: ew-resize;
      }
      .wipe-handle {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #0f172a;
        border: 2px solid #ffffff;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        cursor: ew-resize;
        user-select: none;
      }
    `;
    document.head.appendChild(style);

    const existing = document.getElementById("wipeDividerOverlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "wipeDividerOverlay";
    overlay.innerHTML = `
      <div class="wipe-pill wipe-pill-before">◀ Original Photo</div>
      <div class="wipe-pill wipe-pill-after">3D Metal Relief ▶</div>
      <div id="wipeDividerLine" class="wipe-divider-line">
        <div class="wipe-handle" title="Drag to compare before & after">
          <span>◀ ❘ ▶</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const dividerLine = overlay.querySelector("#wipeDividerLine") as HTMLElement | null;
    if (dividerLine) {
      dividerLine.addEventListener("pointerdown", (e: PointerEvent) => {
        e.stopPropagation();
        this._isDraggingSplit = true;
      });
    }

    this._updateDividerLinePosition();
  }

  private _setupCanvasWipeInteraction(): void {
    const canvas = document.getElementById("SmallWorldMachine") as HTMLCanvasElement | null;
    if (!canvas) return;

    const onPointerMove = (e: PointerEvent): void => {
      if (!this._isDraggingSplit || this._displayMode !== "fullscreen") return;
      const bounds = this._getScreenMeshBounds();
      if (bounds.width <= 0) return;
      const normX = (e.clientX - bounds.left) / bounds.width;
      this._setSplitPosition(normX);
    };

    const onPointerUp = (): void => {
      this._isDraggingSplit = false;
    };

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (this._displayMode !== "fullscreen" || this._isHoveringHud) return;
      this._isDraggingSplit = true;
      const bounds = this._getScreenMeshBounds();
      if (bounds.width <= 0) return;
      const normX = (e.clientX - bounds.left) / bounds.width;
      this._setSplitPosition(normX);
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", () => {
      this._updateMeshAspect();
    });
  }

  private _setupDragAndDrop(): void {
    const prevent = (e: DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("dragenter", prevent);
    window.addEventListener("dragover", (e: DragEvent) => {
      prevent(e);
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      this._hud.setDropHighlight(true);
    });
    window.addEventListener("dragleave", () => {
      this._hud.setDropHighlight(false);
    });

    window.addEventListener("drop", async (e: DragEvent) => {
      prevent(e);
      this._hud.setDropHighlight(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file || !file.type.startsWith("image/")) return;
      await this._loadCustomImageFile(file);
    });
  }

  private async _loadCustomImageFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const tex = await Texture.fromUrl(url);
      this._textures["custom"] = tex;

      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (img.naturalWidth && img.naturalHeight) {
        this._customImageAspect = img.naturalWidth / img.naturalHeight;
      }

      this._setActivePreset("custom");
      this._setMode("fullscreen");
    } catch (err) {
      console.error("Failed to load dropped photo:", err);
    }
  }

  private _createReliefHud(): void {
    const host: MetalReliefHudHost = {
      setMode: (mode) => this._setMode(mode),
      setSplitPosition: (value) => this._setSplitPosition(value),
      setActivePreset: (presetId) => this._setActivePreset(presetId),
      loadImageFile: (file) => {
        this._loadCustomImageFile(file);
      },
      setParam: (param, value) => this._applyReliefParam(param, value),
      undoStudio: () => this._undoStudio(),
      clearStudio: () => this._clearStudio(),
      toggleEraser: () => {
        this._eraserMode = !this._eraserMode;
        return this._eraserMode;
      },
      toggleStudioBase: () => {
        this._setStudioBase(this._studioBaseMode === "steel" ? "photo" : "steel");
        return this._studioBaseMode === "photo";
      },
      pickSwatch: (index) => {
        this._paintColor = this._swatches[index]!;
        this._eraserMode = false;
      },
      onPanelClosed: () => this._onReliefPanelClosed(),
    };
    this._hud = new MetalReliefHud(host);

    const hud = this._hud.root;
    hud.addEventListener("pointerenter", () => {
      this._isHoveringHud = true;
      if (this._orbitController) {
        this._orbitController.enabled = false;
      }
    });

    hud.addEventListener("pointerleave", (e: PointerEvent) => {
      if (0 === e.buttons && !this._isDraggingHud) {
        this._isHoveringHud = false;
        if (this._orbitController && this._displayMode === "diorama") {
          this._orbitController.enabled = true;
        }
      }
    });

    hud.addEventListener("pointerdown", () => {
      this._isHoveringHud = true;
      this._isDraggingHud = true;
      if (this._orbitController) {
        this._orbitController.enabled = false;
      }
      this.input.mouse.dx = 0;
      this.input.mouse.dy = 0;
      this.input.mouse.zoom = 0;
      this.input.mouse.left = false;
    });

    window.addEventListener("pointerup", () => {
      this._isDraggingHud = false;
      if (!this._hud.root.matches(":hover")) {
        this._isHoveringHud = false;
        if (this._orbitController && this._displayMode === "diorama") {
          this._orbitController.enabled = true;
        }
      }
    });
  }

  private _applyReliefParam(param: ReliefParam, v: number): void {
    const screen = this._screenMaterial;
    switch (param) {
      case "sobel":
        if (screen) screen.reliefStrength = v;
        break;
      case "relief":
        for (const m of this._materials) m.paletteKnifeStrength = v;
        if (screen) screen.paletteKnifeStrength = v;
        break;
      case "scratches":
        for (const m of this._materials) m.scratchIntensity = v;
        if (screen) screen.scratchIntensity = v;
        break;
      case "bevel":
        for (const m of this._materials) m.edgeBevelStrength = v;
        if (screen) screen.edgeGlintStrength = v;
        break;
      case "rust":
        for (const m of this._materials) m.rustStrength = v;
        if (screen) screen.rustStrength = v;
        break;
      case "desat":
        if (screen) screen.desaturation = v;
        break;
      case "hue":
        if (screen) screen.targetHue = v;
        break;
      case "rain":
        for (const m of this._materials) {
          if (m.wetRainStreaks > 0.1) m.wetRainStreaks = v;
        }
        if (screen) screen.wetRainStreaks = v;
        break;
      case "brushSize":
        this._brushSizeBase = v;
        break;
      case "brushRelief":
        if (this._studioMaterial) this._studioMaterial.brushRelief = v;
        break;
      case "brushSmear":
        if (this._studioMaterial) this._studioMaterial.smearDistance = v;
        break;
      case "brushMetallic":
        if (this._studioMaterial) this._studioMaterial.metallic = v;
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Palette Knife Studio — interactive impasto painting onto a 3D plane.
  // ---------------------------------------------------------------------------

  /** Canvas + 2D context with a permanently inverted Y axis, so image-space drawing is
   * stored pre-flipped for direct (un-flipped) upload onto the engine's top-down UVs. */
  private _createFlippedCanvas2D(
    width: number,
    height: number,
  ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.translate(0, height);
    ctx.scale(1, -1);
    return { canvas, ctx };
  }

  /** Procedural steel plate that forms the neutral studio ground layer. */
  private _drawSteelPlate(ctx: CanvasRenderingContext2D): void {
    const w = this._STUDIO_WIDTH;
    const h = this._STUDIO_HEIGHT;
    ctx.fillStyle = "#21252b";
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const a = 0.02 + (0.05 * ((y * 2654435761) % 100)) / 100;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 60; i++) {
      const x0 = (i * 997) % w;
      const y0 = (i * 719) % h;
      const len = 24 + ((i * 31) % 90);
      ctx.strokeStyle = `rgba(180,190,210,${0.04 + ((i % 5) * 0.03).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + len * 0.6, y0 - len);
      ctx.stroke();
    }
  }

  private _buildStudio(): void {
    const paint = this._createFlippedCanvas2D(this._STUDIO_WIDTH, this._STUDIO_HEIGHT);
    this._studioPaintCanvas = paint.canvas;
    this._studioPaintCtx = paint.ctx;

    const dir = this._createFlippedCanvas2D(this._STUDIO_WIDTH, this._STUDIO_HEIGHT);
    this._studioDirCanvas = dir.canvas;
    this._studioDirCtx = dir.ctx;

    const steel = this._createFlippedCanvas2D(this._STUDIO_WIDTH, this._STUDIO_HEIGHT);
    this._drawSteelPlate(steel.ctx);

    this._studioPaintTex = Texture.fromCanvas(this._studioPaintCanvas);
    this._studioDirTex = Texture.fromCanvas(this._studioDirCanvas);
    this._studioSteelTex = Texture.fromCanvas(steel.canvas);

    this._studioMaterial = new ImpastoStrokeMaterial({
      paintMap: this._studioPaintTex,
      dirMap: this._studioDirTex,
      baseMap: this._studioSteelTex,
    });

    const quad = createPlaneMesh("StudioCanvasQuad", 4.15, 3.1, this._studioMaterial).setPosition(
      0,
      0,
      0,
    );
    this._studioRoot.add(quad);
    this._studioRoot.isVisible = false;
    this.scene.add(this._studioRoot);
  }

  private _pointerPressure(e: PointerEvent): number {
    if (e.pointerType === "mouse") return 0.6;
    const p = typeof e.pressure === "number" && e.pressure > 0 ? e.pressure : 0.5;
    return Math.min(1, Math.max(0, p));
  }

  private _setupStudioInteraction(): void {
    const canvas = document.getElementById("SmallWorldMachine") as HTMLCanvasElement | null;
    if (!canvas) return;

    const toCanvasSpace = (e: PointerEvent): StrokePoint => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * this._STUDIO_WIDTH;
      const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * this._STUDIO_HEIGHT;
      return {
        x: Math.max(0, Math.min(this._STUDIO_WIDTH, x)),
        y: Math.max(0, Math.min(this._STUDIO_HEIGHT, y)),
      };
    };

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (this._displayMode !== "studio" || this._isHoveringHud) return;
      this._isPainting = true;
      this._undoSnapshot = this._studioPaintCtx.getImageData(
        0,
        0,
        this._STUDIO_WIDTH,
        this._STUDIO_HEIGHT,
      );
      const p = toCanvasSpace(e);
      this._rasterizePointerStroke(p, p, this._pointerPressure(e));
      canvas.setPointerCapture?.(e.pointerId);
    });

    window.addEventListener("pointermove", (e: PointerEvent) => {
      if (!this._isPainting || this._displayMode !== "studio") return;
      const cur = toCanvasSpace(e);
      this._rasterizePointerStroke(this._lastPointer, cur, this._pointerPressure(e));
      this._lastPointer = cur;
    });

    const endPaint = (): void => {
      this._isPainting = false;
    };
    window.addEventListener("pointerup", endPaint);
    window.addEventListener("pointercancel", endPaint);
  }

  private _rasterizePointerStroke(from: StrokePoint, to: StrokePoint, pressure: number): void {
    const splats = buildStrokeSplats({
      from,
      to,
      pressure,
      baseRadius: this._brushSizeBase,
      maxRadius: this._brushMaxRadius,
      maxStepPx: 8,
      colorHex: this._paintColor,
      canvasWidth: this._STUDIO_WIDTH,
      canvasHeight: this._STUDIO_HEIGHT,
    });
    const op: GlobalCompositeOperation = this._eraserMode ? "destination-out" : "source-over";
    this._studioPaintCtx.globalCompositeOperation = op;
    this._studioDirCtx.globalCompositeOperation = op;
    for (const splat of splats) {
      rasterizeSplatColor(this._studioPaintCtx, splat, this._paintColor);
      rasterizeSplatDirection(this._studioDirCtx, splat);
    }
    this._studioPaintCtx.globalCompositeOperation = "source-over";
    this._studioDirCtx.globalCompositeOperation = "source-over";
    this._studioPaintTex.needsUpdate = true;
    this._studioDirTex.needsUpdate = true;
    this._qaNonce++;
  }

  private _clearStudio(): void {
    this._studioPaintCtx.clearRect(0, 0, this._STUDIO_WIDTH, this._STUDIO_HEIGHT);
    this._studioDirCtx.clearRect(0, 0, this._STUDIO_WIDTH, this._STUDIO_HEIGHT);
    this._studioPaintTex.needsUpdate = true;
    this._studioDirTex.needsUpdate = true;
    this._qaNonce++;
  }

  private _undoStudio(): void {
    if (!this._undoSnapshot) return;
    this._studioPaintCtx.putImageData(this._undoSnapshot, 0, 0);
    this._studioPaintTex.needsUpdate = true;
    this._qaNonce++;
  }

  private _syncStudioBase(): void {
    if (!this._studioMaterial) return;
    if (this._studioBaseMode === "photo") {
      const tex = this._textures[this._activePreset];
      if (tex) this._studioMaterial.baseMap = tex;
    } else {
      this._studioMaterial.baseMap = this._studioSteelTex;
    }
  }

  private _setStudioBase(mode: "steel" | "photo"): void {
    this._studioBaseMode = mode;
    this._syncStudioBase();
  }

  /** Deterministic paint hook for the automated live gate; `v` is top-down image space. */
  private _installQaHooks(): void {
    (window as unknown as Record<string, unknown>)["__qaImpasto"] = {
      getMode: (): string => this._displayMode,
      setMode: (m: string): void => {
        this._setMode(m as "fullscreen" | "diorama" | "studio");
      },
      nonce: (): number => this._qaNonce,
      paint: (u: number, v: number, pressure: number): void => {
        const p: StrokePoint = { x: u * this._STUDIO_WIDTH, y: v * this._STUDIO_HEIGHT };
        this._rasterizePointerStroke(p, p, pressure);
      },
      clear: (): void => this._clearStudio(),
      undo: (): void => this._undoStudio(),
      setBase: (m: string): void => this._setStudioBase(m as "steel" | "photo"),
      paintCoverage: (): number => {
        const data = this._studioPaintCtx.getImageData(
          0,
          0,
          this._STUDIO_WIDTH,
          this._STUDIO_HEIGHT,
        ).data;
        let sum = 0;
        for (let i = 3; i < data.length; i += 4) {
          sum += data[i]! / 255;
        }
        return sum / (this._STUDIO_WIDTH * this._STUDIO_HEIGHT);
      },
    };
  }
}

// Auto-boot if not in a test runner
if (typeof window !== "undefined" && !("__VITEST__" in window)) {
  const showcase = new Showcase();
  showcase.start().catch((err: unknown) => {
    console.error("Showcase boot error:", err);
  });
}
