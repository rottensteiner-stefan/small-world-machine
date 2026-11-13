// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Forge } from "../src/forge/Forge.js";
import { TestForgeTool } from "./testForgeTool.js";

class StubResizeObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

describe("Forge", () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    localStorage.clear();
  });

  it("should inject its theme stylesheet only once even across multiple instances", () => {
    new Forge();
    new Forge();
    expect(document.querySelectorAll("#sw-forge-style").length).toBe(1);
  });

  it("does not toggle on mousedown alone and keeps the press away from the scene", () => {
    const forge = new Forge();
    const win = forge.openWindow("Tool A", new TestForgeTool());
    win.toggleVisibility(true);
    let reachedScene = false;
    document.body.addEventListener("mousedown", () => (reachedScene = true), { once: true });

    const btn = document.querySelector(".swf-taskbar-btn") as HTMLElement;
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(win.isVisible).toBe(true);
    expect(reachedScene).toBe(false);
  });

  describe("destroy() (listener leak fix)", () => {
    it("destroys every open window and removes the overlay from the DOM", () => {
      const forge = new Forge();
      const winA = forge.openWindow("Tool A", new TestForgeTool());
      const winB = forge.openWindow("Tool B", new TestForgeTool());

      forge.destroy();

      expect(document.querySelector(".swf-forge-overlay")).toBeNull();
      expect(document.body.contains(winA.getElement())).toBe(false);
      expect(document.body.contains(winB.getElement())).toBe(false);
      expect(forge.windows.length).toBe(0);
    });

    it("removes its own keydown toggle listener so the hotkey no longer does anything", () => {
      const forge = new Forge({ toggleKey: "F12" });
      forge.destroy();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12" }));

      expect(forge.isVisible).toBe(false);
    });

    it("removes its own paste listener", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const forge = new Forge();

      forge.destroy();

      expect(removeSpy).toHaveBeenCalledWith("paste", expect.any(Function));
    });
  });
});
