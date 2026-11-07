export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimum edge (canvas px) a dragged selection needs to be kept. */
const MIN_DRAG_EDGE = 10;

/**
 * Rect/ellipse selection on the canvas: drag-to-draw, drag-to-move, numeric inputs,
 * nudging and the cropped preview that feeds the AI context pill and tools.
 */
export class CanvasSelection {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _box: HTMLElement;
  private readonly _props: HTMLElement;
  private readonly _inputX: HTMLInputElement;
  private readonly _inputY: HTMLInputElement;
  private readonly _inputW: HTMLInputElement;
  private readonly _inputH: HTMLInputElement;
  private readonly _pill: HTMLElement;
  private readonly _cropCanvas: HTMLCanvasElement;
  private readonly _cropCtx: CanvasRenderingContext2D;

  private _rect: SelectionRect | null = null;
  private _circle = false;
  private _drawing = false;
  private _moving = false;
  private _startX = 0;
  private _startY = 0;
  private _moveOffsetX = 0;
  private _moveOffsetY = 0;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._box = container.querySelector<HTMLElement>("#selection-box")!;
    this._props = container.querySelector<HTMLElement>("#selection-props")!;
    this._inputX = container.querySelector<HTMLInputElement>("#prop-x")!;
    this._inputY = container.querySelector<HTMLInputElement>("#prop-y")!;
    this._inputW = container.querySelector<HTMLInputElement>("#prop-w")!;
    this._inputH = container.querySelector<HTMLInputElement>("#prop-h")!;
    this._pill = container.querySelector<HTMLElement>("#context-pill")!;
    this._cropCanvas = container.querySelector<HTMLCanvasElement>("#crop-preview-canvas")!;
    this._cropCtx = this._cropCanvas.getContext("2d")!;

