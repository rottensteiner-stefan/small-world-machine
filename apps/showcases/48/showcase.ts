import {
  AbstractShowcase,
  AmbientLight,
  AnimationMixer,
  Color,
  DirectionalLight,
  Fog,
  FogMode,
  GltfLoader,
  isSkinnedMesh,
  MathUtils,
  PointLight,
  RendererType,
  Vector3D,
} from "@small-world-machine/engine";
import type { AnimationAction, EngineOptions, Object3D } from "@small-world-machine/engine";
import { Hud } from "./Hud.js";
import type { FoxLabState } from "./Hud.js";

interface QaSwm48Sample {
  rendererType: string;
  frames: number;
  loadOk: boolean;
  meshes: number;
  triangles: number;
  visible: number;
  skinnedMeshes: number;
  skinBones: number;
  playing: string | null;
  clipTime: number;
  clips: string[];
}

interface QaSwm48Hook {
  sample(): QaSwm48Sample;
}

declare global {
  interface Window {
    __qaSwm48?: QaSwm48Hook;
  }
}

/** The Khronos Fox's three animation clips (names are authored and stable). */
const FOX_CLIPS = ["Survey", "Walk", "Run"] as const;
const DEFAULT_CLIP: string = "Survey";

/**
 * Showcase 48 — Fox Skinning Lab (Khronos Fox).
 *
 * Loads the official Khronos Fox (pure core glTF 2.0) and drives its 24-joint rig through the
 * engine's `AnimationMixer` on every renderer tier, including the engine-new WebGL1 joint-matrix
 * path (`USE_SKINNING`). The HUD (ShowcaseDrawer + perf footer) switches between the model's three
 * clips, scales playback tempo, and shows a live skinning readout.
 */
