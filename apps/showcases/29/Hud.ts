import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

/** Lighting parameters driven by a single slider. */
export type SponzaParam =
  "sunIntensity" | "ambient" | "hbao" | "bounce" | "exposure" | "bloom" | "vignette";
export type SponzaToggle = "hbao" | "gi" | "godRays";
export type SponzaPreset = "crytek" | "noon" | "overcast";

/** What the panel asks of the showcase; lights and post effects stay there. */
export interface HudActions {
  setParam(param: SponzaParam, value: number): void;
  setSunDirection(x: number, y: number, z: number): void;
  setToggle(toggle: SponzaToggle, enabled: boolean): void;
  applyPreset(preset: SponzaPreset): void;
  /** Called after the panel was closed (fly controller and hover state need a reset). */
  onPanelClosed(): void;
}

const SLIDER_IDS: Record<SponzaParam, readonly [string, string]> = {
  sunIntensity: ["slSunIntensity", "valSunIntensity"],
  ambient: ["slAmbient", "valAmbient"],
  hbao: ["slHbao", "valHbao"],
  bounce: ["slBounce", "valBounce"],
  exposure: ["slExposure", "valExposure"],
  bloom: ["slBloom", "valBloom"],
  vignette: ["slVignette", "valVignette"],
};
const SUN_AXES = [
  ["slSunX", "valSunX"],
  ["slSunY", "valSunY"],
  ["slSunZ", "valSunZ"],
] as const;
const TOGGLE_IDS: Record<SponzaToggle, string> = {
  hbao: "chkHbao",
  gi: "chkGI",
  godRays: "chkGodRays",
};
const PRESET_IDS: Record<SponzaPreset, string> = {
  crytek: "btnPresetCrytek",
  noon: "btnPresetNoon",
  overcast: "btnPresetOvercast",
};

// Only what differs from shared.css: denser rows and buttons, plain checkboxes and the
// tool-theme accent on the footer button.
const STYLE = `
  #sponzaTuningHud .hud-body { gap: 12px; }
  #sponzaTuningHud .hud-row { margin-bottom: 6px; }
  #sponzaTuningHud .hud-row:last-child { margin-bottom: 0; }
  #sponzaTuningHud input[type="checkbox"] {
    accent-color: #b000ff;
    cursor: pointer;
    width: 15px;
    height: 15px;
  }
  #sponzaTuningHud .btn-preset { padding: 6px 4px; }
  .swm-inspector-btn:hover,
  .swm-inspector-btn.active {
    border-color: var(--tool-accent, #b000ff);
    color: var(--tool-accent, #b000ff);
  }
`;

const BODY = `
  <!-- Preset Row -->
  <div class="hud-section">
    <div class="section-title">⚡ Instant Presets</div>
    <div class="preset-group three-col">
      <button class="btn-preset active" id="btnPresetCrytek">🏛️ Crytek</button>
      <button class="btn-preset" id="btnPresetNoon">☀️ High Noon</button>
      <button class="btn-preset" id="btnPresetOvercast">☁️ Overcast</button>
    </div>
  </div>

  <!-- Sunlight (Chiaroscuro) -->
  <div class="hud-section">
    <div class="section-title">☀️ Sunlight & Angle</div>
    <div class="hud-row">
      <label>Sun Intensity</label>
      <input type="range" id="slSunIntensity" min="0" max="10" step="0.1" value="5.5" />
      <span class="val-label" id="valSunIntensity">5.5</span>
    </div>
    <div class="hud-row">
      <label>Sun Angle X</label>
      <input type="range" id="slSunX" min="-1" max="1" step="0.02" value="-0.45" />
      <span class="val-label" id="valSunX">-0.45</span>
    </div>
    <div class="hud-row">
      <label>Sun Altitude Y</label>
      <input type="range" id="slSunY" min="-1" max="-0.2" step="0.02" value="-0.75" />
      <span class="val-label" id="valSunY">-0.75</span>
    </div>
    <div class="hud-row">
      <label>Sun Angle Z</label>
      <input type="range" id="slSunZ" min="-1" max="1" step="0.02" value="-0.45" />
      <span class="val-label" id="valSunZ">-0.45</span>
    </div>
  </div>

  <!-- Ambient & Shadow Walkway Depth -->
  <div class="hud-section">
    <div class="section-title">🌑 Ambient Fill & Shadows</div>
    <div class="hud-row">
      <label>Walkway Ambient</label>
      <input type="range" id="slAmbient" min="0.0" max="0.5" step="0.01" value="0.08" />
      <span class="val-label" id="valAmbient">0.08</span>
    </div>
    <div class="hud-row">
      <label>HBAO Occlusion</label>
      <input type="range" id="slHbao" min="0.0" max="3.0" step="0.05" value="1.50" />
      <span class="val-label" id="valHbao">1.50</span>
    </div>
    <div class="hud-row">
      <label>Enable HBAO [H]</label>
      <input type="checkbox" id="chkHbao" checked />
    </div>
  </div>

  <!-- Arch Soffit GI Bounce -->
  <div class="hud-section">
    <div class="section-title">✨ Arch Soffit Bounce (GI)</div>
    <div class="hud-row">
      <label>Bounce Intensity</label>
      <input type="range" id="slBounce" min="0" max="60" step="1" value="32" />
      <span class="val-label" id="valBounce">32</span>
    </div>
    <div class="hud-row">
      <label>Enable GI [G]</label>
      <input type="checkbox" id="chkGI" checked />
    </div>
  </div>

  <!-- Post-Processing -->
  <div class="hud-section">
    <div class="section-title">🎬 ACES Post-Processing</div>
    <div class="hud-row">
      <label>Exposure</label>
      <input type="range" id="slExposure" min="0.3" max="2.5" step="0.05" value="1.05" />
      <span class="val-label" id="valExposure">1.05</span>
    </div>
    <div class="hud-row">
      <label>Bloom Flare [B]</label>
      <input type="range" id="slBloom" min="0.0" max="1.5" step="0.05" value="0.40" />
      <span class="val-label" id="valBloom">0.40</span>
    </div>
    <div class="hud-row">
      <label>Vignette Framing</label>
      <input type="range" id="slVignette" min="0.0" max="0.8" step="0.02" value="0.35" />
      <span class="val-label" id="valVignette">0.35</span>
    </div>
    <div class="hud-row">
      <label>God Rays [V]</label>
      <input type="checkbox" id="chkGodRays" />
    </div>
  </div>
`;

