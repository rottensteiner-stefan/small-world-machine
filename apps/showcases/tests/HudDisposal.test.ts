// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";
import { Hud as Hud29, type HudActions as Actions29 } from "../29/Hud.js";
import { Hud as Hud41, type HudActions as Actions41 } from "../41/Hud.js";
import { Hud as Hud42, type HudActions as Actions42 } from "../42/Hud.js";
import { Hud as Hud45, defaultHudState as state45 } from "../45/Hud.js";
import { Hud as Hud46, defaultHudState as state46 } from "../46/Hud.js";

// The drawer's shared style (has an id) is intentionally persistent; only per-Hud tags count.
const styleCount = (): number => document.head.querySelectorAll("style:not([id])").length;
const drawerCount = (): number =>
  document.body.querySelectorAll("aside.swm-inspector-drawer").length;

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("ShowcaseDrawer.dispose", () => {
  it("cancels the delayed footer mount so a disposed button is not re-attached", () => {
    vi.useFakeTimers();
    const drawer = new ShowcaseDrawer({ id: "t-late", icon: "x", title: "t", showPerf: false });
    drawer.dispose();
    const footer = document.createElement("footer");
    footer.className = "app-footer";
    document.body.appendChild(footer);
    vi.advanceTimersByTime(500);
    expect(footer.contains(drawer.toggleButton)).toBe(false);
    expect(document.body.contains(drawer.toggleButton)).toBe(false);
  });

  it("stops the perf rAF loop", () => {
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(7);
    const drawer = new ShowcaseDrawer({ id: "t-perf", icon: "x", title: "t" });
    drawer.dispose();
    expect(cancel).toHaveBeenCalledWith(7);
    vi.restoreAllMocks();
  });
});

describe("Hud.dispose removes drawer and injected style", () => {
  it("29", () => {
    const before = styleCount();
    const hud = new Hud29({} as unknown as Actions29);
    expect(document.getElementById("sponzaTuningHudStyle")).not.toBeNull();
    hud.dispose();
    expect(document.getElementById("sponzaTuningHudStyle")).toBeNull();
    expect(styleCount()).toBe(before);
    expect(drawerCount()).toBe(0);
  });

  it("41", () => {
    const hud = new Hud41({} as unknown as Actions41);
    hud.dispose();
    expect(document.getElementById("reliefTuningHudStyle")).toBeNull();
    expect(drawerCount()).toBe(0);
  });

  it("42", () => {
    const hud = new Hud42({} as unknown as Actions42);
    hud.dispose();
    expect(document.getElementById("shadowLabStyle")).toBeNull();
    expect(drawerCount()).toBe(0);
  });

  it("45 (anonymous style tag)", () => {
    const before = styleCount();
    const hud = new Hud45(state45(8), 8, () => {});
    expect(styleCount()).toBeGreaterThan(before);
    hud.dispose();
    expect(styleCount()).toBe(before);
    expect(drawerCount()).toBe(0);
  });

  it("46 (anonymous style tag)", () => {
    const before = styleCount();
    const hud = new Hud46(state46(), () => {});
    hud.dispose();
    expect(styleCount()).toBe(before);
    expect(drawerCount()).toBe(0);
  });
});
