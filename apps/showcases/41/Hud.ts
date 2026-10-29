import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

export type ReliefDisplayMode = "fullscreen" | "diorama" | "studio";

/** Material and brush parameters driven by the panel sliders. */
export type ReliefParam =
  | "sobel"
  | "relief"
  | "scratches"
  | "bevel"
  | "rust"
  | "desat"
  | "hue"
  | "rain"
  | "brushSize"
  | "brushRelief"
  | "brushSmear"
  | "brushMetallic";

/** What the panel asks of the showcase; scene state and logic stay there. */
export interface MetalReliefHudHost {
  setMode(mode: ReliefDisplayMode): void;
  setSplitPosition(value: number): void;
  setActivePreset(presetId: string): void;
  loadImageFile(file: File): void;
  setParam(param: ReliefParam, value: number): void;
  undoStudio(): void;
  clearStudio(): void;
  /** Flips the eraser and returns the new state. */
  toggleEraser(): boolean;
  /** Flips the studio base and returns true when the photo is the base. */
  toggleStudioBase(): boolean;
  pickSwatch(index: number): void;
  /** Called after the panel was closed (orbit and hover state need a reset). */
  onPanelClosed(): void;
}

const SLIDERS: ReadonlyArray<readonly [ReliefParam, string, string]> = [
  ["sobel", "slSobel", "valSobel"],
  ["relief", "slRelief", "valRelief"],
  ["scratches", "slScratches", "valScratches"],
  ["bevel", "slBevel", "valBevel"],
  ["rust", "slRust", "valRust"],
  ["desat", "slDesat", "valDesat"],
  ["hue", "slHue", "valHue"],
  ["rain", "slRain", "valRain"],
  ["brushSize", "slBrushSize", "valBrushSize"],
  ["brushRelief", "slBrushRelief", "valBrushRelief"],
  ["brushSmear", "slBrushSmear", "valBrushSmear"],
  ["brushMetallic", "slBrushMetallic", "valBrushMetallic"],
];

const PRESET_BUTTONS: Record<string, string> = {
  paris: "btnPresetParis",
  alps: "btnPresetAlps",
  harbor: "btnPresetHarbor",
};

// Only what differs from shared.css: denser rows and buttons, the tool-theme accent on the footer
// button, and the photo drop zone.
const STYLE = `
  #reliefTuningHud .hud-body { gap: 12px; }
  #reliefTuningHud .hud-row { margin-bottom: 6px; }
  #reliefTuningHud .hud-row:last-child { margin-bottom: 0; }
  #reliefTuningHud select { border: 1px solid #4a5568; padding: 3px 6px; }
  #reliefTuningHud .btn-preset { padding: 6px 4px; }
  #reliefPanelOpenBtn:hover {
    border-color: var(--tool-accent, #b000ff);
    color: var(--tool-accent, #b000ff);
  }
  #reliefPanelOpenBtn.active {
    border-color: var(--tool-accent, #b000ff);
    color: var(--tool-accent, #b000ff);
  }
  .hud-dropzone {
    border: 1px dashed rgba(148, 163, 184, 0.35);
    border-radius: 6px;
    padding: 8px 10px;
    text-align: center;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.03);
    transition: all 0.2s ease;
  }
  .hud-dropzone:hover, .hud-dropzone.dragover {
    border-color: #b000ff;
    background: rgba(176, 0, 255, 0.12);
    color: #fff;
  }
`;

