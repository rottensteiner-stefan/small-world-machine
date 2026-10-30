import {
  ShowcaseDrawer,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";

export type MoodPreset = "day" | "golden" | "foggy" | "dusk";

/** Scene state mirrored by the HUD panel. */
export interface HudState {
  impostersVisible: boolean;
  treeCount: number;
  realTreesVisible: boolean;
  grassVisible: boolean;
  windEnabled: boolean;
  mood: MoodPreset;
  fogEnabled: boolean;
  fogFar: number;
  sunIntensity: number;
  autoOrbit: boolean;
  activeCameraPreset: number;
}

/** Scene actions triggered by the HUD panel. */
export interface HudActions {
  onImpostersVisible(visible: boolean): void;
  onTreeCount(count: number): void;
  onRealTreesVisible(visible: boolean): void;
  onGrassVisible(visible: boolean): void;
  onWindEnabled(enabled: boolean): void;
  onMood(mood: MoodPreset): void;
  onFogEnabled(enabled: boolean): void;
  onFogFar(distance: number): void;
  onSunIntensity(intensity: number): void;
  onAutoOrbit(orbit: boolean): void;
  onCameraPreset(presetIndex: number): void;
}

interface SliderConfig {
  readonly id: string;
  readonly get: (state: HudState) => number;
  readonly format: (val: number) => string;
}

const SLIDERS: readonly SliderConfig[] = [
  { id: "slTreeCount", get: (s) => s.treeCount, format: (v) => `${Math.round(v)} Bäume` },
  { id: "slFogFar", get: (s) => s.fogFar, format: (v) => `${Math.round(v)} m` },
  { id: "slSunIntensity", get: (s) => s.sunIntensity, format: (v) => `${v.toFixed(1)}x` },
];

/**
 * Control panel for Showcase 34 ("Billboard Grove") built on {@link ShowcaseDrawer}.
 * Exposes real-time controls for tree counts, visibility toggles, lighting moods,
 * fog parameters, camera presets, and 360-degree auto-orbit.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _swImposters: HTMLInputElement;
  private readonly _slTreeCount: HTMLInputElement;
  private readonly _swRealTrees: HTMLInputElement;
  private readonly _swGrass: HTMLInputElement;
  private readonly _swWind: HTMLInputElement;
  private readonly _selMood: HTMLSelectElement;
  private readonly _swFog: HTMLInputElement;
  private readonly _slFogFar: HTMLInputElement;
  private readonly _slSunIntensity: HTMLInputElement;
  private readonly _swAutoOrbit: HTMLInputElement;
  private readonly _camButtons: NodeListOf<HTMLButtonElement>;

  constructor(callbacks: HudActions) {
    this._drawer = new ShowcaseDrawer({
      id: "billboard-grove-hud",
      title: "Billboard Grove",
      icon: "🌲",
      open: true,
      footerIcon: "⚙",
      buttonId: "groveInspectorBtn",
      body: `
        ${hudSection(
          "🌿 Vegetation & Billboards",
          "",
          `
          ${hudSwitch("swImposters", "Billboard-Bäume")}
          ${hudSlider("slTreeCount", "Baum-Anzahl", 5, 100, 5)}
          ${hudSwitch("swRealTrees", "Echte 3D-Bäume (Vergleich)")}
          ${hudSwitch("swGrass", "Grasfeld (Instanced)")}
          ${hudSwitch("swWind", "Wind / Sanftes Schwanken")}
          `,
        )}

        ${hudSection(
          "☀️ Atmosphäre & Licht",
          "",
          `
          <div class="hud-row">
            <label for="selMood">Stimmung</label>
            <select id="selMood">
              <option value="day">☀️ Sonniger Tag</option>
              <option value="golden">🌅 Goldene Stunde</option>
              <option value="foggy">🌫️ Morgennebel</option>
              <option value="dusk">🌙 Dämmerung</option>
            </select>
          </div>
          ${hudSwitch("swFog", "Horizont-Haze (Fog)")}
          ${hudSlider("slFogFar", "Nebel-Distanz", 20, 60, 2)}
          ${hudSlider("slSunIntensity", "Sonnen-Intensität", 0.5, 3.0, 0.1)}
          `,
        )}

        ${hudSection(
          "🎥 Kamera & Rundflug",
          "",
          `
          <div class="preset-group two-col" style="margin-bottom:8px;">
            <button class="btn-preset active" data-cam="0">🌲 Lichtung</button>
            <button class="btn-preset" data-cam="1">🔍 3D vs. Billboard</button>
            <button class="btn-preset" data-cam="2">🦅 Vogelperspektive</button>
            <button class="btn-preset" data-cam="3">🌿 Im Dickicht</button>
          </div>
          ${hudSwitch("swAutoOrbit", "Kamera-Rundflug (360°)")}
          ${hudNote("Taste <kbd>I</kbd> oder <kbd>H</kbd> blendet dieses Panel ein/aus. Mit der Maus drehen & zoomen.")}
          `,
        )}
      `,
    });

    this._swImposters = this._drawer.query<HTMLInputElement>("#swImposters")!;
    this._slTreeCount = this._drawer.query<HTMLInputElement>("#slTreeCount")!;
    this._swRealTrees = this._drawer.query<HTMLInputElement>("#swRealTrees")!;
    this._swGrass = this._drawer.query<HTMLInputElement>("#swGrass")!;
    this._swWind = this._drawer.query<HTMLInputElement>("#swWind")!;
    this._selMood = this._drawer.query<HTMLSelectElement>("#selMood")!;
    this._swFog = this._drawer.query<HTMLInputElement>("#swFog")!;
    this._slFogFar = this._drawer.query<HTMLInputElement>("#slFogFar")!;
    this._slSunIntensity = this._drawer.query<HTMLInputElement>("#slSunIntensity")!;
    this._swAutoOrbit = this._drawer.query<HTMLInputElement>("#swAutoOrbit")!;
    this._camButtons = this._drawer.root.querySelectorAll<HTMLButtonElement>("button[data-cam]");

    // Vegetation listeners
    this._swImposters.addEventListener("change", () =>
      callbacks.onImpostersVisible(this._swImposters.checked),
    );
    this._slTreeCount.addEventListener("input", () => {
      const val = parseInt(this._slTreeCount.value, 10);
      this._updateSliderLabel("slTreeCount", `${val} Bäume`);
      callbacks.onTreeCount(val);
    });
    this._swRealTrees.addEventListener("change", () =>
      callbacks.onRealTreesVisible(this._swRealTrees.checked),
    );
    this._swGrass.addEventListener("change", () => callbacks.onGrassVisible(this._swGrass.checked));
    this._swWind.addEventListener("change", () => callbacks.onWindEnabled(this._swWind.checked));

    // Atmosphere listeners
    this._selMood.addEventListener("change", () =>
      callbacks.onMood(this._selMood.value as MoodPreset),
    );
    this._swFog.addEventListener("change", () => callbacks.onFogEnabled(this._swFog.checked));
    this._slFogFar.addEventListener("input", () => {
      const val = parseFloat(this._slFogFar.value);
      this._updateSliderLabel("slFogFar", `${Math.round(val)} m`);
      callbacks.onFogFar(val);
    });
    this._slSunIntensity.addEventListener("input", () => {
      const val = parseFloat(this._slSunIntensity.value);
      this._updateSliderLabel("slSunIntensity", `${val.toFixed(1)}x`);
      callbacks.onSunIntensity(val);
    });

    // Camera listeners
    this._swAutoOrbit.addEventListener("change", () =>
      callbacks.onAutoOrbit(this._swAutoOrbit.checked),
    );
    this._camButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset["cam"] ?? "0", 10);
        callbacks.onCameraPreset(idx);
      });
    });
  }

  /** The drawer element. */
  public get root(): HTMLElement {
    return this._drawer.root;
  }

  /** Syncs all control widgets to the given state. */
  public sync(state: HudState): void {
    this._swImposters.checked = state.impostersVisible;
    this._slTreeCount.value = String(state.treeCount);
    this._swRealTrees.checked = state.realTreesVisible;
    this._swGrass.checked = state.grassVisible;
    this._swWind.checked = state.windEnabled;
    this._selMood.value = state.mood;
    this._swFog.checked = state.fogEnabled;
    this._slFogFar.value = String(state.fogFar);
    this._slSunIntensity.value = String(state.sunIntensity);
    this._swAutoOrbit.checked = state.autoOrbit;

    for (const cfg of SLIDERS) {
      this._updateSliderLabel(cfg.id, cfg.format(cfg.get(state)));
    }

    this._camButtons.forEach((btn) => {
      const camIdx = parseInt(btn.dataset["cam"] ?? "-1", 10);
      btn.classList.toggle("active", camIdx === state.activeCameraPreset);
    });
  }

  private _updateSliderLabel(sliderId: string, text: string): void {
    const label = this._drawer.query<HTMLElement>(`#${sliderId}_val`);
    if (label) {
      label.textContent = text;
    }
  }

  /** Handles toggle keys (I / H). Returns true if consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Cleans up DOM elements on showcase teardown. */
  public dispose(): void {
    this._drawer.dispose();
  }
}
