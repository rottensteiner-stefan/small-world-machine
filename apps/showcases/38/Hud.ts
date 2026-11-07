import { ShowcaseDrawer, hudSwitch } from "../shared/ShowcaseDrawer.js";

export enum TimeOfDay {
  GOLDEN_HOUR = "Golden Hour (Morning)",
  MIDDAY = "Midday Sun",
  MIDNIGHT = "Midnight Starlight",
}

/** Scene state the panel mirrors. */
export interface HudState {
  timeOfDay: TimeOfDay;
  flickerEnabled: boolean;
  audioMuted: boolean;
  activePresetIdx: number;
}

/** Scene actions the panel triggers; the showcase applies them and calls {@link Hud.sync}. */
export interface HudActions {
  onTimeOfDay(mode: TimeOfDay): void;
  onFlicker(enabled: boolean): void;
  onAudioMuted(muted: boolean): void;
  onCameraPreset(index: number): void;
}

const PRESET_LABELS = ["Siq Gorge", "Plaza", "Portico", "Sanctum", "Shrine"];

/**
 * Petra panel of showcase 38 on the shared {@link ShowcaseDrawer}. Owns only its controls; the
 * scene state stays in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _timeOfDay: HTMLSelectElement;
  private readonly _flicker: HTMLInputElement;
  private readonly _audio: HTMLInputElement;

  constructor(callbacks: HudActions) {
    const presets = PRESET_LABELS.map(
      (label, i) => `<button class="btn-preset" data-cam="${i}">${label}</button>`,
    ).join("");
    this._drawer = new ShowcaseDrawer({
      // GoldenCapture hides the panel by this id.
      id: "petra-hud",
      title: "Al-Khazneh — Petra",
      icon: "🏛️",
      open: false,
      footerIcon: "⚙",
      buttonId: "petraInspectorBtn",
      body: `
        <div class="hud-section">
          <div class="section-title">⚙️ Atmosphere & Audio</div>
          <div class="hud-row">
            <label for="selTimeOfDay">Time of Day</label>
            <select id="selTimeOfDay">
              <option value="${TimeOfDay.GOLDEN_HOUR}">Golden Hour</option>
              <option value="${TimeOfDay.MIDDAY}">Midday Sun</option>
              <option value="${TimeOfDay.MIDNIGHT}">Midnight Starlight</option>
            </select>
          </div>
          ${hudSwitch("swFlicker", "Flame Flicker")}
          ${hudSwitch("swAudio", "Canyon Wind Audio")}
        </div>

        <div class="hud-section">
          <div class="section-title">📍 Camera Viewpoint</div>
          <div class="preset-group">${presets}</div>
        </div>
      `,
    });
    this._timeOfDay = this._drawer.query<HTMLSelectElement>("#selTimeOfDay")!;
    this._flicker = this._drawer.query<HTMLInputElement>("#swFlicker")!;
    this._audio = this._drawer.query<HTMLInputElement>("#swAudio")!;

    this._timeOfDay.addEventListener("change", () =>
      callbacks.onTimeOfDay(this._timeOfDay.value as TimeOfDay),
    );
    this._flicker.addEventListener("change", () => callbacks.onFlicker(this._flicker.checked));
    this._audio.addEventListener("change", () => callbacks.onAudioMuted(!this._audio.checked));
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
  public sync(state: HudState): void {
    this._timeOfDay.value = state.timeOfDay;
    this._flicker.checked = state.flickerEnabled;
    this._audio.checked = !state.audioMuted;
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
}
