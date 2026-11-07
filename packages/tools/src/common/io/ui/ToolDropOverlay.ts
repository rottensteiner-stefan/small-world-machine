import { DropAssetSource } from "../sources/DropAssetSource.js";
import type { IAssetSource } from "../types.js";
import { ensureIoStyles } from "./ioStyles.js";

export interface ToolDropOverlayOptions {
  /** Shown while files are dragged over the window, e.g. "Drop a kit folder or ZIP". */
  label: string;
  onSource: (source: IAssetSource) => void | Promise<void>;
  onError: (error: Error) => void;
}

/** Window-wide drop target with a visible overlay; turns every drop into an `IAssetSource`. */
export class ToolDropOverlay {
  private readonly _doc: Document;
  private readonly _overlay: HTMLElement;
  private readonly _options: ToolDropOverlayOptions;
  private _dragDepth = 0;

  constructor(options: ToolDropOverlayOptions, doc: Document = document) {
    this._doc = doc;
    this._options = options;
    ensureIoStyles(doc);

    this._overlay = doc.createElement("div");
    this._overlay.className = "sw-io-drop";
    const label: HTMLElement = doc.createElement("div");
    label.className = "sw-io-drop-label";
    label.textContent = options.label;
    this._overlay.appendChild(label);
    doc.body.appendChild(this._overlay);

    doc.addEventListener("dragenter", this._onDragEnter);
    doc.addEventListener("dragover", this._onDragOver);
    doc.addEventListener("dragleave", this._onDragLeave);
    doc.addEventListener("drop", this._onDrop);
  }

  public get isActive(): boolean {
    return this._overlay.dataset["active"] === "true";
  }

  public dispose(): void {
    this._doc.removeEventListener("dragenter", this._onDragEnter);
    this._doc.removeEventListener("dragover", this._onDragOver);
    this._doc.removeEventListener("dragleave", this._onDragLeave);
    this._doc.removeEventListener("drop", this._onDrop);
    this._overlay.remove();
  }

  private _carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer !== null && DropAssetSource.hasFiles(event.dataTransfer);
  }

  private _setActive(active: boolean): void {
    this._overlay.dataset["active"] = String(active);
  }

  private readonly _onDragEnter = (event: DragEvent): void => {
    if (!this._carriesFiles(event)) return;
    event.preventDefault();
    this._dragDepth++;
    this._setActive(true);
  };

  private readonly _onDragOver = (event: DragEvent): void => {
    if (!this._carriesFiles(event)) return;
    // Without preventDefault the browser refuses the drop and navigates to the file instead.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  private readonly _onDragLeave = (event: DragEvent): void => {
    if (!this._carriesFiles(event)) return;
    this._dragDepth = Math.max(0, this._dragDepth - 1);
    if (this._dragDepth === 0) this._setActive(false);
  };

  private readonly _onDrop = (event: DragEvent): void => {
    if (!this._carriesFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    this._dragDepth = 0;
    this._setActive(false);
    DropAssetSource.fromDataTransfer(event.dataTransfer)
      .then((source) => (source ? this._options.onSource(source) : undefined))
      .catch((error: unknown) => {
        this._options.onError(error instanceof Error ? error : new Error(String(error)));
      });
  };
}
