import { hudNote, hudSection, ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface ChessLabState {
  rendererType: string;
  loadOk: boolean;
  loadMs: number;
  bytes: number;
  pieceCount: number;
  gridSnap: boolean;
  hovered: string | null;
  dragged: string | null;
  square: string | null;
}

/** Showcase actions the panel triggers. */
export interface ChessLabActions {
  setGridSnap(on: boolean): void;
  resetBoard(): void;
  resetView(): void;
  /** Reloads the showcase with the compressed (`false`) or uncompressed (`true`) asset variant. */
  setFullQuality(on: boolean): void;
}

/**
 * Interactive Chess Lab panel of showcase 50 on the shared {@link ShowcaseDrawer}. Owns only the
 * controls; the model, drag controller and board live in the showcase / `ChessSet`.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _readout: HTMLElement;
  private _hovering: boolean = false;

  constructor(
    engine: FrameTelemetrySource,
    private readonly _actions: ChessLabActions,
    fullQuality: boolean,
  ) {
    this._drawer = new ShowcaseDrawer({
      id: "swm50-chess-hud",
      title: "Interactive Chess Lab",
      icon: "♞",
      open: false,
      footerIcon: "⚙",
      buttonId: "swm50ChessInspectorBtn",
      engine,
      body: `
        ${hudSection(
          "🎮 Chess Interaction",
          "drag pieces",
          `<div class="preset-group two-col" style="margin-bottom:8px;">
            <button id="swm50ResetBoard" class="btn-preset" title="Return every piece to its home square (Shift+R)">⟲ Reset Board</button>
            <button id="swm50ResetView" class="btn-preset" title="Reset the camera to the reference view (Key R)">Reset View</button>
          </div>
          <div class="hud-row">
            <label for="swm50GridSnap">Grid Snap</label>
            <label class="hud-switch"><input type="checkbox" id="swm50GridSnap" checked><span class="hud-switch-slider"></span></label>
          </div>
          <div class="hud-note">💡 Grab any piece and place it on the board. Snap locks onto the 8×8 square lattice derived from the model's own piece positions — no hardcoded board constants.</div>`,
        )}

        ${hudSection(
          "💎 Asset Quality",
          "reload · Q",
          `<div class="preset-group two-col" style="margin-bottom:8px;">
            <button id="swm50QualityCompressed" class="btn-preset ${fullQuality ? "" : "active"}" title="KTX2 ETC1S + Draco, 12 MB, 1:1 pixels (Q toggles)">Compressed · 12 MB</button>
            <button id="swm50QualityFull" class="btn-preset ${fullQuality ? "active" : ""}" title="Uncompressed glTF-Binary, 43 MB, native pixel density (Q toggles)">Full · 43 MB</button>
          </div>
          <div class="hud-note">💡 ETC1S flattens the normal maps (knight's eye and mane, rook masonry, wood grain). <b>Full</b> loads the variant the Khronos Sample Viewer shows, at Retina density.</div>`,
        )}

        ${hudSection(
          "🏗 Load Progress",
          "engine-native",
          `<div class="hud-note">The remote GLB is streamed with real byte progress via <code>AssetManager.streamBinary</code> and displayed in the load overlay — the engine's first public <b>asset-load progress indicator</b> (download → Draco/Basis decode → prepare).</div>`,
        )}

        ${hudSection("📊 Session Readout", "live", `<pre id="swm50Readout"></pre>`)}

        ${hudNote(
          `🟢 <b>Khronos glTF-Sample-Assets</b>: <code>ABeautifulGame</code> (CC-BY 4.0, &copy; ASWF 2020 &middot; Ed Mackey 2022) &mdash; chess set using transmission + volume, loaded as the official <code>glTF-Binary-KTX-ETC1S-Draco</code> variant (or <code>glTF-Binary</code> in Full quality) from GitHub and decoded with the opt-in <span style="color:#7dd3fc">@small-world-machine/gltf-extensions</span> (<code>KHR_draco_mesh_compression</code> + <code>KHR_texture_basisu</code>). If the remote file becomes unreachable, a local mirror is the planned remedy.`,
        )}
      `,
    });
    this._readout = this._drawer.query<HTMLElement>("#swm50Readout")!;
    this._readout.style.whiteSpace = "pre";
    this._bind();
  }

  /** True while the pointer is over the open panel; the canvas input is shielded then. */
  public get isHovering(): boolean {
    return this._hovering && this._drawer.isOpen;
  }

  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public dispose(): void {
    this._drawer.dispose();
  }

  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  public sync(state: ChessLabState): void {
    const d = this._drawer;
    const snap = d.query<HTMLInputElement>("#swm50GridSnap");
    if (snap && snap.checked !== state.gridSnap) {
      snap.checked = state.gridSnap;
    }
  }

  private _bind(): void {
    const a = this._actions;
    const d = this._drawer;
    d.root.addEventListener("pointerenter", () => {
      this._hovering = true;
    });
    d.root.addEventListener("pointerleave", () => {
      this._hovering = false;
    });

    d.query("#swm50ResetBoard")?.addEventListener("click", () => a.resetBoard());
    d.query("#swm50ResetView")?.addEventListener("click", () => a.resetView());
    d.query("#swm50QualityCompressed")?.addEventListener("click", () => a.setFullQuality(false));
    d.query("#swm50QualityFull")?.addEventListener("click", () => a.setFullQuality(true));
    d.query("#swm50GridSnap")?.addEventListener("change", (e: Event) => {
      a.setGridSnap((e.target as HTMLInputElement).checked);
    });
  }
}
