import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  FogMode,
  GltfLoader,
  MathUtils,
  Object3D,
  Plane,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  StandardMaterial,
  ToneMappingMode,
  Vector3D,
} from "@small-world-machine/engine";
import type { BloomElement, EngineOptions, ToneMappingElement } from "@small-world-machine/engine";
import { Hud, TONE_MODES, toneModeName } from "./Hud.js";
import type { LabSlider, PbrLabState } from "./Hud.js";

interface QaSwm47Sample {
  rendererType: string;
  frames: number;
  loadOk: boolean;
  objects: number;
  meshes: number;
  triangles: number;
  visible: number;
}

interface QaSwm47Hook {
  sample(): QaSwm47Sample;
}

declare global {
  interface Window {
    __qaSwm47?: QaSwm47Hook;
  }
}

/**
 * Showcase 47 — PBR Reference Lab (Khronos MetalRoughSpheres).
 *
 * Loads the official Khronos glTF-Sample-Assets model as a neutral PBR reference grid and lets
 * the user compare the three renderer tiers (`?rendererType=`, or Option/Alt+1/2/3) against each
 * other under an identical studio setup. The HUD (ShowcaseDrawer + perf footer) controls studio
 * lights and the post-processing chain (ACES tone mapping, bloom) and shows a live readout of
 * scene complexity. The reference model ships untouched (single shared material, CC-BY 4.0).
 * `?tone=off` disables the ToneMappingElement natively at load (WP-C2 parity knob): the post pass
 * then applies the tier-identical DEFAULT fallback (exposure 1.0, gamma 2.2), so the WebGPU and
 * WebGL2 outputs are directly comparable for the disabled-tone-mapping parity contract; the HUD/T
 * key re-enables it interactively.
 */
