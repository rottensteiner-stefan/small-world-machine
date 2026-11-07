// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import type { MakerKeyContext, MakerKeyEvent } from "../../src/maker/MakerKeymap.js";
import { dispatchMakerKey } from "../../src/maker/MakerKeymap.js";
import { DecalStampTool } from "../../src/maker/DecalStampTool.js";

/**
 * Auto-repeat handling, Ctrl+Arrow/Ctrl+Y rules and the zone-abort rule driven
 * against the REAL DecalStampTool (not a mock of its decision logic).
 */

type Fns = Record<
  | "undo"
  | "redo"
  | "zoneCancel"
  | "zoneToggle"
  | "toggleSnap"
  | "duplicateSelection"
  | "nudgeSelection"
  | "stepGrid"
  | "deleteSelection"
  | "decalDisable",
  Mock<(...args: never[]) => void>
>;

function makeStamp(): DecalStampTool {
  return new DecalStampTool({
    raycast: () => undefined,
    scene: { add: vi.fn(), remove: vi.fn() },
    hydrate: async () => true,
    addObject: vi.fn(),
    getNudgeStep: () => 0.1,
    getScaleStep: () => 0.25,
    setStatus: vi.fn(),
  });
}

function makeCtx(opts: { drawingZone?: boolean; selection?: number; stamp?: DecalStampTool }): {
  ctx: MakerKeyContext;
  fn: Fns;
} {
  const stamp = opts.stamp ?? makeStamp();
  const fn: Fns = {
    undo: vi.fn(),
    redo: vi.fn(),
    zoneCancel: vi.fn(),
    zoneToggle: vi.fn(),
    toggleSnap: vi.fn(),
    duplicateSelection: vi.fn(),
    nudgeSelection: vi.fn(),
    stepGrid: vi.fn(),
    deleteSelection: vi.fn(),
    decalDisable: vi.fn(),
  };
  const noop = (): void => {};
  const ctx: MakerKeyContext = {
    isEditingField: () => false,
    isDecalStampActive: () => stamp.isActive,
    isDrawingZone: () => opts.drawingZone ?? false,
    selectionSize: () => opts.selection ?? 0,
    hasPrimary: () => false,
    undo: fn.undo,
    redo: fn.redo,
    refreshSelectionAndHierarchy: noop,
    decalHandleKeyDown: (e) => stamp.handleKeyDown(e as KeyboardEvent),
    decalDisable: fn.decalDisable,
    zoneCancel: fn.zoneCancel,
    zoneFinish: noop,
    zoneToggle: fn.zoneToggle,
    deleteSelection: fn.deleteSelection,
    startRenamingPrimary: noop,
    focusSearch: noop,
    duplicateSelection: fn.duplicateSelection,
    groupSelection: noop,
    toggleSnap: fn.toggleSnap,
    saveCameraBookmark: noop,
    jumpToCameraBookmark: noop,
    setGizmoMode: noop,
    stepGrid: fn.stepGrid,
    snapSelectionToGround: noop,
    nudgeSelection: fn.nudgeSelection,
  };
  return { ctx, fn };
}

function ev(key: string, extra: Partial<MakerKeyEvent> = {}): MakerKeyEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...extra,
  };
}

describe("MAKER_KEYMAP — key auto-repeat", () => {
  it("a held toggle key fires once, repeats are swallowed", () => {
    const { ctx, fn } = makeCtx({});
    expect(dispatchMakerKey(ev("x"), ctx)).toBe(true);
    for (let i = 0; i < 10; i++)
      expect(dispatchMakerKey(ev("x", { repeat: true }), ctx)).toBe(true);
    expect(fn.toggleSnap).toHaveBeenCalledTimes(1);
  });

  it("a held 'z' toggles the zone once", () => {
    const { ctx, fn } = makeCtx({});
    dispatchMakerKey(ev("z"), ctx);
    dispatchMakerKey(ev("z", { repeat: true }), ctx);
    expect(fn.zoneToggle).toHaveBeenCalledTimes(1);
  });

  it("a held 'd' toggles the real decal stamp once", () => {
    const stamp = makeStamp();
    const { ctx } = makeCtx({ stamp });
    dispatchMakerKey(ev("d"), ctx);
    expect(stamp.isActive).toBe(true);
    for (let i = 0; i < 5; i++) dispatchMakerKey(ev("d", { repeat: true }), ctx);
    expect(stamp.isActive).toBe(true);
  });

  it("held Delete / Ctrl+D fire once", () => {
    const { ctx, fn } = makeCtx({ selection: 2 });
    dispatchMakerKey(ev("Delete"), ctx);
    dispatchMakerKey(ev("Delete", { repeat: true }), ctx);
    dispatchMakerKey(ev("d", { ctrlKey: true }), ctx);
    dispatchMakerKey(ev("d", { ctrlKey: true, repeat: true }), ctx);
    expect(fn.deleteSelection).toHaveBeenCalledTimes(1);
    expect(fn.duplicateSelection).toHaveBeenCalledTimes(1);
  });

  it("nudge, grid step and undo keep auto-repeating", () => {
    const { ctx, fn } = makeCtx({ selection: 1 });
    dispatchMakerKey(ev("ArrowLeft", { repeat: true }), ctx);
    dispatchMakerKey(ev("]", { repeat: true }), ctx);
    dispatchMakerKey(ev("z", { ctrlKey: true, repeat: true }), ctx);
    expect(fn.nudgeSelection).toHaveBeenCalledTimes(1);
    expect(fn.stepGrid).toHaveBeenCalledTimes(1);
    expect(fn.undo).toHaveBeenCalledTimes(1);
  });
});

describe("MAKER_KEYMAP — Ctrl/Cmd modifiers", () => {
  it("Ctrl/Cmd+Arrow is left to the browser (no nudge, no preventDefault)", () => {
    const { ctx, fn } = makeCtx({ selection: 1 });
    const e = ev("ArrowLeft", { ctrlKey: true });
    expect(dispatchMakerKey(e, ctx)).toBe(false);
    expect(dispatchMakerKey(ev("ArrowRight", { metaKey: true }), ctx)).toBe(false);
    expect(fn.nudgeSelection).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("Ctrl+Y redoes", () => {
    const { ctx, fn } = makeCtx({});
    expect(dispatchMakerKey(ev("y", { ctrlKey: true }), ctx)).toBe(true);
    expect(fn.redo).toHaveBeenCalledTimes(1);
  });
});

describe("MAKER_KEYMAP — zone drawing vs the real decal stamp", () => {
  it("Ctrl+D while drawing a zone duplicates and does NOT abort the zone", () => {
    const { ctx, fn } = makeCtx({ drawingZone: true, selection: 1 });
    expect(dispatchMakerKey(ev("d", { ctrlKey: true }), ctx)).toBe(true);
    expect(fn.duplicateSelection).toHaveBeenCalledTimes(1);
    expect(fn.zoneCancel).not.toHaveBeenCalled();
  });

  it("a bare Shift keydown with the stamp active does not abort the zone", () => {
    const stamp = makeStamp();
    stamp.toggle();
    const { ctx, fn } = makeCtx({ drawingZone: true, stamp });
    dispatchMakerKey(ev("Shift", { shiftKey: true }), ctx);
    expect(fn.zoneCancel).not.toHaveBeenCalled();
  });

  it("a key the stamp consumes (D) still cancels a zone in progress", () => {
    const { ctx, fn } = makeCtx({ drawingZone: true });
    dispatchMakerKey(ev("d"), ctx);
    expect(fn.zoneCancel).toHaveBeenCalledTimes(1);
  });
});
