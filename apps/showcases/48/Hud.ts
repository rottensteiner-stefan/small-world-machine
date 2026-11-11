import { hudNote, hudSection, hudSlider, ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";
import { bindRange } from "../shared/hudBindings.js";

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface FoxLabState {
  rendererType: string;
  tempo: number;
  /** Currently-playing clip name, or null when nothing plays. */
  playingClip: string | null;
  clips: string[];
  clipTime: number;
  loadOk: boolean;
  skinnedMeshes: number;
  skinBones: number;
  triangles: number;
}

/** Showcase actions the panel triggers. */
export interface FoxLabActions {
  playClip(name: string): void;
  setTempo(value: number): void;
  resetView(): void;
}

/**
 * Fox Skinning Lab panel of showcase 48 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; the skeleton, mixer and lights stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;
  private readonly _readout: HTMLElement;
  private _hovering: boolean = false;

  constructor(
    engine: FrameTelemetrySource,
    private readonly _actions: FoxLabActions,
  ) {
    document.getElementById("foxLabStyle")?.remove();
    const style = document.createElement("style");
    this._style = style;
    style.id = "foxLabStyle";
    style.textContent = `
      #foxLabReadout {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        font-size: 10px;
        line-height: 1.45;
        color: #a5f3fc;
        background: rgba(2, 6, 23, 0.65);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 6px;
        padding: 7px 9px;
        margin: 8px 0 0 0;
        white-space: pre-wrap; overflow-wrap: anywhere;
      }
    `;
    document.head.appendChild(style);

    this._drawer = new ShowcaseDrawer({
      id: "fox-lab-hud",
      title: "Fox Skinning Lab",
      icon: "🦊",
      open: false,
      footerIcon: "⚙",
      buttonId: "foxLabInspectorBtn",
      engine,
      body: `
        ${hudSection(
          "🎬 Animation Clip",
          "loops",
          `<div class="preset-group two-col" style="margin-bottom:8px;">
            <button id="btnClipSurvey" class="btn-preset">Survey</button>
            <button id="btnClipWalk" class="btn-preset">Walk</button>
          </div>
          <div class="preset-group two-col">
            <button id="btnClipRun" class="btn-preset">Run</button>
            <button id="btnClipIdle" class="btn-preset" title="Bind pose (no clip)">Bind Pose</button>
          </div>`,
        )}

        ${hudSection("⏱ Playback", "live", hudSlider("slTempo", "Tempo", 0, 3, 0.05))}

        ${hudSection(
          "🔭 View",
          "Orbit · R reset",
          `<div class="preset-group two-col" style="margin-bottom:8px;">
            <button id="btnResetView" class="btn-preset" title="Reset to the calibrated view (Key R)">Reset View</button>
          </div>
          <div class="hud-note">💡 <b>Renderer swap:</b> Option/Alt + 1 (WebGL1) / 2 (WebGL2) / 3 (WebGPU).</div>`,
        )}

        ${hudSection("📊 Skinning Readout", "live", `<pre id="foxLabReadout"></pre>`)}

        ${hudNote(
          `🟢 <b>Khronos glTF-Sample-Assets</b>: <code>Fox</code> (CC-BY 4.0, Google) &mdash; 24-Joint-Rig, drei Clips &mdash; soll auf allen
          drei Renderer-Tiers identisch skinnen (WebGL1-Pfad engine-neu).`,
        )}
      `,
    });
    this._readout = this._drawer.query<HTMLElement>("#foxLabReadout")!;
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
  public sync(state: FoxLabState): void {
    const d = this._drawer;
    const tempo = d.query<HTMLInputElement>("#slTempo");
    if (tempo) tempo.value = String(state.tempo);
    const tempoVal = d.query("#slTempo_val");
    if (tempoVal) tempoVal.textContent = formatTempo(state.tempo);
    // Active clip button gets the "armed" look.
    for (const name of ["Survey", "Walk", "Run", "Idle"] as const) {
      const btn = d.query<HTMLButtonElement>(`#btnClip${name}`);
      if (btn) btn.classList.toggle("active", name === state.playingClip);
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
    d.query("#btnClipSurvey")?.addEventListener("click", () => a.playClip("Survey"));
    d.query("#btnClipWalk")?.addEventListener("click", () => a.playClip("Walk"));
    d.query("#btnClipRun")?.addEventListener("click", () => a.playClip("Run"));
    d.query("#btnClipIdle")?.addEventListener("click", () => a.playClip(""));

    bindRange(
      d.query<HTMLInputElement>("#slTempo"),
      d.query("#slTempo_val"),
      (v) => formatTempo(v),
      (v) => a.setTempo(v),
    );
  }
}

/** Tempo slider label (decimals). */
export function formatTempo(value: number): string {
  return `${value.toFixed(2)}×`;
}
