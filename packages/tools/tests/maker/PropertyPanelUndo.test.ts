// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Object3D } from "@small-world-machine/engine";
import { PropertyPanel } from "../../src/maker/PropertyPanel.js";
import { UndoStack } from "../../src/maker/UndoStack.js";

function nameInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="text"]') as HTMLInputElement | null;
  if (!input) throw new Error("name input not rendered");
  return input;
}

function edit(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("PropertyPanel undo base + notifications", () => {
  it("edit A->B, undo, edit A->C, undo lands on A (not B); one notify per edit", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const undo = new UndoStack();
    const onPropertyChanged = vi.fn();
    const panel = new PropertyPanel(container, undo, { onPropertyChanged });
    const obj = new Object3D("A");
    panel.setSelection(obj);

    edit(nameInput(container), "B");
    expect(obj.name).toBe("B");
    expect(onPropertyChanged).toHaveBeenCalledTimes(1);

    undo.undo();
    expect(obj.name).toBe("A");

    onPropertyChanged.mockClear();
    edit(nameInput(container), "C");
    expect(obj.name).toBe("C");
    expect(onPropertyChanged).toHaveBeenCalledTimes(1);

    undo.undo();
    expect(obj.name).toBe("A");
  });
});
