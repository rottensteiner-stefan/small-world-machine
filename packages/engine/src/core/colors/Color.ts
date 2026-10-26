import { Vector3D } from "../../math/index.js";
import { COLOR_NAMES } from "./ColorNames.js";

export class Color {
  /**
   * Creates a new Color.
   * @param r Red component (0-1).
   * @param g Green component (0-1).
   * @param b Blue component (0-1).
   * @param a Alpha component (0-1).
   */
  constructor(
    public r: number = 0,
    public g: number = 0,
    public b: number = 0,
    public a: number = 1.0,
  ) {}

  private _cachedArray = new Float32Array(4);

  public set(r: number = 0, g: number = 0, b: number = 0, a: number = 1.0): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  public copyFrom(color: Color | Readonly<Color>): this {
    this.r = color.r;
    this.g = color.g;
    this.b = color.b;
    this.a = color.a;
    return this;
  }

  public clone(): Color {
    return new Color(this.r, this.g, this.b, this.a);
  }

  public lerp(target: Color | Readonly<Color>, t: number): this {
    this.r += (target.r - this.r) * t;
    this.g += (target.g - this.g) * t;
    this.b += (target.b - this.b) * t;
    this.a += (target.a - this.a) * t;
    return this;
  }

  /**
   * Every engine Color is sRGB-authored (ADR 0049, the Unity/Godot convention). This writes its
   * linear-light value into `out` -- the shaders' `sRGBToLinear`, pow 2.2 -- like Unity's
   * `Color.linear`. Alpha is copied unchanged; HDR components above 1 stay valid.
   */
  public toLinear(out: Color): Color {
    return this.toTarget(1.0, out);
  }

  /**
   * Writes this sRGB colour in the space a renderer's forward pass writes for output lane `gamma`
   * (`displayToTarget`, ADR 0049): linear while post-processing encodes (lane 1.0), unchanged when
   * the forward pass encodes with 2.2 itself.
   */
  public toTarget(gamma: number, out: Color): Color {
    const e = 2.2 / gamma;
    return out.set(
      Math.pow(Math.max(this.r, 0), e),
      Math.pow(Math.max(this.g, 0), e),
      Math.pow(Math.max(this.b, 0), e),
      this.a,
    );
  }

  // --- Core Frozen Base Colors (Zero-Allocation & Readonly) ---
  public static readonly BLACK: Color = Object.freeze(new Color(0, 0, 0, 1)) as Color;
  public static readonly WHITE: Color = Object.freeze(new Color(1, 1, 1, 1)) as Color;
  public static readonly RED: Color = Object.freeze(new Color(1, 0, 0, 1)) as Color;
  public static readonly GREEN: Color = Object.freeze(new Color(0, 0.502, 0, 1)) as Color;
  public static readonly BLUE: Color = Object.freeze(new Color(0, 0, 1, 1)) as Color;
  public static readonly YELLOW: Color = Object.freeze(new Color(1, 1, 0, 1)) as Color;
  public static readonly CYAN: Color = Object.freeze(new Color(0, 1, 1, 1)) as Color;
  public static readonly MAGENTA: Color = Object.freeze(new Color(1, 0, 1, 1)) as Color;
  public static readonly GRAY: Color = Object.freeze(new Color(0.5, 0.5, 0.5, 1)) as Color;
  public static readonly SILVER: Color = Object.freeze(new Color(0.753, 0.753, 0.753, 1)) as Color;
  public static readonly MAROON: Color = Object.freeze(new Color(0.502, 0, 0, 1)) as Color;
  public static readonly PURPLE: Color = Object.freeze(new Color(0.502, 0, 0.502, 1)) as Color;
  public static readonly FUCHSIA: Color = Object.freeze(new Color(1, 0, 1, 1)) as Color;
  public static readonly LIME: Color = Object.freeze(new Color(0, 1, 0, 1)) as Color;
  public static readonly OLIVE: Color = Object.freeze(new Color(0.502, 0.502, 0, 1)) as Color;
  public static readonly NAVY: Color = Object.freeze(new Color(0, 0, 0.502, 1)) as Color;
  public static readonly TEAL: Color = Object.freeze(new Color(0, 0.502, 0.502, 1)) as Color;
  public static readonly AQUA: Color = Object.freeze(new Color(0, 1, 1, 1)) as Color;
  public static readonly TRANSPARENT: Color = Object.freeze(new Color(0, 0, 0, 0)) as Color;

