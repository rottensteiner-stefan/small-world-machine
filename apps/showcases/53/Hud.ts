import { hudNote, hudSection, ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";

export type CameraPresetKey = "wide" | "hangar" | "crown" | "waterline";
export type AtmosphereKey = "storm" | "twilight" | "redAlert";

export const CAMERA_PRESETS: readonly CameraPresetKey[] = ["wide", "hangar", "crown", "waterline"];

export const ATMOSPHERE_KEYS: readonly AtmosphereKey[] = ["storm", "twilight", "redAlert"];

export interface FortressHudState {
  cameraPreset: CameraPresetKey;
  atmosphere: AtmosphereKey;
  reflection: boolean;
  bloom: boolean;
  fog: boolean;
}

export interface FortressHudActions {
  setCameraPreset(preset: CameraPresetKey): void;
  setAtmosphere(atmosphere: AtmosphereKey): void;
  toggleReflection(): void;
  toggleBloom(): void;
  toggleFog(): void;
  resetView(): void;
}

const CAMERA_LABELS: Record<CameraPresetKey, string> = {
  wide: "Monumental",
  hangar: "Hangar Bay",
  crown: "Command Crown",
  waterline: "Waterline",
};

const ATMOSPHERE_LABELS: Record<AtmosphereKey, string> = {
  storm: "Nur Storm",
  twilight: "Deep Twilight",
  redAlert: "Red Alert",
};

/** Controls and telemetry drawer for Showcase 53 (Fortress Inquisitorius). */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _readout: HTMLElement;
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
          "1–4 · R reset",
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
            <button id="btnResetView" class="btn-preset" title="Key R">Reset View</button>
          </div>`,
        )}
        ${hudSection(
          "🕹 Flight Controls",
          "Click to look",
          `<div class="hud-note"><b>Click</b> canvas for mouse look (Esc releases) &bull; <b>WASD</b>/Arrows fly &bull; <b>Space/E</b> up &bull; <b>C/Q</b> down &bull; <b>Shift</b> boost &bull; <b>Wheel</b> speed</div>`,
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
    d.query("#btnResetView")?.addEventListener("click", (): void => this._actions.resetView());
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
    if (this._readout.textContent !== statsText) {
      this._readout.textContent = statsText;
    }
  }

  public dispose(): void {
    this._drawer.dispose();
  }
}
