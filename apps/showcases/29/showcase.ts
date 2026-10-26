import type {
  BloomElement,
  EngineOptions,
  HbaoElement,
  ToneMappingElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  BasicMaterial,
  CameraStrategyType,
  Color,
  CullMode,
  Cylinder,
  DirectionalLight,
  FlyController,
  GltfLoader,
  Object3D,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  Sphere,
  SpotLight,
  StandardMaterial,
  Texture,
  ToneMappingMode,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

/**
 * Showcase 29: "Sponza Atrium: Global Illumination & Volumetric Light Shafts"
 *
 * Benchmark testing architectural rendering, two-tiered colonnade shadow cascades,
 * simulated diffuse GI bounce, warm cloister lanterns, and atmospheric god rays (off by
 * default -- toggle with [V] or the "God Rays" checkbox in the tuning HUD).
 */
class Showcase29 extends AbstractShowcase {
  private _sunLight!: DirectionalLight;
  private _ambientLight!: AmbientLight;
  private _archBounceLights: (PointLight | SpotLight)[] = [];
  private _giEnabled = true;
  private _godRaysGroup!: Object3D;
  private _godRayMeshes: Object3D[] = [];
  private _lanternLights: PointLight[] = [];
  private _skydome: Object3D | undefined = undefined;
  private _toneMapping: ToneMappingElement | undefined = undefined;
  private _bloom: BloomElement | undefined = undefined;
  private _hbao: HbaoElement | undefined = undefined;
  private _vignette: VignetteElement | undefined = undefined;
  private _lightingLabBtn: HTMLButtonElement | undefined = undefined;
  private _flyController: FlyController | undefined = undefined;
  private _isHoveringLab = false;
  private _isDraggingLab = false;
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
    // 1. Cinematic Post-Processing Chain (Crytek / ACES Filmic Palette)
    this.renderer.postProcessing.enabled = true;

    // ACES Filmic Tone Mapping calibrated for high-dynamic range chiaroscuro
    this._toneMapping = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    if (this._toneMapping) {
      this._toneMapping.enabled = true;
      this._toneMapping.mode = ToneMappingMode.ACES_FILMIC;
      this._toneMapping.exposure = 1.05;
      this._toneMapping.gamma = 2.2;
    }

    // Atmospheric Warm Bloom for solar glare on sunlit stone ledges
    this._bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (this._bloom) {
      this._bloom.enabled = true;
      this._bloom.intensity = 0.4;
      this._bloom.threshold = 0.8;
      this._bloom.softThreshold = 0.25;
      this._bloom.radius = 1.3;
      this._bloom.color = new Color(1, 0.963, 0.883);
    }

    // Horizon-Based Ambient Occlusion for deep contact shadows under moldings & flutings
    this._hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (this._hbao) {
      this._hbao.enabled = true;
      this._hbao.radius = 0.9;
      this._hbao.intensity = 1.5;
    }

    // Subtle Cinematic Vignette to frame the colonnade corridor
    this._vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (this._vignette) {
      this._vignette.enabled = true;
      this._vignette.darkness = 0.35;
      this._vignette.offset = 0.92;
      this._vignette.roundness = 2.0;
    }

    // Camera setup: Benchmark upper-gallery perspective down the colonnade (matching Crytek shot)
    this.defaultFov = (60 * Math.PI) / 180;
    this.defaultFar = 300;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.position.set(8.841, 1.226, -0.451);
    this.camera.theta = -1.506;
    this.camera.phi = 0.04;
    this.camera.target.set(7.844, 1.267, -0.516);
    const fly = new FlyController({
      input: this.input,
      moveSpeed: 6.0,
      fastMultiplier: 2.2,
      slowMultiplier: 0.35,
      enableCollision: false,
    });
    this._flyController = fly;
    this.camera.addBehavior(fly);

    // 2. Multi-Tiered Mediterranean Lighting & Crytek-Grade Chiaroscuro
    // A. Deep Ambient Shadow: Low ambient creates dark, moody shaded arcade corridors
    this._ambientLight = new AmbientLight({
      color: new Color(0.481, 0.459, 0.435),
      intensity: 0.08, // Low intensity so covered walkways are in deep shadow
    });
    this.scene.add(this._ambientLight);

    // B. Dedicated Upward Arch Soffit Bounce (SpotLights pointing UPWARDS into arch ceilings)
    // Upper gallery near-balustrade bounce: Narrow cones pointing straight up (+Y)
    for (const bx of [-9.0, -4.5, 0.0, 4.5, 9.0]) {
      const spot = new SpotLight({
        color: new Color(1, 0.805, 0.502),
        intensity: 32.0,
        distance: 12.0,
        angle: Math.PI / 2.6,
        penumbra: 0.85,
        decay: 1.0,
        direction: new Vector3D(0, 1, 0), // Upward into stone arch soffits
      });
      spot.position.set(bx, 6.9, -3.8);
      this.scene.add(spot);
      this._archBounceLights.push(spot);
    }

    // Upper gallery opposite-balustrade bounce (pointing up into opposite arches)
    for (const bx of [-8.0, 0.0, 8.0]) {
      const spot = new SpotLight({
        color: new Color(1, 0.805, 0.502),
        intensity: 26.0,
        distance: 12.0,
        angle: Math.PI / 2.6,
        penumbra: 0.85,
        decay: 1.0,
        direction: new Vector3D(0, 1, 0),
      });
      spot.position.set(bx, 6.9, 3.8);
      this.scene.add(spot);
      this._archBounceLights.push(spot);
    }

    // Ground floor courtyard bounce (point lights for broad upward courtyard fill)
    for (const bx of [-9.0, 0.0, 9.0]) {
      const bounce = new PointLight({
        color: new Color(1, 0.85, 0.621),
        intensity: 18.0,
        distance: 20.0,
        decay: 1.0,
      });
      bounce.position.set(bx, 1.0, 0.0);
      this.scene.add(bounce);
      this._archBounceLights.push(bounce);
    }

    // C. Gleaming Mediterranean Sun (strikes balustrade ledge & casts crisp diagonal column shadows)
    this._sunLight = new DirectionalLight({
      color: new Color(1, 0.972, 0.893),
      intensity: 5.5,
    });
    this._sunLight.position.set(14, 28, 12);
    this._sunLight.direction.set(-0.45, -0.75, -0.45).normalize();
    this._sunLight.castShadow = true;
    this._sunLight.shadowBias = 0.0008;
    this._sunLight.shadowNormalBias = 0.02;
    this._sunLight.shadowResolution = 2048;
    this.scene.add(this._sunLight);

    // 3. Load Mediterranean Skydome & Ambient Environment
    try {
      const skyTexture = await Texture.fromUrl("./assets/sky_panorama.webp", { flipY: false });
      const skydome = new Object3D("Skydome");
      skydome.geometry = new Sphere({
        radius: 180,
        widthSegments: 32,
        heightSegments: 24,
      }).getGeometryData();
      const skydomeMat = new BasicMaterial({
        diffuseMap: skyTexture,
      });
      skydomeMat.cullMode = CullMode.NONE;
      skydomeMat.depthWrite = false;
      skydome.material = skydomeMat;
      skydome.frustumCulled = false;
      this._skydome = skydome;
      this.scene.add(skydome);
    } catch (e) {
      console.warn("Could not load skydome texture:", e);
    }

    // 4. Load the Official Khronos Sponza Atrium Model
    try {
      const loader = new GltfLoader();
      const sponza = await loader.load("./assets/sponza/Sponza.gltf");
      sponza.name = "SponzaAtrium";

      const setupMesh = (obj: Object3D): void => {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.frustumCulled = false;

        // Boost stone/tile/fabric albedo out of glTF's 0.588 grey clamp into warm Italian travertine vibrancy
        if (obj.material instanceof StandardMaterial) {
          obj.material.color = new Color(1.078, 1.044, 0.991);
        }

        for (const child of obj.children) {
          setupMesh(child);
        }
      };
      setupMesh(sponza);
      this.scene.add(sponza);
    } catch (e) {
      console.error("[Showcase29] Failed to load Khronos Sponza glTF:", e);
    }

    // 5. Warm Cloister Lanterns & Glowing Flame Fixtures
    const lanternMat = new StandardMaterial({
      color: new Color(1, 0.904, 0.659),
      emissiveColor: new Color(1, 0.822, 0.481),
      emissiveIntensity: 5.0,
      roughness: 0.3,
    });
    const lanternGeo = new Sphere({
      radius: 0.14,
      widthSegments: 12,
      heightSegments: 8,
    }).getGeometryData();

    // Subtle ground floor arcade lanterns
    for (const side of [-1, 1]) {
      for (const bayX of [-8, 0, 8]) {
        const lanternLight = new PointLight({
          color: new Color(1, 0.793, 0.459),
          intensity: 2.8,
          distance: 9.0,
          decay: 1.0,
        });
        lanternLight.position.set(bayX, 2.4, side * 5.2);
        this.scene.add(lanternLight);
        this._lanternLights.push(lanternLight);

        const lanternMesh = new Object3D(`LanternMesh_${bayX}_${side}`);
        lanternMesh.geometry = lanternGeo;
        lanternMesh.material = lanternMat;
        lanternMesh.position.set(bayX, 2.4, side * 5.2);
        this.scene.add(lanternMesh);
      }
    }

    // 6. Volumetric Light Shafts (Disabled by default)
    this._godRaysGroup = new Object3D("GodRaysContainer");
    this._godRaysGroup.isVisible = false; // Turned OFF
    this.scene.add(this._godRaysGroup);

    const godRayMat = new StandardMaterial({
      color: new Color(1, 0.977, 0.914, 0.08),
      emissiveColor: new Color(1, 0.963, 0.877),
      emissiveIntensity: 0.9,
      transparent: true,
      roughness: 1.0,
      metallic: 0.0,
    });
    godRayMat.cullMode = CullMode.NONE;
    godRayMat.depthWrite = false;

    // Create 7 multi-angled volumetric light shafts streaming through the central roof opening
    for (let r = 0; r < 7; r++) {
      const rayX = (r - 3) * 2.8;
      const rayMesh = new Object3D(`GodRay_${r}`);
      rayMesh.geometry = new Cylinder({
        radiusTop: 0.35 + (r % 2) * 0.15,
        radiusBottom: 2.4 + (r % 3) * 0.3,
        height: 13.5,
        radialSegments: 24,
        openEnded: true,
      }).getGeometryData();
      rayMesh.material = godRayMat;
      rayMesh.rotation.z = 0.28 + (r - 3) * 0.02;
      rayMesh.rotation.x = -0.38;
      rayMesh.position.set(rayX, 6.2, 1.1);
      this._godRaysGroup.add(rayMesh);
      this._godRayMeshes.push(rayMesh);
    }

    // 7. Interactive Keyboard Toggles & Live Tuning Overlay
    this._setupKeyboardShortcuts();
    this._createLiveTuningUI();
  }

  private _setupKeyboardShortcuts(): void {
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      // Ignore if focus is in an input or textarea element
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;

      const hud = document.getElementById("sponzaTuningHud");
      const isHudActive =
        (hud?.classList.contains("open") ?? false) &&
        (this._isHoveringLab ||
          this._isDraggingLab ||
          (null !== hud && hud.contains(document.activeElement)));

      if (e.code === "KeyI") {
        this._toggleLightingLab();
        return;
      }

      if (isHudActive) {
        return;
      }

      if (e.code === "KeyH") {
        if (this._hbao) {
          this._hbao.enabled = !this._hbao.enabled;
          this._updateUIFromState();
        }
      } else if (e.code === "KeyB") {
        if (this._bloom) {
          this._bloom.enabled = !this._bloom.enabled;
          this._updateUIFromState();
        }
      } else if (e.code === "KeyV") {
        if (this._godRaysGroup) {
          this._godRaysGroup.isVisible = !this._godRaysGroup.isVisible;
          this._updateUIFromState();
        }
      } else if (e.code === "KeyG") {
        this._giEnabled = !this._giEnabled;
        for (const b of this._archBounceLights) {
          b.intensity = this._giEnabled ? (b instanceof SpotLight ? 32.0 : 18.0) : 0.0;
        }
        this._updateUIFromState();
      }
    });
  }

  private _toggleLightingLab(force?: boolean): void {
    const hud = document.getElementById("sponzaTuningHud");
    if (!hud) return;
    const isCurrentlyOpen = hud.classList.contains("open");
    const open = undefined !== force ? force : !isCurrentlyOpen;
    if (open) {
      hud.classList.add("open");
      this._lightingLabBtn?.classList.add("active");
    } else {
      hud.classList.remove("open");
      this._lightingLabBtn?.classList.remove("active");
      this._isHoveringLab = false;
      this._isDraggingLab = false;
      if (this._flyController) {
        this._flyController.enabled = true;
      }
    }
  }

  private _createLiveTuningUI(): void {
    const existing = document.getElementById("sponzaTuningHud");
    if (existing) existing.remove();

    const style = document.createElement("style");
    style.id = "sponzaTuningStyle";
    style.textContent = `
      #sponzaTuningHud {
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
      #sponzaTuningHud.open {
        transform: translateX(0);
      }
      @media (max-width: 768px) {
        #sponzaTuningHud {
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
        #sponzaTuningHud.open {
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
      #sponzaTuningHud .hud-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      #sponzaTuningHud .hud-title {
        font-weight: 700;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #f8fafc;
      }
      #sponzaTuningHud .hud-badge {
        font-size: 10px;
        background: rgba(176, 0, 255, 0.2);
        color: #d884ff;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(176, 0, 255, 0.35);
      }
      #sponzaTuningHud .hud-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #sponzaTuningHud .hud-section {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 8px 10px;
      }
      #sponzaTuningHud .section-title {
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
      #sponzaTuningHud .hud-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        gap: 8px;
      }
      #sponzaTuningHud .hud-row:last-child {
        margin-bottom: 0;
      }
      #sponzaTuningHud label {
        color: #cbd5e1;
        font-size: 11px;
        flex: 1;
      }
      #sponzaTuningHud .val-label {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        font-size: 11px;
        color: #38bdf8;
        min-width: 38px;
        text-align: right;
      }
      #sponzaTuningHud input[type="range"] {
        flex: 1.3;
        accent-color: #b000ff;
        cursor: pointer;
      }
      #sponzaTuningHud input[type="checkbox"] {
        accent-color: #b000ff;
        cursor: pointer;
        width: 15px;
        height: 15px;
      }
      #sponzaTuningHud .preset-group {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
      }
      #sponzaTuningHud .btn-preset {
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
      #sponzaTuningHud .btn-preset:hover {
        background: rgba(176, 0, 255, 0.25);
        border-color: #b000ff;
        color: #fff;
      }
      #sponzaTuningHud .btn-preset.active {
        background: #b000ff;
        color: #fff;
        border-color: #b000ff;
      }
    `;
    document.head.appendChild(style);

    const hud = document.createElement("div");
    hud.id = "sponzaTuningHud";
    hud.className = "swm-inspector-drawer";
    hud.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header" id="hudHeader">
        <div class="hud-title">
          <span>🏛️</span> Sponza Lighting Lab
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">Inspector</span>
          <button id="sponzaHudClose" title="Close Panel" style="background:none;border:none;color:#94a3b8;font-size:1.1rem;cursor:pointer;padding:0 4px;line-height:1;">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <!-- Preset Row -->
        <div class="hud-section">
          <div class="section-title">⚡ Instant Presets</div>
          <div class="preset-group">
            <button class="btn-preset active" id="btnPresetCrytek">🏛️ Crytek</button>
            <button class="btn-preset" id="btnPresetNoon">☀️ High Noon</button>
            <button class="btn-preset" id="btnPresetOvercast">☁️ Overcast</button>
          </div>
        </div>

        <!-- Sunlight (Chiaroscuro) -->
        <div class="hud-section">
          <div class="section-title">☀️ Sunlight & Angle</div>
          <div class="hud-row">
            <label>Sun Intensity</label>
            <input type="range" id="slSunIntensity" min="0" max="10" step="0.1" value="5.5" />
            <span class="val-label" id="valSunIntensity">5.5</span>
          </div>
          <div class="hud-row">
            <label>Sun Angle X</label>
            <input type="range" id="slSunX" min="-1" max="1" step="0.02" value="-0.45" />
            <span class="val-label" id="valSunX">-0.45</span>
          </div>
          <div class="hud-row">
            <label>Sun Altitude Y</label>
            <input type="range" id="slSunY" min="-1" max="-0.2" step="0.02" value="-0.75" />
            <span class="val-label" id="valSunY">-0.75</span>
          </div>
          <div class="hud-row">
            <label>Sun Angle Z</label>
            <input type="range" id="slSunZ" min="-1" max="1" step="0.02" value="-0.45" />
            <span class="val-label" id="valSunZ">-0.45</span>
          </div>
        </div>

        <!-- Ambient & Shadow Walkway Depth -->
        <div class="hud-section">
          <div class="section-title">🌑 Ambient Fill & Shadows</div>
          <div class="hud-row">
            <label>Walkway Ambient</label>
            <input type="range" id="slAmbient" min="0.0" max="0.5" step="0.01" value="0.08" />
            <span class="val-label" id="valAmbient">0.08</span>
          </div>
          <div class="hud-row">
            <label>HBAO Occlusion</label>
            <input type="range" id="slHbao" min="0.0" max="3.0" step="0.05" value="1.50" />
            <span class="val-label" id="valHbao">1.50</span>
          </div>
          <div class="hud-row">
            <label>Enable HBAO [H]</label>
            <input type="checkbox" id="chkHbao" checked />
          </div>
        </div>

        <!-- Arch Soffit GI Bounce -->
        <div class="hud-section">
          <div class="section-title">✨ Arch Soffit Bounce (GI)</div>
          <div class="hud-row">
            <label>Bounce Intensity</label>
            <input type="range" id="slBounce" min="0" max="60" step="1" value="32" />
            <span class="val-label" id="valBounce">32</span>
          </div>
          <div class="hud-row">
            <label>Enable GI [G]</label>
            <input type="checkbox" id="chkGI" checked />
          </div>
        </div>

        <!-- Post-Processing -->
        <div class="hud-section">
          <div class="section-title">🎬 ACES Post-Processing</div>
          <div class="hud-row">
            <label>Exposure</label>
            <input type="range" id="slExposure" min="0.3" max="2.5" step="0.05" value="1.05" />
            <span class="val-label" id="valExposure">1.05</span>
          </div>
          <div class="hud-row">
            <label>Bloom Flare [B]</label>
            <input type="range" id="slBloom" min="0.0" max="1.5" step="0.05" value="0.40" />
            <span class="val-label" id="valBloom">0.40</span>
          </div>
          <div class="hud-row">
            <label>Vignette Framing</label>
            <input type="range" id="slVignette" min="0.0" max="0.8" step="0.02" value="0.35" />
            <span class="val-label" id="valVignette">0.35</span>
          </div>
          <div class="hud-row">
            <label>God Rays [V]</label>
            <input type="checkbox" id="chkGodRays" />
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(hud);

    // Footer toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "swm-inspector-btn";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Toggle Sponza Lighting Lab (Key: I)";
    toggleBtn.onclick = (): void => {
      this._toggleLightingLab();
    };
    this._lightingLabBtn = toggleBtn;

    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(toggleBtn);
    } else {
      document.body.appendChild(toggleBtn);
    }

    // Isolate pointer, mouse, wheel, touch events inside the overlay so spectator fly mode is not interrupted
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
      this._isHoveringLab = true;
      if (this._flyController) {
        this._flyController.enabled = false;
      }
    });

    hud.addEventListener("pointerleave", (e: PointerEvent) => {
      if (0 === e.buttons && !this._isDraggingLab) {
        this._isHoveringLab = false;
        if (this._flyController) {
          this._flyController.enabled = true;
        }
      }
    });

    hud.addEventListener("pointerdown", () => {
      this._isHoveringLab = true;
      this._isDraggingLab = true;
      if (this._flyController) {
        this._flyController.enabled = false;
      }
      this.input.mouse.dx = 0;
      this.input.mouse.dy = 0;
      this.input.mouse.zoom = 0;
      this.input.mouse.left = false;
    });

    window.addEventListener("pointerup", () => {
      this._isDraggingLab = false;
      const curHud = document.getElementById("sponzaTuningHud");
      if (!curHud?.matches(":hover")) {
        this._isHoveringLab = false;
        if (this._flyController) {
          this._flyController.enabled = true;
        }
      }
    });

    // Close button
    document.getElementById("sponzaHudClose")?.addEventListener("click", () => {
      this._toggleLightingLab(false);
    });

    // Wire up sliders
    this._bindSlider("slSunIntensity", "valSunIntensity", (v) => {
      this._sunLight.intensity = v;
    });

    const updateSunDir = (): void => {
      const x = parseFloat((document.getElementById("slSunX") as HTMLInputElement).value);
      const y = parseFloat((document.getElementById("slSunY") as HTMLInputElement).value);
      const z = parseFloat((document.getElementById("slSunZ") as HTMLInputElement).value);
      document.getElementById("valSunX")!.textContent = x.toFixed(2);
      document.getElementById("valSunY")!.textContent = y.toFixed(2);
      document.getElementById("valSunZ")!.textContent = z.toFixed(2);
      this._sunLight.direction.set(x, y, z).normalize();
    };

    document.getElementById("slSunX")?.addEventListener("input", updateSunDir);
    document.getElementById("slSunY")?.addEventListener("input", updateSunDir);
    document.getElementById("slSunZ")?.addEventListener("input", updateSunDir);

    this._bindSlider("slAmbient", "valAmbient", (v) => {
      this._ambientLight.intensity = v;
    });

    this._bindSlider("slHbao", "valHbao", (v) => {
      if (this._hbao) this._hbao.intensity = v;
    });

    document.getElementById("chkHbao")?.addEventListener("change", (e) => {
      if (this._hbao) this._hbao.enabled = (e.target as HTMLInputElement).checked;
    });

    this._bindSlider("slBounce", "valBounce", (v) => {
      for (const b of this._archBounceLights) {
        b.intensity = this._giEnabled ? (b instanceof SpotLight ? v : v * 0.6) : 0;
      }
    });

    document.getElementById("chkGI")?.addEventListener("change", (e) => {
      this._giEnabled = (e.target as HTMLInputElement).checked;
      const bounceVal = parseFloat((document.getElementById("slBounce") as HTMLInputElement).value);
      for (const b of this._archBounceLights) {
        b.intensity = this._giEnabled ? (b instanceof SpotLight ? bounceVal : bounceVal * 0.6) : 0;
      }
    });

    this._bindSlider("slExposure", "valExposure", (v) => {
      if (this._toneMapping) this._toneMapping.exposure = v;
    });

    this._bindSlider("slBloom", "valBloom", (v) => {
      if (this._bloom) {
        this._bloom.intensity = v;
        this._bloom.enabled = v > 0.01;
      }
    });

    this._bindSlider("slVignette", "valVignette", (v) => {
      if (this._vignette) this._vignette.darkness = v;
    });

    document.getElementById("chkGodRays")?.addEventListener("change", (e) => {
      if (this._godRaysGroup) {
        this._godRaysGroup.isVisible = (e.target as HTMLInputElement).checked;
      }
    });

    // Wire Presets
    document.getElementById("btnPresetCrytek")?.addEventListener("click", () => {
      this._applyPreset(5.5, -0.45, -0.75, -0.45, 0.08, 1.5, 32, 1.05, 0.4, 0.35, false);
      this._setActivePreset("btnPresetCrytek");
    });
    document.getElementById("btnPresetNoon")?.addEventListener("click", () => {
      this._applyPreset(6.5, -0.2, -0.92, -0.3, 0.22, 1.2, 22, 1.15, 0.6, 0.25, false);
      this._setActivePreset("btnPresetNoon");
    });
    document.getElementById("btnPresetOvercast")?.addEventListener("click", () => {
      this._applyPreset(1.5, 0.0, -1.0, 0.0, 0.42, 0.8, 0, 0.9, 0.1, 0.15, false);
      this._setActivePreset("btnPresetOvercast");
    });
  }

  private _bindSlider(sliderId: string, labelId: string, callback: (val: number) => void): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const label = document.getElementById(labelId);
    if (!slider || !label) return;
    slider.addEventListener("input", () => {
      const val = parseFloat(slider.value);
      label.textContent = Number.isInteger(val) ? val.toString() : val.toFixed(2);
      callback(val);
    });
  }

  private _setActivePreset(activeId: string): void {
    const btns = document.querySelectorAll("#sponzaTuningHud .btn-preset");
    btns.forEach((b) => b.classList.remove("active"));
    document.getElementById(activeId)?.classList.add("active");
  }

  private _applyPreset(
    sunInt: number,
    sunX: number,
    sunY: number,
    sunZ: number,
    ambInt: number,
    hbaoInt: number,
    bounceInt: number,
    exp: number,
    bloomInt: number,
    vigInt: number,
    godRays: boolean,
  ): void {
    this._sunLight.intensity = sunInt;
    this._sunLight.direction.set(sunX, sunY, sunZ).normalize();
    this._ambientLight.intensity = ambInt;
    if (this._hbao) {
      this._hbao.intensity = hbaoInt;
      this._hbao.enabled = true;
    }
    this._giEnabled = bounceInt > 0;
    for (const b of this._archBounceLights) {
      b.intensity = b instanceof SpotLight ? bounceInt : bounceInt * 0.6;
    }
    if (this._toneMapping) this._toneMapping.exposure = exp;
    if (this._bloom) {
      this._bloom.intensity = bloomInt;
      this._bloom.enabled = bloomInt > 0.01;
    }
    if (this._vignette) this._vignette.darkness = vigInt;
    if (this._godRaysGroup) this._godRaysGroup.isVisible = godRays;

    // Update UI Elements
    this._setVal("slSunIntensity", "valSunIntensity", sunInt);
    this._setVal("slSunX", "valSunX", sunX);
    this._setVal("slSunY", "valSunY", sunY);
    this._setVal("slSunZ", "valSunZ", sunZ);
    this._setVal("slAmbient", "valAmbient", ambInt);
    this._setVal("slHbao", "valHbao", hbaoInt);
    this._setVal("slBounce", "valBounce", bounceInt);
    this._setVal("slExposure", "valExposure", exp);
    this._setVal("slBloom", "valBloom", bloomInt);
    this._setVal("slVignette", "valVignette", vigInt);
    (document.getElementById("chkHbao") as HTMLInputElement).checked = true;
    (document.getElementById("chkGI") as HTMLInputElement).checked = this._giEnabled;
    (document.getElementById("chkGodRays") as HTMLInputElement).checked = godRays;
  }

  private _setVal(sliderId: string, labelId: string, val: number): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const label = document.getElementById(labelId);
    if (slider) slider.value = val.toString();
    if (label) label.textContent = Number.isInteger(val) ? val.toString() : val.toFixed(2);
  }

  private _updateUIFromState(): void {
    const chkHbao = document.getElementById("chkHbao") as HTMLInputElement;
    if (chkHbao && this._hbao) chkHbao.checked = this._hbao.enabled;

    const chkGI = document.getElementById("chkGI") as HTMLInputElement;
    if (chkGI) chkGI.checked = this._giEnabled;

    const chkGodRays = document.getElementById("chkGodRays") as HTMLInputElement;
    if (chkGodRays && this._godRaysGroup) chkGodRays.checked = this._godRaysGroup.isVisible;
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    // Atmospheric breathing in volumetric God Rays -- skip while the group is hidden (off by
    // default, see setupScene()), no point animating meshes nothing is drawing.
    if (this._godRaysGroup.isVisible) {
      for (let i = 0; i < this._godRayMeshes.length; i++) {
        const ray = this._godRayMeshes[i];
        if (ray) {
          const flicker =
            0.92 +
            Math.sin(this._time * 1.4 + i * 1.1) * 0.1 +
            Math.cos(this._time * 2.7 + i) * 0.04;
          ray.scale.set(flicker, 1.0, flicker);
        }
      }
    }

    // Keep skydome centered on camera
    if (this._skydome) {
      this._skydome.position.copyFrom(this.camera.position);
    }

    // Warm cloister lantern flame flicker
    for (let j = 0; j < this._lanternLights.length; j++) {
      const light = this._lanternLights[j];
      if (light) {
        light.intensity = 2.6 + Math.sin(this._time * 7.5 + j * 2.8) * 0.35;
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase29();
(window as unknown as { swApp: Showcase29 }).swApp = app;
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase29] Failed to start:", err));
