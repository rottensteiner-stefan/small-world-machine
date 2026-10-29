import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

export type ProbeMode = "box" | "pole" | "steps";
export type ViewPreset = "overview" | "contact" | "far";
export type ShadowLabSlider =
  | "LiftY"
  | "Softness"
  | "MaxRadius"
  | "SunElev"
  | "SunAzim"
  | "SunInt"
  | "AmbInt"
  | "Bias"
  | "NormalBias";

/** What the panel reflects; read from the showcase on every {@link ShadowLabHud.sync}. */
export interface ShadowLabState {
  probe: ProbeMode;
  pcss: boolean;
  liftY: number;
  softness: number;
  maxRadius: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  sunIntensity: number;
  ambientIntensity: number;
  shadowBias: number;
  shadowNormalBias: number;
}

/** Showcase actions the panel triggers. */
export interface ShadowLabActions {
  setProbe(probe: ProbeMode): void;
  setPcss(pcss: boolean): void;
  applyView(preset: ViewPreset): void;
  setSlider(name: ShadowLabSlider, value: number): void;
}

/** Label format per slider: decimals and unit suffix. */
const SLIDER_FORMAT: Record<ShadowLabSlider, readonly [number, string]> = {
  LiftY: [2, " m"],
  Softness: [2, ""],
  MaxRadius: [0, " px"],
  SunElev: [0, "°"],
  SunAzim: [0, "°"],
  SunInt: [2, ""],
  AmbInt: [2, ""],
  Bias: [4, ""],
  NormalBias: [3, ""],
};
const SLIDERS = Object.keys(SLIDER_FORMAT) as ShadowLabSlider[];

/**
 * Soft Shadow Lab panel of showcase 42 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; probes, lights and shadow settings stay in the showcase.
 */
