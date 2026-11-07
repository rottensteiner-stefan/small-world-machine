import { describe, it, expect } from "vitest";
import { CanvasUndoHistory } from "../../src/common/image/CanvasUndoHistory.js";
import { makeImageData } from "../../src/common/image/CanvasOps.js";

describe("CanvasUndoHistory", () => {
  function createMockCanvas(
    w: number,
    h: number,
    fillColor = 0,
  ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    let currentData = makeImageData(w, h);
    for (let i = 0; i < currentData.data.length; i += 4) {
      currentData.data[i] = fillColor;
      currentData.data[i + 1] = fillColor;
      currentData.data[i + 2] = fillColor;
      currentData.data[i + 3] = 255;
    }

    const mockCanvas = {
      width: w,
      height: h,
    } as unknown as HTMLCanvasElement;

    const mockCtx = {
      getImageData: (_x: number, _y: number, _w: number, _h: number) => {
        const copy = makeImageData(mockCanvas.width, mockCanvas.height);
        copy.data.set(currentData.data);
        return copy;
      },
      putImageData: (imgData: ImageData, _x: number, _y: number) => {
        currentData = makeImageData(imgData.width, imgData.height);
        currentData.data.set(imgData.data);
        mockCanvas.width = imgData.width;
        mockCanvas.height = imgData.height;
      },
      setData: (imgData: ImageData) => {
        currentData = imgData;
        mockCanvas.width = imgData.width;
        mockCanvas.height = imgData.height;
      },
    } as unknown as CanvasRenderingContext2D & { setData: (imgData: ImageData) => void };

    return { canvas: mockCanvas, ctx: mockCtx };
  }

  it("pushes snapshots and performs undo/redo", () => {
    const history = new CanvasUndoHistory(10);
    const { canvas, ctx } = createMockCanvas(10, 10, 100);

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);

    // Save initial state before modification
    history.push(canvas, ctx, "Initial state");

    // Modify canvas to color 200
    const imgData2 = makeImageData(10, 10);
    for (let i = 0; i < imgData2.data.length; i += 4) {
      imgData2.data[i] = 200;
      imgData2.data[i + 3] = 255;
    }
    ctx.putImageData(imgData2, 0, 0);

    expect(history.canUndo).toBe(true);

    // Perform undo
    const undone = history.undo(canvas, ctx, "current");
    expect(undone).not.toBeNull();
    expect(undone?.label).toBe("Initial state");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    // Check pixel value restored to 100
    const restoredData = ctx.getImageData(0, 0, 10, 10);
    expect(restoredData.data[0]).toBe(100);

    // Perform redo
    const redone = history.redo(canvas, ctx, "before redo");
    expect(redone).not.toBeNull();
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    const redoneData = ctx.getImageData(0, 0, 10, 10);
    expect(redoneData.data[0]).toBe(200);
  });

  it("caps stack size and clears redo stack on new push", () => {
    const history = new CanvasUndoHistory(3);
    const { canvas, ctx } = createMockCanvas(4, 4, 10);

    history.push(canvas, ctx, "Step 1");
    history.push(canvas, ctx, "Step 2");
    history.push(canvas, ctx, "Step 3");
    history.push(canvas, ctx, "Step 4");

    expect(history.undoCount).toBe(3);

    history.undo(canvas, ctx, "current");
    expect(history.canRedo).toBe(true);

    // Pushing a new action clears redo
    history.push(canvas, ctx, "Step 5");
    expect(history.canRedo).toBe(false);
  });

  it("drops the oldest snapshots once the byte budget is exceeded", () => {
    // 4x4 RGBA = 64 bytes per snapshot, budget fits exactly two
    const history = new CanvasUndoHistory(100, 128);
    const { canvas, ctx } = createMockCanvas(4, 4);

    history.push(canvas, ctx, "A");
    history.push(canvas, ctx, "B");
    history.push(canvas, ctx, "C");

    expect(history.undoCount).toBe(2);
    expect(history.undo(canvas, ctx, "current")?.label).toBe("C");
    expect(history.undo(canvas, ctx, "current")?.label).toBe("B");
    expect(history.undo(canvas, ctx, "current")).toBeNull();
  });

  it("always keeps the newest snapshot even if it alone exceeds the budget", () => {
    const history = new CanvasUndoHistory(10, 16);
    const { canvas, ctx } = createMockCanvas(4, 4);

    history.push(canvas, ctx, "A");
    history.push(canvas, ctx, "B");

    expect(history.undoCount).toBe(1);
    expect(history.undo(canvas, ctx, "current")?.label).toBe("B");
  });

  it("labels the opposite stack with the caller-provided text", () => {
    const history = new CanvasUndoHistory(10);
    const { canvas, ctx } = createMockCanvas(2, 2);

    history.push(canvas, ctx, "Edit");
    history.undo(canvas, ctx, "state before undo");
    expect(history.redo(canvas, ctx, "state before redo")?.label).toBe("state before undo");
    expect(history.undo(canvas, ctx, "x")?.label).toBe("state before redo");
  });

  it("clear empties both stacks and a new push after undo resets redo", () => {
    const history = new CanvasUndoHistory(10);
    const { canvas, ctx } = createMockCanvas(2, 2);

    history.push(canvas, ctx, "A");
    history.undo(canvas, ctx, "current");
    expect(history.redoCount).toBe(1);
    history.push(canvas, ctx, "B");
    expect(history.redoCount).toBe(0);

    history.clear();
    expect(history.undoCount).toBe(0);
    expect(history.canUndo).toBe(false);
  });
});