  /**
   * Creates a Color from a CSS/X11 named color (e.g. "papayawhip", "royalblue", "coral").
   */
  public static fromName(name: string): Color | undefined {
    const rgb = COLOR_NAMES[name.toLowerCase().trim()];
    if (!rgb) {
      return undefined;
    }
    return new Color(rgb[0], rgb[1], rgb[2], 1.0);
  }

  /**
   * Creates a Color from a hex string (e.g. "#FF0000" or "#F00").
   */
  public static fromHex(hex: string): Color {
    // Remove '#' if present
    hex = hex.replace(/^#/, "");

    let r = 0,
      g = 0,
      b = 0,
      a = 1.0;

    if (hex.length === 3) {
      r = parseInt((hex[0] || "0") + (hex[0] || "0"), 16) / 255 || 0;
      g = parseInt((hex[1] || "0") + (hex[1] || "0"), 16) / 255 || 0;
      b = parseInt((hex[2] || "0") + (hex[2] || "0"), 16) / 255 || 0;
    } else if (hex.length === 4) {
      r = parseInt((hex[0] || "0") + (hex[0] || "0"), 16) / 255 || 0;
      g = parseInt((hex[1] || "0") + (hex[1] || "0"), 16) / 255 || 0;
      b = parseInt((hex[2] || "0") + (hex[2] || "0"), 16) / 255 || 0;
      a = parseInt((hex[3] || "F") + (hex[3] || "F"), 16) / 255 || 1.0;
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16) / 255 || 0;
      g = parseInt(hex.substring(2, 4), 16) / 255 || 0;
      b = parseInt(hex.substring(4, 6), 16) / 255 || 0;
    } else if (hex.length === 8) {
      r = parseInt(hex.substring(0, 2), 16) / 255 || 0;
      g = parseInt(hex.substring(2, 4), 16) / 255 || 0;
      b = parseInt(hex.substring(4, 6), 16) / 255 || 0;
      a = parseInt(hex.substring(6, 8), 16) / 255 || 1.0;
    } else {
      console.warn(`[Color] Invalid hex color string: ${hex}`);
    }

    return new Color(r, g, b, a);
  }

  /**
   * Creates a Color from HSL (Hue, Saturation, Lightness).
   * @param h Hue (0 - 360).
   * @param s Saturation (0.0 - 1.0).
   * @param l Lightness (0.0 - 1.0).
   * @param a Alpha (0.0 - 1.0). Default is 1.0.
   */
  public static fromHSL(h: number, s: number, l: number, a: number = 1.0): Color {
    // Normalize h to 0-1
    h = (((h % 360) + 360) % 360) / 360;

    let r: number, g: number, b: number;

    if (s === 0) {
      r = g = b = l; // Achromatic
    } else {
      const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;

      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return new Color(r, g, b, a);
  }

  /**
   * Creates a Color from HSV/HSB (Hue, Saturation, Value/Brightness).
   * @param h Hue (0 - 360).
   * @param s Saturation (0.0 - 1.0).
   * @param v Value/Brightness (0.0 - 1.0).
   * @param a Alpha (0.0 - 1.0). Default is 1.0.
   */
  public static fromHSV(h: number, s: number, v: number, a: number = 1.0): Color {
    h = (((h % 360) + 360) % 360) / 360;

    let r = 0,
      g = 0,
      b = 0;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0:
        r = v;
        g = t;
        b = p;
        break;
      case 1:
        r = q;
        g = v;
        b = p;
        break;
      case 2:
        r = p;
        g = v;
        b = t;
        break;
      case 3:
        r = p;
        g = q;
        b = v;
        break;
      case 4:
        r = t;
        g = p;
        b = v;
        break;
      case 5:
        r = v;
        g = p;
        b = q;
        break;
    }

    return new Color(r, g, b, a);
  }

