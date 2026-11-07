import { ShowcaseDrawer, hudSwitch } from "../shared/ShowcaseDrawer.js";

/** Scene state the panel mirrors. */
export interface HudState {
  night: boolean;
  puddleCamera: boolean;
  fluidIndex: number;
}

/** Scene actions the panel triggers; the showcase applies them and calls {@link Hud.sync}. */
export interface HudActions {
  onNight(night: boolean): void;
  onPuddleCamera(puddle: boolean): void;
  onFluid(index: number): void;
}

/**
 * Cyberpunk Albedo panel of showcase 30 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; mood, camera and liquid state stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _mood: HTMLInputElement;
  private readonly _puddle: HTMLInputElement;
  private readonly _fluid: HTMLSelectElement;

  constructor(fluidNames: readonly string[], callbacks: HudActions) {
    const options = fluidNames
      .map(
        (fluid, idx) =>
          `<option value="${idx}">${fluid.charAt(0).toUpperCase() + fluid.slice(1).replace(/_/g, " ")}</option>`,
      )
      .join("");
    this._drawer = new ShowcaseDrawer({
      id: "cyberpunk-hud",
      title: "Cyberpunk Albedo",
      icon: "🌧️",
      open: false,
      footerIcon: "⚙",
      buttonId: "cyberpunkInspectorBtn",
      body: `
        <div class="hud-section">
          <div class="section-title">🌃 Environment & Camera</div>
          ${hudSwitch("swMood", "Night Mood")}
          ${hudSwitch("swPuddle", "Puddle Camera")}
        </div>

        <div class="hud-section">
          <div class="section-title">💧 Fluid Surface</div>
          <div class="hud-row">
            <label for="selFluid">Liquid Preset</label>
            <select id="selFluid">${options}</select>
          </div>
        </div>
      `,
    });
    this._mood = this._drawer.query<HTMLInputElement>("#swMood")!;
    this._puddle = this._drawer.query<HTMLInputElement>("#swPuddle")!;
    this._fluid = this._drawer.query<HTMLSelectElement>("#selFluid")!;

    this._mood.addEventListener("change", () => callbacks.onNight(this._mood.checked));
    this._puddle.addEventListener("change", () => callbacks.onPuddleCamera(this._puddle.checked));
    this._fluid.addEventListener("change", () =>
      callbacks.onFluid(parseInt(this._fluid.value, 10)),
    );
  }

  /** Reflects the scene state in every control. */
  public sync(state: HudState): void {
    this._mood.checked = state.night;
    this._puddle.checked = state.puddleCamera;
    this._fluid.value = String(state.fluidIndex);
  }

  /** Handles the I / H panel shortcut. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public dispose(): void {
    this._drawer.dispose();
  }
}
