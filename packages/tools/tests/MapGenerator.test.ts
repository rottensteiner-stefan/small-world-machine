// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MapGenerator } from "../src/MapGenerator.js";

describe("MapGenerator Tool & Universal IO Ingest", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("clears only on the second click and never opens a blocking confirm dialog", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    vi.useFakeTimers();
    const mapGen = new MapGenerator({ parent: container });
    mapGen.loadMapString("WWWW\nW..W\nWWWW");
    const button = container.querySelector<HTMLButtonElement>("#mapgen-btn-clear")!;

    button.click();
    expect(button.textContent).toContain("nochmal");
    expect(mapGen.getMapString()).toBe("WWWW\nW..W\nWWWW");

    button.click();
    expect(button.textContent).toBe("Clear Map");
    expect(mapGen.getMapString()).not.toContain("W");
    expect(confirmSpy).not.toHaveBeenCalled();

    mapGen.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("disarms the clear button when the second click does not come in time", () => {
    vi.useFakeTimers();
    const mapGen = new MapGenerator({ parent: container });
    mapGen.loadMapString("WWWW\nW..W\nWWWW");
    const button = container.querySelector<HTMLButtonElement>("#mapgen-btn-clear")!;

    button.click();
    vi.advanceTimersByTime(3100);
    expect(button.textContent).toBe("Clear Map");
    button.click(); // arms again instead of clearing
    expect(mapGen.getMapString()).toBe("WWWW\nW..W\nWWWW");

    mapGen.dispose();
    vi.useRealTimers();
  });
});