  /**
   * Evaluates a thermal blackbody radiation color ramp from normalized temperature t in [0, 1].
   * - 0.0: Deep dark red (0.6, 0.0, 0.0)
   * - 0.5: Hot fiery orange (1.0, 0.38, 0.0)
   * - 0.8: Golden yellow (1.0, 0.75, 0.33)
   * - 1.0: Blinding thermal white (1.0, 1.0, 1.0)
   *
   * @param t Normalized temperature in [0, 1] (clamped automatically).
   * @param target Optional existing Color instance to mutate (avoids GC allocations).
   */
  public static blackbody(t: number, target?: Color): Color {
    const validT = isNaN(t) ? 0 : t;
    const clampedT = Math.max(0, Math.min(1, validT));
    const r = Math.min(1.0, 0.6 + clampedT * 0.4);
    const g = Math.max(0, Math.min(1.0, (clampedT - 0.2) / 0.8));
    const b = Math.max(0, Math.min(1.0, (clampedT - 0.7) / 0.3));

    if (target) {
      return target.set(r, g, b, target.a);
    }
    return new Color(r, g, b, 1.0);
  }

  /**
   * Converts a color temperature in Kelvin (1000K to 40000K) to standard RGB color.
   * Based on Tanner Helland's analytic Planckian locus fit.
   *
   * @param kelvin Temperature in Kelvin (e.g. 1900 for candlelight, 5500 for midday sun, 10000 for blue sky).
   * @param target Optional existing Color instance to mutate (avoids GC allocations).
   */
  public static fromTemperature(kelvin: number, target?: Color): Color {
    const validKelvin = isNaN(kelvin) ? 1000 : kelvin;
    const temp = Math.max(1000, Math.min(40000, validKelvin)) / 100;
    let r: number, g: number, b: number;

    // Red
    if (temp <= 66) {
      r = 255;
    } else {
      r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    }

    // Green
    if (temp <= 66) {
      g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    } else {
      g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    }

    // Blue
    if (temp >= 66) {
      b = 255;
    } else if (temp <= 19) {
      b = 0;
    } else {
      b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
    }

    const red = Math.max(0, Math.min(1, r / 255));
    const green = Math.max(0, Math.min(1, g / 255));
    const blue = Math.max(0, Math.min(1, b / 255));

    if (target) {
      return target.set(red, green, blue, target.a);
    }
    return new Color(red, green, blue, 1.0);
  }

  /**
   * Returns the color components as a hex string (e.g. "#FF0000").
   * @param includeAlpha Whether to include the alpha channel (e.g. "#FF0000FF").
   */
  public toHex(includeAlpha: boolean = false): string {
    const toHexStr = (c: number): string => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    };

    let hex = "#" + toHexStr(this.r) + toHexStr(this.g) + toHexStr(this.b);
    if (includeAlpha) {
      hex += toHexStr(this.a);
    }

    return hex.toUpperCase();
  }

  /**
   * Returns the color components as HSL.
   * @returns An object with { h: (0-360), s: (0-1), l: (0-1) }
   */
  public toHSL(): { h: number; s: number; l: number } {
    const r = this.r,
      g = this.g,
      b = this.b;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }

    return { h: h * 360, s, l };
  }

  /**
   * Returns the color components as HSV/HSB.
   * @returns An object with { h: (0-360), s: (0-1), v: (0-1) }
   */
  public toHSV(): { h: number; s: number; v: number } {
    const r = this.r,
      g = this.g,
      b = this.b;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0;
    const v = max;
    const d = max - min;
    const s = max === 0 ? 0 : d / max;

    if (max !== min) {
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }

    return { h: h * 360, s, v };
  }

  /**
   * Returns the color components as an array.
   * @returns [r, g, b, a]
   */
  public toArray(): number[] {
    return [this.r, this.g, this.b, this.a];
  }

  /**
   * Returns the color components as a Float32Array.
   * @returns Float32Array(4)
   */
  public toFloat32Array(): Float32Array {
    this._cachedArray[0] = this.r;
    this._cachedArray[1] = this.g;
    this._cachedArray[2] = this.b;
    this._cachedArray[3] = this.a;
    return this._cachedArray;
  }

  /**
   * Returns the RGB components as a Vector3D.
   */
  public toVector3(): Vector3D {
    return new Vector3D(this.r, this.g, this.b);
  }
}
