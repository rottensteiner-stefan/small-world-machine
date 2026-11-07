import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  GltfLoader,
  MathUtils,
  PointLight,
  RendererType,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import type { EngineOptions, Object3D } from "@small-world-machine/engine";
import { Hud } from "./Hud.js";
import type { UnlitLabState } from "./Hud.js";

interface QaSwm49Sample {
  rendererType: string;
  frames: number;
  loadOk: boolean;
  objects: number;
  meshes: number;
  triangles: number;
  visible: number;
  mode: string;
  materialCount: number;
  unlitCount: number;
}

interface QaSwm49Hook {
  sample(): QaSwm49Sample;
  setMode(mode: "authored" | "lit" | "unlit"): void;
}

declare global {
  interface Window {
    __qaSwm49?: QaSwm49Hook;
  }
}

type MaterialMode = "authored" | "lit" | "unlit";

/**
 * Showcase 49 — Unlit Reference Lab (Khronos UnlitTest).
 *
 * Loads the official Khronos `KHR_materials_unlit` test asset (two unlit cubes) and renders it via
 * the engine's `StandardMaterial.unlit` path (`USE_UNLIT` shader variant, all three renderer
 * tiers). The HUD (ShowcaseDrawer + perf footer) flips every material between its imported unlit
 * state and a forced-lit PBR state to demonstrate that unlit output is strictly base-color,
 * independent of scene lights and IBL.
 */
