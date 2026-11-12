import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

/** Occlusion culling parameters driven by a single slider. */
export type HzbParam =
  | "ambientIntensity"
  | "sunIntensity"
  | "shadowResolution"
  | "wallWidth"
  | "wallRoughness"
  | "wallMetallic"
  | "groundRoughness"
  | "fieldRoughness"
  | "fieldMetallic";

/** What the panel asks of the showcase; lights and materials stay there. */
export interface HudActions {
  setParam(param: HzbParam, value: number): void;
}

const SLIDER_IDS: Record<HzbParam, readonly [string, string]> = {
  ambientIntensity: ["slAmbientIntensity", "valAmbientIntensity"],
  sunIntensity: ["slSunIntensity", "valSunIntensity"],
  shadowResolution: ["slShadowResolution", "valShadowResolution"],
  wallWidth: ["slWallWidth", "valWallWidth"],
  wallRoughness: ["slWallRoughness", "valWallRoughness"],
  wallMetallic: ["slWallMetallic", "valWallMetallic"],
  groundRoughness: ["slGroundRoughness", "valGroundRoughness"],
  fieldRoughness: ["slFieldRoughness", "valFieldRoughness"],
  fieldMetallic: ["slFieldMetallic", "valFieldMetallic"],
};

// Showcase-specific styles overriding shared.css defaults.
const STYLE = `
  #hzbTuningHud .hud-body { gap: 12px; }
  #hzbTuningHud .hud-row { margin-bottom: 6px; }
  #hzbTuningHud .hud-row:last-child { margin-bottom: 0; }
  .swm-inspector-btn:hover,
  .swm-inspector-btn.active {
    border-color: var(--tool-accent, #f59e0b);
    color: var(--tool-accent, #f59e0b);
  }
`;

const BODY = `
  <!-- Lighting -->
  <div class="hud-section">
    <div class="section-title">☀️ Lighting</div>
    <div class="hud-row">
      <label>Ambient Intensity</label>
      <input type="range" id="slAmbientIntensity" min="0" max="2" step="0.05" value="0.55" />
      <span class="val-label" id="valAmbientIntensity">0.55</span>
    </div>
    <div class="hud-row">
      <label>Sun Intensity</label>
      <input type="range" id="slSunIntensity" min="0" max="5" step="0.1" value="1.4" />
      <span class="val-label" id="valSunIntensity">1.4</span>
    </div>
    <div class="hud-row">
      <label>Shadow Resolution</label>
      <input type="range" id="slShadowResolution" min="512" max="4096" step="256" value="2048" />
      <span class="val-label" id="valShadowResolution">2048</span>
    </div>
  </div>

  <!-- Occluder Wall -->
  <div class="hud-section">
    <div class="section-title">🧱 Occluder Wall</div>
    <div class="hud-row">
      <label>Wall Width</label>
      <input type="range" id="slWallWidth" min="2" max="20" step="0.5" value="10" />
      <span class="val-label" id="valWallWidth">10</span>
    </div>
    <div class="hud-row">
      <label>Wall Roughness</label>
      <input type="range" id="slWallRoughness" min="0" max="1" step="0.05" value="0.7" />
      <span class="val-label" id="valWallRoughness">0.70</span>
    </div>
    <div class="hud-row">
      <label>Wall Metallic</label>
      <input type="range" id="slWallMetallic" min="0" max="1" step="0.05" value="0.1" />
      <span class="val-label" id="valWallMetallic">0.10</span>
    </div>
  </div>

  <!-- Ground -->
  <div class="hud-section">
    <div class="section-title">🌍 Ground</div>
    <div class="hud-row">
      <label>Ground Roughness</label>
      <input type="range" id="slGroundRoughness" min="0" max="1" step="0.05" value="0.9" />
      <span class="val-label" id="valGroundRoughness">0.90</span>
    </div>
  </div>

  <!-- Hidden Field -->
  <div class="hud-section">
    <div class="section-title">🎲 Hidden Field (96 objects)</div>
    <div class="hud-row">
      <label>Field Roughness</label>
      <input type="range" id="slFieldRoughness" min="0" max="1" step="0.05" value="0.5" />
      <span class="val-label" id="valFieldRoughness">0.50</span>
    </div>
    <div class="hud-row">
      <label>Field Metallic</label>
      <input type="range" id="slFieldMetallic" min="0" max="1" step="0.05" value="0.2" />
      <span class="val-label" id="valFieldMetallic">0.20</span>
    </div>
    <div class="hud-note">
      Orbit around the wall edge to watch objects pop in as they become visible.
      Console shows frustum-visible vs occlusion-culled counts.
    </div>
  </div>
`;

const formatValue = (value: number): string =>
  Number.isInteger(value) ? value.toString() : value.toFixed(2);

/**
 * "Hidden City" HZB Occlusion Culling panel on the shared {@link ShowcaseDrawer}.
 * Owns the controls and their sync; every change goes to the {@link HudActions}.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;

  constructor(
    private readonly _host: HudActions,
    engine?: { lastCpuTimeMs?: number },
  ) {
    document.getElementById("hzbTuningHudStyle")?.remove();
    const style = document.createElement("style");
    this._style = style;
    style.id = "hzbTuningHudStyle";
    style.textContent = STYLE;
    document.head.appendChild(style);

    this._drawer = new ShowcaseDrawer({
      id: "hzbTuningHud",
      title: "Hidden City: HZB Occlusion Culling",
      icon: "🏙️",
      body: BODY,
      open: false,
      footerIcon: "⚙",
      toggleKeys: ["KeyI"],
      shieldKeys: true,
      engine: engine,
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

  /** Removes the drawer, its footer button and the injected style tag (showcase teardown). */
  public dispose(): void {
    this._style.remove();
    this._drawer.dispose();
  }

  public getValue(param: HzbParam): number {
    const slider = this._drawer.query<HTMLInputElement>(`#${SLIDER_IDS[param][0]}`);
    return slider ? parseFloat(slider.value) : 0;
  }

  public setValue(param: HzbParam, value: number): void {
    const [sliderId, labelId] = SLIDER_IDS[param];
    this._setSlider(sliderId, labelId, value);
  }

  private _bind(): void {
    const host = this._host;
    for (const param of Object.keys(SLIDER_IDS) as HzbParam[]) {
      const [sliderId, labelId] = SLIDER_IDS[param];
      const slider = this._drawer.query<HTMLInputElement>(`#${sliderId}`);
      const label = this._drawer.query(`#${labelId}`);
      slider?.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        if (label) label.textContent = formatValue(val);
        host.setParam(param, val);
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
