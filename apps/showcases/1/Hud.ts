import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

/** One entry of the geometry dropdown. */
export interface GeometryOption {
  id: string;
  name: string;
  icon: string;
}

/** One colour swatch button. */
export interface ColorSwatch {
  name: string;
  hex: string;
}

/** Initial control values; the panel keeps its own labels in step afterwards. */
export interface HudState {
  geometryId: string;
  colorHex: string;
  shininess: number;
  autoRotate: boolean;
  rotateSpeed: number;
  wireframe: boolean;
  wireframeCastsShadow: boolean;
  shadowResolution: number;
  wireShadowWidth: number;
}

/** Showcase actions the panel triggers. */
export interface HudActions {
  setGeometry(id: string): void;
  setColor(hex: string): void;
  setShininess(value: number): void;
  setAutoRotate(on: boolean): void;
  setRotateSpeed(value: number): void;
  setWireframe(on: boolean): void;
  setWireframeCastsShadow(on: boolean): void;
  setShadowResolution(px: number): void;
  setWireShadowWidth(meters: number): void;
}

const formatWireShadowWidth = (meters: number): string =>
  meters > 0 ? `${(meters * 100).toFixed(1)} cm` : "1 texel";

/**
 * Shape & Material panel of showcase 1 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls and their labels; mesh, materials and light stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(
    geometries: readonly GeometryOption[],
    swatches: readonly ColorSwatch[],
    state: HudState,
    private readonly _actions: HudActions,
  ) {
    this._drawer = new ShowcaseDrawer({
      id: "showcase1-inspector",
      title: "Shape & Material",
      icon: "🔷",
      open: false,
      footerIcon: "⚙",
      buttonId: "showcase1InspectorBtn",
      body: `
        <!-- Section 1: Geometry -->
        <div class="hud-section">
          <div class="section-title">🔷 3D Geometry Primitive</div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <label for="selGeometry">Active Primitive</label>
            <select id="selGeometry" style="width:100%;font-size:12px;padding:6px 8px;">
              ${geometries
                .map(
                  (g) => `
                <option value="${g.id}" ${g.id === state.geometryId ? "selected" : ""}>
                  ${g.icon} ${g.name}
                </option>
              `,
                )
                .join("")}
            </select>
          </div>
        </div>

        <!-- Section 2: Material & Color -->
        <div class="hud-section">
          <div class="section-title">🎨 Color & Material Palette</div>

          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;margin-bottom:10px;">
            ${swatches
              .map(
                (s) => `
              <button
                class="btn-preset btn-swatch ${s.hex.toLowerCase() === state.colorHex.toLowerCase() ? "active" : ""}"
                data-hex="${s.hex}"
                style="display:flex;align-items:center;gap:5px;padding:5px 6px;justify-content:flex-start;"
                title="${s.name}"
              >
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${s.hex};border:1px solid rgba(255,255,255,0.4);flex-shrink:0;"></span>
                <span style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name.split(" ")[0]}</span>
              </button>
            `,
              )
              .join("")}
          </div>

          <div class="hud-row">
            <label for="pickerColor">Custom Color</label>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="val-label" id="valHex">${state.colorHex.toUpperCase()}</span>
              <input type="color" id="pickerColor" value="${state.colorHex}" style="width:34px;height:24px;border:none;border-radius:4px;cursor:pointer;background:transparent;" />
            </div>
          </div>

          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderShininess">Phong Specular Shininess</label>
              <span class="val-label" id="valShininess">${state.shininess}</span>
            </div>
            <input type="range" id="sliderShininess" min="10" max="150" step="5" value="${state.shininess}" />
          </div>
        </div>

        <!-- Section 3: Motion & Wireframe -->
        <div class="hud-section">
          <div class="section-title">🔄 Motion & Display Mode</div>
          <div class="hud-row">
            <label for="swAutoRotate">Auto-Rotate</label>
            <label class="hud-switch">
              <input type="checkbox" id="swAutoRotate" ${state.autoRotate ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderSpeed">Rotation Speed</label>
              <span class="val-label" id="valSpeed">${state.rotateSpeed.toFixed(1)}x</span>
            </div>
            <input type="range" id="sliderSpeed" min="0.2" max="3.0" step="0.1" value="${state.rotateSpeed}" />
          </div>
          <div class="hud-row" style="margin-top:4px;">
            <label for="swWireframe">Wireframe Mode</label>
            <label class="hud-switch">
              <input type="checkbox" id="swWireframe" ${state.wireframe ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row">
            <label for="swWireShadow">Wireframe casts shadow</label>
            <label class="hud-switch">
              <input type="checkbox" id="swWireShadow" ${state.wireframeCastsShadow ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderShadowRes">Shadow Map Resolution</label>
              <span class="val-label" id="valShadowRes">${state.shadowResolution} px</span>
            </div>
            <input type="range" id="sliderShadowRes" min="8" max="13" step="1" value="${Math.log2(state.shadowResolution)}" />
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderWireShadowWidth">Wire Shadow Width</label>
              <span class="val-label" id="valWireShadowWidth">${formatWireShadowWidth(state.wireShadowWidth)}</span>
            </div>
            <input type="range" id="sliderWireShadowWidth" min="0" max="0.1" step="0.005" value="${state.wireShadowWidth}" />
          </div>
        </div>
      `,
    });
    this._bind();
  }

  /** Handles the I / H panel toggle. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Removes panel and footer button. */
  public dispose(): void {
    this._drawer.dispose();
  }

  private _setLabel(id: string, text: string): void {
    const label = this._drawer.query(`#${id}`);
    if (label) label.textContent = text;
  }

  private _setColor(hex: string): void {
    const picker = this._drawer.query<HTMLInputElement>("#pickerColor");
    if (picker && picker.value.toLowerCase() !== hex.toLowerCase()) {
      picker.value = hex;
    }
    this._setLabel("valHex", hex.toUpperCase());
    this._drawer.root.querySelectorAll(".btn-swatch").forEach((btn) => {
      const bHex = btn.getAttribute("data-hex");
      btn.classList.toggle("active", bHex?.toLowerCase() === hex.toLowerCase());
    });
    this._actions.setColor(hex);
  }

  private _onInput(
    id: string,
    type: "input" | "change",
    handler: (el: HTMLInputElement) => void,
  ): void {
    const el = this._drawer.query<HTMLInputElement>(`#${id}`);
    el?.addEventListener(type, () => handler(el));
  }

  private _bind(): void {
    const a = this._actions;
    this._drawer.query<HTMLSelectElement>("#selGeometry")?.addEventListener("change", (e) => {
      a.setGeometry((e.target as HTMLSelectElement).value);
    });
    this._drawer.root.querySelectorAll<HTMLButtonElement>(".btn-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hex = btn.getAttribute("data-hex");
        if (hex) this._setColor(hex);
      });
    });
    this._onInput("pickerColor", "input", (el) => this._setColor(el.value));
    this._onInput("sliderShininess", "input", (el) => {
      const value = parseInt(el.value, 10);
      this._setLabel("valShininess", value.toString());
      a.setShininess(value);
    });
    this._onInput("swAutoRotate", "change", (el) => a.setAutoRotate(el.checked));
    this._onInput("sliderSpeed", "input", (el) => {
      const value = parseFloat(el.value);
      this._setLabel("valSpeed", `${value.toFixed(1)}x`);
      a.setRotateSpeed(value);
    });
    this._onInput("swWireframe", "change", (el) => a.setWireframe(el.checked));
    this._onInput("swWireShadow", "change", (el) => a.setWireframeCastsShadow(el.checked));
    this._onInput("sliderShadowRes", "input", (el) => {
      const px = 2 ** parseInt(el.value, 10);
      this._setLabel("valShadowRes", `${px} px`);
      a.setShadowResolution(px);
    });
    this._onInput("sliderWireShadowWidth", "input", (el) => {
      const meters = parseFloat(el.value);
      this._setLabel("valWireShadowWidth", formatWireShadowWidth(meters));
      a.setWireShadowWidth(meters);
    });
  }
}