const BODY = `
  <!-- Display Mode -->
  <div class="hud-section">
    <div class="section-title">🖼️ Mode & Technique</div>
    <div class="hud-row">
      <label for="selMode">Display Mode</label>
      <select id="selMode">
        <option value="fullscreen" selected>Photo-to-Metal Converter (Split)</option>
        <option value="diorama">2.5D Diorama (3D Layered)</option>
        <option value="studio">🎨 Palette Knife Studio (Paint)</option>
      </select>
    </div>
  </div>

  <!-- Before / After Wipe -->
  <div class="hud-section">
    <div class="section-title">↔️ Before / After Split Wipe</div>
    <div class="hud-row">
      <label>Divider Position</label>
      <input type="range" id="slSplit" min="0" max="1" step="0.01" value="0.50" />
      <span class="val-label" id="valSplit">0.50</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px;">
      <button class="btn-preset active" id="btnSplitHalf">50% Split</button>
      <button class="btn-preset" id="btnSplitPhoto">Photo Only</button>
      <button class="btn-preset" id="btnSplitMetal">Metal Only</button>
    </div>
  </div>

  <!-- Presets & Upload -->
  <div class="hud-section">
    <div class="section-title">⚡ Realistic Photo Presets</div>
    <div class="preset-group three-col">
      <button class="btn-preset active" id="btnPresetParis">🗼 Paris</button>
      <button class="btn-preset" id="btnPresetAlps">🚡 Alps</button>
      <button class="btn-preset" id="btnPresetHarbor">⛵ Harbor</button>
    </div>
    <div id="dropZoneHud" class="hud-dropzone" style="margin-top:8px;">
      <span>📁 Drop any photo or <u style="color:#b000ff;">browse</u></span>
      <input type="file" id="filePickerInput" accept="image/*" style="display:none;" />
    </div>
  </div>

  <!-- Palette Knife & Relief Depth -->
  <div class="hud-section">
    <div class="section-title">🔪 Impasto & Relief Depth</div>
    <div class="hud-row">
      <label>Sobel Relief</label>
      <input type="range" id="slSobel" min="0" max="3" step="0.05" value="1.50" />
      <span class="val-label" id="valSobel">1.50</span>
    </div>
    <div class="hud-row">
      <label>Palette Knife</label>
      <input type="range" id="slRelief" min="0" max="2" step="0.05" value="0.50" />
      <span class="val-label" id="valRelief">0.50</span>
    </div>
    <div class="hud-row">
      <label>Grind Marks (Flex)</label>
      <input type="range" id="slScratches" min="0" max="1" step="0.05" value="0.40" />
      <span class="val-label" id="valScratches">0.40</span>
    </div>
    <div class="hud-row">
      <label>Welded Edge Glint</label>
      <input type="range" id="slBevel" min="0" max="2.5" step="0.05" value="1.20" />
      <span class="val-label" id="valBevel">1.20</span>
    </div>
  </div>

  <!-- Industrial Patina -->
  <div class="hud-section">
    <div class="section-title">⚙️ Industrial Patina & Pop</div>
    <div class="hud-row">
      <label>Iron Oxide Rust</label>
      <input type="range" id="slRust" min="0" max="1" step="0.05" value="0.80" />
      <span class="val-label" id="valRust">0.80</span>
    </div>
    <div class="hud-row">
      <label>Desaturation</label>
      <input type="range" id="slDesat" min="0" max="1" step="0.05" value="0.95" />
      <span class="val-label" id="valDesat">0.95</span>
    </div>
    <div class="hud-row">
      <label>Accent Hue Pop</label>
      <input type="range" id="slHue" min="0" max="1" step="0.01" value="0.00" />
      <span class="val-label" id="valHue">0.00</span>
    </div>
    <div class="hud-row">
      <label>Wet Rain Sheen</label>
      <input type="range" id="slRain" min="0" max="1" step="0.05" value="0.50" />
      <span class="val-label" id="valRain">0.50</span>
    </div>
  </div>

  <!-- Palette Knife Studio -->
  <div class="hud-section" id="studioSection" style="display:none;">
    <div class="section-title">🎨 Palette Knife Studio</div>
    <div class="hud-row">
      <label>Brush Size</label>
      <input type="range" id="slBrushSize" min="3" max="120" step="1" value="12" />
      <span class="val-label" id="valBrushSize">12</span>
    </div>
    <div class="hud-row">
      <label>Impasto Height</label>
      <input type="range" id="slBrushRelief" min="0" max="2" step="0.05" value="1.00" />
      <span class="val-label" id="valBrushRelief">1.00</span>
    </div>
    <div class="hud-row">
      <label>Knife Smear</label>
      <input type="range" id="slBrushSmear" min="0" max="1" step="0.02" value="0.28" />
      <span class="val-label" id="valBrushSmear">0.28</span>
    </div>
    <div class="hud-row">
      <label>Metallic</label>
      <input type="range" id="slBrushMetallic" min="0" max="1" step="0.05" value="0.55" />
      <span class="val-label" id="valBrushMetallic">0.55</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:6px;">
      <button class="btn-preset active" id="swatch1" style="background:#c0392b;" title="Oxide Red (1)"></button>
      <button class="btn-preset" id="swatch2" style="background:#d4af37;" title="Gold Leaf (2)"></button>
      <button class="btn-preset" id="swatch3" style="background:#b000ff;" title="Engine Violet (3)"></button>
      <button class="btn-preset" id="swatch4" style="background:#38bdf8;" title="Steel Blue (4)"></button>
      <button class="btn-preset" id="swatch5" style="background:#f1e9d8;" title="Bone White (5)"></button>
      <button class="btn-preset" id="swatch6" style="background:#1e2b26;" title="Charcoal Bronze (6)"></button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:6px;">
      <button class="btn-preset" id="btnErase">✕ Erase (X)</button>
      <button class="btn-preset" id="btnUndo">↩ Undo (Z)</button>
      <button class="btn-preset" id="btnClear">🗑 Clear (C)</button>
      <button class="btn-preset" id="btnBaseToggle">🖼 Base</button>
    </div>
    <div class="hud-row" style="margin-top:8px;">
      <span style="font-size:11px;color:#94a3b8;">Keys: [ ] size · 1-6 palette · Q base (steel/photo) · P leave studio</span>
    </div>
  </div>
`;

