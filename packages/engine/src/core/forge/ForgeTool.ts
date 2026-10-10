export interface ForgeToolOptions {
  parent?: HTMLElement;
  initialState?: unknown;
}

export abstract class ForgeTool {
  protected _container: HTMLElement;
  protected _options: ForgeToolOptions;

  constructor(options: ForgeToolOptions = {}) {
    this._options = options;
    this._container = document.createElement("div");
    this._container.style.width = "100%";
    this._container.style.height = "100%";

    if (this._options.parent) {
      this.mount(this._options.parent);
    }
  }

  public mount(parent: HTMLElement): void {
    parent.appendChild(this._container);
  }

  public unmount(): void {
    if (this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
  }

  public getContainer(): HTMLElement {
    return this._container;
  }

  public resize(_w: number, _h: number): void {
    // Optional hook for tools that need to react to window resizing
  }

  public onPasteImage(_base64: string): void {
    // Optional hook for tools that can accept pasted images
  }

  public abstract getState(): unknown;
  public abstract setState(state: unknown): void;
}
