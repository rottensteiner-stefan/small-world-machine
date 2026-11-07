import type { InspectorField } from "./Behavior.js";
import { Behavior } from "./Behavior.js";
import type { Object3D } from "../index.js";
import { Noise } from "../../utils/index.js";
import { MathUtils } from "../../math/index.js";

/**
 * Configuration options for the FlickerBehavior.
 */
export interface FlickerBehaviorOptions {
  /** Minimum duration of the stable (fully on) phase in seconds. Defaults to 2.0. */
  minStableTime?: number;
  /** Maximum duration of the stable phase in seconds. Defaults to 6.0. */
  maxStableTime?: number;
  /** Minimum duration of the flickering phase in seconds. Defaults to 0.2. */
  minFlickerTime?: number;
  /** Maximum duration of the flickering phase in seconds. Defaults to 1.5. */
  maxFlickerTime?: number;
  /** The lowest the multiplier can drop during flickering. Defaults to 0.0. */
  minMultiplier?: number;
  /**
   * How smooth the transitions are. 0 = instant cuts (like broken electronics),
   * 1 = smooth sine-like organic transitions. Defaults to 0.0.
   */
  smoothness?: number;
  /**
   * Speed/frequency factor of the continuous noise flicker. Defaults to 15.0.
   */
  frequency?: number;
  /**
   * Spatial/noise seed offset ensuring multiple flicker behaviors don't pulse synchronously.
   */
  noiseOffset?: number;
  /** The callback that applies the flicker multiplier (0.0 to 1.0). */
  onUpdate: (multiplier: number, targetObj: Object3D) => void;
}

/**
 * A generalized behavior that encapsulates a flickering/glitching value (e.g. for broken lights, sparks, UI glitches).
 * It calculates a multiplier (0.0 to 1.0) and passes it to the `onUpdate` callback.
 */
export class FlickerBehavior extends Behavior {
  public static override readonly inspector: Record<string, InspectorField> = {
    minStableTime: {
      type: "number",
      min: 0.1,
      max: 10,
      step: 0.1,
      label: "Min Stable Time",
      path: "options.minStableTime",
    },
    maxStableTime: {
      type: "number",
      min: 0.1,
      max: 20,
      step: 0.1,
      label: "Max Stable Time",
      path: "options.maxStableTime",
    },
    minFlickerTime: {
      type: "number",
      min: 0.05,
      max: 5,
      step: 0.05,
      label: "Min Flicker Time",
      path: "options.minFlickerTime",
    },
    maxFlickerTime: {
      type: "number",
      min: 0.05,
      max: 10,
      step: 0.05,
      label: "Max Flicker Time",
      path: "options.maxFlickerTime",
    },
    minMultiplier: {
      type: "number",
      min: 0.0,
      max: 1.0,
      step: 0.05,
      label: "Min Multiplier",
      path: "options.minMultiplier",
    },
    smoothness: {
      type: "number",
      min: 0.0,
      max: 1.0,
      step: 0.05,
      label: "Smoothness",
      path: "options.smoothness",
    },
    frequency: {
      type: "number",
      min: 1.0,
      max: 60.0,
      step: 1.0,
      label: "Frequency",
      path: "options.frequency",
    },
  };

  public options: Required<FlickerBehaviorOptions>;

  private _timeAcc: number = 0;
  private _flickerTimer: number = 0;
  private _isFlickering: boolean = false;
  private _targetMultiplier: number = 1.0;
  private _currentMultiplier: number = 1.0;

  /**
   * Creates a new FlickerBehavior.
   * @param options Configuration options.
   */
  constructor(options: FlickerBehaviorOptions) {
    super();

    this.options = {
      minStableTime: options.minStableTime ?? 2.0,
      maxStableTime: options.maxStableTime ?? 6.0,
      minFlickerTime: options.minFlickerTime ?? 0.2,
      maxFlickerTime: options.maxFlickerTime ?? 1.5,
      minMultiplier: options.minMultiplier ?? 0.0,
      smoothness: MathUtils.clamp(options.smoothness ?? 0.0, 0, 1),
      frequency: options.frequency ?? 15.0,
      noiseOffset: options.noiseOffset ?? Math.random() * 10000.0,
      onUpdate: options.onUpdate,
    };

    this._timeAcc = Math.random() * 1000.0;
    this._flickerTimer = Math.random() * (this.options.minStableTime + this.options.minFlickerTime);
    this._isFlickering = Math.random() > 0.5;
  }

  public override update(deltaTime: number): void {
    if (!this.target) return;

    this._timeAcc += deltaTime;
    this._flickerTimer -= deltaTime;

    // 1. Phase Management: Swap between stable and flickering
    if (this._flickerTimer <= 0) {
      if (this._isFlickering) {
        this._isFlickering = false;
        const range = this.options.maxStableTime - this.options.minStableTime;
        this._flickerTimer = this.options.minStableTime + Math.random() * range;
        this._targetMultiplier = 1.0;
      } else {
        this._isFlickering = true;
        const range = this.options.maxFlickerTime - this.options.minFlickerTime;
        this._flickerTimer = this.options.minFlickerTime + Math.random() * range;
      }
    }

    // 2. Determine target multiplier based on the current phase
    if (this._isFlickering) {
      if (this.options.smoothness > 0.0) {
        const n = Noise.simplex2(this._timeAcc * this.options.frequency, this.options.noiseOffset);
        const normalized = (n + 1) / 2;
        this._targetMultiplier =
          this.options.minMultiplier + normalized * (1.0 - this.options.minMultiplier);
      } else {
        if (Math.random() > 0.6) {
          const rand = Math.random();
          if (rand > 0.8) {
            this._targetMultiplier = this.options.minMultiplier;
          } else if (rand > 0.5) {
            this._targetMultiplier =
              this.options.minMultiplier + Math.random() * (1.0 - this.options.minMultiplier);
          } else {
            this._targetMultiplier = 1.0;
          }
        }
      }
    } else {
      this._targetMultiplier = 1.0;
    }

    // 3. Apply smoothness (Lerp)
    if (this.options.smoothness > 0) {
      const lerpSpeed = 30.0 * (1.0 - this.options.smoothness) + 2.0;
      this._currentMultiplier +=
        (this._targetMultiplier - this._currentMultiplier) * Math.min(deltaTime * lerpSpeed, 1.0);
    } else {
      this._currentMultiplier = this._targetMultiplier;
    }

    // 4. Pass the calculated multiplier to the callback
    this.options.onUpdate(this._currentMultiplier, this.target as Object3D);
  }
}