export class Showcase extends AbstractShowcase {
  private _foxRoot?: Object3D;
  private _mixer?: AnimationMixer;
  private _actions: Map<string, AnimationAction> = new Map();
  private _clips: typeof FOX_CLIPS[number][] = [];
  private _playing: string | null = null;
  private _tempo: number = 1;
  private _key?: DirectionalLight;
  private _ambient?: AmbientLight;
  private _rim?: PointLight;
  private _hud?: Hud;
  private _meshes: number = 0;
  private _triangles: number = 0;
  private _skinnedMeshes: number = 0;
  private _skinBones: number = 0;
  private _loadOk: boolean = false;
  private _frames: number = 0;
  private _lastReadoutUpdate: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      // Tone mapping stays on (engine default): the PBR fox is HDR-shaded. Bloom stays OFF for a
      // clean character reference; both are HUD-togglable.
      postProcessing: { enabled: true },
      quality: {
        maxPixelRatio: 1.5,
      },
      ...options,
    });
    this.defaultCameraController = "orbit";
    this.defaultFov = MathUtils.degToRad(42);
    this.defaultFar = 800;
  }

  protected override onCanvasRecreated(): void {
    // No pointer-lock on click: the orbit stays frictionless.
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    // Hero 3/4 framing of the standing fox (rig faces +X, ~80 units tall when animated).
    this.setInitialCamera(new Vector3D(55, 100, 235), new Vector3D(0, 42, 0));

    // Neutral studio sweep: no skybox, no floor -- the character stands in the neutral backdrop
    // and its environment reflections come from the baked neutral lightbox IBL (scene-level).
    this.renderer.setClearColor(new Color(0.145, 0.15, 0.16));
    this.scene.fog = new Fog({
      color: new Color(0.145, 0.15, 0.16),
      mode: FogMode.LINEAR,
      near: 260,
      far: 400,
    });
    await this.loadIbl("./assets/ibl-neut/", 1.2);

    this._setupLights();
    await this._loadFox();
    this._installQAHook();
    this._createControlHud();
  }

  public override destroy(): void {
    this._hud?.dispose();
    delete window.__qaSwm48;
    super.destroy();
  }

  protected override update(deltaTime: number): void {
    this._frames++;
    // Drive the mixer BEFORE the engine's `scene.update` runs the matrix+skinning pass (verified
    // order in SmallWorldMachine._onFrame: showcase.update -> scene.update -> render).
    if (this._mixer && this._playing) {
      this._mixer.update(deltaTime * this._tempo);
    }
    const now = performance.now();
    if (this._hud && now - this._lastReadoutUpdate > 250) {
      this._lastReadoutUpdate = now;
      this._refreshReadout();
    }
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    this._hud?.handleKey(event);
  }

  private _setupLights(): void {
    this._ambient = new AmbientLight({
      color: new Color(0.85, 0.87, 0.9),
      intensity: 0.25,
    });
    this.scene.add(this._ambient);

    this._key = new DirectionalLight({
      color: new Color(1.0, 0.96, 0.9),
      intensity: 2.4,
    });
    this._key.direction.set(-0.5, -0.75, -0.42).normalize();
    this.scene.add(this._key);

    this._rim = new PointLight({
      color: new Color(0.5, 0.58, 0.95),
      intensity: 1.4,
      distance: 260,
      decay: 1.0,
    });
    this._rim.position.set(-70, 95, -90);
    this.scene.add(this._rim);
  }

  private async _loadFox(): Promise<void> {
    try {
      const loader = new GltfLoader();
      const root = await loader.load("./assets/Fox.glb");
      root.name = "Fox";
      this._foxRoot = root;
      this.scene.add(root);

      this._measureScene();
      this._clips = FOX_CLIPS.filter((name) => root.animations.some((c) => c.name === name))
        .map((name) => name);

      // Bind every authored clip to one mixer; the HUD switches by restarting actions.
      const mixer = new AnimationMixer(root);
      const available = new Map(root.animations.map((c) => [c.name, c]));
      for (const clip of available.values()) {
        if (FOX_CLIPS.some((n) => n === clip.name)) {
          this._actions.set(clip.name, mixer.clipAction(clip));
        }
      }
      this._mixer = mixer;
      if (this._actions.has(DEFAULT_CLIP)) {
        this._playClip(DEFAULT_CLIP);
      }

      this._loadOk = true;
    } catch (err) {
      this._loadOk = false;
      console.error("[Showcase48] Failed to load Fox:", err);
    }
  }

  private _measureScene(): void {
    let meshes = 0;
    let triangles = 0;
    let skinned = 0;
    let bones = 0;
    const walk = (obj: Object3D): void => {
      const geo = obj.geometry;
      if (geo) {
        meshes++;
        // Non-indexed glTF primitives carry an EMPTY (not undefined) index array -- only count
        // a triangle list when it has real elements, else fall back to the vertex fan estimate.
        if (geo.indices && geo.indices.length > 0) {
          triangles += geo.indices.length / 3;
        } else if (geo.vertices && geo.vertices.length > 0) {
          // Non-indexed: 9 floats per triangle (3 vertices × 3 components).
          triangles += geo.vertices.length / 9;
        }
      }
      // Skin detection via the engine type guard (SkinnedMesh instances).
      const skel = isSkinnedMesh(obj) ? obj.skeleton : undefined;
      if (skel) {
        skinned++;
        bones = Math.max(bones, skel.bones.length);
      }
      for (const child of obj.children) {
        walk(child);
      }
    };
    if (this._foxRoot) walk(this._foxRoot);
    this._meshes = meshes;
    this._triangles = Math.round(triangles);
    this._skinnedMeshes = skinned;
    this._skinBones = bones;
  }

  private _playClip(name: string | null): void {
    if (!this._mixer) return;
    for (const action of this._actions.values()) {
      action.stop();
    }
    this._playing = null;
    if (name) {
      const action = this._actions.get(name);
      if (!action) return;
      action.reset().setLoop(true).play();
      this._playing = name;
    }
    this._hud?.sync(this._currentState());
    this._refreshReadout();
  }

  private _setTempo(value: number): void {
    this._tempo = value;
    this._hud?.sync(this._currentState());
  }

  private _currentState(): FoxLabState {
    return {
      rendererType: this.renderer?.type ?? "none",
      tempo: this._tempo,
      playingClip: this._playing,
      clips: [...this._clips],
      clipTime: this._playing ? (this._actions.get(this._playing)?.time ?? 0) : 0,
      loadOk: this._loadOk,
      skinnedMeshes: this._skinnedMeshes,
      skinBones: this._skinBones,
      triangles: this._triangles,
    };
  }

  private _refreshReadout(): void {
    const s = this._currentState();
    const durations = this._clips
      .map((n) => `${n}=${(this._actions.get(n)?.clip.duration ?? 0).toFixed(2)}s`)
      .join("  ");
    this._hud?.setReadout(
      `Backend:       ${s.rendererType}\n` +
        `Fox:           ${s.loadOk ? "loaded" : "LOAD FAILED"}\n` +
        `SkinnedMesh:   ${s.skinnedMeshes}  (bones ${s.skinBones}/64)\n` +
        `Triangles:     ${s.triangles.toLocaleString("en-US")}\n` +
        `Playing:       ${s.playingClip ?? "none (bind pose)"}  t=${s.clipTime.toFixed(2)}s\n` +
        `Clips:         ${durations}`,
    );
  }

  private _installQAHook(): void {
    window.__qaSwm48 = {
      sample: (): QaSwm48Sample => ({
        rendererType: this.renderer?.type ?? "none",
        frames: this._frames,
        loadOk: this._loadOk,
        meshes: this._meshes,
        triangles: this._triangles,
        visible: this.scene.lastFrustumVisibleObjects.length,
        skinnedMeshes: this._skinnedMeshes,
        skinBones: this._skinBones,
        playing: this._playing,
        clipTime: this._playing ? (this._actions.get(this._playing)?.time ?? 0) : 0,
        clips: [...this._clips],
      }),
    };
  }

  private _createControlHud(): void {
    this._hud = new Hud(this, {
      playClip: (name: string): void => this._playClip(name || null),
      setTempo: (value: number): void => this._setTempo(value),
      resetView: (): void => this.resetCamera(),
    });
    this._hud.sync(this._currentState());
    this._refreshReadout();
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase48] Failed to start:", err));
