import type { LightOptions } from "./AbstractLight.js";
import { AbstractLight } from "./AbstractLight.js";
import { Color } from "../colors/index.js";
import { LightType } from "../../enums/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { InspectorField } from "../Inspectable.js";

/**
 * Configuration options for a {@link HemisphereLight}.
 */
export interface HemisphereLightOptions extends LightOptions {
  /** Sky (upper hemisphere, +Y) sRGB color. Overrides `color` if both are supplied. */
  skyColor?: Color;
  /** Ground (lower hemisphere, -Y) sRGB color. Defaults to muted mid-grey (0.25, 0.25, 0.25). */
  groundColor?: Color;
}

/**
 * Hemisphere light casting a smooth sky-to-ground gradient (`mix(groundColor, skyColor, N.y * 0.5 + 0.5)`)
 * across the scene's world up axis (+Y). Accumulates additively with {@link AmbientLight}s.
 */
export class HemisphereLight extends AbstractLight {
  /** Inspector fields extending `AbstractLight.inspector` with `groundColor`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    ...AbstractLight.inspector,
    groundColor: { type: "color", label: "Ground Color" },
  };

  /** @inheritdoc */
  public override readonly type: LightType = LightType.HEMISPHERE;

  /**
   * @domain sRGB ground-hemisphere color [0..1] (ADR 0049), emitted from -Y.
   */
  public groundColor: Color;

  // `linearGroundColor` cache: recomputed only when `groundColor` changed since the last read (zero-GC).
  private readonly _linearGroundColor: Color = new Color(0, 0, 0, 1);
  private readonly _linearGroundSource: Color = new Color(NaN, NaN, NaN, NaN);

  /**
   * @domain sRGB sky-hemisphere color [0..1] (aliases `Light.color`, emitted from +Y).
   */
  public get skyColor(): Color {
    return this.color;
  }

  public set skyColor(value: Color) {
    this.color = value;
  }

  /**
   * @derived Linear-space ground radiance decoded from sRGB `groundColor` (ADR 0049).
   */
  public get linearGroundColor(): Color {
    const c = this.groundColor;
    const s = this._linearGroundSource;
    if (c.r !== s.r || c.g !== s.g || c.b !== s.b || c.a !== s.a) {
      s.copyFrom(c);
      c.toLinear(this._linearGroundColor);
    }
    return this._linearGroundColor;
  }

  /**
   * Creates a new HemisphereLight.
   * @param options The configuration options for the light.
   */
  constructor(options: HemisphereLightOptions = {}) {
    const {
      name = "HemisphereLight",
      skyColor,
      groundColor = new Color(0.25, 0.25, 0.25, 1),
    } = options;
    super({
      ...options,
      name,
      color: skyColor ?? options.color ?? new Color(1, 1, 1, 1),
    });
    this.groundColor = Object.isFrozen(groundColor) ? groundColor.clone() : groundColor;
  }

  /** @inheritdoc */
  public override applyTo(data: LightDataInterface): void {
    const sky = this.linearColor;
    const ground = this.linearGroundColor;
    const k = this.intensity;
    data.aCol.set(data.aCol.r + sky.r * k, data.aCol.g + sky.g * k, data.aCol.b + sky.b * k, 1);
    if (data.aGroundCol) {
      data.aGroundCol.set(
        data.aGroundCol.r + ground.r * k,
        data.aGroundCol.g + ground.g * k,
        data.aGroundCol.b + ground.b * k,
        1,
      );
    }
    data.aIntensity = 1;
  }
}
