import { Texture } from "../textures/index.js";
import { GradientDirection, TextAlign } from "../../enums/index.js";

/**
 * Outline (stroke) styling for text drawn by a TextTexture.
 */
export interface TextOutlineOptions {
  /** Outline color as a CSS color string. Defaults to "#000000". */
  color?: string;
  /** Outline width in pixels. Defaults to 2. */
  width?: number;
}

/**
 * Drop-shadow styling for text drawn by a TextTexture.
 */
export interface TextShadowOptions {
  /** Shadow color as a CSS color string. Defaults to "rgba(0, 0, 0, 0.6)". */
  color?: string;
  /** Shadow blur radius in pixels. Defaults to 8. */
  blur?: number;
  /** Shadow X offset in pixels. Defaults to 0. */
  offsetX?: number;
  /** Shadow Y offset in pixels. Defaults to 0. */
  offsetY?: number;
}

/**
 * Linear gradient fill for text drawn by a TextTexture.
 */
export interface TextGradientOptions {
  /** Gradient start color as a CSS color string. */
  from: string;
  /** Gradient end color as a CSS color string. */
  to: string;
  /** Gradient direction. Defaults to `GradientDirection.DEFAULT` (horizontal). */
  direction?: GradientDirection;
}

/**
 * Configuration options for a TextTexture.
 */
export interface TextTextureOptions {
  /** The text to render. Explicit "\n" characters start a new line. */
  text: string;
  /** CSS font family name. Defaults to "sans-serif". */
  fontFamily?: string;
  /** URL of a font file (e.g. a variable font) to load and register under `fontFamily` before drawing. */
  fontUrl?: string;
  /** Font size in pixels. Defaults to 48. */
  fontSize?: number;
  /** Numeric font weight, also drives the "wght" axis of a variable font. Defaults to 400. */
  fontWeight?: number;
  /** CSS font-stretch value (keyword or percentage), drives the "wdth" axis of a variable font. */
  fontStretch?: string;
  /** Whether to render in italic, drives the "ital"/"slnt" axis of a variable font. */
  italic?: boolean;
  /**
   * Raw CSS `font-variation-settings` value for custom variable font axes beyond weight/stretch/
   * italic. Applied best-effort via `CanvasRenderingContext2D.fontVariationSettings` where the
   * browser supports it; silently ignored otherwise.
   */
  fontVariationSettings?: string;
  /** Fill color as a CSS color string. Defaults to "#ffffff". Ignored if `gradient` is set. */
  color?: string;
  /** Background fill as a CSS color string, or "transparent". Defaults to "transparent". */
  background?: string;
  /** Horizontal text alignment. Defaults to `TextAlign.DEFAULT` (center). */
  align?: TextAlign;
  /** Padding around the text in pixels. Defaults to 24. */
  padding?: number;
  /** Maximum line width in pixels before wrapping. Unset means no wrapping. */
  maxWidth?: number;
  /** Line height multiplier relative to `fontSize`. Defaults to 1.2. */
  lineHeight?: number;
  /** Extra spacing between characters in pixels. */
  letterSpacing?: number;
  /** Supersampling factor for a sharper texture. Defaults to 2. */
  pixelRatio?: number;
  /** Outline (stroke) effect. */
  outline?: TextOutlineOptions;
  /** Drop-shadow effect. */
  shadow?: TextShadowOptions;
  /** Linear gradient fill, replaces `color`. */
  gradient?: TextGradientOptions;
}

/**
 * Renders text (including variable fonts and canvas-level effects) into a Texture, ready to be
 * assigned as a material's diffuse map on a Plane. Call `setText`/`setOptions` to redraw and push
 * the updated pixels to the GPU on the next frame.
 */
export class TextTexture {
  /** The GPU-facing texture backed by this instance's canvas. */
  public readonly texture: Texture;

  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private readonly _options: TextTextureOptions;
  private _cssWidth: number = 0;
  private _cssHeight: number = 0;

  /**
   * Creates a new TextTexture and draws it immediately using already-available fonts (system
   * fonts, or fonts already registered via CSS `@font-face`/`document.fonts`). Use `TextTexture.create`
   * instead if `options.fontUrl` needs to be loaded first.
   * @param options Configuration options.
   */
  constructor(options: TextTextureOptions) {
    this._options = { ...options };

    this._canvas = document.createElement("canvas");
    this._canvas.width = 1;
    this._canvas.height = 1;
    const ctx = this._canvas.getContext("2d");
    if (!ctx) throw new Error("TextTexture: 2D canvas context is unavailable.");
    this._ctx = ctx;

    this._redraw();
    this.texture = Texture.fromCanvas(this._canvas, { generateMipmaps: false });
  }

  /**
   * Creates a TextTexture, first loading `options.fontUrl` (if given) via the CSS Font Loading API.
   * @param options Configuration options.
   * @returns A promise that resolves to a new TextTexture instance.
   */
  public static async create(options: TextTextureOptions): Promise<TextTexture> {
    if (options.fontUrl) {
      await TextTexture.loadFont(options.fontFamily ?? "TextTextureFont", options.fontUrl);
    }
    return new TextTexture(options);
  }

