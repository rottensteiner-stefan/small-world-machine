import { hudNote, hudSection, hudSlider, ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import type { FrameTelemetrySource } from "../shared/ShowcaseDrawer.js";
import { bindRange } from "../shared/hudBindings.js";
import { CANDLE_COUNT, LIGHT_SCENES } from "./lighting.js";
import type { LightSceneId, RoomLightState } from "./lighting.js";

/** Showcase actions the lighting panel triggers. */
export interface RoomLightActions {
  setPendant(value: number): void;
  setFloorLamp(value: number): void;
  setFire(value: number): void;
  blowOutCandle(): void;
  lightCandles(): void;
  applyScene(id: LightSceneId): void;
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const fireLabel = (v: number): string =>
  v <= 0.05 ? "Glut" : v < 0.35 ? "schwach" : v < 0.75 ? "ruhig" : "lodernd";

/**
 * "Room Lights" panel of showcase 37 on the shared {@link ShowcaseDrawer}: dimmers per light group,
 * candle controls, the hearth strength and the lighting scenes. Owns only the controls.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(
    engine: FrameTelemetrySource,
    private readonly _actions: RoomLightActions,
  ) {
    const sceneButtons = LIGHT_SCENES.map(
      (s, i) =>
        `<button class="btn-preset" data-scene="${s.id}" title="Shift+${i + 1}">${s.label}</button>`,
    ).join("");
    this._drawer = new ShowcaseDrawer({
      id: "swm37-room-hud",
      title: "Room Lights",
      icon: "💡",
      open: false,
      footerIcon: "⚙",
      buttonId: "swm37RoomHudBtn",
      engine,
      body: `
        ${hudSection(
          "🎬 Licht-Szenen",
          "Shift+1…4",
          `<div class="preset-group two-col" id="swm37Scenes">${sceneButtons}</div>`,
        )}
        ${hudSection(
          "💡 Lichtgruppen",
          "1 · 2 · 4 an/aus",
          `${hudSlider("swm37Pendant", "Pendel (1)", 0, 1, 0.05)}
           ${hudSlider("swm37FloorLamp", "Stehlampe (2)", 0, 1, 0.05)}
           ${hudSlider("swm37Fire", "Kamin (4)", 0, 1, 0.05)}`,
        )}
        ${hudSection(
          "🕯 Kerzen",
          "3",
          `<div class="preset-group two-col">
            <button id="swm37BlowOut" class="btn-preset" title="Next lit candle (3)">Auspusten</button>
            <button id="swm37LightAll" class="btn-preset" title="Light every candle (3 when all are out)">Light all</button>
          </div>
          <div class="hud-row"><label>Brennend</label><span id="swm37CandleCount" class="val-label"></span></div>`,
        )}
        ${hudNote(
          "Fireplace: <b>[</b> / <b>]</b> like brush size — from embers to a blazing fire. Size, light, color temperature, and sparks follow the strength; at 0 only the ember bed glows. Blown-out candles leave a wisp of smoke.",
        )}
      `,
    });
    this._bind();
  }

  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public dispose(): void {
    this._drawer.dispose();
  }

  /** Mirrors the live state into the controls (after keys or scenes changed it). */
  public sync(state: RoomLightState): void {
    this._setSlider("swm37Pendant", state.pendant, pct);
    this._setSlider("swm37FloorLamp", state.floorLamp, pct);
    this._setSlider("swm37Fire", state.fire, fireLabel);
    const lit = state.candles.filter(Boolean).length;
    const count = this._drawer.query<HTMLElement>("#swm37CandleCount");
    if (count) count.textContent = `${lit} / ${CANDLE_COUNT}`;
  }

  private _setSlider(id: string, value: number, format: (v: number) => string): void {
    const input = this._drawer.query<HTMLInputElement>(`#${id}`);
    if (input && parseFloat(input.value) !== value) input.value = String(value);
    const label = this._drawer.query<HTMLElement>(`#${id}_val`);
    if (label) label.textContent = format(value);
  }

  private _bind(): void {
    const a = this._actions;
    const d = this._drawer;
    const q = <T extends HTMLElement>(sel: string): T | null => d.query<T>(sel);
    bindRange(q<HTMLInputElement>("#swm37Pendant"), q("#swm37Pendant_val"), pct, (v) =>
      a.setPendant(v),
    );
    bindRange(q<HTMLInputElement>("#swm37FloorLamp"), q("#swm37FloorLamp_val"), pct, (v) =>
      a.setFloorLamp(v),
    );
    bindRange(q<HTMLInputElement>("#swm37Fire"), q("#swm37Fire_val"), fireLabel, (v) =>
      a.setFire(v),
    );
    q("#swm37BlowOut")?.addEventListener("click", () => a.blowOutCandle());
    q("#swm37LightAll")?.addEventListener("click", () => a.lightCandles());
    q("#swm37Scenes")?.addEventListener("click", (e: Event) => {
      const id = (e.target as HTMLElement).dataset["scene"] as LightSceneId | undefined;
      if (id) a.applyScene(id);
    });
  }
}