/**
 * Metal Relief Lab panel of showcase 41 on the shared {@link ShowcaseDrawer}. Owns the controls
 * and their sync; every change goes to the {@link MetalReliefHudHost}.
 */
export class MetalReliefHud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(private readonly _host: MetalReliefHudHost) {
    document.getElementById("reliefTuningHudStyle")?.remove();
    const style = document.createElement("style");
    style.id = "reliefTuningHudStyle";
    style.textContent = STYLE;
    document.head.appendChild(style);

    this._drawer = new ShowcaseDrawer({
      id: "reliefTuningHud",
      title: "Metal Relief Lab",
      icon: "🎨",
      badge: "Inspector",
      body: BODY,
      open: false,
    });
    const button = this._drawer.toggleButton;
    button.id = "reliefPanelOpenBtn";
    button.innerHTML = "<span>⚙</span>";

    // Focused panel controls keep their keys (arrows on sliders) away from camera and shortcuts.
    for (const eventName of ["keydown", "keyup"]) {
      this.root.addEventListener(eventName, (e: Event): void => e.stopPropagation());
    }
    // Runs after the drawer's own toggle handlers.
    const notifyClosed = (): void => this._notifyIfClosed();
    button.addEventListener("click", notifyClosed);
    this._drawer.query(".hud-close-btn")?.addEventListener("click", notifyClosed);

