// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { MakerKeyEvent, MakerKeyContext } from "../../src/maker/MakerKeymap.js";
import { MAKER_KEYMAP, dispatchMakerKey } from "../../src/maker/MakerKeymap.js";

/**
 * Safety net written straight from the pre-refactor `_onMakerKeyDown` if-chain
 * (thermo review wave 1, item 13): every pre-existing binding must still
 * resolve to exactly the same action, and the historical guards (editing
 * fields, empty selection, modifier exclusions, the decal stamp's
 * pass-through) must behave identically after the table-driven refactor.
 */

type Calls = Array<{ op: string; args?: unknown[] }>;

/** Faithful mock of DecalStampTool.handleKeyDown's actual decision logic. */
function makeDecalHandle(stamp: { active: boolean }, calls: Calls) {
  return (event: MakerKeyEvent): boolean => {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const key = event.key.toLowerCase();
    if ("d" === key) {
      event.preventDefault();
      stamp.active = !stamp.active;
      calls.push({ op: "decalToggle" });
      return true;
    }
    if (!stamp.active) return false;
    if ("escape" === key) {
      event.preventDefault();
      stamp.active = false;
      calls.push({ op: "decalDisable" });
      return true;
    }
    if (
      "r" === key ||
      "arrowleft" === key ||
      "arrowright" === key ||
      "arrowup" === key ||
      "arrowdown" === key
    ) {
      event.preventDefault();
      calls.push({ op: "decalTransform" });
      return true;
    }
    return false;
  };
}

interface Harness {
  ctx: MakerKeyContext;
  calls: Calls;
  stamp: { active: boolean };
  dispatch(event: Partial<MakerKeyEvent> & { key: string }): boolean;
}

function makeHarness(state: {
  editing?: boolean;
  decalActive?: boolean;
  drawingZone?: boolean;
  selectionSize?: number;
  hasPrimary?: boolean;
}): Harness {
  const calls: Calls = [];
  const stamp = { active: state.decalActive ?? false };
  const editing = state.editing ?? false;
  const selectionSize = state.selectionSize ?? 0;
  const hasPrimary = state.hasPrimary ?? false;

  const ctx: MakerKeyContext = {
    isEditingField: (): boolean => editing,
    isDecalStampActive: (): boolean => stamp.active,
    isDrawingZone: (): boolean => state.drawingZone ?? false,
    selectionSize: (): number => selectionSize,
    hasPrimary: (): boolean => hasPrimary,
    undo: (): void => {
      calls.push({ op: "undo" });
    },
    redo: (): void => {
      calls.push({ op: "redo" });
    },
    refreshSelectionAndHierarchy: (): void => {
      calls.push({ op: "refreshSelectionAndHierarchy" });
    },
    decalHandleKeyDown: makeDecalHandle(stamp, calls),
    decalDisable: (): void => {
      calls.push({ op: "decalDisable" });
    },
    zoneCancel: (): void => {
      calls.push({ op: "zoneCancel" });
    },
    zoneFinish: (): void => {
      calls.push({ op: "zoneFinish" });
    },
    zoneToggle: (): void => {
      calls.push({ op: "zoneToggle" });
    },
    deleteSelection: (): void => {
      calls.push({ op: "deleteSelection" });
    },
    startRenamingPrimary: (): void => {
      calls.push({ op: "startRenamingPrimary" });
    },
    focusSearch: (): void => {
      calls.push({ op: "focusSearch" });
    },
    duplicateSelection: (): void => {
      calls.push({ op: "duplicateSelection" });
    },
    groupSelection: (): void => {
      calls.push({ op: "groupSelection" });
    },
    toggleSnap: (): void => {
      calls.push({ op: "toggleSnap" });
    },
    saveCameraBookmark: (slot: number): void => {
      calls.push({ op: "saveCameraBookmark", args: [slot] });
    },
    jumpToCameraBookmark: (slot: number): void => {
      calls.push({ op: "jumpToCameraBookmark", args: [slot] });
    },
    setGizmoMode: (mode): void => {
      calls.push({ op: "setGizmoMode", args: [mode] });
    },
    stepGrid: (dir): void => {
      calls.push({ op: "stepGrid", args: [dir] });
    },
    snapSelectionToGround: (): void => {
      calls.push({ op: "snapSelectionToGround" });
    },
    nudgeSelection: (key, isShift, isAlt): void => {
      calls.push({ op: "nudgeSelection", args: [key, isShift, isAlt] });
    },
  };

  const dispatch = (event: Partial<MakerKeyEvent> & { key: string }): boolean => {
    const full: MakerKeyEvent = {
      key: event.key,
      ctrlKey: event.ctrlKey ?? false,
      metaKey: event.metaKey ?? false,
      shiftKey: event.shiftKey ?? false,
      altKey: event.altKey ?? false,
      preventDefault: vi.fn(),
    };
    if (event.preventDefault) Object.assign(full, { preventDefault: event.preventDefault });
    return dispatchMakerKey(full, ctx);
  };

  return { ctx, calls, stamp, dispatch };
}

