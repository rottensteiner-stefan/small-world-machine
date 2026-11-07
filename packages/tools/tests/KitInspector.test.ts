// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { KitInspectorApp } from "../src/kit-inspector/KitInspectorApp.js";
import { makeMockAudioContext } from "../../engine/tests/audio/mockAudioContext.js";

describe("KitInspectorApp", () => {
  let canvas: HTMLCanvasElement;
  let origAudioContext: unknown;

  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };
    document.body.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.id = "TestInspectorCanvas";
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
  });

  it("instantiates correctly with default settings", () => {
    const app = new KitInspectorApp({
      canvasId: "TestInspectorCanvas",
    });

    expect(app).toBeDefined();
    expect(app.kitRegistry).toBeDefined();
    expect(app.getLightingPreset()).toBe("studio");
    expect(app.isTurntable()).toBe(false);
    expect(app.isWireframe()).toBe(false);
    expect(app.areSocketsVisible()).toBe(true);
    expect(app.isGridVisible()).toBe(true);
    expect(app.currentAssetInfo).toBeNull();
  });

  it("updates lighting presets properly", () => {
    const app = new KitInspectorApp({
      canvasId: "TestInspectorCanvas",
    });

    app.setLightingPreset("bunker");
    expect(app.getLightingPreset()).toBe("bunker");

    app.setLightingPreset("cold");
    expect(app.getLightingPreset()).toBe("cold");

    app.setLightingPreset("studio");
    expect(app.getLightingPreset()).toBe("studio");
  });

  it("toggles visual inspection states", () => {
    const app = new KitInspectorApp({
      canvasId: "TestInspectorCanvas",
    });

    app.setTurntable(true);
    expect(app.isTurntable()).toBe(true);
    app.setTurntable(false);
    expect(app.isTurntable()).toBe(false);

    app.setWireframe(true);
    expect(app.isWireframe()).toBe(true);
    app.setWireframe(false);
    expect(app.isWireframe()).toBe(false);

    app.setSocketsVisible(false);
    expect(app.areSocketsVisible()).toBe(false);
    app.setSocketsVisible(true);
    expect(app.areSocketsVisible()).toBe(true);

    app.setGridVisible(false);
    expect(app.isGridVisible()).toBe(false);
    app.setGridVisible(true);
    expect(app.isGridVisible()).toBe(true);
  });

  it("notifies loading state change callback on errors or starts", async () => {
    const loadingSpy = vi.fn();
    const errorSpy = vi.fn();

    const app = new KitInspectorApp({
      canvasId: "TestInspectorCanvas",
      onLoadingStateChange: loadingSpy,
      onError: errorSpy,
    });

    // Attempting to load an invalid prop should trigger loading callback and error handler
    await app.inspectProp("non_existent_kit/invalid_prop");

    expect(loadingSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
