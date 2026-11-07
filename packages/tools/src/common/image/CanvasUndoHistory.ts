/** 256 MB: bounds memory for large canvases (a 4096x4096 snapshot is 64 MB). */
const DEFAULT_MAX_UNDO_BYTES = 256 * 1024 * 1024;

export interface CanvasUndoSnapshot {
  imageData: ImageData;
  width: number;
  height: number;
  label: string;
}

export class CanvasUndoHistory {
  private _undoStack: CanvasUndoSnapshot[] = [];
  private _redoStack: CanvasUndoSnapshot[] = [];
  private readonly _maxEntries: number;
  private readonly _maxBytes: number;

  /**
   * @param maxEntries Maximum snapshots per stack.
   * @param maxBytes RGBA byte budget per stack; the oldest snapshots are dropped first. The newest
   *   snapshot is always kept, even if it alone exceeds the budget.
   */
  constructor(maxEntries = 30, maxBytes = DEFAULT_MAX_UNDO_BYTES) {
    this._maxEntries = maxEntries;
    this._maxBytes = maxBytes;
  }

  public get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  public get undoCount(): number {
    return this._undoStack.length;
  }

  public get redoCount(): number {
    return this._redoStack.length;
  }

  public clear(): void {
    this._undoStack = [];
    this._redoStack = [];
  }

  /** Captures the current canvas before a destructive modification. */
  public push(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, label: string): void {
    if (canvas.width === 0 || canvas.height === 0) return;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this._undoStack.push({
      imageData: imgData,
      width: canvas.width,
      height: canvas.height,
      label,
    });
    this._trim(this._undoStack);
    this._redoStack = [];
  }

  /** Reverts to the previous snapshot, placing current canvas onto the redo stack. */
  public undo(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    redoLabel: string,
  ): CanvasUndoSnapshot | null {
    if (this._undoStack.length === 0) return null;

    if (canvas.width > 0 && canvas.height > 0) {
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this._redoStack.push({
        imageData: current,
        width: canvas.width,
        height: canvas.height,
        label: redoLabel,
      });
      this._trim(this._redoStack);
    }

    const snapshot = this._undoStack.pop()!;
    this._applySnapshot(canvas, ctx, snapshot);
    return snapshot;
  }

  /** Re-applies the next snapshot, placing current canvas onto the undo stack. */
  public redo(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    undoLabel: string,
  ): CanvasUndoSnapshot | null {
    if (this._redoStack.length === 0) return null;

    if (canvas.width > 0 && canvas.height > 0) {
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this._undoStack.push({
        imageData: current,
        width: canvas.width,
        height: canvas.height,
        label: undoLabel,
      });
      this._trim(this._undoStack);
    }

    const snapshot = this._redoStack.pop()!;
    this._applySnapshot(canvas, ctx, snapshot);
    return snapshot;
  }

  private _trim(stack: CanvasUndoSnapshot[]): void {
    let bytes = stack.reduce((sum, snap) => sum + snap.width * snap.height * 4, 0);
    while (stack.length > 1 && (stack.length > this._maxEntries || bytes > this._maxBytes)) {
      const dropped = stack.shift()!;
      bytes -= dropped.width * dropped.height * 4;
    }
  }

  private _applySnapshot(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    snapshot: CanvasUndoSnapshot,
  ): void {
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    ctx.putImageData(snapshot.imageData, 0, 0);
  }
}
