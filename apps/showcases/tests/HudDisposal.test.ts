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

describe("41 Hud preset/base sync", () => {
  const make = (): Hud41 => new Hud41({} as unknown as Actions41);

  it("syncPreset only touches the preset buttons, not swatches/erase/base", () => {
    const hud = make();
    const q = (id: string): HTMLElement => hud.root.querySelector(`#${id}`) as HTMLElement;
    q("btnErase").classList.add("active");
    q("btnBaseToggle").classList.add("active");
    q("btnPresetParis").classList.add("active");
    expect(q("swatch1").classList.contains("active")).toBe(true);

    hud.syncPreset("alps");

    expect(q("btnPresetAlps").classList.contains("active")).toBe(true);
    expect(q("btnPresetParis").classList.contains("active")).toBe(false);
    expect(q("btnErase").classList.contains("active")).toBe(true);
    expect(q("btnBaseToggle").classList.contains("active")).toBe(true);
    expect(q("swatch1").classList.contains("active")).toBe(true);
    hud.dispose();
  });

  it("syncBase mirrors the studio base on the toggle button (Q shortcut)", () => {
    const hud = make();
    const btn = hud.root.querySelector("#btnBaseToggle") as HTMLElement;
    hud.syncBase(true);
    expect(btn.classList.contains("active")).toBe(true);
    hud.syncBase(false);
    expect(btn.classList.contains("active")).toBe(false);
    hud.dispose();
  });
});

describe("46 Hud variant fallback", () => {
  it("shows the variant the change handler settled on (gpu -> forge)", () => {
    const settings = state46();
    const hud = new Hud46(settings, () => {
      if (settings.variant === "gpu") settings.variant = "forge";
    });
    document.querySelector<HTMLButtonElement>("[data-variant=gpu]")!.click();
    const active = document.querySelector("[data-variant].active") as HTMLElement;
    expect(active.dataset["variant"]).toBe("forge");
    hud.dispose();
  });
});

describe("45 Hud consumes R and B (so the base class must not also fire)", () => {
  it("handleKey returns true for KeyR and KeyB", () => {
    const hud = new Hud45(state45(8), 8, () => {});
    expect(hud.handleKey(new KeyboardEvent("keydown", { code: "KeyR" }))).toBe(true);
    expect(hud.handleKey(new KeyboardEvent("keydown", { code: "KeyB" }))).toBe(true);
    hud.dispose();
  });
});