const only = (calls: Calls, op: string): unknown[] | undefined =>
  calls.find((c) => c.op === op)?.args;

describe("MAKER_KEYMAP — table integrity", () => {
  it("has only unique, non-empty labels (future help overlay can list them)", () => {
    const labels = MAKER_KEYMAP.map((b) => b.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
  });

  it("exposes every binding with an action and a resolvable key source", () => {
    for (const binding of MAKER_KEYMAP) {
      expect(typeof binding.action).toBe("function");
      expect(binding.key.length).toBeGreaterThan(0);
      const hasSource =
        binding.numericRange !== undefined ||
        binding.matchAnyKey === true ||
        binding.key.length > 0;
      expect(hasSource).toBe(true);
    }
  });
});

describe("MAKER_KEYMAP — undo / redo (Ctrl|Cmd+Z path)", () => {
  it("Ctrl+Z undoes and refreshes the selection & hierarchy", () => {
    const h = makeHarness({ selectionSize: 2 });
    const prevented = vi.fn();
    const handled = h.dispatch({ key: "z", ctrlKey: true, preventDefault: prevented });
    expect(handled).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["undo", "refreshSelectionAndHierarchy"]);
  });

  it("Cmd+Z behaves like Ctrl+Z", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "z", metaKey: true })).toBe(true);
    expect(h.calls.map((c) => c.op)).toEqual(["undo", "refreshSelectionAndHierarchy"]);
  });

  it("Ctrl+Shift+Z redoes", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(h.calls.map((c) => c.op)).toEqual(["redo", "refreshSelectionAndHierarchy"]);
  });

  it("Ctrl+Z while editing a field is a no-op (no preventDefault)", () => {
    const h = makeHarness({ editing: true });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "z", ctrlKey: true, preventDefault: prevented })).toBe(false);
    expect(prevented).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("Ctrl+Z wins over the decal stamp intercept (old block order)", () => {
    const h = makeHarness({ decalActive: true, selectionSize: 1 });
    expect(h.dispatch({ key: "z", ctrlKey: true })).toBe(true);
    expect(h.calls.map((c) => c.op)).toEqual(["undo", "refreshSelectionAndHierarchy"]);
  });
});

describe("MAKER_KEYMAP — decal stamp (D / active tool)", () => {
  it("plain D toggles the stamp (and cancels a stray zone draw first)", () => {
    const h = makeHarness({ drawingZone: true });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "d", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op).sort()).toEqual(["decalToggle", "zoneCancel"]);
  });

  it("an active stamp claims the keys it handles (Arrows no longer nudge)", () => {
    const h = makeHarness({ decalActive: true, selectionSize: 1 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "ArrowUp", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["decalTransform"]);
  });

  it("an active stamp returns unhandled keys to the rest of the table", () => {
    const h = makeHarness({ decalActive: true, selectionSize: 1 });
    // "z" is not a stamp key while active -> falls through to "toggle zone draw"
    expect(h.dispatch({ key: "z" })).toBe(true);
    expect(h.calls.map((c) => c.op)).toEqual(["decalDisable", "zoneToggle"]);
  });

  it("an active stamp + editing field blocks everything", () => {
    const h = makeHarness({ decalActive: true, editing: true });
    expect(h.dispatch({ key: "ArrowUp" })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("Ctrl+D with decal inactive falls through to duplicate selection", () => {
    const h = makeHarness({ selectionSize: 2 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "d", ctrlKey: true, preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["duplicateSelection"]);
  });
});

describe("MAKER_KEYMAP — zone drawing (Escape / Enter)", () => {
  it("Escape cancels a zone in progress even while an input field is focused", () => {
    const h = makeHarness({ drawingZone: true, editing: true });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "Escape", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["zoneCancel"]);
  });

  it("Enter finishes a zone in progress", () => {
    const h = makeHarness({ drawingZone: true });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "Enter", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["zoneFinish"]);
  });

  it("Escape/Enter do nothing when no zone is being drawn", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "Escape" })).toBe(false);
    expect(h.dispatch({ key: "Enter" })).toBe(false);
    expect(h.calls).toEqual([]);
  });
});

describe("MAKER_KEYMAP — selection edit (Z / Delete / F2 / control letters)", () => {
  it("plain Z toggles zone draw mode", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "z", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["decalDisable", "zoneToggle"]);
  });

  it("Delete removes the selection", () => {
    const h = makeHarness({ selectionSize: 1 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "Delete", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["deleteSelection"]);
  });

  it("Backspace removes the selection, too", () => {
    const h = makeHarness({ selectionSize: 1 });
    expect(h.dispatch({ key: "Backspace" })).toBe(true);
    expect(h.calls.map((c) => c.op)).toEqual(["deleteSelection"]);
  });

  it("Delete with empty selection is a no-op without preventDefault", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "Delete", preventDefault: prevented })).toBe(false);
    expect(prevented).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("Delete while editing a field leaves the key to the browser", () => {
    const h = makeHarness({ editing: true, selectionSize: 1 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "Backspace", preventDefault: prevented })).toBe(false);
    expect(prevented).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("F2 renames the primary object", () => {
    const h = makeHarness({ hasPrimary: true });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "F2", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["startRenamingPrimary"]);
  });

  it("F2 without a primary object is a no-op", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "F2" })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("Ctrl+F focuses the hierarchy search", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "f", ctrlKey: true, preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["focusSearch"]);
  });

  it("Ctrl+G groups the selection", () => {
    const h = makeHarness({ selectionSize: 3 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "g", ctrlKey: true, preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["groupSelection"]);
  });

  it("Ctrl+D with empty selection does nothing", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "d", ctrlKey: true })).toBe(false);
    expect(h.calls).toEqual([]);
  });
});

