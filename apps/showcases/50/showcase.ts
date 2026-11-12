// FIRST side-effect import: registers the opt-in Draco (`KHR_draco_mesh_compression`) and Basis
// Universal (`KHR_texture_basisu`) data-level plugins in the engine's extension registry, before
// any asset of this showcase is parsed. This is the first in-app consumer of the opt-in package.
import "@small-world-machine/gltf-extensions/register";

import {
  AbstractShowcase,
  AssetManager,
  CameraStrategyType,
  Color,
  MathUtils,
  OrbitController,
  PostProcessingEffectType,
  RendererType,
  Vector3D,
} from "@small-world-machine/engine";
import type {
  SmoothStrategy,
  BloomElement,
  EngineOptions,
  GrainElement,
  ToneMappingElement,
  VignetteElement,
} from "@small-world-machine/engine";
import { ChessSet } from "./Pieces.js";
import type { ChessPiece, ChessProgress } from "./Pieces.js";
import { Hud } from "./Hud.js";
import type { ChessLabState } from "./Hud.js";
import { LoadOverlay } from "./LoadOverlay.js";

/**
 * Remote chess set of the Khronos glTF-Sample-Assets repository (`ABeautifulGame`, KTX-ETC1S-Draco
 * variant, 12 MB). Hosted on raw.githubusercontent.com -- CORS-open, range-request capable, no
 * auth. The 43 MB uncompressed sibling stays uncommitted; this remote URL is the only source.
 */
const COMPRESSED_URL =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ABeautifulGame/glTF-Binary-KTX-ETC1S-Draco/ABeautifulGame.glb";
/**
 * `?full` A/B switch: the uncompressed `glTF-Binary` sibling (~43 MB, PNG textures, raw geometry) --
 * the variant the Khronos Sample Viewer shows -- rendered at native pixel density. ETC1S visibly
 * flattens the normal maps (mane, rook masonry, wood grain); this isolates asset loss from engine gaps.
 */
const FULL_QUALITY = new URLSearchParams(window.location.search).has("full");
const USE_LOCAL = new URLSearchParams(window.location.search).has("local");
const REMOTE_URL = USE_LOCAL
  ? "/assets/ABeautifulGame.glb"
  : FULL_QUALITY
    ? "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ABeautifulGame/glTF-Binary/ABeautifulGame.glb"
    : COMPRESSED_URL;

interface QaSwm50Sample {
  rendererType: string;
  loadOk: boolean;
  loadMs: number;
  bytes: number;
  meshCount: number;
  triangleCount: number;
  pieceCount: number;
  hovered: string | null;
  dragged: string | null;
  square: string | null;
  gridSnap: boolean;
}

interface QaSwm50Hook {
  sample(): QaSwm50Sample;
  setGridSnap(on: boolean): void;
  resetBoard(): void;
  /** Camera pose `[px, py, pz, tx, ty, tz]` (world space) -- reproducible A/B framing. */
  getView(): number[];
  setView(pose: number[]): void;
}

declare global {
  interface Window {
    __qaSwm50?: QaSwm50Hook;
  }
}

/**
 * Showcase 50 — Interactive Chess Set.
 *
 * The engine's first public demonstration of a real asset-load progress indicator: the official
 * Khronos `ABeautifulGame` chess set (KTX-ETC1S-Draco GLB, ~12 MB) is streamed straight from GitHub
 * with byte-level progress via `AssetManager.streamBinary`, decoded through the engine `GltfLoader`
 * (Draco + Basis Universal WASM from the opt-in `@small-world-machine/gltf-extensions` package) and
 * then presented as a grabbable 3D chess set: all 32 pieces can be dragged across the board and
 * snap onto the 8×8 square lattice that is derived from the model's own piece positions -- no
 * hardcoded board constants.
 *
 * Interaction design: the piece leaf meshes are pickable (precise triangle raycast), but all
 * pointer events are forwarded to the `ChessSet` controller and applied to the piece ROOT node, so
 * multi-mesh pawns (body + top) always move as one. The orbit camera suppresses rotation while a
 * piece is being dragged (`canRotate`).
 */
export class Showcase extends AbstractShowcase {
  protected override defaultCameraController = "none" as const;

