// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { MaterialStudioController } from "../../src/material-studio/MaterialStudioController.js";
import { buildMaterialStudioUI } from "../../src/material-studio/MaterialStudioUiBuilder.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("MaterialStudioController dispose", () => {
  it("removes the window-level drop and paste listeners the dropzone added in bind()", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    buildMaterialStudioUI(host);
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const controller = new MaterialStudioController();

    controller.bind();
    const registered = added.mock.calls.filter(([type]) => type === "drop" || type === "paste");
    expect(registered.length).toBeGreaterThan(0);

    controller.dispose();
    for (const [type, handler] of registered) {
      expect(removed).toHaveBeenCalledWith(type, handler);
    }
  });

  it("is safe to dispose a controller that never bound", () => {
    expect(() => new MaterialStudioController().dispose()).not.toThrow();
  });
});
