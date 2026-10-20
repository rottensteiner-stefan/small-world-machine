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
} from "@small-world-machine/artistic-extras";

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
  mat: MetalReliefMaterial | MetalReliefScreenMaterial,
): Object3D {
  const obj = new Object3D(name);
  obj.geometry = new Plane({ width, height }).getGeometryData();
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

  private _displayMode: "diorama" | "fullscreen" = "diorama";
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

  private _textures: Record<string, Texture> = {};

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
      color: new Color(0.65, 0.68, 0.75),
      intensity: 0.45,
    });
    this.scene.add(ambient);

    const sun = new DirectionalLight({
      color: new Color(1.0, 0.95, 0.88),
      intensity: 0.95,
      direction: new Vector3D(0.4, 0.7, 0.5).normalize(),
    });
    this.scene.add(sun);

    // Preload textures with safe fallbacks
    try {
      // Engine convention: the upright Plane uses top-down UVs (v=1 = top), so
      // images destined for it must be loaded flipped (see MtlLoader). Without
      // this, the fullscreen motif appears vertically mirrored.
      this._textures["paris"] = await Texture.fromUrl("./assets/paris.jpg", { flipY: true });
    } catch {
      this._textures["paris"] = createFallbackTexture("Paris", "#e53e3e");
    }

    try {
      this._textures["alps"] = await Texture.fromUrl("./assets/alps.jpg", { flipY: true });
    } catch {
      this._textures["alps"] = createFallbackTexture("Alps", "#e53e3e");
    }

    try {
      this._textures["harbor"] = await Texture.fromUrl("./assets/harbor.jpg", { flipY: true });
    } catch {
      this._textures["harbor"] = createFallbackTexture("Harbor", "#3182ce");
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
      reliefStrength: 1.5,
      paletteKnifeStrength: 0.5,
      paletteKnifeScale: 24.0,
      scratchIntensity: 0.4,
      scratchScale: 120.0,
      edgeGlintStrength: 1.2,
      wetRainStreaks: 0.5,
      targetHue: 0.0,
      hueTolerance: 0.09,
      desaturation: 0.95,
      rustStrength: 0.8,
    });

    this._screenMesh = createPlaneMesh(
      "ScreenCanvasQuad",
      3.2,
      4.2,
      this._screenMaterial,
    ).setPosition(0, 0, 0);
    this._screenGroup.add(this._screenMesh);
    this._screenGroup.isVisible = false;
    this.scene.add(this._screenGroup);

    const orbit = new OrbitController({ input: this.input });
    this._orbitController = orbit;
    this.camera.addBehavior(orbit);

    this._createReliefControlUI();
    this._setupKeyboardShortcuts();
  }

  private _setMode(mode: "diorama" | "fullscreen"): void {
    this._displayMode = mode;
    if (mode === "diorama") {
      this._dioramaRoot.isVisible = true;
      this._screenGroup.isVisible = false;
    } else {
      this._dioramaRoot.isVisible = false;
      this._screenGroup.isVisible = true;
      this._screenMaterial.diffuseMap = this._textures[this._activePreset];
    }
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
          : "btnPresetHarbor",
    );
    activeBtn?.classList.add("active");

    if (presetId === "paris") this._buildParisMotif();
    else if (presetId === "alps") this._buildAlpsMotif();
    else if (presetId === "harbor") this._buildHarborMotif();

    if (this._displayMode === "fullscreen" && this._screenMaterial) {
      this._screenMaterial.diffuseMap = this._textures[presetId];
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
        border-color: var(--tool-accent, #e53e3e);
        color: var(--tool-accent, #e53e3e);
        box-shadow: 0 0 10px rgba(229, 62, 62, 0.4);
      }
      .swm-inspector-btn.active {
        background: rgba(229, 62, 62, 0.2);
        border-color: var(--tool-accent, #e53e3e);
        color: var(--tool-accent, #e53e3e);
        box-shadow: 0 0 8px rgba(229, 62, 62, 0.3);
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
        background: rgba(229, 62, 62, 0.2);
        color: #fc8181;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(229, 62, 62, 0.35);
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
        accent-color: #e53e3e;
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
        background: rgba(229, 62, 62, 0.25);
        border-color: #e53e3e;
        color: #fff;
      }
      #reliefTuningHud .btn-preset.active {
        background: #e53e3e;
        color: #fff;
        border-color: #e53e3e;
      }
    `;
    document.head.appendChild(style);

    const hud = document.createElement("div");
    hud.id = "reliefTuningHud";
    hud.innerHTML = `
      <div class="hud-header" id="hudHeader">
        <div class="hud-title">
          <span>🎨</span> Metal Relief Lab
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">[I] Toggle</span>
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
              <option value="diorama">2.5D Diorama (3D Geometry)</option>
              <option value="fullscreen">Full-Screen Canvas Shader</option>
            </select>
          </div>
        </div>

        <!-- Presets -->
        <div class="hud-section">
          <div class="section-title">⚡ Motif Presets</div>
          <div class="preset-group">
            <button class="btn-preset active" id="btnPresetParis">🗼 Paris</button>
            <button class="btn-preset" id="btnPresetAlps">🚡 Alps</button>
            <button class="btn-preset" id="btnPresetHarbor">⛵ Harbor</button>
          </div>
        </div>

        <!-- Palette Knife & Relief Depth -->
        <div class="hud-section">
          <div class="section-title">🔪 Impasto & Grinder</div>
          <div class="hud-row">
            <label>Palette Knife</label>
            <input type="range" id="slRelief" min="0" max="2" step="0.05" value="0.75" />
            <span class="val-label" id="valRelief">0.75</span>
          </div>
          <div class="hud-row">
            <label>Grind Marks (Flex)</label>
            <input type="range" id="slScratches" min="0" max="1" step="0.05" value="0.45" />
            <span class="val-label" id="valScratches">0.45</span>
          </div>
          <div class="hud-row">
            <label>Welded Edge Bevel</label>
            <input type="range" id="slBevel" min="0" max="2" step="0.05" value="1.00" />
            <span class="val-label" id="valBevel">1.00</span>
          </div>
        </div>

        <!-- Industrial Patina -->
        <div class="hud-section">
          <div class="section-title">⚙️ Industrial Patina</div>
          <div class="hud-row">
            <label>Iron Oxide Rust</label>
            <input type="range" id="slRust" min="0" max="1" step="0.05" value="0.75" />
            <span class="val-label" id="valRust">0.75</span>
          </div>
          <div class="hud-row">
            <label>Streckmetall Mesh</label>
            <input type="range" id="slWiremesh" min="0" max="1" step="0.05" value="0.35" />
            <span class="val-label" id="valWiremesh">0.35</span>
          </div>
          <div class="hud-row">
            <label>Wet Reflections</label>
            <input type="range" id="slRain" min="0" max="1" step="0.05" value="0.60" />
            <span class="val-label" id="valRain">0.60</span>
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
        if (this._orbitController) {
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
        if (this._orbitController) {
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
      this._setMode(selMode.value as "diorama" | "fullscreen");
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

    // Sliders
    this._bindSlider("slRelief", "valRelief", (v) => {
      for (const m of this._materials) m.paletteKnifeStrength = v;
      if (this._screenMaterial) {
        this._screenMaterial.reliefStrength = v * 2.0;
        this._screenMaterial.paletteKnifeStrength = v * 0.7;
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

    this._bindSlider("slWiremesh", "valWiremesh", (v) => {
      for (const m of this._materials) {
        if (m.wireMeshStrength > 0.05) m.wireMeshStrength = v;
      }
    });

    this._bindSlider("slRain", "valRain", (v) => {
      for (const m of this._materials) {
        if (m.wetRainStreaks > 0.1) m.wetRainStreaks = v;
      }
      if (this._screenMaterial) this._screenMaterial.wetRainStreaks = v;
    });
  }
}

// Auto-boot if not in a test runner
if (typeof window !== "undefined" && !("__VITEST__" in window)) {
  const showcase = new MetalReliefShowcase();
  showcase.start().catch((err: unknown) => {
    console.error("MetalReliefShowcase boot error:", err);
  });
}