describe("MAKER_KEYMAP — gizmo / toolbar (X / W E R / [ ] / digits)", () => {
  it("plain X toggles snap (no preventDefault, like the original)", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "x", preventDefault: prevented })).toBe(true);
    expect(prevented).not.toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["toggleSnap"]);
  });

  it("Ctrl+X is a no-op (cut stays untouched)", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "x", ctrlKey: true })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("Alt+X is a no-op", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "x", altKey: true })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("W/E/R set the gizmo mode", () => {
    const hw = makeHarness({});
    hw.dispatch({ key: "w" });
    expect(hw.calls.map((c) => c.op)).toEqual(["setGizmoMode"]);
    expect(only(hw.calls, "setGizmoMode")).toEqual(["translate"]);

    const he = makeHarness({});
    he.dispatch({ key: "e" });
    expect(only(he.calls, "setGizmoMode")).toEqual(["rotate"]);

    const hr = makeHarness({});
    hr.dispatch({ key: "r" });
    expect(only(hr.calls, "setGizmoMode")).toEqual(["scale"]);
  });

  it("Ctrl+E is a no-op", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "e", ctrlKey: true })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("[ and ] step the grid down/up", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "[", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(only(h.calls, "stepGrid")).toEqual([-1]);

    const h2 = makeHarness({});
    expect(h2.dispatch({ key: "]" })).toBe(true);
    expect(only(h2.calls, "stepGrid")).toEqual([1]);
  });

  it("plain digit jumps to the camera bookmark", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "5", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["jumpToCameraBookmark"]);
    expect(only(h.calls, "jumpToCameraBookmark")).toEqual([5]);
  });

  it("Ctrl/Cmd+digit saves the camera bookmark", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "3", ctrlKey: true })).toBe(true);
    expect(only(h.calls, "saveCameraBookmark")).toEqual([3]);
  });

  it("Alt+digit is a no-op", () => {
    const h = makeHarness({});
    expect(h.dispatch({ key: "4", altKey: true })).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("digits while editing a field are a no-op", () => {
    const h = makeHarness({ editing: true });
    expect(h.dispatch({ key: "2" })).toBe(false);
    expect(h.calls).toEqual([]);
  });
});

describe("MAKER_KEYMAP — End / arrows (transform nudging)", () => {
  it("End snaps the selection to the ground", () => {
    const h = makeHarness({ selectionSize: 2 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "End", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["snapSelectionToGround"]);
  });

  it("End with empty selection does nothing", () => {
    const h = makeHarness({});
    const prevented = vi.fn();
    expect(h.dispatch({ key: "End", preventDefault: prevented })).toBe(false);
    expect(prevented).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("ArrowDown nudges the selection (the documented arrow-nudge path)", () => {
    const h = makeHarness({ selectionSize: 1 });
    const prevented = vi.fn();
    expect(h.dispatch({ key: "ArrowDown", preventDefault: prevented })).toBe(true);
    expect(prevented).toHaveBeenCalled();
    expect(h.calls.map((c) => c.op)).toEqual(["nudgeSelection"]);
    expect(only(h.calls, "nudgeSelection")).toEqual(["ArrowDown", false, false]);
  });

  it("Shift+ArrowUp nudges with the shift multiplier", () => {
    const h = makeHarness({ selectionSize: 1 });
    expect(h.dispatch({ key: "ArrowUp", shiftKey: true })).toBe(true);
    expect(only(h.calls, "nudgeSelection")).toEqual(["ArrowUp", true, false]);
  });

  it("Alt+ArrowUp requests an Alt-mode nudge", () => {
    const h = makeHarness({ selectionSize: 1 });
    expect(h.dispatch({ key: "ArrowUp", altKey: true })).toBe(true);
    expect(only(h.calls, "nudgeSelection")).toEqual(["ArrowUp", false, true]);
  });

  it("PageDown nudges too", () => {
    const h = makeHarness({ selectionSize: 1 });
    expect(h.dispatch({ key: "PageDown" })).toBe(true);
    expect(only(h.calls, "nudgeSelection")).toEqual(["PageDown", false, false]);
  });

  it("arrows while editing a field are a no-op", () => {
    const h = makeHarness({ editing: true, selectionSize: 1 });
    expect(h.dispatch({ key: "ArrowDown" })).toBe(false);
    expect(h.calls).toEqual([]);
  });
});