    this._bind();
  }

  /** The drawer element (hover/drag tracking in the showcase). */
  public get root(): HTMLElement {
    return this._drawer.root;
  }

  public get isOpen(): boolean {
    return this._drawer.isOpen;
  }

  /** Handles the I / H panel shortcut. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    if (!this._drawer.handleKey(event)) {
      return false;
    }
    this._notifyIfClosed();
    return true;
  }

  public syncMode(mode: ReliefDisplayMode): void {
    const selMode = this._drawer.query<HTMLSelectElement>("#selMode");
    if (selMode && selMode.value !== mode) {
      selMode.value = mode;
    }
    const studioSection = this._drawer.query("#studioSection");
    if (studioSection) {
      studioSection.style.display = mode === "studio" ? "flex" : "none";
    }
  }

  public syncSplit(position: number): void {
    const slider = this._drawer.query<HTMLInputElement>("#slSplit");
    const label = this._drawer.query("#valSplit");
    if (slider) slider.value = position.toFixed(2);
    if (label) label.textContent = position.toFixed(2);
    this._drawer
      .query("#btnSplitHalf")
      ?.classList.toggle("active", Math.abs(position - 0.5) < 0.03);
    this._drawer.query("#btnSplitPhoto")?.classList.toggle("active", position >= 0.98);
    this._drawer.query("#btnSplitMetal")?.classList.toggle("active", position <= 0.02);
  }

  public syncPreset(presetId: string): void {
    this.root.querySelectorAll(".btn-preset").forEach((b) => b.classList.remove("active"));
    const id = PRESET_BUTTONS[presetId] ?? "btnPresetCustom";
    this._drawer.query(`#${id}`)?.classList.add("active");
  }

  /** Highlights the drop zone while a file is dragged over the window. */
  public setDropHighlight(active: boolean): void {
    this._drawer.query("#dropZoneHud")?.classList.toggle("dragover", active);
  }

  private _notifyIfClosed(): void {
    if (!this._drawer.isOpen) {
      this._host.onPanelClosed();
    }
  }

  private _bind(): void {
    const host = this._host;
    const selMode = this._drawer.query<HTMLSelectElement>("#selMode");
    selMode?.addEventListener("change", () => {
      host.setMode(selMode.value as ReliefDisplayMode);
    });

    this._bindSlider("slSplit", "valSplit", (v) => host.setSplitPosition(v));
    this._onClick("btnSplitHalf", () => host.setSplitPosition(0.5));
    this._onClick("btnSplitPhoto", () => host.setSplitPosition(1.0));
    this._onClick("btnSplitMetal", () => host.setSplitPosition(0.0));

    for (const [presetId, buttonId] of Object.entries(PRESET_BUTTONS)) {
      this._onClick(buttonId, () => host.setActivePreset(presetId));
    }

    const filePicker = this._drawer.query<HTMLInputElement>("#filePickerInput");
    this._onClick("dropZoneHud", () => filePicker?.click());
    filePicker?.addEventListener("change", () => {
      if (filePicker.files?.[0]) {
        host.loadImageFile(filePicker.files[0]);
      }
    });

    for (const [param, sliderId, labelId] of SLIDERS) {
      this._bindSlider(sliderId, labelId, (v) => host.setParam(param, v));
    }

    this._onClick("btnUndo", () => host.undoStudio());
    this._onClick("btnClear", () => host.clearStudio());
    const btnErase = this._drawer.query("#btnErase");
    btnErase?.addEventListener("click", () => {
      btnErase.classList.toggle("active", host.toggleEraser());
    });
    const btnBase = this._drawer.query("#btnBaseToggle");
    btnBase?.addEventListener("click", () => {
      btnBase.classList.toggle("active", host.toggleStudioBase());
    });
    for (let i = 0; i < 6; i++) {
      this._onClick(`swatch${i + 1}`, () => {
        host.pickSwatch(i);
        btnErase?.classList.remove("active");
      });
    }
  }

  private _onClick(id: string, handler: () => void): void {
    this._drawer.query(`#${id}`)?.addEventListener("click", handler);
  }

  private _bindSlider(sliderId: string, labelId: string, callback: (val: number) => void): void {
    const slider = this._drawer.query<HTMLInputElement>(`#${sliderId}`);
    const label = this._drawer.query(`#${labelId}`);
    if (!slider || !label) return;
    slider.addEventListener("input", () => {
      const val = parseFloat(slider.value);
      label.textContent = val.toFixed(2);
      callback(val);
    });
  }
}
