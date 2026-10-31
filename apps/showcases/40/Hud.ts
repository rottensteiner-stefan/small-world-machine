import {
  ShowcaseDrawer,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";

/** Sliders the panel exposes; values are clamped and applied by the showcase. */
export type DecalLabSlider =
  "Sun" | "Ambient" | "Opacity" | "EdgeFade" | "HbaoRadius" | "HbaoIntensity";

/** Floor normal-map mode: 0 = none, 1 = constant tilt, 2 = stripe pattern (`?bump`). */
export type BumpLevel = 0 | 1 | 2;

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface HudState {
  sun: number;
  ambient: number;
  bumpLevel: BumpLevel;
  opacity: number;
  edgeFade: number;
  unlit: boolean;
  hbaoOn: boolean;
  hbaoRadius: number;
  hbaoIntensity: number;
}

/** Showcase actions the panel triggers; the showcase calls `sync` afterwards. */
export interface HudActions {
  setSlider(name: DecalLabSlider, value: number): void;
  setBumpLevel(level: BumpLevel): void;
  toggleUnlit(): void;
  toggleHbao(): void;
  resetToReference(): void;
}

const SLIDERS: readonly { name: DecalLabSlider; id: string }[] = [
  { name: "Sun", id: "st40SlSun" },
  { name: "Ambient", id: "st40SlAmbient" },
  { name: "Opacity", id: "st40SlOpacity" },
  { name: "EdgeFade", id: "st40SlEdgeFade" },
  { name: "HbaoRadius", id: "st40SlHbaoRadius" },
  { name: "HbaoIntensity", id: "st40SlHbaoIntensity" },
];

const BUMP_LABELS = ["None", "Tilt", "Stripes"] as const;

/**
 * Decal Probe Lab panel of showcase 40 on the shared {@link ShowcaseDrawer}. Owns only its
 * controls; decal, floor, light and post state stay in the showcase (query-param contract intact).
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(private readonly _actions: HudActions) {
    const bumpButtons = BUMP_LABELS.map(
      (label, i) =>
        `<button id="st40BtnBump${i}" class="btn-preset" title="${label} floor normal map (Key ${i + 1})">${i + 1} · ${label}</button>`,
    ).join("");

    this._drawer = new ShowcaseDrawer({
      id: "showcase-hud",
      title: "Decal Probe Lab",
      icon: "🏷",
      footerIcon: "⚙",
      body: `
        ${hudSection(
          "☀️ Lighting",
          "Live",
          hudSlider("st40SlSun", "Sun intensity", 0, 2, 0.01) +
            hudSlider("st40SlAmbient", "Ambient", 0, 1, 0.01),
        )}
        ${hudSection(
          "🧱 Floor Surface",
          "Keys 1–3",
          `<div class="preset-group three-col" style="margin-bottom:8px;">${bumpButtons}</div>` +
            hudNote(
              `💡 <b>Bump maps tilt the floor's shading normal.</b> Decals blend into the normal buffer — watch the probes react on the tilted surface.`,
            ),
        )}
        ${hudSection(
          "🏷 Probe Decals",
          "U = unlit",
          hudSlider("st40SlOpacity", "Normal-probe opacity", 0, 1, 0.01) +
            hudSlider("st40SlEdgeFade", "Normal-probe edge fade", 0, 0.5, 0.01) +
            hudSwitch("st40SwUnlit", "Render decals unlit") +
            hudNote(
              `💡 <b>Unlit</b> skips the light loop and draws flat albedo. Lit decals read the scene light AND the normal buffer beneath — opacity blends both.`,
            ),
        )}
        ${hudSection(
          "🌑 HBAO",
          "Post",
          hudSwitch("st40SwHbao", "HBAO (ambient occlusion)") +
            hudSlider("st40SlHbaoRadius", "HBAO radius", 0, 2, 0.05) +
            hudSlider("st40SlHbaoIntensity", "HBAO intensity", 0, 3, 0.05) +
            hudNote(
              `💡 Ambient occlusion only reacts to real geometry. Post-processing stays clean here: tone mapping + HBAO only.`,
            ),
        )}
        <div class="hud-section">
          <button id="st40BtnReset" class="btn-preset" style="width:100%;" title="Golden reference state (Key 0)">0 · Reset to Reference</button>
        </div>
        <div class="hud-section hud-keys">
          <kbd>Drag</kbd> orbit · <kbd>Wheel</kbd> zoom · <kbd>R</kbd> camera reset · <kbd>0</kbd> reference · <kbd>I</kbd> panel
        </div>
      `,
    });
    this._bind();
  }

  /** Handles the I / H panel toggle. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Pushes the current state into the controls; event-driven only, never per frame. */
  public sync(state: HudState): void {
    for (let i = 0; i < BUMP_LABELS.length; i++) {
      this._drawer.query(`#st40BtnBump${i}`)?.classList.toggle("active", i === state.bumpLevel);
    }
    this._setSliderValue("st40SlSun", state.sun, 2);
    this._setSliderValue("st40SlAmbient", state.ambient, 2);
    this._setSliderValue("st40SlOpacity", state.opacity, 2);
    this._setSliderValue("st40SlEdgeFade", state.edgeFade, 2);
    this._setSliderValue("st40SlHbaoRadius", state.hbaoRadius, 2);
    this._setSliderValue("st40SlHbaoIntensity", state.hbaoIntensity, 2);
    const unlit = this._drawer.query<HTMLInputElement>("#st40SwUnlit");
    if (unlit) unlit.checked = state.unlit;
    const hbao = this._drawer.query<HTMLInputElement>("#st40SwHbao");
    if (hbao) hbao.checked = state.hbaoOn;
  }

  /** Removes panel, footer button and the panel's style. */
  public dispose(): void {
    this._drawer.dispose();
  }

  private _setSliderValue(id: string, value: number, decimals: number): void {
    const slider = this._drawer.query<HTMLInputElement>(`#${id}`);
    const label = this._drawer.query(`#${id}_val`);
    if (slider) slider.value = String(value);
    if (label) label.textContent = value.toFixed(decimals);
  }

  private _bind(): void {
    const a = this._actions;
    const d = this._drawer;
    for (let i = 0; i < BUMP_LABELS.length; i++) {
      d.query(`#st40BtnBump${i}`)?.addEventListener("click", () => a.setBumpLevel(i as BumpLevel));
    }
    d.query("#st40BtnReset")?.addEventListener("click", () => a.resetToReference());
    for (const slider of SLIDERS) {
      const el = d.query<HTMLInputElement>(`#${slider.id}`);
      if (!el) continue;
      el.addEventListener("input", () => a.setSlider(slider.name, parseFloat(el.value)));
      // Hand keyboard focus back to the shortcuts once the drag ends.
      el.addEventListener("change", () => el.blur());
    }
    d.query<HTMLInputElement>("#st40SwUnlit")?.addEventListener("change", () => a.toggleUnlit());
    d.query<HTMLInputElement>("#st40SwHbao")?.addEventListener("change", () => a.toggleHbao());
  }
}