const formatValue = (value: number): string =>
  Number.isInteger(value) ? value.toString() : value.toFixed(2);

/**
 * Sponza Lighting Lab panel of showcase 29 on the shared {@link ShowcaseDrawer}. Owns the controls
 * and their sync; every change goes to the {@link HudActions}.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(private readonly _host: HudActions) {
    document.getElementById("sponzaTuningHudStyle")?.remove();
    const style = document.createElement("style");
    style.id = "sponzaTuningHudStyle";
    style.textContent = STYLE;
    document.head.appendChild(style);

    this._drawer = new ShowcaseDrawer({
      id: "sponzaTuningHud",
      title: "Sponza Lighting Lab",
      icon: "🏛️",
      body: BODY,
      open: false,
      footerIcon: "⚙",
      // H toggles HBAO in this showcase, so only I opens the panel.
      toggleKeys: ["KeyI"],
      // Focused panel controls keep their keys away from the fly camera and the shortcuts.
      shieldKeys: true,
      onToggle: (open: boolean): void => {
        if (!open) this._host.onPanelClosed();
      },
    });
    this._bind();
  }

  /** The drawer element (hover/drag tracking in the showcase). */
  public get root(): HTMLElement {
    return this._drawer.root;
  }

  public get isOpen(): boolean {
    return this._drawer.isOpen;
  }

  /** Handles the I panel shortcut. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public getValue(param: SponzaParam): number {
    const slider = this._drawer.query<HTMLInputElement>(`#${SLIDER_IDS[param][0]}`);
    return slider ? parseFloat(slider.value) : 0;
  }

  public setValue(param: SponzaParam, value: number): void {
    const [sliderId, labelId] = SLIDER_IDS[param];
    this._setSlider(sliderId, labelId, value);
  }

  public setSunDirection(x: number, y: number, z: number): void {
    const values = [x, y, z];
    SUN_AXES.forEach(([sliderId, labelId], i) => this._setSlider(sliderId, labelId, values[i]!));
  }

  public setChecked(toggle: SponzaToggle, checked: boolean): void {
    const input = this._drawer.query<HTMLInputElement>(`#${TOGGLE_IDS[toggle]}`);
    if (input) input.checked = checked;
  }

  private _bind(): void {
    const host = this._host;
    for (const param of Object.keys(SLIDER_IDS) as SponzaParam[]) {
      const [sliderId, labelId] = SLIDER_IDS[param];
      const slider = this._drawer.query<HTMLInputElement>(`#${sliderId}`);
      const label = this._drawer.query(`#${labelId}`);
      slider?.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        if (label) label.textContent = formatValue(val);
        host.setParam(param, val);
      });
    }

    const updateSunDir = (): void => {
      const values = SUN_AXES.map(([sliderId, labelId]) => {
        const value = parseFloat(this._drawer.query<HTMLInputElement>(`#${sliderId}`)!.value);
        this._drawer.query(`#${labelId}`)!.textContent = value.toFixed(2);
        return value;
      });
      host.setSunDirection(values[0]!, values[1]!, values[2]!);
    };
    for (const [sliderId] of SUN_AXES) {
      this._drawer.query(`#${sliderId}`)?.addEventListener("input", updateSunDir);
    }

    for (const toggle of Object.keys(TOGGLE_IDS) as SponzaToggle[]) {
      const input = this._drawer.query<HTMLInputElement>(`#${TOGGLE_IDS[toggle]}`);
      input?.addEventListener("change", () => host.setToggle(toggle, input.checked));
    }

    for (const preset of Object.keys(PRESET_IDS) as SponzaPreset[]) {
      this._drawer.query(`#${PRESET_IDS[preset]}`)?.addEventListener("click", () => {
        host.applyPreset(preset);
        this.root.querySelectorAll(".btn-preset").forEach((b) => b.classList.remove("active"));
        this._drawer.query(`#${PRESET_IDS[preset]}`)?.classList.add("active");
      });
    }
  }

  private _setSlider(sliderId: string, labelId: string, value: number): void {
    const slider = this._drawer.query<HTMLInputElement>(`#${sliderId}`);
    const label = this._drawer.query(`#${labelId}`);
    if (slider) slider.value = value.toString();
    if (label) label.textContent = formatValue(value);
  }
}