    for (const input of [this._inputX, this._inputY, this._inputW, this._inputH]) {
      input.addEventListener("input", () => this._applyInputs());
    }
  }

  public get rect(): SelectionRect | null {
    return this._rect;
  }

  public get cropCanvas(): HTMLCanvasElement {
    return this._cropCanvas;
  }

  /** The selection's pixels, or null when nothing is selected. */
  public getCropImageData(): ImageData | null {
    if (!this._rect || this._cropCanvas.width <= 0 || this._cropCanvas.height <= 0) return null;
    return this._cropCtx.getImageData(0, 0, this._cropCanvas.width, this._cropCanvas.height);
  }

  public get hasCrop(): boolean {
    return null !== this._rect && this._cropCanvas.width > 0 && this._cropCanvas.height > 0;
  }

  /** Whether new selections (and their crop) are elliptical; takes effect on the next update. */
  public setCircle(circle: boolean): void {
    this._circle = circle;
  }

  /** Re-applies the current shape to a visible selection. */
  public applyShape(): void {
    if (this._box.style.display !== "block") return;
    this._box.style.borderRadius = this._circle ? "50%" : "0";
    this.recapture();
  }

  public select(rect: SelectionRect): void {
    this._rect = rect;
    this._box.style.display = "block";
    this._updateBox(rect.x, rect.y, rect.w, rect.h);
    this._updateInputs();
    this._captureCrop();
  }

  public clear(): void {
    this._rect = null;
    this._box.style.display = "none";
    this._pill.style.display = "none";
    this._props.style.display = "none";
  }

  /** Re-reads the canvas into the crop preview after the pixels changed. */
  public recapture(): void {
    if (this._rect) this._captureCrop();
  }

  /** Moves the selection by whole canvas pixels, clamped to the canvas. */
  public nudge(dx: number, dy: number): void {
    const rect = this._rect;
    if (!rect) return;
    rect.x = Math.max(0, Math.min(rect.x + dx, this._canvas.width - rect.w));
    rect.y = Math.max(0, Math.min(rect.y + dy, this._canvas.height - rect.h));
    this._updateBox(rect.x, rect.y, rect.w, rect.h);
    this._updateInputs();
    this._captureCrop();
  }

  /** Client mouse position in canvas pixels plus the canvas-px per CSS-px scale. */
  public toCanvasPoint(e: MouseEvent): { x: number; y: number; scaleX: number; scaleY: number } {
    const bounds = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / bounds.width;
    const scaleY = this._canvas.height / bounds.height;
    return {
      x: (e.clientX - bounds.left) * scaleX,
      y: (e.clientY - bounds.top) * scaleY,
      scaleX,
      scaleY,
    };
  }

  public pointerDown(e: MouseEvent): void {
    const p = this.toCanvasPoint(e);
    if (this._rect && this._contains(this._rect, p.x, p.y)) {
      this._moving = true;
      this._moveOffsetX = p.x - this._rect.x;
      this._moveOffsetY = p.y - this._rect.y;
      return;
    }
    this._drawing = true;
    this._startX = p.x;
    this._startY = p.y;
    this._box.style.display = "block";
    this._updateBox(p.x, p.y, 0, 0);
  }

  public pointerMove(e: MouseEvent): void {
    const p = this.toCanvasPoint(e);
    const hovering = null !== this._rect && this._contains(this._rect, p.x, p.y) && !this._drawing;
    this._canvas.style.cursor = hovering ? "move" : "crosshair";

    if (this._moving && this._rect) {
      this._rect.x = Math.max(
        0,
        Math.min(Math.round(p.x - this._moveOffsetX), this._canvas.width - this._rect.w),
      );
      this._rect.y = Math.max(
        0,
        Math.min(Math.round(p.y - this._moveOffsetY), this._canvas.height - this._rect.h),
      );
      this._updateBox(this._rect.x, this._rect.y, this._rect.w, this._rect.h);
      this._updateInputs();
      this._captureCrop();
    } else if (this._drawing) {
      this._updateBox(this._startX, this._startY, p.x - this._startX, p.y - this._startY);
    }
  }

  public pointerUp(e: MouseEvent): void {
    if (this._moving) {
      this._moving = false;
      return;
    }
    if (!this._drawing) return;
    this._drawing = false;

    const p = this.toCanvasPoint(e);
    // Snap outwards to whole canvas pixels: a fractional crop would resample the edges.
    const left = Math.max(0, Math.floor(Math.min(this._startX, p.x)));
    const top = Math.max(0, Math.floor(Math.min(this._startY, p.y)));
    const right = Math.min(this._canvas.width, Math.ceil(Math.max(this._startX, p.x)));
    const bottom = Math.min(this._canvas.height, Math.ceil(Math.max(this._startY, p.y)));
    const rect: SelectionRect = { x: left, y: top, w: right - left, h: bottom - top };
    if (rect.w > MIN_DRAG_EDGE && rect.h > MIN_DRAG_EDGE) {
      this._rect = rect;
      this._updateBox(rect.x, rect.y, rect.w, rect.h);
      this._updateInputs();
      this._captureCrop();
    } else {
      this.clear();
    }
  }

  private _contains(rect: SelectionRect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  private _updateInputs(): void {
    if (!this._rect) return;
    this._props.style.display = "flex";
    this._inputX.value = this._rect.x.toString();
    this._inputY.value = this._rect.y.toString();
    this._inputW.value = this._rect.w.toString();
    this._inputH.value = this._rect.h.toString();
  }

  private _applyInputs(): void {
    if (!this._rect) return;
    this._rect.x = parseInt(this._inputX.value) || 0;
    this._rect.y = parseInt(this._inputY.value) || 0;
    this._rect.w = parseInt(this._inputW.value) || 10;
    this._rect.h = parseInt(this._inputH.value) || 10;
    this._updateBox(this._rect.x, this._rect.y, this._rect.w, this._rect.h);
    this._captureCrop();
  }

  private _updateBox(x: number, y: number, w: number, h: number): void {
    const { scaleX, scaleY } = this._canvasScale();
    this._box.style.left = `${Math.min(x, x + w) / scaleX}px`;
    this._box.style.top = `${Math.min(y, y + h) / scaleY}px`;
    this._box.style.width = `${Math.abs(w) / scaleX}px`;
    this._box.style.height = `${Math.abs(h) / scaleY}px`;
    this._box.style.borderRadius = this._circle ? "50%" : "0";
  }

  private _canvasScale(): { scaleX: number; scaleY: number } {
    const bounds = this._canvas.getBoundingClientRect();
    return {
      scaleX: this._canvas.width / bounds.width,
      scaleY: this._canvas.height / bounds.height,
    };
  }

  private _captureCrop(): void {
    const rect = this._rect;
    if (!rect) return;
    const ctx = this._cropCtx;
    this._pill.style.display = "flex";
    this._cropCanvas.width = rect.w;
    this._cropCanvas.height = rect.h;
    ctx.clearRect(0, 0, rect.w, rect.h);

    ctx.save();
    if (this._circle) {
      ctx.beginPath();
      ctx.ellipse(rect.w / 2, rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, 2 * Math.PI);
      ctx.clip();
    }
    ctx.drawImage(this._canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    ctx.restore();
  }
}
