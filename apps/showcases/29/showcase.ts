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
import { Hud } from "./Hud.js";
import type { HudActions, SponzaParam, SponzaToggle } from "./Hud.js";

/**
 * Showcase 29: "Sponza Atrium: Global Illumination & Volumetric Light Shafts"
 *
 * Benchmark testing architectural rendering, two-tiered colonnade shadow cascades,
 * simulated diffuse GI bounce, warm cloister lanterns, and atmospheric god rays (off by
 * default -- toggle with [V] or the "God Rays" checkbox in the tuning HUD).
 */
export class Showcase extends AbstractShowcase {
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
  private _hud!: Hud;
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

      if (this._hud.handleKey(e)) return;

      const hud = this._hud.root;
      const isHudActive =
        this._hud.isOpen &&
        (this._isHoveringLab || this._isDraggingLab || hud.contains(document.activeElement));

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

  private _onLightingLabClosed(): void {
    this._isHoveringLab = false;
    this._isDraggingLab = false;
    if (this._flyController) {
      this._flyController.enabled = true;
    }
  }

  private _createLiveTuningUI(): void {
    const host: HudActions = {
      setParam: (param, value) => this._applyParam(param, value),
      setSunDirection: (x, y, z) => {
        this._sunLight.direction.set(x, y, z).normalize();
      },
      setToggle: (toggle, enabled) => this._applyToggle(toggle, enabled),
      applyPreset: (preset) => {
        if (preset === "crytek") {
          this._applyPreset(5.5, -0.45, -0.75, -0.45, 0.08, 1.5, 32, 1.05, 0.4, 0.35, false);
        } else if (preset === "noon") {
          this._applyPreset(6.5, -0.2, -0.92, -0.3, 0.22, 1.2, 22, 1.15, 0.6, 0.25, false);
        } else {
          this._applyPreset(1.5, 0.0, -1.0, 0.0, 0.42, 0.8, 0, 0.9, 0.1, 0.15, false);
        }
      },
      onPanelClosed: () => this._onLightingLabClosed(),
    };
    this._hud = new Hud(host);

    const hud = this._hud.root;
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
      if (!this._hud.root.matches(":hover")) {
        this._isHoveringLab = false;
        if (this._flyController) {
          this._flyController.enabled = true;
        }
      }
    });
  }

  private _applyParam(param: SponzaParam, v: number): void {
    switch (param) {
      case "sunIntensity":
        this._sunLight.intensity = v;
        break;
      case "ambient":
        this._ambientLight.intensity = v;
        break;
      case "hbao":
        if (this._hbao) this._hbao.intensity = v;
        break;
      case "bounce":
        for (const b of this._archBounceLights) {
          b.intensity = this._giEnabled ? (b instanceof SpotLight ? v : v * 0.6) : 0;
        }
        break;
      case "exposure":
        if (this._toneMapping) this._toneMapping.exposure = v;
        break;
      case "bloom":
        if (this._bloom) {
          this._bloom.intensity = v;
          this._bloom.enabled = v > 0.01;
        }
        break;
      case "vignette":
        if (this._vignette) this._vignette.darkness = v;
        break;
    }
  }

  private _applyToggle(toggle: SponzaToggle, enabled: boolean): void {
    if (toggle === "hbao") {
      if (this._hbao) this._hbao.enabled = enabled;
    } else if (toggle === "gi") {
      this._giEnabled = enabled;
      const bounceVal = this._hud.getValue("bounce");
      for (const b of this._archBounceLights) {
        b.intensity = this._giEnabled ? (b instanceof SpotLight ? bounceVal : bounceVal * 0.6) : 0;
      }
    } else if (this._godRaysGroup) {
      this._godRaysGroup.isVisible = enabled;
    }
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
    this._hud.setValue("sunIntensity", sunInt);
    this._hud.setSunDirection(sunX, sunY, sunZ);
    this._hud.setValue("ambient", ambInt);
    this._hud.setValue("hbao", hbaoInt);
    this._hud.setValue("bounce", bounceInt);
    this._hud.setValue("exposure", exp);
    this._hud.setValue("bloom", bloomInt);
    this._hud.setValue("vignette", vigInt);
    this._hud.setChecked("hbao", true);
    this._hud.setChecked("gi", this._giEnabled);
    this._hud.setChecked("godRays", godRays);
  }

  private _updateUIFromState(): void {
    if (this._hbao) this._hud.setChecked("hbao", this._hbao.enabled);
    this._hud.setChecked("gi", this._giEnabled);
    if (this._godRaysGroup) this._hud.setChecked("godRays", this._godRaysGroup.isVisible);
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
const app = new Showcase();
(window as unknown as { swApp: Showcase }).swApp = app;
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase29] Failed to start:", err));
