// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HudPointerGuard } from "../shared/HudPointerGuard.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HudPointerGuard", () => {
  const setup = (): {
    root: HTMLElement;
    guard: HudPointerGuard;
    mouse: { dx: number; dy: number; zoom: number; left: boolean };
    onEngage: ReturnType<typeof vi.fn>;
    onRelease: ReturnType<typeof vi.fn>;
    abort: AbortController;
  } => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const mouse = { dx: 5, dy: 6, zoom: 7, left: true };
    const onEngage = vi.fn();
    const onRelease = vi.fn();
    const abort = new AbortController();
    const guard = new HudPointerGuard({
      root,
      input: { mouse },
      signal: abort.signal,
      onEngage,
      onRelease,
    });
    return { root, guard, mouse, onEngage, onRelease, abort };
  };
  const ptr = (type: string, buttons = 0): Event => new MouseEvent(type, { buttons });

  it("hover engages and a button-less leave releases", () => {
    const { root, guard, onEngage, onRelease } = setup();
    root.dispatchEvent(ptr("pointerenter"));
    expect(guard.blocking).toBe(true);
    expect(onEngage).toHaveBeenCalledTimes(1);
    root.dispatchEvent(ptr("pointerleave"));
    expect(guard.blocking).toBe(false);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("a press clears mouse deltas and keeps the guard engaged when leaving mid-drag", () => {
    const { root, guard, mouse, onRelease } = setup();
    root.dispatchEvent(ptr("pointerdown", 1));
    expect(mouse).toEqual({ dx: 0, dy: 0, zoom: 0, left: false });
    expect(guard.dragging).toBe(true);
    root.dispatchEvent(ptr("pointerleave", 1));
    expect(guard.blocking).toBe(true);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("pointerup outside the panel ends the drag and releases once", () => {
    const { root, guard, onRelease } = setup();
    root.dispatchEvent(ptr("pointerdown", 1));
    window.dispatchEvent(ptr("pointerup"));
    expect(guard.blocking).toBe(false);
    expect(onRelease).toHaveBeenCalledTimes(1);
    window.dispatchEvent(ptr("pointerup"));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("abort signal detaches the window listener; reset clears both flags", () => {
    const { root, guard, abort, onRelease } = setup();
    root.dispatchEvent(ptr("pointerdown", 1));
    abort.abort();
    window.dispatchEvent(ptr("pointerup"));
    expect(guard.dragging).toBe(true);
    expect(onRelease).not.toHaveBeenCalled();
    guard.reset();
    expect(guard.blocking).toBe(false);
  });
});