  private _chess?: ChessSet;
  private _overlay?: LoadOverlay;
  private _hud?: Hud;
  private _loadOk: boolean = false;
  private _loadMs: number = 0;
  private _lastReadoutUpdate: number = 0;
  private _lastProgressUpdate: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      postProcessing: { enabled: true },
      quality: {
        // Software rendering on 1.5 M triangles: stay at 1:1 pixels so SwiftShader keeps a frame
        // budget during the gate run. `?full` renders at native (Retina) density for the visual A/B.
        maxPixelRatio: FULL_QUALITY ? 2 : 1,
      },
      ...options,
    });
    this.defaultFov = MathUtils.degToRad(40);
    this.defaultFar = 20;
  }

  protected override onCanvasRecreated(): void {
    // No pointer-lock on click: grabbing a piece must never fight the camera or a drag.
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    // Elevated 3/4 view of the axis-aligned 0.7-unit chessboard (board fields x/z ∈ [-0.22, 0.22],
    // verified from the decoded asset); `R` returns exactly here. Framing verified by vision QA:
    // the original distance left the board at ~30% of the frame -- this tuned distance holds it
    // at roughly half the frame height with the tallest pieces clear of the top and bottom edges.
    this.setInitialCamera(new Vector3D(0.67, 0.6, 0.8), new Vector3D(0, 0.06, 0));

    // Khronos Sample Viewer look: lit by IBL only (the asset ships no punctual lights), with the
    // blurred environment as backdrop. `ibl-studio` is baked from Khronos' "Neutral" studio panorama.
    this.renderer.setClearColor(new Color(0.42, 0.43, 0.45));
    await this.loadIbl("./assets/ibl-studio/", 1.0);
    await this.loadSkybox("./assets/ibl-studio/prefilter/mip2.webp", 10);

    this._setupPostElements();
    this._setupOrbit();

    this._overlay = new LoadOverlay();
    const startedAt = performance.now();
    const onProgress = (p: ChessProgress): void => {
      // Throttle the DOM writes of the byte-stream progress (~4 Hz max, match the readout rate).
      const now = performance.now();
      if (p.phase === "download" && now - this._lastProgressUpdate < 250 && p.loaded < p.total) {
        return;
      }
      this._lastProgressUpdate = now;
      this._overlay?.update(p);
    };
    try {
      const asset = await ChessSet.loadRemote(new AssetManager(), REMOTE_URL, onProgress);
      this._loadMs = performance.now() - startedAt;
      asset.onActivityChange = (): void => this._queueReadoutRefresh();
      this._chess = asset;
      asset.root.name = "ABeautifulGame";
      this.scene.add(asset.root);
      this._loadOk = true;
      this._overlay?.hide();
    } catch (err) {
      this._loadOk = false;
      console.error("[Showcase50] Failed to stream/parse ABeautifulGame:", err);
      const detail = err instanceof Error ? err.message : String(err);
      this._overlay?.fail(`Remote load failed — ${detail}`);
    }

    this._installQAHook();
    this._createControlHud();
  }

  public override destroy(): void {
    this._hud?.dispose();
    this._chess?.dispose();
    delete window.__qaSwm50;
    super.destroy();
  }

  protected override update(_deltaTime: number): void {
    const now = performance.now();
    if (now - this._lastReadoutUpdate > 250) {
      this._lastReadoutUpdate = now;
      this._refreshReadout();
    }
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    const boardReset = event.shiftKey && (event.key === "r" || event.key === "R");
    if (boardReset) {
      // Shift+R returns every piece to its home square and is fully consumed (no camera reset).
      event.preventDefault();
      this._chess?.resetBoard();
      return;
    }
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === "KeyQ" && !event.shiftKey) {
      this._setFullQuality(!FULL_QUALITY);
      return;
    }
    this._hud?.handleKey(event);
  }

  private _setupPostElements(): void {
    // MEMORY §H: enabling the group activates loud siblings (vignette, grain, bloom). A clean
    // studio screenshot for the gate needs only tone mapping -- switch the three off explicitly.
    const pp = this.renderer.postProcessing;
    pp.get<BloomElement>(PostProcessingEffectType.BLOOM)!.enabled = false;
    pp.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!.enabled = false;
    pp.get<GrainElement>(PostProcessingEffectType.GRAIN)!.enabled = false;
    // Viewer default exposure; brightness comes from the IBL, not from exposure.
    pp.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!.exposure = 1.0;
  }

  private _setupOrbit(): void {
    // Same contract as the engine default orbit controller, plus drag suppression: while a piece
    // is held (`interactionManager.activeObject`), camera rotation is paused so the board stays put.
    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    // The strategy default `minRadius = 2` would clamp this ~1-unit-scale board scene away from
    // the camera; allow close framing and zoom-in down to the pieces.
    const strategy = this.camera.strategy as SmoothStrategy;
    strategy.minRadius = 0.3;
    strategy.maxRadius = 4;
    this.camera.addBehavior(
      new OrbitController({
        input: this.input,
        rotateButton: "both",
        canRotate: (): boolean => !this.interactionManager?.activeObject,
      }),
    );
  }

  private _queueReadoutRefresh(): void {
    // Called by ChessSet on hover/drag activity; the throttled `update()` picks it up.
    this._lastReadoutUpdate = 0;
  }

  private _currentState(): ChessLabState {
    const dragged = this._chess?.dragged ?? null;
    return {
      rendererType: this.renderer?.type ?? "none",
      loadOk: this._loadOk,
      loadMs: Math.round(this._loadMs),
      bytes: this._chess?.stats.bytes ?? 0,
      pieceCount: this._chess?.pieces.length ?? 0,
      gridSnap: this._chess?.gridSnap ?? true,
      hovered: (this._chess?.hovered as ChessPiece | null)?.name ?? null,
      dragged: dragged?.name ?? null,
      square: dragged ? (this._chess?.squareOf(dragged) ?? null) : null,
    };
  }

  private _refreshReadout(): void {
    const s = this._currentState();
    this._hud?.sync(s);
    const ext = this._chess?.stats.extensionsUsed ?? [];
    const tri = (this._chess?.stats.triangleCount ?? 0).toLocaleString("en-US");
    this._hud?.setReadout(
      `Backend:    ${s.rendererType}\n` +
        `Model:      ${s.loadOk ? "ABeautifulGame loaded" : "LOAD FAILED"}\n` +
        `Load:       ${s.loadMs} ms · ${(s.bytes / 1048576).toFixed(1)} MB streamed\n` +
        `Scene:      ${s.pieceCount} pieces · ${tri} triangles\n` +
        `Extensions: ${ext.join(", ") || "—"}\n` +
        `Hover:      ${s.hovered ?? "—"}\n` +
        `Drag:       ${s.dragged ?? "—"}${s.square ? ` → ${s.square}` : ""}\n` +
        `Grid snap:  ${s.gridSnap ? "ON" : "OFF"}`,
    );
  }

  private _installQAHook(): void {
    Reflect.set(window, "__showcase", this);
    window.__qaSwm50 = {
      sample: (): QaSwm50Sample => {
        const s = this._currentState();
        return {
          rendererType: s.rendererType,
          loadOk: s.loadOk,
          loadMs: s.loadMs,
          bytes: s.bytes,
          meshCount: this._chess?.stats.meshCount ?? 0,
          triangleCount: this._chess?.stats.triangleCount ?? 0,
          pieceCount: s.pieceCount,
          hovered: s.hovered,
          dragged: s.dragged,
          square: s.square,
          gridSnap: s.gridSnap,
        };
      },
      setGridSnap: (on: boolean): void => this._chess?.setGridSnap(on),
      resetBoard: (): void => this._chess?.resetBoard(),
      getView: (): number[] => {
        const p = this.camera.position;
        const t = this.camera.target;
        return [p.x, p.y, p.z, t.x, t.y, t.z].map((v) => Math.round(v * 1000) / 1000);
      },
      setView: (pose: number[]): void => {
        const [px = 0, py = 0, pz = 0, tx = 0, ty = 0, tz = 0] = pose;
        // SmoothStrategy convention: position = target + radius * (sinθ·cosφ, sinφ, cosθ·cosφ).
        const rx = px - tx;
        const ry = py - ty;
        const rz = pz - tz;
        const radius = Math.hypot(rx, ry, rz);
        this.camera.target.set(tx, ty, tz);
        this.camera.position.set(px, py, pz);
        this.camera.phi = Math.asin(ry / radius);
        this.camera.theta = Math.atan2(rx, rz);
        (this.camera.strategy as SmoothStrategy).radius = radius;
      },
    };
  }

  private _createControlHud(): void {
    this._hud = new Hud(
      this,
      {
        setGridSnap: (on: boolean): void => this._chess?.setGridSnap(on),
        resetBoard: (): void => this._chess?.resetBoard(),
        resetView: (): void => this.resetCamera(),
        setFullQuality: (on: boolean): void => this._setFullQuality(on),
      },
      FULL_QUALITY,
    );
    this._refreshReadout();
  }

  /** Asset variant and pixel ratio are fixed at construction, so a switch is a `?full` reload. */
  private _setFullQuality(on: boolean): void {
    if (on === FULL_QUALITY) return;
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("full", "");
    else url.searchParams.delete("full");
    window.location.assign(url.toString());
  }
}

const app = new Showcase();
// Module-level instance; `start()` is kicked off by the superclass pattern used across showcases.

app.start().catch((err: unknown) => console.error("[Showcase50] Failed to start:", err));
