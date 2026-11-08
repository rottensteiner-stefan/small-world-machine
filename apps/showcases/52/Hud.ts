import { hudNote, hudSection, ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";

export type LookKey = "NEUTRAL" | "SUNNY_MEADOW" | "FOREST_SHADE" | "OVERCAST";
export type SunKey = "noon" | "backlight" | "overcast";

export const LOOK_KEYS: readonly LookKey[] = [
  "NEUTRAL",
  "SUNNY_MEADOW",
  "FOREST_SHADE",
  "OVERCAST",
];
export const SUN_KEYS: readonly SunKey[] = ["noon", "backlight", "overcast"];

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface LookLabState {
  look: LookKey;
  sun: SunKey;
  /** True while B holds the neutral reference instead of the selected look. */
  abReference: boolean;
}

/** Showcase actions the panel triggers. */
export interface LookLabActions {
  setLook(look: LookKey): void;
  setSun(sun: SunKey): void;
  toggleReference(): void;
  resetView(): void;
}

const LOOK_LABELS: Record<LookKey, string> = {
  NEUTRAL: "Neutral",
  SUNNY_MEADOW: "Sunny Meadow",
  FOREST_SHADE: "Forest Shade",
  OVERCAST: "Overcast",
};

const SUN_LABELS: Record<SunKey, string> = {
  noon: "High Sun",
  backlight: "Low Backlight",
  overcast: "Overcast Sky",
};

/** Foliage Look Lab panel of showcase 52 on the shared {@link ShowcaseDrawer}. */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _readout: HTMLElement;
  private _hovering: boolean = false;

  constructor(
    engine: FrameTelemetrySource,
    private readonly _actions: LookLabActions,
  ) {
    const lookButtons = LOOK_KEYS.map(
      (key, i) =>
        `<button id="btnLook_${key}" class="btn-preset" title="Key ${i + 1}">${LOOK_LABELS[key]}</button>`,
    ).join("");
    const sunButtons = SUN_KEYS.map(
      (key) =>
        `<button id="btnSun_${key}" class="btn-preset" title="Key L cycles">${SUN_LABELS[key]}</button>`,
    ).join("");

    this._drawer = new ShowcaseDrawer({
      id: "look-lab-hud",
      title: "Foliage Look Lab",
      icon: "🌿",
      open: true,
      footerIcon: "⚙",
      buttonId: "lookLabInspectorBtn",
      engine,
      body: `
        ${hudSection(
          "🎨 Look Preset",
          "1–4 · B = A/B",
          `<div class="preset-group two-col" style="margin-bottom:6px;">${lookButtons}</div>
          <div class="preset-group two-col">
            <button id="btnReference" class="btn-preset" title="Key B: hold the neutral engine default for comparison">A/B Reference</button>
          </div>`,
        )}
        ${hudSection(
          "☀ Sun Situation",
          "L cycles",
          `<div class="preset-group two-col">${sunButtons}</div>`,
        )}
        ${hudSection(
          "🔭 View",
          "Orbit · R reset",
          `<div class="preset-group two-col"><button id="btnResetView" class="btn-preset">Reset View</button></div>`,
        )}
        ${hudSection("📊 Active Look", "live", `<pre id="lookLabReadout" style="font:10px/1.45 var(--font-mono, monospace);color:#a5f3fc;background:rgba(2,6,23,0.65);border:1px solid rgba(56,189,248,0.2);border-radius:6px;padding:7px 9px;margin:8px 0 0;white-space:pre;"></pre>`)}
        ${hudNote(
          "💡 Presets live in <code>@small-world-machine/vegetation-extras</code> (<code>FOLIAGE_LOOKS</code>, <code>applyFoliageLook</code>). AgX keeps sunlit leaves and sky from clipping; the grade restores the saturation AgX removes.",
        )}
      `,
    });
    this._readout = this._drawer.query<HTMLElement>("#lookLabReadout")!;
    this._bind();
  }

  public get isHovering(): boolean {
    return this._hovering && this._drawer.isOpen;
  }

  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public dispose(): void {
    this._drawer.dispose();
  }

  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  public sync(state: LookLabState): void {
    const d = this._drawer;
    for (const key of LOOK_KEYS) {
      d.query<HTMLButtonElement>(`#btnLook_${key}`)?.classList.toggle("active", key === state.look);
    }
    for (const key of SUN_KEYS) {
      d.query<HTMLButtonElement>(`#btnSun_${key}`)?.classList.toggle("active", key === state.sun);
    }
    d.query<HTMLButtonElement>("#btnReference")?.classList.toggle("active", state.abReference);
  }

  private _bind(): void {
    const a = this._actions;
    const d = this._drawer;
    d.root.addEventListener("pointerenter", () => {
      this._hovering = true;
    });
    d.root.addEventListener("pointerleave", () => {
      this._hovering = false;
    });
    for (const key of LOOK_KEYS) {
      d.query(`#btnLook_${key}`)?.addEventListener("click", () => a.setLook(key));
    }
    for (const key of SUN_KEYS) {
      d.query(`#btnSun_${key}`)?.addEventListener("click", () => a.setSun(key));
    }
    d.query("#btnReference")?.addEventListener("click", () => a.toggleReference());
    d.query("#btnResetView")?.addEventListener("click", () => a.resetView());
  }
}
