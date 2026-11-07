// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

describe("ShowcaseDrawer release events", () => {
  const drawer = new ShowcaseDrawer({ id: "t-drawer", icon: "x", title: "t", showPerf: false });

  it.each(["mouseup", "pointerup", "touchend"])(
    "%s released inside the drawer still reaches window listeners",
    (type) => {
      const onWindow = vi.fn();
      window.addEventListener(type, onWindow);
      drawer.root.dispatchEvent(new Event(type, { bubbles: true }));
      window.removeEventListener(type, onWindow);
      expect(onWindow).toHaveBeenCalledTimes(1);
    },
  );

  it("still shields mousedown so the camera does not start a drag from the drawer", () => {
    const onWindow = vi.fn();
    window.addEventListener("mousedown", onWindow);
    drawer.root.dispatchEvent(new Event("mousedown", { bubbles: true }));
    window.removeEventListener("mousedown", onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });
});
