import {
  hudNote,
  hudSection,
  ShowcaseDrawer,
} from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface UnlitLabState {
  rendererType: string;
  /** Active material mode: "authored" | "lit" | "unlit". */
  mode: string;
  loadOk: boolean;
  materialCount: number;
  /** Number of materials currently compiled with the unlit flag. */
  unlitCount: number;
  meshes: number;
  triangles: number;
}

/** Showcase actions the panel triggers. */
export interface UnlitLabActions {
  setMode(mode: "authored" | "lit" | "unlit"): void;
  resetView(): void;
}

/**
 * Unlit Reference Lab panel of showcase 49 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; the model, lights and material mode stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;
  private readonly _readout: HTMLElement;
  private _hovering: boolean = false;

  constructor(engine: FrameTelemetrySource, private readonly _actions: UnlitLabActions) {
    document.getElementById("unlitLabStyle")?.remove();
    const style = document.createElement("style");
    this._style = style;
    style.id = "unlitLabStyle";
    style.textContent = `
      #unlitLabReadout {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        font-size: 10px;
        line-height: 1.45;
        color: #a5f3fc;
        background: rgba(2, 6, 23, 0.65);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 6px;
        padding: 7px 9px;
        margin: 8px 0 0 0;
        white-space: pre;
      }
    `;
    document.head.appendChild(style);

    this._drawer = new ShowcaseDrawer({
      id: "unlit-lab-hud",
      title: "Unlit Reference Lab",
      icon: "🧱",
      open: false,
      footerIcon: "⚙",
      buttonId: "unlitLabInspectorBtn",
      engine,
      body: `
        ${hudSection(
          "🎛 Material Mode",
          "live shader re-link",
          `<div class="preset-group two-col" style="margin-bottom:6px;">
            <button id="btnModeAuthored" class="btn-preset" title="Keep each material's imported KHR_materials_unlit state (both cubes are unlit)">As Imported</button>
            <button id="btnModeUnlit" class="btn-preset" title="Force every material unlit: flat base color on all faces">Force Unlit</button>
          </div>
          <div class="preset-group two-col">
            <button id="btnModeLit" class="btn-preset" title="Force every material lit (PBR): the same base color now receives lighting + IBL">Force Lit</button>
          </div>
          <div class="hud-note">💡 <b>Unlit</b> renders the base color as-is on every face — lighting, IBL and emissive are ignored by the <code>USE_UNLIT</code> shader variant. Switching modes re-links the material's shader flags live.</div>`,
        )}

        ${hudSection(
          "🔭 View",
          "Orbit · R reset",
          `<div class="preset-group two-col" style="margin-bottom:8px;">
            <button id="btnResetView" class="btn-preset" title="Reset to the calibrated reference view (Key R)">Reset View</button>
          </div>
          <div class="hud-note">💡 <b>Renderer swap:</b> Option/Alt + 1 (WebGL1) / 2 (WebGL2) / 3 (WebGPU).</div>`,
        )}

        ${hudSection(
          "📊 Unlit Readout",
          "live",
          `<pre id="unlitLabReadout"></pre>`,
        )}

        ${hudNote(
          `🟢 <b>Khronos glTF-Sample-Assets</b>: <code>UnlitTest</code> (CC0) &mdash; the official <code>KHR_materials_unlit</code> test asset (2 unlit cubes) &mdash; shall render identical flat colors on all three renderer tiers, independent of the scene lights.`,
        )}
      `,
    });
    this._readout = this._drawer.query<HTMLElement>("#unlitLabReadout")!;
    this._bind();
  }

  /** True while the pointer is over the open panel; the canvas orbit ignores input then. */
  public get isHovering(): boolean {
    return this._hovering && this._drawer.isOpen;
  }

  public get isOpen(): boolean {
    return this._drawer.isOpen;
  }

  /** Handles the I / H panel toggle. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Removes the drawer, its footer button and the injected style tag (showcase teardown). */
  public dispose(): void {
    this._style.remove();
    this._drawer.dispose();
  }

  /** Writes the live readout; skips the DOM write when nothing changed. */
  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  /** Reflects the current showcase state in every control. */
  public sync(state: UnlitLabState): void {
    const d = this._drawer;
    for (const name of ["Authored", "Unlit", "Lit"] as const) {
      const btn = d.query<HTMLButtonElement>(`#btnMode${name}`);
      if (btn) btn.classList.toggle("active", name.toLowerCase() === state.mode);
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

    d.query("#btnResetView")?.addEventListener("click", () => a.resetView());
    d.query("#btnModeAuthored")?.addEventListener("click", () => a.setMode("authored"));
    d.query("#btnModeUnlit")?.addEventListener("click", () => a.setMode("unlit"));
    d.query("#btnModeLit")?.addEventListener("click", () => a.setMode("lit"));
  }
}