export class Showcase extends AbstractShowcase {
  private _labRoot?: Object3D;
  private _key?: DirectionalLight;
  private _ambient?: AmbientLight;
  private _rim?: PointLight;
  private _tone: ToneMappingElement | undefined = undefined;
  private _bloom: BloomElement | undefined = undefined;
  private _hud?: Hud;
  private _objects: number = 0;
  private _meshes: number = 0;
  private _triangles: number = 0;
  private _loadOk: boolean = false;
  private _frames: number = 0;
  private _lastReadoutUpdate: number = 0;
  private _keyIntensity: number = 3.2;
  private _ambientIntensity: number = 0.12;
  private _rimIntensity: number = 1.6;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      // The chain exists so the HUD toggles can flip the elements; tone mapping stays on (HDR
      // PBR needs it), bloom starts OFF for a clean reference look.
      postProcessing: { enabled: true },
      quality: {
        maxPixelRatio: 1.5,
      },
      ...options,
    });
    this.defaultCameraController = "orbit";
    // Narrower reference FOV: enlarges the display in frame without the wide-angle distortion a
    // lab reference should avoid.
    this.defaultFov = MathUtils.degToRad(40);
    this.defaultFar = 800;
  }

  protected override onCanvasRecreated(): void {
    // No pointer-lock on click: the orbit turntable stays frictionless.
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    // Canonical 3/4-elevated reference framing: the Khronos display has real depth (z ≈ -12..11),
    // so a dead-fronto view stacks the sphere columns into each other. The angled yaw separates
    // the rows and keeps roughness/metallic differences readable row by row.
    this.setInitialCamera(new Vector3D(13, 11.3, -32), new Vector3D(0, 4, -0.5));

    // Neutral studio backdrop instead of a skybox: metals get their environment reflections from
    // the baked neutral lightbox IBL set (scene-level `prefilterMap`), the background stays a
    // flat neutral grey so the reference matrix is judged without any scene tint.
    this.renderer.setClearColor(new Color(0.212, 0.216, 0.226));
    // Seamless studio backdrop: linear fog in the backdrop color begins past the reference
    // display (its far side sits ~46 units from the camera) and fades the lit floor before its
    // plane termination, so no hard ground horizon line cuts the frame on any tier.
    this.scene.fog = new Fog({
      color: new Color(0.212, 0.216, 0.226),
      mode: FogMode.LINEAR,
      near: 52,
      far: 85,
    });
    await this.loadIbl("./assets/ibl-neut/");

    this._setupFloor();
    this._setupLights();
    this._setupPostElements();
    await this._loadReference();
    this._installQAHook();
    this._createControlHud();
  }

  public override destroy(): void {
    this._hud?.dispose();
    delete window.__qaSwm47;
    super.destroy();
  }

  protected override update(_deltaTime: number): void {
    this._frames++;
    const now = performance.now();
    if (this._hud && now - this._lastReadoutUpdate > 250) {
      this._lastReadoutUpdate = now;
      this._refreshReadout();
    }
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === "KeyT") {
      // T / Shift+T: next / previous tone curve (Khronos Sample Viewer style comparison).
      const current = TONE_MODES.findIndex(([, m]) => m === this._currentState().toneMapping);
      const step = event.shiftKey ? -1 : 1;
      const next = TONE_MODES[(current + step + TONE_MODES.length) % TONE_MODES.length]!;
      this._setToneMapping(next[1]);
      return;
    }
    this._hud?.handleKey(event);
  }

  private _setToneMapping(mode: ToneMappingMode): void {
    if (this._tone) {
      this._tone.enabled = true;
      this._tone.mode = mode;
    }
    this._hud?.sync(this._currentState());
    this._refreshReadout();
  }

  private _setupFloor(): void {
    const floor = new Object3D("LabFloor");
    // Oversized so the plane edges stay outside the view cone. Color is held close to the unlit
    // backdrop so the plane termination behind the display is imperceptible (no hard seam).
    floor.geometry = new Plane({ width: 280, height: 280 }).getGeometryData();
    floor.material = new StandardMaterial({
      color: new Color(0.16, 0.163, 0.172),
      roughness: 0.82,
    });
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.05;
    this.scene.add(floor);
  }

  private _setupLights(): void {
    this._ambient = new AmbientLight({
      color: new Color(0.9, 0.95, 1.0),
      intensity: this._ambientIntensity,
    });
    this.scene.add(this._ambient);

    this._key = new DirectionalLight({
      color: new Color(1.0, 0.97, 0.92),
      intensity: this._keyIntensity,
    });
    this._key.direction.set(-0.45, -0.8, 0.4).normalize();
    this.scene.add(this._key);

    this._rim = new PointLight({
      color: new Color(0.55, 0.62, 1.0),
      intensity: this._rimIntensity,
      distance: 70,
      decay: 1.0,
    });
    this._rim.position.set(0, 16, -14);
    this.scene.add(this._rim);
  }

  private _setupPostElements(): void {
    const tone = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    // Tone mapping stays ON (engine default curve, PBR_NEUTRAL): HDR PBR specular clamps into
    // blotches without a curve; the HUD / T key switches between all ToneMappingMode curves.
    // Bloom starts OFF so the Khronos reference is judged without engine-added glare; both are
    // HUD-togglable. `?tone=off` natively disables the element at load (WP-C2 parity knob): the
    // post pass then falls back to the tier-identical DEFAULT curve, which the readout still
    // classifies as "NONE" (element state) while the rendered curve stays comparable across tiers.
    if (bloom) bloom.enabled = false;
    if (tone && new URLSearchParams(window.location.search).get("tone") === "off") {
      tone.enabled = false;
    }
    this._tone = tone;
    this._bloom = bloom;
  }

  private async _loadReference(): Promise<void> {
    try {
      const loader = new GltfLoader();
      const root = await loader.load("./assets/MetalRoughSpheres.glb");
      root.name = "MetalRoughSpheres";
      // The Khronos artifact's PBR values and material stay untouched: the renderer feeds it the
      // scene-level neutral IBL (prefilter/irradiance) exactly like any other material, so the
      // reference is judged engine-neutral.
      this.scene.add(root);
      this._labRoot = root;
      this._measureScene();
      this._loadOk = true;
    } catch (err) {
      this._loadOk = false;
      console.error("[Showcase47] Failed to load MetalRoughSpheres:", err);
    }
  }

  private _measureScene(): void {
    let objects = 0;
    let meshes = 0;
    let triangles = 0;
    const walk = (obj: Object3D): void => {
      objects++;
      const geo = obj.geometry;
      if (geo) {
        meshes++;
        const indices = geo.indices;
        // glTF triangle lists are always indexed; fall back to a triangle-fan estimate otherwise.
        triangles += indices ? indices.length / 3 : geo.vertices.length / 3;
      }
      for (const child of obj.children) {
        walk(child);
      }
    };
    if (this._labRoot) walk(this._labRoot);
    this._objects = objects;
    this._meshes = meshes;
    this._triangles = Math.round(triangles);
  }

  private _setSlider(name: LabSlider, value: number): void {
    switch (name) {
      case "KeyInt":
        this._keyIntensity = value;
        if (this._key) this._key.intensity = value;
        break;
      case "AmbInt":
        this._ambientIntensity = value;
        if (this._ambient) this._ambient.intensity = value;
        break;
      case "RimInt":
        this._rimIntensity = value;
        if (this._rim) this._rim.intensity = value;
        break;
    }
    this._hud?.sync(this._currentState());
  }

  private _currentState(): PbrLabState {
    return {
      rendererType: this.renderer?.type ?? "none",
      keyIntensity: this._keyIntensity,
      ambientIntensity: this._ambientIntensity,
      rimIntensity: this._rimIntensity,
      toneMapping: this._tone?.enabled ? this._tone.mode : ToneMappingMode.NONE,
      bloom: this._bloom?.enabled ?? false,
      objects: this._objects,
      meshes: this._meshes,
      triangles: this._triangles,
      visible: this.scene.lastFrustumVisibleObjects.length,
      loadOk: this._loadOk,
    };
  }

  private _refreshReadout(): void {
    const s = this._currentState();
    this._hud?.setReadout(
      `Backend:    ${s.rendererType}\n` +
        `Reference:  ${s.loadOk ? "MetalRoughSpheres" : "LOAD FAILED"}\n` +
        `Objects:    ${s.objects}\n` +
        `Meshes:     ${s.meshes}\n` +
        `Triangles:  ${s.triangles.toLocaleString("en-US")}\n` +
        `Visible:    ${s.visible}\n` +
        `Tone curve: ${toneModeName(s.toneMapping)}\n` +
        `Bloom:      ${s.bloom ? "on" : "off"}`,
    );
  }

  private _installQAHook(): void {
    window.__qaSwm47 = {
      sample: (): QaSwm47Sample => ({
        rendererType: this.renderer?.type ?? "none",
        frames: this._frames,
        loadOk: this._loadOk,
        objects: this._objects,
        meshes: this._meshes,
        triangles: this._triangles,
        visible: this.scene.lastFrustumVisibleObjects.length,
      }),
    };
  }

  private _createControlHud(): void {
    this._hud = new Hud(this, {
      setSlider: (name: LabSlider, value: number): void => this._setSlider(name, value),
      setToneMapping: (mode: ToneMappingMode): void => this._setToneMapping(mode),
      setBloom: (on: boolean): void => {
        if (this._bloom) this._bloom.enabled = on;
        this._hud?.sync(this._currentState());
        this._refreshReadout();
      },
      resetView: (): void => this.resetCamera(),
    });
    this._hud.sync(this._currentState());
    this._refreshReadout();
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase47] Failed to start:", err));
