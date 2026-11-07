import { Color } from "./colors/index.js";
import { FogMode } from "../enums/index.js";

export interface FogOptions {
  color?: Color;
  mode?: FogMode;
  density?: number;
  near?: number;
  far?: number;
  height?: number;
  heightFalloff?: number;
}

/**
 * Represents the global fog settings for a scene.
 */
export class Fog {
  /** The color of the fog. */
  public color: Color;
  /** The mathematical mode of the fog. */
  public mode: FogMode;
  /** The density of the fog (used for EXP and EXP2 modes). */
  public density: number;
  /** The starting distance of the fog (used for LINEAR mode). */
  public near: number;
  /** The ending distance where fog is 100% (used for LINEAR mode). */
  public far: number;
  /** The world-space Y coordinate where height fog starts. */
  public height: number;
  /** How quickly the fog density drops off above the fog height (0 = off). */
  public heightFalloff: number;

  constructor(options: FogOptions = {}) {
    this.color = options.color ?? new Color(0.5, 0.5, 0.5);
    this.mode = options.mode ?? FogMode.DEFAULT;
    this.density = options.density ?? 0.05;
    this.near = options.near ?? 1.0;
    this.far = options.far ?? 100.0;
    this.height = options.height ?? 0.0;
    this.heightFalloff = options.heightFalloff ?? 0.0;
  }
}