  /**
   * Loads a font file and registers it with `document.fonts` under the given family name.
   * @param family The font family name to register the loaded font under.
   * @param url The URL of the font file (e.g. a variable-font .woff2).
   * @returns A promise that resolves to the loaded FontFace.
   */
  public static async loadFont(family: string, url: string): Promise<FontFace> {
    const face = new FontFace(family, `url(${url})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
    return loaded;
  }

  /** The unscaled (CSS pixel) width of the rendered text texture, useful for sizing a Plane. */
  public get width(): number {
    return this._cssWidth;
  }

  /** The unscaled (CSS pixel) height of the rendered text texture, useful for sizing a Plane. */
  public get height(): number {
    return this._cssHeight;
  }

  /** The width-to-height ratio of the rendered text texture. */
  public get aspectRatio(): number {
    return this._cssHeight > 0 ? this._cssWidth / this._cssHeight : 1;
  }

  /**
   * Replaces the displayed text and redraws, marking the texture for GPU re-upload.
   * @param text The new text to display.
   */
  public setText(text: string): void {
    this.setOptions({ text });
  }

  /**
   * Merges new options in, redraws, and marks the texture for GPU re-upload.
   * @param options Partial options to merge over the current configuration.
   */
  public setOptions(options: Partial<TextTextureOptions>): void {
    Object.assign(this._options, options);
    this._redraw();
    this.texture.needsUpdate = true;
  }

  private _buildFontString(): string {
    const o = this._options;
    const parts: string[] = [];
    if (o.italic) parts.push("italic");
    parts.push(`${o.fontWeight ?? 400}`);
    if (o.fontStretch) parts.push(o.fontStretch);
    parts.push(`${o.fontSize ?? 48}px`);
    return `${parts.join(" ")} ${o.fontFamily ?? "sans-serif"}`;
  }

  private _wrapLines(ctx: CanvasRenderingContext2D, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of this._options.text.split("\n")) {
      const words = paragraph.split(" ");
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  private _redraw(): void {
    const o = this._options;
    const ratio = o.pixelRatio ?? 2;
    const padding = o.padding ?? 24;
    const fontSize = o.fontSize ?? 48;
    const lineHeightPx = fontSize * (o.lineHeight ?? 1.2);
    const align = o.align ?? TextAlign.DEFAULT;

    const ctx = this._ctx;
    ctx.font = this._buildFontString();

    const maxTextWidth = o.maxWidth ? Math.max(1, o.maxWidth - padding * 2) : undefined;
    const lines = maxTextWidth ? this._wrapLines(ctx, maxTextWidth) : o.text.split("\n");

    let widestLine = 0;
    for (const line of lines) widestLine = Math.max(widestLine, ctx.measureText(line).width);
    const contentWidth = maxTextWidth ?? widestLine;

    this._cssWidth = Math.max(1, Math.ceil(contentWidth + padding * 2));
    this._cssHeight = Math.max(1, Math.ceil(lines.length * lineHeightPx + padding * 2));

    this._canvas.width = Math.ceil(this._cssWidth * ratio);
    this._canvas.height = Math.ceil(this._cssHeight * ratio);

    // Pre-flip Y so the uploaded canvas is already in WebGL orientation:
    // canvas row 0 → V=0 (plane bottom), canvas last row → V=1 (plane top).
    // Without this, UNPACK_FLIP_Y_WEBGL=false causes text to appear upside-down.
    ctx.setTransform(ratio, 0, 0, -ratio, 0, this._canvas.height);
    ctx.clearRect(0, 0, this._cssWidth, this._cssHeight);

    if (o.background && "transparent" !== o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, this._cssWidth, this._cssHeight);
    }

    ctx.font = this._buildFontString();
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    if (o.letterSpacing && "letterSpacing" in ctx) {
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${o.letterSpacing}px`;
    }
    if (o.fontVariationSettings && "fontVariationSettings" in ctx) {
      (ctx as unknown as { fontVariationSettings: string }).fontVariationSettings =
        o.fontVariationSettings;
    }

    if (o.shadow) {
      ctx.shadowColor = o.shadow.color ?? "rgba(0, 0, 0, 0.6)";
      ctx.shadowBlur = o.shadow.blur ?? 8;
      ctx.shadowOffsetX = o.shadow.offsetX ?? 0;
      ctx.shadowOffsetY = o.shadow.offsetY ?? 0;
    }

    if (o.gradient) {
      const g = o.gradient;
      const grad =
        GradientDirection.VERTICAL === g.direction
          ? ctx.createLinearGradient(0, padding, 0, this._cssHeight - padding)
          : ctx.createLinearGradient(padding, 0, this._cssWidth - padding, 0);
      grad.addColorStop(0, g.from);
      grad.addColorStop(1, g.to);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = o.color ?? "#ffffff";
    }

    const x =
      TextAlign.LEFT === align
        ? padding
        : TextAlign.RIGHT === align
          ? this._cssWidth - padding
          : this._cssWidth / 2;

    lines.forEach((line, i) => {
      const y = padding + lineHeightPx * (i + 0.5);
      if (o.outline) {
        ctx.strokeStyle = o.outline.color ?? "#000000";
        ctx.lineWidth = o.outline.width ?? 2;
        ctx.strokeText(line, x, y);
      }
      ctx.fillText(line, x, y);
    });
  }
}