export class Showcase extends AbstractShowcase {
  /** Imported per-material unlit state, restored by the "as imported" mode. */
  private _materials: { material: StandardMaterial; importedUnlit: boolean }[] = [];
  private _mode: MaterialMode = "authored";
  private _key?: DirectionalLight;
  private _ambient?: AmbientLight;
  private _fill?: PointLight;
  private _hud?: Hud;
  private _objects: number = 0;
  private _meshes: number = 0;
  private _triangles: number = 0;
  private _loadOk: boolean = false;
  private _frames: number = 0;
  private _lastReadoutUpdate: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      postProcessing: { enabled: true },
      quality: {
        maxPixelRatio: 1.5,
      },
      ...options,
    });
    this.defaultCameraController = "orbit";
    this.defaultFov = MathUtils.degToRad(40);
    this.defaultFar = 200;
  }

  protected override onCanvasRecreated(): void {
    // No pointer-lock on click: the orbit stays frictionless.
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    // Canonical 3/4-elevated framing of the two reference cubes (2 unit cubes, x = -1.2 / +1.2).
    // The angled view proves the unlit path shades nothing: every visible face is flat color.
    this.setInitialCamera(new Vector3D(4.4, 3.4, 6.4), new Vector3D(0, 0, 0));

    // Neutral studio backdrop. The unlit materials ignore lights and IBL entirely; the lights
    // only exist so the HUD's "Force Lit" contrast mode has something to show.
    this.renderer.setClearColor(new Color(0.24, 0.245, 0.26));
    await this.loadIbl("./assets/ibl-neut/", 1.4);

    this._setupLights();
    await this._loadReference();
    this._installQAHook();
    this._createControlHud();
  }

  public override destroy(): void {
    this._hud?.dispose();
    delete window.__qaSwm49;
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
    this._hud?.handleKey(event);
  }

  private _setupLights(): void {
    this._ambient = new AmbientLight({
      color: new Color(0.85, 0.87, 0.9),
      intensity: 0.3,
    });
    this.scene.add(this._ambient);

    this._key = new DirectionalLight({
      color: new Color(1.0, 0.96, 0.9),
      intensity: 2.6,
    });
    this._key.direction.set(-0.5, -0.75, -0.42).normalize();
    this.scene.add(this._key);

    this._fill = new PointLight({
      color: new Color(0.55, 0.62, 0.95),
      intensity: 1.2,
      distance: 20,
      decay: 1.0,
    });
    this._fill.position.set(3.5, 2.2, 1.8);
    this.scene.add(this._fill);
  }

  private async _loadReference(): Promise<void> {
    try {
      this._materials = [];
      const loader = new GltfLoader({
        onMaterialParsed: (mat): void => {
          if (mat instanceof StandardMaterial) {
            this._materials.push({ material: mat, importedUnlit: mat.unlit });
          }
        },
      });
      const root = await loader.load("./assets/UnlitTest.glb");
      root.name = "UnlitTest";
      this.scene.add(root);

      this._measureScene(root);
      this._applyMode(this._mode);
      this._loadOk = true;
    } catch (err) {
      this._loadOk = false;
      console.error("[Showcase49] Failed to load UnlitTest:", err);
    }
  }

  private _measureScene(root: Object3D): void {
    let meshes = 0;
    let triangles = 0;
    const walk = (obj: Object3D): void => {
      const geo = obj.geometry;
      if (geo) {
        meshes++;
        if (geo.indices && geo.indices.length > 0) {
          triangles += geo.indices.length / 3;
        } else if (geo.vertices && geo.vertices.length > 0) {
          triangles += geo.vertices.length / 9;
        }
      }
      for (const child of obj.children) {
        walk(child);
      }
    };
    walk(root);
    this._meshes = meshes;
    this._triangles = Math.round(triangles);
    this._objects = this.scene.root.children.length;
  }

  private _setMode(mode: MaterialMode): void {
    this._mode = mode;
    this._applyMode(mode);
    this._hud?.sync(this._currentState());
    this._refreshReadout();
  }

  /**
   * Applies the material mode to every imported material. `getRenderManifest()` re-packs the
   * shader flags on the next draw, so the renderer re-links the `USE_UNLIT` variant live.
   */
  private _applyMode(mode: MaterialMode): void {
    for (const { material, importedUnlit } of this._materials) {
      material.unlit = mode === "authored" ? importedUnlit : mode === "unlit";
    }
  }

  private _currentState(): UnlitLabState {
    return {
      rendererType: this.renderer?.type ?? "none",
      mode: this._mode,
      loadOk: this._loadOk,
      materialCount: this._materials.length,
      unlitCount: this._materials.filter((m) => m.material.unlit).length,
      meshes: this._meshes,
      triangles: this._triangles,
    };
  }

  private _refreshReadout(): void {
    const s = this._currentState();
    const flags = this._materials
      .map(
        (m, i) =>
          `mat${i}: unlit=${m.material.unlit} flags=[${(m.material.getRenderManifest().flags ?? []).join(",")}]`,
      )
      .join("\n");
    this._hud?.setReadout(
      `Backend:     ${s.rendererType}\n` +
        `Model:       ${s.loadOk ? "UnlitTest loaded" : "LOAD FAILED"}\n` +
        `Mode:        ${s.mode}  (${s.unlitCount}/${s.materialCount} unlit)\n` +
        `Triangles:   ${s.triangles.toLocaleString("en-US")}\n` +
        `${flags}`,
    );
  }

  private _installQAHook(): void {
    window.__qaSwm49 = {
      sample: (): QaSwm49Sample => ({
        rendererType: this.renderer?.type ?? "none",
        frames: this._frames,
        loadOk: this._loadOk,
        objects: this._objects,
        meshes: this._meshes,
        triangles: this._triangles,
        visible: this.scene.lastFrustumVisibleObjects.length,
        mode: this._mode,
        materialCount: this._materials.length,
        unlitCount: this._materials.filter((m) => m.material.unlit).length,
      }),
      setMode: (mode: MaterialMode): void => this._setMode(mode),
    };
  }

  private _createControlHud(): void {
    this._hud = new Hud(this, {
      setMode: (mode: MaterialMode): void => this._setMode(mode),
      resetView: (): void => this.resetCamera(),
    });
    this._hud.sync(this._currentState());
    this._refreshReadout();
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase49] Failed to start:", err));
