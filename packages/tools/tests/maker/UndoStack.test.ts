import { describe, it, expect } from "vitest";
import type { UndoCommand } from "../../src/maker/UndoStack.js";
import { UndoStack } from "../../src/maker/UndoStack.js";

describe("UndoStack (ADR 0010 Maker Command History)", () => {
  it("should execute command immediately and push to undo history", () => {
    const stack = new UndoStack();
    let value = 0;

    const cmd: UndoCommand = {
      label: "Increment",
      redo: () => {
        value += 10;
      },
      undo: () => {
        value -= 10;
      },
    };

    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);

    stack.execute(cmd);

    expect(value).toBe(10);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it("should support sequential undo and redo operations", () => {
    const stack = new UndoStack();
    let state = "init";

    stack.execute({
      label: "Step 1",
      redo: () => {
        state = "state 1";
      },
      undo: () => {
        state = "init";
      },
    });

    stack.execute({
      label: "Step 2",
      redo: () => {
        state = "state 2";
      },
      undo: () => {
        state = "state 1";
      },
    });

    expect(state).toBe("state 2");

    stack.undo();
    expect(state).toBe("state 1");
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(true);

    stack.undo();
    expect(state).toBe("init");
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);

    // Redo step 1
    stack.redo();
    expect(state).toBe("state 1");

    // Redo step 2
    stack.redo();
    expect(state).toBe("state 2");
    expect(stack.canRedo).toBe(false);
  });

  it("should discard redo branch when executing new action after undo", () => {
    const stack = new UndoStack();
    let counter = 0;

    stack.execute({
      label: "+1",
      redo: () => {
        counter += 1;
      },
      undo: () => {
        counter -= 1;
      },
    });

    stack.execute({
      label: "+10",
      redo: () => {
        counter += 10;
      },
      undo: () => {
        counter -= 10;
      },
    });

    expect(counter).toBe(11);

    stack.undo(); // back to 1
    expect(counter).toBe(1);
    expect(stack.canRedo).toBe(true);

    // Execute branch action
    stack.execute({
      label: "+100",
      redo: () => {
        counter += 100;
      },
      undo: () => {
        counter -= 100;
      },
    });

    expect(counter).toBe(101);
    expect(stack.canRedo).toBe(false); // old "+10" redo is cleared!
  });

  it("should clear all history without triggering undo/redo", () => {
    const stack = new UndoStack();
    let sideEffect = 0;

    stack.execute({
      label: "Action",
      redo: () => {
        sideEffect++;
      },
      undo: () => {
        sideEffect--;
      },
    });

    expect(sideEffect).toBe(1);
    expect(stack.canUndo).toBe(true);

    stack.clear();

    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(sideEffect).toBe(1); // state untouched
  });

  describe("history capacity + discard() (memory-growth fix)", () => {
    function noopCommand(label: string, discard?: () => void): UndoCommand {
      const command: UndoCommand = { label, redo: (): void => {}, undo: (): void => {} };
      if (discard) command.discard = discard;
      return command;
    }

    it("caps the done stack at 50 entries, dropping the oldest one first", () => {
      const stack = new UndoStack();
      for (let i = 0; i < 60; i++) {
        stack.execute(noopCommand(`cmd-${i}`));
      }

      let undoCount = 0;
      while (stack.canUndo) {
        stack.undo();
        undoCount++;
      }
      expect(undoCount).toBe(50);
    });

    it("calls discard() on a command evicted from the front once the cap is exceeded", () => {
      const stack = new UndoStack();
      const discarded: string[] = [];

      for (let i = 0; i < 51; i++) {
        stack.execute(noopCommand(`cmd-${i}`, () => discarded.push(`cmd-${i}`)));
      }

      // Only the very first (oldest) command should have been evicted+discarded so far.
      expect(discarded).toEqual(["cmd-0"]);
    });

    it("calls discard() on every command in the abandoned redo branch when a new one executes", () => {
      const stack = new UndoStack();
      const discarded: string[] = [];

      stack.execute(noopCommand("a"));
      stack.execute(noopCommand("b", () => discarded.push("b")));
      stack.undo(); // "b" now sits in the redo branch (_undone)
      expect(stack.canRedo).toBe(true);

      stack.execute(noopCommand("c")); // discards the "b" redo branch for good

      expect(discarded).toEqual(["b"]);
      expect(stack.canRedo).toBe(false);
    });

    it("calls discard() on every remaining command (done and undone) when clear() runs", () => {
      const stack = new UndoStack();
      const discarded: string[] = [];

      stack.execute(noopCommand("a", () => discarded.push("a")));
      stack.execute(noopCommand("b", () => discarded.push("b")));
      stack.undo(); // "b" moves to _undone, "a" stays in _done

      stack.clear();

      expect(discarded.sort()).toEqual(["a", "b"]);
      expect(stack.canUndo).toBe(false);
      expect(stack.canRedo).toBe(false);
    });

    it("never calls discard() on a command still reachable via undo/redo", () => {
      const stack = new UndoStack();
      const discard = (): void => {
        throw new Error("must not be discarded while still reachable");
      };

      stack.execute(noopCommand("a", discard));
      stack.undo();
      stack.redo();

      expect(stack.canUndo).toBe(true);
    });

    it("tolerates commands with no discard() implementation (it's optional)", () => {
      const stack = new UndoStack();
      for (let i = 0; i < 55; i++) {
        stack.execute(noopCommand(`cmd-${i}`));
      }
      expect(() => stack.clear()).not.toThrow();
    });
  });
});
