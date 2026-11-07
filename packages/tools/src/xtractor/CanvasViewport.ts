const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
/** Canvas container padding (2rem each side) that fit-to-window has to leave free. */
const FIT_PADDING_PX = 64;

/** Zoom (buttons, Ctrl+wheel, fit) and hand-tool panning of the scrollable canvas stage. */
export class CanvasViewport {
  private readonly _wrapper: HTMLElement;
  private readonly _stage: HTMLElement;
  private readonly _label: HTMLElement;
  private readonly _hasImage: () => boolean;
  private _zoom = 1;
  private _panning = false;
  private _panX = 0;
  private _panY = 0;

  constructor(container: HTMLElement, hasImage: () => boolean) {
    this._wrapper = container.querySelector<HTMLElement>("#canvas-wrapper")!;
    this._stage = container.querySelector<HTMLElement>("#canvas-stage")!;
    this._label = container.querySelector<HTMLElement>("#zoom-label")!;
    this._hasImage = hasImage;

    container
      .querySelector<HTMLElement>("#btn-zoom-in")!
      .addEventListener("click", () => this.applyZoom(this._zoom * 1.2));
    container
      .querySelector<HTMLElement>("#btn-zoom-out")!
      .addEventListener("click", () => this.applyZoom(this._zoom * 0.8));

    this._wrapper.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        if (e.ctrlKey) {
          e.preventDefault(); // Prevent native browser pinch zoom
          this.applyZoom(this._zoom * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
        }
      },
      { passive: false },
    );
  }

  public get zoom(): number {
    return this._zoom;
  }

  public get isPanning(): boolean {
    return this._panning;
  }

  /** Zooms around a client-space point (defaults to the window center). */
  public applyZoom(
    newZoom: number,
    centerX = window.innerWidth / 2,
    centerY = window.innerHeight / 2,
  ): void {
    if (!this._hasImage()) return;
    const prevZoom = this._zoom;
    this._zoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));

    const rect = this._stage.getBoundingClientRect();
    const ptX = (centerX - rect.left) / prevZoom;
    const ptY = (centerY - rect.top) / prevZoom;

    this._applyTransform();
    this._wrapper.scrollLeft += ptX * (this._zoom - prevZoom);
    this._wrapper.scrollTop += ptY * (this._zoom - prevZoom);
  }

  /** Cmd+1: actual pixels. */
  public resetTo100(): void {
    this.applyZoom(1);
  }

  /** Cmd+0: largest zoom at which the whole image is visible. */
  public fitToWindow(imageWidth: number, imageHeight: number): void {
    if (!this._hasImage() || imageWidth <= 0 || imageHeight <= 0) return;
    const availableW = Math.max(1, this._wrapper.clientWidth - FIT_PADDING_PX);
    const availableH = Math.max(1, this._wrapper.clientHeight - FIT_PADDING_PX);
    this._zoom = Math.max(
      MIN_ZOOM,
      Math.min(availableW / imageWidth, availableH / imageHeight, MAX_ZOOM),
    );
    this._applyTransform();
    this._wrapper.scrollLeft = 0;
    this._wrapper.scrollTop = 0;
  }

  /** Back to 100% without needing an image (used when the image is removed). */
  public reset(): void {
    this._zoom = 1;
    this._applyTransform();
  }

  public startPan(e: MouseEvent): void {
    this._panning = true;
    this._panX = e.clientX;
    this._panY = e.clientY;
  }

  public pan(e: MouseEvent): void {
    this._wrapper.scrollLeft -= e.clientX - this._panX;
    this._wrapper.scrollTop -= e.clientY - this._panY;
    this._panX = e.clientX;
    this._panY = e.clientY;
  }

  public endPan(): void {
    this._panning = false;
  }

  private _applyTransform(): void {
    this._stage.style.transform = `scale(${this._zoom})`;
    this._label.innerText = `${Math.round(this._zoom * 100)}%`;
  }
}
