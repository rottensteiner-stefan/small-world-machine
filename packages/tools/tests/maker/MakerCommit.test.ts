// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { UndoStack } from "../../src/maker/UndoStack.js";
import type { MakerUndoCommand } from "../../src/maker/MakerUndoCore.js";
import { createMakerCommandRunner } from "../../src/maker/MakerUndoCore.js";

/**
 * Ordering-contract safety net for the Maker undo sites (thermo review wave 1,
 * item 17): redo runs once, the shared follow-up runs once per (re-)application,
 * and an undo/redo round trip restores before/after. The runner is
 * dependencies-injected precisely so this contract is testable without a full
 * `MakerApp` (the >25 call sites delegate to it).
 */

describe("MakerUndoCore — commit ordering contract", () => {
  it("applies redo once and the shared follow-up once, synchronously", () => {
    const stack = new UndoStack();
    let followUp = 0;
    let value = 0;
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => {
        followUp++;
      },
    });

    runner.commit(
      "Increment",
      () => (value += 1),
      () => (value -= 1),
    );

    expect(value).toBe(1);
    expect(followUp).toBe(1);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it("runs the follow-up exactly once per undo/redo application (round trip)", () => {
    const stack = new UndoStack();
    let followUp = 0;
    let value = 0;
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => {
        followUp++;
      },
    });

    runner.commit(
      "Increment",
      () => (value += 1),
      () => (value -= 1),
    );

    stack.undo();
    expect(value).toBe(0);
    expect(followUp).toBe(2);

    stack.redo();
    expect(value).toBe(1);
    expect(followUp).toBe(3);

    stack.undo();
    stack.undo(); // no-op past the bottom
    expect(value).toBe(0);
    expect(followUp).toBe(4);
  });

  it("redo and undo closures run exactly once per application (no double dispatch)", () => {
    const stack = new UndoStack();
    const redo = vi.fn();
    const undo = vi.fn();
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => undefined,
    });

    runner.commit("Tick", redo, undo);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(0);

    stack.undo();
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);

    stack.redo();
    expect(redo).toHaveBeenCalledTimes(2);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("forwards a discard() to the undo stack (that stack still calls it on eviction)", () => {
    const stack = new UndoStack();
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => undefined,
    });
    const discard = vi.fn();

    for (let i = 0; i < 51; i++) {
      runner.commit(
        `cmd-${i}`,
        () => undefined,
        () => undefined,
        i === 0 ? discard : undefined,
      );
    }

    // The very first (oldest) command is evicted once the 50-cap is hit.
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("omits discard when none is given (optional contract)", () => {
    const executed: MakerUndoCommand[] = [];
    const runner = createMakerCommandRunner({
      execute: (command) => {
        executed.push(command);
        command.redo();
      },
      afterApply: () => undefined,
    });

    runner.commit(
      "No discard",
      () => undefined,
      () => undefined,
    );

    expect(executed).toHaveLength(1);
    expect(executed[0]!.discard).toBeUndefined();
  });
});

describe("MakerUndoCore — snapshotCommand contract", () => {
  it("captures before/after and restores on undo, then redo", () => {
    const stack = new UndoStack();
    let followUp = 0;
    const obj = { value: 0, updateMatrixWorld: vi.fn() };
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => {
        followUp++;
      },
    });

    runner.snapshotCommand(
      [obj],
      (o) => o.value,
      (o, value) => {
        o.value = value;
      },
      "Move",
      () => {
        obj.value = 42;
      },
    );

    // Target state is reached at commit time (rerun of the redo payload).
    expect(obj.value).toBe(42);
    expect(followUp).toBe(1);

    // Undo restores the captured pre-state.
    stack.undo();
    expect(obj.value).toBe(0);
    expect(followUp).toBe(2);

    // Redo restores the captured post-state without re-running `apply`.
    stack.redo();
    expect(obj.value).toBe(42);
    expect(followUp).toBe(3);
  });

  it("applies the redo payload after every redo path (multiple snapshots round trip)", () => {
    const stack = new UndoStack();
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => undefined,
    });
    const objs = [
      { value: 0, updateMatrixWorld: vi.fn() },
      { value: 10, updateMatrixWorld: vi.fn() },
    ];

    runner.snapshotCommand(
      objs,
      (o) => o.value,
      (o, value) => {
        o.value = value;
      },
      "Move 2",
      () => {
        objs[0]!.value = 100;
        objs[1]!.value = 200;
      },
    );

    expect(objs[0]!.value).toBe(100);
    expect(objs[1]!.value).toBe(200);

    stack.undo();
    expect(objs[0]!.value).toBe(0);
    expect(objs[1]!.value).toBe(10);

    stack.redo();
    expect(objs[0]!.value).toBe(100);
    expect(objs[1]!.value).toBe(200);
  });

  it("updates the world matrix of every object on every application", () => {
    const stack = new UndoStack();
    const obj = { value: 0, updateMatrixWorld: vi.fn() };
    const runner = createMakerCommandRunner({
      execute: (command) => stack.execute(command),
      afterApply: () => undefined,
    });

    runner.snapshotCommand(
      [obj],
      (o) => o.value,
      (o, value) => {
        o.value = value;
      },
      "Move",
      () => {
        obj.value = 1;
      },
    );

    stack.undo();
    stack.redo();

    // redo at commit + redo after undo + the undo (1 + 1 + 1).
    expect(obj.updateMatrixWorld).toHaveBeenCalledTimes(3);
  });
});