export class ShadowLabHud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _readout: HTMLElement;
  private _hovering: boolean = false;

  constructor(
    rendererType: string,
    private readonly _actions: ShadowLabActions,
  ) {
    document.getElementById("shadowLabStyle")?.remove();
    const style = document.createElement("style");
    style.id = "shadowLabStyle";
    style.textContent = `
      #shadowLabReadout {
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
      id: "showcase-hud",
      title: "Soft Shadow Lab",
      icon: "🌒",
      badge: rendererType,
      open: false,
      body: `
        <div class="hud-section">
          <div class="section-title">
            <span>📐 Probe Geometry</span>
            <span style="font-size: 9px; color: #64748b;">Keys 1–3</span>
          </div>
          <div class="preset-group three-col" style="margin-bottom: 8px;">
            <button id="btnProbeBox" class="btn-preset" title="2.2m Cube: uniform edge feathering (Key 1)">1 · Box</button>
            <button id="btnProbePole" class="btn-preset" title="Thin Pole: sharp contact -> wide far penumbra (Key 2)">2 · Pole</button>
            <button id="btnProbeSteps" class="btn-preset" title="Multi-height bars + sphere: compare blocker distances (Key 3)">3 · Step Rig</button>
          </div>
          <div class="hud-row">
            <label for="slLiftY" title="Lift the caster off the floor to watch the contact shadow soften">Caster Lift Y</label>
            <input id="slLiftY" type="range" min="0" max="2.5" step="0.02" value="0" />
            <span id="valLiftY" class="val-label">0.00 m</span>
          </div>
          <div class="hud-note">
            💡 <b>Try lifting the caster:</b> Under PCSS, the sharp contact shadow immediately softens as distance to the floor grows.
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title">
            <span>🌗 Shadow Technique</span>
            <span style="font-size: 9px; color: #64748b;">ADR 0006 / 0043</span>
          </div>
          <div class="preset-group two-col" style="margin-bottom: 8px;">
            <button id="btnModePcss" class="btn-preset" title="Percentage-Closer Soft Shadows (Contact Hardening + 16-Tap Vogel Disk)">PCSS (Contact)</button>
            <button id="btnModeEvsm" class="btn-preset" title="Exponential Variance Shadow Maps (Warped Moment Filtering)">EVSM (Moments)</button>
          </div>
          <div id="pcssKernelRows">
            <div class="hud-row">
              <label for="slSoftness" title="Scales penumbra growth with blocker distance (quality.shadowSoftness)">Penumbra Softness</label>
              <input id="slSoftness" type="range" min="0" max="5" step="0.05" value="1" />
              <span id="valSoftness" class="val-label">1.00</span>
            </div>
            <div class="hud-row">
              <label for="slMaxRadius" title="Maximum PCF kernel radius in shadow-map texels (quality.shadowMaxPcfRadius)">Max PCF Radius</label>
              <input id="slMaxRadius" type="range" min="1" max="16" step="1" value="4" />
              <span id="valMaxRadius" class="val-label">4 px</span>
            </div>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title">
            <span>☀️ Sun & Shadow Bias</span>
          </div>
          <div class="hud-row">
            <label for="slSunElev" title="Sun elevation angle above the horizon">Sun Elevation</label>
            <input id="slSunElev" type="range" min="12" max="75" step="1" value="45" />
            <span id="valSunElev" class="val-label">45°</span>
          </div>
          <div class="hud-row">
            <label for="slSunAzim" title="Horizontal sun direction angle">Sun Azimuth</label>
            <input id="slSunAzim" type="range" min="-90" max="90" step="1" value="25" />
            <span id="valSunAzim" class="val-label">25°</span>
          </div>
          <div class="hud-row">
            <label for="slSunInt" title="Directional light intensity">Sun Intensity</label>
            <input id="slSunInt" type="range" min="0.5" max="8" step="0.1" value="2.6" />
            <span id="valSunInt" class="val-label">2.60</span>
          </div>
          <div class="hud-row">
            <label for="slAmbInt" title="Ambient fill light intensity (controls shadow darkness)">Ambient Fill</label>
            <input id="slAmbInt" type="range" min="0" max="0.5" step="0.01" value="0.12" />
            <span id="valAmbInt" class="val-label">0.12</span>
          </div>
          <div class="hud-row">
            <label for="slBias" title="Depth bias: too low = shadow acne, too high = peter-panning">Depth Bias</label>
            <input id="slBias" type="range" min="0" max="0.005" step="0.0001" value="0.0006" />
            <span id="valBias" class="val-label">0.0006</span>
          </div>
          <div class="hud-row">
            <label for="slNormalBias" title="Normal-offset bias along surface normal">Normal Bias</label>
            <input id="slNormalBias" type="range" min="0" max="0.08" step="0.002" value="0.02" />
            <span id="valNormalBias" class="val-label">0.020</span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title">
            <span>🎥 Camera & GPU Readout</span>
            <span style="font-size: 9px; color: #64748b;">Drag / Wheel / R</span>
          </div>
          <div class="preset-group three-col">
            <button id="btnViewOverview" class="btn-preset active" title="Standard calibrated stage view (Key R)">Overview</button>
            <button id="btnViewContact" class="btn-preset" title="Zoom into the contact line at the caster base">Contact Base</button>
            <button id="btnViewFar" class="btn-preset" title="Inspect the distant diffused penumbra zone">Far Penumbra</button>
          </div>
          <pre id="shadowLabReadout"></pre>
        </div>
      `,
    });
    this._drawer.toggleButton.id = "shadowLabInspectorBtn";
    this._readout = this._drawer.query<HTMLElement>("#shadowLabReadout")!;
    this._bind();
  }

  /** True while the pointer is over the open panel; the canvas orbit ignores input then. */
  public get isHovering(): boolean {
    return this._hovering && this._drawer.isOpen;
  }

  /** Handles the I / H panel toggle. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Writes the GPU readout text; skips the DOM write when nothing changed. */
  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  /** Highlights the active camera view preset. */
  public setView(preset: ViewPreset): void {
    this._drawer.query("#btnViewOverview")?.classList.toggle("active", preset === "overview");
    this._drawer.query("#btnViewContact")?.classList.toggle("active", preset === "contact");
    this._drawer.query("#btnViewFar")?.classList.toggle("active", preset === "far");
  }

  /** Reflects the current showcase state in every control. */
  public sync(state: ShadowLabState): void {
    const d = this._drawer;
    d.query("#btnProbeBox")?.classList.toggle("active", state.probe === "box");
    d.query("#btnProbePole")?.classList.toggle("active", state.probe === "pole");
    d.query("#btnProbeSteps")?.classList.toggle("active", state.probe === "steps");
    d.query("#btnModePcss")?.classList.toggle("active", state.pcss);
    d.query("#btnModeEvsm")?.classList.toggle("active", !state.pcss);

    const pcssControls = d.query("#pcssKernelRows");
    if (pcssControls) {
      pcssControls.style.opacity = state.pcss ? "1" : "0.45";
    }

    this._setSlider("LiftY", state.liftY);
    this._setSlider("Softness", state.softness);
    this._setSlider("MaxRadius", state.maxRadius);
    this._setSlider("SunElev", state.sunElevationDeg);
    this._setSlider("SunAzim", state.sunAzimuthDeg);
    this._setSlider("SunInt", state.sunIntensity);
    this._setSlider("AmbInt", state.ambientIntensity);
    this._setSlider("Bias", state.shadowBias);
    this._setSlider("NormalBias", state.shadowNormalBias);
  }

  private _setSlider(name: ShadowLabSlider, value: number): void {
    const slider = this._drawer.query<HTMLInputElement>(`#sl${name}`);
    if (slider) slider.value = String(value);
    this._setLabel(name, value);
  }

  private _setLabel(name: ShadowLabSlider, value: number): void {
    const label = this._drawer.query(`#val${name}`);
    const [decimals, suffix] = SLIDER_FORMAT[name];
    if (label) label.textContent = `${value.toFixed(decimals)}${suffix}`;
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

    d.query("#btnProbeBox")?.addEventListener("click", () => a.setProbe("box"));
    d.query("#btnProbePole")?.addEventListener("click", () => a.setProbe("pole"));
    d.query("#btnProbeSteps")?.addEventListener("click", () => a.setProbe("steps"));
    d.query("#btnModePcss")?.addEventListener("click", () => a.setPcss(true));
    d.query("#btnModeEvsm")?.addEventListener("click", () => a.setPcss(false));
    d.query("#btnViewOverview")?.addEventListener("click", () => a.applyView("overview"));
    d.query("#btnViewContact")?.addEventListener("click", () => a.applyView("contact"));
    d.query("#btnViewFar")?.addEventListener("click", () => a.applyView("far"));

    for (const name of SLIDERS) {
      const slider = d.query<HTMLInputElement>(`#sl${name}`);
      if (!slider) continue;
      slider.addEventListener("input", () => {
        const value = parseFloat(slider.value);
        this._setLabel(name, value);
        a.setSlider(name, value);
      });
    }
  }
}
