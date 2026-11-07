// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isActiveToolHost } from "../../src/common/io/ui/toolHost.js";

/** jsdom has no layout: fake a box so `getClientRects()` reports the window as shown or hidden. */
function createWindow(zIndex: string, visible: boolean): { win: HTMLElement; tool: HTMLElement } {
  const win = document.createElement("div");
  win.className = "swf-window";
  win.style.zIndex = zIndex;
  win.getClientRects = (): DOMRectList =>
    (visible ? [new DOMRect(0, 0, 10, 10)] : []) as unknown as DOMRectList;
  const tool = document.createElement("div");
  win.appendChild(tool);
  document.body.appendChild(win);
  return { win, tool };
}

describe("isActiveToolHost", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is always active outside a Forge window", () => {
    const standalone = document.createElement("div");
    document.body.appendChild(standalone);
    expect(isActiveToolHost(standalone)).toBe(true);
  });

  it("is active for the topmost visible Forge window only", () => {
    const lower = createWindow("3", true);
    const upper = createWindow("7", true);
    expect(isActiveToolHost(upper.tool)).toBe(true);
    expect(isActiveToolHost(lower.tool)).toBe(false);
  });

  it("ignores hidden windows when looking for the topmost one", () => {
    const shown = createWindow("3", true);
    createWindow("9", false);
    expect(isActiveToolHost(shown.tool)).toBe(true);
  });

  it("is inactive while its own window (or the whole Forge) is hidden", () => {
    const hidden = createWindow("5", false);
    expect(isActiveToolHost(hidden.tool)).toBe(false);
  });
});
