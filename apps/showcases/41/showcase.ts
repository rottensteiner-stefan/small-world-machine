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
export class MetalReliefShowcase extends AbstractShowcase {
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
  private _reliefPanelBtn?: HTMLButtonElement;
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
      this._textures["paris"] = await Texture.fromUrl("./assets/paris_photo.jpg");
    } catch {
      try {
        this._textures["paris"] = await Texture.fromUrl("./assets/paris.jpg");
      } catch {
        this._textures["paris"] = createFallbackTexture("Paris", "#e53e3e");
      }
    }

    try {
      this._textures["alps"] = await Texture.fromUrl("./assets/alps_photo.jpg");
    } catch {
      try {
        this._textures["alps"] = await Texture.fromUrl("./assets/alps.jpg");
      } catch {
        this._textures["alps"] = createFallbackTexture("Alps", "#e53e3e");
      }
    }

    try {
      this._textures["harbor"] = await Texture.fromUrl("./assets/harbor_photo.jpg");
    } catch {
      try {
        this._textures["harbor"] = await Texture.fromUrl("./assets/harbor.jpg");
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

    this._createReliefControlUI();
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
    const selMode = document.getElementById("selMode") as HTMLSelectElement | null;
    if (selMode && selMode.value !== mode) {
      selMode.value = mode;
    }

    const studioSection = document.getElementById("studioSection");
    if (studioSection) {
      studioSection.style.display = mode === "studio" ? "flex" : "none";
    }

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
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;

      const hud = document.getElementById("reliefTuningHud");
      const isHudActive =
        (hud?.classList.contains("open") ?? false) &&
        (this._isHoveringHud ||
          this._isDraggingHud ||
          (null !== hud && hud.contains(document.activeElement)));

      if (e.code === "KeyI") {
        this._toggleReliefPanel();
        return;
      }

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

  private _toggleReliefPanel(force?: boolean): void {
    const hud = document.getElementById("reliefTuningHud");
    if (!hud) return;
    const isCurrentlyOpen = hud.classList.contains("open");
    const open = undefined !== force ? force : !isCurrentlyOpen;
    if (open) {
      hud.classList.add("open");
      this._reliefPanelBtn?.classList.add("active");
    } else {
      hud.classList.remove("open");
      this._reliefPanelBtn?.classList.remove("active");
      this._isHoveringHud = false;
      this._isDraggingHud = false;
      if (this._orbitController) {
        this._orbitController.enabled = true;
      }
    }
  }

  private _setActivePreset(presetId: string): void {
    this._activePreset = presetId;
    const btns = document.querySelectorAll("#reliefTuningHud .btn-preset");
    btns.forEach((b) => b.classList.remove("active"));
    const activeBtn = document.getElementById(
      presetId === "paris"
        ? "btnPresetParis"
        : presetId === "alps"
          ? "btnPresetAlps"
          : presetId === "harbor"
            ? "btnPresetHarbor"
            : "btnPresetCustom",
    );
    activeBtn?.classList.add("active");

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
    const slider = document.getElementById("slSplit") as HTMLInputElement | null;
    const label = document.getElementById("valSplit");
    if (slider) slider.value = clamped.toFixed(2);
    if (label) label.textContent = clamped.toFixed(2);

    this._updateDividerLinePosition();

    const btnHalf = document.getElementById("btnSplitHalf");
    const btnPhoto = document.getElementById("btnSplitPhoto");
    const btnMetal = document.getElementById("btnSplitMetal");
    btnHalf?.classList.toggle("active", Math.abs(clamped - 0.5) < 0.03);
    btnPhoto?.classList.toggle("active", clamped >= 0.98);
    btnMetal?.classList.toggle("active", clamped <= 0.02);
  }

  private _createWipeOverlayUI(): void {
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
      const dropzone = document.getElementById("dropZoneHud");
      dropzone?.classList.add("dragover");
    });
    window.addEventListener("dragleave", () => {
      const dropzone = document.getElementById("dropZoneHud");
      dropzone?.classList.remove("dragover");
    });

    window.addEventListener("drop", async (e: DragEvent) => {
      prevent(e);
      const dropzone = document.getElementById("dropZoneHud");
      dropzone?.classList.remove("dragover");
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

  private _bindSlider(sliderId: string, labelId: string, callback: (val: number) => void): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const label = document.getElementById(labelId);
    if (!slider || !label) return;
    slider.addEventListener("input", () => {
      const val = parseFloat(slider.value);
      label.textContent = val.toFixed(2);
      callback(val);
    });
  }

  private _createReliefControlUI(): void {
    const existingHud = document.getElementById("reliefTuningHud");
    if (existingHud) existingHud.remove();
    const existingStyle = document.getElementById("reliefTuningStyle");
    if (existingStyle) existingStyle.remove();

    const style = document.createElement("style");
    style.id = "reliefTuningStyle";
    style.textContent = `
      #reliefTuningHud {
        position: fixed;
        top: 0;
        right: 0;
        width: 320px;
        height: calc(100vh - 36px);
        overflow-y: auto;
        background: var(--tool-panel, rgba(14, 18, 28, 0.95));
        border-left: 1px solid var(--tool-border, rgba(148, 163, 184, 0.2));
        border-bottom: 1px solid var(--tool-border, rgba(148, 163, 184, 0.2));
        box-shadow: -6px 0 32px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: #e2e8f0;
        font-family: var(--font-ui, "Rajdhani", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: 12px;
        z-index: 10000;
        user-select: none;
        transform: translateX(100%);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
      }
      #reliefTuningHud.open {
        transform: translateX(0);
      }
      @media (max-width: 768px) {
        #reliefTuningHud {
          top: auto;
          bottom: 36px;
          left: 0;
          right: 0;
          width: 100vw;
          max-height: calc(100vh - 80px);
          border-left: none;
          border-right: none;
          border-bottom: none;
          border-top: 1px solid var(--tool-border, rgba(148, 163, 184, 0.25));
          border-radius: 14px 14px 0 0;
          box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.7);
          transform: translateY(100%);
          transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }
        #reliefTuningHud.open {
          transform: translateY(0);
        }
      }
      .swm-inspector-btn {
        position: fixed;
        bottom: 5px;
        right: 14px;
        width: 26px;
        height: 26px;
        z-index: 10001;
        pointer-events: auto;
        background: var(--tool-card, rgba(22, 29, 45, 0.85));
        color: var(--tool-text, #f8fafc);
        border: 1px solid var(--tool-border, rgba(148, 163, 184, 0.25));
        border-radius: var(--tool-radius-sm, 4px);
        padding: 0;
        font-size: 0.95rem;
        cursor: pointer;
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }
      .swm-inspector-btn:hover {
        border-color: var(--tool-accent, #b000ff);
        color: var(--tool-accent, #b000ff);
        box-shadow: 0 0 10px rgba(176, 0, 255, 0.4);
      }
      .swm-inspector-btn.active {
        background: rgba(176, 0, 255, 0.2);
        border-color: var(--tool-accent, #b000ff);
        color: var(--tool-accent, #b000ff);
        box-shadow: 0 0 8px rgba(176, 0, 255, 0.3);
      }
      #reliefTuningHud .hud-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      #reliefTuningHud .hud-title {
        font-weight: 700;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #f8fafc;
      }
      #reliefTuningHud .hud-badge {
        font-size: 10px;
        background: rgba(176, 0, 255, 0.2);
        color: #d884ff;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(176, 0, 255, 0.35);
      }
      #reliefTuningHud .hud-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #reliefTuningHud .hud-section {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 8px 10px;
      }
      #reliefTuningHud .section-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #94a3b8;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      #reliefTuningHud .hud-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        gap: 8px;
      }
      #reliefTuningHud .hud-row:last-child {
        margin-bottom: 0;
      }
      #reliefTuningHud label {
        color: #cbd5e1;
        font-size: 11px;
        flex: 1;
      }
      #reliefTuningHud .val-label {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        font-size: 11px;
        color: #38bdf8;
        min-width: 38px;
        text-align: right;
      }
      #reliefTuningHud input[type="range"] {
        flex: 1.3;
        accent-color: #b000ff;
        cursor: pointer;
      }
      #reliefTuningHud select {
        flex: 1.3;
        background: #1a202c;
        border: 1px solid #4a5568;
        color: #edf2f7;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 11px;
      }
      #reliefTuningHud .preset-group {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
      }
      #reliefTuningHud .btn-preset {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #e2e8f0;
        padding: 6px 4px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        text-align: center;
      }
      #reliefTuningHud .btn-preset:hover {
        background: rgba(176, 0, 255, 0.25);
        border-color: #b000ff;
        color: #fff;
      }
      #reliefTuningHud .btn-preset.active {
        background: #b000ff;
        color: #fff;
        border-color: #b000ff;
      }
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
      .hud-dropzone {
        border: 1px dashed rgba(148, 163, 184, 0.35);
        border-radius: 6px;
        padding: 8px 10px;
        text-align: center;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.03);
        transition: all 0.2s ease;
      }
      .hud-dropzone:hover, .hud-dropzone.dragover {
        border-color: #b000ff;
        background: rgba(176, 0, 255, 0.12);
        color: #fff;
      }
    `;
    document.head.appendChild(style);

    const hud = document.createElement("div");
    hud.id = "reliefTuningHud";
    hud.className = "swm-inspector-drawer";
    hud.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header" id="hudHeader">
        <div class="hud-title">
          <span>🎨</span> Metal Relief Lab
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">Inspector</span>
          <button id="reliefHudClose" title="Close Panel" style="background:none;border:none;color:#94a3b8;font-size:1.1rem;cursor:pointer;padding:0 4px;line-height:1;">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <!-- Display Mode -->
        <div class="hud-section">
          <div class="section-title">🖼️ Mode & Technique</div>
          <div class="hud-row">
            <label for="selMode">Display Mode</label>
            <select id="selMode">
              <option value="fullscreen" selected>Photo-to-Metal Converter (Split)</option>
              <option value="diorama">2.5D Diorama (3D Layered)</option>
              <option value="studio">🎨 Palette Knife Studio (Paint)</option>
            </select>
          </div>
        </div>

        <!-- Before / After Wipe -->
        <div class="hud-section">
          <div class="section-title">↔️ Before / After Split Wipe</div>
          <div class="hud-row">
            <label>Divider Position</label>
            <input type="range" id="slSplit" min="0" max="1" step="0.01" value="0.50" />
            <span class="val-label" id="valSplit">0.50</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px;">
            <button class="btn-preset active" id="btnSplitHalf">50% Split</button>
            <button class="btn-preset" id="btnSplitPhoto">Photo Only</button>
            <button class="btn-preset" id="btnSplitMetal">Metal Only</button>
          </div>
        </div>

        <!-- Presets & Upload -->
        <div class="hud-section">
          <div class="section-title">⚡ Realistic Photo Presets</div>
          <div class="preset-group">
            <button class="btn-preset active" id="btnPresetParis">🗼 Paris</button>
            <button class="btn-preset" id="btnPresetAlps">🚡 Alps</button>
            <button class="btn-preset" id="btnPresetHarbor">⛵ Harbor</button>
          </div>
          <div id="dropZoneHud" class="hud-dropzone" style="margin-top:8px;">
            <span>📁 Drop any photo or <u style="color:#b000ff;">browse</u></span>
            <input type="file" id="filePickerInput" accept="image/*" style="display:none;" />
          </div>
        </div>

        <!-- Palette Knife & Relief Depth -->
        <div class="hud-section">
          <div class="section-title">🔪 Impasto & Relief Depth</div>
          <div class="hud-row">
            <label>Sobel Relief</label>
            <input type="range" id="slSobel" min="0" max="3" step="0.05" value="1.50" />
            <span class="val-label" id="valSobel">1.50</span>
          </div>
          <div class="hud-row">
            <label>Palette Knife</label>
            <input type="range" id="slRelief" min="0" max="2" step="0.05" value="0.50" />
            <span class="val-label" id="valRelief">0.50</span>
          </div>
          <div class="hud-row">
            <label>Grind Marks (Flex)</label>
            <input type="range" id="slScratches" min="0" max="1" step="0.05" value="0.40" />
            <span class="val-label" id="valScratches">0.40</span>
          </div>
          <div class="hud-row">
            <label>Welded Edge Glint</label>
            <input type="range" id="slBevel" min="0" max="2.5" step="0.05" value="1.20" />
            <span class="val-label" id="valBevel">1.20</span>
          </div>
        </div>

        <!-- Industrial Patina -->
        <div class="hud-section">
          <div class="section-title">⚙️ Industrial Patina & Pop</div>
          <div class="hud-row">
            <label>Iron Oxide Rust</label>
            <input type="range" id="slRust" min="0" max="1" step="0.05" value="0.80" />
            <span class="val-label" id="valRust">0.80</span>
          </div>
          <div class="hud-row">
            <label>Desaturation</label>
            <input type="range" id="slDesat" min="0" max="1" step="0.05" value="0.95" />
            <span class="val-label" id="valDesat">0.95</span>
          </div>
          <div class="hud-row">
            <label>Accent Hue Pop</label>
            <input type="range" id="slHue" min="0" max="1" step="0.01" value="0.00" />
            <span class="val-label" id="valHue">0.00</span>
          </div>
          <div class="hud-row">
            <label>Wet Rain Sheen</label>
            <input type="range" id="slRain" min="0" max="1" step="0.05" value="0.50" />
            <span class="val-label" id="valRain">0.50</span>
          </div>
        </div>

        <!-- Palette Knife Studio -->
        <div class="hud-section" id="studioSection" style="display:none;">
          <div class="section-title">🎨 Palette Knife Studio</div>
          <div class="hud-row">
            <label>Brush Size</label>
            <input type="range" id="slBrushSize" min="3" max="120" step="1" value="12" />
            <span class="val-label" id="valBrushSize">12</span>
          </div>
          <div class="hud-row">
            <label>Impasto Height</label>
            <input type="range" id="slBrushRelief" min="0" max="2" step="0.05" value="1.00" />
            <span class="val-label" id="valBrushRelief">1.00</span>
          </div>
          <div class="hud-row">
            <label>Knife Smear</label>
            <input type="range" id="slBrushSmear" min="0" max="1" step="0.02" value="0.28" />
            <span class="val-label" id="valBrushSmear">0.28</span>
          </div>
          <div class="hud-row">
            <label>Metallic</label>
            <input type="range" id="slBrushMetallic" min="0" max="1" step="0.05" value="0.55" />
            <span class="val-label" id="valBrushMetallic">0.55</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:6px;">
            <button class="btn-preset active" id="swatch1" style="background:#c0392b;" title="Oxide Red (1)"></button>
            <button class="btn-preset" id="swatch2" style="background:#d4af37;" title="Gold Leaf (2)"></button>
            <button class="btn-preset" id="swatch3" style="background:#b000ff;" title="Engine Violet (3)"></button>
            <button class="btn-preset" id="swatch4" style="background:#38bdf8;" title="Steel Blue (4)"></button>
            <button class="btn-preset" id="swatch5" style="background:#f1e9d8;" title="Bone White (5)"></button>
            <button class="btn-preset" id="swatch6" style="background:#1e2b26;" title="Charcoal Bronze (6)"></button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:6px;">
            <button class="btn-preset" id="btnErase">✕ Erase (X)</button>
            <button class="btn-preset" id="btnUndo">↩ Undo (Z)</button>
            <button class="btn-preset" id="btnClear">🗑 Clear (C)</button>
            <button class="btn-preset" id="btnBaseToggle">🖼 Base</button>
          </div>
          <div class="hud-row" style="margin-top:8px;">
            <span style="font-size:11px;color:#94a3b8;">Keys: [ ] size · 1-6 palette · Q base (steel/photo) · P leave studio</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(hud);

    // Footer toggle button (standardized .swm-inspector-btn as in Sponza Showcase 29)
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "reliefPanelOpenBtn";
    toggleBtn.className = "swm-inspector-btn";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Open Relief Controls (Key: I)";
    toggleBtn.setAttribute("aria-label", "Open Relief Controls");
    toggleBtn.onclick = (): void => {
      this._toggleReliefPanel();
    };
    this._reliefPanelBtn = toggleBtn;

    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(toggleBtn);
    } else {
      document.body.appendChild(toggleBtn);
    }

    // Stop events from leaking to camera orbit
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
      "keydown",
      "keyup",
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
      const curHud = document.getElementById("reliefTuningHud");
      if (!curHud?.matches(":hover")) {
        this._isHoveringHud = false;
        if (this._orbitController && this._displayMode === "diorama") {
          this._orbitController.enabled = true;
        }
      }
    });

    // Close button
    document.getElementById("reliefHudClose")?.addEventListener("click", () => {
      this._toggleReliefPanel(false);
    });

    // Mode dropdown
    const selMode = document.getElementById("selMode") as HTMLSelectElement | null;
    selMode?.addEventListener("change", () => {
      this._setMode(selMode.value as "fullscreen" | "diorama" | "studio");
    });

    // Split buttons
    this._bindSlider("slSplit", "valSplit", (v) => {
      this._setSplitPosition(v);
    });
    document.getElementById("btnSplitHalf")?.addEventListener("click", () => {
      this._setSplitPosition(0.5);
    });
    document.getElementById("btnSplitPhoto")?.addEventListener("click", () => {
      this._setSplitPosition(1.0);
    });
    document.getElementById("btnSplitMetal")?.addEventListener("click", () => {
      this._setSplitPosition(0.0);
    });

    // Presets
    document.getElementById("btnPresetParis")?.addEventListener("click", () => {
      this._setActivePreset("paris");
    });
    document.getElementById("btnPresetAlps")?.addEventListener("click", () => {
      this._setActivePreset("alps");
    });
    document.getElementById("btnPresetHarbor")?.addEventListener("click", () => {
      this._setActivePreset("harbor");
    });

    // File picker in HUD
    const dropZone = document.getElementById("dropZoneHud");
    const filePicker = document.getElementById("filePickerInput") as HTMLInputElement | null;
    dropZone?.addEventListener("click", () => {
      filePicker?.click();
    });
    filePicker?.addEventListener("change", () => {
      if (filePicker.files?.[0]) {
        this._loadCustomImageFile(filePicker.files[0]);
      }
    });

    // Sliders
    this._bindSlider("slSobel", "valSobel", (v) => {
      if (this._screenMaterial) {
        this._screenMaterial.reliefStrength = v;
      }
    });

    this._bindSlider("slRelief", "valRelief", (v) => {
      for (const m of this._materials) m.paletteKnifeStrength = v;
      if (this._screenMaterial) {
        this._screenMaterial.paletteKnifeStrength = v;
      }
    });

    this._bindSlider("slScratches", "valScratches", (v) => {
      for (const m of this._materials) m.scratchIntensity = v;
      if (this._screenMaterial) this._screenMaterial.scratchIntensity = v;
    });

    this._bindSlider("slBevel", "valBevel", (v) => {
      for (const m of this._materials) m.edgeBevelStrength = v;
      if (this._screenMaterial) this._screenMaterial.edgeGlintStrength = v;
    });

    this._bindSlider("slRust", "valRust", (v) => {
      for (const m of this._materials) m.rustStrength = v;
      if (this._screenMaterial) this._screenMaterial.rustStrength = v;
    });

    this._bindSlider("slDesat", "valDesat", (v) => {
      if (this._screenMaterial) this._screenMaterial.desaturation = v;
    });

    this._bindSlider("slHue", "valHue", (v) => {
      if (this._screenMaterial) this._screenMaterial.targetHue = v;
    });

    this._bindSlider("slRain", "valRain", (v) => {
      for (const m of this._materials) {
        if (m.wetRainStreaks > 0.1) m.wetRainStreaks = v;
      }
      if (this._screenMaterial) this._screenMaterial.wetRainStreaks = v;
    });

    // ---- Palette Knife Studio controls ----
    this._bindSlider("slBrushSize", "valBrushSize", (v) => {
      this._brushSizeBase = v;
    });
    this._bindSlider("slBrushRelief", "valBrushRelief", (v) => {
      if (this._studioMaterial) this._studioMaterial.brushRelief = v;
    });
    this._bindSlider("slBrushSmear", "valBrushSmear", (v) => {
      if (this._studioMaterial) this._studioMaterial.smearDistance = v;
    });
    this._bindSlider("slBrushMetallic", "valBrushMetallic", (v) => {
      if (this._studioMaterial) this._studioMaterial.metallic = v;
    });

    document.getElementById("btnUndo")?.addEventListener("click", () => {
      this._undoStudio();
    });
    document.getElementById("btnClear")?.addEventListener("click", () => {
      this._clearStudio();
    });
    const btnErase = document.getElementById("btnErase");
    btnErase?.addEventListener("click", () => {
      this._eraserMode = !this._eraserMode;
      btnErase.classList.toggle("active", this._eraserMode);
    });
    const btnBase = document.getElementById("btnBaseToggle");
    btnBase?.addEventListener("click", () => {
      this._setStudioBase(this._studioBaseMode === "steel" ? "photo" : "steel");
      btnBase.classList.toggle("active", this._studioBaseMode === "photo");
    });

    for (let i = 0; i < this._swatches.length; i++) {
      const btn = document.getElementById(`swatch${i + 1}`);
      btn?.addEventListener("click", () => {
        this._paintColor = this._swatches[i]!;
        this._eraserMode = false;
        btnErase?.classList.remove("active");
      });
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
  const showcase = new MetalReliefShowcase();
  showcase.start().catch((err: unknown) => {
    console.error("MetalReliefShowcase boot error:", err);
  });
}
