// @vitest-environment node
import { describe, it, expect } from "vitest";
import { UndoStack, MERGE_WINDOW_MS } from "../../src/maker/UndoStack.js";
import { createMakerCommandRunner } from "../../src/maker/MakerUndoCore.js";

interface Obj {
  x: number;
  updateMatrixWorld(): void;
}

function setup(): {
  stack: UndoStack;
  obj: Obj;
  nudge: (mergeKey?: string) => void;
  clock: { t: number };
} {
  const clock = { t: 0 };
  const stack = new UndoStack(() => clock.t);
  const runner = createMakerCommandRunner({
    execute: (c) => stack.execute(c),
    afterApply: () => {},
  });
  const obj: Obj = { x: 0, updateMatrixWorld: () => {} };
  const nudge = (mergeKey?: string): void =>
    runner.snapshotCommand(
      [obj],
      (o) => o.x,
      (o, v) => {
        o.x = v;
      },
      "Move",
      () => {
        obj.x += 1;
      },
      mergeKey,
    );
  return { stack, obj, nudge, clock };
}

describe("UndoStack — coalescing of held-key nudges", () => {
  it("30 rapid same-key nudges are ONE undo step restoring the very first state", () => {
    const { stack, obj, nudge, clock } = setup();
    for (let i = 0; i < 30; i++) {
      nudge("nudge:1");
      clock.t += 33;
    }
    expect(obj.x).toBe(30);
    stack.undo();
    expect(obj.x).toBe(0);
    expect(stack.canUndo).toBe(false);
    stack.redo();
    expect(obj.x).toBe(30);
  });

  it("does not flood the 50-entry history (an old step survives a long hold)", () => {
    const { stack, nudge, clock } = setup();
    let discarded = 0;
    stack.execute({ label: "Delete", redo: () => {}, undo: () => {}, discard: () => discarded++ });
    clock.t += 1000;
    for (let i = 0; i < 120; i++) {
      nudge("nudge:1");
      clock.t += 33;
    }
    expect(discarded).toBe(0);
    stack.undo();
    stack.undo();
    expect(stack.canUndo).toBe(false);
  });

  it("a pause longer than the window starts a new step", () => {
    const { stack, obj, nudge, clock } = setup();
    nudge("k");
    clock.t += MERGE_WINDOW_MS + 1;
    nudge("k");
    stack.undo();
    expect(obj.x).toBe(1);
    stack.undo();
    expect(obj.x).toBe(0);
  });

  it("different keys and key-less commands never merge", () => {
    const { stack, obj, nudge } = setup();
    nudge("a");
    nudge("b");
    nudge();
    nudge();
    stack.undo();
    stack.undo();
    stack.undo();
    stack.undo();
    expect(obj.x).toBe(0);
  });

  it("an undo in between breaks the merge chain", () => {
    const { stack, obj, nudge } = setup();
    nudge("k");
    nudge("k");
    stack.undo();
    expect(obj.x).toBe(0);
    nudge("k");
    nudge("k");
    stack.undo();
    expect(obj.x).toBe(0);
    expect(stack.canUndo).toBe(false);
  });
});
