/**
 * Room lighting state of showcase 37: dimmable light groups, candles that can be blown out, the
 * hearth fire's strength, and the named lighting scenes (Hue-style presets) that set them all.
 */

/** Number of candles on the coffee-table tray (`Candle_0..2`). */
export const CANDLE_COUNT = 3;

/**
 * Fire strength at which the hearth looks exactly as authored (flame size, light, glow, colour).
 * The strength mapping in {@link fireStrengthParams} is anchored so this value yields factors of 1.
 */
export const DEFAULT_FIRE_STRENGTH = 0.6;

export interface RoomLightState {
  /** Pendant (hero spot + ceiling fill + shade emission) dimmer 0..1; 0 = off. */
  pendant: number;
  /** Floor lamp (accent light + shade emission) dimmer 0..1; 0 = off. */
  floorLamp: number;
  /** Hearth fire 0 (embers only) .. 1 (roaring). */
  fire: number;
  /** Per-candle flame state. */
  candles: boolean[];
}

export type LightSceneId = "evening" | "fireside" | "reading" | "night";

export interface LightScene {
  readonly id: LightSceneId;
  readonly label: string;
  readonly state: Readonly<Omit<RoomLightState, "candles">> & { readonly candles: boolean };
}

/** Presets in hotkey order (Shift+1..4). */
export const LIGHT_SCENES: readonly LightScene[] = [
  {
    id: "evening",
    label: "Abend",
    state: { pendant: 1, floorLamp: 1, fire: DEFAULT_FIRE_STRENGTH, candles: true },
  },
  {
    id: "fireside",
    label: "Kaminabend",
    state: { pendant: 0, floorLamp: 0, fire: 0.85, candles: true },
  },
  {
    id: "reading",
    label: "Lesen",
    state: { pendant: 0.35, floorLamp: 1, fire: 0.35, candles: false },
  },
  { id: "night", label: "Nacht", state: { pendant: 0, floorLamp: 0, fire: 0, candles: false } },
];

/** Default state = the "evening" scene (the room exactly as authored). */
export function defaultLightState(): RoomLightState {
  return sceneToState(LIGHT_SCENES[0]!);
}

export function sceneToState(scene: LightScene): RoomLightState {
  const { pendant, floorLamp, fire, candles } = scene.state;
  return { pendant, floorLamp, fire, candles: Array.from({ length: CANDLE_COUNT }, () => candles) };
}

export interface FireStrengthParams {
  /** Uniform scale of the flame/glow root (flame height). */
  scale: number;
  /** Multiplier on the authored flame emission. */
  flame: number;
  /** Multiplier on the authored glow emission. */
  glow: number;
  /** Multiplier on the authored light base intensity. */
  light: number;
  /** Blackbody temperature of the fire light in Kelvin (cooler as it burns down). */
  temperatureK: number;
  /** Flame cards visible (false = only the ember bed glows). */
  flameOn: boolean;
  /** Ember sparks spawning. */
  embersOn: boolean;
}

/**
 * Maps the fire strength 0..1 onto the prefab knobs. All factors are 1 at {@link DEFAULT_FIRE_STRENGTH}
 * (and the temperature is the authored 1950 K), so the default room is unchanged.
 * @param s Fire strength, clamped to 0..1.
 */
export function fireStrengthParams(s: number): FireStrengthParams {
  const t = Math.min(1, Math.max(0, s));
  const d = DEFAULT_FIRE_STRENGTH;
  // Linear ramps through (d, 1): flame grows from 55 % to 130 % of its authored size.
  const ramp = (atZero: number): number => atZero + ((1 - atZero) / d) * t;
  return {
    scale: ramp(0.55),
    flame: ramp(0.55),
    glow: ramp(0.35),
    light: ramp(0.25),
    temperatureK: 1600 + ((1950 - 1600) / d) * t,
    flameOn: t > 0.05,
    embersOn: t > 0.25,
  };
}
