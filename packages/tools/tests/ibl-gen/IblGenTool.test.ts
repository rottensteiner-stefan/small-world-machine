// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { IblGenTool } from "../../src/ibl-gen/IblGenTool.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("IblGenTool", () => {
  it("mounts with Bake and Export disabled and creates no GL context until a bake", () => {
    const canvasSpy = vi.spyOn(document, "createElement");
    const host = document.createElement("div");
    document.body.appendChild(host);

    const tool = new IblGenTool({ parent: host });

    expect(host.querySelector(".iblgen")).not.toBeNull();
    expect((host.querySelector('[data-ibl="generate"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[data-ibl="export"]') as HTMLButtonElement).disabled).toBe(true);
    // The preview cards hold their own canvases; the baker's hidden canvas must not exist yet.
    const hiddenCanvases = canvasSpy.mock.calls.filter(([tag]) => tag === "canvas");
    expect(hiddenCanvases.length).toBe(0);
    tool.unmount();
  });

  it("removes its DOM and the dropzone's window listeners on unmount", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");

    const tool = new IblGenTool({ parent: host });
    const registered = added.mock.calls.filter(([type]) => type === "drop" || type === "paste");
    expect(registered.length).toBeGreaterThan(0);

    tool.unmount();

    expect(host.children.length).toBe(0);
    for (const [type, handler] of registered) {
      expect(removed).toHaveBeenCalledWith(type, handler);
    }
  });
});
