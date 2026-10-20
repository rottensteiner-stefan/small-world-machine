import type {
  BloomElement,
  EngineOptions,
  HbaoElement,
  PerspectiveProjection,
  ToneMappingElement,
  VignetteElement,
  VolumetricFogElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  FlyController,
  FogVolume,
  FogVolumeShape,
  Object3D,
  OrbitController,
  Plane,
  PointLight,
  PostProcessingEffectType,
  ProjectionType,
  RendererType,
  Sphere,
  StandardMaterial,
  ToneMappingMode,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

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

  private _fogElement: VolumetricFogElement | undefined = undefined;
  private _altarMistVolume!: FogVolume;
  private _chamberCarverVolume!: FogVolume;
  private _brazierMistVolume!: FogVolume;

  private _orbitController?: OrbitController;
  private _flyController?: FlyController;
  private _isFlyMode = false;

  private _sunMode: 1 | 2 = 2;
  private _time = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      quality: {
        maxPixelRatio: 1.5,
      },
      ...options,
    });
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
      this._fogElement.density = 0.025;
      this._fogElement.intensity = 1.0;
      this._fogElement.ambientInject = 1.5;
      this._fogElement.height = -1.0;
      this._fogElement.heightFalloff = 0.08;
      this._fogElement.asymmetry = 0.68; // Forward Mie scattering for god rays
      this._fogElement.color = new Color(0.92, 0.96, 1.0);
      this._fogElement.castDirectionalShadow = true;
      this._fogElement.maxDistance = 65.0;
      this._fogElement.jitter = 0.8;
    }

    // --- 3. Camera Setup & Strategy ---
    if (this.camera.projection.type === ProjectionType.PERSPECTIVE) {
      const proj = this.camera.projection as PerspectiveProjection;
      proj.fov = 58;
      proj.near = 0.1;
      proj.far = 100.0;
    }
    this.camera.position.set(0, 4.5, 22);
    this.camera.target.set(0, 2.5, -4);

    this._orbitController = new OrbitController({
      input: this.input,
    });
    this.camera.addBehavior(this._orbitController);

    this._flyController = new FlyController({
      input: this.input,
      moveSpeed: 8.0,
    });
    this._flyController.enabled = false;
    this.camera.addBehavior(this._flyController);

    // --- 4. Architectural Materials ---
    const stoneFloorMat = new StandardMaterial({
      color: new Color(0.35, 0.33, 0.3),
      roughness: 0.65,
      metallic: 0.05,
    });

    const pillarMat = new StandardMaterial({
      color: new Color(0.55, 0.52, 0.46),
      roughness: 0.45,
      metallic: 0.05,
    });

    const darkBasaltMat = new StandardMaterial({
      color: new Color(0.12, 0.12, 0.14),
      roughness: 0.35,
      metallic: 0.2,
    });

    const goldTrimMat = new StandardMaterial({
      color: new Color(0.9, 0.75, 0.3),
      roughness: 0.25,
      metallic: 0.85,
    });

    const chamberWallMat = new StandardMaterial({
      color: new Color(0.25, 0.23, 0.22),
      roughness: 0.75,
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

    // High clerestory ceiling with central skylight opening
    const ceilingLeft = new Object3D("CeilingLeft");
    ceilingLeft.geometry = new Plane({ width: 14, height: 64 }).getGeometryData();
    ceilingLeft.rotation.x = Math.PI / 2;
    ceilingLeft.position.set(-11, 10, 0);
    ceilingLeft.material = chamberWallMat;
    ceilingLeft.castShadow = true;
    this.scene.add(ceilingLeft);

    const ceilingRight = new Object3D("CeilingRight");
    ceilingRight.geometry = new Plane({ width: 14, height: 64 }).getGeometryData();
    ceilingRight.rotation.x = Math.PI / 2;
    ceilingRight.position.set(11, 10, 0);
    ceilingRight.material = chamberWallMat;
    ceilingRight.castShadow = true;
    this.scene.add(ceilingRight);

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

      // Transverse Arch Beams connecting ceiling
      const arch = createBox(`Arch_${i}`, 13.0, 0.8, 0.8, darkBasaltMat);
      arch.position.set(0, 9.6, z);
      arch.castShadow = true;
      this.scene.add(arch);
    }

    // Outer Hall Side Walls
    const wallLeft = createBox("WallLeft", 1.0, 10.0, 64.0, chamberWallMat);
    wallLeft.position.set(-18, 5, 0);
    wallLeft.castShadow = true;
    wallLeft.receiveShadow = true;
    this.scene.add(wallLeft);

    const wallRight = createBox("WallRight", 1.0, 10.0, 64.0, chamberWallMat);
    wallRight.position.set(18, 5, 0);
    wallRight.castShadow = true;
    wallRight.receiveShadow = true;
    this.scene.add(wallRight);

    // Front Entrance Arch
    const frontWallLeft = createBox("FrontWallLeft", 12.0, 10.0, 1.0, chamberWallMat);
    frontWallLeft.position.set(-12, 5, 26);
    frontWallLeft.castShadow = true;
    this.scene.add(frontWallLeft);

    const frontWallRight = createBox("FrontWallRight", 12.0, 10.0, 1.0, chamberWallMat);
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

    // --- 10. Interactive HUD ---
    this._createHud();

    attachDevTools(this);
  }

  private _updateSunAngle(): void {
    if (this._sunMode === 1) {
      // High noon sunlight pouring vertically through clerestory opening
      this._sunLight.direction.set(0.15, -0.96, -0.22);
      this._sunLight.direction.normalize();
      this._sunLight.color.set(1.0, 0.96, 0.9);
      this._sunLight.intensity = 3.2;
    } else {
      // Low golden-hour sun streaming diagonally across nave & columns
      this._sunLight.direction.set(-0.62, -0.45, -0.64);
      this._sunLight.direction.normalize();
      this._sunLight.color.set(1.0, 0.88, 0.72);
      this._sunLight.intensity = 3.6;
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
        },
        { passive: "wheel" === ev || "touchstart" === ev || "touchmove" === ev },
      );
    }

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
            <label>Camera Navigation</label>
            <div class="preset-group">
              <button class="btn-preset ${!this._isFlyMode ? "active" : ""}" id="btnCamOrbit">Orbit Mode</button>
              <button class="btn-preset ${this._isFlyMode ? "active" : ""}" id="btnCamFly">Free-Fly Mode</button>
            </div>
          </div>
        </div>

        <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; padding: 2px 4px;">
          Fly into the rear vaulted chamber (Z = -21) to observe the zero-fog carved interior!
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
      this._isFlyMode = false;
      if (this._orbitController) this._orbitController.enabled = true;
      if (this._flyController) this._flyController.enabled = false;
      this._updateHudText();
    });

    document.getElementById("btnCamFly")?.addEventListener("click", () => {
      this._isFlyMode = true;
      if (this._orbitController) this._orbitController.enabled = false;
      if (this._flyController) this._flyController.enabled = true;
      this._updateHudText();
    });
  }

  protected override update(dt: number): void {
    this._time += dt;

    // Gentle pulsing & flicker of the altar and brazier point lights
    if (this._altarLight) {
      this._altarLight.intensity = 1.8 + Math.sin(this._time * 2.5) * 0.25;
    }
    if (this._brazierLight) {
      this._brazierLight.intensity =
        2.2 + Math.sin(this._time * 6.0) * 0.35 + Math.cos(this._time * 11.0) * 0.15;
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
