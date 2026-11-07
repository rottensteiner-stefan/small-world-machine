import { Color } from "../core/colors/index.js";

/**
 * Utility class for color conversions and manipulations.
 */
export class ColorUtils {
  private static _ctx: CanvasRenderingContext2D | undefined = undefined;

  private static _getCtx(): CanvasRenderingContext2D | undefined {
    if (undefined === this._ctx) {
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      this._ctx = canvas.getContext("2d", { willReadFrequently: true }) ?? undefined;
    }
    return this._ctx;
  }

  /**
   * Creates a Color instance from a CSS color string.
   * @param cssColor The CSS color string (e.g., "#ff0000", "rgb(255, 0, 0)", "red").
   * @returns A new Color instance.
   */
  public static fromCSS(cssColor: string): Color {
    const ctx: CanvasRenderingContext2D | undefined = this._getCtx();
    if (undefined === ctx) {
      return new Color(1, 1, 1, 1);
    }
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const data: Uint8ClampedArray = ctx.getImageData(0, 0, 1, 1).data;
    const r: number = data[0] ?? 255;
    const g: number = data[1] ?? 255;
    const b: number = data[2] ?? 255;
    const a: number = data[3] ?? 255;
    return new Color(r / 255, g / 255, b / 255, a / 255);
  }
}
