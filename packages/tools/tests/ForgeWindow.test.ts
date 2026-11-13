// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ForgeWindow } from "../src/forge/ForgeWindow.js";
import { TestForgeTool } from "./testForgeTool.js";

// jsdom doesn't implement ResizeObserver -- ForgeWindow.mountTool() only needs .observe() to
// exist, it never asserts on resize callbacks in these tests.
class StubResizeObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

describe("ForgeWindow", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
    parent = document.createElement("div");
    document.body.appendChild(parent);
    localStorage.clear();
  });

  it("should toggle visibility and persist the new state to localStorage", () => {
    const win = new ForgeWindow("My Tool", parent, 0, 0, "my-tool-key");
    expect(win.isVisible).toBe(true); // display is "" (not "none") by default

    win.toggleVisibility(false);
    expect(win.isVisible).toBe(false);
    expect(localStorage.getItem("swf_win_my-tool-key")).toBe("0");

    win.toggleVisibility(true);
    expect(win.isVisible).toBe(true);
    expect(localStorage.getItem("swf_win_my-tool-key")).toBe("1");
  });

  it("should restore visibility from a previously persisted state", () => {
    localStorage.setItem("swf_win_restore-key", "0");
    const win = new ForgeWindow("My Tool", parent, 0, 0, "restore-key");
    win.restoreState();
    expect(win.isVisible).toBe(false);
  });

  it("should default to hidden when no persisted state exists", () => {
    const win = new ForgeWindow("My Tool", parent, 0, 0, "never-seen-key");
    win.restoreState();
    expect(win.isVisible).toBe(false);
  });

  it("pulls a window back on screen when it is shown at an off-screen position", () => {
    const win = new ForgeWindow("My Tool", parent, 5000, 4000);
    win.toggleVisibility(true);
    const el = win.getElement();
    expect(parseInt(el.style.left, 10)).toBeLessThan(window.innerWidth);
    expect(parseInt(el.style.top, 10)).toBeLessThan(window.innerHeight);
    expect(parseInt(el.style.left, 10)).toBeGreaterThanOrEqual(0);
    expect(parseInt(el.style.top, 10)).toBeGreaterThanOrEqual(0);
  });

  it("keeps a window that is already on screen where it is", () => {
    const win = new ForgeWindow("My Tool", parent, 40, 60);
    win.toggleVisibility(true);
    expect(win.getElement().style.left).toBe("40px");
    expect(win.getElement().style.top).toBe("60px");
  });

  it("closes on a click of the close button, not on the mousedown", () => {
    const win = new ForgeWindow("My Tool", parent);
    win.toggleVisibility(true);
    const closeBtn = win.getElement().querySelector(".swf-window-close") as HTMLElement;

    closeBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(win.isVisible).toBe(true);

    closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(win.isVisible).toBe(false);
  });

  it("should unmount its tool and remove itself from the DOM on destroy", () => {
    const win = new ForgeWindow("My Tool", parent);
    const tool = new TestForgeTool();
    win.mountTool(tool);

    win.destroy();

    expect(parent.contains(win.getElement())).toBe(false);
    expect(tool.getContainer().parentNode).toBeNull();
  });

  describe("window listener/ResizeObserver cleanup on destroy (leak fix)", () => {
    it("removes every window-level mousemove/mouseup listener registered for drag + all 4 resize handles", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const win = new ForgeWindow("My Tool", parent);

      const registered = addSpy.mock.calls.filter(
        ([type]) => type === "mousemove" || type === "mouseup",
      );
      // 1 drag handler pair + 4 resize-handle handler pairs = 10 window listeners total.
      expect(registered.length).toBe(10);

      win.destroy();

      for (const [type, handler] of registered) {
        expect(removeSpy).toHaveBeenCalledWith(type, handler);
      }
    });

    it("disconnects the ResizeObserver created for a mounted tool", () => {
      const disconnect = vi.fn();
      class SpyResizeObserver {
        public observe(): void {}
        public unobserve(): void {}
        public disconnect(): void {
          disconnect();
        }
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = SpyResizeObserver;

      const win = new ForgeWindow("My Tool", parent);
      win.mountTool(new TestForgeTool());

      win.destroy();

      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("does not leave dangling drag behavior active after destroy (dragging no longer moves a destroyed window)", () => {
      const win = new ForgeWindow("My Tool", parent, 10, 10);
      const el = win.getElement();
      const header = el.querySelector(".swf-window-header") as HTMLElement;

      header.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0 }));
      win.destroy();

      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 100 }));

      expect(el.style.left).toBe("10px");
    });

    it("registers touchstart and wheel event listeners on the window element with passive: true", () => {
      const addSpy = vi.spyOn(HTMLDivElement.prototype, "addEventListener");
      const win = new ForgeWindow("My Tool", parent);
      const el = win.getElement();

      const touchStartCall = addSpy.mock.calls.find(
        (call) => call[0] === "touchstart" && addSpy.mock.instances.includes(el),
      );
      expect(touchStartCall).toBeDefined();
      expect(touchStartCall?.[2]).toEqual({ passive: true });

      const wheelCall = addSpy.mock.calls.find(
        (call) => call[0] === "wheel" && addSpy.mock.instances.includes(el),
      );
      expect(wheelCall).toBeDefined();
      expect(wheelCall?.[2]).toEqual({ passive: true });

      addSpy.mockRestore();
    });
  });
});
