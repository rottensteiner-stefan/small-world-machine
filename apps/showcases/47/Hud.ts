import {
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
  ShowcaseDrawer,
} from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";
import { bindRange } from "../shared/hudBindings.js";

export type LabSlider = "KeyInt" | "AmbInt" | "RimInt";

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface PbrLabState {
  rendererType: string;
  keyIntensity: number;
  ambientIntensity: number;
  rimIntensity: number;
  toneMapping: boolean;
  bloom: boolean;
  objects: number;
  meshes: number;
  triangles: number;
  visible: number;
  loadOk: boolean;
}

/** Showcase actions the panel triggers. */
export interface PbrLabActions {
  setSlider(name: LabSlider, value: number): void;
  setToneMapping(on: boolean): void;
  setBloom(on: boolean): void;
  resetView(): void;
}

/** Label format per slider: decimals and unit suffix. */
const SLIDER_FORMAT: Record<LabSlider, readonly [number, string]> = {
  KeyInt: [2, ""],
  AmbInt: [2, ""],
  RimInt: [2, ""],
};
const SLIDERS = Object.keys(SLIDER_FORMAT) as LabSlider[];

/** Readout text of a lab slider (decimals + unit suffix). */
export function formatSlider(name: LabSlider, value: number): string {
  const [decimals, suffix] = SLIDER_FORMAT[name];
  return `${value.toFixed(decimals)}${suffix}`;
}

/**
 * PBR Reference Lab panel of showcase 47 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; the reference grid, lights and post-processing stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;
  private readonly _readout: HTMLElement;
  private _hovering: boolean = false;

  constructor(engine: FrameTelemetrySource, private readonly _actions: PbrLabActions) {
    document.getElementById("pbrLabStyle")?.remove();
    const style = document.createElement("style");
    this._style = style;
    style.id = "pbrLabStyle";
    style.textContent = `
      #pbrLabReadout {
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
      id: "pbr-lab-hud",
      title: "PBR Reference Lab",
      icon: "🔬",
      open: false,
      footerIcon: "⚙",
      buttonId: "pbrLabInspectorBtn",
      engine,
      body: `
        ${hudSection(
          "🔭 View",
          "Orbit · R reset",
          `
          <div class="preset-group two-col" style="margin-bottom:8px;">
            <button id="btnResetView" class="btn-preset" title="Reset to the calibrated reference view (Key R)">Reset View</button>
          </div>
          <div class="hud-note">💡 <b>Renderer swap:</b> Option/Alt + 1 (WebGL1) / 2 (WebGL2) / 3 (WebGPU).</div>`,
        )}

        ${hudSection(
          "💡 Studio Light",
          "live",
          hudSlider("slKeyInt", "Key Light", 0, 8, 0.05) +
            hudSlider("slAmbInt", "Ambient Fill", 0, 1, 0.01) +
            hudSlider("slRimInt", "Rim / Back", 0, 6, 0.05),
        )}

        ${hudSection(
          "🎞 Post-Processing",
          "toggles",
          hudSwitch("swTone", "Tone Mapping (ACES)") + hudSwitch("swBloom", "Bloom"),
        )}

        ${hudSection(
          "📊 Reference Readout",
          "live",
          `<pre id="pbrLabReadout"></pre>`,
        )}

        ${hudNote(
          `🟢 <b>Khronos glTF-Sample-Assets</b>: <code>MetalRoughSpheres</code> (CC-BY 4.0) &mdash; soll die identische
          Referenz über alle Renderer-Tiers liefern. Neutral gebaut, keine engine-eigene Tönung.`,
        )}
      `,
    });
    this._readout = this._drawer.query<HTMLElement>("#pbrLabReadout")!;
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
  public sync(state: PbrLabState): void {
    const d = this._drawer;
    this._setSlider("KeyInt", state.keyIntensity);
    this._setSlider("AmbInt", state.ambientIntensity);
    this._setSlider("RimInt", state.rimIntensity);
    const tone = d.query<HTMLInputElement>("#swTone");
    if (tone) tone.checked = state.toneMapping;
    const bloom = d.query<HTMLInputElement>("#swBloom");
    if (bloom) bloom.checked = state.bloom;
  }

  private _setSlider(name: LabSlider, value: number): void {
    const slider = this._drawer.query<HTMLInputElement>(`#sl${name}`);
    if (slider) slider.value = String(value);
    const label = this._drawer.query(`#sl${name}_val`);
    if (label) label.textContent = formatSlider(name, value);
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
    const tone = d.query<HTMLInputElement>("#swTone");
    tone?.addEventListener("change", () => a.setToneMapping(tone.checked));
    const bloom = d.query<HTMLInputElement>("#swBloom");
    bloom?.addEventListener("change", () => a.setBloom(bloom.checked));

    for (const name of SLIDERS) {
      bindRange(
        d.query<HTMLInputElement>(`#sl${name}`),
        d.query(`#sl${name}_val`),
        (v) => formatSlider(name, v),
        (v) => a.setSlider(name, v),
      );
    }
  }
}
