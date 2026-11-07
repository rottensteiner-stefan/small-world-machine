/**
 * Simple FPS counter that displays the current frames per second on the screen.
 */
export class FPSCounter {
  private _last: number = performance.now();
  private _frames: number = 0;
  private _el: HTMLDivElement = document.createElement("div");

  /**
   * Creates a new FPSCounter and adds it to the document body.
   */
  constructor() {
    Object.assign(this._el.style, {
      position: "fixed",
      top: "10px",
      left: "10px",
      color: "#0f0",
      fontFamily: "monospace",
      background: "#000",
      padding: "4px",
      zIndex: "1000",
    });
    document.body.appendChild(this._el);
  }

  /**
   * Updates the FPS counter. Should be called every frame.
   */
  public update(): void {
    this._frames++;
    const now: number = performance.now();
    if (now >= this._last + 1000) {
      this._el.innerText = "FPS: " + this._frames;
      this._frames = 0;
      this._last = now;
    }
  }

  /**
   * Destroys the FPSCounter and removes its DOM element.
   */
  public destroy(): void {
    this._el.remove();
  }
}
