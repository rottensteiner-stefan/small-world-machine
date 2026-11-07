// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HudPointerGuard } from "../shared/HudPointerGuard.js";
import { bindRange } from "../shared/hudBindings.js";
import { formatSlider } from "../42/Hud.js";
import { Hud as Hud45, defaultHudState as state45 } from "../45/Hud.js";
import { Hud as Hud46, defaultHudState as state46 } from "../46/Hud.js";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

const key = (code: string, k = ""): KeyboardEvent => new KeyboardEvent("keydown", { code, key: k });

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

describe("bindRange", () => {
  const range = (value: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "10";
    input.value = value;
    return input;
  };

  it("forwards the parsed number and writes the formatted label", () => {
    const input = range("3");
    const label = document.createElement("span");
    const cb = vi.fn();
    bindRange(input, label, (v) => `${v.toFixed(2)}x`, cb);
    input.value = "4.5";
    input.dispatchEvent(new Event("input"));
    expect(cb).toHaveBeenCalledWith(4.5);
    expect(label.textContent).toBe("4.50x");
  });

  it("works without label and tolerates a missing input", () => {
    const input = range("1");
    const cb = vi.fn();
    bindRange(input, null, null, cb);
    input.dispatchEvent(new Event("input"));
    expect(cb).toHaveBeenCalledWith(1);
    expect(() => bindRange(null, null, null, cb)).not.toThrow();
  });
});

describe("42 formatSlider", () => {
  it("applies per-slider decimals and unit suffix", () => {
    expect(formatSlider("LiftY", 1.234)).toBe("1.23 m");
    expect(formatSlider("MaxRadius", 12.6)).toBe("13 px");
    expect(formatSlider("SunElev", 45.2)).toBe("45°");
    expect(formatSlider("Bias", 0.00123)).toBe("0.0012");
  });
});

describe("45 Hud shortcuts", () => {
  const make = (): { hud: Hud45; s: ReturnType<typeof state45>; onChange: () => void } => {
    const s = state45(4);
    const onChange = vi.fn();
    const hud = new Hud45(s, 6, onChange);
    return { hud, s, onChange };
  };

  it("wind keys wrap the angle and clamp strength to 0..1 in 0.1 steps", () => {
    const { hud, s } = make();
    hud.handleKey(key("", ","));
    expect(s.windAngleDeg).toBe(345);
    hud.handleKey(key("", "."));
    hud.handleKey(key("", "."));
    expect(s.windAngleDeg).toBe(15);
    for (let i = 0; i < 12; i++) hud.handleKey(key("", "+"));
    expect(s.windStrength).toBe(1);
    for (let i = 0; i < 12; i++) hud.handleKey(key("", "-"));
    expect(s.windStrength).toBe(0);
    hud.handleKey(key("", "="));
    hud.handleKey(key("", "="));
    hud.handleKey(key("", "="));
    expect(s.windStrength).toBeCloseTo(0.3, 10);
  });

  it("digits pick palettes, letters toggle layers, T cycles time and unpauses", () => {
    const { hud, s, onChange } = make();
    hud.handleKey(key("Digit3"));
    expect(s.palette).toBe("wisp");
    hud.handleKey(key("Digit0"));
    expect(s.palette).toBe("original");
    hud.handleKey(key("KeyF"));
    expect(s.flicker).toBe(false);
    s.paused = true;
    hud.handleKey(key("KeyT"));
    expect(s.timeScale).toBe(0.5);
    expect(s.paused).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it("unmapped keys are not consumed and do not notify", () => {
    const { hud, onChange } = make();
    expect(hud.handleKey(key("KeyQ", "q"))).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sync mirrors state into switches and active palette/time buttons", () => {
    const { hud, s } = make();
    s.glow = false;
    s.timeScale = 2;
    hud.sync();
    expect((document.querySelector("#sw_glow") as HTMLInputElement).checked).toBe(false);
    expect(document.querySelector('[data-time="2"]')?.classList.contains("active")).toBe(true);
    expect(document.querySelector('[data-time="1"]')?.classList.contains("active")).toBe(false);
  });
});

describe("46 Hud shortcuts", () => {
  it("1-6 select variants, 7-9 pools, P pauses, T cycles slow-motion first", () => {
    const s = state46();
    const onChange = vi.fn();
    const hud = new Hud46(s, onChange);
    hud.handleKey(key("Digit4"));
    expect(s.variant).toBe("trails");
    hud.handleKey(key("Digit8"));
    expect(s.pool).toBe("closeup");
    hud.handleKey(key("KeyP"));
    expect(s.paused).toBe(true);
    hud.handleKey(key("KeyT"));
    expect(s.timeScale).toBe(0.5);
    expect(s.paused).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(hud.handleKey(key("Digit0"))).toBe(false);
  });

  it("sync marks exactly the active variant and pool button", () => {
    const s = state46();
    const hud = new Hud46(s, () => undefined);
    s.variant = "smoke";
    s.pool = "budget";
    hud.sync();
    const active = (sel: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(`${sel}.active`)].map(
        (b) => b.dataset["variant"] ?? b.dataset["pool"] ?? "",
      );
    expect(active("[data-variant]")).toEqual(["smoke"]);
    expect(active("[data-pool]")).toEqual(["budget"]);
  });

  it("slider input updates state and notifies", () => {
    const s = state46();
    const onChange = vi.fn();
    new Hud46(s, onChange);
    const input = document.querySelector("#sl_smokeScale") as HTMLInputElement;
    input.value = "1.5";
    input.dispatchEvent(new Event("input"));
    expect(s.smokeScale).toBe(1.5);
    expect(onChange).toHaveBeenCalled();
    expect(document.querySelector("#sl_smokeScale_val")?.textContent).toBe("150 %");
  });
});
