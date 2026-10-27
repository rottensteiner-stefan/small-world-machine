// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MaterialStudioController,
  type MaterialStudioState,
} from "../../src/material-studio/MaterialStudioController.js";
import { buildMaterialStudioUI } from "../../src/material-studio/MaterialStudioUiBuilder.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("MaterialStudioController dispose", () => {
  it("removes the window-level drop and paste listeners the dropzone added in bind()", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    buildMaterialStudioUI(host);
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const controller = new MaterialStudioController();

    controller.bind();
    const registered = added.mock.calls.filter(([type]) => type === "drop" || type === "paste");
    expect(registered.length).toBeGreaterThan(0);

    controller.dispose();
    for (const [type, handler] of registered) {
      expect(removed).toHaveBeenCalledWith(type, handler);
    }
  });

  it("is safe to dispose a controller that never bound", () => {
    expect(() => new MaterialStudioController().dispose()).not.toThrow();
  });
});

describe("MaterialStudioController state", () => {
  function boundController(state?: MaterialStudioState): MaterialStudioController {
    const host = document.createElement("div");
    document.body.appendChild(host);
    buildMaterialStudioUI(host);
    const controller = new MaterialStudioController();
    if (state) controller.setState(state);
    controller.bind();
    return controller;
  }

  const parked: MaterialStudioState = {
    textureSrc: "data:image/png;base64,AAAA",
    fileName: "granite",
    tab: "normal",
    geometry: "torus",
    controls: {
      "profile-select": "metal",
      "height-blur-slider": "7",
      "normal-strength-slider": "250",
      "height-invert": true,
      "normal-format": "directx",
      "export-size": "512",
    },
  };

  it("is null before anything was parked or bound", () => {
    expect(new MaterialStudioController().getState()).toBeNull();
  });

  it("hands a parked state back unchanged while not yet bound", () => {
    const controller = new MaterialStudioController();
    controller.setState(parked);

    expect(controller.getState()).toBe(parked);
  });

  it("restores sliders, checkboxes and selects on bind without letting the profile overwrite them", () => {
    boundController(parked);

    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value("height-blur-slider")).toBe("7");
    // jsdom keeps `innerText` as a plain property, so the label is read back the way it was written.
    expect((document.getElementById("height-blur-val") as HTMLElement).innerText).toBe("7");
    expect(value("normal-strength-slider")).toBe("250");
    expect((document.getElementById("height-invert") as HTMLInputElement).checked).toBe(true);
    expect(value("profile-select")).toBe("metal");
    expect(value("normal-format")).toBe("directx");
    expect(value("export-size")).toBe("512");
    expect(document.querySelector(".geom-btn.active")?.getAttribute("data-geom")).toBe("torus");
  });

  it("round-trips: the snapshot of a restored controller equals what was parked", () => {
    const controller = boundController(parked);
    const state = controller.getState();

    expect(state?.textureSrc).toBe(parked.textureSrc);
    expect(state?.fileName).toBe("granite");
    expect(state?.geometry).toBe("torus");
    expect(state?.controls["height-blur-slider"]).toBe("7");
    expect(state?.controls["height-invert"]).toBe(true);
    expect(state?.controls["normal-format"]).toBe("directx");
  });

  it("reads changed controls and the open geometry from the DOM", () => {
    const controller = boundController();
    const slider = document.getElementById("ao-level-slider") as HTMLInputElement;
    slider.value = "33";
    (document.querySelector('.geom-btn[data-geom="cube"]') as HTMLElement).click();

    const state = controller.getState();

    expect(state?.controls["ao-level-slider"]).toBe("33");
    expect(state?.geometry).toBe("cube");
    expect(state?.tab).toBe("grid");
  });

  it("ignores a state handed to a controller that is already bound", () => {
    const controller = boundController();
    controller.setState(parked);

    expect(controller.getState()?.fileName).not.toBe("granite");
  });
});
