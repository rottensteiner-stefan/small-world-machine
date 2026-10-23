export interface DayNightCycleOptions {
  /** Total seconds for a full 24h cycle. Default 120s (fast prototype cycle). */
  cycleDuration?: number;
  /** Initial normalized time in [0, 1). Default 0.2 (mid-morning). */
  initialTime?: number;
}

export interface SkyColor {
  r: number;
  g: number;
  b: number;
}

export type TimePhase = "sunrise" | "day" | "sunset" | "night";

/**
 * M4 Day/Night cycle controller.
 *
 * Drives time of day, sun vector, surface daylight multiplier (for shader uniform `u_daylight`),
 * and renderer clear color without modifying chunk mesh geometry (zero remesh overhead).
 *
 * Normalized time [0, 1):
 *   0.00: Sunrise (sun rises on horizon)
 *   0.25: Noon (sun at zenith)
 *   0.50: Sunset (sun sets on horizon)
 *   0.75: Midnight (deep night)
 */
export class DayNightCycle {
  private _time: number;
  private readonly _cycleDuration: number;

  constructor(options?: DayNightCycleOptions) {
    this._cycleDuration = options?.cycleDuration ?? 120;
    const initial = options?.initialTime ?? 0.2;
    this._time = ((initial % 1) + 1) % 1;
  }

  /** Current normalized time in [0, 1). */
  public get time(): number {
    return this._time;
  }

  public setTime(t: number): void {
    this._time = ((t % 1) + 1) % 1;
  }

  /** Progresses time by `deltaTime` seconds. */
  public update(deltaTime: number): void {
    if (this._cycleDuration <= 0) return;
    this._time = (this._time + deltaTime / this._cycleDuration) % 1;
  }

  /**
   * Sun elevation factor in [-1, 1].
   * 1.0 at noon, 0.0 at sunrise/sunset, -1.0 at midnight.
   */
  public getSunElevation(): number {
    return Math.sin(this._time * 2 * Math.PI);
  }

  /**
   * Daylight multiplier in [0.15, 1.0].
   * Ramps smoothly from night floor (0.15) to full noon sunlight (1.0).
   */
  public getDaylight(): number {
    const elevation = this.getSunElevation();
    if (elevation >= 0) {
      // Daytime: 0.15 + 0.85 * elevation
      return 0.15 + 0.85 * elevation;
    }
    // Nighttime twilight transition between 0 and -0.2
    if (elevation > -0.2) {
      const t = (elevation - -0.2) / 0.2; // 0 at -0.2, 1 at 0
      return 0.15 * t;
    }
    return 0.15;
  }

  /**
   * Normalized 3D directional vector of the sun for lighting shaders.
   */
  public getSunDirection(): [number, number, number] {
    const angle = this._time * 2 * Math.PI;
    const x = Math.cos(angle);
    // Keep positive Y component so light always shines slightly downwards or sideways
    const y = Math.max(0.12, Math.sin(angle));
    const z = 0.25;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }

  /**
   * Descriptive phase string for HUD.
   */
  public getTimePhase(): TimePhase {
    const t = this._time;
    if (t >= 0.95 || t < 0.08) return "sunrise";
    if (t >= 0.08 && t < 0.42) return "day";
    if (t >= 0.42 && t < 0.58) return "sunset";
    return "night";
  }

  /**
   * Interpolated sky color based on sun elevation.
   */
  public getSkyColor(): SkyColor {
    const elevation = this.getSunElevation();

    // Key sky palettes:
    // Day: bright Minecraft sky blue
    const daySky: SkyColor = { r: 0.45, g: 0.65, b: 0.95 };
    // Sunset / Sunrise: warm amber/orange
    const twilightSky: SkyColor = { r: 0.82, g: 0.42, b: 0.24 };
    // Night: deep dark navy
    const nightSky: SkyColor = { r: 0.03, g: 0.04, b: 0.08 };

    if (elevation > 0.2) {
      // Full day
      const t = Math.min(1, (elevation - 0.2) / 0.4);
      return lerpColor(twilightSky, daySky, t);
    } else if (elevation >= -0.1) {
      // Twilight (sunrise / sunset)
      const t = (elevation - -0.1) / 0.3; // 0 at -0.1, 1 at 0.2
      return lerpColor(nightSky, twilightSky, t);
    } else {
      // Full night
      return nightSky;
    }
  }
}

function lerpColor(a: SkyColor, b: SkyColor, t: number): SkyColor {
  const clampT = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * clampT,
    g: a.g + (b.g - a.g) * clampT,
    b: a.b + (b.b - a.b) * clampT,
  };
}
