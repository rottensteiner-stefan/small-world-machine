import { hudNote, hudSection, ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";

export type CameraPresetKey = "wide" | "hangar" | "crown" | "waterline" | "trench";
export type AtmosphereKey = "storm" | "twilight" | "redAlert";

export const CAMERA_PRESETS: readonly CameraPresetKey[] = [
  "wide",
  "hangar",
  "crown",
  "waterline",
  "trench",
];

export const ATMOSPHERE_KEYS: readonly AtmosphereKey[] = ["storm", "twilight", "redAlert"];

export interface OceanTuningState {
  waveScale: number;
  windSpeed: number;
  choppiness: number;
  caustics: number;
  foamCoverage: number;
}

export interface FortressHudState {
  cameraPreset: CameraPresetKey;
  atmosphere: AtmosphereKey;
  reflection: boolean;
  bloom: boolean;
  fog: boolean;
  hbao: boolean;
  hiDpi: boolean;
  searchlights: boolean;
  oceanParams: OceanTuningState;
}

export interface FortressHudActions {
  setCameraPreset(preset: CameraPresetKey): void;
  setAtmosphere(atmosphere: AtmosphereKey): void;
  toggleReflection(): void;
  toggleBloom(): void;
  toggleFog(): void;
  toggleHbao(): void;
  toggleHiDpi(): void;
  toggleSearchlights(): void;
  triggerLightning(): void;
  resetView(): void;
  setWaveScale(value: number): void;
  setWindSpeed(value: number): void;
  setChoppiness(value: number): void;
  setCaustics(value: number): void;
  setFoamCoverage(value: number): void;
}

const CAMERA_LABELS: Record<CameraPresetKey, string> = {
  wide: "Monumental",
  hangar: "Hangar Bay",
  crown: "Command Crown",
  waterline: "Waterline",
  trench: "Basalt Trench",
};

const ATMOSPHERE_LABELS: Record<AtmosphereKey, string> = {
  storm: "Nur Storm",
  twilight: "Deep Twilight",
  redAlert: "Red Alert",
};

interface OceanSliderSpec {
  readonly key: keyof OceanTuningState;
  readonly sliderId: string;
  readonly labelId: string;
  readonly apply: (actions: FortressHudActions, value: number) => void;
}

interface OceanSliderBinding {
  readonly key: keyof OceanTuningState;
  readonly slider: HTMLInputElement | null;
  readonly label: HTMLElement | null;
}

const OCEAN_SLIDER_SPECS: readonly OceanSliderSpec[] = [
  {
    key: "waveScale",
    sliderId: "slWaveScale",
    labelId: "valWaveScale",
    apply: (actions, value): void => actions.setWaveScale(value),
  },
  {
    key: "windSpeed",
    sliderId: "slWindSpeed",
    labelId: "valWindSpeed",
    apply: (actions, value): void => actions.setWindSpeed(value),
  },
  {
    key: "choppiness",
    sliderId: "slChoppiness",
    labelId: "valChoppiness",
    apply: (actions, value): void => actions.setChoppiness(value),
  },
  {
    key: "caustics",
    sliderId: "slCaustics",
    labelId: "valCaustics",
    apply: (actions, value): void => actions.setCaustics(value),
  },
  {
    key: "foamCoverage",
    sliderId: "slFoamCoverage",
    labelId: "valFoamCoverage",
    apply: (actions, value): void => actions.setFoamCoverage(value),
  },
];

/** Controls and telemetry drawer for Showcase 53 (Fortress Inquisitorius). */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _readout: HTMLElement;
  private readonly _oceanSliders: readonly OceanSliderBinding[];
  private _hovering: boolean = false;

  constructor(
    engine: FrameTelemetrySource,
    private readonly _actions: FortressHudActions,
  ) {
    const camButtons = CAMERA_PRESETS.map(
      (key, idx) =>
        `<button id="btnCam_${key}" class="btn-preset" title="Key ${idx + 1}">${CAMERA_LABELS[key]}</button>`,
    ).join("");
    const atmoButtons = ATMOSPHERE_KEYS.map(
      (key) =>
        `<button id="btnAtmo_${key}" class="btn-preset" title="Key L cycles">${ATMOSPHERE_LABELS[key]}</button>`,
    ).join("");

    this._drawer = new ShowcaseDrawer({
      id: "fortress-hud",
      title: "Fortress Inquisitorius",
      icon: "🏰",
      open: false,
      footerIcon: "⚙",
      buttonId: "fortressInspectorBtn",
      engine,
      body: `
        ${hudSection(
          "🎥 Camera Angle",
          "1–5 · R reset",
          `<div class="preset-group two-col">${camButtons}</div>`,
        )}
        ${hudSection(
          "🌩 Moon Nur Atmosphere",
          "L cycles",
          `<div class="preset-group two-col">${atmoButtons}</div>
          <div class="preset-group two-col" style="margin-top:6px;">
            <button id="btnReflection" class="btn-preset" title="Planar sea reflection">Sea Reflection</button>
            <button id="btnBloom" class="btn-preset" title="HDR bloom on crimson visor & slits">HDR Bloom</button>
            <button id="btnFog" class="btn-preset" title="Volumetric / horizon storm mist">Storm Fog</button>
            <button id="btnSearchlights" class="btn-preset" title="Sweeping imperial spotlights">Searchlights</button>
            <button id="btnHbao" class="btn-preset" title="Screen-space HBAO (heavy GPU cost on laptops)">HBAO AO</button>
            <button id="btnHiDpi" class="btn-preset" title="Render at 1.5× Retina resolution">HiDPI 1.5×</button>
            <button id="btnLightning" class="btn-preset" title="Key F">⚡ Lightning (F)</button>
            <button id="btnResetView" class="btn-preset" title="Key R">Reset View</button>
          </div>`,
        )}
        ${hudSection(
          "🌊 Ocean & Surf",
          "Live tuning",
          `<div class="hud-row">
            <label for="slWaveScale">Wave Scale</label>
            <input type="range" id="slWaveScale" min="0" max="2.2" step="0.05" value="1.05" />
            <span class="val-label" id="valWaveScale">1.05</span>
          </div>
          <div class="hud-row">
            <label for="slWindSpeed">Wind Speed</label>
            <input type="range" id="slWindSpeed" min="0.2" max="2.4" step="0.05" value="1.28" />
            <span class="val-label" id="valWindSpeed">1.28</span>
          </div>
          <div class="hud-row">
            <label for="slChoppiness">Choppiness</label>
            <input type="range" id="slChoppiness" min="0" max="2.0" step="0.05" value="1.15" />
            <span class="val-label" id="valChoppiness">1.15</span>
          </div>
          <div class="hud-row">
            <label for="slCaustics">Caustics</label>
            <input type="range" id="slCaustics" min="0" max="1.5" step="0.05" value="0.52" />
            <span class="val-label" id="valCaustics">0.52</span>
          </div>
          <div class="hud-row">
            <label for="slFoamCoverage">Foam Coverage</label>
            <input type="range" id="slFoamCoverage" min="0" max="1.0" step="0.02" value="0.36" />
            <span class="val-label" id="valFoamCoverage">0.36</span>
          </div>`,
        )}
        ${hudSection(
          "🕹 Flight Controls",
          "Click to look",
          `<div class="hud-note"><b>Click</b> canvas for mouse look (Esc releases) &bull; <b>WASD</b>/Arrows fly &bull; <b>Space/E</b> up &bull; <b>C/Q</b> down &bull; <b>Shift</b> boost &bull; <b>Wheel</b> speed &bull; <b>1–5</b> views &bull; <b>F</b> lightning</div>`,
        )}
        ${hudNote('<div id="fortressReadout" style="opacity:0.85;">Loading Nur assets...</div>')}
      `,
    });

    this._readout = this._drawer.query<HTMLElement>("#fortressReadout")!;
    const d = this._drawer;
    d.root.addEventListener("pointerenter", (): void => {
      this._hovering = true;
    });
    d.root.addEventListener("pointerleave", (): void => {
      this._hovering = false;
    });

    for (const key of CAMERA_PRESETS) {
      d.query(`#btnCam_${key}`)?.addEventListener("click", (): void =>
        this._actions.setCameraPreset(key),
      );
    }
    for (const key of ATMOSPHERE_KEYS) {
      d.query(`#btnAtmo_${key}`)?.addEventListener("click", (): void =>
        this._actions.setAtmosphere(key),
      );
    }

    d.query("#btnReflection")?.addEventListener("click", (): void =>
      this._actions.toggleReflection(),
    );
    d.query("#btnBloom")?.addEventListener("click", (): void => this._actions.toggleBloom());
    d.query("#btnFog")?.addEventListener("click", (): void => this._actions.toggleFog());
    d.query("#btnHbao")?.addEventListener("click", (): void => this._actions.toggleHbao());
    d.query("#btnHiDpi")?.addEventListener("click", (): void => this._actions.toggleHiDpi());
    d.query("#btnSearchlights")?.addEventListener("click", (): void =>
      this._actions.toggleSearchlights(),
    );
    d.query("#btnLightning")?.addEventListener("click", (): void =>
      this._actions.triggerLightning(),
    );
    d.query("#btnResetView")?.addEventListener("click", (): void => this._actions.resetView());

    this._oceanSliders = OCEAN_SLIDER_SPECS.map((spec): OceanSliderBinding => {
      const slider = d.query<HTMLInputElement>(`#${spec.sliderId}`);
      const label = d.query<HTMLElement>(`#${spec.labelId}`);
      slider?.addEventListener("input", (): void => {
        const value = Number(slider.value);
        if (label) {
          label.textContent = value.toFixed(2);
        }
        spec.apply(this._actions, value);
      });
      return { key: spec.key, slider, label };
    });
  }

  public isHovered(): boolean {
    return this._hovering && this._drawer.isOpen;
  }

  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public sync(state: FortressHudState, statsText: string): void {
    const d = this._drawer;
    for (const key of CAMERA_PRESETS) {
      d.query(`#btnCam_${key}`)?.classList.toggle("active", state.cameraPreset === key);
    }
    for (const key of ATMOSPHERE_KEYS) {
      d.query(`#btnAtmo_${key}`)?.classList.toggle("active", state.atmosphere === key);
    }
    d.query("#btnReflection")?.classList.toggle("active", state.reflection);
    d.query("#btnBloom")?.classList.toggle("active", state.bloom);
    d.query("#btnFog")?.classList.toggle("active", state.fog);
    d.query("#btnHbao")?.classList.toggle("active", state.hbao);
    d.query("#btnHiDpi")?.classList.toggle("active", state.hiDpi);
    d.query("#btnSearchlights")?.classList.toggle("active", state.searchlights);

    for (const binding of this._oceanSliders) {
      const formatted = state.oceanParams[binding.key].toFixed(2);
      if (binding.label && binding.label.textContent !== formatted) {
        binding.label.textContent = formatted;
        if (binding.slider) {
          binding.slider.value = formatted;
        }
      }
    }

    if (this._readout.textContent !== statsText) {
      this._readout.textContent = statsText;
    }
  }

  public dispose(): void {
    this._drawer.dispose();
  }
}
