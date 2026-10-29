import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

export type MaterialLabSlider =
  "Roughness" | "Metallic" | "Azimuth" | "Elevation" | "KeyIntensity" | "Ambient";

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface HudState {
  presetIndex: number;
  roughness: number;
  metallic: number;
  colorHex: string;
  azimuthDeg: number;
  elevationDeg: number;
  keyIntensity: number;
  ambient: number;
  iblEnabled: boolean;
  gridVisible: boolean;
}

/** Showcase actions the panel triggers; the showcase re-syncs the panel afterwards. */
export interface HudActions {
  applyPreset(index: number): void;
  toggleIbl(): void;
  toggleGrid(): void;
  resetToReference(): void;
  setSlider(name: MaterialLabSlider, value: number): void;
  setColor(hex: string): void;
}

const SLIDERS: readonly MaterialLabSlider[] = [
  "Roughness",
  "Metallic",
  "Azimuth",
  "Elevation",
  "KeyIntensity",
  "Ambient",
];

/**
 * Material Lab panel of showcase 43 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; material, light and studio state stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;
  private readonly _presetCount: number;

  constructor(
    presetNames: readonly string[],
    elevationRange: { min: number; max: number },
    private readonly _actions: HudActions,
  ) {
    const style = document.createElement("style");
    style.textContent = `
      #showcase-hud input[type="color"] { width: 100%; height: 22px; border: none; background: none; }
    `;
    document.head.appendChild(style);
    this._style = style;
    this._presetCount = presetNames.length;

    const presetButtons = presetNames
      .map(
        (name, i) =>
          `<button id="st43Preset${i}" class="btn-preset" title="${name} (Key ${i + 1})">${i + 1} · ${name}</button>`,
      )
      .join("");

    this._drawer = new ShowcaseDrawer({
      id: "showcase-hud",
      title: "Material Lab",
      icon: "⚪",
      footerIcon: "⚙",
      body: `
        <div class="hud-section">
          <div class="section-title"><span>🎨 Material</span><span style="font-size:9px;color:#64748b;">Keys 1–4 · [ ]</span></div>
          <div class="preset-group four-col" style="margin-bottom:8px;">${presetButtons}</div>
          <div class="hud-row">
            <label for="st43SlRoughness" title="Micro-surface roughness ([ / ])">Roughness</label>
            <input id="st43SlRoughness" type="range" min="0" max="1" step="0.01" />
            <span id="st43ValRoughness" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlMetallic" title="Dielectric (0) to metal (1) (Shift + [ / ])">Metallic</label>
            <input id="st43SlMetallic" type="range" min="0" max="1" step="0.01" />
            <span id="st43ValMetallic" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43Color">Base Color</label>
            <input id="st43Color" type="color" />
            <span class="val-label"></span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>☀️ Key Light</span><span style="font-size:9px;color:#64748b;">Arrows · Shift = fine</span></div>
          <div class="hud-row">
            <label for="st43SlAzimuth">Azimuth</label>
            <input id="st43SlAzimuth" type="range" min="-180" max="180" step="1" />
            <span id="st43ValAzimuth" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlElevation">Elevation</label>
            <input id="st43SlElevation" type="range" min="${elevationRange.min}" max="${elevationRange.max}" step="1" />
            <span id="st43ValElevation" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlKeyIntensity">Intensity</label>
            <input id="st43SlKeyIntensity" type="range" min="0" max="5" step="0.05" />
            <span id="st43ValKeyIntensity" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlAmbient" title="Flat fill light; controls how dark the shadow gets">Ambient</label>
            <input id="st43SlAmbient" type="range" min="0" max="1" step="0.01" />
            <span id="st43ValAmbient" class="val-label"></span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>🧭 Studio</span></div>
          <div class="preset-group two-col">
            <button id="st43BtnIbl" class="btn-preset" title="Image-based lighting (Key E)">E · IBL</button>
            <button id="st43BtnGrid" class="btn-preset" title="1 m grid on the floor (Key G)">G · 1 m Grid</button>
          </div>
          <div class="hud-note">💡 <b>Try Chrome without IBL, then press E:</b> a mirror can only show what surrounds it.</div>
          <button id="st43BtnReset" class="btn-preset" style="width:100%;margin-top:8px;" title="Golden reference state (Key 0)">0 · Reset to Reference</button>
        </div>

        <div class="hud-section hud-keys">
          <kbd>Drag</kbd> orbit · <kbd>Wheel</kbd> zoom · <kbd>R</kbd> camera reset · <kbd>I</kbd> panel
        </div>
      `,
    });
    this._bind();
  }

  /** Handles the I / H panel toggle. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Pushes the current state into the controls; event-driven only, never per frame. */
  public sync(state: HudState): void {
    for (let i = 0; i < this._presetCount; i++) {
      this._drawer.query(`#st43Preset${i}`)?.classList.toggle("active", i === state.presetIndex);
    }
    this._setSliderValue("Roughness", state.roughness, 2, "");
    this._setSliderValue("Metallic", state.metallic, 2, "");
    const colorInput = this._drawer.query<HTMLInputElement>("#st43Color");
    if (colorInput) colorInput.value = state.colorHex;
    this._setSliderValue("Azimuth", state.azimuthDeg, 0, "°");
    this._setSliderValue("Elevation", state.elevationDeg, 0, "°");
    this._setSliderValue("KeyIntensity", state.keyIntensity, 2, "");
    this._setSliderValue("Ambient", state.ambient, 2, "");
    this._drawer.query("#st43BtnIbl")?.classList.toggle("active", state.iblEnabled);
    this._drawer.query("#st43BtnGrid")?.classList.toggle("active", state.gridVisible);
  }

  /** Removes panel, footer button and the panel's style. */
  public dispose(): void {
    this._drawer.dispose();
    this._style.remove();
  }

  private _setSliderValue(name: string, value: number, decimals: number, suffix: string): void {
    const slider = this._drawer.query<HTMLInputElement>(`#st43Sl${name}`);
    const label = this._drawer.query(`#st43Val${name}`);
    if (slider) slider.value = String(value);
    if (label) label.textContent = `${value.toFixed(decimals)}${suffix}`;
  }

  private _bind(): void {
    const a = this._actions;
    const d = this._drawer;
    for (let i = 0; i < this._presetCount; i++) {
      d.query(`#st43Preset${i}`)?.addEventListener("click", () => a.applyPreset(i));
    }
    d.query("#st43BtnIbl")?.addEventListener("click", () => a.toggleIbl());
    d.query("#st43BtnGrid")?.addEventListener("click", () => a.toggleGrid());
    d.query("#st43BtnReset")?.addEventListener("click", () => a.resetToReference());

    for (const name of SLIDERS) {
      const slider = d.query<HTMLInputElement>(`#st43Sl${name}`);
      if (!slider) continue;
      slider.addEventListener("input", (): void => a.setSlider(name, parseFloat(slider.value)));
      // Hand keyboard focus back to the shortcuts once the drag ends.
      slider.addEventListener("change", (): void => slider.blur());
    }

    const colorInput = d.query<HTMLInputElement>("#st43Color");
    colorInput?.addEventListener("input", (): void => a.setColor(colorInput.value));
    colorInput?.addEventListener("change", (): void => colorInput.blur());
  }
}
