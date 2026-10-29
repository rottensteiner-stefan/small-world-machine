import type { CameraInterfaceData, Object3D, PointLight } from "@small-world-machine/engine";
import { Behavior, Color, Vector3D } from "@small-world-machine/engine";
import { FireFlickerProfile } from "./FireFlickerProfile.js";

/** Light temperature at the profile's peak / trough, relative to the base temperature. */
const HOT_TEMPERATURE_RATIO = 1.08;
const COOL_TEMPERATURE_RATIO = 0.86;
/** Wander speed of the position jitter in Hz; slower than the flicker so shadows sway, not shake. */
const JITTER_FREQ = 2.3;

/**
 * Configuration options for {@link FireLightBehavior}.
 */
export interface FireLightBehaviorOptions {
  /** Intensity at multiplier 1. Defaults to the light's intensity when attached. */
  baseIntensity?: number | undefined;
  /** Base colour temperature in Kelvin; the light colour then follows the flicker. Leave unset for
   * palette (non-blackbody) fire to keep the light's own colour. */
  temperatureK?: number | undefined;
  /** Horizontal position jitter radius in meters. Defaults to 0.015 (torch). */
  jitter?: number | undefined;
  /** Noise seed; give every fire its own. Defaults to 0. */
  seed?: number | undefined;
}

/**
 * Drives a `PointLight` like a real flame: continuous {@link FireFlickerProfile} brightness, colour
 * temperature that cools as the flame dims, and a few centimetres of positional sway so lit
 * surfaces and specular highlights breathe. Attach it to the light itself. Zero allocations per
 * frame.
 */
export class FireLightBehavior extends Behavior<Object3D> {
  /** @domain intensity at multiplier 1 (>=0). */
  public baseIntensity: number;
  /** @domain base colour temperature in Kelvin; undefined = light colour is left untouched. */
  public temperatureK: number | undefined;
  /** @domain horizontal jitter radius in meters (>=0); vertical sway is a third of it. */
  public jitter: number;
  /** @domain light position before jitter, captured on attach (local space of the light's parent). */
  public readonly basePosition: Vector3D = new Vector3D(0, 0, 0);
  /** @domain elapsed flame time in seconds; set it and deactivate the behavior to freeze a frame. */
  public time: number = 0;
  /** @derived 0..1 visibility weight written by `FireLightBudget`; 1 when no budget is used. */
  public fade: number = 1;
  /** @domain flicker depth 0..1; 0 = steady light at base intensity and position (A/B comparison). */
  public flicker: number = 1;
  /** @derived current flicker multiplier; read it to sync flame and glow intensity. */
  public value: number = 1;

  private readonly _profile: FireFlickerProfile;
  private _hasBaseIntensity: boolean;

  constructor(options: FireLightBehaviorOptions = {}) {
    super();
    this.baseIntensity = options.baseIntensity ?? 0;
    this._hasBaseIntensity = options.baseIntensity !== undefined;
    this.temperatureK = options.temperatureK;
    this.jitter = options.jitter ?? 0.015;
    this._profile = new FireFlickerProfile(options.seed ?? 0);
  }

  /** The light this behavior drives, or undefined while detached. */
  public get light(): PointLight | undefined {
    return this.target as PointLight | undefined;
  }

  /** @inheritdoc */
  public override onAttach(target: Object3D | CameraInterfaceData): void {
    super.onAttach(target);
    const light = this.target as PointLight;
    this.basePosition.copyFrom(light.position);
    if (!this._hasBaseIntensity) {
      this.baseIntensity = light.intensity;
      this._hasBaseIntensity = true;
    }
  }

  /** @inheritdoc */
  public update(deltaTime: number): void {
    this.time += deltaTime;
    this.apply();
  }

  /**
   * Writes the state at {@link time} to the light without advancing time (used for frozen frames).
   */
  public apply(): void {
    const light = this.target as PointLight | undefined;
    if (!light) {
      return;
    }

    const value = 1 + (this._profile.sample(this.time) - 1) * this.flicker;
    this.value = value;
    light.intensity = this.baseIntensity * value * this.fade;

    if (this.temperatureK !== undefined) {
      Color.fromTemperature(this.temperatureK * temperatureRatio(value), light.color);
    }

    const s = this.time * JITTER_FREQ;
    const j = this.jitter * this.flicker * 2;
    light.position.set(
      this.basePosition.x + (this._profile.noise(s, 3) - 0.5) * j,
      this.basePosition.y + (this._profile.noise(s, 4) - 0.5) * j * 0.33,
      this.basePosition.z + (this._profile.noise(s, 5) - 0.5) * j,
    );
  }
}

/** Piecewise linear so the base intensity (1) maps exactly to the base temperature. */
export function temperatureRatio(value: number): number {
  if (value < 1) {
    return 1 - ((1 - value) / (1 - FireFlickerProfile.MIN)) * (1 - COOL_TEMPERATURE_RATIO);
  }
  return 1 + ((value - 1) / (FireFlickerProfile.MAX - 1)) * (HOT_TEMPERATURE_RATIO - 1);
}
