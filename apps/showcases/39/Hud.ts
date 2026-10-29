import { ShowcaseDrawer, hudSwitch } from "../shared/ShowcaseDrawer.js";

/** Scene state the panel mirrors. */
export interface SanctumHudState {
  fog: boolean;
  carver: boolean;
  noise: boolean;
  leyline: boolean;
  density: number;
  godRayStrength: number;
  asymmetry: number;
  sunMode: 1 | 2;
  flyMode: boolean;
  activePresetIdx: number;
}

/** Scene actions the panel triggers; the showcase applies them and calls {@link SanctumHud.sync}. */
export interface SanctumHudCallbacks {
  onFog(enabled: boolean): void;
  onCarver(enabled: boolean): void;
  onNoise(enabled: boolean): void;
  onLeyline(enabled: boolean): void;
  onDensity(value: number): void;
  onGodRayStrength(value: number): void;
  onAsymmetry(value: number): void;
  onSunMode(mode: 1 | 2): void;
  onCameraMode(flyMode: boolean): void;
  onCameraPreset(index: number): void;
}

const PRESET_LABELS = ["Nave", "Altar", "Portal", "Carved Room"];

function sliderRow(id: string, valueId: string, label: string, range: string, top: number): string {
  return `
    <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:4px;margin-top:${top}px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;">
        <label for="${id}">${label}</label>
        <span id="${valueId}"></span>
      </div>
      <input type="range" id="${id}" ${range}>
    </div>`;
}

/**
 * Atmospheric Sanctum panel of showcase 39 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; fog, sun and camera state stay in the showcase.
 */
export class SanctumHud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(badge: string, callbacks: SanctumHudCallbacks) {
    const presets = PRESET_LABELS.map(
      (label, i) => `<button class="btn-preset" data-cam="${i}">${label}</button>`,
    ).join("");
    this._drawer = new ShowcaseDrawer({
      // GoldenCapture hides the panel by this id.
      id: "showcase-hud",
      title: "Atmospheric Sanctum",
      icon: "🌫️",
      badge,
      open: false,
      body: `
        <div class="hud-section">
          <div class="section-title">🌫️ Volumetric Fog & Mist</div>
          ${hudSwitch("swFog", "Volumetric Fog")}
          ${hudSwitch("swCarver", "Interior Carving")}
          ${hudSwitch("swNoise", "3D Rolling Mist")}
          ${hudSwitch("swLeyline", "✨ Mystic Leyline [L]")}
          ${sliderRow("rngDensity", "valDensity", "Fog Density", 'min="0.005" max="0.060" step="0.001"', 6)}
          ${sliderRow("rngShafts", "valShafts", "God Ray Strength", 'min="0.0" max="8.0" step="0.1"', 4)}
          ${sliderRow("rngAsymmetry", "valAsymmetry", "Mie Asymmetry (g)", 'min="0.0" max="0.85" step="0.01"', 4)}
        </div>

        <div class="hud-section">
          <div class="section-title">☀️ Sun & Navigation</div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <label>Sun Alignment</label>
            <div class="preset-group">
              <button class="btn-preset" id="btnSunNoon">High Noon</button>
              <button class="btn-preset" id="btnSunGolden">Golden Hour</button>
            </div>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
            <label>Camera Mode [V]</label>
            <div class="preset-group">
              <button class="btn-preset" id="btnCamFly">Free-Fly (WASD)</button>
              <button class="btn-preset" id="btnCamOrbit">Orbit Mode</button>
            </div>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
            <label>Camera Viewpoints</label>
            <div class="preset-group">${presets}</div>
          </div>
        </div>

        <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; padding: 2px 4px;">
          Use <strong>WASD / Arrows</strong> + <strong>Drag</strong> (or <strong>Scroll</strong>) to fly into the carved chamber (Z = -21), or pick a viewpoint above.
        </div>
      `,
    });

    this._onSwitch("#swFog", callbacks.onFog);
    this._onSwitch("#swCarver", callbacks.onCarver);
    this._onSwitch("#swNoise", callbacks.onNoise);
    this._onSwitch("#swLeyline", callbacks.onLeyline);
    this._onSlider("#rngDensity", callbacks.onDensity);
    this._onSlider("#rngShafts", callbacks.onGodRayStrength);
    this._onSlider("#rngAsymmetry", callbacks.onAsymmetry);
    this._onClick("#btnSunNoon", () => callbacks.onSunMode(1));
    this._onClick("#btnSunGolden", () => callbacks.onSunMode(2));
    this._onClick("#btnCamFly", () => callbacks.onCameraMode(true));
    this._onClick("#btnCamOrbit", () => callbacks.onCameraMode(false));
    this._drawer.root.querySelectorAll<HTMLButtonElement>("button[data-cam]").forEach((btn) => {
      btn.addEventListener("click", () =>
        callbacks.onCameraPreset(parseInt(btn.dataset["cam"] ?? "0", 10)),
      );
    });
  }

  /** The drawer element; the showcase tracks hover/drag on it to pause camera controllers. */
  public get root(): HTMLElement {
    return this._drawer.root;
  }

  /** Reflects the scene state in every control. */
  public sync(state: SanctumHudState): void {
    this._setChecked("#swFog", state.fog);
    this._setChecked("#swCarver", state.carver);
    this._setChecked("#swNoise", state.noise);
    this._setChecked("#swLeyline", state.leyline);
    this._setSlider("#rngDensity", "#valDensity", state.density, state.density.toFixed(3));
    this._setSlider(
      "#rngShafts",
      "#valShafts",
      state.godRayStrength,
      state.godRayStrength.toFixed(1),
    );
    this._setSlider("#rngAsymmetry", "#valAsymmetry", state.asymmetry, state.asymmetry.toFixed(2));
    this._setActive("#btnSunNoon", state.sunMode === 1);
    this._setActive("#btnSunGolden", state.sunMode === 2);
    this._setActive("#btnCamFly", state.flyMode);
    this._setActive("#btnCamOrbit", !state.flyMode);
    this._drawer.root.querySelectorAll<HTMLButtonElement>("button[data-cam]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset["cam"]) === state.activePresetIdx);
    });
  }

  /** Handles the I / H panel shortcut. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public dispose(): void {
    this._drawer.dispose();
  }

  private _onSwitch(selector: string, callback: (checked: boolean) => void): void {
    const input = this._drawer.query<HTMLInputElement>(selector);
    input?.addEventListener("change", () => callback(input.checked));
  }

  private _onSlider(selector: string, callback: (value: number) => void): void {
    const input = this._drawer.query<HTMLInputElement>(selector);
    input?.addEventListener("input", () => callback(parseFloat(input.value)));
  }

  private _onClick(selector: string, callback: () => void): void {
    this._drawer.query<HTMLButtonElement>(selector)?.addEventListener("click", callback);
  }

  private _setChecked(selector: string, checked: boolean): void {
    const input = this._drawer.query<HTMLInputElement>(selector);
    if (input) input.checked = checked;
  }

  private _setSlider(selector: string, labelSelector: string, value: number, text: string): void {
    const input = this._drawer.query<HTMLInputElement>(selector);
    const label = this._drawer.query<HTMLElement>(labelSelector);
    if (input) input.value = String(value);
    if (label) label.textContent = text;
  }

  private _setActive(selector: string, active: boolean): void {
    this._drawer.query<HTMLButtonElement>(selector)?.classList.toggle("active", active);
  }
}
