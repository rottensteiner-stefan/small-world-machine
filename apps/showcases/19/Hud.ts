import {
  ShowcaseDrawer,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";

export type DragPlaneMode = "camera" | "ground";
export type ColorPalette = "rainbow" | "cyber" | "sunset" | "emerald" | "minimal";
export type GlowColorName = "cyan" | "purple" | "amber" | "lime";

export interface PickingLabSettings {
  // Interaction
  hoverEnabled: boolean;
  hoverScale: number;
  glowIntensity: number;
  glowColor: GlowColorName;

  // Dragging
  dragEnabled: boolean;
  dragMode: DragPlaneMode;

  // Click & Palette
  clickRecolorEnabled: boolean;
  palette: ColorPalette;

  // Grid
  gridSize: number;
  spacing: number;

  // Camera & Visuals
  cameraMode: "orbit" | "fly";
  shadows: boolean;
  bloom: boolean;
  bloomIntensity: number;
}

export function defaultPickingLabSettings(): PickingLabSettings {
  return {
    hoverEnabled: true,
    hoverScale: 1.4,
    glowIntensity: 2.5,
    glowColor: "cyan",

    dragEnabled: true,
    dragMode: "ground",

    clickRecolorEnabled: true,
    palette: "cyber",

    gridSize: 30, // 30x30 = 900 cubes for silky smooth picking & interaction
    spacing: 1.5,

    cameraMode: "orbit",
    shadows: true,
    bloom: true,
    bloomIntensity: 2.0,
  };
}

export interface PickingLabActions {
  onSettingsChange: (settings: PickingLabSettings) => void;
  onTriggerWave: () => void;
  onRandomizeAllColors: () => void;
  onResetPositions: () => void;
  onGridSizeChange: (size: number) => void;
}

export interface PickingLabStats {
  cubeCount: number;
  hoveredObject: string;
  draggingObject: string;
  queryHits: number;
}

const SWITCHES = [
  "hoverEnabled",
  "dragEnabled",
  "clickRecolorEnabled",
  "shadows",
  "bloom",
] as const;

interface SliderConfig {
  readonly id: string;
  readonly key: keyof PickingLabSettings;
  readonly format: (val: number) => string;
}

const SLIDERS: readonly SliderConfig[] = [
  { id: "sl_hoverScale", key: "hoverScale", format: (v) => `${v.toFixed(1)}×` },
  { id: "sl_glowIntensity", key: "glowIntensity", format: (v) => v.toFixed(1) },
  { id: "sl_spacing", key: "spacing", format: (v) => `${v.toFixed(1)} m` },
  { id: "sl_bloomIntensity", key: "bloomIntensity", format: (v) => v.toFixed(1) },
];

/**
 * Interactive inspector drawer for Showcase 19 (Gamification & Picking Lab).
 */
export class PickingLabHud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _root: HTMLElement;
  private readonly _settings: PickingLabSettings;
  private readonly _actions: PickingLabActions;

  constructor(initialSettings: PickingLabSettings, actions: PickingLabActions) {
    this._settings = { ...initialSettings };
    this._actions = actions;

    this._drawer = new ShowcaseDrawer({
      id: "picking-lab-hud",
      title: "Picking & Gamification Lab",
      icon: "🎯",
      open: false,
      footerIcon: "⚙",
      buttonId: "pickingLabHudBtn",
      shieldKeys: true,
      body: `
        ${hudSection(
          "🎮 Interaction & Drag & Drop",
          "Mouse picking",
          hudSwitch("sw_hoverEnabled", "Hover effect enabled") +
            hudSwitch("sw_dragEnabled", "3D drag & drop enabled") +
            `<div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin:6px 0 8px 0;">
              <span style="font-size:11px;color:#94a3b8;">Drag plane:</span>
              <div class="preset-group two-col" id="dragModeGroup">
                <button class="btn-preset active" data-mode="ground">🏓 Ground (XZ table)</button>
                <button class="btn-preset" data-mode="camera">📐 Camera view plane</button>
              </div>
            </div>` +
            hudSwitch("sw_clickRecolorEnabled", "Click to recolor") +
            `<div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin:6px 0 8px 0;">
              <span style="font-size:11px;color:#94a3b8;">Click palette:</span>
              <div class="preset-group three-col" id="paletteGroup">
                <button class="btn-preset active" data-palette="cyber">⚡ Cyber</button>
                <button class="btn-preset" data-palette="sunset">🌅 Sunset</button>
                <button class="btn-preset" data-palette="emerald">🍃 Emerald</button>
                <button class="btn-preset" data-palette="rainbow">🌈 Rainbow</button>
                <button class="btn-preset" data-palette="minimal">⚪ Minimal</button>
              </div>
            </div>` +
            hudNote("Click = instant recolor · Drag = move in 3D space"),
        )}

        ${hudSection(
          "✨ Hover & Glow Tuning",
          "Shader-Emission",
          hudSlider("sl_hoverScale", "Hover scale", 1.0, 2.5, 0.1) +
            hudSlider("sl_glowIntensity", "Glow intensity", 0.0, 6.0, 0.2) +
            `<div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin:6px 0 8px 0;">
              <span style="font-size:11px;color:#94a3b8;">Hover glow color:</span>
              <div class="preset-group four-col" id="glowColorGroup">
                <button class="btn-preset active" data-glow="cyan">Cyan</button>
                <button class="btn-preset" data-glow="purple">Purple</button>
                <button class="btn-preset" data-glow="amber">Amber</button>
                <button class="btn-preset" data-glow="lime">Lime</button>
              </div>
            </div>`,
        )}

        ${hudSection(
          "🎲 Playfield & Physics Waves",
          "Grid & actions",
          `<div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin:4px 0 8px 0;">
            <span style="font-size:11px;color:#94a3b8;">Field size:</span>
            <div class="preset-group four-col" id="gridSizeGroup">
              <button class="btn-preset" data-size="10">10×10</button>
              <button class="btn-preset" data-size="20">20×20</button>
              <button class="btn-preset active" data-size="30">30×30</button>
              <button class="btn-preset" data-size="40">40×40</button>
            </div>
          </div>` +
            hudSlider("sl_spacing", "Grid spacing", 1.0, 2.5, 0.1) +
            `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
              <button class="btn-preset" id="btnTriggerWave" style="background:#2563eb;color:#fff;font-weight:600;padding:7px 10px;">
                🌊 Send impulse wave
              </button>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <button class="btn-preset" id="btnRandomizeColors">🎲 Recolor all</button>
                <button class="btn-preset" id="btnResetPositions">🔄 Reset positions</button>
              </div>
            </div>` +
            hudNote(
              "The impulse wave lifts cubes sinusoidally. Move cubes, then restore them with Reset.",
            ),
        )}

        ${hudSection(
          "🎥 Camera & Rendering",
          "Orbit / lighting",
          `<div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin:4px 0 8px 0;">
            <span style="font-size:11px;color:#94a3b8;">Camera mode:</span>
            <div class="preset-group two-col" id="cameraModeGroup">
              <button class="btn-preset active" data-cam="orbit">🪐 Orbit (right-click/free space)</button>
              <button class="btn-preset" data-cam="fly">🚀 FlyCam (WASD)</button>
            </div>
          </div>` +
            hudSwitch("sw_shadows", "Cast shadows") +
            hudSwitch("sw_bloom", "HDR Bloom Post-Processing") +
            hudSlider("sl_bloomIntensity", "Bloom intensity", 0.0, 5.0, 0.2),
        )}

        ${hudSection(
          "📊 Live status & Telemetry",
          "Real time",
          `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;line-height:1.6;color:#cbd5e1;background:rgba(15,23,42,0.6);padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.06);">
            <span style="color:#94a3b8;">Cubes in field:</span><span id="stat_cubeCount" style="font-weight:600;color:#38bdf8;">900</span>
            <span style="color:#94a3b8;">Hover focus:</span><span id="stat_hovered" style="font-family:monospace;color:#a78bfa;">-</span>
            <span style="color:#94a3b8;">Drag state:</span><span id="stat_dragging" style="font-family:monospace;color:#facc15;">Idle</span>
            <span style="color:#94a3b8;">Raycast candidates:</span><span id="stat_queryHits" style="font-family:monospace;color:#4ade80;">-</span>
          </div>`,
        )}

        <div class="hud-section hud-keys">
          <kbd>I</kbd> / <kbd>H</kbd> Toggle panel · <kbd>Click</kbd> Recolor · <kbd>Drag</kbd> Move · <kbd>Right-click</kbd> Orbit
        </div>
      `,
    });

    this._root = this._drawer.root;
    this._bind();
    this.sync();
  }

  public get settings(): PickingLabSettings {
    return this._settings;
  }

  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Removes the drawer and its footer button (showcase teardown). */
  public dispose(): void {
    this._drawer.dispose();
  }

  public updateStats(stats: PickingLabStats): void {
    const elCount = this._root.querySelector<HTMLElement>("#stat_cubeCount");
    const elHovered = this._root.querySelector<HTMLElement>("#stat_hovered");
    const elDragging = this._root.querySelector<HTMLElement>("#stat_dragging");
    const elHits = this._root.querySelector<HTMLElement>("#stat_queryHits");

    if (elCount) elCount.textContent = String(stats.cubeCount);
    if (elHovered) elHovered.textContent = stats.hoveredObject;
    if (elDragging) elDragging.textContent = stats.draggingObject;
    if (elHits) elHits.textContent = `${stats.queryHits} objects`;
  }

  public sync(): void {
    // 1. Sync switches
    for (const key of SWITCHES) {
      const input = this._root.querySelector<HTMLInputElement>(`#sw_${key}`);
      if (input) {
        input.checked = Boolean(this._settings[key]);
      }
    }

    // 2. Sync sliders
    for (const s of SLIDERS) {
      const input = this._root.querySelector<HTMLInputElement>(`#${s.id}`);
      const valLabel = this._root.querySelector<HTMLElement>(`#${s.id}_val`);
      const val = Number(this._settings[s.key]);
      if (input) {
        input.value = String(val);
      }
      if (valLabel) {
        valLabel.textContent = s.format(val);
      }
    }

    // 3. Sync preset groups
    this._syncGroup("#dragModeGroup button", "mode", this._settings.dragMode);
    this._syncGroup("#paletteGroup button", "palette", this._settings.palette);
    this._syncGroup("#glowColorGroup button", "glow", this._settings.glowColor);
    this._syncGroup("#gridSizeGroup button", "size", String(this._settings.gridSize));
    this._syncGroup("#cameraModeGroup button", "cam", this._settings.cameraMode);
  }

  private _syncGroup(selector: string, datasetKey: string, activeValue: string): void {
    const buttons = this._root.querySelectorAll<HTMLButtonElement>(selector);
    buttons.forEach((btn) => {
      const isSelected = btn.dataset[datasetKey] === activeValue;
      btn.classList.toggle("active", isSelected);
    });
  }

  private _bind(): void {
    // 1. Switches
    for (const key of SWITCHES) {
      const input = this._root.querySelector<HTMLInputElement>(`#sw_${key}`);
      input?.addEventListener("change", () => {
        (this._settings as unknown as Record<string, boolean>)[key] = input.checked;
        this._actions.onSettingsChange(this._settings);
      });
    }

    // 2. Sliders
    for (const s of SLIDERS) {
      const input = this._root.querySelector<HTMLInputElement>(`#${s.id}`);
      input?.addEventListener("input", () => {
        const val = parseFloat(input.value);
        (this._settings as unknown as Record<string, number>)[s.key] = val;
        const valLabel = this._root.querySelector<HTMLElement>(`#${s.id}_val`);
        if (valLabel) {
          valLabel.textContent = s.format(val);
        }
        this._actions.onSettingsChange(this._settings);
      });
    }

    // 3. Drag mode buttons
    this._root.querySelector("#dragModeGroup")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn || !btn.dataset["mode"]) return;
      this._settings.dragMode = btn.dataset["mode"] as DragPlaneMode;
      this.sync();
      this._actions.onSettingsChange(this._settings);
    });

    // 4. Palette buttons
    this._root.querySelector("#paletteGroup")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn || !btn.dataset["palette"]) return;
      this._settings.palette = btn.dataset["palette"] as ColorPalette;
      this.sync();
      this._actions.onSettingsChange(this._settings);
    });

    // 5. Glow color buttons
    this._root.querySelector("#glowColorGroup")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn || !btn.dataset["glow"]) return;
      this._settings.glowColor = btn.dataset["glow"] as GlowColorName;
      this.sync();
      this._actions.onSettingsChange(this._settings);
    });

    // 6. Grid size buttons
    this._root.querySelector("#gridSizeGroup")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn || !btn.dataset["size"]) return;
      const size = parseInt(btn.dataset["size"], 10);
      this._settings.gridSize = size;
      this.sync();
      this._actions.onGridSizeChange(size);
    });

    // 7. Camera mode buttons
    this._root.querySelector("#cameraModeGroup")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn || !btn.dataset["cam"]) return;
      this._settings.cameraMode = btn.dataset["cam"] as "orbit" | "fly";
      this.sync();
      this._actions.onSettingsChange(this._settings);
    });

    // 8. Action buttons
    this._root.querySelector("#btnTriggerWave")?.addEventListener("click", () => {
      this._actions.onTriggerWave();
    });

    this._root.querySelector("#btnRandomizeColors")?.addEventListener("click", () => {
      this._actions.onRandomizeAllColors();
    });

    this._root.querySelector("#btnResetPositions")?.addEventListener("click", () => {
      this._actions.onResetPositions();
    });
  }
}
